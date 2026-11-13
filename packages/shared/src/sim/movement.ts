import { TICK_SECONDS } from '../tick';
import {
  createRayHit,
  DEEP_WATER,
  type CollisionWorld,
  type GroundHit,
  type Ladder,
} from '../world/collision-world';
import { legSpeedScale } from './health';
import { canSprint, loadSpeed } from './weight';
import { STAMINA, spendStamina, staminaToSprint, updateStamina } from './stamina';
import { eyeHeight, eyeX, eyeZ, type Character, type PlayerInput } from './state';

/** Movement tuning. Distances in meters, speeds in meters per second. */
export const MOVEMENT = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.2,
  /** Prone is still an upright capsule, just a short one. */
  proneHeight: 0.6,
  /** The eye is this far below the top of the capsule. */
  eyeBelowTop: 0.2,
  /** How fast the capsule grows or shrinks when changing stance. */
  stanceRate: 6,
  walkSpeed: 3.5,
  sprintSpeed: 6,
  crouchSpeed: 1.8,
  proneSpeed: 0.8,
  climbSpeed: 2,
  /** The most you can walk while using a med. */
  useSpeed: 1.5,
  /** At most this fast while packing or unloading magazines (MG-4: a little quicker than a med). */
  packSpeed: 2,
  /** Walking and sprinting are this much faster with the knife out. */
  knifeSpeed: 1.1,
  /** Ledges this high are walked onto (kerbs, single steps); in the air, mantled onto. */
  stepUp: 0.45,
  /** Drops this deep are followed down instead of falling. */
  stepDown: 0.5,
  gravity: 20,
  /** With stepUp, a jump gets onto ledges about 1 m high. */
  jumpHeight: 0.6,
  maxFallSpeed: 40,
  /** Steering in the air, in meters per second per second. */
  airAccel: 8,
  /** Steepest terrain you can walk up, as rise over run (1 = 45°). */
  maxSlope: 1,
  pitchLimit: 1.4,
  /** How far in front of a ladder (beyond the capsule) you can grab it. */
  ladderReach: 0.4,
  /**
   * Vaulting: jumping while facing something from stepUp to vaultMax high, at most
   * vaultReach in front of the capsule and vaultDepth deep, goes over it, if there's a gap
   * vaultGap tall and the capsule's width above it and room to stand or crouch beyond.
   * Too deep to go over and flat on top, it lands on top instead. Pressing or holding jump
   * in the air does the same, measured from the feet there, so a jump reaches vaultMax +
   * jumpHeight (1.7 m), and it lands on top of anything with room for the capsule.
   */
  vaultMax: 1.1,
  vaultReach: 0.5,
  vaultDepth: 1,
  vaultGap: 0.8,
  /** How long the move takes, and how short the capsule gets halfway (the camera dips). */
  vaultTime: 0.5,
  vaultDuck: 0.8,
  /** The far side's floor may be this far below the feet. */
  vaultDrop: 1,
  /**
   * Leaning (2026-11-01): the body above the hips tips sideways about a point this far up
   * the capsule, by up to leanAngle (about 29°), which moves a standing eye about 0.34 m
   * and drops it 9 cm. A full lean takes leanTime.
   */
  leanPivot: 0.5,
  leanAngle: 0.5,
  leanTime: 0.15,
  /** A lean stops this far short of a wall, so the head (and eye) stays out of it. */
  leanHeadRoom: 0.15,
  /**
   * The sprint-slide (AI-7; design.md → AI → Jug: his alone): from at least slideFrom, it
   * goes low (slideHeight) along the way it was going, from slideSpeed slowing evenly to
   * slideEndSpeed over slideTime (about 3.8 m), turning at most slideSteer radians a second
   * towards the stick. A wall that stops it ends it; so does leaving the ground.
   */
  slideFrom: 4.5,
  slideSpeed: 7.5,
  slideEndSpeed: 2,
  slideTime: 0.8,
  slideHeight: 1.1,
  slideSteer: 1.2,
} as const;

const DT = TICK_SECONDS;
const JUMP_SPEED = Math.sqrt(2 * MOVEMENT.gravity * MOVEMENT.jumpHeight);
/** Push into a ladder at least this hard (as a fraction of a full stick) to grab it. */
const LADDER_GRAB = 0.5;
/** Where a climber's center sits in front of the ladder. */
const ON_LADDER = MOVEMENT.radius + 0.05;

// Scratch space, so moving allocates nothing.
const pos = { x: 0, z: 0 };
const grad = { x: 0, z: 0 };
const groundHit: GroundHit = { solid: -1 };
const rayHit = createRayHit();

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
  let prone = false;
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
    // Firing or aiming stops a sprint, and so does putting yourself out.
    // Players carrying over WEIGHT.heavy can't sprint (BW-3).
    sprint =
      input.sprint &&
      !input.fire &&
      !input.aim &&
      my > 0 &&
      (!!c.ai || canSprint(c.load ?? 0)) &&
      staminaToSprint(c);
    crouch = input.crouch && !sprint;
    prone = !!input.prone && !sprint;
    jump = input.jump && !c.jumpHeld;
    c.jumpHeld = input.jump;
    if (input.slide && !c.slide) startSlide(c);
  } else {
    c.jumpHeld = false;
  }
  // Stamina (BW-4): sprinting on the ground drains it, anything else refills it.
  updateStamina(c, sprint && c.mode === 'ground' && !c.slide && my > 0);
  if (c.slide && c.mode !== 'ground') c.slide = null;
  // No jumping out of a slide, nor lying down in one.
  if (c.slide) jump = prone = false;
  let lean = input?.lean !== undefined && Number.isFinite(input.lean) ? input.lean : 0;
  if (sprint || prone || isProne(c) || c.mode !== 'ground' || c.slide) lean = 0;
  if (c.lean || lean) {
    const change = DT / MOVEMENT.leanTime;
    const now = c.lean ?? 0;
    const want = Math.max(-1, Math.min(1, lean));
    c.lean = want > now ? Math.min(want, now + change) : Math.max(want, now - change);
  }

  // The move stick turned into a world direction (length ≤ 1). Forward is −z turned by yaw.
  const sy = Math.sin(c.yaw);
  const cy = Math.cos(c.yaw);
  const wishX = -sy * my + cy * mx;
  const wishZ = -cy * my - sy * mx;

  if (c.mode === 'vault') {
    moveVault(c);
    return;
  }
  // Vaulting works crouched, unlike jumping, but not prone. In the air, holding jump counts.
  const vault = c.mode === 'ground' ? jump : c.mode === 'air' && c.jumpHeld;
  if (vault && !isProne(c) && startVault(c, world)) return;

  const M = MOVEMENT;
  let stance: number = M.standHeight;
  if (c.mode === 'ground' && prone) stance = M.proneHeight;
  else if (c.slide) stance = M.slideHeight;
  else if (c.mode !== 'ladder' && (crouch || prone)) stance = M.crouchHeight;
  updateStance(c, stance, world);
  if (c.mode === 'ladder') climb(c, wishX, wishZ, jump, world);
  else if (!grabLadder(c, wishX, wishZ, world)) walk(c, wishX, wishZ, sprint, jump, world);
}

/**
 * Starts a sprint-slide (AI-7), only for an enemy whose skill has `slide` (Jug), standing
 * on the ground and moving at least MOVEMENT.slideFrom. Allocates only when it starts one.
 */
function startSlide(c: Character): void {
  if (!c.ai?.skill.slide || c.mode !== 'ground' || isCrouched(c)) return;
  const speed = Math.hypot(c.vx, c.vz);
  if (speed < MOVEMENT.slideFrom) return;
  c.slide = { t: 0, dx: c.vx / speed, dz: c.vz / speed };
}

/**
 * One tick of a slide's speed into c.vx, c.vz: slowing evenly, turning a little towards
 * the stick (wishX, wishZ).
 */
function slideVelocity(c: Character, wishX: number, wishZ: number): void {
  const M = MOVEMENT;
  const s = c.slide!;
  s.t += DT;
  if (wishX !== 0 || wishZ !== 0) {
    // The signed angle from the heading to the stick, turned through at most slideSteer.
    const cross = s.dx * wishZ - s.dz * wishX;
    const dot = s.dx * wishX + s.dz * wishZ;
    const turn = Math.max(-M.slideSteer * DT, Math.min(M.slideSteer * DT, Math.atan2(cross, dot)));
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const dx = s.dx * cos - s.dz * sin;
    s.dz = s.dx * sin + s.dz * cos;
    s.dx = dx;
  }
  const k = Math.min(1, s.t / M.slideTime);
  const speed = (M.slideSpeed + (M.slideEndSpeed - M.slideSpeed) * k) * legSpeedScale(c.health);
  c.vx = s.dx * speed;
  c.vz = s.dz * speed;
}

/** Crouched or prone: lower than standing. */
export function isCrouched(c: Character): boolean {
  return c.height < MOVEMENT.standHeight - 1e-6;
}

export function isProne(c: Character): boolean {
  return c.height < MOVEMENT.crouchHeight - 1e-6;
}

/** Eases the capsule height towards the target stance; getting up needs headroom. */
function updateStance(c: Character, target: number, world: CollisionWorld): void {
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
  if (c.mode === 'ground' && c.slide) {
    slideVelocity(c, wishX, wishZ);
    limitSlope(c, world);
  } else if (c.mode === 'ground') {
    const knife = !crouched && c.gear.hand === 'knife' && c.gear.knife ? M.knifeSpeed : 1;
    const crouchSpeed = isProne(c) ? M.proneSpeed : M.crouchSpeed;
    let speed =
      (crouched ? crouchSpeed : sprint ? M.sprintSpeed : M.walkSpeed) *
      knife *
      legSpeedScale(c.health) *
      (c.ai ? 1 : loadSpeed(c.load ?? 0) * (c.burden?.moveSpeed ?? 1));
    if (c.using) speed = Math.min(speed, M.useSpeed);
    if (c.packing) speed = Math.min(speed, M.packSpeed);
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
  keepOutOfDeepWater(c, world);
  // Velocity becomes what actually happened, so walls stop momentum.
  c.vx = (pos.x - c.x) / DT;
  c.vz = (pos.z - c.z) / DT;
  c.x = pos.x;
  c.z = pos.z;
  // A slide ends on time, or against a wall that has stopped it.
  if (c.slide && (c.slide.t >= M.slideTime || Math.hypot(c.vx, c.vz) < M.slideEndSpeed * 0.5))
    c.slide = null;

  if (c.mode === 'ground') {
    if (jump && !crouched) {
      c.vy = JUMP_SPEED;
      c.mode = 'air';
      spendStamina(c, STAMINA.jump);
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
 * How deep the water is under feet at y standing at (x, z): 0 on a solid (a bridge, a
 * tunnel's floor), else the water over the terrain.
 */
function waterUnder(x: number, z: number, y: number, world: CollisionWorld): number {
  world.groundAt(x, z, MOVEMENT.radius, y + MOVEMENT.stepUp, groundHit);
  return groundHit.solid >= 0 ? 0 : world.waterDepth(x, z);
}

/**
 * Deep water stops you like a wall (MT-1): pos may not be deeper than DEEP_WATER, unless
 * you're already in deeper water (put there somehow) and it gets no deeper, so you can
 * wade out. Blocked, it keeps whichever axis of the move it can, so you slide along the
 * bank. Moves pos only.
 */
function keepOutOfDeepWater(c: Character, world: CollisionWorld): void {
  if (world.water.length === 0) return;
  const limit = Math.max(DEEP_WATER, waterUnder(c.x, c.z, c.y, world));
  if (waterUnder(pos.x, pos.z, c.y, world) <= limit) return;
  if (waterUnder(pos.x, c.z, c.y, world) <= limit) pos.z = c.z;
  else if (waterUnder(c.x, pos.z, c.y, world) <= limit) pos.x = c.x;
  else {
    pos.x = c.x;
    pos.z = c.z;
  }
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
  if (groundHit.solid >= 0 || world.terrain.holeAt(c.x, c.z)) return;
  world.terrain.gradientAt(c.x, c.z, grad);
  const g2 = grad.x * grad.x + grad.z * grad.z;
  if (g2 <= MOVEMENT.maxSlope * MOVEMENT.maxSlope) return;
  const up = (c.vx * grad.x + c.vz * grad.z) / g2;
  if (up <= 0) return;
  c.vx -= up * grad.x;
  c.vz -= up * grad.z;
}

/**
 * Starts a vault if the character faces something low and close enough to vault (see
 * MOVEMENT.vaultMax): a window's sill, a low wall, a crate. Found from the collision
 * geometry alone, so any gap that size is vaultable. Allocates only when it starts one.
 */
function startVault(c: Character, world: CollisionWorld): boolean {
  const M = MOVEMENT;
  const fx = -Math.sin(c.yaw);
  const fz = -Math.cos(c.yaw);
  // Something solid in front at knee height, close enough.
  const face = world.raycast(
    c.x,
    c.y + M.stepUp + 0.05,
    c.z,
    fx,
    0,
    fz,
    M.radius + M.vaultReach,
    rayHit,
  );
  if (face === Infinity || rayHit.kind !== 'solid') return false;

  // Walk across its top in 10 cm steps until the floor beyond. Anything taller than
  // vaultMax doesn't count as a top here; the gap check below catches it.
  const low = c.y + M.stepUp;
  let top = -Infinity;
  let bottom = Infinity;
  let depth = -1;
  for (let s = 0.05; s <= M.vaultDepth + 0.1; s += 0.1) {
    const h = world.groundAt(c.x + fx * (face + s), c.z + fz * (face + s), 0.01, c.y + M.vaultMax);
    if (h <= low) {
      depth = s;
      break;
    }
    top = Math.max(top, h);
    bottom = Math.min(bottom, h);
  }
  if (top === -Infinity) return false;
  // Landing on top rather than going over. It has to be flat, so stairs don't count.
  const fits = depth < 0 || (c.mode === 'air' && depth >= 2 * M.radius + 0.1);
  const onto = fits && top - bottom < 0.1;
  if (depth < 0 && !onto) return false;
  const span = onto ? 2 * M.radius + 0.1 : depth;

  // A gap over the top, vaultGap tall and the capsule's width (a window's opening), with
  // the capsule slid sideways (along the face) up to 0.3 m to find it.
  const r = M.radius - 0.01;
  const rx = -fz;
  const rz = fx;
  const mid = face + span / 2;
  let side = NaN;
  for (let i = 0; i <= 24; i++) {
    const off = (i & 1 ? 1 : -1) * Math.ceil(i / 2) * 0.025;
    const x = c.x + fx * mid + rx * off;
    const z = c.z + fz * mid + rz * off;
    if (!world.overlaps(x, z, r, top + 0.01, top + M.vaultGap)) {
      side = off;
      break;
    }
  }
  if (Number.isNaN(side)) return false;
  const sx = c.x + rx * side;
  const sz = c.z + rz * side;
  for (let s = 0.05; s < span; s += 0.1) {
    if (
      world.overlaps(sx + fx * (face + s), sz + fz * (face + s), r, top + 0.01, top + M.vaultGap)
    ) {
      return false;
    }
  }

  // Floor beyond (or the top), with room to stand (or else crouch).
  const land = onto ? face + M.radius + 0.05 : face + depth + M.radius;
  const toX = sx + fx * land;
  const toZ = sz + fz * land;
  const t = world.terrain;
  if (toX < t.minX + M.radius || toX > t.maxX - M.radius) return false;
  if (toZ < t.minZ + M.radius || toZ > t.maxZ - M.radius) return false;
  const floor = onto ? top : world.groundAt(toX, toZ, M.radius, low);
  if (floor < c.y - M.vaultDrop) return false;
  if (!onto && waterUnder(toX, toZ, floor, world) > DEEP_WATER) return false;
  let toHeight = c.height;
  if (world.overlaps(toX, toZ, M.radius, floor + M.stepUp, floor + M.standHeight)) {
    if (world.overlaps(toX, toZ, M.radius, floor + M.stepUp, floor + M.crouchHeight)) return false;
    toHeight = Math.min(toHeight, M.crouchHeight);
  }

  c.mode = 'vault';
  spendStamina(c, STAMINA.vault);
  c.vaulting = {
    fromX: c.x,
    fromY: c.y,
    fromZ: c.z,
    toX,
    toY: floor,
    toZ,
    top,
    fromHeight: c.height,
    toHeight,
    t: 0,
  };
  moveVault(c);
  return true;
}

/** One tick of a vault: an arc over the top, ducking halfway. Nothing collides on the way. */
function moveVault(c: Character): void {
  const M = MOVEMENT;
  const v = c.vaulting;
  if (!v) {
    c.mode = 'air';
    return;
  }
  v.t += DT;
  const k = Math.min(1, v.t / M.vaultTime);
  const arc = Math.sin(Math.PI * k);
  const x = v.fromX + (v.toX - v.fromX) * k;
  const z = v.fromZ + (v.toZ - v.fromZ) * k;
  const y = v.fromY + (v.toY - v.fromY) * k + (v.top - (v.fromY + v.toY) / 2) * Math.max(0, arc);
  c.vx = (x - c.x) / DT;
  c.vy = (y - c.y) / DT;
  c.vz = (z - c.z) / DT;
  c.x = x;
  c.y = y;
  c.z = z;
  const h = v.fromHeight + (v.toHeight - v.fromHeight) * k;
  c.height = h + (Math.min(h, M.vaultDuck) - h) * arc;
  if (k < 1) return;
  c.mode = 'ground';
  c.vaulting = null;
  c.vx = c.vy = c.vz = 0;
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

/** Puts the capsule `front` meters out from the ladder's plane and `side` meters along it. */
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
 * Cuts a lean short where the head would go into a wall (with leanHeadRoom to spare),
 * checked along a ray from the upright eye to the leaned one. Call once everyone has
 * moved. Scaling the lean by the distance left is close enough: the eye's path is nearly
 * straight.
 */
export function fitLean(c: Character, world: CollisionWorld): void {
  if (!c.lean) return;
  const M = MOVEMENT;
  const ox = c.x;
  const oy = c.y + c.height - M.eyeBelowTop;
  const oz = c.z;
  const dx = eyeX(c) - ox;
  const dy = eyeHeight(c) - oy;
  const dz = eyeZ(c) - oz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return;
  const hit = world.raycast(ox, oy, oz, dx / d, dy / d, dz / d, d + M.leanHeadRoom);
  if (hit === Infinity) return;
  c.lean *= Math.max(0, hit - M.leanHeadRoom) / d;
}

/**
 * Pushes overlapping living bodies apart, half each, then out of any wall that put them
 * in. Characters are few, so every pair is checked.
 */
export function separateCharacters(characters: readonly Character[], world: CollisionWorld): void {
  const r2 = MOVEMENT.radius * 2;
  for (let i = 0; i < characters.length; i++) {
    const a = characters[i]!;
    if (a.health.dead || a.mode === 'vault') continue;
    for (let j = i + 1; j < characters.length; j++) {
      const b = characters[j]!;
      if (b.health.dead || b.mode === 'vault' || a.y >= b.y + b.height || b.y >= a.y + a.height)
        continue;
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
  keepOutOfDeepWater(c, world);
  const t = world.terrain;
  c.x = Math.max(t.minX + MOVEMENT.radius, Math.min(t.maxX - MOVEMENT.radius, pos.x));
  c.z = Math.max(t.minZ + MOVEMENT.radius, Math.min(t.maxZ - MOVEMENT.radius, pos.z));
}
