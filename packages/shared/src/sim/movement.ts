import { TICK_SECONDS } from '../tick';
import type { CollisionWorld, GroundHit, Ladder } from '../world/collision-world';
import { legSpeedScale } from './health';
import type { Character, PlayerInput } from './state';

/** Movement tuning. Distances in metres, speeds in metres per second. */
export const MOVEMENT = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.2,
  /** The eye is this far below the top of the capsule. */
  eyeBelowTop: 0.2,
  /** How fast the capsule grows or shrinks when standing up or crouching. */
  stanceRate: 6,
  walkSpeed: 3.5,
  sprintSpeed: 6,
  crouchSpeed: 1.8,
  climbSpeed: 2,
  /** Ledges this high are walked onto (kerbs, single steps); in the air, mantled onto. */
  stepUp: 0.45,
  /** Drops this deep are followed down instead of falling. */
  stepDown: 0.5,
  gravity: 20,
  /** With stepUp, a jump gets onto ledges about 1 m high. */
  jumpHeight: 0.6,
  maxFallSpeed: 40,
  /** Steering in the air, in metres per second per second. */
  airAccel: 8,
  /** Steepest terrain you can walk up, as rise over run (1 = 45°). */
  maxSlope: 1,
  pitchLimit: 1.4,
  /** How far in front of a ladder (beyond the capsule) you can grab it. */
  ladderReach: 0.4,
} as const;

const DT = TICK_SECONDS;
const JUMP_SPEED = Math.sqrt(2 * MOVEMENT.gravity * MOVEMENT.jumpHeight);
/** Push into a ladder at least this hard (as a fraction of a full stick) to grab it. */
const LADDER_GRAB = 0.5;
/** Where a climber's centre sits in front of the ladder. */
const ON_LADDER = MOVEMENT.radius + 0.05;

// Scratch space, so moving allocates nothing.
const pos = { x: 0, z: 0 };
const grad = { x: 0, z: 0 };
const groundHit: GroundHit = { solid: -1 };

/**
 * Advances one character by one tick. Without input it stands still, keeps its look
 * direction and stands up if it can.
 */
export function moveCharacter(
  c: Character,
  input: PlayerInput | undefined,
  world: CollisionWorld,
): void {
  let mx = 0;
  let my = 0;
  let sprint = false;
  let crouch = false;
  let jump = false;
  c.landingSpeed = 0;
  if (input) {
    if (Number.isFinite(input.yaw)) c.yaw = input.yaw;
    if (Number.isFinite(input.pitch)) {
      c.pitch = Math.max(-MOVEMENT.pitchLimit, Math.min(MOVEMENT.pitchLimit, input.pitch));
    }
    mx = Number.isFinite(input.moveX) ? input.moveX : 0;
    my = Number.isFinite(input.moveY) ? input.moveY : 0;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    // Firing or aiming stops a sprint.
    sprint = input.sprint && !input.fire && !input.aim && my > 0;
    crouch = input.crouch && !sprint;
    jump = input.jump && !c.jumpHeld;
    c.jumpHeld = input.jump;
  } else {
    c.jumpHeld = false;
  }

  // The move stick turned into a world direction (length ≤ 1). Forward is −z turned by yaw.
  const sy = Math.sin(c.yaw);
  const cy = Math.cos(c.yaw);
  const wishX = -sy * my + cy * mx;
  const wishZ = -cy * my - sy * mx;

  updateStance(c, crouch && c.mode !== 'ladder', world);
  if (c.mode === 'ladder') climb(c, wishX, wishZ, jump, world);
  else if (!grabLadder(c, wishX, wishZ, world)) walk(c, wishX, wishZ, sprint, jump, world);
}

function isCrouched(c: Character): boolean {
  return c.height < MOVEMENT.standHeight - 1e-6;
}

/** Eases the capsule height towards crouching or standing; standing needs headroom. */
function updateStance(c: Character, wantCrouch: boolean, world: CollisionWorld): void {
  const target = wantCrouch ? MOVEMENT.crouchHeight : MOVEMENT.standHeight;
  const change = MOVEMENT.stanceRate * DT;
  if (c.height > target) {
    c.height = Math.max(target, c.height - change);
  } else if (c.height < target) {
    const head = c.y + c.height;
    const room = world.ceilingAt(c.x, c.z, MOVEMENT.radius, head - 1e-3) - c.y;
    c.height = Math.max(c.height, Math.min(target, c.height + change, room));
  }
}

function walk(
  c: Character,
  wishX: number,
  wishZ: number,
  sprint: boolean,
  jump: boolean,
  world: CollisionWorld,
): void {
  const M = MOVEMENT;
  const crouched = isCrouched(c);
  if (c.mode === 'ground') {
    const speed =
      (crouched ? M.crouchSpeed : sprint ? M.sprintSpeed : M.walkSpeed) * legSpeedScale(c.health);
    c.vx = wishX * speed;
    c.vz = wishZ * speed;
    limitSlope(c, world);
  } else {
    steerInAir(c, wishX, wishZ, sprint ? M.sprintSpeed : M.walkSpeed);
  }

  // Move across, then out of anything solid. Stepping onto low things is allowed in the
  // air too, which lets a jump mantle onto a ledge.
  const t = world.terrain;
  pos.x = c.x + c.vx * DT;
  pos.z = c.z + c.vz * DT;
  world.pushOut(pos, M.radius, c.y + M.stepUp, c.y + c.height);
  pos.x = Math.max(t.minX + M.radius, Math.min(t.maxX - M.radius, pos.x));
  pos.z = Math.max(t.minZ + M.radius, Math.min(t.maxZ - M.radius, pos.z));
  // Velocity becomes what actually happened, so walls stop momentum.
  c.vx = (pos.x - c.x) / DT;
  c.vz = (pos.z - c.z) / DT;
  c.x = pos.x;
  c.z = pos.z;

  if (c.mode === 'ground') {
    if (jump && !crouched) {
      c.vy = JUMP_SPEED;
      c.mode = 'air';
    } else {
      // Follow the ground up steps and down slopes; fall off anything deeper.
      const ground = world.groundAt(c.x, c.z, M.radius, c.y + M.stepUp);
      if (ground >= c.y - M.stepDown) {
        c.y = ground;
        c.vy = 0;
        return;
      }
      c.mode = 'air';
      c.vy = 0;
    }
  }

  // Moving by the average of the old and new speeds makes jumps reach jumpHeight exactly.
  const vy0 = c.vy;
  c.vy = Math.max(c.vy - M.gravity * DT, -M.maxFallSpeed);
  let y = c.y + ((vy0 + c.vy) / 2) * DT;
  if (c.vy > 0) {
    const ceiling = world.ceilingAt(c.x, c.z, M.radius, c.y + c.height - 1e-3);
    if (y + c.height > ceiling) {
      y = Math.max(c.y, ceiling - c.height);
      c.vy = 0;
    }
  } else {
    // Surfaces between the old feet (plus a mantle) and the new ones: no falling through
    // floors however fast.
    const ground = world.groundAt(c.x, c.z, M.radius, c.y + M.stepUp);
    if (y <= ground) {
      y = ground;
      c.landingSpeed = -c.vy;
      c.vy = 0;
      c.mode = 'ground';
    }
  }
  c.y = y;
}

/**
 * A little steering in the air: speeds up along the stick up to the running speed, but
 * never brakes, so a sprint jump keeps its momentum. Also lets a jump from standing
 * against a ledge carry you onto it.
 */
function steerInAir(c: Character, wishX: number, wishZ: number, speed: number): void {
  const wish = Math.hypot(wishX, wishZ);
  if (wish === 0) return;
  const dirX = wishX / wish;
  const dirZ = wishZ / wish;
  const add = Math.min(MOVEMENT.airAccel * DT, wish * speed - (c.vx * dirX + c.vz * dirZ));
  if (add <= 0) return;
  c.vx += dirX * add;
  c.vz += dirZ * add;
}

/** On terrain steeper than maxSlope, drops the uphill part of the velocity. */
function limitSlope(c: Character, world: CollisionWorld): void {
  if (c.vx === 0 && c.vz === 0) return;
  world.groundAt(c.x, c.z, MOVEMENT.radius, c.y + 1e-3, groundHit);
  if (groundHit.solid >= 0) return;
  world.terrain.gradientAt(c.x, c.z, grad);
  const g2 = grad.x * grad.x + grad.z * grad.z;
  if (g2 <= MOVEMENT.maxSlope * MOVEMENT.maxSlope) return;
  const up = (c.vx * grad.x + c.vz * grad.z) / g2;
  if (up <= 0) return;
  c.vx -= up * grad.x;
  c.vz -= up * grad.z;
}

/** Starts climbing if pushing into a ladder from the front, or off its top from behind. */
function grabLadder(c: Character, wishX: number, wishZ: number, world: CollisionWorld): boolean {
  const wish = Math.hypot(wishX, wishZ);
  if (wish < LADDER_GRAB) return false;
  const reach = MOVEMENT.radius + MOVEMENT.ladderReach;
  for (let i = 0; i < world.ladders.length; i++) {
    const l = world.ladders[i]!;
    const rx = c.x - l.x;
    const rz = c.z - l.z;
    const side = rx * l.nz - rz * l.nx;
    if (Math.abs(side) > l.halfWidth + 0.1) continue;
    const front = rx * l.nx + rz * l.nz;
    // Positive when pushing towards the wall.
    const toward = -(wishX * l.nx + wishZ * l.nz) / wish;
    if (
      front >= 0 &&
      front <= reach &&
      toward > LADDER_GRAB &&
      c.y >= l.bottom - 0.1 &&
      c.y < l.top - 0.2
    ) {
      startClimb(c, i, l, side);
      return true;
    }
    if (
      c.mode === 'ground' &&
      front < 0 &&
      front >= -reach &&
      toward < -LADDER_GRAB &&
      Math.abs(c.y - l.top) < 0.2
    ) {
      startClimb(c, i, l, side);
      c.y = l.top - 0.05;
      return true;
    }
  }
  return false;
}

function startClimb(c: Character, index: number, l: Ladder, side: number): void {
  c.mode = 'ladder';
  c.ladder = index;
  c.vx = 0;
  c.vy = 0;
  c.vz = 0;
  placeAtLadder(c, l, side, ON_LADDER);
}

/** Puts the capsule `front` metres out from the ladder's plane and `side` metres along it. */
function placeAtLadder(c: Character, l: Ladder, side: number, front: number): void {
  const s = Math.max(-l.halfWidth, Math.min(l.halfWidth, side));
  c.x = l.x + l.nx * front + l.nz * s;
  c.z = l.z + l.nz * front - l.nx * s;
}

/** Pushing towards the wall climbs up and away from it climbs down, whichever way you look. */
function climb(
  c: Character,
  wishX: number,
  wishZ: number,
  jump: boolean,
  world: CollisionWorld,
): void {
  const l = world.ladders[c.ladder];
  const side = l ? (c.x - l.x) * l.nz - (c.z - l.z) * l.nx : 0;
  if (!l || jump) {
    // Let go, pushing off backwards.
    c.mode = 'air';
    c.ladder = -1;
    c.vx = l ? l.nx * 2 : 0;
    c.vz = l ? l.nz * 2 : 0;
    c.vy = 0;
    return;
  }
  const toward = -(wishX * l.nx + wishZ * l.nz);
  c.vy = toward * MOVEMENT.climbSpeed;
  c.y += c.vy * DT;
  placeAtLadder(c, l, side, ON_LADDER);
  if (c.y >= l.top) {
    // Over the top, onto whatever is behind it.
    c.y = l.top;
    placeAtLadder(c, l, side, -(MOVEMENT.radius + 0.1));
    leaveLadder(c);
  } else if (c.y <= l.bottom && toward < 0) {
    c.y = l.bottom;
    leaveLadder(c);
  }
}

function leaveLadder(c: Character): void {
  c.mode = 'ground';
  c.ladder = -1;
  c.vy = 0;
}

/**
 * Pushes overlapping living bodies apart, half each, then out of any wall that put them
 * in. Characters are few, so every pair is checked.
 */
export function separateCharacters(characters: readonly Character[], world: CollisionWorld): void {
  const r2 = MOVEMENT.radius * 2;
  for (let i = 0; i < characters.length; i++) {
    const a = characters[i]!;
    if (a.health.dead) continue;
    for (let j = i + 1; j < characters.length; j++) {
      const b = characters[j]!;
      if (b.health.dead || a.y >= b.y + b.height || b.y >= a.y + a.height) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= r2) continue;
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
      } else {
        dx /= d;
        dz /= d;
      }
      const push = (r2 - d) / 2;
      shove(a, -dx * push, -dz * push, world);
      shove(b, dx * push, dz * push, world);
    }
  }
}

function shove(c: Character, dx: number, dz: number, world: CollisionWorld): void {
  pos.x = c.x + dx;
  pos.z = c.z + dz;
  world.pushOut(pos, MOVEMENT.radius, c.y + MOVEMENT.stepUp, c.y + c.height);
  const t = world.terrain;
  c.x = Math.max(t.minX + MOVEMENT.radius, Math.min(t.maxX - MOVEMENT.radius, pos.x));
  c.z = Math.max(t.minZ + MOVEMENT.radius, Math.min(t.maxZ - MOVEMENT.radius, pos.z));
}
