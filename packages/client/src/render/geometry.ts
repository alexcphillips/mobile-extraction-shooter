import type { HeightGridDef, Shape } from '@mes/shared';
import * as THREE from 'three';
import { shade } from './shade';

/**
 * Collects flat-shaded triangles into a non-indexed BufferGeometry with vertex colours.
 * Baked mode multiplies each face's colour by its shade, for static geometry. Otherwise it
 * stores plain colours and face normals, and the material shades them (see material.ts),
 * for geometry that's instanced or moves.
 */
export class TriangleBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly nor: number[] = [];
  private readonly colour = new THREE.Color();

  constructor(private readonly baked: boolean) {}

  get triangles(): number {
    return this.pos.length / 9;
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colour: number): void {
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    e1.cross(e2);
    const len = e1.length();
    if (len < 1e-9) return;
    e1.divideScalar(len);
    this.colour.setHex(colour);
    const f = this.baked ? shade(e1.x, e1.y) : 1;
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(this.colour.r * f, this.colour.g * f, this.colour.b * f);
      if (!this.baked) this.nor.push(e1.x, e1.y, e1.z);
    }
  }

  /** A convex polygon in shape-local space, wound so its front faces away from inside. */
  poly(points: readonly THREE.Vector3[], inside: THREE.Vector3, m: THREE.Matrix4, colour: number) {
    const [p0, p1, p2] = points as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    e1.subVectors(p1, p0).cross(e2.subVectors(p2, p0));
    const flip = e1.dot(e2.subVectors(p0, inside)) < 0;
    w0.copy(p0).applyMatrix4(m);
    for (let i = 1; i + 1 < points.length; i++) {
      w1.copy(points[i]!).applyMatrix4(m);
      w2.copy(points[i + 1]!).applyMatrix4(m);
      if (flip) this.tri(w0, w2, w1, colour);
      else this.tri(w0, w1, w2, colour);
    }
  }

  shape(s: Shape): void {
    euler.set(s.pitch, s.yaw, s.roll, 'YXZ');
    matrix.makeRotationFromEuler(euler).setPosition(s.x, s.y, s.z);
    const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    switch (s.kind) {
      case 'box': {
        const { hx, hy, hz } = s;
        const c = [-1, 1].flatMap((i) =>
          [-1, 1].flatMap((j) => [-1, 1].map((k) => v(i * hx, j * hy, k * hz))),
        );
        // Corner index bits: x is 4, y is 2, z is 1.
        for (const f of BOX_FACES)
          this.poly(
            f.map((i) => c[i]!),
            origin,
            matrix,
            s.colour,
          );
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
          this.poly(side, origin, matrix, s.colour);
        }
        this.poly(bottom, origin, matrix, s.colour);
        if (radiusTop > 0) this.poly(top, origin, matrix, s.colour);
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
        for (const f of faces) this.poly(f, inside, matrix, s.colour);
        return;
      }
    }
  }

  /** Terrain cells [i0, i1) × [j0, j1), split the way HeightGrid splits them. */
  terrain(t: HeightGridDef, i0: number, i1: number, j0: number, j1: number, colour: number) {
    const corner = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 =>
      out.set(t.minX + i * t.cellSize, t.heights[j * (t.cols + 1) + i]!, t.minZ + j * t.cellSize);
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        corner(i, j, c00);
        corner(i + 1, j, c10);
        corner(i, j + 1, c01);
        corner(i + 1, j + 1, c11);
        this.tri(c00, c01, c10, colour);
        this.tri(c10, c01, c11, colour);
      }
    }
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

/** Box faces as corner indices (bit 4 is +x, 2 is +y, 1 is +z). */
const BOX_FACES = [
  [0, 1, 3, 2],
  [4, 5, 7, 6],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 3, 7, 5],
];

const origin = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const w0 = new THREE.Vector3();
const w1 = new THREE.Vector3();
const w2 = new THREE.Vector3();
const c00 = new THREE.Vector3();
const c10 = new THREE.Vector3();
const c01 = new THREE.Vector3();
const c11 = new THREE.Vector3();
const euler = new THREE.Euler();
const matrix = new THREE.Matrix4();
