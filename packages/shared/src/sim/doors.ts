import { itemDef, type ItemDb } from '../content/items';
import { removeAt, type Grid } from '../inventory/grid';
import type { NavGrid } from '../nav/nav-grid';
import type { CollisionWorld, DoorDef } from '../world/collision-world';
import { CARRIED_GRIDS, carriedGrid, type Gear } from './gear';
import { MOVEMENT } from './movement';
import type { Character, EntityId, SimState } from './state';

/*
 * Doors (design.md → AI → Doors). A door is open or closed with nothing in between, and
 * solid either way: closed it fills the doorway, open it stands at 90° from its hinge.
 * It swings away from whoever opens it: inwards from outside, outwards from inside.
 * Its collision snaps at once; the renderer animates the swing. A door with a key starts
 * locked, and unlocking it (which uses up one of the key's uses) is for the rest of the
 * raid. Enemies open closed, unlocked doors in their way, and never close or unlock one.
 * In zombies mode a door can have a cost instead of a key: bought with points, it's gone,
 * leaving the opening.
 */

/** Door tuning, in metres. */
export const DOOR = {
  /** How far your feet can be from a door to use it: across, and up or down. */
  reach: 2,
  /** An enemy opens a door in its way once it's this close to it. */
  aiReach: 1.2,
} as const;

/** One door's state. world.doors[i] is its static data. */
export interface DoorState {
  open: boolean;
  /**
   * Opens (or last opened) into the door's −z, away from someone who opened it from +z.
   * Missing in states saved before doors swung both ways.
   */
  flipped?: boolean;
  /** Has a key and hasn't been unlocked yet. Never true while open. */
  locked: boolean;
  /** Seconds until a switch opens it, while its timer runs (2026-11-05). */
  opening?: number;
  /** The whole of that timer, so what's drawn can show how far along it is. */
  openingFor?: number;
  /** The sound file to play as that timer ends. */
  openSound?: string | undefined;
  /**
   * Bought (zombies mode): taken out of its doorway for good, leaving the opening. It's
   * then open too. Missing (older saves) is false.
   */
  gone?: boolean;
}

/**
 * What using a door did. locked: it's locked and you have no key (or you're an enemy).
 * blocked: someone stands in the doorway, so it can't close. bought: a door with a cost,
 * paid for; poor: not enough points for it (zombies mode). kicked: opened by Jug kicking it
 * in (AI-8), loud.
 */
export type DoorResult =
  'opened' | 'closed' | 'unlocked' | 'locked' | 'blocked' | 'bought' | 'poor' | 'kicked';

export interface DoorEvent {
  type: 'door';
  by: EntityId;
  door: number;
  result: DoorResult;
}

/** The doors as a map starts: a door with a key or a cost is locked unless it starts open. */
export function createDoors(world: CollisionWorld): DoorState[] {
  return world.doors.map((d) => ({
    open: d.open,
    flipped: false,
    locked: (d.key !== undefined || d.cost !== undefined || !!d.switched) && !d.open,
  }));
}

/**
 * Brings the collision world and nav grid in line with the state's doors, filling in the
 * doors of a state that has none yet. Cheap when nothing changed; an unlock renumbers the
 * nav grid's components (about 11 ms on the Mac). Called at the start of every step, and
 * once after loading so that first unlock-free renumbering isn't in a frame.
 */
export function syncDoors(state: SimState, world: CollisionWorld, nav?: NavGrid): void {
  if (state.doors.length !== world.doors.length) state.doors = createDoors(world);
  for (let i = 0; i < state.doors.length; i++) {
    const d = state.doors[i]!;
    const flipped = !!d.flipped;
    if (world.isDoorOpen(i) !== d.open || world.isDoorFlipped(i) !== flipped)
      world.setDoorOpen(i, d.open, flipped);
    if (world.isDoorGone(i) !== !!d.gone) world.setDoorGone(i, !!d.gone);
    nav?.setDoorLocked(i, d.locked);
  }
  nav?.updateComponents();
}

/** Can c reach door i to use it? Measured to its doorway or its open slab, whichever's nearer. */
export function doorInReach(world: CollisionWorld, c: Character, i: number): boolean {
  const d = world.doors[i];
  if (!d || Math.abs(c.y - d.y) > DOOR.reach) return false;
  const closed = world.doorDistance(i, false, c.x, c.z);
  return Math.min(closed, world.doorDistance(i, true, c.x, c.z)) <= DOOR.reach;
}

/**
 * Where a carried key for a door is (pockets, rig, backpack, then the vault), as the grid
 * and index; the one with the fewest uses left, so worn keys get used up first. Null if
 * none.
 */
export function findKey(gear: Gear, key: string): { grid: Grid; index: number } | null {
  let best: { grid: Grid; index: number } | null = null;
  let bestLeft = Infinity;
  for (let g = 0; g <= CARRIED_GRIDS; g++) {
    const grid = g < CARRIED_GRIDS ? carriedGrid(gear, g) : gear.vault;
    if (!grid) continue;
    for (let i = 0; i < grid.items.length; i++) {
      const it = grid.items[i]!.item;
      if (it.item !== key) continue;
      const left = it.left ?? Infinity;
      if (!best || left < bestLeft) {
        best = { grid, index: i };
        bestLeft = left;
      }
    }
  }
  return best;
}

/**
 * Opens, closes or unlocks door i for c, if it's in reach, and says what happened in an
 * event. A locked door with its key carried unlocks and opens in one go, using one of the
 * key's uses (gone at 0). A door with a cost is bought with the player's zombies points
 * instead, and opens in one go too. A door won't close on anyone standing in the doorway;
 * opening one into someone just pushes them aside as they next move. Enemies only ever open.
 */
export function useDoor(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  c: Character,
  i: number,
  kick = false,
): void {
  const d = state.doors[i];
  if (!d || d.gone || c.health.dead || !doorInReach(world, c, i)) return;
  let result: DoorResult;
  const cost = world.doors[i]!.cost;
  const zombies = state.zombies;
  if (d.locked && cost !== undefined) {
    const have = zombies ? (zombies.points[c.id] ?? zombies.rules.points.start) : 0;
    const free = !!c.admin?.infinitePoints;
    if (c.ai || !zombies) result = 'locked';
    else if (have < cost && !free) result = 'poor';
    else {
      if (!free) zombies.points[c.id] = have - cost;
      d.locked = false;
      d.gone = true;
      result = 'bought';
    }
  } else if (d.locked && world.doors[i]!.key === undefined) {
    // Only its switch opens it.
    result = 'locked';
  } else if (d.locked) {
    const key = c.ai ? null : findKey(c.gear, world.doors[i]!.key!);
    if (!key) result = 'locked';
    else {
      const it = key.grid.items[key.index]!.item;
      if (it.left !== undefined && --it.left <= 0) removeAt(key.grid, key.index);
      d.locked = false;
      result = 'unlocked';
    }
  } else if (d.open) {
    if (c.ai) return;
    result = inDoorway(state, world, i) ? 'blocked' : 'closed';
  } else result = kick ? 'kicked' : 'opened';
  if (result === 'opened' || result === 'kicked' || result === 'unlocked' || result === 'bought') {
    d.open = true;
    d.flipped = onPlusSide(world.doors[i]!, c);
  } else if (result === 'closed') d.open = false;
  world.setDoorOpen(i, d.open, !!d.flipped);
  if (d.gone) world.setDoorGone(i, true);
  state.events.push({ type: 'door', by: c.id, door: i, result });
}

/** Is c on the door's +z side? It then opens into −z, away from them. */
function onPlusSide(d: DoorDef, c: Character): boolean {
  return Math.sin(d.yaw) * (c.x - d.x) + Math.cos(d.yaw) * (c.z - d.z) > 0;
}

/** Is anyone (alive) standing where door i would be closed? */
function inDoorway(state: SimState, world: CollisionWorld, i: number): boolean {
  const d = world.doors[i]!;
  for (const e of state.entities) {
    if (e.health.dead || e.y >= d.y + d.height || e.y + e.height <= d.y) continue;
    if (world.doorDistance(i, false, e.x, e.z) < MOVEMENT.radius) return true;
  }
  return false;
}

/**
 * An enemy walking from where it is towards (x, z) opens the first closed, unlocked door
 * whose doorway that line crosses, once it's close (DOOR.aiReach). Given a kick reach
 * (Jug, AI-8), it kicks it open from that far instead.
 */
export function openDoorAhead(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  c: Character,
  x: number,
  z: number,
  kick?: number,
): void {
  const reach = kick ?? DOOR.aiReach;
  for (let i = 0; i < state.doors.length; i++) {
    const s = state.doors[i]!;
    if (s.open || s.locked) continue;
    const d = world.doors[i]!;
    if (Math.abs(c.y - d.y) > MOVEMENT.stepUp) continue;
    if (world.doorDistance(i, false, c.x, c.z) > reach) continue;
    // Both ends in the door's frame: does the line cross its plane within its width?
    const cs = Math.cos(d.yaw);
    const sn = Math.sin(d.yaw);
    const ax = cs * (c.x - d.x) - sn * (c.z - d.z);
    const az = sn * (c.x - d.x) + cs * (c.z - d.z);
    const bx = cs * (x - d.x) - sn * (z - d.z);
    const bz = sn * (x - d.x) + cs * (z - d.z);
    if (az > 0 === bz > 0) continue;
    const t = az / (az - bz);
    if (Math.abs(ax + (bx - ax) * t) > d.width / 2 + MOVEMENT.radius) continue;
    useDoor(state, world, items, c, i, kick !== undefined);
    return;
  }
}

/** The name of the key a door needs, or null if it has none. */
export function keyName(items: ItemDb, world: CollisionWorld, i: number): string | null {
  const key = world.doors[i]?.key;
  return key === undefined ? null : itemDef(items, key).name;
}
