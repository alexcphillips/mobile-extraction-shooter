// Roads (RD-1, 2026-11-12): drawn by hand in the editor as a few clicked points each, then
// rounded at the corners, given a smooth height along their length and graded into the
// terrain when a map is compiled. The file keeps the ground as shaped, so moving a road
// puts the ground back where it was. No rendering here: the strip is plain numbers.
import type { HeightGridDef } from './terrain';

export const ROAD = {
  /** Asphalt, when a road has no color of its own. */
  color: '#4a4a4d',
  /** Meters each side over which the ground eases back to its own height. */
  shoulder: 4,
  /** Rounded corners' radius, cut down where the legs either side are short. */
  radius: 12,
  /** Meters between samples along the centerline. */
  step: 1,
  /** Half the window the height along a road is smoothed over, in meters. */
  smooth: 10,
  /** How far over the ground the strip is drawn. */
  lift: 0.06,
};

/** The road as the grading needs it (a map file's road has these fields and more). */
export interface RoadSpec {
  points: readonly (readonly [number, number])[];
  width: number;
  shoulder?: number | undefined;
  radius?: number | undefined;
  maxGrade?: number | undefined;
}

/** A road's centerline sampled about every ROAD.step meters, and its height at each sample. */
export interface RoadLine {
  x: number[];
  z: number[];
  y: number[];
}

/**
 * The centerline: straight legs between the clicked points, each corner replaced by an arc
 * of `radius` (smaller where a leg is short: an arc takes at most half of either leg),
 * sampled about every `step` meters. It passes through the first and last points exactly,
 * so a road ending on another's centerline meets it.
 */
export function centerline(
  points: readonly (readonly [number, number])[],
  radius = ROAD.radius,
  step = ROAD.step,
): { x: number[]; z: number[] } {
  // Each corner as (where the arc starts, where it ends, its middle and radius) or the point.
  const path: { x: number; z: number }[] = [{ x: points[0]![0], z: points[0]![1] }];
  for (let k = 1; k + 1 < points.length; k++) {
    const [px, pz] = points[k - 1]!;
    const [cx, cz] = points[k]!;
    const [nx, nz] = points[k + 1]!;
    const la = Math.hypot(cx - px, cz - pz);
    const lb = Math.hypot(nx - cx, nz - cz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const ux = (cx - px) / la;
    const uz = (cz - pz) / la;
    const vx = (nx - cx) / lb;
    const vz = (nz - cz) / lb;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (radius <= 0 || turn < 1e-3) {
      path.push({ x: cx, z: cz });
      continue;
    }
    // Tangent length for the radius, kept to half of either leg.
    const tan = Math.tan(turn / 2);
    const t = Math.min(radius * tan, la / 2, lb / 2);
    const r = t / tan;
    const ax = cx - ux * t;
    const az = cz - uz * t;
    // The arc's middle is off the start along the inward normal ((−uz, ux) turns +x to +z).
    const side = Math.sign(ux * vz - uz * vx);
    const ox = ax - uz * side * r;
    const oz = az + ux * side * r;
    const a0 = Math.atan2(az - oz, ax - ox);
    const n = Math.max(2, Math.ceil((r * turn) / step));
    for (let i = 0; i <= n; i++) {
      const a = a0 + side * turn * (i / n);
      path.push({ x: ox + Math.cos(a) * r, z: oz + Math.sin(a) * r });
    }
  }
  const last = points[points.length - 1]!;
  path.push({ x: last[0], z: last[1] });
  // Resample the straight legs; arc points are already close enough.
  const x: number[] = [path[0]!.x];
  const z: number[] = [path[0]!.z];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const b = path[k]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= n; i++) {
      x.push(a.x + ((b.x - a.x) * i) / n);
      z.push(a.z + ((b.z - a.z) * i) / n);
    }
  }
  return { x, z };
}

/** A grid's height at (x, z), split into triangles the way HeightGrid splits them. */
function heightIn(t: HeightGridDef, h: ArrayLike<number>, x: number, z: number): number {
  const fx = (x - t.minX) / t.cellSize;
  const fz = (z - t.minZ) / t.cellSize;
  const i = Math.min(t.cols - 1, Math.max(0, Math.floor(fx)));
  const j = Math.min(t.rows - 1, Math.max(0, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - i));
  const v = Math.min(1, Math.max(0, fz - j));
  const c = t.cols + 1;
  const k = j * c + i;
  if (u + v <= 1) return h[k]! + (h[k + 1]! - h[k]!) * u + (h[k + c]! - h[k]!) * v;
  const h11 = h[k + c + 1]!;
  return h11 + (h[k + c]! - h11) * (1 - u) + (h[k + 1]! - h11) * (1 - v);
}

/**
 * Grades `roads` into the corner heights `heights` (changed in place, laid out as `t`'s), in
 * order, and returns each one's centerline with its heights. Each road:
 * - reads the ground along its centerline, keeping the heights where it runs over an
 *   earlier road's surface (so a road joining another meets it level), and smooths the rest
 *   (and holds it to `maxGrade` if it has one);
 * - sets every corner within half its width plus a cell and a half (so every cell under the
 *   strip is level across) to that height, unless an earlier road's surface has it;
 * - eases the ground back over its shoulder.
 * An earlier road wins where two cross: list the main roads first.
 */
export function gradeRoads(
  t: HeightGridDef,
  heights: { [k: number]: number; length: number },
  roads: readonly RoadSpec[],
): RoadLine[] {
  const c = t.cols + 1;
  const corners = c * (t.rows + 1);
  /** 0 untouched, 1 on a shoulder, 2 under a road's surface. */
  const claim = new Uint8Array(corners);
  const bestD = new Float64Array(corners).fill(Infinity);
  const bestY = new Float64Array(corners);
  const touched: number[] = [];
  const pad = t.cellSize * 1.5;
  const lines: RoadLine[] = [];
  for (const road of roads) {
    const { x, z } = centerline(road.points, road.radius ?? ROAD.radius);
    const n = x.length;
    const y = new Array<number>(n);
    const pinned = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      y[k] = heightIn(t, heights, x[k]!, z[k]!);
      // On an earlier road's surface if every corner of the cell under it is.
      const i = Math.min(t.cols - 1, Math.max(0, Math.floor((x[k]! - t.minX) / t.cellSize)));
      const j = Math.min(t.rows - 1, Math.max(0, Math.floor((z[k]! - t.minZ) / t.cellSize)));
      const q = j * c + i;
      if (claim[q] === 2 && claim[q + 1] === 2 && claim[q + c] === 2 && claim[q + c + 1] === 2)
        pinned[k] = 1;
    }
    // Smoothed: three box passes (close to a Gaussian), pinned samples held.
    const half = Math.max(1, Math.round(ROAD.smooth / ROAD.step));
    const fixed = y.slice();
    const tmp = new Array<number>(n);
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < n; k++) {
        let s = 0;
        let m = 0;
        for (let d = -half; d <= half; d++) {
          const q = Math.min(n - 1, Math.max(0, k + d));
          s += y[q]!;
          m++;
        }
        tmp[k] = pinned[k] ? fixed[k]! : s / m;
      }
      for (let k = 0; k < n; k++) y[k] = tmp[k]!;
    }
    if (road.maxGrade) {
      const g = road.maxGrade;
      for (let k = 1; k < n; k++) {
        const d = Math.hypot(x[k]! - x[k - 1]!, z[k]! - z[k - 1]!) * g;
        y[k] = Math.min(y[k - 1]! + d, Math.max(y[k - 1]! - d, y[k]!));
      }
      for (let k = n - 2; k >= 0; k--) {
        const d = Math.hypot(x[k]! - x[k + 1]!, z[k]! - z[k + 1]!) * g;
        y[k] = Math.min(y[k + 1]! + d, Math.max(y[k + 1]! - d, y[k]!));
      }
      for (let k = 0; k < n; k++) if (pinned[k]) y[k] = fixed[k]!;
    }
    // Each corner near the road: how far from the centerline, and the height there.
    const band = road.width / 2 + pad;
    const shoulder = road.shoulder ?? ROAD.shoulder;
    const reach = band + shoulder;
    for (let k = 0; k + 1 < n; k++) {
      const ax = x[k]!;
      const az = z[k]!;
      const dx = x[k + 1]! - ax;
      const dz = z[k + 1]! - az;
      const len2 = dx * dx + dz * dz;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, ax + dx) - reach - t.minX) / t.cellSize));
      const i1 = Math.min(
        t.cols,
        Math.floor((Math.max(ax, ax + dx) + reach - t.minX) / t.cellSize),
      );
      const j0 = Math.max(0, Math.ceil((Math.min(az, az + dz) - reach - t.minZ) / t.cellSize));
      const j1 = Math.min(
        t.rows,
        Math.floor((Math.max(az, az + dz) + reach - t.minZ) / t.cellSize),
      );
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const px = t.minX + i * t.cellSize - ax;
          const pz = t.minZ + j * t.cellSize - az;
          const u = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + pz * dz) / len2)) : 0;
          const d = Math.hypot(px - dx * u, pz - dz * u);
          if (d > reach) continue;
          const q = j * c + i;
          if (bestD[q] === Infinity) touched.push(q);
          if (d < bestD[q]!) {
            bestD[q] = d;
            bestY[q] = y[k]! + (y[k + 1]! - y[k]!) * u;
          }
        }
      }
    }
    // Claimed after reading them all, so this road's own corners don't pin it.
    for (const q of touched) {
      const d = bestD[q]!;
      if (claim[q] !== 2) {
        if (d <= band) {
          heights[q] = bestY[q]!;
          claim[q] = 2;
        } else if (shoulder > 0) {
          const s = (d - band) / shoulder;
          const e = s * s * (3 - 2 * s);
          heights[q] = bestY[q]! + (heights[q]! - bestY[q]!) * e;
          claim[q] = 1;
        }
      }
      bestD[q] = Infinity;
    }
    touched.length = 0;
    lines.push({ x, z, y });
  }
  return lines;
}

/**
 * The strip a road is drawn as: for each centerline sample, its left and right edge
 * (x, y, z each) on the graded ground, ROAD.lift over it. Six numbers a sample.
 */
export function roadStrip(
  t: HeightGridDef,
  heights: ArrayLike<number>,
  line: RoadLine,
  width: number,
): number[] {
  const out: number[] = [];
  const n = line.x.length;
  const w = width / 2;
  for (let k = 0; k < n; k++) {
    // Across: square to the line through the samples either side.
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);
    let dx = line.x[b]! - line.x[a]!;
    let dz = line.z[b]! - line.z[a]!;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    for (const s of [-1, 1]) {
      const px = line.x[k]! - dz * w * s;
      const pz = line.z[k]! + dx * w * s;
      out.push(px, heightIn(t, heights, px, pz) + ROAD.lift, pz);
    }
  }
  return out;
}
