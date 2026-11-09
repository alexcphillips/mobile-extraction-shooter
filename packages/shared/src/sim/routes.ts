import type { CompiledMap } from '../content/compile';
import { itemDef, type ItemDb } from '../content/items';
import { addItem, itemHeight, itemWidth, removeAt, type Grid } from '../inventory/grid';
import type { NavGrid } from '../nav/nav-grid';
import { nextFloat, nextRange } from '../rng';
import { TICK_RATE } from '../tick';
import type { CollisionWorld } from '../world/collision-world';
import { containerInReach, lootContainerById, type LootContainer } from './looting';
import { MOVEMENT } from './movement';
import { insidePolygon } from './raid';
import { entityById, type Character, type EntityId, type SimState } from './state';

/*
 * PMC routes, looting and extracting (AI rework session 4; design.md → AI → PMCs).
 *
 * A map's `poi` markers are the stops: loot spots (searched) and chokes (passed through and
 * watched). A squad goes from stop to stop, each picked by weight among those it hasn't
 * been to, favouring a fair walk over the one next door or the far end of the map: a chain
 * of them, made up as it goes, so it can turn towards gunfire. From a time picked at raid
 * start (somewhere between a third and four fifths of the raid) it heads for its
 * extraction zone after the stop it's at, and with a few minutes left it heads there at
 * once. Each member stands in the zone RAID.extractTime and leaves the raid with what it
 * carries (squads.ts updateSquads).
 *
 * The behaviour is in ai.ts (route, loot, extract); this is the squad's state and the
 * choices it makes. All of it is plain data in the state, so a saved raid keeps it.
 */

export const ROUTES = {
  /** Stick push walking its route: between patrolling and investigating. */
  pace: 0.7,
  /**
   * Weighted A* for squads' calm walking (route, following, searching, extracting): a path
   * up to this much longer than the shortest, for far fewer nodes searched (nav/path.ts).
   */
  greed: 2,
  /**
   * A path that got only part way ends further than this from where it was going: it plans
   * on from there, up to partialTries times, before giving the stop up.
   */
  partial: 3,
  partialTries: 4,
  /** A leaving squad whose way out keeps stopping short goes by another stop, up to this many times. */
  detours: 3,
  /** A follower goes into the extraction with its leader from within this many metres. */
  joinExtract: 20,
  /** Default radius of a loot spot (its containers within it are searched) and a choke. */
  lootRadius: 8,
  chokeRadius: 2,
  /** A container counts as at a loot spot if this close in height to it. */
  lootRise: 2,
  /** Seconds watching at a choke. */
  chokeWait: [4, 8] as const,
  /** Seconds at a loot spot at most, however much is left there. */
  lootMax: 75,
  /**
   * A stop is picked by weight × how good the walk is: full between hopNear and hopFar
   * metres, less nearer (down to hopNearRate at 0), and falling off as (hopFar / d)² beyond.
   */
  hopNear: 15,
  hopNearRate: 0.15,
  hopFar: 70,
  /**
   * Early on (ROUTES.apartFor), the falloff starts at this instead: a squad works its own
   * end of the map before crossing it (2026-11-08: squads crossing the east warehouse and
   * docks on their way to far stops met there and killed each other in the first 3 minutes).
   */
  hopFarEarly: 35,
  /** A stop it has been to counts this much as one it hasn't, once every stop is used up. */
  revisit: 0.2,
  /**
   * Keeping apart early (2026-11-08, the user's call: rival squads met in the first two
   * minutes and wiped each other out): for apartFor seconds after the squads start, a stop
   * within apartRadius of another living squad's members, or of the stop it's heading for,
   * counts apartRate as much. They can still meet; PMC against PMC is fine.
   */
  apartFor: 360,
  apartRadius: 35,
  apartRate: 0.03,
  /**
   * Off a boss's ground early (2026-11-08, the user's go-ahead): for bossFor seconds after
   * the squads start, a stop within bossClear of a living boss's patrol (its spawn without
   * one) counts apartRate as much.
   */
  bossFor: 300,
  bossClear: 25,
  /**
   * And their paths keep off it too (2026-11-08: Jug's ground lies across the mall, so
   * squads walking between other stops met him in the first 3 minutes): for bossPathFor
   * seconds, ground within bossPathRadius of a boss's patrol costs bossPathCost more a
   * metre, so a leader goes round it where there's a way.
   */
  bossPathFor: 420,
  /**
   * Its own area first (2026-11-08, from a Gemini review: squads crossing the map to their
   * first stops met in the middle): for areaFor seconds after the squads start, a stop
   * outside a squad's area counts apartRate as much.
   */
  areaFor: 300,
  bossPathRadius: 20,
  bossPathCost: 3,
  /**
   * It heads out after the current stop from this share of the raid on, picked at random
   * per squad (2026-11-08, the user's call: late and varied, one at 75%, another at 85%,
   * up to 90%, most gone in the last few minutes; it was 35–80%, so squads left at about
   * 13 minutes of 25 and the mall went quiet).
   */
  leaveShare: [0.75, 0.9] as const,
  /** With this many seconds of raid left it heads out at once (after 90%'s 2.5 minutes). */
  leaveBy: 120,
  /** Gunfire heard within this share of its loudness stops the looting and advances on it. */
  advanceShot: 0.7,
  /** Within this, alert. */
  alertShot: 0.2,
  /** Beyond advanceShot (out to the loudness), the next stop is one this many degrees either side of the way to it. */
  towardArc: 60,
  /** After a fight, the hunt ends this many seconds after it last saw or heard its target. */
  huntTime: [15, 20] as const,
  /** Bodies it killed are walked to and searched if within this many metres. */
  bodyRange: 40,
  /** Seconds to search a container or a body per item in it, and at least. */
  searchPerItem: 0.6,
  searchMin: 1.5,
} as const;

export type PoiKind = 'loot' | 'choke';

/** A point of interest in world space (a map's `poi` markers), copied in at raid start. */
export interface Poi {
  id: string;
  kind: PoiKind;
  x: number;
  y: number;
  z: number;
  weight: number;
  radius: number;
  /** The part of the map it's in (MapFile poi `area`), or none. */
  area?: string;
}

/** A PMC squad's route and what it's done, kept by the squad, whoever leads it. */
export interface SquadState {
  /** The squad's id (AiState.squad). */
  id: number;
  /** The stop it's heading for or at, by index into SimState.pois; −1 when it needs one. */
  stop: number;
  /** Stops it has been to, in order. */
  visited: number[];
  /** The extraction zone it leaves by and a spot inside it; null with none on the map. */
  extract: string | null;
  exX: number;
  exY: number;
  exZ: number;
  /** From this tick it heads out after its current stop; −1 never (no raid timer). */
  leaveTick: number;
  /** Heading for its extraction, or there. */
  leaving: boolean;
  /** Containers searched by the squad, by id: not searched again. */
  looted: string[];
  /** Bodies of those its members killed, by entity id, not yet searched. */
  kills: EntityId[];
  /**
   * Its own part of the map for the first ROUTES.areaFor (2026-11-08): stops in other
   * areas count apartRate as much meanwhile. Missing or null with none.
   */
  area?: string | null;
}

/** Copies the map's points of interest into the state, for routes. */
export function startPois(state: SimState, map: CompiledMap): void {
  const pois: Poi[] = [];
  for (const m of map.markers) {
    if (m.type !== 'poi') continue;
    pois.push({
      id: m.id,
      kind: m.kind,
      x: m.x,
      y: m.y,
      z: m.z,
      weight: m.weight ?? 1,
      radius: m.radius ?? (m.kind === 'loot' ? ROUTES.lootRadius : ROUTES.chokeRadius),
      ...(m.area !== undefined && { area: m.area }),
    });
  }
  state.pois = pois;
}

/**
 * A new squad's state: an extraction picked at random (always-open ones first), a spot to
 * stand in it, and when it heads out.
 */
export function newSquad(state: SimState, world: CollisionWorld, id: number): SquadState {
  const raid = state.raid;
  const all = raid?.extractions ?? [];
  const steady = all.filter((p) => !p.rotating);
  const from = steady.length ? steady : all;
  const ex = from.length ? from[Math.floor(nextFloat(state.rng) * from.length)]! : null;
  const sq: SquadState = {
    id,
    stop: -1,
    visited: [],
    extract: ex?.id ?? null,
    exX: 0,
    exY: 0,
    exZ: 0,
    leaveTick: -1,
    leaving: false,
    looted: [],
    kills: [],
  };
  if (ex) {
    const spot = spotInside(world, ex.points, ex.x, ex.y, ex.z);
    sq.exX = spot[0];
    sq.exY = spot[1];
    sq.exZ = spot[2];
  }
  if (raid) {
    const left = raid.endTick - state.tick;
    sq.leaveTick =
      state.tick +
      Math.round(left * nextRange(state.rng, ROUTES.leaveShare[0], ROUTES.leaveShare[1]));
  }
  (state.squads ??= []).push(sq);
  return sq;
}

/** A squad's state, or undefined (no routes: it guards its spawn). */
export function squadState(state: SimState, id: number | undefined): SquadState | undefined {
  if (id === undefined || !state.squads) return undefined;
  for (const s of state.squads) if (s.id === id) return s;
  return undefined;
}

/**
 * A spot to stand inside a zone's outline on its floor: its middle if that's inside and
 * clear, else part way to a corner. As [x, y, z].
 */
function spotInside(
  world: CollisionWorld,
  points: readonly (readonly [number, number])[],
  mx: number,
  floor: number,
  mz: number,
): [number, number, number] {
  const tries: [number, number][] = [[mx, mz]];
  for (const [px, pz] of points) tries.push([(mx + px) / 2, (mz + pz) / 2]);
  for (const [x, z] of tries) {
    if (!insidePolygon(points, x, z)) continue;
    const y = world.groundAt(x, z, MOVEMENT.radius, floor + 0.5);
    if (
      Math.abs(y - floor) < 0.6 &&
      !world.overlaps(x, z, MOVEMENT.radius, y + MOVEMENT.stepUp, y + MOVEMENT.standHeight)
    )
      return [x, y, z];
  }
  return [mx, floor, mz];
}

/**
 * Picks the extraction a leaving squad heads for: one whose zone c can walk into now (its
 * nav spot linked to c's, so not behind a locked door or a switched shutter nobody has
 * opened), always-open ones first, keeping its own if that will do. Sets sq.extract and
 * its spot; false with none.
 */
export function chooseExtraction(
  state: SimState,
  world: CollisionWorld,
  sq: SquadState,
  c: Character,
  nav: NavGrid,
): boolean {
  const all = state.raid?.extractions ?? [];
  const good: { id: string; spot: [number, number, number]; steady: boolean }[] = [];
  for (const p of all) {
    const spot = spotInside(world, p.points, p.x, p.y, p.z);
    if (!reachable(nav, c, spot[0], spot[1], spot[2])) continue;
    if (!insidePolygon(p.points, spot[0], spot[2])) continue;
    good.push({ id: p.id, spot, steady: !p.rotating });
  }
  const steady = good.filter((g) => g.steady);
  const from = steady.length ? steady : good;
  const pick =
    from.find((g) => g.id === sq.extract) ??
    (from.length ? from[Math.floor(nextFloat(state.rng) * from.length)]! : null);
  if (!pick) return false;
  sq.extract = pick.id;
  [sq.exX, sq.exY, sq.exZ] = pick.spot;
  return true;
}

/** A spot inside a squad's extraction zone, at random, for a member to stand in; null if none. */
export function extractSpot(
  state: SimState,
  world: CollisionWorld,
  sq: SquadState,
): [number, number, number] | null {
  const ex = state.raid?.extractions.find((p) => p.id === sq.extract);
  if (!ex) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ex.points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  // Kept off the outline, so a body's edge stays in.
  const m = MOVEMENT.radius;
  for (let i = 0; i < 10; i++) {
    const x = nextRange(state.rng, minX + m, maxX - m);
    const z = nextRange(state.rng, minZ + m, maxZ - m);
    if (!insidePolygon(ex.points, x, z)) continue;
    const y = world.groundAt(x, z, MOVEMENT.radius, ex.y + 0.5);
    if (Math.abs(y - ex.y) > 0.6) continue;
    if (world.overlaps(x, z, MOVEMENT.radius, y + MOVEMENT.stepUp, y + MOVEMENT.standHeight))
      continue;
    return [x, y, z];
  }
  return null;
}

/** Whether c stands in its squad's extraction zone. */
export function inExtraction(state: SimState, c: Character, sq: SquadState): boolean {
  const ex = state.raid?.extractions.find((p) => p.id === sq.extract);
  if (!ex) return false;
  if (c.y < ex.y - 0.5 || c.y > ex.y + ex.height) return false;
  return insidePolygon(ex.points, c.x, c.z);
}

/** Whether a nav spot near (x, y, z) is linked to where c stands. */
function reachable(nav: NavGrid, c: Character, x: number, y: number, z: number): boolean {
  const here = nav.nearest(c.x, c.y, c.z);
  const there = nav.nearest(x, y, z, 1.5);
  return here >= 0 && there >= 0 && nav.component[here] === nav.component[there];
}

/**
 * The next stop from (c's position), picked by weight and how good the walk is, out of
 * those not yet visited (or all of them, less likely, once they're used up). −1 with none.
 */
export function pickStop(state: SimState, sq: SquadState, c: Character, nav: NavGrid): number {
  const pois = state.pois ?? [];
  // From when startEnemies started the squads (and the waves).
  const start = state.waves?.start;
  const early =
    start !== undefined &&
    state.tick - start < ROUTES.apartFor * TICK_RATE &&
    (state.squads?.length ?? 0) > 1;
  const bossEarly = start !== undefined && state.tick - start < ROUTES.bossFor * TICK_RATE;
  const areaEarly = inAreaTime(state, sq);
  const far =
    start !== undefined && state.tick - start < ROUTES.apartFor * TICK_RATE
      ? ROUTES.hopFarEarly
      : ROUTES.hopFar;
  let total = 0;
  const scores: number[] = [];
  for (let i = 0; i < pois.length; i++) {
    const p = pois[i]!;
    let s = p.weight;
    if (sq.visited.includes(i)) s *= ROUTES.revisit;
    if (sq.visited[sq.visited.length - 1] === i) s = 0;
    if (s > 0 && early && nearRival(state, sq, p.x, p.z)) s *= ROUTES.apartRate;
    if (s > 0 && bossEarly && nearBoss(state, p.x, p.z, ROUTES.bossClear)) s *= ROUTES.apartRate;
    if (s > 0 && areaEarly && p.area !== sq.area) s = 0;
    if (s > 0) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < ROUTES.hopNear)
        s *= ROUTES.hopNearRate + (1 - ROUTES.hopNearRate) * (d / ROUTES.hopNear);
      else if (d > far) s *= (far / d) ** 2;
      if (!reachable(nav, c, p.x, p.y, p.z)) s = 0;
    }
    scores.push(s);
    total += s;
  }
  // Its own area early on, unless nothing there will do: then anywhere.
  if (total <= 0 && areaEarly) return pickStop(state, { ...sq, area: null }, c, nav);
  if (total <= 0) return -1;
  let r = nextFloat(state.rng) * total;
  for (let i = 0; i < scores.length; i++) {
    r -= scores[i]!;
    if (r < 0 && scores[i]! > 0) return i;
  }
  for (let i = scores.length - 1; i >= 0; i--) if (scores[i]! > 0) return i;
  return -1;
}

/**
 * The areas of the map's stops (poi `area`), each with its middle, in order of first
 * appearance; those by a living boss's ground (any stop within ROUTES.bossClear) left out.
 */
export function stopAreas(state: SimState): { id: string; x: number; y: number; z: number }[] {
  const out: { id: string; x: number; y: number; z: number; n: number; boss: boolean }[] = [];
  for (const p of state.pois ?? []) {
    if (p.area === undefined) continue;
    let a = out.find((o) => o.id === p.area);
    if (!a) out.push((a = { id: p.area, x: 0, y: 0, z: 0, n: 0, boss: false }));
    a.x += p.x;
    a.y += p.y;
    a.z += p.z;
    a.n++;
    if (nearBoss(state, p.x, p.z, ROUTES.bossClear)) a.boss = true;
  }
  return out
    .filter((a) => !a.boss)
    .map((a) => ({ id: a.id, x: a.x / a.n, y: a.y / a.n, z: a.z / a.n }));
}

/**
 * Whether (x, z) is within r of a living boss's ground: any point of its patrol, or its
 * spawn without one (2026-11-08: PMCs started on Jug's ground and killed him in seconds).
 */
export function nearBoss(state: SimState, x: number, z: number, r: number): boolean {
  for (const e of state.entities) {
    const ai = e.ai;
    if (!ai || e.health.dead || ai.faction !== 'boss') continue;
    const p = ai.patrol;
    if (p.length === 0) {
      if (Math.hypot(x - ai.homeX, z - ai.homeZ) <= r) return true;
      continue;
    }
    for (let i = 0; i < p.length; i += 3)
      if (Math.hypot(x - p[i]!, z - p[i + 2]!) <= r) return true;
  }
  return false;
}

/** Whether (x, z) is within apartRadius of another squad's living members or its stop. */
function nearRival(state: SimState, sq: SquadState, x: number, z: number): boolean {
  const r = ROUTES.apartRadius;
  const pois = state.pois ?? [];
  for (const o of state.squads ?? []) {
    if (o.id === sq.id || o.stop < 0) continue;
    const p = pois[o.stop];
    if (p && Math.hypot(p.x - x, p.z - z) < r) return true;
  }
  for (const e of state.entities) {
    const s = e.ai?.squad;
    if (s === undefined || s === sq.id || e.health.dead) continue;
    if (Math.hypot(e.x - x, e.z - z) < r) return true;
  }
  return false;
}

/** Whether a squad keeps to its own area yet (ROUTES.areaFor after the squads start). */
function inAreaTime(state: SimState, sq: SquadState): boolean {
  const start = state.waves?.start;
  return !!sq.area && start !== undefined && state.tick - start < ROUTES.areaFor * TICK_RATE;
}

/**
 * The nearest stop not yet visited that c can walk to, else −1: back on the route after a
 * fight. Early on, in its own area if there's one there (2026-11-08).
 */
export function nearestStop(state: SimState, sq: SquadState, c: Character, nav: NavGrid): number {
  const pois = state.pois ?? [];
  const own = inAreaTime(state, sq);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < pois.length; i++) {
    if (sq.visited.includes(i)) continue;
    const p = pois[i]!;
    if (own && p.area !== sq.area) continue;
    const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
    if (d < bestD && reachable(nav, c, p.x, p.y, p.z)) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0 && own) return nearestStop(state, { ...sq, area: null }, c, nav);
  return best;
}

/**
 * A stop towards a noise at (x, z) from c: within ROUTES.towardArc of the way to it and
 * nearer the noise than c is, the nearest to c. −1 with none.
 */
export function stopToward(
  state: SimState,
  c: Character,
  x: number,
  z: number,
  nav: NavGrid,
): number {
  const pois = state.pois ?? [];
  const toward = Math.atan2(x - c.x, z - c.z);
  const far = Math.hypot(x - c.x, z - c.z);
  const arc = (ROUTES.towardArc * Math.PI) / 180;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < pois.length; i++) {
    const p = pois[i]!;
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    if (d < 3 || d >= bestD || Math.hypot(p.x - x, p.z - z) >= far) continue;
    let off = Math.atan2(p.x - c.x, p.z - c.z) - toward;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    if (Math.abs(off) > arc || !reachable(nav, c, p.x, p.y, p.z)) continue;
    bestD = d;
    best = i;
  }
  return best;
}

/** What a squad member is going to search: a container's or a body's search key and where. */
export interface LootTarget {
  /** "c:<container id>" or "b:<entity id>", as search.ts searchKey. */
  key: string;
  x: number;
  y: number;
  z: number;
  /** Seconds left searching once there; −1 while walking to it. */
  search: number;
}

/** Whether any living member of the squad other than c is going to or searching key. */
function claimed(state: SimState, c: Character, key: string): boolean {
  for (const e of state.entities) {
    if (e !== c && !e.health.dead && e.ai?.loot?.key === key) return true;
  }
  return false;
}

/**
 * The nearest container at a loot stop for c to search: within its radius, not searched by
 * the squad, not seen empty, not taken by a squad mate, and reachable. Null with none.
 */
export function pickContainer(
  state: SimState,
  c: Character,
  sq: SquadState,
  stop: Poi,
  nav: NavGrid,
): LootTarget | null {
  let best: LootContainer | null = null;
  let bestD = Infinity;
  for (const l of state.loot) {
    if (Math.abs(l.y - stop.y) > ROUTES.lootRise) continue;
    if (Math.hypot(l.x - stop.x, l.z - stop.z) > stop.radius) continue;
    if (sq.looted.includes(l.id) || (l.searched && !l.grid.items.length)) continue;
    const d = Math.hypot(l.x - c.x, l.y - c.y, l.z - c.z);
    if (d >= bestD || claimed(state, c, `c:${l.id}`)) continue;
    if (!reachable(nav, c, l.x, l.y, l.z)) continue;
    bestD = d;
    best = l;
  }
  return best ? { key: `c:${best.id}`, x: best.x, y: best.y, z: best.z, search: -1 } : null;
}

/** A body the squad killed within ROUTES.bodyRange of c, to search; drops those gone or out of reach. */
export function pickBody(
  state: SimState,
  c: Character,
  sq: SquadState,
  nav: NavGrid,
): LootTarget | null {
  for (let i = sq.kills.length - 1; i >= 0; i--) {
    const e = entityById(state, sq.kills[i]!);
    const ok =
      !!e &&
      e.health.dead &&
      Math.hypot(e.x - c.x, e.z - c.z) <= ROUTES.bodyRange &&
      reachable(nav, c, e.x, e.y, e.z);
    if (!ok) {
      sq.kills.splice(i, 1);
      continue;
    }
    const key = `b:${e.id}`;
    if (claimed(state, c, key)) continue;
    return { key, x: e.x, y: e.y, z: e.z, search: -1 };
  }
  return null;
}

/** The grids a loot target's items are in; empty if it's gone. */
export function lootGrids(state: SimState, key: string): Grid[] {
  if (key.startsWith('c:')) {
    const l = lootContainerById(state, key.slice(2));
    return l ? [l.grid] : [];
  }
  const e = entityById(state, Number(key.slice(2)));
  if (!e) return [];
  const g = e.gear;
  return [g.pockets, g.rig?.grid, g.backpack?.grid].filter((x): x is Grid => !!x);
}

/** Whether c is close enough to a loot target to search it. */
export function lootInReach(state: SimState, c: Character, t: LootTarget): boolean {
  if (t.key.startsWith('c:')) {
    const l = lootContainerById(state, t.key.slice(2));
    return !!l && containerInReach(c, l);
  }
  const e = entityById(state, Number(t.key.slice(2)));
  return !!e && Math.hypot(e.x - c.x, e.z - c.z) <= 2 && Math.abs(e.y - c.y) <= 2;
}

/** Seconds to search a loot target, by how many items are in it. */
export function searchTime(state: SimState, key: string): number {
  let n = 0;
  for (const g of lootGrids(state, key)) n += g.items.length;
  return Math.max(ROUTES.searchMin, n * ROUTES.searchPerItem);
}

/**
 * Takes what fits from a loot target's grids into c's rig and backpack, the most valuable
 * for its size first. Never its gear (it doesn't change its own). Returns how many items
 * (stacks) it took.
 */
export function takeLoot(state: SimState, items: ItemDb, c: Character, key: string): number {
  const bags = [c.gear.rig?.grid, c.gear.backpack?.grid].filter((x): x is Grid => !!x);
  if (!bags.length) return 0;
  const found: { grid: Grid; i: number; worth: number }[] = [];
  for (const grid of lootGrids(state, key)) {
    grid.items.forEach((g, i) => {
      const def = itemDef(items, g.item.item);
      const cells = itemWidth(items, g.item.item, false) * itemHeight(items, g.item.item, false);
      found.push({ grid, i, worth: (def.value * g.item.count) / cells });
    });
  }
  found.sort((a, b) => b.worth - a.worth);
  const taken = new Map<Grid, number[]>();
  for (const f of found) {
    const item = f.grid.items[f.i]!.item;
    for (const bag of bags) {
      if (addItem(items, bag, item) === 0) {
        const list = taken.get(f.grid) ?? [];
        list.push(f.i);
        taken.set(f.grid, list);
        break;
      }
    }
  }
  let n = 0;
  for (const [grid, list] of taken) {
    // From the back, so the indices still point at the right items.
    for (const i of list.sort((a, b) => b - a)) {
      removeAt(grid, i);
      n++;
    }
  }
  return n;
}
