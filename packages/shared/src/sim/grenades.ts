import { grenadeDef, grenadeEffect, type GrenadeDef, type ItemDb } from '../content/items';
import { removeAt } from '../inventory/grid';
import { TICK_SECONDS } from '../tick';
import { createRayHit, type CollisionWorld } from '../world/collision-world';
import { CARRIED_GRIDS, carriedGrid, heldWeapon } from './gear';
import { ZONE_COUNT, woundZone, type Zone } from './health';
import { createCharacterHit, raycastCharacters } from './hit-zones';
import type { CarriedRef } from './meds';
import { eyeHeight, type Character, type EntityId, type PlayerInput, type SimState } from './state';

const DEG = Math.PI / 180;

/** Grenade tuning; each grenade's fuse, damage and radius are in its item file. */
export const GRENADE = {
  /** Its size, for bouncing: it stops this far from what it hits. */
  size: 0.06,
  /** Lighter than the characters' (MOVEMENT.gravity), so a throw carries. */
  gravity: 14,
  /** Of the speed into a surface, the share it bounces back with. */
  restitution: 0.4,
  /** Of the speed along a surface, the share kept by each touch of it. */
  friction: 0.7,
  /** On a floor (a surface facing up this much) slower than this, it stops. */
  restSpeed: 1.2,
  floor: 0.7,
  /** Hitting something faster than this (m/s) makes a sound. */
  bounceSound: 2,
  /** A throw (or launch) goes this far above the crosshair, so a level one carries. */
  loft: 8 * DEG,
  /** It leaves the hand this far in front of the eye (or short of a wall). */
  hand: 0.4,
  /** Seconds between throws. */
  cooldown: 0.8,
  /** Full damage out to this share of the radius, then falling off to nothing at it. */
  inner: 0.25,
  /** Each zone's share of the damage at the chest, by zone (the blast hits them all). */
  zones: [0.6, 1, 0.8, 0.8, 0.9, 0.9],
  /** The blast comes from this far above where it lies, so the floor doesn't hide it. */
  lift: 0.15,
  /** A flash blinds those looking within this angle of it (2026-10-31). */
  flashAngle: 60 * DEG,
  /**
   * Of a flash's blindTime, the share at the edge of its radius; it rises to all of it
   * inside GRENADE.inner of the radius.
   */
  blindFloor: 0.3,
  /** A player's white screen fades out over the last this many seconds of being blind. */
  blindFade: 1.5,
  /** A smoke cloud grows to its radius over this many seconds... */
  smokeGrow: 2,
  /** ...and shrinks away over its last this many. */
  smokeFade: 3,
  /** Its middle is this far above where the grenade went off, so it hides someone standing. */
  smokeLift: 1.2,
  /** Sight through a cloud is blocked within this share of its radius (its edge is thin). */
  smokeSight: 0.85,
} as const;

/** A grenade in flight or lying where it stopped, until its fuse runs out. */
export interface Grenade {
  id: number;
  /** Its item id. */
  item: string;
  /** Who threw it, credited with what it does. */
  by: EntityId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds until it goes off. */
  fuse: number;
  /** Lying still on a floor. */
  resting: boolean;
  /**
   * Launched with an impact fuse: metres left to fly before it's armed, then it goes off
   * on the first thing it hits, the map or someone. Missing for a thrown one, and once it
   * has hit the map before arming (then only its fuse sets it off).
   */
  armIn?: number;
  /**
   * C4 (2026-10-31): stuck where it first hit and waiting for its thrower's detonator, its
   * fuse not running. Missing once detonated, and for every other grenade.
   */
  remote?: boolean;
}

/**
 * A smoke grenade's cloud (2026-10-31): a sphere enemies can't see through, growing to its
 * radius and shrinking away at the end (smokeRadius).
 */
export interface Smoke {
  /** The grenade's id. */
  id: number;
  /** Its middle. */
  x: number;
  y: number;
  z: number;
  /** Its full radius, in metres. */
  radius: number;
  /** Seconds since it went off, and how long it lasts in all. */
  age: number;
  time: number;
}

/** A grenade leaving someone's hand this tick. */
export interface ThrowEvent {
  type: 'throw';
  by: EntityId;
  grenade: number;
  item: string;
}

/** A grenade hitting the map hard enough to hear. */
export interface BounceEvent {
  type: 'bounce';
  grenade: number;
  item: string;
  x: number;
  y: number;
  z: number;
  /** How fast it hit, in m/s. */
  speed: number;
}

/** A grenade going off. Damage comes as damage events, cause 'explosion'. */
export interface ExplosionEvent {
  type: 'explosion';
  /** Who threw it. */
  by: EntityId;
  item: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** How far away it can be heard, in metres. */
  loudness: number;
}

// Scratch, so moving grenades allocates nothing.
const hit = createRayHit();
const charHit = createCharacterHit();

/**
 * The first grenade carried (pockets, rig, then backpack), or null. With an item id, the
 * first of those, or the first of any if none of it is carried.
 */
export function carriedGrenade(c: Character, items: ItemDb, id?: string | null): CarriedRef | null {
  let any: CarriedRef | null = null;
  for (let g = 0; g < CARRIED_GRIDS; g++) {
    const list = carriedGrid(c.gear, g)?.items;
    if (!list) continue;
    for (let index = 0; index < list.length; index++) {
      const item = list[index]!.item.item;
      if (items.get(item)?.type !== 'grenade') continue;
      if (!id || item === id) return { grid: g, index };
      any ??= { grid: g, index };
    }
  }
  return any;
}

/** How many grenades are carried, for the HUD; with an item id, how many of those. */
export function carriedGrenades(c: Character, items: ItemDb, id?: string | null): number {
  let n = 0;
  for (let g = 0; g < CARRIED_GRIDS; g++) {
    for (const gi of carriedGrid(c.gear, g)?.items ?? []) {
      if (id ? gi.item.item === id : items.get(gi.item.item)?.type === 'grenade') n++;
    }
  }
  return n;
}

/**
 * One tick of throwing: a press throws the grenade picked (input.grenade), or the first
 * carried, along the look (with recoil, lofted a little), adding the thrower's own speed.
 * Not on a ladder or vaulting, while taking something out, or straight after the last
 * throw. It stops a reload or a med. The infinite consumables cheat keeps the grenade.
 * The detonator works whatever else it's doing.
 */
export function updateThrow(
  state: SimState,
  c: Character,
  input: PlayerInput | undefined,
  world: CollisionWorld,
  items: ItemDb,
): void {
  if (c.throwCooldown) c.throwCooldown = Math.max(0, c.throwCooldown - TICK_SECONDS);
  if (input?.detonate && !c.health.dead) detonate(state, c);
  if (
    !input?.throw ||
    c.health.dead ||
    c.draw > 0 ||
    (c.throwCooldown ?? 0) > 0 ||
    c.mode === 'ladder' ||
    c.mode === 'vault'
  )
    return;
  const ref = carriedGrenade(c, items, input.grenade);
  if (!ref) return;
  const grid = carriedGrid(c.gear, ref.grid)!;
  const id = grid.items[ref.index]!.item.item;
  const def = grenadeDef(items, id);
  if (!c.admin?.infiniteConsumables) removeAt(grid, ref.index);
  c.throwCooldown = GRENADE.cooldown;
  c.using = null;
  const w = heldWeapon(c);
  if (w) w.reloading = 0;

  const g = launchGrenade(
    state,
    c,
    world,
    def,
    c.yaw + c.recoilYaw,
    c.pitch + c.recoilPitch,
    def.throwSpeed,
  );
  state.events.push({ type: 'throw', by: c.id, grenade: g.id, item: id });
}

/** Sets off every C4 c has placed: each goes off its fuse from now. */
function detonate(state: SimState, c: Character): void {
  for (const g of state.grenades) if (g.by === c.id && g.remote) delete g.remote;
}

/**
 * Sets a grenade off from c's eye along yaw and pitch, lofted GRENADE.loft, at speed plus
 * c's own: a throw, or a launcher's shot (sim/weapons.ts). It starts a hand's length out,
 * or short of a wall. With armIn, it has an impact fuse armed after that many metres.
 * Returns it, already in state.grenades.
 */
export function launchGrenade(
  state: SimState,
  c: Character,
  world: CollisionWorld,
  def: GrenadeDef,
  yaw: number,
  pitch: number,
  speed: number,
  armIn?: number,
): Grenade {
  const p = Math.min(Math.PI / 2, pitch + GRENADE.loft);
  const cp = Math.cos(p);
  const dx = -Math.sin(yaw) * cp;
  const dy = Math.sin(p);
  const dz = -Math.cos(yaw) * cp;
  const ox = c.x;
  const oy = eyeHeight(c);
  const oz = c.z;
  const wall = world.raycast(ox, oy, oz, dx, dy, dz, GRENADE.hand + GRENADE.size);
  const out = Math.max(0, Math.min(GRENADE.hand, wall - GRENADE.size));
  const g: Grenade = {
    id: state.nextId++,
    item: def.id,
    by: c.id,
    x: ox + dx * out,
    y: oy + dy * out,
    z: oz + dz * out,
    vx: dx * speed + c.vx,
    vy: dy * speed + Math.max(0, c.vy),
    vz: dz * speed + c.vz,
    fuse: def.fuse,
    resting: false,
  };
  if (armIn !== undefined) g.armIn = armIn;
  if (grenadeEffect(def) === 'c4') g.remote = true;
  state.grenades.push(g);
  return g;
}

/**
 * One tick of every grenade: each flies and bounces, and goes off when its fuse runs out
 * or, armed, when it hits something (explode). Placed C4's fuse waits for the detonator.
 * Those gone off are removed, keeping the rest in order. Smoke clouds age first, and
 * those that have cleared go.
 */
export function updateGrenades(state: SimState, world: CollisionWorld, items: ItemDb): void {
  const smokes = state.smokes;
  let left = 0;
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i]!;
    s.age += TICK_SECONDS;
    if (s.age < s.time) smokes[left++] = s;
  }
  smokes.length = left;

  const list = state.grenades;
  let kept = 0;
  for (let i = 0; i < list.length; i++) {
    const g = list[i]!;
    const struck = moveGrenade(state, g, world);
    if (!g.remote) g.fuse -= TICK_SECONDS;
    if (struck || g.fuse <= 1e-9) explode(state, world, items, g);
    else list[kept++] = g;
  }
  list.length = kept;
}

/**
 * Gravity, then the tick's flight as up to three straight legs: each ends where it hits
 * the map, bouncing off (restitution into the surface, friction along it). Slow on a
 * floor, it stops there, until the floor goes (a door swinging away). An armed impact fuse
 * stops it on the map or on someone (not who fired it) instead: returns true, there. C4
 * sticks to the first thing it hits, wall or floor, and stays.
 */
function moveGrenade(state: SimState, g: Grenade, world: CollisionWorld): boolean {
  const r = GRENADE.size;
  if (g.resting && g.remote) return false;
  if (g.resting) {
    if (world.raycast(g.x, g.y, g.z, 0, -1, 0, r + 0.05) < Infinity) return false;
    g.resting = false;
  }
  g.vy -= GRENADE.gravity * TICK_SECONDS;
  let left = TICK_SECONDS;
  for (let leg = 0; leg < 3 && left > 1e-6; leg++) {
    const speed = Math.hypot(g.vx, g.vy, g.vz);
    if (speed < 1e-6) break;
    const dx = g.vx / speed;
    const dy = g.vy / speed;
    const dz = g.vz / speed;
    const travel = speed * left;
    const d = world.raycast(g.x, g.y, g.z, dx, dy, dz, travel + r, hit);
    if (g.armIn !== undefined) {
      // Someone in the way once it's armed: it goes off on them. Before that it passes
      // through, as a thrown one does.
      const reach = Math.min(d, travel);
      const cd = raycastCharacters(state, g.x, g.y, g.z, dx, dy, dz, reach, g.by, charHit);
      if (cd < Infinity && g.armIn <= cd) {
        g.x += dx * cd;
        g.y += dy * cd;
        g.z += dz * cd;
        return true;
      }
    }
    if (d === Infinity) {
      g.x += dx * travel;
      g.y += dy * travel;
      g.z += dz * travel;
      if (g.armIn !== undefined) g.armIn = Math.max(0, g.armIn - travel);
      break;
    }
    // Where it touches: its size out from the surface, not back along its path, which on
    // a glancing hit would leave it in the floor.
    g.x += dx * d + hit.nx * r;
    g.y += dy * d + hit.ny * r;
    g.z += dz * d + hit.nz * r;
    left -= Math.max(0, d - r) / speed;
    if (g.armIn !== undefined) {
      // Armed, it goes off here; hitting something first, it never arms, so a shot off a
      // close wall bounces back as a thrown one would rather than going off at your feet.
      if (g.armIn <= d) return true;
      delete g.armIn;
    }
    if (g.remote) {
      g.vx = g.vy = g.vz = 0;
      g.resting = true;
      break;
    }
    const into = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz;
    if (into >= 0) break;
    // Split into along the surface and into it; keep some of one, bounce some of the other.
    const tx = g.vx - into * hit.nx;
    const ty = g.vy - into * hit.ny;
    const tz = g.vz - into * hit.nz;
    const back = -into * GRENADE.restitution;
    g.vx = tx * GRENADE.friction + hit.nx * back;
    g.vy = ty * GRENADE.friction + hit.ny * back;
    g.vz = tz * GRENADE.friction + hit.nz * back;
    if (-into > GRENADE.bounceSound) {
      state.events.push({
        type: 'bounce',
        grenade: g.id,
        item: g.item,
        x: g.x,
        y: g.y,
        z: g.z,
        speed: -into,
      });
    }
    if (hit.ny > GRENADE.floor && Math.hypot(g.vx, g.vy, g.vz) < GRENADE.restSpeed) {
      g.vx = g.vy = g.vz = 0;
      g.resting = true;
      break;
    }
  }
  return false;
}

/**
 * Goes off: its event, then by its effect: a flash blinds, a smoke leaves its cloud, and
 * otherwise every living character in reach takes its share of the damage.
 */
function explode(state: SimState, world: CollisionWorld, items: ItemDb, g: Grenade): void {
  const def = grenadeDef(items, g.item);
  const effect = grenadeEffect(def);
  const x = g.x;
  const y = g.y + GRENADE.lift;
  const z = g.z;
  state.events.push({
    type: 'explosion',
    by: g.by,
    item: g.item,
    x,
    y,
    z,
    radius: def.radius,
    loudness: def.loudness,
  });
  if (effect === 'flash') {
    flash(state, world, def, x, y, z);
    return;
  }
  if (effect === 'smoke') {
    const time = def.smokeTime ?? 0;
    state.smokes.push({
      id: g.id,
      x,
      y: g.y + GRENADE.smokeLift,
      z,
      radius: def.radius,
      age: 0,
      time,
    });
    return;
  }
  if (def.damage <= 0) return;
  for (const c of state.entities) {
    if (c.health.dead) continue;
    const f = blastShare(world, def, x, y, z, c);
    if (f <= 0) continue;
    for (let zone = 0; zone < ZONE_COUNT; zone++) {
      const damage = def.damage * f * GRENADE.zones[zone]!;
      woundZone(state, items, c, zone as Zone, damage, def, g.by, 'explosion');
    }
  }
}

/**
 * A flash at (x, y, z) blinds every living character within its radius that is looking
 * within GRENADE.flashAngle of it, with nothing (map or smoke) between it and their eye:
 * all of blindTime close, falling to blindFloor of it at the radius. A longer blindness
 * already running is kept.
 */
function flash(
  state: SimState,
  world: CollisionWorld,
  def: GrenadeDef,
  x: number,
  y: number,
  z: number,
): void {
  const facingMin = Math.cos(GRENADE.flashAngle);
  const inner = def.radius * GRENADE.inner;
  for (const c of state.entities) {
    if (c.health.dead) continue;
    const ey = eyeHeight(c);
    const dx = x - c.x;
    const dy = y - ey;
    const dz = z - c.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= def.radius) continue;
    if (d > 1e-6) {
      const yaw = c.yaw + c.recoilYaw;
      const pitch = c.pitch + c.recoilPitch;
      const cp = Math.cos(pitch);
      const facing =
        (-Math.sin(yaw) * cp * dx + Math.sin(pitch) * dy - Math.cos(yaw) * cp * dz) / d;
      if (facing < facingMin) continue;
    }
    if (!clear(world, x, y, z, c.x, ey, c.z)) continue;
    if (smokeBlocks(state.smokes, x, y, z, c.x, ey, c.z)) continue;
    const f = d <= inner ? 1 : 1 - (d - inner) / (def.radius - inner);
    const time = (def.blindTime ?? 0) * (GRENADE.blindFloor + (1 - GRENADE.blindFloor) * f);
    c.blind = Math.max(c.blind ?? 0, time);
  }
}

/** A smoke cloud's radius now: growing at first, shrinking away at the end. */
export function smokeRadius(s: Smoke): number {
  const grow = 0.15 + 0.85 * Math.min(1, s.age / GRENADE.smokeGrow);
  const fade = Math.min(1, Math.max(0, s.time - s.age) / GRENADE.smokeFade);
  return s.radius * grow * fade;
}

/** Whether a smoke cloud hides b from a: the line between them passes through one. */
export function smokeBlocks(
  smokes: readonly Smoke[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i]!;
    const r = smokeRadius(s) * GRENADE.smokeSight;
    // The point of the line nearest the cloud's middle.
    const t =
      len2 > 1e-12
        ? Math.min(1, Math.max(0, ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2))
        : 0;
    const px = ax + dx * t - s.x;
    const py = ay + dy * t - s.y;
    const pz = az + dz * t - s.z;
    if (px * px + py * py + pz * pz < r * r) return true;
  }
  return false;
}

/**
 * How much of a blast at (x, y, z) reaches a character: 1 within the inner share of the
 * radius of its body (a vertical line from shins to head), falling to 0 at the radius;
 * 0 if the map hides its nearest point, chest and head all from the blast.
 */
export function blastShare(
  world: CollisionWorld,
  def: GrenadeDef,
  x: number,
  y: number,
  z: number,
  c: Character,
): number {
  const low = c.y + 0.2;
  const high = c.y + c.height - 0.1;
  const near = Math.min(high, Math.max(low, y));
  const d = Math.hypot(c.x - x, near - y, c.z - z);
  if (d >= def.radius) return 0;
  const inner = def.radius * GRENADE.inner;
  const f = d <= inner ? 1 : 1 - (d - inner) / (def.radius - inner);
  const seen =
    clear(world, x, y, z, c.x, near, c.z) ||
    clear(world, x, y, z, c.x, c.y + c.height * 0.6, c.z) ||
    clear(world, x, y, z, c.x, high, c.z);
  return seen ? f : 0;
}

function clear(
  world: CollisionWorld,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  return world.raycast(ax, ay, az, dx / d, dy / d, dz / d, d) === Infinity;
}
