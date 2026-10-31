import { burnOf, fireTimeOf, type AmmoDef, type ItemDb } from '../content/items';
import { TICK_SECONDS } from '../tick';
import { createRayHit, type CollisionWorld } from '../world/collision-world';
import { heldWeapon } from './gear';
import { ZONE_COUNT, dealDamage, type Zone } from './health';
import { createCharacterHit, raycastCharacters } from './hit-zones';
import { MOVEMENT } from './movement';
import {
  entityById,
  eyeHeight,
  type Character,
  type EntityId,
  type PlayerInput,
  type SimState,
} from './state';

/*
 * Fire (2026-10-31, the user's design). A flamethrower's shot is a blob of flame that
 * flies out to the gun's range, dropping a little. It sets alight whoever it hits; on the
 * map it leaves a patch of fire burning for its fuel's fireTime, and anyone touching that
 * is set alight too. Someone alight loses burnDamage HP a second from every zone, past
 * armour, until it burns out (burnTime) or they put themselves out (FIRE.extinguishTime),
 * which is quicker but stops them fighting meanwhile. Each fuel's numbers are in its item
 * file (AmmoDef.flame). A molotov (2026-10-31) spills fire across its radius where it
 * breaks (spillFire), and incendiary rounds may set alight whoever they hit (sim/weapons.ts).
 */

/** Fire tuning; each fuel's speed, burn and how long it burns on the map are its own. */
export const FIRE = {
  /** Flames fall this fast (m/s²), so a long shot drops a little. */
  gravity: 3,
  /** A blob leaves this far in front of the eye (or short of a wall). */
  nozzle: 0.5,
  /** Put back this far out from the surface it hit, so it burns on it, not in it. */
  surface: 0.05,
  /** Fire on the map reaches this far from where it landed, in metres. */
  patchRadius: 0.5,
  /** A flame landing this close to fire already burning feeds it rather than starting more. */
  merge: 0.6,
  /** At most this many patches burn at once; the one nearest burning out goes to make room. */
  maxPatches: 48,
  /** Putting yourself out takes this long: quicker than burning out, and you can't fight. */
  extinguishTime: 3,
  /** Enemies plan their paths around fire as if each step through it were this many metres. */
  avoidCost: 30,
  /** A molotov's fire: the middle, then rings at these shares of its radius, this many each. */
  spillRings: [0.5, 0.95],
  spillPer: [5, 8],
  /** Fire spills onto a floor this far below where it broke, at most. */
  spillDrop: 3,
} as const;

/** A blob of flame in flight. */
export interface Flame {
  id: number;
  /** The fuel's item id. */
  item: string;
  /** Who fired it, credited with what it does. */
  by: EntityId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Metres left before it burns out in the air. */
  left: number;
}

/** Fire burning where a flame landed on the map, or a molotov spilled it. */
export interface FirePatch {
  id: number;
  /** What lit it, by item id: the fuel, or the molotov. */
  item: string;
  /** Who fired the flame that lit it (the last to feed it). */
  by: EntityId;
  x: number;
  y: number;
  z: number;
  /** Seconds since it was lit or last fed, and how long it burns in all. */
  age: number;
  time: number;
}

/** A character on fire: Character.burn. */
export interface Burn {
  /** Seconds before it burns out. */
  left: number;
  /** Who set it alight, credited with what it does. */
  by: EntityId;
  /** What lit it, by item id (fuel, an incendiary round, a molotov), for its burnDamage. */
  item: string;
}

/** Someone set alight this tick (not one already burning, lit again). */
export interface IgniteEvent {
  type: 'ignite';
  target: EntityId;
  by: EntityId;
  x: number;
  y: number;
  z: number;
}

// Scratch, so moving flames allocates nothing.
const hit = createRayHit();
const charHit = createCharacterHit();

/**
 * Sends a blob of flame from c's eye along yaw and pitch, at the fuel's speed plus c's
 * own, to burn out after range metres: a flamethrower's shot (sim/weapons.ts). It starts
 * a nozzle's length out, or short of a wall. Returns it, already in state.flames.
 */
export function launchFlame(
  state: SimState,
  c: Character,
  world: CollisionWorld,
  def: AmmoDef,
  yaw: number,
  pitch: number,
  range: number,
): Flame {
  const cp = Math.cos(pitch);
  const dx = -Math.sin(yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * cp;
  const ox = c.x;
  const oy = eyeHeight(c);
  const oz = c.z;
  const wall = world.raycast(ox, oy, oz, dx, dy, dz, FIRE.nozzle + FIRE.surface);
  const out = Math.max(0, Math.min(FIRE.nozzle, wall - FIRE.surface));
  const speed = def.flame?.speed ?? 1;
  const f: Flame = {
    id: state.nextId++,
    item: def.id,
    by: c.id,
    x: ox + dx * out,
    y: oy + dy * out,
    z: oz + dz * out,
    vx: dx * speed + c.vx,
    vy: dy * speed + c.vy,
    vz: dz * speed + c.vz,
    left: range - out,
  };
  state.flames.push(f);
  return f;
}

/**
 * Sets c alight with an item that burns (burnOf), as by: burning for its burnTime from
 * now, or on for longer if already burning. Only a new fire is an event. Not the dead.
 */
export function ignite(
  state: SimState,
  c: Character,
  items: ItemDb,
  id: string,
  by: EntityId,
): void {
  if (c.health.dead) return;
  const time = burnOf(items, id)?.burnTime ?? 0;
  if (c.burn) {
    c.burn.left = Math.max(c.burn.left, time);
    c.burn.by = by;
    c.burn.item = id;
    return;
  }
  c.burn = { left: time, by, item: id };
  state.events.push({ type: 'ignite', target: c.id, by, x: c.x, y: c.y, z: c.z });
}

/**
 * One tick of putting yourself out, with switching hands and meds: a press while on fire
 * starts it, stopping a reload or med; when its time is up the fire is out. It stops
 * early if the fire burns out first.
 */
export function updateExtinguish(c: Character, input: PlayerInput | undefined): void {
  if (!c.burn || c.health.dead) {
    if (c.extinguish) c.extinguish = 0;
    return;
  }
  if (input?.extinguish && !c.extinguish) {
    c.extinguish = FIRE.extinguishTime;
    c.using = null;
    const w = heldWeapon(c);
    if (w) w.reloading = 0;
    return;
  }
  if (!c.extinguish) return;
  c.extinguish = Math.max(0, c.extinguish - TICK_SECONDS);
  if (c.extinguish > 1e-9) return;
  c.extinguish = 0;
  c.burn = null;
}

/**
 * One tick of fire, after everyone has shot: flames fly and land, fire on the map burns
 * down and sets alight whoever touches it, and everyone alight burns. Those burnt out are
 * removed, keeping the rest in order.
 */
export function updateFire(state: SimState, world: CollisionWorld, items: ItemDb): void {
  const flames = state.flames;
  let kept = 0;
  for (let i = 0; i < flames.length; i++) {
    const f = flames[i]!;
    if (moveFlame(state, f, world, items)) flames[kept++] = f;
  }
  flames.length = kept;

  const fires = state.fires;
  kept = 0;
  for (let i = 0; i < fires.length; i++) {
    const p = fires[i]!;
    p.age += TICK_SECONDS;
    if (p.age < p.time) fires[kept++] = p;
  }
  fires.length = kept;

  const reach = FIRE.patchRadius + MOVEMENT.radius;
  for (const c of state.entities) {
    if (c.health.dead) {
      if (c.burn) c.burn = null;
      continue;
    }
    for (const p of fires) {
      if (touches(c, p, reach)) {
        ignite(state, c, items, p.item, p.by);
        break;
      }
    }
    burn(state, c, items);
  }
}

/** Whether fire at p is within reach of c's body: a vertical line from its feet to its top. */
function touches(c: Character, p: FirePatch, reach: number): boolean {
  const y = Math.min(c.y + c.height, Math.max(c.y, p.y));
  const dx = p.x - c.x;
  const dy = p.y - y;
  const dz = p.z - c.z;
  return dx * dx + dy * dy + dz * dz < reach * reach;
}

/** Whether c is touching any fire on the map (enemies step out of it). */
export function inFire(state: SimState, c: Character): FirePatch | null {
  const reach = FIRE.patchRadius + MOVEMENT.radius;
  for (const p of state.fires) if (touches(c, p, reach)) return p;
  return null;
}

/** One tick of burning: burnDamage from every zone, until it burns out. */
function burn(state: SimState, c: Character, items: ItemDb): void {
  const b = c.burn;
  if (!b) return;
  const each = (burnOf(items, b.item)?.burnDamage ?? 0) * TICK_SECONDS;
  for (let zone = 0; zone < ZONE_COUNT && !c.health.dead; zone++) {
    dealDamage(state, c, zone as Zone, each, b.by);
  }
  b.left -= TICK_SECONDS;
  if (b.left <= 1e-9 || c.health.dead) {
    c.burn = null;
    c.extinguish = 0;
  }
}

/**
 * A flame's tick: falling a little, then flying in a straight line until it hits someone
 * (not who fired it), who is set alight, or the map, where it leaves fire. Returns false
 * once it's gone: landed, or out of range.
 */
function moveFlame(state: SimState, f: Flame, world: CollisionWorld, items: ItemDb): boolean {
  f.vy -= FIRE.gravity * TICK_SECONDS;
  const speed = Math.hypot(f.vx, f.vy, f.vz);
  if (speed < 1e-6) return false;
  const dx = f.vx / speed;
  const dy = f.vy / speed;
  const dz = f.vz / speed;
  const travel = Math.min(f.left, speed * TICK_SECONDS);
  const d = world.raycast(f.x, f.y, f.z, dx, dy, dz, travel, hit);
  const cd = raycastCharacters(
    state,
    f.x,
    f.y,
    f.z,
    dx,
    dy,
    dz,
    Math.min(d, travel),
    f.by,
    charHit,
  );
  if (cd < Infinity) {
    const target = entityById(state, charHit.id);
    if (target) ignite(state, target, items, f.item, f.by);
    return false;
  }
  if (d < Infinity) {
    const s = FIRE.surface;
    light(
      state,
      items,
      f.item,
      f.by,
      f.x + dx * d + hit.nx * s,
      f.y + dy * d + hit.ny * s,
      f.z + dz * d + hit.nz * s,
    );
    return false;
  }
  f.x += dx * travel;
  f.y += dy * travel;
  f.z += dz * travel;
  f.left -= travel;
  return f.left > 1e-6;
}

/**
 * Fire on the map at (x, y, z): feeds a patch already burning within FIRE.merge (it
 * burns its full time again), or lights a new one, putting out the one nearest burning out
 * if there are FIRE.maxPatches already.
 */
function light(
  state: SimState,
  items: ItemDb,
  item: string,
  by: EntityId,
  x: number,
  y: number,
  z: number,
): void {
  const time = fireTimeOf(items, item);
  const fires = state.fires;
  const m2 = FIRE.merge * FIRE.merge;
  let oldest = 0;
  for (let i = 0; i < fires.length; i++) {
    const p = fires[i]!;
    const dx = p.x - x;
    const dy = p.y - y;
    const dz = p.z - z;
    if (dx * dx + dy * dy + dz * dz < m2) {
      p.age = 0;
      p.time = time;
      p.by = by;
      p.item = item;
      return;
    }
    if (p.age - p.time > fires[oldest]!.age - fires[oldest]!.time) oldest = i;
  }
  const p: FirePatch = { id: state.nextId++, item, by, x, y, z, age: 0, time };
  if (fires.length >= FIRE.maxPatches) fires[oldest] = p;
  else fires.push(p);
}

/**
 * A molotov breaking at (x, y, z): fire spills onto the floor under the middle and onto
 * rings around it out to radius (FIRE.spillRings), each spot on the floor below it within
 * FIRE.spillDrop, and only where nothing stands between it and the middle, so it doesn't
 * spill through a wall. Whoever stands in it is set alight as fire on the map does.
 */
export function spillFire(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  item: string,
  by: EntityId,
  x: number,
  y: number,
  z: number,
  radius: number,
): void {
  spillAt(state, world, items, item, by, x, y, z);
  for (let r = 0; r < FIRE.spillRings.length; r++) {
    const d = FIRE.spillRings[r]! * radius;
    const n = FIRE.spillPer[r]!;
    for (let k = 0; k < n; k++) {
      // Each ring turned a little from the last, so the spots don't line up.
      const a = ((k + r * 0.5) / n) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      // Not through a wall: along the way out, a little above where it broke.
      const oy = y + 0.2;
      if (world.raycast(x, oy, z, dx, 0, dz, d) < d) continue;
      spillAt(state, world, items, item, by, x + dx * d, oy, z + dz * d);
    }
  }
}

/** Fire on the floor under (x, y, z), if there's one within FIRE.spillDrop. */
function spillAt(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  item: string,
  by: EntityId,
  x: number,
  y: number,
  z: number,
): void {
  const top = y + 0.3;
  const d = world.raycast(x, top, z, 0, -1, 0, FIRE.spillDrop, hit);
  if (d === Infinity) return;
  light(state, items, item, by, x, top - d + FIRE.surface, z);
}
