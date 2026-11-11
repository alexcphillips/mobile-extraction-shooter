/*
 * Controller rumble (CP-3, 2026-11-08): short dual-rumble pulses for firing, being hit and
 * explosions, through `Gamepad.vibrationActuator` (Chrome and Edge; Firefox has none, so
 * nothing happens there). The sizes are plain functions, tested; `Rumbler` plays them,
 * letting a weaker pulse not cut short a stronger one still running.
 */

/** One pulse: the strong (low, heavy) and weak (high, buzzy) motors, 0..1, for `ms`. */
export interface Pulse {
  strong: number;
  weak: number;
  ms: number;
}

/** A kick up (`recoil.up`) this big or more fires at full rumble: a pump shotgun, the AWM. */
const FULL_KICK = 6;

/**
 * Firing your own gun: sized by its kick up (`recoil.up`: about 0.9 for an SMG, 1.4 for an
 * AK, 3 for a pistol, 6 for a pump shotgun), on a square root so light guns still buzz.
 * Short, so a full-auto gun at 10 rounds a second still feels like separate shots.
 */
export function firePulse(kickUp: number, out: Pulse): Pulse {
  const k = Math.sqrt(clamp01(kickUp / FULL_KICK));
  out.strong = 0.1 + 0.5 * k;
  out.weak = 0.35 + 0.35 * k;
  out.ms = 45 + 45 * k;
  return out;
}

/** Being hurt: `amount` HP lost (after armor). A graze is a bump, a 40+ hit a heavy jolt. */
export function hitPulse(amount: number, out: Pulse): Pulse {
  const k = clamp01(amount / 40);
  out.strong = 0.35 + 0.65 * k;
  out.weak = 0.2 + 0.3 * k;
  out.ms = 90 + 160 * k;
  return out;
}

/** How far past a blast's damage radius it's still felt, as a multiple of the radius. */
export const BLAST_FELT = 4;

/**
 * An explosion `distance` meters away with a damage radius `radius`: full inside the
 * radius, fading to nothing at BLAST_FELT radii. `strong` 0 means too far to feel.
 */
export function blastPulse(distance: number, radius: number, out: Pulse): Pulse {
  const r = Math.max(radius, 0.5);
  const k = distance <= r ? 1 : clamp01(1 - (distance - r) / (r * (BLAST_FELT - 1)));
  out.strong = k;
  out.weak = 0.6 * k;
  out.ms = k > 0 ? 150 + 350 * k : 0;
  return out;
}

/** The part of the actuator's API used here (lib.dom's types vary between versions). */
interface Actuator {
  playEffect(type: 'dual-rumble', params: Record<string, number>): Promise<unknown>;
}

/** What a pad offers to rumble with, if anything. */
function actuatorOf(gp: Gamepad | null): Actuator | null {
  const a = (gp as { vibrationActuator?: Partial<Actuator> | null } | null)?.vibrationActuator;
  return a && typeof a.playEffect === 'function' ? (a as Actuator) : null;
}

/** Plays pulses on a pad, a weaker one never cutting short a stronger one still running. */
export class Rumbler {
  /** When the running pulse ends (ms, performance.now()), and how strong it is. */
  private until = 0;
  private strength = 0;
  /** Reused for every effect, so nothing is allocated per pulse but the browser's promise. */
  private readonly params = { duration: 0, startDelay: 0, strongMagnitude: 0, weakMagnitude: 0 };

  /** Plays `p` on `gp` at `now`, unless a stronger pulse is still running; true if it did. */
  play(gp: Gamepad | null, p: Pulse, now: number): boolean {
    if (p.ms <= 0 || (p.strong <= 0 && p.weak <= 0)) return false;
    const strength = Math.max(p.strong, p.weak);
    if (now < this.until && strength < this.strength) return false;
    const act = actuatorOf(gp);
    if (!act) return false;
    this.params.duration = Math.round(p.ms);
    this.params.strongMagnitude = clamp01(p.strong);
    this.params.weakMagnitude = clamp01(p.weak);
    // A newer effect makes the browser reject the older one's promise ("preempted").
    act.playEffect('dual-rumble', this.params).catch(() => {});
    this.until = now + p.ms;
    this.strength = strength;
    return true;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
