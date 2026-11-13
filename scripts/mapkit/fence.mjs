// Fence runs (MK-6, 2026-11-12; Silver Creek's yard fences, generalized): a fence prefab
// placed panel by panel along a line, with gaps where panels are broken or missing. Gaps
// are where the fence is crossed, so the test checks that a gap is walked through and a
// panel isn't.
import { prefab, r2 } from './nodes.mjs';

/**
 * Panels from a to b ([x, z]), `bay` meters apart starting at a (a short end is left
 * open), each turned along the line.
 * @param {string} id panels are `${id}-1`, `${id}-2`, …
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @param {{ panel?: string, broken?: string | null, bay?: number, gaps?: number[],
 *   y?: number | ((x: number, z: number) => number) }} [o] `gaps` are panel numbers from 0;
 *   each gets the `broken` prefab, or nothing when it's null. `y` is a height, or the ground
 *   under each panel's middle.
 */
export function fenceRun(id, a, b, o = {}) {
  const { panel = 'picket-fence', broken = 'picket-fence-gap', bay = 3, gaps = [], y = 0 } = o;
  const [x0, z0] = a;
  const [x1, z1] = b;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.floor(len / bay);
  const yaw = r2((Math.atan2(z1 - z0, x1 - x0) * -180) / Math.PI);
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (k * bay + bay / 2) / len;
    const name = gaps.includes(k) ? broken : panel;
    if (!name) continue;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    out.push(
      prefab(
        name,
        x,
        z,
        { id: `${id}-${k + 1}`, ...(yaw ? { yaw } : {}) },
        typeof y === 'function' ? y(x, z) : y,
      ),
    );
  }
  return out;
}
