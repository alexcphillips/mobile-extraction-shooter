import { CHEST, HEAD, LEFT_ARM, LEFT_LEG, RIGHT_ARM, RIGHT_LEG, type Zone } from './health';
import { MOVEMENT } from './movement';
import type { Character, EntityId, SimState } from './state';

/**
 * Hit zones are capsules in a fixed layout around the character's position, turned by its
 * yaw and squashed by crouching. They live in the simulation, not on the animated
 * skeleton, so a co-op server with no renderer gets the same hits (decided in session 6).
 * The drawn body (session 8b) is posed to match. A zone can have more than one capsule.
 */
export interface HitCapsule {
  zone: Zone;
  /** Ends of the capsule's axis for a standing character, in meters: side (+ is the
   * character's right), height above the feet, and forward. */
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  radius: number;
}

/**
 * Matched to the drawn body in session 8b. The chest is two capsules side by side, so it's
 * wider than deep like a torso. Arms are held forward with a gun, as armed characters
 * nearly always are: upper arms down from the shoulders to the elbows, forearms in to the
 * hands in front of the chest, so from the front they cover part of it. Measured from the
 * body holding a rifle and a pistol, aimed and at the low ready.
 */
export const HIT_CAPSULES: readonly HitCapsule[] = [
  { zone: HEAD, a: [0.04, 1.58, 0.035], b: [0.04, 1.655, 0.035], radius: 0.125 },
  { zone: CHEST, a: [-0.06, 0.98, 0], b: [-0.06, 1.36, 0], radius: 0.125 },
  { zone: CHEST, a: [0.06, 0.98, 0], b: [0.06, 1.36, 0], radius: 0.125 },
  { zone: LEFT_ARM, a: [-0.16, 1.36, -0.03], b: [-0.14, 1.13, 0.02], radius: 0.065 },
  { zone: LEFT_ARM, a: [-0.14, 1.13, 0.02], b: [0.05, 1.24, 0.22], radius: 0.055 },
  { zone: RIGHT_ARM, a: [0.22, 1.35, -0.12], b: [0.27, 1.14, -0.1], radius: 0.065 },
  { zone: RIGHT_ARM, a: [0.27, 1.14, -0.1], b: [0.13, 1.26, 0.12], radius: 0.055 },
  { zone: LEFT_LEG, a: [-0.11, 0.1, 0], b: [-0.11, 0.86, 0], radius: 0.1 },
  { zone: RIGHT_LEG, a: [0.11, 0.1, 0], b: [0.11, 0.86, 0], radius: 0.1 },
];

/**
 * How the clips carry the head off its standing place, measured from the drawn body and
 * averaged over each clip. Moving, it goes the way the body is going, as the hips twist
 * to it: at each speed in meters per second, this far along and this far down.
 */
const HEAD_MOVING: readonly (readonly [number, number, number])[] = [
  [0.4, 0, 0],
  [1.3, 0.1, 0],
  [3.2, 0.17, 0.065],
  [5.2, 0.35, 0.145],
];
/** Crouched, it goes this far forward, and this far left while still. */
const HEAD_CROUCH_FORWARD = 0.1;
const HEAD_CROUCH_LEFT = 0.17;
/** Crouching still ends at about this speed. */
const HEAD_CROUCH_STILL = 0.9;
/** Beyond this far from where it faces, the clip plays backwards and still leans forward. */
const HEAD_BACKWARDS = Math.cos(1.9);
/** Looking down moves it forward and down, per radian: the spine and neck bend. */
const HEAD_PITCH_FORWARD = 0.17;
const HEAD_PITCH_UP = 0.07;

/**
 * How far the head zone sits off HIT_CAPSULES, written into out as side, height and
 * forward. From the sim's own movement, stance and pitch, so it needs no skeleton.
 */
export function headOffset(c: Character, out: number[]): void {
  const speed = Math.hypot(c.vx, c.vz);
  let along = 0;
  let drop = 0;
  const last = HEAD_MOVING[HEAD_MOVING.length - 1]!;
  if (speed >= last[0]) {
    along = last[1];
    drop = last[2];
  } else {
    for (let i = 1; i < HEAD_MOVING.length; i++) {
      const p = HEAD_MOVING[i - 1]!;
      const q = HEAD_MOVING[i]!;
      if (speed < p[0] || speed >= q[0]) continue;
      const t = (speed - p[0]) / (q[0] - p[0]);
      along = p[1] + (q[1] - p[1]) * t;
      drop = p[2] + (q[2] - p[2]) * t;
    }
  }
  const crouch = Math.max(
    0,
    Math.min(1, (MOVEMENT.standHeight - c.height) / (MOVEMENT.standHeight - MOVEMENT.crouchHeight)),
  );
  // Right is (cos yaw, −sin yaw) and forward is (−sin yaw, −cos yaw).
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  let right = 0;
  let forward = 0;
  if (speed > 1e-6) {
    right = (c.vx * cy - c.vz * sy) / speed;
    forward = (-c.vx * sy - c.vz * cy) / speed;
    if (forward < HEAD_BACKWARDS) {
      right = -right;
      forward = -forward;
    }
  }
  const moving = along * (1 - crouch);
  const still = 1 - Math.min(1, speed / HEAD_CROUCH_STILL);
  out[0] = right * moving - HEAD_CROUCH_LEFT * crouch * still;
  out[1] = c.pitch * HEAD_PITCH_UP - drop * (1 - crouch);
  out[2] = forward * moving + HEAD_CROUCH_FORWARD * crouch - c.pitch * HEAD_PITCH_FORWARD;
}

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
const OFF = [0, 0, 0];
const END: [number, number, number] = [0, 0, 0];

/**
 * World-space ends of a capsule on a character, written into a and b. Ends above the hips
 * tip sideways with the lean, as the eye does (bodyPoint), so the legs stay behind cover.
 * The head also moves with the pose (headOffset).
 */
export function capsuleEnds(c: Character, cap: HitCapsule, a: number[], b: number[]): void {
  const squash = c.height / MOVEMENT.standHeight;
  const tilt = (c.lean ?? 0) * MOVEMENT.leanAngle;
  const pivot = c.height * MOVEMENT.leanPivot;
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);
  if (cap.zone === HEAD) {
    headOffset(c, OFF);
    placeEnd(c, offsetBy(cap.a), squash, pivot, sinTilt, cosTilt, a);
    placeEnd(c, offsetBy(cap.b), squash, pivot, sinTilt, cosTilt, b);
    return;
  }
  placeEnd(c, cap.a, squash, pivot, sinTilt, cosTilt, a);
  placeEnd(c, cap.b, squash, pivot, sinTilt, cosTilt, b);
}

function offsetBy(p: readonly [number, number, number]): [number, number, number] {
  END[0] = p[0] + OFF[0]!;
  END[1] = p[1] + OFF[1]!;
  END[2] = p[2] + OFF[2]!;
  return END;
}

function placeEnd(
  c: Character,
  p: readonly [number, number, number],
  squash: number,
  pivot: number,
  sinTilt: number,
  cosTilt: number,
  out: number[],
): void {
  let side = p[0];
  let h = p[1] * squash;
  if (sinTilt !== 0 && h > pivot) {
    // Turned about the forward axis through the pivot: up tips towards the lean's side.
    const up = h - pivot;
    side = p[0] * cosTilt + up * sinTilt;
    h = pivot - p[0] * sinTilt + up * cosTilt;
  }
  // Right is (cos yaw, −sin yaw) and forward is (−sin yaw, −cos yaw).
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  out[0] = c.x + side * cy - p[2] * sy;
  out[1] = c.y + h;
  out[2] = c.z - side * sy - p[2] * cy;
}

/**
 * The nearest living character's hit zone along a ray (d normalized), closer than
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

/** Distance along a ray (d normalized) to a sphere, or Infinity; 0 if the origin is inside. */
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

/** Distance along a ray (d normalized) to a capsule from a to b, or Infinity. */
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
