import {
  createRng,
  nextFloat,
  type BoxDef,
  type HeightGrid,
  type HeightGridDef,
  type LadderDef,
  type RampDef,
} from '@mes/shared';
import * as THREE from 'three';
import { shade } from './shade';

export const WORLD_SIZE = 256;
export const WORLD_MIN = -WORLD_SIZE / 2;
const CHUNK = 32;
const CELL = 2;
/** Flat ground around the spawn for the movement playground, blending into the hills. */
const FLAT_RADIUS = 24;
const FLAT_BLEND = 12;
/** Random boxes stay out of this radius. */
const CLEARING = 30;

const PALETTE = [0xc8a165, 0x8c8c8c, 0xa0522d, 0x6e7f80, 0xd9d0c1, 0x4f6d7a, 0x9b6a4f, 0x7a8b5c];
const GRASS = 0x6b8f4e;
const CONCRETE = 0xb5b0a6;
const WOOD = 0x8a5a33;
const METAL = 0x5a6670;

/** A box to draw, optionally with a fixed colour. */
export type RenderBox = BoxDef & { colour?: number };

/** Rolling hills, flattened around the spawn. The real map stores a height grid. */
function hills(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (d - FLAT_RADIUS) / FLAT_BLEND));
  const blend = t * t * (3 - 2 * t);
  return (
    blend * (3 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 1.5 * Math.sin(x * 0.13 + z * 0.09))
  );
}

export function makeTerrain(): HeightGridDef {
  const n = WORLD_SIZE / CELL;
  const heights: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) heights.push(hills(WORLD_MIN + i * CELL, WORLD_MIN + j * CELL));
  return { minX: WORLD_MIN, minZ: WORLD_MIN, cellSize: CELL, cols: n, rows: n, heights };
}

export function makeBoxes(count: number, seed: number, terrain: HeightGrid): BoxDef[] {
  const rng = createRng(seed);
  const r = (): number => nextFloat(rng);
  const boxes: BoxDef[] = [];
  while (boxes.length < count) {
    const x = WORLD_MIN + 4 + r() * (WORLD_SIZE - 8);
    const z = WORLD_MIN + 4 + r() * (WORLD_SIZE - 8);
    if (Math.hypot(x, z) < CLEARING) continue;
    const hx = 0.5 + r() * 2.5;
    const hz = 0.5 + r() * 2.5;
    const height = 1 + r() * r() * 8;
    // Sink the base 1 m so boxes don't float on slopes.
    const base = terrain.heightAt(x, z) - 1;
    boxes.push({
      x,
      y: base + (height + 1) / 2,
      z,
      hx,
      hy: (height + 1) / 2,
      hz,
      yaw: r() * Math.PI * 2,
    });
  }
  return boxes;
}

/** An axis-aligned box from its min and max corners. */
function aabb(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  colour?: number,
): RenderBox {
  const box: RenderBox = {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    z: (z0 + z1) / 2,
    hx: (x1 - x0) / 2,
    hy: (y1 - y0) / 2,
    hz: (z1 - z0) / 2,
    yaw: 0,
  };
  if (colour !== undefined) box.colour = colour;
  return box;
}

export interface Playground {
  boxes: RenderBox[];
  ramps: RampDef[];
  ladders: LadderDef[];
  /** Drawn but not collided with: stair steps and ladder parts. */
  decor: RenderBox[];
}

/**
 * Movement test pieces on the flat ground in front of the spawn (which faces −z):
 * on the left a 0.4 m step, a 1 m box to mantle and a 1.4 m wall that's too high;
 * on the right a beam to crouch under; ahead a 3 m platform with stairs and a ladder.
 */
export function makePlayground(): Playground {
  const boxes: RenderBox[] = [
    aabb(-7, 0, -5, -5, 0.4, -3, CONCRETE),
    aabb(-7, 0, -9, -5, 1, -7, CONCRETE),
    aabb(-7, 0, -13, -5, 1.4, -11, CONCRETE),
    // Beam 1.4 m up on two posts.
    aabb(3, 0, -5, 3.3, 1.4, -3, WOOD),
    aabb(6.7, 0, -5, 7, 1.4, -3, WOOD),
    aabb(3, 1.4, -5, 7, 1.7, -3, WOOD),
    // Platform.
    aabb(-3, 0, -24, 3, 3, -18, CONCRETE),
  ];
  // Stairs up to the platform's front edge, rising towards −z.
  const stairs: RampDef = { x: 0, z: -15, hx: 1, hz: 3, yaw: Math.PI, bottom: 0, low: 0, high: 3 };
  // Ladder on the platform's +x side, facing +x.
  const ladder: LadderDef = { x: 3, z: -21, yaw: Math.PI / 2, halfWidth: 0.3, bottom: 0, top: 3 };
  return {
    boxes,
    ramps: [stairs],
    ladders: [ladder],
    decor: [...stairSteps(stairs, CONCRETE), ...ladderParts(ladder, METAL)],
  };
}

/** Steps drawn over a ramp: each step's top is at the ramp's height halfway along it. */
function stairSteps(ramp: RampDef, colour: number): RenderBox[] {
  const n = Math.max(1, Math.round((ramp.high - ramp.low) / 0.25));
  const depth = (2 * ramp.hz) / n;
  const c = Math.cos(ramp.yaw);
  const s = Math.sin(ramp.yaw);
  return Array.from({ length: n }, (_, i) => {
    const lz = -ramp.hz + (i + 0.5) * depth;
    const top = ramp.low + ((i + 0.5) / n) * (ramp.high - ramp.low);
    return {
      x: ramp.x + lz * s,
      y: (ramp.bottom + top) / 2,
      z: ramp.z + lz * c,
      hx: ramp.hx,
      hy: (top - ramp.bottom) / 2,
      hz: depth / 2,
      yaw: ramp.yaw,
      colour,
    };
  });
}

/** Two rails and rungs every 0.3 m, just in front of the wall. */
function ladderParts(l: LadderDef, colour: number): RenderBox[] {
  const nx = Math.sin(l.yaw);
  const nz = Math.cos(l.yaw);
  const height = l.top - l.bottom;
  const at = (side: number, y: number, hx: number, hy: number): RenderBox => ({
    x: l.x + nx * 0.05 + nz * side,
    y,
    z: l.z + nz * 0.05 - nx * side,
    hx,
    hy,
    hz: 0.03,
    yaw: l.yaw,
    colour,
  });
  const parts = [-1, 1].map((side) =>
    at(side * l.halfWidth, l.bottom + height / 2, 0.03, height / 2),
  );
  for (let y = l.bottom + 0.3; y < l.top; y += 0.3) parts.push(at(0, y, l.halfWidth, 0.02));
  return parts;
}

/**
 * Builds one mesh per chunk containing its terrain and every box whose centre is in it,
 * coloured per vertex with per-face shading and drawn unlit.
 */
export function buildWorld(
  terrain: HeightGrid,
  boxes: readonly RenderBox[],
  seed: number,
): THREE.Group {
  const rng = createRng(seed + 1);
  const n = WORLD_SIZE / CHUNK;
  const byChunk: RenderBox[][] = Array.from({ length: n * n }, () => []);
  for (const b of boxes) {
    const cx = Math.min(n - 1, Math.max(0, Math.floor((b.x - WORLD_MIN) / CHUNK)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor((b.z - WORLD_MIN) / CHUNK)));
    byChunk[cz * n + cx]!.push(b);
  }
  const colourOf = new Map(
    boxes.map((b) => [
      b,
      new THREE.Color(b.colour ?? PALETTE[Math.floor(nextFloat(rng) * PALETTE.length)]!),
    ]),
  );

  const template = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const tPos = template.getAttribute('position');
  const tNor = template.getAttribute('normal');
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const grass = new THREE.Color(GRASS);
  const group = new THREE.Group();

  const cellsPerChunk = CHUNK / CELL;
  const terrainVerts = cellsPerChunk * cellsPerChunk * 6;
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const chunkBoxes = byChunk[cz * n + cx]!;
      const count = terrainVerts + chunkBoxes.length * tPos.count;
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      let v = 0;
      const put = (x: number, y: number, z: number, c: THREE.Color, f: number): void => {
        pos[v * 3] = x;
        pos[v * 3 + 1] = y;
        pos[v * 3 + 2] = z;
        col[v * 3] = c.r * f;
        col[v * 3 + 1] = c.g * f;
        col[v * 3 + 2] = c.b * f;
        v++;
      };

      // Terrain: two flat-shaded triangles per cell, split the way HeightGrid is.
      const c = new THREE.Vector3();
      const nrm = new THREE.Vector3();
      const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3): void => {
        nrm.subVectors(q, p).cross(c.subVectors(r, p)).normalize();
        const f = shade(nrm.x, nrm.y);
        put(p.x, p.y, p.z, grass, f);
        put(q.x, q.y, q.z, grass, f);
        put(r.x, r.y, r.z, grass, f);
      };
      const corner = (i: number, j: number): THREE.Vector3 =>
        new THREE.Vector3(WORLD_MIN + i * CELL, terrain.corner(i, j), WORLD_MIN + j * CELL);
      for (let j = cz * cellsPerChunk; j < (cz + 1) * cellsPerChunk; j++) {
        for (let i = cx * cellsPerChunk; i < (cx + 1) * cellsPerChunk; i++) {
          const p00 = corner(i, j);
          const p10 = corner(i + 1, j);
          const p01 = corner(i, j + 1);
          const p11 = corner(i + 1, j + 1);
          tri(p00, p01, p10);
          tri(p10, p01, p11);
        }
      }

      // Boxes: the unit-box template scaled, rotated and moved.
      for (const box of chunkBoxes) {
        const cs = Math.cos(box.yaw);
        const sn = Math.sin(box.yaw);
        const colour = colourOf.get(box)!;
        for (let k = 0; k < tPos.count; k++) {
          const lx = tPos.getX(k) * box.hx;
          const ly = tPos.getY(k) * box.hy;
          const lz = tPos.getZ(k) * box.hz;
          const nx = tNor.getX(k) * cs + tNor.getZ(k) * sn;
          put(
            box.x + lx * cs + lz * sn,
            box.y + ly,
            box.z - lx * sn + lz * cs,
            colour,
            shade(nx, tNor.getY(k)),
          );
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  template.dispose();
  return group;
}
