import {
  apply,
  diff,
  strip,
  type Character,
  type EntityId,
  type Gear,
  type InventoryAction,
  type Patch,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from '@mes/shared';
import { answerHost, callGuests } from '../net/coop-link';
import type { PeerLink } from '../net/peer';

/*
 * A party raid (docs/coop.md, C5). The host's device runs the raid as a solo raid runs,
 * with a character for each guest driven by the inputs they send. After every tick it
 * sends each guest what changed in the state (net/sync's diff), with the tick's events;
 * a guest applies that to its copy in place and draws it, and sends its input every tick.
 * No prediction yet (C6), so a guest sees its own moves a round trip late.
 */

export type CoopOptions =
  | { role: 'host'; session: string; name: string; guests: { id: string; name: string }[] }
  | { role: 'guest'; session: string; name: string; host: { id: string; name: string } };

/** Left out of what's sent: the RNG and the AI's workings stay on the host. */
const OMIT: ReadonlySet<string> = new Set(['rng', 'events', 'ai']);

/** What the host sends a guest once, when it joins. */
export interface Welcome {
  t: 'welcome';
  /** The guest's own character. */
  you: EntityId;
  /** The whole state, without OMIT. */
  state: SimState;
  /** The player spawn everyone started at. */
  spawn: string;
  /** Each enemy spawn marker's entity, as a saved raid keeps them. */
  spawned: Record<string, EntityId>;
  /** Every player's character and name, the host's included. */
  players: Record<EntityId, string>;
}

type ToHost =
  { t: 'join'; name: string; gear: Gear } | { t: 'input'; i: PlayerInput } | { t: 'giveUp' };

type ToGuest = Welcome | { t: 'tick'; p: Patch | null; e: SimEvent[] };

/** How long the host waits for a connected guest's join message (ms). */
const JOIN_MS = 15_000;

interface Guest {
  account: string;
  name: string;
  link: PeerLink;
  character: Character | null;
  /** Inputs since the last tick, merged into one when it runs. */
  queue: PlayerInput[];
  last: PlayerInput | null;
  givingUp: boolean;
}

/**
 * The inputs a guest sent since the last tick, as one: the latest stick, look and held
 * buttons, a press if any of them pressed, and every inventory action, in order.
 */
export function mergeInputs(queue: PlayerInput[], last: PlayerInput | null): PlayerInput | null {
  const latest = queue[queue.length - 1] ?? last;
  if (!latest) return null;
  if (!queue.length) {
    // Nothing new: keep moving and holding as before, but don't press anything twice.
    return {
      ...latest,
      jump: false,
      reload: false,
      inventory: [],
      draw: null,
      throw: false,
      use: null,
      door: null,
      search: null,
      investigate: false,
    };
  }
  const inventory: InventoryAction[] = [];
  const merged: PlayerInput = { ...latest, inventory };
  for (const i of queue) {
    merged.jump ||= i.jump;
    merged.reload ||= i.reload;
    merged.throw ||= !!i.throw;
    merged.investigate ||= !!i.investigate;
    if (i.draw) merged.draw = i.draw;
    if (i.use) merged.use = i.use;
    if (i.door !== null && i.door !== undefined) merged.door = i.door;
    if (i.switch !== null && i.switch !== undefined) merged.switch = i.switch;
    if (i.search) merged.search = i.search;
    if (i.ammo) merged.ammo = i.ammo;
    if (i.inventory) inventory.push(...i.inventory);
  }
  return merged;
}

export class CoopHost {
  private readonly guests: Guest[] = [];
  private mirror: unknown = null;

  /** Calls the guests; resolves with the host once those who answered are connected. */
  static async connect(
    opts: Extract<CoopOptions, { role: 'host' }>,
    status: (text: string) => void,
  ): Promise<CoopHost> {
    const links = await callGuests(opts.session, opts.guests, status);
    const host = new CoopHost();
    for (const g of opts.guests) {
      const link = links.get(g.id);
      if (link)
        host.guests.push({
          account: g.id,
          name: g.name,
          link,
          character: null,
          queue: [],
          last: null,
          givingUp: false,
        });
    }
    return host;
  }

  /** How many guests connected. */
  get size(): number {
    return this.guests.length;
  }

  /**
   * Waits for each connected guest's join, makes its character (`spawn`, wearing the gear
   * it brought), and sends it the state as it is, with the players and the raid's spawns.
   */
  async admit(
    spawn: (name: string, gear: Gear, index: number) => Character,
    base: { spawn: string; spawned: Record<string, EntityId>; host: Character; name: string },
    sim: SimState,
  ): Promise<{ character: Character; name: string }[]> {
    const joins = this.guests.map(
      (g) =>
        new Promise<{ name: string; gear: Gear } | null>((resolve) => {
          const timer = setTimeout(() => resolve(null), JOIN_MS);
          g.link.listen((data) => {
            const m = JSON.parse(data) as ToHost;
            if (m.t === 'join') {
              clearTimeout(timer);
              resolve(m);
            } else if (m.t === 'input') g.queue.push(m.i);
            else if (m.t === 'giveUp') g.givingUp = true;
          });
          g.link.onClose = () => resolve(null);
        }),
    );
    const got = await Promise.all(joins);
    const admitted: { character: Character; name: string }[] = [];
    got.forEach((join, i) => {
      const g = this.guests[i]!;
      if (!join) return;
      g.character = spawn(g.name, join.gear, i);
      admitted.push({ character: g.character, name: g.name });
    });
    this.mirror = strip(sim, OMIT);
    const players: Record<EntityId, string> = { [base.host.id]: base.name };
    for (const a of admitted) players[a.character.id] = a.name;
    for (const g of this.guests) {
      if (!g.character) {
        g.link.close();
        continue;
      }
      this.send(g, {
        t: 'welcome',
        you: g.character.id,
        state: this.mirror as SimState,
        spawn: base.spawn,
        spawned: base.spawned,
        players,
      });
    }
    return admitted;
  }

  /** Puts each guest's input for this tick into `inputs`, and those giving up to death. */
  fillInputs(inputs: Record<EntityId, PlayerInput>, kill: (c: Character) => void): void {
    for (const g of this.guests) {
      if (!g.character) continue;
      const merged = mergeInputs(g.queue, g.last);
      g.queue.length = 0;
      if (merged) {
        g.last = merged;
        inputs[g.character.id] = merged;
      }
      if (g.givingUp) {
        g.givingUp = false;
        if (!g.character.health.dead) kill(g.character);
      }
    }
  }

  /** After a tick: what changed, and the tick's events, to every guest still connected. */
  afterTick(sim: SimState): void {
    const p = diff(this.mirror, sim, OMIT) ?? null;
    if (p) this.mirror = apply(this.mirror, p);
    const msg = JSON.stringify({ t: 'tick', p, e: sim.events } satisfies ToGuest);
    for (const g of this.guests) if (g.character && g.link.open) g.link.send(msg);
  }

  /** Whether a guest is still playing: connected, with a live character in the raid. */
  playing(sim: SimState): boolean {
    return this.guests.some(
      (g) =>
        g.link.open &&
        g.character &&
        !g.character.health.dead &&
        sim.entities.includes(g.character),
    );
  }

  close(): void {
    for (const g of this.guests) g.link.close();
  }

  private send(g: Guest, m: ToGuest): void {
    g.link.send(JSON.stringify(m));
  }
}

export class CoopGuest {
  private readonly ticks: Extract<ToGuest, { t: 'tick' }>[] = [];
  private readonly events: SimEvent[] = [];
  /** The host's connection went: nothing more will come. */
  lost: string | null = null;

  private constructor(private readonly link: PeerLink) {}

  /** Connects to the host and joins, wearing `gear`; resolves with the state to start from. */
  static async connect(
    opts: Extract<CoopOptions, { role: 'guest' }>,
    name: string,
    gear: Gear,
    status: (text: string) => void,
  ): Promise<{ guest: CoopGuest; welcome: Welcome }> {
    const link = await answerHost(opts.session, opts.host, status);
    const guest = new CoopGuest(link);
    status(`Joining ${opts.host.name}'s raid…`);
    const welcome = await new Promise<Welcome>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the host never let us in')), JOIN_MS);
      link.listen((data) => {
        const m = JSON.parse(data) as ToGuest;
        if (m.t === 'welcome') {
          clearTimeout(timer);
          resolve(m);
        } else guest.ticks.push(m);
      });
      link.onClose = (why) => {
        guest.lost = why;
        reject(new Error(`the connection closed (${why})`));
      };
      link.send(JSON.stringify({ t: 'join', name, gear } satisfies ToHost));
    });
    // The state's own events and RNG aren't sent.
    welcome.state.events = [];
    return { guest, welcome };
  }

  /**
   * Brings the copy up to date with every tick the host sent since the last call, in
   * order; the state's events are all of theirs. Returns how many ticks came.
   */
  catchUp(sim: SimState): number {
    this.events.length = 0;
    const n = this.ticks.length;
    for (const t of this.ticks) {
      if (t.p) apply(sim, t.p);
      this.events.push(...t.e);
    }
    this.ticks.length = 0;
    sim.events = this.events;
    return n;
  }

  /** Starts listening for ticks: call once the copy is set up. */
  start(): void {
    this.link.listen((data) => {
      const m = JSON.parse(data) as ToGuest;
      if (m.t === 'tick') this.ticks.push(m);
    });
    this.link.onClose = (why) => (this.lost = why);
  }

  sendInput(input: PlayerInput): void {
    this.link.send(JSON.stringify({ t: 'input', i: input } satisfies ToHost));
  }

  giveUp(): void {
    this.link.send(JSON.stringify({ t: 'giveUp' } satisfies ToHost));
  }

  close(): void {
    this.link.close();
  }
}
