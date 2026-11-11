import type { CompiledMap } from '../content/compile';
import { weaponDef, type ItemDb } from '../content/items';
import type { Powerup, ZombiesDef } from '../content/zombies';
import type { NavGrid } from '../nav/nav-grid';
import { byWeight, chance, nextFloat } from '../rng';
import { TICK_SECONDS } from '../tick';
import type { CollisionWorld } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import { carriedAmmo, drawTime, equip, stow, switchHand, type Hand } from './gear';
import { CHEST, HEALTH, ZONE_COUNT } from './health';
import type { Character, EntityId, SimState } from './state';
import {
  createWeapon,
  createWeaponStats,
  loadedAmmo,
  weaponStats,
  type WeaponState,
} from './weapons';

/*
 * Zombies mode (2026-11-04, docs/design.md → Zombies): rounds of zombies that get more
 * numerous and tougher (never faster), points for hurting and killing them, points spent
 * on doors and couches (doors.ts), guns on the wall (and their ammo) and the mystery box,
 * and power-ups the dead sometimes drop. All of it is plain data in
 * state.zombies, run by step, so a co-op host runs the same rules. Zombies appear at the
 * map's zombie spawns, outside, whose barricaded window (or, with none, the spawn itself) a
 * living player can walk to, so a bought door opens up more of them. They tear the planks
 * off their window and climb in; players nail planks back up. Players have one health bar
 * that refills. Zombies' minds are in ai.ts (hunt).
 */

/** Zombies tuning. Distances in meters, times in seconds. */
export const ZOMBIES = {
  /** A zombie's body stays this long after it dies, then goes. */
  corpseTime: 4,
  /** Zombies climb in no nearer than this to any player, if a spawn that far is free. */
  spawnClear: 8,
  /** How far from a buy spot you can use it, and above or below it. */
  buyReach: 1.8,
  buyHeight: 1.5,
  /** Before a spawn is tried again when none can be used (all too near, or none reachable). */
  retry: 0.5,
  /** How far inside and outside a window's middle its standing spots are. */
  windowStand: 0.8,
  /** How near its inside spot a player rebuilds a window from, and its outside spot a zombie tears. */
  windowReach: 1.4,
  /** How near a power-up a player picks it up, across and up or down. */
  pickupReach: 1.3,
  pickupHeight: 1.5,
  /** How long the mystery box's gun hovers over it, to be taken, before it goes. */
  boxOffer: 7,
} as const;

/** The rules a game runs by, copied from its ZombiesDef, so the state is all a host needs. */
export type ZombiesRules = Pick<
  ZombiesDef,
  | 'zombie'
  | 'rounds'
  | 'points'
  | 'player'
  | 'barricades'
  | 'powerups'
  | 'spareMags'
  | 'box'
  | 'ammo'
>;

/** A power-up lying where a zombie died. */
export interface PowerupDrop {
  id: number;
  kind: Powerup;
  x: number;
  y: number;
  z: number;
  /** Seconds before it goes. */
  left: number;
}

/** A player's death machine: seconds left, and what it took the place of. */
export interface DeathMachine {
  left: number;
  /** What was in the first primary slot, given back when it ends. */
  prev: WeaponState | null;
  /** What was in their hands, taken out again when it ends. */
  hand: Hand;
}

/** Somewhere zombies appear. */
export interface ZombieSpawn {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** The window they break in through (index into windows), or -1 to hunt straight away. */
  window: number;
}

/** A barricaded window: where it is, and its planks. */
export interface WindowState {
  /** Its barricade's path id. */
  id: string;
  /** The middle of its sill; yaw turns +z to the inside. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  /** The most planks it takes, and how many are up. */
  max: number;
  planks: number;
  /** Seconds into nailing up the next plank, and into tearing one off. */
  rebuild: number;
  tear: number;
}

/** Something to buy (a door is bought through useDoor instead). */
export interface BuySpot {
  /** Its marker's path id. */
  id: string;
  kind: 'wallBuy' | 'mysteryBox';
  x: number;
  y: number;
  z: number;
  yaw: number;
  cost: number;
  /** A wall gun: which gun, and what buying it again for its ammo costs. */
  item?: string;
  ammoCost?: number;
  /** The mystery box: the gun it gave, hovering over it until taken or gone. */
  offer?: BoxOffer;
}

/** A gun the mystery box gave, for the player who paid to take while it lasts. */
export interface BoxOffer {
  item: string;
  by: EntityId;
  /** Seconds before it goes. */
  left: number;
}

export interface ZombiesState {
  rules: ZombiesRules;
  spawns: ZombieSpawn[];
  buys: BuySpot[];
  /** The round being played; 0 before the first. */
  round: number;
  /** Zombies still to climb in this round. */
  left: number;
  /** Seconds to the next zombie, or between rounds to the next round. */
  timer: number;
  /** Between rounds: the last one is over and the next hasn't started. */
  between: boolean;
  /** Each player's points, by entity id. A player missing has the rules' start. */
  points: Record<EntityId, number>;
  /** Each player's zombie kills. */
  kills: Record<EntityId, number>;
  windows: WindowState[];
  /** Points each player has had for nailing up planks this round (capped by the rules). */
  rebuilt: Record<EntityId, number>;
  /** The tick each player was last hurt, for their health refilling. */
  hurt: Record<EntityId, number>;
  /** Power-ups lying about, the next one's id, and how many dropped this round. */
  drops: PowerupDrop[];
  nextDrop: number;
  dropped: number;
  /** Seconds left of insta-kill and double points, for everyone; 0 when off. */
  instaKill: number;
  doublePoints: number;
  /** Death machines in players' hands, by entity id. */
  machines: Record<EntityId, DeathMachine>;
}

/** A zombie's own state, in its AiState (ai.ts). */
export interface ZombieMind {
  /** Seconds since it died; it's removed at ZOMBIES.corpseTime. */
  dead: number;
  /** The window it's breaking in through (index into windows), or -1 once inside (or none). */
  window: number;
}

/** A plank nailed up on a window (by a player) or torn off (by a zombie). */
export interface PlankEvent {
  type: 'plank';
  by: EntityId;
  /** Index into state.zombies.windows. */
  window: number;
  added: boolean;
  /** Points it paid (nailing up only, until the round's cap). */
  points: number;
}

/**
 * A power-up dropped where a zombie died, was picked up (by), or lay there too long and went;
 * or one that lasts ran out (ended: insta-kill, double points, or by's death machine).
 */
export interface PowerupEvent {
  type: 'powerup';
  what: 'dropped' | 'picked' | 'gone' | 'ended';
  kind: Powerup;
  /** Who picked it up, or whose death machine ended; 0 otherwise. */
  by: EntityId;
  x: number;
  y: number;
  z: number;
}

/** A round started (round > 0), or the last one ended (started false). */
export interface RoundEvent {
  type: 'round';
  round: number;
  started: boolean;
}

/**
 * What a buy did. bought: a gun, now in hand; ammo: a gun's ammo filled; poor: not enough
 * points; full: nothing to fill, so nothing paid; busy: no new gun while holding a death
 * machine. The mystery box: rolled: paid, and its gun hovers over it; taken: that gun, now
 * in hand; theirs: its gun is someone else's to take.
 */
export type BuyResult =
  'bought' | 'ammo' | 'poor' | 'full' | 'busy' | 'rolled' | 'taken' | 'theirs';

export interface BuyEvent {
  type: 'buy';
  by: EntityId;
  /** Index into state.zombies.buys. */
  spot: number;
  result: BuyResult;
  /** The gun bought or filled, or '' for nothing. */
  item: string;
  cost: number;
}

/** A map's barricades as windows boarded up full, as a zombies game starts them. */
export function barricadeWindows(map: Pick<CompiledMap, 'barricades'>): WindowState[] {
  return map.barricades.map((b) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    z: b.z,
    yaw: b.yaw,
    width: b.width,
    height: b.height,
    max: b.planks,
    planks: b.planks,
    rebuild: 0,
    tear: 0,
  }));
}

/**
 * Starts a zombies game: its rules, the map's zombie spawns and buy spots, and round 1
 * after the break time. Every player in the state starts with the rules' points.
 */
export function startZombies(state: SimState, map: CompiledMap, def: ZombiesDef): void {
  const spawns: ZombieSpawn[] = [];
  const buys: BuySpot[] = [];
  const windows = barricadeWindows(map);
  for (const m of map.markers) {
    if (m.type === 'zombieSpawn') {
      const window = m.window === undefined ? -1 : windows.findIndex((w) => w.id === m.window);
      spawns.push({ x: m.x, y: m.y, z: m.z, radius: m.radius ?? 0, window });
    } else if (m.type === 'wallBuy')
      buys.push({
        id: m.id,
        kind: m.type,
        x: m.x,
        y: m.y,
        z: m.z,
        yaw: m.yaw,
        cost: m.cost,
        item: m.item,
        ammoCost: m.ammoCost ?? Math.round(m.cost / 2),
      });
    else if (m.type === 'mysteryBox')
      buys.push({ id: m.id, kind: m.type, x: m.x, y: m.y, z: m.z, yaw: m.yaw, cost: m.cost });
  }
  const { zombie, rounds, points, player, barricades, powerups, spareMags, box, ammo } = def;
  const rules = { zombie, rounds, points, player, barricades, powerups, spareMags, box, ammo };
  state.zombies = {
    // A copy, so the state is plain data of its own.
    rules: JSON.parse(JSON.stringify(rules)) as ZombiesRules,
    spawns,
    buys,
    round: 0,
    left: 0,
    timer: rounds.breakTime,
    between: true,
    points: {},
    kills: {},
    windows,
    rebuilt: {},
    hurt: {},
    drops: [],
    nextDrop: 1,
    dropped: 0,
    instaKill: 0,
    doublePoints: 0,
    machines: {},
  };
  for (const e of state.entities) {
    if (e.ai) continue;
    state.zombies.points[e.id] = points.start;
    oneHealthBar(e, player.health);
  }
}

/** Gives a player zombies mode's one health bar, full. */
function oneHealthBar(c: Character, hp: number): void {
  c.health.pool = hp;
  c.health.hp[CHEST] = hp;
  c.health.bleeding.fill(false);
}

/** Where a window's inside (side 1) or outside (−1) standing spot is, across the ground. */
export function windowSpot(w: WindowState, side: 1 | -1): { x: number; z: number } {
  const d = side * ZOMBIES.windowStand;
  return { x: w.x + Math.sin(w.yaw) * d, z: w.z + Math.cos(w.yaw) * d };
}

/** The index of the window a player can nail planks up on (one short of full), or -1. */
export function windowInReach(state: SimState, c: Character): number {
  const windows = state.zombies?.windows;
  if (!windows || c.ai || c.health.dead) return -1;
  let best = -1;
  let bestD: number = ZOMBIES.windowReach;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    if (w.planks >= w.max || c.y > w.y + 0.5 || c.y < w.y - 2) continue;
    const p = windowSpot(w, 1);
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * One tick of a player holding the use button at a window: every rebuildTime another plank
 * goes up, paying rebuildPoints until they've had the round's cap from it.
 */
export function rebuild(state: SimState, c: Character): void {
  const z = state.zombies;
  const i = windowInReach(state, c);
  if (!z || i < 0) return;
  const w = z.windows[i]!;
  const rules = z.rules.barricades;
  w.rebuild += TICK_SECONDS;
  // The epsilon stops rounding from costing a tick.
  if (w.rebuild < rules.rebuildTime - 1e-9) return;
  w.rebuild = 0;
  w.planks++;
  const had = z.rebuilt[c.id] ?? 0;
  const earned = Math.max(0, Math.min(rules.rebuildPoints, rules.rebuildCap - had));
  z.rebuilt[c.id] = had + earned;
  const paid = earned * pointsScale(z);
  z.points[c.id] = pointsOf(state, c.id) + paid;
  state.events.push({ type: 'plank', by: c.id, window: i, added: true, points: paid });
}

/** A player's points in a zombies game (0 outside one). */
export function pointsOf(state: SimState, id: EntityId): number {
  const z = state.zombies;
  return z ? (z.points[id] ?? z.rules.points.start) : 0;
}

/** What points are multiplied by now: 2 under double points. */
function pointsScale(z: ZombiesState): number {
  return z.doublePoints > 0 ? 2 : 1;
}

/** Whether a player has a death machine in their hands, so can't switch to anything else. */
export function holdsDeathMachine(state: SimState, c: Character): boolean {
  return !!state.zombies?.machines[c.id];
}

/** Whether a character is one of zombies mode's zombies. */
export function isZombie(c: Character): boolean {
  return !!c.ai?.zombie;
}

/** How many zombies a round has. */
export function roundSize(rules: ZombiesRules, round: number): number {
  return Math.round(rules.rounds.first + rules.rounds.perRound * (round - 1));
}

/**
 * Once a tick, after everything has moved, fought and bled (before enemies think, so a new
 * zombie thinks this tick): points for this tick's hits and kills (and the power-ups they
 * drop), players' health, power-ups picked up or gone and those running out, dead zombies
 * cleared away, and the rounds: zombies climbing in one at a time, and a break once all
 * are dead.
 */
export function updateZombies(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
): void {
  const z = state.zombies;
  if (!z) return;
  score(state, z);
  players(state, z);
  powerups(state, items, z);
  // The box's gun goes if it isn't taken in time.
  for (const b of z.buys) if (b.offer && (b.offer.left -= TICK_SECONDS) <= 1e-9) delete b.offer;

  let alive = 0;
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const c = state.entities[i]!;
    const mind = c.ai?.zombie;
    if (!mind) continue;
    if (!c.health.dead) {
      alive++;
      continue;
    }
    // Nothing to loot on a zombie, and its claws are no one's to take.
    if (mind.dead === 0) c.gear.knife = null;
    mind.dead += TICK_SECONDS;
    if (mind.dead >= ZOMBIES.corpseTime) state.entities.splice(i, 1);
  }

  z.timer -= TICK_SECONDS;
  if (z.between) {
    if (z.timer > 0) return;
    z.between = false;
    z.round++;
    z.left = roundSize(z.rules, z.round);
    z.timer = 0;
    z.rebuilt = {};
    z.dropped = 0;
    state.events.push({ type: 'round', round: z.round, started: true });
  } else if (z.left === 0 && alive === 0) {
    z.between = true;
    z.timer = z.rules.rounds.breakTime;
    state.events.push({ type: 'round', round: z.round, started: false });
    return;
  }
  if (z.left === 0 || z.timer > 0 || alive >= z.rules.rounds.maxAlive) return;
  if (spawnZombie(state, world, items, nav, z)) {
    z.left--;
    z.timer = z.rules.rounds.spawnEvery;
  } else z.timer = ZOMBIES.retry;
}

/**
 * Points for this tick's events: a hit that doesn't kill (once per zombie per tick, so a
 * shotgun's pellets count once), and a kill, more with the knife. The death event comes
 * before the hit that caused it, so a kill's hit is looked for anywhere in the tick.
 */
function score(state: SimState, z: ZombiesState): void {
  const events = state.events;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== 'damage' && e.type !== 'death') continue;
    if (e.by === e.target) continue;
    const by = entityOf(state, e.by);
    const target = entityOf(state, e.target);
    if (!by || by.ai || !target || !isZombie(target)) continue;
    if (e.type === 'death') {
      let melee = false;
      for (const d of events)
        if (d.type === 'damage' && d.target === e.target && d.by === e.by && d.cause === 'melee')
          melee = true;
      const kill = melee ? z.rules.points.meleeKill : z.rules.points.kill;
      z.points[e.by] = pointsOf(state, e.by) + kill * pointsScale(z);
      z.kills[e.by] = (z.kills[e.by] ?? 0) + 1;
      dropPowerup(state, z, target, !!by.admin?.alwaysDrop);
      continue;
    }
    if (e.amount <= 0 || target.health.dead) continue;
    let first = true;
    for (let j = 0; j < i && first; j++) {
      const d = events[j]!;
      if (d.type === 'damage' && d.target === e.target && d.by === e.by && d.amount > 0)
        first = false;
    }
    if (first) z.points[e.by] = pointsOf(state, e.by) + z.rules.points.hit * pointsScale(z);
  }
}

/**
 * Players' one health bar: given to anyone without it (a player who joined late), and
 * refilled once they've gone regenDelay without being hurt.
 */
function players(state: SimState, z: ZombiesState): void {
  const rules = z.rules.player;
  for (const e of state.events)
    if (e.type === 'damage' && e.amount > 0 && !entityOf(state, e.target)?.ai)
      z.hurt[e.target] = state.tick;
  for (const c of state.entities) {
    if (c.ai || c.health.dead) continue;
    if (c.health.pool === undefined) oneHealthBar(c, rules.health);
    const since = (state.tick - (z.hurt[c.id] ?? -Infinity)) * TICK_SECONDS;
    if (since < rules.regenDelay) continue;
    const hp = c.health.hp;
    hp[CHEST] = Math.min(c.health.pool!, hp[CHEST]! + rules.regenRate * TICK_SECONDS);
  }
}

/**
 * Maybe a power-up where a zombie a player killed fell, while the round has some left; for
 * sure, cap or not, when `always` (the admin cheat).
 */
function dropPowerup(state: SimState, z: ZombiesState, at: Character, always: boolean): void {
  const rules = z.rules.powerups;
  if (!always && (z.dropped >= rules.perRound || !chance(state.rng, rules.chance))) return;
  const kinds = Object.entries(rules.weights).map(([kind, weight]) => ({ kind, weight }));
  if (!kinds.length) return;
  const kind = byWeight(state.rng, kinds).kind as Powerup;
  z.dropped++;
  const d = { id: z.nextDrop++, kind, x: at.x, y: at.y, z: at.z, left: rules.lifetime };
  z.drops.push(d);
  state.events.push({ type: 'powerup', what: 'dropped', kind, by: 0, x: d.x, y: d.y, z: d.z });
}

/**
 * Power-ups: those lasting tick down (a death machine ending gives back what it replaced),
 * and those lying about go when their time's up, or to the first living player over them.
 */
function powerups(state: SimState, items: ItemDb, z: ZombiesState): void {
  const ended = (kind: Powerup, by: EntityId): void => {
    state.events.push({ type: 'powerup', what: 'ended', kind, by, x: 0, y: 0, z: 0 });
  };
  // The epsilons stop rounding from leaving a sliver of time.
  if (z.instaKill > 0 && (z.instaKill -= TICK_SECONDS) <= 1e-9) {
    z.instaKill = 0;
    ended('instaKill', 0);
  }
  if (z.doublePoints > 0 && (z.doublePoints -= TICK_SECONDS) <= 1e-9) {
    z.doublePoints = 0;
    ended('doublePoints', 0);
  }
  for (const [id, m] of Object.entries(z.machines)) {
    if ((m.left -= TICK_SECONDS) > 1e-9) continue;
    const c = entityOf(state, Number(id));
    if (c) endDeathMachine(c, items, m);
    delete z.machines[Number(id)];
    ended('deathMachine', Number(id));
  }
  for (let i = z.drops.length - 1; i >= 0; i--) {
    const d = z.drops[i]!;
    let by: Character | null = null;
    for (const c of state.entities) {
      if (c.ai || c.health.dead || Math.abs(c.y - d.y) > ZOMBIES.pickupHeight) continue;
      if (Math.hypot(c.x - d.x, c.z - d.z) <= ZOMBIES.pickupReach) by = c;
    }
    if (by) applyPowerup(state, items, z, d.kind, by);
    else if ((d.left -= TICK_SECONDS) > 0) continue;
    z.drops.splice(i, 1);
    const what = by ? 'picked' : 'gone';
    state.events.push({
      type: 'powerup',
      what,
      kind: d.kind,
      by: by?.id ?? 0,
      x: d.x,
      y: d.y,
      z: d.z,
    });
  }
}

/** What a power-up does, picked up by c. */
function applyPowerup(
  state: SimState,
  items: ItemDb,
  z: ZombiesState,
  kind: Powerup,
  c: Character,
): void {
  const rules = z.rules.powerups;
  switch (kind) {
    case 'instaKill':
      z.instaKill = rules.duration;
      return;
    case 'doublePoints':
      z.doublePoints = rules.duration;
      return;
    case 'maxAmmo':
      // Every player's spare rounds, not what's loaded.
      for (const p of state.entities) {
        if (p.ai || p.health.dead) continue;
        for (const w of carriedGuns(p)) {
          if (weaponDef(items, w.item).infiniteAmmo) continue;
          const round = loadedAmmo(items, w);
          const short = spareFor(items, z, w) - carriedAmmo(p, round);
          if (short > 0) stow(p, items, createItem(items, round, short));
        }
      }
      return;
    case 'carpenter':
      for (const w of z.windows) {
        w.planks = w.max;
        w.rebuild = 0;
      }
      z.points[c.id] = pointsOf(state, c.id) + rules.carpenterPoints * pointsScale(z);
      return;
    case 'deathMachine': {
      const m = z.machines[c.id];
      if (m) {
        m.left = rules.duration;
        return;
      }
      z.machines[c.id] = { left: rules.duration, prev: c.gear.primary1, hand: c.gear.hand };
      c.gear.primary1 = null;
      equip(c, items, 'primary1', createWeapon(items, rules.minigun));
      c.gear.hand = 'primary1';
      c.aim = 0;
      c.using = null;
      c.draw = drawTime(items, c.gear, 'primary1');
    }
  }
}

/** Takes a death machine back: the first primary slot as it was, and the hands too. */
function endDeathMachine(c: Character, items: ItemDb, m: DeathMachine): void {
  const g = c.gear;
  g.primary1 = m.prev;
  if (g.hand !== 'primary1') return;
  const hand = m.hand !== 'primary1' || m.prev ? m.hand : g.sidearm ? 'sidearm' : 'knife';
  if (hand === 'primary1') {
    c.aim = 0;
    c.draw = drawTime(items, g, hand);
  } else {
    // Out of primary1, so that switching takes its draw time.
    switchHand(c, items, hand);
  }
}

function entityOf(state: SimState, id: EntityId): Character | undefined {
  for (const e of state.entities) if (e.id === id) return e;
  return undefined;
}

/**
 * A zombie at a spawn a living player can walk to, clear of every player if one is, picked
 * at random; facing the nearest player, with its claws out and its round's health. False if
 * no spawn can be used.
 */
function spawnZombie(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
  z: ZombiesState,
): boolean {
  let usable = 0;
  let clear = 0;
  for (const s of z.spawns) {
    const near = nearestPlayer(state, nav, z, s);
    if (near === Infinity) continue;
    usable++;
    if (near >= ZOMBIES.spawnClear) clear++;
  }
  if (usable === 0) return false;
  // The k-th usable spawn (clear of players, if any are).
  let k = Math.floor(nextFloat(state.rng) * (clear || usable));
  let spawn: ZombieSpawn | null = null;
  for (const s of z.spawns) {
    const near = nearestPlayer(state, nav, z, s);
    if (near === Infinity || (clear > 0 && near < ZOMBIES.spawnClear)) continue;
    if (k-- === 0) {
      spawn = s;
      break;
    }
  }
  if (!spawn) return false;

  const prey = nearestPlayerTo(state, spawn.x, spawn.z);
  const yaw = prey ? Math.atan2(-(prey.x - spawn.x), -(prey.z - spawn.z)) : 0;
  const c = spawnEnemy(state, world, spawn.x, spawn.y, spawn.z, yaw, { radius: spawn.radius });
  const rules = z.rules;
  const r = rules.rounds;
  c.ai!.zombie = { dead: 0, window: spawn.window };
  c.gear.knife = createItem(items, rules.zombie.claws);
  c.gear.hand = 'knife';
  c.draw = 0;
  const scale = r.health + r.healthPerRound * (z.round - 1);
  for (let i = 0; i < ZONE_COUNT; i++) c.health.hp[i] = HEALTH.maxHp[i]! * scale;
  return true;
}

/**
 * How far it is from a spawn to the nearest living player who can walk to it (or to the
 * inside of its window), in a straight line; Infinity if none can (a door not yet bought
 * between them).
 */
function nearestPlayer(state: SimState, nav: NavGrid, z: ZombiesState, s: ZombieSpawn): number {
  const w = z.windows[s.window];
  const inside = w && windowSpot(w, 1);
  const here = inside ? nav.nearest(inside.x, w.y, inside.z, 2) : nav.nearest(s.x, s.y, s.z);
  if (here < 0) return Infinity;
  let best = Infinity;
  for (const e of state.entities) {
    if (e.ai || e.health.dead) continue;
    const there = nav.nearest(e.x, e.y, e.z);
    if (there < 0 || nav.component[there] !== nav.component[here]) continue;
    best = Math.min(best, Math.hypot(e.x - s.x, e.z - s.z));
  }
  return best;
}

function nearestPlayerTo(state: SimState, x: number, z: number): Character | null {
  let best: Character | null = null;
  let bestD = Infinity;
  for (const e of state.entities) {
    if (e.ai || e.health.dead) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** The index of the nearest buy spot in a player's reach, or -1. */
export function buyInReach(state: SimState, c: Character): number {
  const buys = state.zombies?.buys;
  if (!buys || c.ai || c.health.dead) return -1;
  let best = -1;
  let bestD: number = ZOMBIES.buyReach;
  for (let i = 0; i < buys.length; i++) {
    const b = buys[i]!;
    if (Math.abs(c.y - b.y) > ZOMBIES.buyHeight) continue;
    const d = Math.hypot(c.x - b.x, c.z - b.z);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * What using a buy spot costs a player now, and what it would do: a wall gun they carry is
 * its ammo, at the ammo cost; the box's gun hovering for them is free to take.
 */
export function spotPrice(
  state: SimState,
  c: Character,
  spot: number,
): { cost: number; ammo: boolean } {
  const b = state.zombies?.buys[spot];
  if (!b) return { cost: 0, ammo: false };
  if (b.kind === 'wallBuy' && carriedGun(c, b.item!)) return { cost: b.ammoCost!, ammo: true };
  if (b.offer?.by === c.id) return { cost: 0, ammo: false };
  return { cost: b.cost, ammo: false };
}

// Scratch for a gun's magazine size.
const stats = createWeaponStats();

/**
 * Uses buy spot `spot`, in reach, for player c, and says what happened in an event. A wall
 * gun is put in hand (see giveGun), or, already carried, has its ammo filled; the mystery
 * box rolls a random gun from the rules' list, one not carried if it can, which hovers
 * over it for ZOMBIES.boxOffer seconds: using the box again then takes it (only the player
 * who paid), and the box can't be rolled until it's taken or gone. Nothing to fill costs
 * nothing, and no new gun while holding a death machine.
 */
export function buy(state: SimState, items: ItemDb, c: Character, spot: number): void {
  const z = state.zombies;
  const b = z?.buys[spot];
  if (!z || !b || buyInReach(state, c) !== spot) return;
  const { cost, ammo } = spotPrice(state, c, spot);
  // The infinite points cheat (dev only): everything's affordable, and nothing is spent.
  const free = !!c.admin?.infinitePoints;
  const have = free ? Infinity : pointsOf(state, c.id);
  const pay = (): void => {
    if (!free) z.points[c.id] = have - cost;
  };
  const push = (result: BuyResult, item: string, paid: number): void => {
    state.events.push({ type: 'buy', by: c.id, spot, result, item, cost: paid });
  };
  let item = b.item ?? '';
  if (ammo) {
    const w = carriedGun(c, item)!;
    if (!needsAmmo(c, items, z, w)) return push('full', item, 0);
    if (have < cost) return push('poor', item, 0);
    fillAmmo(c, items, z, w);
    pay();
    return push('ammo', item, cost);
  }
  const offer = b.offer;
  if (offer && offer.by !== c.id) return push('theirs', offer.item, 0);
  if (z.machines[c.id]) return push('busy', offer?.item ?? item, 0);
  if (offer) {
    delete b.offer;
    giveGun(c, items, z, offer.item);
    return push('taken', offer.item, 0);
  }
  if (have < cost) return push('poor', item, 0);
  if (b.kind === 'mysteryBox') {
    const fresh = z.rules.box.filter((o) => !carriedGun(c, o.item));
    item = byWeight(state.rng, fresh.length ? fresh : z.rules.box).item;
    pay();
    b.offer = { item, by: c.id, left: ZOMBIES.boxOffer };
    return push('rolled', item, cost);
  }
  pay();
  giveGun(c, items, z, item);
  push('bought', item, cost);
}

/*
 * Admin tools for testing (dev builds only, 2026-11-04): the client calls these straight
 * after a tick, as its debug hurt and heal do, so they're solo-only for now.
 */

/** Gives a player a power-up as if they'd picked it up (its event too). */
export function adminPowerup(state: SimState, items: ItemDb, c: Character, kind: Powerup): void {
  const z = state.zombies;
  if (!z || c.health.dead) return;
  applyPowerup(state, items, z, kind, c);
  state.events.push({ type: 'powerup', what: 'picked', kind, by: c.id, x: c.x, y: c.y, z: c.z });
}

/** Puts a gun in a player's hands with its ammo filled, as buying it would (see giveGun). */
export function adminGiveGun(state: SimState, items: ItemDb, c: Character, item: string): void {
  const z = state.zombies;
  if (!z || c.health.dead || weaponDef(items, item) === undefined) return;
  giveGun(c, items, z, item);
}

/** A gun of this item in one of c's gun slots, or null. */
function carriedGun(c: Character, item: string): WeaponState | null {
  const g = c.gear;
  for (const w of [g.primary1, g.primary2, g.sidearm]) if (w?.item === item) return w;
  return null;
}

function carriedGuns(c: Character): WeaponState[] {
  const g = c.gear;
  return [g.primary1, g.primary2, g.sidearm].filter((w): w is WeaponState => !!w);
}

/** The rounds a gun should have in reach once filled: its rules' spare magazines. */
function spareFor(items: ItemDb, z: ZombiesState, w: WeaponState): number {
  return weaponStats(items, w, stats).magazine * z.rules.spareMags;
}

function needsAmmo(c: Character, items: ItemDb, z: ZombiesState, w: WeaponState): boolean {
  const full = weaponStats(items, w, stats).magazine;
  return w.mag < full || carriedAmmo(c, loadedAmmo(items, w)) < spareFor(items, z, w);
}

/** Fills a gun's magazine, and its round in pockets and rig up to its spare (as fits). */
function fillAmmo(c: Character, items: ItemDb, z: ZombiesState, w: WeaponState): void {
  w.mag = weaponStats(items, w, stats).magazine;
  const round = loadedAmmo(items, w);
  const short = spareFor(items, z, w) - carriedAmmo(c, round);
  if (short > 0) stow(c, items, createItem(items, round, short));
}

/**
 * Puts a new gun in c's hands with its ammo filled: a pistol in the sidearm slot, anything
 * else in an empty primary slot, else in place of the primary in hand (else the first).
 * What it replaces is gone.
 */
function giveGun(c: Character, items: ItemDb, z: ZombiesState, item: string): void {
  const g = c.gear;
  const slot: Hand =
    weaponDef(items, item).hold === 'pistol'
      ? 'sidearm'
      : !g.primary1
        ? 'primary1'
        : !g.primary2
          ? 'primary2'
          : g.hand === 'primary2'
            ? 'primary2'
            : 'primary1';
  const w = createWeapon(items, item, [], z.rules.ammo?.[item]);
  equip(c, items, slot, w);
  g.hand = slot;
  c.aim = 0;
  c.using = null;
  c.draw = drawTime(items, g, slot);
  fillAmmo(c, items, z, w);
}
