import { nextFloat } from '../rng';
import { TICK_SECONDS } from '../tick';
import { isCrouched, isProne } from './movement';
import type { Character, SimState } from './state';

/*
 * Recoil (2026-11-04, the user's spec, after Delta Force and Tarkov): each shot kicks a
 * target up and randomly sideways, the first of a burst harder; the target wears off at the
 * gun's recovery rate, and the gun (Character.recoilPitch/recoilYaw) chases it on a damped
 * spring at the gun's snap. So snap is how fast a kick lands and recovery how fast it
 * settles, separately. Stance and movement scale every kick. All of it runs at the fixed
 * tick, so co-op hosts agree; the frame splits the result between the view and the gun.
 */

const DT = TICK_SECONDS;
const DEG = Math.PI / 180;

/** Recoil tuning. Guns set their own kick, snap and recovery (content/items). */
export const RECOIL = {
  /** The first round of a burst kicks this much harder, so a tap needs control too. */
  firstShot: 1.4,
  /** Seconds off the trigger before the burst is over: the next round is a first round again. */
  resetTime: 0.25,
  /** Once the burst is over, recovery is this much faster, so the gun comes back down. */
  afterBurst: 4,
  /** The spring's damping ratio, below 1: the gun overshoots each kick a little. */
  damping: 0.6,
  /** The kick never climbs higher than this, in degrees. */
  maxUp: 20,
  /** Kick multipliers by stance; standing is 1. */
  crouched: 0.75,
  prone: 0.5,
  /** Kick multiplier moving faster than movingSpeed (m/s), on top of stance. */
  moving: 1.35,
  movingSpeed: 0.5,
  /** Snap and recovery with no gun in hand (switched to the knife mid-burst). */
  unarmedSnap: 30,
  unarmedRecovery: 6,
  /** Below this (radians, and radians a second) it has settled, and snaps to 0. */
  rest: 1e-5,
};

/** A character's recoil spring, made at its first shot. Angles in radians. */
export interface RecoilState {
  /** Where the kicks have pushed the gun; it wears off to 0 and the gun chases it. */
  kickPitch: number;
  kickYaw: number;
  /** How fast recoilPitch and recoilYaw are moving, in radians a second. */
  speedPitch: number;
  speedYaw: number;
  /** Rounds fired since the trigger was last let go for RECOIL.resetTime. */
  shots: number;
  /**
   * kickPitch just after the gun's stableAfter round, the most the rest of the burst climbs
   * to. Missing (older saves) holds wherever the burst is.
   */
  hold?: number;
  /** Seconds since the trigger was let go. */
  idle: number;
}

export function createRecoil(): RecoilState {
  return { kickPitch: 0, kickYaw: 0, speedPitch: 0, speedYaw: 0, shots: 0, idle: 0 };
}

/** How hard the character's stance and movement make each kick, as a multiplier. */
export function recoilScale(c: Character): number {
  const stance = isProne(c) ? RECOIL.prone : isCrouched(c) ? RECOIL.crouched : 1;
  return Math.hypot(c.vx, c.vz) > RECOIL.movingSpeed ? stance * RECOIL.moving : stance;
}

/**
 * One round's kick, scaled by stance and the burst: up degrees along angle (degrees off
 * straight up, + right), and up to side either way at random. Past round stableAfter (0:
 * never) the kick along angle only tops the gun back up to where that round left it.
 */
export function kickRecoil(
  state: SimState,
  c: Character,
  up: number,
  side: number,
  angle = 0,
  stableAfter = 0,
): void {
  const r = (c.recoil ??= createRecoil());
  const scale = (r.shots === 0 ? RECOIL.firstShot : 1) * recoilScale(c) * DEG;
  r.shots++;
  const rise = up * scale * Math.cos(angle * DEG);
  let along = 1;
  if (stableAfter > 0 && r.shots > stableAfter && rise > 0) {
    along = Math.max(0, Math.min(1, ((r.hold ?? r.kickPitch) - r.kickPitch) / rise));
  }
  r.kickPitch = Math.min(RECOIL.maxUp * DEG, r.kickPitch + rise * along);
  r.kickYaw +=
    up * scale * Math.sin(angle * DEG) * along + side * scale * (nextFloat(state.rng) * 2 - 1);
  if (r.shots === stableAfter) r.hold = r.kickPitch;
}

// springStep's result, so settling allocates nothing.
let springX = 0;
let springV = 0;

/**
 * One tick of a damped spring pulling x (moving at v) towards to, at natural frequency w
 * (radians a second). Solved exactly rather than stepped, so a stiff spring stays stable at
 * the 30 Hz tick.
 */
function springStep(x: number, v: number, to: number, w: number): void {
  const z = RECOIL.damping;
  const wd = w * Math.sqrt(1 - z * z);
  const d = x - to;
  const b = (v + z * w * d) / wd;
  const e = Math.exp(-z * w * DT);
  const cos = Math.cos(wd * DT);
  const sin = Math.sin(wd * DT);
  springX = to + e * (d * cos + b * sin);
  springV = e * (v * cos - (z * w * b + wd * d) * sin);
}

/**
 * One tick of recoil settling, after the tick's shots: the kick wears off at recovery (per
 * second; RECOIL.afterBurst times that once the burst is over) and the gun springs after it
 * at snap. trigger is whether it's held this tick.
 */
export function settleRecoil(c: Character, snap: number, recovery: number, trigger: boolean): void {
  let r = c.recoil;
  if (!r) {
    // Never fired; an older save may still have recoil from before the spring.
    if (c.recoilPitch === 0 && c.recoilYaw === 0) return;
    r = c.recoil = createRecoil();
  }
  r.idle = trigger ? 0 : r.idle + DT;
  const over = r.idle >= RECOIL.resetTime;
  if (over) r.shots = 0;
  const keep = Math.exp(-recovery * (over ? RECOIL.afterBurst : 1) * DT);
  r.kickPitch *= keep;
  r.kickYaw *= keep;
  springStep(c.recoilPitch, r.speedPitch, r.kickPitch, snap);
  c.recoilPitch = springX;
  r.speedPitch = springV;
  springStep(c.recoilYaw, r.speedYaw, r.kickYaw, snap);
  c.recoilYaw = springX;
  r.speedYaw = springV;
  const rest = RECOIL.rest;
  if (
    !trigger &&
    Math.abs(r.kickPitch) < rest &&
    Math.abs(r.kickYaw) < rest &&
    Math.abs(c.recoilPitch) < rest &&
    Math.abs(c.recoilYaw) < rest &&
    Math.abs(r.speedPitch) < rest &&
    Math.abs(r.speedYaw) < rest
  ) {
    c.recoilPitch = c.recoilYaw = 0;
    r.kickPitch = r.kickYaw = r.speedPitch = r.speedYaw = 0;
  }
}
