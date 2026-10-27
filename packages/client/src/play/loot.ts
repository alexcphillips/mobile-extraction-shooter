import {
  DOOR,
  LOOT_REACH,
  createRayHit,
  doorInReach,
  eyeHeight,
  groundInReach,
  type Character,
  type CollisionWorld,
  type GroundItem,
  type LootContainer,
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
 * door in reach under the crosshair, else the container or dead body in reach that the
 * player is most nearly facing, or null. One right underfoot counts even behind. The
 * result is reused: copy what you keep.
 */
export function lootableInReach(
  sim: SimState,
  world: CollisionWorld,
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
  const ey = eyeHeight(player);
  for (let i = 0; i < sim.ground.length; i++) {
    const g = sim.ground[i]!;
    if (!groundInReach(player, g)) continue;
    const dx = g.x - player.x;
    const dy = g.y - ey;
    const dz = g.z - player.z;
    const facing = (dx * lx + dy * ly + dz * lz) / Math.hypot(dx, dy, dz);
    // Above anything a container or body scores, so aiming at an item takes it.
    if (facing >= GROUND_CONE && facing + 2 > best) {
      best = facing + 2;
      scratch.ground.g = g;
      scratch.ground.index = i;
      found = scratch.ground as Lootable;
    }
  }
  // A door: the first thing the crosshair meets, and in reach. Above containers and bodies.
  // Looking through an open door's doorway counts too, so it can be closed again with its
  // slab off to the side, but below anything else in reach.
  if (!found && world.doors.length) {
    const reach = DOOR.reach + 1;
    const d = Math.min(reach, world.raycast(player.x, ey, player.z, lx, ly, lz, reach, hit));
    let door = hit.kind === 'solid' ? world.doorOf(hit.index) : -1;
    if (door >= 0) best = 1.5;
    else {
      door = doorwayAt(sim, world, player.x, ey, player.z, lx, ly, lz, d);
      best = DOORWAY_SCORE;
    }
    if (door >= 0 && doorInReach(world, player, door)) {
      scratch.door.index = door;
      found = scratch.door as Lootable;
    } else best = -Infinity;
  }
  for (const l of sim.loot) {
    const s = score(player, fx, fz, l.x, l.y, l.z);
    if (s > best) {
      best = s;
      scratch.container.c = l;
      found = scratch.container as Lootable;
    }
  }
  for (const e of sim.entities) {
    if (e === player || !e.health.dead) continue;
    const s = score(player, fx, fz, e.x, e.y, e.z);
    if (s > best) {
      best = s;
      scratch.body.c = e;
      found = scratch.body as Lootable;
    }
  }
  return found;
}

/** Just over the least a container or body in reach can score. */
const DOORWAY_SCORE = 0.31;

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
    if (!sim.doors[i]?.open) continue;
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

/** How squarely the player faces a spot in reach (higher is better), or -Infinity. */
function score(p: Character, fx: number, fz: number, x: number, y: number, z: number): number {
  const dx = x - p.x;
  const dz = z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > LOOT_REACH || Math.abs(y - p.y) > LOOT_REACH) return -Infinity;
  if (d < 0.6) return 1;
  const facing = (dx * fx + dz * fz) / d;
  return facing > 0.3 ? facing : -Infinity;
}
