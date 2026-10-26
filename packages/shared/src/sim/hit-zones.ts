import { CHEST, HEAD, LEFT_ARM, LEFT_LEG, RIGHT_ARM, RIGHT_LEG, type Zone } from './health';
import { MOVEMENT } from './movement';
import type { Character, EntityId, SimState } from './state';

/**
 * Hit zones are capsules in a fixed layout around the character's position, turned by its
 * yaw and squashed by crouching. They live in the simulation, not on the animated
 * skeleton, so a co-op server with no renderer gets the same hits (decided in session 6).
 * The drawn body (session 8b) is posed to match.
 */
export interface HitCapsule {
  zone: Zone;
  /** Ends of the capsule's axis for a standing character, in metres: side (+ is the
   * character's right), height above the feet, and forward. */
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  radius: number;
}

export const HIT_CAPSULES: readonly HitCapsule[] = [
  { zone: HEAD, a: [0, 1.56, 0.02], b: [0, 1.68, 0.02], radius: 0.12 },
  { zone: CHEST, a: [0, 0.98, 0], b: [0, 1.36, 0], radius: 0.19 },
  { zone: LEFT_ARM, a: [-0.29, 0.86, 0], b: [-0.29, 1.38, 0], radius: 0.075 },
  { zone: RIGHT_ARM, a: [0.29, 0.86, 0], b: [0.29, 1.38, 0], radius: 0.075 },
  { zone: LEFT_LEG, a: [-0.11, 0.1, 0], b: [-0.11, 0.86, 0], radius: 0.1 },
  { zone: RIGHT_LEG, a: [0.11, 0.1, 0], b: [0.11, 0.86, 0], radius: 0.1 },
];

/** Every capsule fits in a sphere this wide around the middle of a standing body. */
const BOUND_RADIUS = 1.0;

export interface CharacterHit {
  /** 0 when nothing was hit. */
  id: EntityId;
  zone: Zone;
  distance: number;
}

export function createCharacterHit(): CharacterHit {
  return { id: 0, zone: CHEST, distance: Infinity };
}

// Scratch: capsule ends in world space.
const A = [0, 0, 0];
const B = [0, 0, 0];

/** World-space ends of a capsule on a character, written into a and b. */
export function capsuleEnds(c: Character, cap: HitCapsule, a: number[], b: number[]): void {
  const squash = c.height / MOVEMENT.standHeight;
  // Right is (cos yaw, −sin yaw) and forward is (−sin yaw, −cos yaw).
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  a[0] = c.x + cap.a[0] * cy - cap.a[2] * sy;
  a[1] = c.y + cap.a[1] * squash;
  a[2] = c.z - cap.a[0] * sy - cap.a[2] * cy;
  b[0] = c.x + cap.b[0] * cy - cap.b[2] * sy;
  b[1] = c.y + cap.b[1] * squash;
  b[2] = c.z - cap.b[0] * sy - cap.b[2] * cy;
}

/**
 * The nearest living character's hit zone along a ray (d normalised), closer than
 * maxDist, skipping one entity (the shooter). Returns the distance, or Infinity.
 * Characters are few, so it checks each one's bounding sphere rather than keeping a
 * spatial hash of moving things.
 */
export function raycastCharacters(
  state: SimState,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  skip: EntityId,
  hit?: CharacterHit,
): number {
  let best = maxDist;
  let bestId = 0;
  let bestZone: Zone = CHEST;
  for (const c of state.entities) {
    if (c.id === skip || c.health.dead) continue;
    const half = c.height / 2;
    if (raySphere(ox, oy, oz, dx, dy, dz, c.x, c.y + half, c.z, BOUND_RADIUS) >= best) continue;
    for (const cap of HIT_CAPSULES) {
      capsuleEnds(c, cap, A, B);
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, A, B, cap.radius);
      if (t < best) {
        best = t;
        bestId = c.id;
        bestZone = cap.zone;
      }
    }
  }
  const distance = bestId ? best : Infinity;
  if (hit) {
    hit.id = bestId;
    hit.zone = bestZone;
    hit.distance = distance;
  }
  return distance;
}

/** Distance along a ray (d normalised) to a sphere, or Infinity; 0 if the origin is inside. */
function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const px = ox - cx;
  const py = oy - cy;
  const pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  if (c <= 0) return 0;
  const h = b * b - c;
  if (h < 0 || b > 0) return Infinity;
  return -b - Math.sqrt(h);
}

/** Distance along a ray (d normalised) to a capsule from a to b, or Infinity. */
export function rayCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  a: readonly number[],
  b: readonly number[],
  r: number,
): number {
  const bax = b[0]! - a[0]!;
  const bay = b[1]! - a[1]!;
  const baz = b[2]! - a[2]!;
  const oax = ox - a[0]!;
  const oay = oy - a[1]!;
  const oaz = oz - a[2]!;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  // The side: the infinite cylinder around the axis, kept if it's between the ends.
  const qa = baba - bard * bard;
  if (qa > 1e-12) {
    const qb = baba * rdoa - baoa * bard;
    const qc = baba * oaoa - baoa * baoa - r * r * baba;
    const h = qb * qb - qa * qc;
    // Missing the cylinder misses the end caps too: they're inside it.
    if (h < 0) return Infinity;
    const t = (-qb - Math.sqrt(h)) / qa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : Infinity;
  }
  // The ends: spheres at a and b.
  return Math.min(
    raySphere(ox, oy, oz, dx, dy, dz, a[0]!, a[1]!, a[2]!, r),
    raySphere(ox, oy, oz, dx, dy, dz, b[0]!, b[1]!, b[2]!, r),
  );
}
