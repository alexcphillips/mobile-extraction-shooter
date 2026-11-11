import type { Search } from './search';
import type { CompiledMap } from '../content/compile';
import type { ItemDb } from '../content/items';
import { removeAt, type Grid, type Item } from '../inventory/grid';
import { createRng, nextFloat, nextInt } from '../rng';
import { TICK_RATE, TICK_SECONDS } from '../tick';
import { createItem } from './create-item';
import { CARRIED_GRIDS, GEAR_SLOTS, carriedGrid, createGear, type Gear } from './gear';
import type { Character, EntityId, SimState } from './state';

/*
 * The raid lifecycle (session 11): a timer, extraction points, and players leaving. See
 * design.md → Raids and maps → Extraction. Everything here is in the sim so a co-op
 * server runs the same rules.
 */

export const RAID = {
  /** Seconds standing in an extraction point to leave by it. */
  extractTime: 7,
  /** How far above its floor an extraction zone counts when it doesn't say, in metres. */
  extractHeight: 2,
  /** How far under its floor still counts (a slope, a step), in metres. */
  extractBelow: 0.5,
  /** How close to a quest marker a player must be to investigate it, in metres (14b). */
  investigateReach: 2.5,
};

/**
 * Where players can leave the raid: an area on a floor, from an extraction zone (map
 * format 4, 2026-11-07). x and z are its middle, for its label and the HUD.
 */
export interface ExtractionPoint {
  /** Its zone's id. */
  id: string;
  name: string;
  /** Its outline in x, z. */
  points: [number, number][];
  /** The height of the floor it's on. */
  y: number;
  /** How far above the floor counts. */
  height: number;
  /** Open in only some raids, picked for each player (extractionsFor). */
  rotating: boolean;
  x: number;
  z: number;
}

/**
 * A quest marker a player has to investigate in this raid (session 14b): one of their
 * active quests' investigate objectives on this map, not done before.
 */
export interface InvestigateSpot {
  /** The player whose quest it is; in co-op only they see it. */
  holder: EntityId;
  /** The questMarker's path id. */
  marker: string;
  x: number;
  y: number;
  z: number;
  /** Investigated in this raid. It counts even if they die afterwards. */
  done: boolean;
}

export interface RaidState {
  /** The tick the timer runs out on. */
  endTick: number;
  extractions: ExtractionPoint[];
  investigate: InvestigateSpot[];
  /**
   * Searches of containers and bodies, by "<player id>|<searchKey>" (2026-11-06,
   * search.ts). Missing (a raid saved before it) shows everything at once.
   */
  searches?: Record<string, Search>;
  /** Seeds each spawn's pick of the rotating extractions (extractionsFor). */
  seed?: number;
  /** How many rotating extractions each player gets (the map's rotatingExtractions). */
  rotatingOpen?: number | undefined;
  /**
   * The extraction points each player can use, by player id, then extraction id (2026-11-07,
   * openExtractions). A player not here (a raid saved before) can use every one.
   */
  open?: Record<string, string[]>;
}

/** What a player's active quests want in a raid on a map (quests.ts raidObjectives). */
export interface RaidObjectives {
  /** questMarkers to investigate, by path id. */
  investigate: string[];
  /** Quest items to put on the ground, each at one of its questMarkers, picked at random. */
  extract: { item: string; spots: string[] }[];
}

/** How a player left the raid alive: extracted, or still in it when time ran out. */
export type LeaveReason = 'extracted' | 'mia';

/** A player who has left the raid, with everything they had. */
export interface LeftRaid {
  character: Character;
  how: LeaveReason;
  /** The extraction point's id, or null when missing in action. */
  at: string | null;
  tick: number;
}

/** A player investigated a quest marker. */
export interface InvestigateEvent {
  type: 'investigate';
  by: EntityId;
  marker: string;
}

/** A player left the raid. They're out of state.entities and in state.left. */
export interface LeaveEvent {
  type: 'leave';
  by: EntityId;
  how: LeaveReason;
  at: string | null;
}

/**
 * Starts the raid's timer, running from now, with every extraction point on the map. Which
 * a player can use is their own, from where they start (openExtractions). A seed for the
 * rotating ones' picks is drawn from the raid's RNG only if there are any, so the map's
 * other rolls stay as they were on maps without.
 */
export function startRaid(state: SimState, map: CompiledMap, seconds: number): void {
  // How far noises carry for the AI here (MT-9: was set only by the client, so a raid
  // started elsewhere, like a sim test or a co-op host, heard at 1).
  state.hearingScale = map.hearingScale ?? 1;
  const extractions: ExtractionPoint[] = [];
  for (const zone of map.zones) {
    if (!zone.extraction) continue;
    const n = zone.points.length;
    extractions.push({
      id: zone.id,
      name: zone.name,
      points: zone.points.map(([x, z]) => [x, z]),
      y: zone.extraction.y,
      height: zone.extraction.height ?? RAID.extractHeight,
      rotating: !!zone.extraction.rotating,
      x: zone.points.reduce((s, p) => s + p[0], 0) / n,
      z: zone.points.reduce((s, p) => s + p[1], 0) / n,
    });
  }
  const anyRotating = extractions.some((p) => p.rotating);
  state.raid = {
    endTick: state.tick + Math.round(seconds * TICK_RATE),
    extractions,
    investigate: [],
    searches: {},
    seed: anyRotating ? Math.floor(nextFloat(state.rng) * 0x7fffffff) : 0,
    rotatingOpen: map.rotatingExtractions,
    open: {},
  };
}

/** A string's hash, for seeding a pick by name. */
function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The extraction points a player starting at a spawn can use (2026-11-07, the user's
 * call), by id: every always-open one the spawn doesn't rule out (its noExtracts), and
 * the rotating ones picked for this raid and spawn that it doesn't rule out. The pick is
 * the map's rotatingExtractions (all if it doesn't say) out of all its rotating ones,
 * made before the spawn's rule: so a rotating extract stays a chance (3 of 5 is 60%) for
 * every spawn that allows it, however many others that spawn rules out, and never turns
 * into a certainty because the rest were. Players starting at the same spawn (a co-op
 * party) get the same; each player's own, so in PvP others can have extracts you don't.
 */
export function extractionsFor(
  raid: RaidState,
  spawnId: string,
  noExtracts: readonly string[] = [],
): string[] {
  const rotating = raid.extractions.filter((p) => p.rotating);
  const rng = createRng((raid.seed ?? 0) ^ hashOf(spawnId));
  for (let i = rotating.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [rotating[i], rotating[j]] = [rotating[j]!, rotating[i]!];
  }
  const picked = new Set(rotating.slice(0, raid.rotatingOpen ?? rotating.length));
  return raid.extractions
    .filter((p) => (!p.rotating || picked.has(p)) && !noExtracts.includes(p.id))
    .map((p) => p.id);
}

/** Gives a player the extractions their spawn allows (extractionsFor), for the raid. */
export function openExtractions(
  state: SimState,
  c: Character,
  spawn: { id: string; noExtracts?: readonly string[] | undefined },
): void {
  const raid = state.raid;
  if (!raid) return;
  (raid.open ??= {})[c.id] = extractionsFor(raid, spawn.id, spawn.noExtracts);
}

/**
 * The extraction points a player can use: those they were given (openExtractions), or for
 * one never given any (a raid saved before), every one.
 */
export function extractionsOf(state: SimState, c: Character): ExtractionPoint[] {
  const raid = state.raid;
  if (!raid) return [];
  const ids = raid.open?.[c.id];
  return ids ? raid.extractions.filter((p) => ids.includes(p.id)) : raid.extractions;
}

/**
 * Spawns that would leave a player with no way out (for content checks and the editor):
 * every extraction ruled out, or only rotating ones left and none opened. Each as
 * "<spawn id>: why".
 */
export function spawnProblems(map: CompiledMap): string[] {
  const extracts = map.zones.filter((z) => z.extraction);
  if (!extracts.length) return [];
  const ids = new Set(extracts.map((z) => z.id));
  const out: string[] = [];
  for (const m of map.markers) {
    if (m.type !== 'playerSpawn') continue;
    const no = m.noExtracts ?? [];
    for (const id of no) if (!ids.has(id)) out.push(`${m.id}: no extraction "${id}"`);
    const left = extracts.filter((z) => !no.includes(z.id));
    const always = left.filter((z) => !z.extraction!.rotating).length;
    if (always) continue;
    // Only rotating ones: a raid opens n of all of them, so if n of the ones ruled out
    // could be the ones opened, this spawn could get none.
    const rotating = extracts.filter((z) => z.extraction!.rotating).length;
    const allowed = left.length;
    const n = Math.min(map.rotatingExtractions ?? rotating, rotating);
    if (!allowed || !n) out.push(`${m.id}: no extraction it can use`);
    else if (rotating - allowed >= n)
      out.push(`${m.id}: only rotating extractions, and some raids open none of them`);
  }
  return out;
}

/**
 * Sets up a player's quests in a raid (after startRaid): the markers they can investigate,
 * and their quest items on the ground, each at one of its spots picked with the raid's RNG.
 * A marker missing from the map is an error (the client's content test checks them).
 */
export function startQuests(
  state: SimState,
  map: CompiledMap,
  items: ItemDb,
  holder: EntityId,
  objectives: RaidObjectives,
): void {
  const raid = state.raid;
  if (!raid) return;
  const at = (id: string): { x: number; y: number; z: number } => {
    const m = map.markers.find((x) => x.type === 'questMarker' && x.id === id);
    if (!m) throw new Error(`no quest marker "${id}" on ${map.id}`);
    return m;
  };
  for (const marker of objectives.investigate) {
    const { x, y, z } = at(marker);
    raid.investigate.push({ holder, marker, x, y, z, done: false });
  }
  for (const { item, spots } of objectives.extract) {
    const { x, y, z } = at(spots[nextInt(state.rng, spots.length)]!);
    const yaw = nextFloat(state.rng) * Math.PI * 2;
    state.ground.push({ item: createItem(items, item, 1), x, y, z, yaw });
  }
}

/** The nearest quest marker in reach that a character still has to investigate, or null. */
export function investigateInReach(state: SimState, c: Character): InvestigateSpot | null {
  let best: InvestigateSpot | null = null;
  let bestD = RAID.investigateReach;
  for (const s of state.raid?.investigate ?? []) {
    if (s.holder !== c.id || s.done || Math.abs(c.y - s.y) > RAID.extractHeight) continue;
    const d = Math.hypot(c.x - s.x, c.z - s.z);
    if (d <= bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Investigates the quest marker in reach, if there is one (the Investigate button). */
export function investigate(state: SimState, c: Character): void {
  if (c.health.dead) return;
  const s = investigateInReach(state, c);
  if (!s) return;
  s.done = true;
  state.events.push({ type: 'investigate', by: c.id, marker: s.marker });
}

/** The quest markers a player has investigated in this raid. */
export function investigatedBy(state: SimState, id: EntityId): string[] {
  return (state.raid?.investigate ?? [])
    .filter((s) => s.holder === id && s.done)
    .map((s) => s.marker);
}

/** Seconds left on the raid timer (0 once it has run out), or Infinity with no raid. */
export function timeLeft(state: SimState): number {
  if (!state.raid) return Infinity;
  return Math.max(0, state.raid.endTick - state.tick) * TICK_SECONDS;
}

/**
 * The extraction point a character is standing in (one of theirs, extractionsOf: inside
 * its outline, from just under its floor up to its height), or null.
 */
export function extractionAt(state: SimState, c: Character): ExtractionPoint | null {
  const ids = state.raid?.open?.[c.id];
  for (const p of state.raid?.extractions ?? []) {
    if (ids && !ids.includes(p.id)) continue;
    if (c.y < p.y - RAID.extractBelow || c.y > p.y + p.height) continue;
    if (insidePolygon(p.points, c.x, c.z)) return p;
  }
  return null;
}

/** Whether (x, z) is inside a polygon of [x, z] points (even-odd rule). */
export function insidePolygon(
  points: readonly (readonly [number, number])[],
  x: number,
  z: number,
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Once a tick, after everything else: living players in an extraction point count up
 * towards leaving (stepping out resets it; being shot doesn't), and when the timer runs
 * out, every player still in the raid is missing in action. Enemies never leave.
 */
export function updateRaid(state: SimState): void {
  const raid = state.raid;
  if (!raid) return;
  const timeUp = state.tick >= raid.endTick;
  let gone = false;
  for (const c of state.entities) {
    if (c.ai || c.health.dead) continue;
    const p = extractionAt(state, c);
    c.extracting = p ? c.extracting + TICK_SECONDS : 0;
    if (p && c.extracting >= RAID.extractTime - 1e-9) gone = leave(state, c, 'extracted', p.id);
    else if (timeUp) gone = leave(state, c, 'mia', null);
  }
  if (gone) {
    for (let i = state.entities.length - 1; i >= 0; i--) {
      if (state.left.some((l) => l.character === state.entities[i])) state.entities.splice(i, 1);
    }
  }
}

function leave(state: SimState, c: Character, how: LeaveReason, at: string | null): true {
  state.left.push({ character: c, how, at, tick: state.tick });
  state.events.push({ type: 'leave', by: c.id, how, at });
  return true;
}

/** Everything in a character's gear: what's in its slots, and in its grids. */
export function gearItems(gear: Gear): Item[] {
  const out: Item[] = [];
  for (const slot of GEAR_SLOTS) {
    const item = gear[slot];
    if (item) out.push(item);
  }
  for (let i = 0; i < CARRIED_GRIDS; i++) {
    for (const g of carriedGrid(gear, i)?.items ?? []) out.push(g.item);
  }
  for (const g of gear.vault?.items ?? []) out.push(g.item);
  return out;
}

/**
 * Marks what a player takes into a raid, before it starts. In the raid `brought` tells
 * their own items from the raid's, which need no marking however they arrive: unmarked
 * means found. A found item taken back in swaps `found` for `refound`: it comes out found
 * again, but isn't counted as the raid's gain (2026-11-11).
 */
export function markBrought(c: Character): void {
  c.marked = true;
  for (const item of gearItems(c.gear)) {
    if (item.found) {
      delete item.found;
      item.refound = true;
    } else item.brought = true;
  }
}

/**
 * What comes off a gun, an attachment or rounds, counts as brought for a marked player: a
 * gun doesn't record what was fitted or loaded, and found mustn't be had by passing a
 * bought item through a found gun. Between raids it's plain, for the same reason.
 */
export function cameOffGun(c: Character, item: Item): Item {
  if (c.marked) item.brought = true;
  return item;
}

/** Turns a raid's marks into stored ones as the gear leaves it: see markBrought. */
export function settleFound(gear: Gear): void {
  for (const item of gearItems(gear)) {
    delete item.refound;
    if (item.brought) delete item.brought;
    else item.found = true;
  }
}

/**
 * What a player keeps from the raid: everything if they extracted; if they died or went
 * missing, only the knife and what's in the vault.
 */
export function keptItems(gear: Gear, survived: boolean): Item[] {
  if (survived) return gearItems(gear);
  const out: Item[] = [];
  if (gear.knife) out.push(gear.knife);
  for (const g of gear.vault?.items ?? []) out.push(g.item);
  return out;
}

/**
 * Takes every quest item out of a player's gear, wherever it is, and returns their ids
 * (one per item). They never reach the stash: the server takes them when the raid ends,
 * and counts the ones its quests wanted (session 14b).
 */
export function takeQuestItems(items: ItemDb, gear: Gear): string[] {
  const out: string[] = [];
  const fromGrid = (grid: Grid | null | undefined): void => {
    if (!grid) return;
    for (let i = grid.items.length - 1; i >= 0; i--) {
      const item = grid.items[i]!.item;
      if (items.get(item.item)?.type === 'quest') {
        out.push(item.item);
        removeAt(grid, i);
      } else fromGrid(item.grid);
    }
  };
  for (const slot of GEAR_SLOTS) fromGrid(gear[slot]?.grid);
  fromGrid(gear.pockets);
  fromGrid(gear.vault);
  return out;
}

/**
 * The gear a player comes out of the raid with: all of it if they extracted; if they
 * died or went missing, a fresh set with only the knife and the vault. As keptItems, but
 * keeping where things are. knife stands in if the gear has none.
 */
export function keptGear(gear: Gear, survived: boolean, knife: Item | null = null): Gear {
  if (survived) return gear;
  const out = createGear(true);
  out.knife = gear.knife ?? knife;
  out.vault = gear.vault ?? out.vault;
  out.hand = 'knife';
  return out;
}
