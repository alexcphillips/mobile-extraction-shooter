import {
  DOOR,
  LOOT_REACH,
  containerInReach,
  createRayHit,
  doorInReach,
  eyeHeight,
  eyeX,
  eyeZ,
  groundInReach,
  lootInSight,
  type Character,
  type CollisionWorld,
  type GroundItem,
  type LootContainer,
  type SearchedLook,
  type Shape,
  type SimState,
} from '@mes/shared';

/**
 * Something the use button can loot, take from the ground (by its index), or open, close
 * or unlock (a door, by its index).
 */
export type Lootable =
  | { kind: 'container'; c: LootContainer }
  | { kind: 'body'; c: Character }
  | { kind: 'ground'; g: GroundItem; index: number }
  | { kind: 'door'; index: number };

/** How close to the crosshair an item on the ground must be to take it: cos of ~20°. */
const GROUND_CONE = Math.cos((20 * Math.PI) / 180);

const scratch = {
  container: { kind: 'container', c: null as unknown as LootContainer },
  body: { kind: 'body', c: null as unknown as Character },
  ground: { kind: 'ground', g: null as unknown as GroundItem, index: -1 },
  door: { kind: 'door', index: -1 },
};
const hit = createRayHit();

/**
 * What the use button acts on: an item on the ground in reach near the crosshair, else a
 * container made of geometry or a door in reach under the crosshair, else the container
 * marker or dead body in reach that the crosshair is nearest, or null. Each has to be
 * looked at, so one at your feet doesn't take the use button from a door. Nothing behind a
 * wall counts. A searched container is also aimed at by its searched look, which has no
 * solids. The result is reused: copy what you keep.
 */
export function lootableInReach(
  sim: SimState,
  world: CollisionWorld,
  looks: readonly SearchedLook[],
  player: Character,
  yaw: number,
  pitch: number,
): Lootable | null {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let best = -Infinity;
  let found: Lootable | null = null;
  // Items on the ground: within a cone around the look, from the eye.
  const cp = Math.cos(pitch);
  const lx = fx * cp;
  const ly = Math.sin(pitch);
  const lz = fz * cp;
  // From the eye, leaned or not, as the sim's lootInSight checks.
  const ex = eyeX(player);
  const ey = eyeHeight(player);
  const ez = eyeZ(player);
  for (let i = 0; i < sim.ground.length; i++) {
    const g = sim.ground[i]!;
    if (!groundInReach(player, g, world)) continue;
    const dx = g.x - ex;
    const dy = g.y - ey;
    const dz = g.z - ez;
    const facing = (dx * lx + dy * ly + dz * lz) / Math.hypot(dx, dy, dz);
    // Above anything a container or body scores, so aiming at an item takes it.
    if (facing >= GROUND_CONE && facing + 2 > best) {
      best = facing + 2;
      scratch.ground.g = g;
      scratch.ground.index = i;
      found = scratch.ground as Lootable;
    }
  }
  // The first solid the crosshair meets: part of a container made of geometry, or a door,
  // in reach. Above container markers and bodies. Looking through an open door's doorway
  // counts too, so it can be closed again with its slab off to the side, but below anything
  // else in reach.
  if (!found) {
    const d = world.raycast(ex, ey, ez, lx, ly, lz, AIM_REACH, hit);
    const solid = hit.kind === 'solid' ? hit.index : -1;
    const shaped =
      searchedAimedAt(sim, looks, ex, ey, ez, lx, ly, lz, d) ??
      (solid >= 0 ? containerOf(sim, solid) : null);
    if (shaped) {
      if (containerInReach(player, shaped)) {
        best = 1.5;
        scratch.container.c = shaped;
        found = scratch.container as Lootable;
      }
    } else if (world.doors.length) {
      const reach = DOOR.reach + 1;
      let door = solid >= 0 && d <= reach ? world.doorOf(solid) : -1;
      if (door >= 0) best = 1.5;
      else {
        door = doorwayAt(sim, world, ex, ey, ez, lx, ly, lz, Math.min(reach, d));
        best = DOORWAY_SCORE;
      }
      if (door >= 0 && doorInReach(world, player, door)) {
        scratch.door.index = door;
        found = scratch.door as Lootable;
      } else best = -Infinity;
    }
  }
  for (const l of sim.loot) {
    if (l.shape) continue;
    const s = containerScore(player, ex, ey, ez, lx, ly, lz, l);
    if (s > best && inSight(world, player, l.x, l.y, l.z)) {
      best = s;
      scratch.container.c = l;
      found = scratch.container as Lootable;
    }
  }
  for (const e of sim.entities) {
    // A zombie has nothing on it (zombies mode).
    if (e === player || !e.health.dead || e.ai?.zombie) continue;
    const s = bodyScore(player, ex, ey, ez, lx, ly, lz, e);
    if (s > best && inSight(world, player, e.x, e.y, e.z)) {
      best = s;
      scratch.body.c = e;
      found = scratch.body as Lootable;
    }
  }
  return found;
}

/** Under the least a container marker or body in reach can score. */
const DOORWAY_SCORE = 0.31;

/**
 * How far along the crosshair a door or container made of geometry is looked for: far
 * enough for one LOOT_REACH from your feet, seen from the eye.
 */
const AIM_REACH = Math.max(DOOR.reach + 1, LOOT_REACH + 1.5);

/** Which container made of geometry each solid is part of, for the sim.loot it was built from. */
let owners: (LootContainer | undefined)[] = [];
let ownersOf: readonly LootContainer[] | null = null;
let ownersCount = -1;

/** The container made of geometry a solid is part of, or null. */
function containerOf(sim: SimState, solid: number): LootContainer | null {
  if (ownersOf !== sim.loot || ownersCount !== sim.loot.length) {
    owners = [];
    for (const l of sim.loot) for (const k of l.shape?.solids ?? []) owners[k] = l;
    ownersOf = sim.loot;
    ownersCount = sim.loot.length;
  }
  return owners[solid] ?? null;
}

/** The bounds of a searched look, in its container's frame about (x, z). */
interface AimBox {
  c: LootContainer;
  x: number;
  z: number;
  cos: number;
  sin: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

let aimBoxes: AimBox[] = [];
let aimBoxesOf: readonly LootContainer[] | null = null;
let aimBoxesLooks: readonly SearchedLook[] | null = null;
let aimBoxesCount = -1;

function aimBox(c: LootContainer, shapes: readonly Shape[]): AimBox {
  const yaw = c.shape?.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const out: AimBox = {
    c,
    x: c.x,
    z: c.z,
    cos,
    sin,
    x0: Infinity,
    x1: -Infinity,
    y0: Infinity,
    y1: -Infinity,
    z0: Infinity,
    z1: -Infinity,
  };
  for (const s of shapes) {
    const px = s.x - c.x;
    const pz = s.z - c.z;
    const lx = cos * px - sin * pz;
    const lz = sin * px + cos * pz;
    const hx = s.kind === 'cylinder' ? Math.max(s.radius, s.radiusTop) : s.hx;
    const hz = s.kind === 'cylinder' ? hx : s.hz;
    const turn = s.yaw - yaw;
    const ex = Math.abs(Math.cos(turn)) * hx + Math.abs(Math.sin(turn)) * hz;
    const ez = Math.abs(Math.sin(turn)) * hx + Math.abs(Math.cos(turn)) * hz;
    out.x0 = Math.min(out.x0, lx - ex);
    out.x1 = Math.max(out.x1, lx + ex);
    out.z0 = Math.min(out.z0, lz - ez);
    out.z1 = Math.max(out.z1, lz + ez);
    out.y0 = Math.min(out.y0, s.y - s.hy);
    out.y1 = Math.max(out.y1, s.y + s.hy);
  }
  return out;
}

/** How far along a ray it enters a box, 0 if it starts inside, or Infinity. */
function rayIntoBox(
  b: AimBox,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
) {
  const px = ox - b.x;
  const pz = oz - b.z;
  const lox = b.cos * px - b.sin * pz;
  const loz = b.sin * px + b.cos * pz;
  const ldx = b.cos * dx - b.sin * dz;
  const ldz = b.sin * dx + b.cos * dz;
  rayNear = 0;
  rayFar = Infinity;
  if (!raySlab(lox, ldx, b.x0, b.x1)) return Infinity;
  if (!raySlab(oy, dy, b.y0, b.y1)) return Infinity;
  if (!raySlab(loz, ldz, b.z0, b.z1)) return Infinity;
  return rayNear;
}

let rayNear = 0;
let rayFar = Infinity;

/** Narrows the ray to where it's between lo and hi on one axis; false if it never is. */
function raySlab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  const t0 = (lo - o) / d;
  const t1 = (hi - o) / d;
  rayNear = Math.max(rayNear, Math.min(t0, t1));
  rayFar = Math.min(rayFar, Math.max(t0, t1));
  return rayNear <= rayFar;
}

/** The nearest searched container whose searched look a ray enters within maxDist, or null. */
function searchedAimedAt(
  sim: SimState,
  looks: readonly SearchedLook[],
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): LootContainer | null {
  if (aimBoxesOf !== sim.loot || aimBoxesLooks !== looks || aimBoxesCount !== sim.loot.length) {
    const byId = new Map(sim.loot.map((l) => [l.id, l]));
    aimBoxes = [];
    for (const look of looks) {
      const c = byId.get(look.id);
      if (c) aimBoxes.push(aimBox(c, look.searched));
    }
    aimBoxesOf = sim.loot;
    aimBoxesLooks = looks;
    aimBoxesCount = sim.loot.length;
  }
  let nearest: LootContainer | null = null;
  let best = maxDist;
  for (const b of aimBoxes) {
    if (!b.c.searched) continue;
    const t = rayIntoBox(b, ox, oy, oz, dx, dy, dz);
    if (t < best) {
      best = t;
      nearest = b.c;
    }
  }
  return nearest;
}

/** The open door whose doorway a ray passes through within maxDist, or -1. */
function doorwayAt(
  sim: SimState,
  world: CollisionWorld,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): number {
  for (let i = 0; i < world.doors.length; i++) {
    // A bought door (zombies mode) is gone: nothing to use there.
    if (!sim.doors[i]?.open || sim.doors[i]!.gone) continue;
    const d = world.doors[i]!;
    // Into the door's frame; its doorway is local z = 0.
    const c = Math.cos(d.yaw);
    const s = Math.sin(d.yaw);
    const px = ox - d.x;
    const pz = oz - d.z;
    const lz0 = s * px + c * pz;
    const ldz = s * dx + c * dz;
    if (Math.abs(ldz) < 1e-6) continue;
    const t = -lz0 / ldz;
    if (t <= 0 || t > maxDist) continue;
    const x = c * (px + dx * t) - s * (pz + dz * t);
    const y = oy + dy * t;
    if (Math.abs(x) <= d.width / 2 && y >= d.y && y <= d.y + d.height) return i;
  }
  return -1;
}

/**
 * How near a body lying around its feet the crosshair falls on the floor (higher is better,
 * 0.5 to 1, so above a doorway), or -Infinity. Not knowing which way it fell, anywhere within
 * BODY_RADIUS of its feet counts.
 */
function bodyScore(
  p: Character,
  ex: number,
  ey: number,
  ez: number,
  lx: number,
  ly: number,
  lz: number,
  b: Character,
): number {
  if (Math.hypot(b.x - p.x, b.z - p.z) > LOOT_REACH + BODY_RADIUS) return -Infinity;
  // Where the look meets the floor it lies on, a little above its feet.
  const drop = b.y + 0.2 - ey;
  if (ly >= 0 || drop >= 0) return -Infinity;
  const t = drop / ly;
  const r = Math.hypot(ex + lx * t - b.x, ez + lz * t - b.z);
  return r <= BODY_RADIUS ? 1 - (0.5 * r) / BODY_RADIUS : -Infinity;
}

/** How far from its feet a body lying in any direction is covered: most of its length. */
const BODY_RADIUS = 1.2;

/** Whether a container or body, by where it stands, can be seen: a little above its feet. */
function inSight(world: CollisionWorld, p: Character, x: number, y: number, z: number): boolean {
  return lootInSight(world, p, x, y + 0.5, z);
}

/**
 * How near the crosshair passes a container marker's middle, half a metre above its marker (higher
 * is better, 0.5 to 1, so above a doorway), or -Infinity. Within CONTAINER_RADIUS counts.
 */
function containerScore(
  p: Character,
  ex: number,
  ey: number,
  ez: number,
  lx: number,
  ly: number,
  lz: number,
  c: LootContainer,
): number {
  if (Math.hypot(c.x - p.x, c.z - p.z) > LOOT_REACH || Math.abs(c.y - p.y) > LOOT_REACH) {
    return -Infinity;
  }
  const dx = c.x - ex;
  const dy = c.y + 0.5 - ey;
  const dz = c.z - ez;
  const t = dx * lx + dy * ly + dz * lz;
  if (t <= 0) return -Infinity;
  const r = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - t * t));
  return r <= CONTAINER_RADIUS ? 1 - (0.5 * r) / CONTAINER_RADIUS : -Infinity;
}

/** How far from a container's middle the crosshair may pass: about a desk's half-size. */
const CONTAINER_RADIUS = 0.6;
