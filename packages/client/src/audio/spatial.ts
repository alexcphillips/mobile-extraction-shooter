/*
 * Where a sound seems to come from (session 19): loudness by distance, left and right by
 * direction, and muffling by distance, from behind and through walls. Worked out here,
 * once per sound as it starts, rather than by Web Audio's PannerNode, whose HRTF mode is
 * too dear for the phone and whose equal-power mode does no more than this.
 */

export const SPATIAL = {
  /** The highest a filter goes: as good as none. */
  open: 20_000,
  /** Muffled to this at the edge of its range. */
  far: 700,
  /** Behind a wall: muffled to at most this, and quieter. */
  occludedCutoff: 600,
  occludedGain: 0.45,
  /** From behind: a little muffled and quieter, so front and back differ. */
  behindCutoff: 0.6,
  behindGain: 0.85,
  /** How far left or right it goes at most (1 is one ear only). */
  pan: 0.8,
  /** Beyond this, loudness falls off for distance as well as for range. */
  near: 40,
} as const;

/** Where and which way the player hears from. yaw 0 faces −z, as for characters. */
export interface Listener {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** How to play a sound: written into, so placing one allocates nothing. */
export interface Placement {
  gain: number;
  /** −1 left to 1 right. */
  pan: number;
  /** A lowpass filter's frequency. */
  cutoff: number;
}

/**
 * Places a sound at (x, y, z) heard as far as `range`: false when it's out of range.
 * Loudness falls to nothing at the range (squared, so most of it is near), and also
 * with distance beyond SPATIAL.near, so a loud far shot is still a far one.
 */
export function place(
  out: Placement,
  l: Listener,
  x: number,
  y: number,
  z: number,
  range: number,
  occluded: boolean,
): boolean {
  const dx = x - l.x;
  const dy = y - l.y;
  const dz = z - l.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= range) return false;
  const left = 1 - d / range;
  out.gain = left * left * (SPATIAL.near / (SPATIAL.near + d));
  out.cutoff = SPATIAL.open * Math.pow(SPATIAL.far / SPATIAL.open, d / range);
  const flat = Math.hypot(dx, dz);
  if (flat > 1e-3) {
    const sy = Math.sin(l.yaw);
    const cy = Math.cos(l.yaw);
    const right = (dx * cy - dz * sy) / flat;
    const ahead = (-dx * sy - dz * cy) / flat;
    out.pan = right * SPATIAL.pan;
    if (ahead < 0) {
      // Fades in from the side to straight behind.
      out.cutoff *= 1 + (SPATIAL.behindCutoff - 1) * -ahead;
      out.gain *= 1 + (SPATIAL.behindGain - 1) * -ahead;
    }
  } else out.pan = 0;
  if (occluded) {
    out.cutoff = Math.min(out.cutoff, SPATIAL.occludedCutoff);
    out.gain *= SPATIAL.occludedGain;
  }
  return true;
}
