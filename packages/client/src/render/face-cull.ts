import { HeightGrid, type HeightGridDef, type Shape } from '@mes/shared';
import * as THREE from 'three';

/** How far out from a face to look for what covers it, in meters. */
const NUDGE = 0.01;
/** How far a point may stick out of a box, or up out of the ground, and still be inside. */
const SLACK = 0.002;
/** Grid cell for finding boxes near a face, in meters. */
const CELL = 4;
/** Ground corners under one face beyond this many aren't checked: it's left drawn. */
const MAX_CORNERS = 4096;

/**
 * Finds faces nobody can see, so the chunks leave them out (2026-11-07): a face is hidden
 * when, moved NUDGE out along its normal, it's wholly inside one box, or wholly under the
 * ground. Faces are convex, so all their corners inside a box means all of it is; the
 * ground is checked at every place its height can bend under the face. A face covered
 * only by two boxes together, or by a box and the ground, is still drawn.
 *
 * Only shapes that are always drawn and never move may cover others: the chunks' own.
 * Boxes with a top of another size don't cover anything; a bulged box covers as its plain
 * box, which is inside it.
 */
export class FaceCull {
  private readonly ground: HeightGrid;
  /** Per box: center, rotation (row by row, local to world), half sizes. */
  private readonly boxes: Float64Array;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly cols: number;
  private readonly rows: number;
  /** The boxes touching each grid cell. */
  private readonly cells: number[][];
  private readonly stamp: Uint32Array;
  private pass = 0;
  private readonly px: number[] = [];
  private readonly py: number[] = [];
  private readonly pz: number[] = [];

  constructor(shapes: readonly Shape[], terrain: HeightGridDef) {
    this.ground = new HeightGrid(terrain);
    const covers = shapes.filter(
      (s): s is Extract<Shape, { kind: 'box' }> => s.kind === 'box' && !s.top && !s.lean,
    );
    this.boxes = new Float64Array(covers.length * BOX);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const bounds: number[] = [];
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    covers.forEach((s, i) => {
      m.makeRotationFromEuler(e.set(s.pitch, s.yaw, s.roll, 'YXZ'));
      const r = m.elements;
      const o = i * BOX;
      this.boxes.set(
        [
          s.x,
          s.y,
          s.z,
          r[0]!,
          r[4]!,
          r[8]!,
          r[1]!,
          r[5]!,
          r[9]!,
          r[2]!,
          r[6]!,
          r[10]!,
          s.hx,
          s.hy,
          s.hz,
        ],
        o,
      );
      // Its footprint's bounds: half its extent along each world axis.
      const ex = Math.abs(r[0]!) * s.hx + Math.abs(r[4]!) * s.hy + Math.abs(r[8]!) * s.hz;
      const ez = Math.abs(r[2]!) * s.hx + Math.abs(r[6]!) * s.hy + Math.abs(r[10]!) * s.hz;
      bounds.push(s.x - ex, s.z - ez, s.x + ex, s.z + ez);
      minX = Math.min(minX, s.x - ex);
      minZ = Math.min(minZ, s.z - ez);
      maxX = Math.max(maxX, s.x + ex);
      maxZ = Math.max(maxZ, s.z + ez);
    });
    if (!covers.length) minX = minZ = maxX = maxZ = 0;
    this.minX = minX;
    this.minZ = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / CELL));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    for (let i = 0; i < covers.length; i++) {
      const [q0, r0, q1, r1] = this.span(
        bounds[i * 4]!,
        bounds[i * 4 + 1]!,
        bounds[i * 4 + 2]!,
        bounds[i * 4 + 3]!,
      );
      for (let r = r0; r <= r1; r++)
        for (let q = q0; q <= q1; q++) this.cells[r * this.cols + q]!.push(i);
    }
    this.stamp = new Uint32Array(covers.length);
  }

  /**
   * Whether the convex face through these points (world space), facing (nx, ny, nz), is
   * hidden. Without ground, only a box can hide it (the ground's own triangles).
   */
  hidden(
    points: readonly THREE.Vector3[],
    count: number,
    nx: number,
    ny: number,
    nz: number,
    ground = true,
  ): boolean {
    const { px, py, pz } = this;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < count; i++) {
      const p = points[i]!;
      px[i] = p.x + nx * NUDGE;
      py[i] = p.y + ny * NUDGE;
      pz[i] = p.z + nz * NUDGE;
      x0 = Math.min(x0, px[i]!);
      z0 = Math.min(z0, pz[i]!);
      x1 = Math.max(x1, px[i]!);
      z1 = Math.max(z1, pz[i]!);
    }
    return (
      this.inBox(count, x0, z0, x1, z1) ||
      (ground && this.underGround(count, nx, ny, nz, x0, z0, x1, z1))
    );
  }

  /** The grid cells [q0, r0]–[q1, r1] a footprint touches, clamped to the grid. */
  private span(x0: number, z0: number, x1: number, z1: number): [number, number, number, number] {
    const clamp = (v: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor(v)));
    return [
      clamp((x0 - this.minX) / CELL, this.cols),
      clamp((z0 - this.minZ) / CELL, this.rows),
      clamp((x1 - this.minX) / CELL, this.cols),
      clamp((z1 - this.minZ) / CELL, this.rows),
    ];
  }

  /** Whether every nudged point is inside one box. */
  private inBox(count: number, x0: number, z0: number, x1: number, z1: number): boolean {
    if (!this.stamp.length) return false;
    const pass = ++this.pass;
    const [q0, r0, q1, r1] = this.span(x0, z0, x1, z1);
    const b = this.boxes;
    for (let r = r0; r <= r1; r++) {
      for (let q = q0; q <= q1; q++) {
        for (const i of this.cells[r * this.cols + q]!) {
          if (this.stamp[i] === pass) continue;
          this.stamp[i] = pass;
          const o = i * BOX;
          let inside = true;
          for (let k = 0; k < count && inside; k++) {
            const dx = this.px[k]! - b[o]!;
            const dy = this.py[k]! - b[o + 1]!;
            const dz = this.pz[k]! - b[o + 2]!;
            // Into the box's frame: the rotation's transpose.
            inside =
              Math.abs(dx * b[o + 3]! + dy * b[o + 6]! + dz * b[o + 9]!) <= b[o + 12]! + SLACK &&
              Math.abs(dx * b[o + 4]! + dy * b[o + 7]! + dz * b[o + 10]!) <= b[o + 13]! + SLACK &&
              Math.abs(dx * b[o + 5]! + dy * b[o + 8]! + dz * b[o + 11]!) <= b[o + 14]! + SLACK;
          }
          if (inside) return true;
        }
      }
    }
    return false;
  }

  /**
   * Whether the nudged face is under the ground everywhere: its corners, where its edges
   * cross the ground's cell lines and diagonals, and the ground's corners within it. Not
   * over a hole, and not past the ground's edge, where no ground is drawn.
   */
  private underGround(
    count: number,
    nx: number,
    ny: number,
    nz: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
  ): boolean {
    const g = this.ground;
    if (x0 < g.minX || z0 < g.minZ || x1 > g.maxX || z1 > g.maxZ) return false;
    const { px, py, pz } = this;
    for (let k = 0; k < count; k++) if (!this.below(px[k]!, py[k]!, pz[k]!)) return false;
    const cs = g.cellSize;
    const i0 = Math.floor((x0 - g.minX) / cs);
    const j0 = Math.floor((z0 - g.minZ) / cs);
    const i1 = Math.min(g.cols - 1, Math.floor((x1 - g.minX) / cs));
    const j1 = Math.min(g.rows - 1, Math.floor((z1 - g.minZ) / cs));
    if ((i1 - i0 + 2) * (j1 - j0 + 2) > MAX_CORNERS) return false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (g.isHole(i, j)) return false;
    // Along each edge, where it crosses x, z or x + z on a whole number of cells.
    for (let k = 0; k < count; k++) {
      const l = (k + 1) % count;
      const ax = (px[k]! - g.minX) / cs;
      const az = (pz[k]! - g.minZ) / cs;
      const bx = (px[l]! - g.minX) / cs;
      const bz = (pz[l]! - g.minZ) / cs;
      if (
        !this.crossings(k, l, ax, bx) ||
        !this.crossings(k, l, az, bz) ||
        !this.crossings(k, l, ax + az, bx + bz)
      )
        return false;
    }
    // The ground's corners inside the face, seen from above, against the face's height there.
    if (Math.abs(ny) < 1e-6) return true;
    for (let j = j0; j <= j1 + 1; j++) {
      const z = g.minZ + j * cs;
      for (let i = i0; i <= i1 + 1; i++) {
        const x = g.minX + i * cs;
        if (!this.within(count, x, z)) continue;
        const y = py[0]! - (nx * (x - px[0]!) + nz * (z - pz[0]!)) / ny;
        if (!this.below(x, y, z)) return false;
      }
    }
    return true;
  }

  /** Whether the edge from point k to point l is under the ground where v (from a to b) is whole. */
  private crossings(k: number, l: number, a: number, b: number): boolean {
    if (Math.abs(b - a) < 1e-9) return true;
    const lo = Math.ceil(Math.min(a, b));
    const hi = Math.floor(Math.max(a, b));
    if (hi - lo > MAX_CORNERS) return false;
    const { px, py, pz } = this;
    for (let n = lo; n <= hi; n++) {
      const t = (n - a) / (b - a);
      const x = px[k]! + (px[l]! - px[k]!) * t;
      const y = py[k]! + (py[l]! - py[k]!) * t;
      const z = pz[k]! + (pz[l]! - pz[k]!) * t;
      if (!this.below(x, y, z)) return false;
    }
    return true;
  }

  private below(x: number, y: number, z: number): boolean {
    return y <= this.ground.heightAt(x, z) + SLACK;
  }

  /** Whether (x, z) is inside the nudged face seen from above (either winding). */
  private within(count: number, x: number, z: number): boolean {
    const { px, pz } = this;
    let sign = 0;
    for (let k = 0; k < count; k++) {
      const l = (k + 1) % count;
      const cross = (px[l]! - px[k]!) * (z - pz[k]!) - (pz[l]! - pz[k]!) * (x - px[k]!);
      if (Math.abs(cross) < 1e-9) continue;
      const s = cross > 0 ? 1 : -1;
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  }
}

/** Numbers per box in FaceCull.boxes. */
const BOX = 15;
