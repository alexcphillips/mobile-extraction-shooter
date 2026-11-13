import type { HeightGridDef, Shape } from '@mes/shared';
import * as THREE from 'three';
import type { FaceCull } from './face-cull';
import { shade } from './shade';

/**
 * Collects flat-shaded triangles into a non-indexed BufferGeometry with vertex colors.
 * Baked mode multiplies each face's color by its shade, for static geometry. Otherwise it
 * stores plain colors and face normals, and the material shades them (see material.ts),
 * for geometry that's instanced or moves.
 */
const sl0 = new THREE.Vector3();
const sr0 = new THREE.Vector3();
const sl1 = new THREE.Vector3();
const sr1 = new THREE.Vector3();

export class TriangleBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly nor: number[] = [];
  private readonly color = new THREE.Color();

  /** With cull, faces it finds hidden are left out (static map geometry only). */
  constructor(
    private readonly baked: boolean,
    private readonly cull?: FaceCull,
  ) {}

  get triangles(): number {
    return this.pos.length / 9;
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: number): void {
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    e1.cross(e2);
    const len = e1.length();
    if (len < 1e-9) return;
    e1.divideScalar(len);
    this.color.setHex(color);
    const f = this.baked ? shade(e1.x, e1.y) : 1;
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(this.color.r * f, this.color.g * f, this.color.b * f);
      if (!this.baked) this.nor.push(e1.x, e1.y, e1.z);
    }
  }

  /**
   * A road's strip (CompiledRoad.strip: left and right edge per sample, x y z each) from
   * sample `from` to sample `to`, as quads facing up.
   */
  strip(s: readonly number[], from: number, to: number, color: number): void {
    for (let k = from; k < to; k++) {
      const o = k * 6;
      sl0.set(s[o]!, s[o + 1]!, s[o + 2]!);
      sr0.set(s[o + 3]!, s[o + 4]!, s[o + 5]!);
      sl1.set(s[o + 6]!, s[o + 7]!, s[o + 8]!);
      sr1.set(s[o + 9]!, s[o + 10]!, s[o + 11]!);
      this.tri(sl0, sr0, sl1, color);
      this.tri(sl1, sr0, sr1, color);
    }
  }

  /** A convex polygon in shape-local space, wound so its front faces away from inside. */
  poly(points: readonly THREE.Vector3[], inside: THREE.Vector3, m: THREE.Matrix4, color: number) {
    // Its normal from every corner (Newell's), so corners that meet (a box tapered to an
    // edge) don't spoil it.
    e1.set(0, 0, 0);
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      e1.x += (a.y - b.y) * (a.z + b.z);
      e1.y += (a.z - b.z) * (a.x + b.x);
      e1.z += (a.x - b.x) * (a.y + b.y);
    }
    const p0 = points[0]!;
    const flip = e1.dot(e2.subVectors(p0, inside)) < 0;
    const n = points.length;
    while (world.length < n) world.push(new THREE.Vector3());
    for (let i = 0; i < n; i++) world[i]!.copy(points[i]!).applyMatrix4(m);
    if (this.cull) {
      // Outward in world space: the turn keeps the winding, so flip still says which way.
      e1.set(0, 0, 0);
      for (let i = 0; i < n; i++) {
        const a = world[i]!;
        const b = world[(i + 1) % n]!;
        e1.x += (a.y - b.y) * (a.z + b.z);
        e1.y += (a.z - b.z) * (a.x + b.x);
        e1.z += (a.x - b.x) * (a.y + b.y);
      }
      e1.normalize();
      if (flip) e1.negate();
      if (this.cull.hidden(world, n, e1.x, e1.y, e1.z)) return;
    }
    for (let i = 1; i + 1 < n; i++) {
      if (flip) this.tri(world[0]!, world[i + 1]!, world[i]!, color);
      else this.tri(world[0]!, world[i]!, world[i + 1]!, color);
    }
  }

  shape(s: Shape): void {
    euler.set(s.pitch, s.yaw, s.roll, 'YXZ');
    matrix.makeRotationFromEuler(euler).setPosition(s.x, s.y, s.z);
    const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    switch (s.kind) {
      case 'box': {
        const { hx, hy, hz } = s;
        const [tx, tz] = s.top ?? [hx, hz];
        const [lx, lz] = s.lean ?? [0, 0];
        const c = [-1, 1].flatMap((i) =>
          [-1, 1].flatMap((j) =>
            [-1, 1].map((k) => (j < 0 ? v(i * hx, -hy, k * hz) : v(lx + i * tx, hy, lz + k * tz))),
          ),
        );
        // Corner index bits: x is 4, y is 2, z is 1.
        BOX_FACES.forEach((f, k) => {
          const ring = f.map((i) => c[i]!);
          const out = s.bulge?.[k] ?? 0;
          if (out <= 0) return this.poly(ring, origin, matrix, s.color);
          // Bulged: four triangles up to the face's middle, pushed out along its normal.
          const [ax, sign] = BOX_FACE_NORMALS[k]!;
          const tip = v(0, 0, 0);
          for (const p of ring) tip.add(p);
          tip.multiplyScalar(1 / 4).setComponent(ax, tip.getComponent(ax) + sign * out);
          for (let i = 0; i < 4; i++)
            this.poly([ring[i]!, ring[(i + 1) % 4]!, tip], origin, matrix, s.color);
        });
        return;
      }
      case 'cylinder': {
        const { radius, radiusTop, hy, sides } = s;
        const bottom: THREE.Vector3[] = [];
        const top: THREE.Vector3[] = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          bottom.push(v(Math.cos(a) * radius, -hy, Math.sin(a) * radius));
          top.push(v(Math.cos(a) * radiusTop, hy, Math.sin(a) * radiusTop));
        }
        for (let i = 0; i < sides; i++) {
          const j = (i + 1) % sides;
          const side =
            radiusTop > 0
              ? [bottom[i]!, bottom[j]!, top[j]!, top[i]!]
              : [bottom[i]!, bottom[j]!, top[i]!];
          this.poly(side, origin, matrix, s.color);
        }
        this.poly(bottom, origin, matrix, s.color);
        if (radiusTop > 0) this.poly(top, origin, matrix, s.color);
        return;
      }
      case 'wedge': {
        const { hx, hy, hz } = s;
        const inside = v(0, -hy / 2, hz / 2);
        const b = [v(-hx, -hy, -hz), v(hx, -hy, -hz), v(hx, -hy, hz), v(-hx, -hy, hz)];
        const t = [v(-hx, hy, hz), v(hx, hy, hz)];
        const faces = [
          b,
          [b[3]!, b[2]!, t[1]!, t[0]!],
          [b[0]!, b[1]!, t[1]!, t[0]!],
          [b[0]!, b[3]!, t[0]!],
          [b[1]!, b[2]!, t[1]!],
        ];
        for (const f of faces) this.poly(f, inside, matrix, s.color);
        return;
      }
      case 'slab': {
        const { hx, hy, hz, segments } = s;
        // Round the outline from above, corner by corner: each arc's center is its radius
        // in from both sides, and turns a quarter from one side to the next.
        const fit = Math.min(hx, hz);
        const ring: [number, number][] = [];
        SLAB_CORNERS.forEach(([sx, sz, from], i) => {
          const r = Math.min(fit, s.corners[i]!);
          const cx = sx * (hx - r);
          const cz = sz * (hz - r);
          if (r <= 0) return void ring.push([cx, cz]);
          for (let k = 0; k <= segments; k++) {
            const a = from + (k / segments) * (Math.PI / 2);
            ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
          }
        });
        const bottom = ring.map(([x, z]) => v(x, -hy, z));
        const top = ring.map(([x, z]) => v(x, hy, z));
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          this.poly([bottom[i]!, bottom[j]!, top[j]!, top[i]!], origin, matrix, s.color);
        }
        this.poly(bottom, origin, matrix, s.color);
        this.poly(top, origin, matrix, s.color);
        return;
      }
    }
  }

  /**
   * Terrain cells [i0, i1) × [j0, j1) but holes, split the way HeightGrid splits them.
   * Flat cells drawn whole are merged into rectangles (2026-11-07), each a fan through
   * every cell corner round its edge, so what meets it shares its corners (no cracks).
   */
  terrain(t: HeightGridDef, i0: number, i1: number, j0: number, j1: number, color: number) {
    const corner = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 =>
      out.set(t.minX + i * t.cellSize, t.heights[j * (t.cols + 1) + i]!, t.minZ + j * t.cellSize);
    const w = i1 - i0;
    const flat = new Uint8Array(w * (j1 - j0));
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        if (t.holes?.[j * t.cols + i]) continue;
        corner(i, j, c00);
        corner(i + 1, j, c10);
        corner(i, j + 1, c01);
        corner(i + 1, j + 1, c11);
        const level = c00.y === c10.y && c00.y === c01.y && c00.y === c11.y;
        const a = !this.groundHidden(c00, c01, c10);
        const b = !this.groundHidden(c10, c01, c11);
        if (level && a && b) {
          flat[(j - j0) * w + (i - i0)] = 1;
          continue;
        }
        if (a) this.tri(c00, c01, c10, color);
        if (b) this.tri(c10, c01, c11, color);
      }
    }
    // Greedy: as wide as it goes along x, then as deep along z as every row is that wide.
    for (let r = 0; r < j1 - j0; r++) {
      for (let q = 0; q < w; q++) {
        if (!flat[r * w + q]) continue;
        let q1 = q + 1;
        while (q1 < w && flat[r * w + q1]) q1++;
        let r1 = r + 1;
        while (r1 < j1 - j0 && flat.subarray(r1 * w + q, r1 * w + q1).every(Boolean)) r1++;
        for (let k = r; k < r1; k++) flat.fill(0, k * w + q, k * w + q1);
        this.flatRect(t, i0 + q, i0 + q1, j0 + r, j0 + r1, color);
      }
    }
  }

  /**
   * Flat cells [i0, i1) × [j0, j1) as a fan from the middle to every cell corner round the
   * edge. From a corner instead, the edges either side of it would be one long triangle
   * edge each, passing corners the cells beside it have (cracks).
   */
  private flatRect(
    t: HeightGridDef,
    i0: number,
    i1: number,
    j0: number,
    j1: number,
    color: number,
  ): void {
    const y = t.heights[j0 * (t.cols + 1) + i0]!;
    const cs = t.cellSize;
    // Round the edge from (i0, j0): along +z, along +x, back along −z, back along −x,
    // wound as the cells' own triangles are (facing up).
    let n = 0;
    const add = (i: number, j: number): void => {
      while (world.length <= n) world.push(new THREE.Vector3());
      world[n++]!.set(t.minX + i * cs, y, t.minZ + j * cs);
    };
    for (let j = j0; j < j1; j++) add(i0, j);
    for (let i = i0; i < i1; i++) add(i, j1);
    for (let j = j1; j > j0; j--) add(i1, j);
    for (let i = i1; i > i0; i--) add(i, j0);
    middle.set(t.minX + ((i0 + i1) / 2) * cs, y, t.minZ + ((j0 + j1) / 2) * cs);
    for (let k = 0; k < n; k++) this.tri(middle, world[k]!, world[(k + 1) % n]!, color);
  }

  /** Whether a ground triangle is under a box (a floor laid on the ground). */
  private groundHidden(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): boolean {
    if (!this.cull) return false;
    e1.subVectors(b, a).cross(e2.subVectors(c, a)).normalize();
    corners[0] = a;
    corners[1] = b;
    corners[2] = c;
    return this.cull.hidden(corners, 3, e1.x, e1.y, e1.z, false);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (!this.baked) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A slab's corners in its outline's order, as the side of x and of z each is on and the
 * angle its arc starts from: back left, back right, front right, front left.
 */
const SLAB_CORNERS: readonly [number, number, number][] = [
  [-1, -1, Math.PI],
  [1, -1, Math.PI * 1.5],
  [1, 1, 0],
  [-1, 1, Math.PI / 2],
];

/** Box faces as corner indices (bit 4 is +x, 2 is +y, 1 is +z). */
const BOX_FACES = [
  [0, 1, 3, 2],
  [4, 5, 7, 6],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 3, 7, 5],
];

/** Each of BOX_FACES's outward normal, as an axis (0 x, 1 y, 2 z) and its sign. */
const BOX_FACE_NORMALS: readonly [number, number][] = [
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 1],
  [2, -1],
  [2, 1],
];

const origin = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
/** A polygon's corners in world space, reused. */
const world: THREE.Vector3[] = [];
/** A flat patch's middle. */
const middle = new THREE.Vector3();
/** A ground triangle's corners, for the cull. */
const corners: THREE.Vector3[] = [];
const c00 = new THREE.Vector3();
const c10 = new THREE.Vector3();
const c01 = new THREE.Vector3();
const c11 = new THREE.Vector3();
const euler = new THREE.Euler();
const matrix = new THREE.Matrix4();
