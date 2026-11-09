/*
 * Rotational aim assist for a controller (2026-11-08, the user's OK: "standard controller
 * stuff"). While the crosshair is on an enemy and the player is steering (either stick
 * pushed), the view turns with the enemy by a share of how fast it crosses the view, as
 * console shooters do. The enemy's own movement and the player's strafing both count, so
 * strafing past someone keeps the crosshair near them. Pure, so it can be tested.
 */

/** The share of the target's movement across the view followed, by aim assist level, while aiming. */
export const PAD_FOLLOW = { off: 0, low: 0.3, medium: 0.45, high: 0.6 } as const;
/** From the hip, this much of it. */
export const HIP_FOLLOW = 0.5;
/** The fastest it ever turns the view, radians per second, so a close target never yanks it. */
export const FOLLOW_MAX = 1.5;

/** The yaw and pitch (the game's convention: yaw 0 looks down −z) from an eye to a point. */
export function bearing(
  ex: number,
  ey: number,
  ez: number,
  x: number,
  y: number,
  z: number,
  out: { yaw: number; pitch: number },
): void {
  const dx = x - ex;
  const dz = z - ez;
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.atan2(y - ey, Math.hypot(dx, dz));
}

/** An angle wrapped to −π..π. */
export function wrapAngle(a: number): number {
  return a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
}

/**
 * The follow rate in radians per second (yaw, pitch) from the target's bearing a tick
 * apart (`dt` seconds), at `share` of its speed across the view, capped at FOLLOW_MAX.
 */
export function followRate(
  prev: { yaw: number; pitch: number },
  now: { yaw: number; pitch: number },
  dt: number,
  share: number,
  out: { yaw: number; pitch: number },
): void {
  const cap = (v: number): number => Math.max(-FOLLOW_MAX, Math.min(FOLLOW_MAX, v));
  out.yaw = cap((wrapAngle(now.yaw - prev.yaw) / dt) * share);
  out.pitch = cap(((now.pitch - prev.pitch) / dt) * share);
}
