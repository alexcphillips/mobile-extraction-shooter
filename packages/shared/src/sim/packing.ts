import {
  isMagazine,
  itemDef,
  magazineFed,
  roundOf,
  weaponDef,
  type ItemDb,
} from '../content/items';
import type { Grid, Item } from '../inventory/grid';
import { TICK_SECONDS } from '../tick';
import type { CollisionWorld } from '../world/collision-world';
import { QUICK_GRIDS, carriedGrid, heldWeapon } from './gear';
import { loadKind, reachableItem, stowRoundsFor, takeRounds, type ItemRef } from './looting';
import type { Character, PlayerInput, SimState } from './state';
import { createWeaponStats, loadedAmmo, weaponStats, type WeaponState } from './weapons';

/**
 * MG-2 (2026-11-12): packing magazines takes time in a raid. A round at a time, it goes on
 * with the inventory closed, like a med: you can walk, and firing, aiming, reloading, a med,
 * a ladder or a vault stops it with what's done kept. Between raids, all of it is at once.
 * Zombies mode loads at once as before. Enemies never pack: their magazines fill as they
 * go in (MG-4, weapons.ts: magRounds).
 */
export const PACKING = {
  /** Seconds a round, into a magazine (a 30-rounder about 14 s). */
  perRound: 0.45,
  /** Seconds a round, out of one: thumbing them out is quicker. */
  unloadPerRound: 0.3,
};

/**
 * What c is packing, if anything:
 * - pack: the Pack Mags button: loose rounds in pockets and rig into the magazines there,
 *   the fullest first (packTarget).
 * - load: a stack dropped on a magazine (`mag`, loose or in a gun) from `from`.
 * - unload: the rounds out of `mag` (a loose magazine or a magazine-fed gun) into what c
 *   carries, or at its feet.
 */
export interface Packing {
  kind: 'pack' | 'load' | 'unload';
  mag?: ItemRef;
  from?: ItemRef;
  /** Seconds until the next round goes in or out. */
  next: number;
  /** Rounds moved so far, and in all (it grows if more turn up): the progress bar. */
  done: number;
  total: number;
}

const stats = createWeaponStats();

/** A magazine's rounds, wherever they're kept: a loose one's, or those of the one in a gun. */
interface Mag {
  n: number;
  capacity: number;
  /** The round loaded, or null when empty. */
  round: string | null;
}

/** The magazine in `item` (a loose one, or a magazine-fed gun with one in), or null. */
function magOf(items: ItemDb, item: Item, out: Mag): Mag | null {
  if (item.attachments) {
    const gun = item as WeaponState;
    if (!magazineFed(weaponDef(items, gun.item)) || gun.attachments.magazine === null) return null;
    out.n = gun.mag;
    out.capacity = weaponStats(items, gun, stats).magazine;
    out.round = gun.mag > 0 ? loadedAmmo(items, gun) : null;
    return out;
  }
  const def = itemDef(items, item.item);
  if (!isMagazine(def)) return null;
  out.n = item.mag ?? 0;
  out.capacity = def.capacity;
  out.round = out.n > 0 ? (item.loaded ?? null) : null;
  return out;
}

/** Sets a magazine's rounds (see magOf); 0 empties it. */
function setMag(items: ItemDb, item: Item, n: number, round: string): void {
  if (item.attachments) {
    const gun = item as WeaponState;
    gun.mag = n;
    if (n > 0 && round !== weaponDef(items, gun.item).ammo) gun.loaded = round;
    else delete gun.loaded;
    return;
  }
  if (n > 0) {
    item.mag = n;
    item.loaded = round;
  } else {
    delete item.mag;
    delete item.loaded;
  }
}

const scratch: Mag = { n: 0, capacity: 0, round: null };

/** Whether a packing job would be timed for c: in a raid, not zombies mode (enemies too, MG-3). */
export function packingTimed(state: SimState, _c: Character, stash: boolean): boolean {
  return !stash && !state.zombies;
}

// ------------------------------------------------------------------------------ pack mags

/** Rounds of `round` loose in pockets and rig. */
function looseRounds(c: Character, round: string): number {
  let n = 0;
  for (let g = 0; g < QUICK_GRIDS; g++) {
    const grid = carriedGrid(c.gear, g);
    if (!grid) continue;
    for (const gi of grid.items) if (gi.item.item === round) n += gi.item.count;
  }
  return n;
}

/**
 * The round an empty magazine of `caliber` takes: the one the gun in hand has loaded, if
 * it's that caliber and some is loose in pockets or rig; else the highest level there
 * (as a reload picks), the first found on a tie. Null if there's none.
 */
function roundFor(c: Character, items: ItemDb, caliber: string, skip?: Map<string, number>) {
  const left = (id: string): number => looseRounds(c, id) - (skip?.get(id) ?? 0);
  const w = heldWeapon(c);
  if (w) {
    const held = loadedAmmo(items, w);
    if (roundOf(items, held)?.caliber === caliber && left(held) > 0) return held;
  }
  let best: string | null = null;
  let level = -1;
  for (let g = 0; g < QUICK_GRIDS; g++) {
    const grid = carriedGrid(c.gear, g);
    if (!grid) continue;
    for (const gi of grid.items) {
      const r = roundOf(items, gi.item.item);
      if (r?.type !== 'ammo' || r.caliber !== caliber || r.level <= level) continue;
      if (left(r.id) <= 0) continue;
      best = r.id;
      level = r.level;
    }
  }
  return best;
}

/**
 * Pack Mags' next magazine: of those in pockets and rig with room and a round to take
 * (their own, or roundFor's when empty), the fullest; the first found on a tie.
 */
function packTarget(c: Character, items: ItemDb): { mag: Item; round: string } | null {
  let best: Item | null = null;
  let bestRound = '';
  let bestN = -1;
  for (let g = 0; g < QUICK_GRIDS; g++) {
    const grid = carriedGrid(c.gear, g);
    if (!grid) continue;
    for (const gi of grid.items) {
      const m = gi.item.attachments ? null : magOf(items, gi.item, scratch);
      if (!m || m.n >= m.capacity || m.n <= bestN) continue;
      const caliber = (itemDef(items, gi.item.item) as { caliber: string }).caliber;
      const round = m.round ?? roundFor(c, items, caliber);
      if (!round || looseRounds(c, round) <= 0) continue;
      best = gi.item;
      bestRound = round;
      bestN = m.n;
    }
  }
  return best ? { mag: best, round: bestRound } : null;
}

/** How many rounds Pack Mags would move now (packTarget's choices, played out). */
export function packable(c: Character, items: ItemDb): number {
  const mags: { n: number; capacity: number; round: string | null; caliber: string }[] = [];
  for (let g = 0; g < QUICK_GRIDS; g++) {
    const grid = carriedGrid(c.gear, g);
    if (!grid) continue;
    for (const gi of grid.items) {
      const m = gi.item.attachments ? null : magOf(items, gi.item, scratch);
      if (!m || m.n >= m.capacity) continue;
      const caliber = (itemDef(items, gi.item.item) as { caliber: string }).caliber;
      mags.push({ n: m.n, capacity: m.capacity, round: m.round, caliber });
    }
  }
  // Fullest first; a stable sort keeps the first found first on a tie.
  mags.sort((a, b) => b.n - a.n);
  const used = new Map<string, number>();
  let total = 0;
  for (const m of mags) {
    const round = m.round ?? roundFor(c, items, m.caliber, used);
    if (!round) continue;
    const n = Math.min(m.capacity - m.n, looseRounds(c, round) - (used.get(round) ?? 0));
    if (n <= 0) continue;
    used.set(round, (used.get(round) ?? 0) + n);
    total += n;
  }
  return total;
}

/** Takes up to n of `round` loose from pockets, then rig (the smallest stack first). */
function takeLoose(c: Character, round: string, n: number): number {
  let took = 0;
  while (took < n) {
    let grid: Grid | null = null;
    let index = -1;
    for (let g = 0; g < QUICK_GRIDS; g++) {
      const gr = carriedGrid(c.gear, g);
      if (!gr) continue;
      gr.items.forEach((gi, i) => {
        if (gi.item.item !== round) return;
        if (!grid || gi.item.count < grid.items[index]!.item.count) {
          grid = gr;
          index = i;
        }
      });
    }
    if (!grid) break;
    const stack = (grid as Grid).items[index]!.item;
    const k = Math.min(n - took, stack.count);
    stack.count -= k;
    took += k;
    if (stack.count === 0) (grid as Grid).items.splice(index, 1);
  }
  return took;
}

/** Moves up to n rounds into Pack Mags' next magazine; how many it moved. */
function packSome(c: Character, items: ItemDb, n: number): number {
  const t = packTarget(c, items);
  if (!t) return 0;
  const m = magOf(items, t.mag, scratch)!;
  const k = takeLoose(c, t.round, Math.min(n, m.capacity - m.n));
  if (k > 0) setMag(items, t.mag, m.n + k, t.round);
  return k;
}

/** Packs every magazine in pockets and rig at once (between raids); whether any went in. */
export function packAll(c: Character, items: ItemDb): boolean {
  let any = false;
  while (packSome(c, items, Infinity) > 0) any = true;
  return any;
}

// ------------------------------------------------------------------------------ the job

/** Starts Pack Mags in a raid; refused (false) with nothing to pack. */
export function startPack(c: Character, items: ItemDb): boolean {
  const total = packable(c, items);
  if (total <= 0) return false;
  begin(c, { kind: 'pack', next: PACKING.perRound, done: 0, total });
  return true;
}

/** Starts loading a magazine (loose or in a gun) from a stack, a round at a time. */
export function startLoad(
  state: SimState,
  c: Character,
  items: ItemDb,
  mag: ItemRef,
  from: ItemRef,
): boolean {
  const item = reachableItem(state, c, mag);
  const stack = reachableItem(state, c, from);
  const m = item && magOf(items, item, scratch);
  if (!m || !stack || loadKind(state, c, items, mag, from, false) !== 'load') return false;
  const total = Math.min(m.capacity - m.n, stack.count);
  if (total <= 0) return false;
  begin(c, { kind: 'load', mag, from, next: PACKING.perRound, done: 0, total });
  return true;
}

/** Starts unloading a magazine (loose or in a gun), a round at a time. */
export function startUnload(state: SimState, c: Character, items: ItemDb, mag: ItemRef): boolean {
  const item = reachableItem(state, c, mag);
  const m = item && magOf(items, item, scratch);
  if (!m || m.n <= 0) return false;
  begin(c, { kind: 'unload', mag, next: PACKING.unloadPerRound, done: 0, total: m.n });
  return true;
}

/** Whether `item` is a magazine, loose or in a magazine-fed gun, that unload times. */
export function holdsMagazine(items: ItemDb, item: Item): boolean {
  return magOf(items, item, scratch) !== null;
}

function begin(c: Character, p: Packing): void {
  // Both hands: a med or repair stops, and so does a reload of the gun in hand.
  c.using = null;
  const w = heldWeapon(c);
  if (w) w.reloading = 0;
  c.packing = p;
}

/** Stops packing, keeping what's done. */
export function stopPacking(c: Character): void {
  delete c.packing;
}

/**
 * One tick of packing: firing, aiming, reloading, a throw, drawing, a med, a ladder or a
 * vault, or putting yourself out stops it; walking and sprinting don't. Each round's time up, one round
 * moves; it ends when there's nothing left to move (or what it was on is gone).
 */
export function updatePacking(
  state: SimState,
  c: Character,
  items: ItemDb,
  input: PlayerInput | undefined,
  world?: CollisionWorld,
): void {
  const p = c.packing;
  if (!p) return;
  const stop =
    c.health.dead ||
    !!c.extinguish ||
    !!c.using ||
    c.mode === 'ladder' ||
    c.mode === 'vault' ||
    !!input?.fire ||
    !!input?.aim ||
    !!input?.reload ||
    !!input?.quickReload ||
    !!input?.throw ||
    !!input?.draw;
  if (stop) return stopPacking(c);
  p.next -= TICK_SECONDS;
  if (p.next > 1e-9) return;
  if (!moveOne(state, c, items, p, world)) return stopPacking(c);
  p.done++;
  p.next += p.kind === 'unload' ? PACKING.unloadPerRound : PACKING.perRound;
  if (p.kind === 'pack' && p.done >= p.total) {
    // More may have turned up (picked up meanwhile).
    p.total = p.done + packable(c, items);
  }
  if (p.done >= p.total) stopPacking(c);
}

/** Moves one round for the job; false if it can't (the job ends). */
function moveOne(
  state: SimState,
  c: Character,
  items: ItemDb,
  p: Packing,
  world: CollisionWorld | undefined,
): boolean {
  if (p.kind === 'pack') return packSome(c, items, 1) > 0;
  const item = reachableItem(state, c, p.mag!);
  const m = item && magOf(items, item, scratch);
  if (!m) return false;
  if (p.kind === 'unload') {
    if (m.n <= 0 || !m.round) return false;
    const round = m.round;
    setMag(items, item, m.n - 1, round);
    if (item.attachments && item === heldWeapon(c)) (item as WeaponState).reloading = 0;
    stowRoundsFor(state, c, items, world, round, 1);
    return true;
  }
  if (loadKind(state, c, items, p.mag!, p.from!, false) !== 'load') return false;
  const stack = reachableItem(state, c, p.from!)!;
  const round = stack.item;
  if (!takeRounds(state, c, p.from!, 1)) return false;
  setMag(items, item, m.n + 1, round);
  return true;
}
