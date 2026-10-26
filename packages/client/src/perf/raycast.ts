/**
 * Raycasts against boxes rotated about Y, through a uniform XZ grid.
 * A throwaway stand-in to measure raycast cost on the phone; the real
 * collision and raycasts are written in shared in session 3.
 */

/** A box: centre, half-extents and rotation about Y (three.js convention). */
export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
}

const STRIDE = 8; // cx, cy, cz, hx, hy, hz, cos, sin

export class BoxGrid {
  private readonly data: Float32Array;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellStart: Uint32Array;
  private readonly cellItems: Uint32Array;
  private readonly stamps: Uint32Array;
  private stamp = 0;

  constructor(
    boxes: readonly Box[],
    private readonly minX: number,
    private readonly minZ: number,
    size: number,
    private readonly cellSize: number,
  ) {
    this.cols = Math.ceil(size / cellSize);
    this.rows = this.cols;
    this.data = new Float32Array(boxes.length * STRIDE);
    this.stamps = new Uint32Array(boxes.length);

    // Two passes (count, then fill) into a compressed cell → items table.
    const counts = new Uint32Array(this.cols * this.rows + 1);
    const ranges: number[] = [];
    boxes.forEach((b, i) => {
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      this.data.set([b.x, b.y, b.z, b.hx, b.hy, b.hz, c, s], i * STRIDE);
      const ex = Math.abs(c) * b.hx + Math.abs(s) * b.hz;
      const ez = Math.abs(s) * b.hx + Math.abs(c) * b.hz;
      const c0 = this.col(b.x - ex);
      const c1 = this.col(b.x + ex);
      const r0 = this.row(b.z - ez);
      const r1 = this.row(b.z + ez);
      ranges.push(c0, c1, r0, r1);
      for (let r = r0; r <= r1; r++)
        for (let q = c0; q <= c1; q++) counts[r * this.cols + q + 1]!++;
    });
    for (let i = 1; i < counts.length; i++) counts[i]! += counts[i - 1]!;
    this.cellStart = counts.slice();
    this.cellItems = new Uint32Array(counts[counts.length - 1]!);
    const fill = counts;
    boxes.forEach((_, i) => {
      const [c0, c1, r0, r1] = ranges.slice(i * 4, i * 4 + 4) as [number, number, number, number];
      for (let r = r0; r <= r1; r++)
        for (let q = c0; q <= c1; q++) this.cellItems[fill[r * this.cols + q]!++] = i;
    });
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
  }

  private row(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cellSize)));
  }

  /** Distance to the first box hit along a unit direction, or Infinity. Allocates nothing. */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ): number {
    this.stamp++;
    let best = maxDist;

    // Amanatides–Woo walk over the XZ cells the ray crosses.
    let q = this.col(ox);
    let r = this.row(oz);
    const stepQ = dx > 0 ? 1 : -1;
    const stepR = dz > 0 ? 1 : -1;
    const tDeltaQ = dx !== 0 ? this.cellSize / Math.abs(dx) : Infinity;
    const tDeltaR = dz !== 0 ? this.cellSize / Math.abs(dz) : Infinity;
    const edgeX = this.minX + (q + (dx > 0 ? 1 : 0)) * this.cellSize;
    const edgeZ = this.minZ + (r + (dz > 0 ? 1 : 0)) * this.cellSize;
    let tMaxQ = dx !== 0 ? (edgeX - ox) / dx : Infinity;
    let tMaxR = dz !== 0 ? (edgeZ - oz) / dz : Infinity;

    for (;;) {
      const cell = r * this.cols + q;
      for (let k = this.cellStart[cell]!, end = this.cellStart[cell + 1]!; k < end; k++) {
        const i = this.cellItems[k]!;
        if (this.stamps[i] === this.stamp) continue;
        this.stamps[i] = this.stamp;
        const t = this.rayBox(i, ox, oy, oz, dx, dy, dz);
        if (t < best) best = t;
      }
      const tExit = Math.min(tMaxQ, tMaxR);
      if (tExit >= best) break;
      if (tMaxQ < tMaxR) {
        q += stepQ;
        tMaxQ += tDeltaQ;
        if (q < 0 || q >= this.cols) break;
      } else {
        r += stepR;
        tMaxR += tDeltaR;
        if (r < 0 || r >= this.rows) break;
      }
    }
    return best < maxDist ? best : Infinity;
  }

  /** Slab test in the box's local frame. 0 if the origin is inside. */
  private rayBox(
    i: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
  ): number {
    const d = this.data;
    const o = i * STRIDE;
    const c = d[o + 6]!;
    const s = d[o + 7]!;
    const px = ox - d[o]!;
    const pz = oz - d[o + 2]!;
    const lox = c * px - s * pz;
    const loz = s * px + c * pz;
    const ldx = c * dx - s * dz;
    const ldz = s * dx + c * dz;
    tMin = 0;
    tMax = Infinity;
    if (!slab(lox, ldx, d[o + 3]!)) return Infinity;
    if (!slab(oy - d[o + 1]!, dy, d[o + 4]!)) return Infinity;
    if (!slab(loz, ldz, d[o + 5]!)) return Infinity;
    return tMin;
  }
}

// Scratch state for rayBox's slab test, kept outside so the hot loop allocates nothing.
let tMin = 0;
let tMax = Infinity;

function slab(lo: number, ld: number, h: number): boolean {
  if (Math.abs(ld) < 1e-9) return lo >= -h && lo <= h;
  const ta = (-h - lo) / ld;
  const tb = (h - lo) / ld;
  if (Math.min(ta, tb) > tMin) tMin = Math.min(ta, tb);
  if (Math.max(ta, tb) < tMax) tMax = Math.max(ta, tb);
  return tMin <= tMax;
}
