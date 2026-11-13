// The terrain grid (MK-6, 2026-11-12, moved out of gen-silver-creek.mjs): corner heights
// sampled from a height function, and the ground under a point as the game interpolates it.

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * A terrain grid of cols × rows cells from `origin`, its corners at height(x, z).
 * @param {{ origin: [number, number], cellSize: number, cols: number, rows: number,
 *   height: (x: number, z: number) => number }} o
 */
export function terrainGrid({ origin, cellSize, cols, rows, height }) {
  const heights = [];
  for (let j = 0; j <= rows; j++) {
    const row = [];
    for (let i = 0; i <= cols; i++)
      row.push(height(origin[0] + i * cellSize, origin[1] + j * cellSize));
    heights.push(row);
  }
  /** The ground under a point, bilinear over its cell. */
  function groundAt(x, z) {
    const fx = (x - origin[0]) / cellSize;
    const fz = (z - origin[1]) / cellSize;
    const i = Math.min(cols - 1, Math.max(0, Math.floor(fx)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor(fz)));
    const u = fx - i;
    const v = fz - j;
    const h00 = heights[j][i];
    const h10 = heights[j][i + 1];
    const h01 = heights[j + 1][i];
    const h11 = heights[j + 1][i + 1];
    return lerp(lerp(h00, h10, u), lerp(h01, h11, u), v);
  }
  /** Lowest and highest ground under a rectangle (sampled every meter). */
  function groundRange(x0, z0, x1, z1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = x0; x <= x1 + 1e-6; x += Math.min(1, x1 - x0 || 1)) {
      for (let z = z0; z <= z1 + 1e-6; z += Math.min(1, z1 - z0 || 1)) {
        const h = groundAt(x, z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    return [lo, hi];
  }
  /**
   * Cells steeper than `limit` (rise over run along a side or a diagonal; 1 is 45°, the
   * most anyone walks up), as [x, z, slope] at their middles. `skip(x, z)` leaves one out.
   */
  function steepCells(limit = 1, skip = () => false) {
    const out = [];
    const c = cellSize;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const [a, b, d, e] = [
          heights[j][i],
          heights[j][i + 1],
          heights[j + 1][i],
          heights[j + 1][i + 1],
        ];
        const s = Math.max(
          Math.abs(b - a) / c,
          Math.abs(e - d) / c,
          Math.abs(d - a) / c,
          Math.abs(e - b) / c,
          Math.abs(e - a) / (c * Math.SQRT2),
          Math.abs(d - b) / (c * Math.SQRT2),
        );
        const x = origin[0] + (i + 0.5) * c;
        const z = origin[1] + (j + 0.5) * c;
        if (s > limit && !skip(x, z)) out.push([x, z, s]);
      }
    return out;
  }
  /** The map's `terrain` field. */
  const node = (color, holes) => ({
    origin,
    cellSize,
    heights,
    ...(holes ? { holes } : {}),
    color,
  });
  return { heights, groundAt, groundRange, steepCells, node, origin, cellSize, cols, rows };
}
