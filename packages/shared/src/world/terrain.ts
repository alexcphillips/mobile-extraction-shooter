import { CellWalk } from './grid';

/** Terrain as plain data, the way a map file stores it. */
export interface HeightGridDef {
  minX: number;
  minZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  /** (cols + 1) × (rows + 1) corner heights, row by row along +z, each row along +x. */
  heights: ArrayLike<number>;
}

/** Unit normal and distance of a raycast hit. */
export interface SurfaceHit {
  distance: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Terrain heights on a regular grid. Each cell is two flat triangles split along the
 * diagonal from (i + 1, j) to (i, j + 1), so collision matches what the renderer draws:
 * triangle A is (i, j), (i, j + 1), (i + 1, j); triangle B is the other half.
 */
export class HeightGrid {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly maxHeight: number;
  private readonly h: Float64Array;
  private readonly walk = new CellWalk();

  constructor(def: HeightGridDef) {
    if (def.heights.length !== (def.cols + 1) * (def.rows + 1)) {
      throw new Error(
        `terrain needs ${(def.cols + 1) * (def.rows + 1)} heights, got ${def.heights.length}`,
      );
    }
    this.minX = def.minX;
    this.minZ = def.minZ;
    this.cellSize = def.cellSize;
    this.cols = def.cols;
    this.rows = def.rows;
    this.maxX = def.minX + def.cols * def.cellSize;
    this.maxZ = def.minZ + def.rows * def.cellSize;
    this.h = Float64Array.from(def.heights);
    this.maxHeight = this.h.reduce((a, b) => Math.max(a, b), -Infinity);
  }

  /** Samples a height function at every grid corner. */
  static fromFunction(
    minX: number,
    minZ: number,
    cellSize: number,
    cols: number,
    rows: number,
    height: (x: number, z: number) => number,
  ): HeightGrid {
    const heights: number[] = [];
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++)
        heights.push(height(minX + i * cellSize, minZ + j * cellSize));
    return new HeightGrid({ minX, minZ, cellSize, cols, rows, heights });
  }

  /** Height of the corner (i, j). */
  corner(i: number, j: number): number {
    return this.h[j * (this.cols + 1) + i]!;
  }

  /** Ground height at (x, z); positions outside the grid use its edge. */
  heightAt(x: number, z: number): number {
    this.locate(x, z);
    return this.triHeight(cellI, cellJ, cellU, cellV);
  }

  /** Slope (dh/dx, dh/dz) of the triangle under (x, z), written to out. */
  gradientAt(x: number, z: number, out: { x: number; z: number }): void {
    this.locate(x, z);
    const c = this.cols + 1;
    const k = cellJ * c + cellI;
    const h00 = this.h[k]!;
    const h10 = this.h[k + 1]!;
    const h01 = this.h[k + c]!;
    const h11 = this.h[k + c + 1]!;
    if (cellU + cellV <= 1) {
      out.x = (h10 - h00) / this.cellSize;
      out.z = (h01 - h00) / this.cellSize;
    } else {
      out.x = (h11 - h01) / this.cellSize;
      out.z = (h11 - h10) / this.cellSize;
    }
  }

  /**
   * Distance to the terrain along a unit direction, or Infinity within maxDist.
   * 0 if the origin is under the ground. Writes the normal to hit if given.
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    hit?: SurfaceHit,
  ): number {
    if (oy >= this.maxHeight && dy >= 0) return Infinity;
    if (oy < this.heightAt(ox, oz)) {
      if (hit) setHit(hit, 0, -dx, -dy, -dz);
      return 0;
    }
    const walk = this.walk;
    if (
      !walk.begin(
        this.minX,
        this.minZ,
        this.cellSize,
        this.cols,
        this.rows,
        ox,
        oz,
        dx,
        dz,
        maxDist,
      )
    )
      return Infinity;
    const cs = this.cellSize;
    const c = this.cols + 1;
    do {
      const i = walk.q;
      const j = walk.r;
      const k = j * c + i;
      const h00 = this.h[k]!;
      const h10 = this.h[k + 1]!;
      const h01 = this.h[k + c]!;
      const h11 = this.h[k + c + 1]!;
      // Cell-local coordinates along the ray: u = u0 + du t, v = v0 + dv t.
      const u0 = (ox - (this.minX + i * cs)) / cs;
      const v0 = (oz - (this.minZ + j * cs)) / cs;
      const du = dx / cs;
      const dv = dz / cs;
      const t0 = walk.tEnter - 1e-9;
      const t1 = walk.tExit + 1e-9;
      let best = Infinity;
      let gx = 0;
      let gz = 0;
      // Triangle A: h = h00 + (h10 - h00) u + (h01 - h00) v, for u + v <= 1.
      let a = h10 - h00;
      let b = h01 - h00;
      let t = planeHit(oy, dy, h00 + a * u0 + b * v0, a * du + b * dv);
      if (t >= t0 && t <= t1 && u0 + du * t + v0 + dv * t <= 1 + 1e-9) {
        best = t;
        gx = a / cs;
        gz = b / cs;
      }
      // Triangle B: h = h11 + (h01 - h11)(1 - u) + (h10 - h11)(1 - v), for u + v >= 1.
      a = h11 - h01;
      b = h11 - h10;
      t = planeHit(oy, dy, h11 - a * (1 - u0) - b * (1 - v0), a * du + b * dv);
      if (t >= t0 && t <= t1 && t < best && u0 + du * t + v0 + dv * t >= 1 - 1e-9) {
        best = t;
        gx = a / cs;
        gz = b / cs;
      }
      if (best <= maxDist) {
        if (hit) {
          const len = Math.hypot(gx, 1, gz);
          setHit(hit, Math.max(0, best), -gx / len, 1 / len, -gz / len);
        }
        return Math.max(0, best);
      }
    } while (walk.next());
    return Infinity;
  }

  private locate(x: number, z: number): void {
    const fx = (x - this.minX) / this.cellSize;
    const fz = (z - this.minZ) / this.cellSize;
    cellI = Math.min(this.cols - 1, Math.max(0, Math.floor(fx)));
    cellJ = Math.min(this.rows - 1, Math.max(0, Math.floor(fz)));
    cellU = Math.min(1, Math.max(0, fx - cellI));
    cellV = Math.min(1, Math.max(0, fz - cellJ));
  }

  private triHeight(i: number, j: number, u: number, v: number): number {
    const c = this.cols + 1;
    const k = j * c + i;
    if (u + v <= 1) {
      const h00 = this.h[k]!;
      return h00 + (this.h[k + 1]! - h00) * u + (this.h[k + c]! - h00) * v;
    }
    const h11 = this.h[k + c + 1]!;
    return h11 + (this.h[k + c]! - h11) * (1 - u) + (this.h[k + 1]! - h11) * (1 - v);
  }
}

// Scratch output of HeightGrid.locate, kept outside so lookups allocate nothing.
let cellI = 0;
let cellJ = 0;
let cellU = 0;
let cellV = 0;

/**
 * Where a ray y = oy + dy t meets a plane whose height along the ray is h0 + dh t,
 * or NaN if they're parallel.
 */
function planeHit(oy: number, dy: number, h0: number, dh: number): number {
  const rate = dy - dh;
  return rate === 0 ? NaN : (h0 - oy) / rate;
}

export function setHit(
  hit: SurfaceHit,
  distance: number,
  nx: number,
  ny: number,
  nz: number,
): void {
  hit.distance = distance;
  hit.nx = nx;
  hit.ny = ny;
  hit.nz = nz;
}
