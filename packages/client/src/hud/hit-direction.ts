/*
 * Where a hit came from (TU-1, 2026-11-09, the user's call: being shot as in Tarkov): a red
 * arc around the middle of the screen, pointing at where the shot, knife or blast came from.
 * It follows as you turn, holds a moment, then fades. Hits from about the same way share an
 * arc, so a shotgun's pellets or a burst are one. A few arcs, made once and reused, so a
 * firefight allocates nothing but their transforms.
 */

/** How many arcs at once; a new one past this takes the oldest's place. */
const ARCS = 4;
/** Seconds an arc shows at full strength, then fades over FADE. */
const HOLD = 0.5;
const FADE = 1;
/** Hits within this angle (radians) of an arc's source refresh it rather than add one. */
const SAME_WAY = (25 * Math.PI) / 180;

/**
 * Where a source at (sx, sz) is from a viewer at (x, z) facing `yaw`, as an angle on the
 * screen: 0 straight ahead (the top), clockwise, in (-π, π]. Yaw 0 faces −z and turns left
 * as it grows, as the camera does.
 */
export function hitBearing(yaw: number, x: number, z: number, sx: number, sz: number): number {
  const toward = Math.atan2(-(sx - x), -(sz - z));
  return wrap(yaw - toward);
}

/** An angle into (-π, π]. */
function wrap(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a === 0 ? Math.PI : a - Math.PI;
}

/** How strong an arc `age` seconds old shows, 1 to 0. */
export function arcStrength(age: number): number {
  if (age < 0) return 0;
  if (age <= HOLD) return 1;
  return Math.max(0, 1 - (age - HOLD) / FADE);
}

interface Arc {
  el: HTMLElement;
  /** Where the hit came from, in the world. */
  x: number;
  z: number;
  /** When it was hit (seconds), or -Infinity when free. */
  at: number;
  /** What was last written to the element, so a still arc writes nothing. */
  shown: number;
  turned: number;
}

export class HitDirection {
  private readonly arcs: Arc[] = [];

  constructor(root: HTMLElement) {
    for (let i = 0; i < ARCS; i++) {
      const el = document.createElement('div');
      el.className = 'hit-arc';
      root.append(el);
      this.arcs.push({ el, x: 0, z: 0, at: -Infinity, shown: 0, turned: NaN });
    }
  }

  /** A hit on the viewer at (x, z) from (sx, sz), at `now` seconds. */
  hit(x: number, z: number, sx: number, sz: number, now: number): void {
    // Hit from right where you stand (your own grenade at your feet): no way to point.
    if (Math.hypot(sx - x, sz - z) < 0.5) return;
    const way = hitBearing(0, x, z, sx, sz);
    let pick: Arc | null = null;
    for (const a of this.arcs) {
      if (arcStrength(now - a.at) <= 0) continue;
      if (Math.abs(wrap(hitBearing(0, x, z, a.x, a.z) - way)) < SAME_WAY) {
        pick = a;
        break;
      }
    }
    if (!pick) {
      pick = this.arcs[0]!;
      for (const a of this.arcs) if (a.at < pick.at) pick = a;
    }
    pick.x = sx;
    pick.z = sz;
    pick.at = now;
  }

  /** Each frame: turns the arcs to follow the viewer at (x, z) facing `yaw`, and fades them. */
  update(yaw: number, x: number, z: number, now: number): void {
    for (const a of this.arcs) {
      const strength = arcStrength(now - a.at);
      if (strength !== a.shown) {
        a.shown = strength;
        a.el.style.opacity = String(strength);
      }
      if (strength <= 0) continue;
      const turned = Math.round(hitBearing(yaw, x, z, a.x, a.z) * 500) / 500;
      if (turned !== a.turned) {
        a.turned = turned;
        a.el.style.transform = `translate(-50%, -50%) rotate(${turned}rad) translateY(var(--hit-arc-radius))`;
      }
    }
  }

  /** Hides every arc (the raid ended, or the view moved to someone else). */
  clear(): void {
    for (const a of this.arcs) a.at = -Infinity;
  }
}
