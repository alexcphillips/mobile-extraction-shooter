import { TICK_SECONDS } from '../tick';
import { stomachBlacked } from './health';
import type { Character } from './state';
import { WEIGHT } from './weight';

const DT = TICK_SECONDS;

/**
 * Stamina (BW-4, 2026-11-12; design/movement.md → Stamina): one bar, 0 to 1. Sprinting
 * drains it, jumping and vaulting take a chunk; empty, you can't sprint until it's back
 * over `recover`. It refills when you're not sprinting, faster still than moving, slower
 * over each weight threshold. Low, it shortens your held breath and slows its refill.
 * A blacked stomach (GZ-3) caps it, slows its refill and shortens breath further. Players only: enemies sprint as they always have. First guesses.
 */
export const STAMINA = {
  /** Seconds of sprinting from full to empty. */
  sprint: 18,
  /** What a jump and a vault cost, as a share of the bar. */
  jump: 0.08,
  vault: 0.1,
  /** Once empty, no sprinting until it's back over this. */
  recover: 0.3,
  /** Seconds from empty to full standing still (under `stillSpeed`), and moving. */
  refillStill: 10,
  refillMoving: 16,
  /** The refill's scale over WEIGHT.from, and over WEIGHT.heavy. */
  refillLoaded: 0.75,
  refillHeavy: 0.5,
  /** Under this, held breath runs out faster and refills slower, down to `breathEmpty` at 0. */
  breathFrom: 0.5,
  breathEmpty: 0.5,
  /** Slower than this (m/s) counts as standing still. */
  stillSpeed: 0.5,
  /**
   * A blacked stomach (GZ-3), until surgery: stamina can't refill past `stomachCap`, refills
   * at `stomachRefill` of its rate, and held breath goes `stomachBreath` as far (on top of
   * low stamina's).
   */
  stomachCap: 0.5,
  stomachRefill: 0.5,
  stomachBreath: 0.6,
} as const;

/** Whether a player has the stamina to sprint: not since running dry, until it's over `recover`. */
export function staminaToSprint(c: Character): boolean {
  return !!c.ai || !c.winded;
}

/** Takes a chunk (a jump, a vault) off a player's stamina. Enemies have none to spend. */
export function spendStamina(c: Character, share: number): void {
  if (c.ai) return;
  setStamina(c, (c.stamina ?? 1) - share);
}

/**
 * A tick of a player's stamina: drains while `sprinting`, else refills (see STAMINA).
 * Standing still is judged by last tick's speed.
 */
export function updateStamina(c: Character, sprinting: boolean): void {
  if (c.ai) return;
  const now = c.stamina ?? 1;
  const stomach = stomachBlacked(c.health);
  const cap = stomach ? STAMINA.stomachCap : 1;
  if (sprinting) {
    setStamina(c, Math.min(cap, now - DT / STAMINA.sprint));
    return;
  }
  if (now >= cap) {
    if (now > cap) setStamina(c, cap);
    return;
  }
  const still = Math.hypot(c.vx, c.vz) < STAMINA.stillSpeed;
  const load = c.load ?? 0;
  const loaded =
    (load > WEIGHT.heavy ? STAMINA.refillHeavy : load > WEIGHT.from ? STAMINA.refillLoaded : 1) *
    (stomach ? STAMINA.stomachRefill : 1);
  const time = still ? STAMINA.refillStill : STAMINA.refillMoving;
  setStamina(c, Math.min(cap, now + (DT * loaded) / time));
}

function setStamina(c: Character, value: number): void {
  const v = Math.max(0, Math.min(1, value));
  if (v === 0) c.winded = true;
  else if (c.winded && v >= STAMINA.recover) delete c.winded;
  if (v >= 1) delete c.stamina;
  else c.stamina = v;
}

/**
 * How well a player's breath holds with their stamina (BW-4 on BW-1): 1 down to
 * STAMINA.breathFrom, then less, to STAMINA.breathEmpty when empty. Held breath runs out
 * that much faster and refills that much slower.
 */
export function staminaBreath(c: Character): number {
  const s = c.stamina ?? 1;
  const stomach = stomachBlacked(c.health) ? STAMINA.stomachBreath : 1;
  if (s >= STAMINA.breathFrom) return stomach;
  return stomach * (STAMINA.breathEmpty + ((1 - STAMINA.breathEmpty) * s) / STAMINA.breathFrom);
}
