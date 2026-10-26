import * as THREE from 'three';
import type { Box } from './raycast';
import { makeRng, shade } from './shade';

export const WORLD_SIZE = 256;
export const WORLD_MIN = -WORLD_SIZE / 2;
const CHUNK = 32;
const CELL = 2;
const SPAWN_CLEARING = 10;

const PALETTE = [0xc8a165, 0x8c8c8c, 0xa0522d, 0x6e7f80, 0xd9d0c1, 0x4f6d7a, 0x9b6a4f, 0x7a8b5c];
const GRASS = 0x6b8f4e;

/** Rolling hills as a height function; the real map stores a height grid. */
export function terrainHeight(x: number, z: number): number {
  return 3 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 1.5 * Math.sin(x * 0.13 + z * 0.09);
}

export function makeBoxes(count: number, seed: number): Box[] {
  const rng = makeRng(seed);
  const boxes: Box[] = [];
  while (boxes.length < count) {
    const x = WORLD_MIN + 4 + rng() * (WORLD_SIZE - 8);
    const z = WORLD_MIN + 4 + rng() * (WORLD_SIZE - 8);
    // Keep a clearing around the spawn at the origin.
    if (Math.hypot(x, z) < SPAWN_CLEARING) continue;
    const hx = 0.5 + rng() * 2.5;
    const hz = 0.5 + rng() * 2.5;
    const height = 1 + rng() * rng() * 8;
    // Sink the base 1 m so boxes don't float on slopes.
    const base = terrainHeight(x, z) - 1;
    boxes.push({
      x,
      y: base + (height + 1) / 2,
      z,
      hx,
      hy: (height + 1) / 2,
      hz,
      yaw: rng() * Math.PI * 2,
    });
  }
  return boxes;
}

/**
 * Builds one mesh per chunk containing its terrain and every box whose centre is in it,
 * coloured per vertex with per-face shading and drawn unlit.
 */
export function buildWorld(boxes: readonly Box[], seed: number): THREE.Group {
  const rng = makeRng(seed + 1);
  const n = WORLD_SIZE / CHUNK;
  const byChunk: Box[][] = Array.from({ length: n * n }, () => []);
  for (const b of boxes) {
    const cx = Math.min(n - 1, Math.floor((b.x - WORLD_MIN) / CHUNK));
    const cz = Math.min(n - 1, Math.floor((b.z - WORLD_MIN) / CHUNK));
    byChunk[cz * n + cx]!.push(b);
  }
  const colours = boxes.map(() => new THREE.Color(PALETTE[Math.floor(rng() * PALETTE.length)]!));
  const colourOf = new Map(boxes.map((b, i) => [b, colours[i]!]));

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

      // Terrain: two flat-shaded triangles per cell.
      const x0 = WORLD_MIN + cx * CHUNK;
      const z0 = WORLD_MIN + cz * CHUNK;
      const c = new THREE.Vector3();
      const nrm = new THREE.Vector3();
      const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3): void => {
        nrm.subVectors(q, p).cross(c.subVectors(r, p)).normalize();
        const f = shade(nrm.x, nrm.y);
        put(p.x, p.y, p.z, grass, f);
        put(q.x, q.y, q.z, grass, f);
        put(r.x, r.y, r.z, grass, f);
      };
      for (let j = 0; j < cellsPerChunk; j++) {
        for (let i = 0; i < cellsPerChunk; i++) {
          const xa = x0 + i * CELL;
          const za = z0 + j * CELL;
          const xb = xa + CELL;
          const zb = za + CELL;
          const p00 = new THREE.Vector3(xa, terrainHeight(xa, za), za);
          const p10 = new THREE.Vector3(xb, terrainHeight(xb, za), za);
          const p01 = new THREE.Vector3(xa, terrainHeight(xa, zb), zb);
          const p11 = new THREE.Vector3(xb, terrainHeight(xb, zb), zb);
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
