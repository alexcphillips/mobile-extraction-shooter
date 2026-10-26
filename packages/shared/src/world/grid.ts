/**
 * Walks the cells of a uniform XZ grid that a ray crosses, in order (Amanatides–Woo).
 * Reused across calls so raycasts allocate nothing. t is distance along the ray, so a 3D
 * unit direction gives 3D distances even though only x and z pick the cells.
 */
export class CellWalk {
  q = 0;
  r = 0;
  /** The ray's t range inside the current cell. */
  tEnter = 0;
  tExit = 0;

  private cols = 0;
  private rows = 0;
  private stepQ = 0;
  private stepR = 0;
  private tDeltaQ = 0;
  private tDeltaR = 0;
  private tMaxQ = 0;
  private tMaxR = 0;
  private tEnd = 0;

  /** Starts at the first cell the ray reaches; false if it misses the grid before maxT. */
  begin(
    minX: number,
    minZ: number,
    cellSize: number,
    cols: number,
    rows: number,
    ox: number,
    oz: number,
    dx: number,
    dz: number,
    maxT: number,
  ): boolean {
    // Clip the ray to the grid's rectangle.
    let t0 = 0;
    let t1 = maxT;
    const maxX = minX + cols * cellSize;
    const maxZ = minZ + rows * cellSize;
    if (dx === 0) {
      if (ox < minX || ox > maxX) return false;
    } else {
      const a = (minX - ox) / dx;
      const b = (maxX - ox) / dx;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (dz === 0) {
      if (oz < minZ || oz > maxZ) return false;
    } else {
      const a = (minZ - oz) / dz;
      const b = (maxZ - oz) / dz;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (t0 > t1) return false;

    this.cols = cols;
    this.rows = rows;
    this.q = clampIndex(Math.floor((ox + dx * t0 - minX) / cellSize), cols);
    this.r = clampIndex(Math.floor((oz + dz * t0 - minZ) / cellSize), rows);
    this.stepQ = dx > 0 ? 1 : -1;
    this.stepR = dz > 0 ? 1 : -1;
    this.tDeltaQ = dx !== 0 ? cellSize / Math.abs(dx) : Infinity;
    this.tDeltaR = dz !== 0 ? cellSize / Math.abs(dz) : Infinity;
    this.tMaxQ = dx !== 0 ? (minX + (this.q + (dx > 0 ? 1 : 0)) * cellSize - ox) / dx : Infinity;
    this.tMaxR = dz !== 0 ? (minZ + (this.r + (dz > 0 ? 1 : 0)) * cellSize - oz) / dz : Infinity;
    this.tEnd = t1;
    this.tEnter = t0;
    this.tExit = Math.min(this.tMaxQ, this.tMaxR, t1);
    return true;
  }

  /** Moves to the next cell; false once the ray leaves the grid or passes maxT. */
  next(): boolean {
    if (this.tExit >= this.tEnd) return false;
    if (this.tMaxQ < this.tMaxR) {
      this.q += this.stepQ;
      this.tMaxQ += this.tDeltaQ;
      if (this.q < 0 || this.q >= this.cols) return false;
    } else {
      this.r += this.stepR;
      this.tMaxR += this.tDeltaR;
      if (this.r < 0 || this.r >= this.rows) return false;
    }
    this.tEnter = this.tExit;
    this.tExit = Math.min(this.tMaxQ, this.tMaxR, this.tEnd);
    return true;
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * A spatial hash for things that never move (map solids): each item is listed in every XZ
 * cell its bounding rectangle touches, in one compressed cell → items table. Items outside
 * the bounds are listed in the edge cells.
 */
export class StaticGrid {
  readonly cols: number;
  readonly rows: number;
  /** Items of cell c are cellItems[cellStart[c] .. cellStart[c + 1]). */
  readonly cellStart: Uint32Array;
  readonly cellItems: Uint32Array;
  private readonly stamps: Uint32Array;
  private stamp = 0;

  /** rects holds minX, minZ, maxX, maxZ for each item. */
  constructor(
    readonly minX: number,
    readonly minZ: number,
    width: number,
    depth: number,
    readonly cellSize: number,
    rects: Float64Array,
  ) {
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(depth / cellSize));
    const count = rects.length / 4;
    this.stamps = new Uint32Array(count);

    // Two passes over the items: count per cell, then fill.
    const counts = new Uint32Array(this.cols * this.rows + 1);
    this.forCells(rects, count, (cell) => counts[cell + 1]!++);
    for (let i = 1; i < counts.length; i++) counts[i]! += counts[i - 1]!;
    this.cellStart = counts.slice();
    this.cellItems = new Uint32Array(counts[counts.length - 1]!);
    this.forCells(rects, count, (cell, item) => (this.cellItems[counts[cell]!++] = item));
  }

  private forCells(
    rects: Float64Array,
    count: number,
    visit: (cell: number, item: number) => void,
  ): void {
    for (let i = 0; i < count; i++) {
      const q0 = this.col(rects[i * 4]!);
      const r0 = this.row(rects[i * 4 + 1]!);
      const q1 = this.col(rects[i * 4 + 2]!);
      const r1 = this.row(rects[i * 4 + 3]!);
      for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) visit(r * this.cols + q, i);
    }
  }

  col(x: number): number {
    return clampIndex(Math.floor((x - this.minX) / this.cellSize), this.cols);
  }

  row(z: number): number {
    return clampIndex(Math.floor((z - this.minZ) / this.cellSize), this.rows);
  }

  /** Starts a new pass of `firstVisit`, so each item is reported once even if it spans cells. */
  newPass(): void {
    this.stamp++;
  }

  /** True the first time an item is seen in the current pass. */
  firstVisit(item: number): boolean {
    if (this.stamps[item] === this.stamp) return false;
    this.stamps[item] = this.stamp;
    return true;
  }

  /** Writes the items whose cells touch the rectangle to out, each once; returns how many. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Uint32Array): number {
    this.newPass();
    let n = 0;
    const q0 = this.col(minX);
    const q1 = this.col(maxX);
    const r1 = this.row(maxZ);
    for (let r = this.row(minZ); r <= r1; r++) {
      for (let q = q0; q <= q1; q++) {
        const cell = r * this.cols + q;
        for (let k = this.cellStart[cell]!, end = this.cellStart[cell + 1]!; k < end; k++) {
          const item = this.cellItems[k]!;
          if (this.firstVisit(item)) out[n++] = item;
        }
      }
    }
    return n;
  }
}
