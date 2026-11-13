// Roads along a polyline (MK-6, 2026-11-12): a drawn strip following the ground, in pieces
// short enough to sit on it, with a disc at each bend to fill the corner. Drawn only, so it
// never stops anyone; ground.mjs grades the terrain level across it first, which is what
// keeps the strip on the ground. A layout road's `points` and `width` serve as they are.
import { along, r2 } from './nodes.mjs';

/**
 * @param {string} id pieces are `${id}-1`, …; bends `${id}-bend-1`, …
 * @param {[number, number][]} points
 * @param {number} width
 * @param {{ groundAt: (x: number, z: number) => number, color: string, piece?: number,
 *   lift?: number }} o `piece` is the longest piece (4 m); `lift` how far over the ground.
 */
export function roadStrip(id, points, width, { groundAt, color, piece = 4, lift = 0.05 }) {
  const out = [];
  const at = (x, z) => [x, groundAt(x, z) + lift, z];
  let k = 0;
  for (let s = 0; s + 1 < points.length; s++) {
    const [ax, az] = points[s];
    const [bx, bz] = points[s + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / piece));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      out.push(
        along(
          at(ax + (bx - ax) * t0, az + (bz - az) * t0),
          at(ax + (bx - ax) * t1, az + (bz - az) * t1),
          r2(width),
          0.04,
          color,
          { id: `${id}-${++k}` },
        ),
      );
    }
  }
  for (let s = 1; s + 1 < points.length; s++) {
    const [x, z] = points[s];
    out.push({
      type: 'cylinder',
      id: `${id}-bend-${s}`,
      pos: [r2(x), r2(groundAt(x, z) + lift - 0.04), r2(z)],
      radius: r2(width / 2),
      height: 0.04,
      sides: 12,
      color,
      collide: false,
    });
  }
  return out;
}
