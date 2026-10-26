import { AI, eyeHeight, type Awareness, type Character, type NavGrid } from '@mes/shared';
import * as THREE from 'three';

/** Walkable spots in the biggest connected area, and in islands cut off from it. */
const MAIN = new THREE.Color(0x2ecc71);
const ISLAND = new THREE.Color(0xe67e22);
/** Columns per overlay chunk, so off-screen parts are culled. */
const CHUNK = 64;
const QUAD = 0.4;
const LIFT = 0.04;

/**
 * Every navigation node as a small square on its surface: green where AI can reach the
 * main area, orange on islands it can't get to or from (roofs, crate tops, a ladder-only
 * platform). Turned on with ?nav.
 */
export function buildNavOverlay(nav: NavGrid): THREE.Group {
  const group = new THREE.Group();
  let main = 0;
  nav.componentSizes.forEach((size, i) => {
    if (size > nav.componentSizes[main]!) main = i;
  });
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const h = QUAD / 2;
  for (let r0 = 0; r0 < nav.rows; r0 += CHUNK) {
    for (let q0 = 0; q0 < nav.cols; q0 += CHUNK) {
      const positions: number[] = [];
      const colours: number[] = [];
      for (let r = r0; r < Math.min(nav.rows, r0 + CHUNK); r++) {
        for (let q = q0; q < Math.min(nav.cols, q0 + CHUNK); q++) {
          const c = r * nav.cols + q;
          const x = nav.x(q);
          const z = nav.z(r);
          for (let n = nav.columnStart[c]!; n < nav.columnStart[c + 1]!; n++) {
            const y = nav.nodeY(n) + LIFT;
            positions.push(x - h, y, z - h, x - h, y, z + h, x + h, y, z + h);
            positions.push(x - h, y, z - h, x + h, y, z + h, x + h, y, z - h);
            const colour = nav.component[n] === main ? MAIN : ISLAND;
            for (let k = 0; k < 6; k++) colours.push(colour.r, colour.g, colour.b);
          }
        }
      }
      if (positions.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
      geometry.computeBoundingSphere();
      group.add(new THREE.Mesh(geometry, material));
    }
  }
  return group;
}

const AWARENESS_COLOURS: Record<Awareness, number> = {
  unaware: 0x95a5a6,
  suspicious: 0xf1c40f,
  alert: 0xe74c3c,
  searching: 0xe67e22,
};
/** Line segments drawn per frame at most: view cones, paths and focus crosses. */
const MAX_SEGMENTS = 1024;
const CONE_LENGTH = 6;

/**
 * What each enemy is thinking, for ?debug: a gem over its head coloured by awareness,
 * the edges of its view, its path and what it's focused on. One mesh per enemy and one
 * line mesh for everything, updated in place every frame.
 */
export class AiDebug {
  readonly root = new THREE.Group();
  private readonly gems: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly positions = new Float32Array(MAX_SEGMENTS * 6);
  private readonly colours = new Float32Array(MAX_SEGMENTS * 6);
  private readonly lines: THREE.LineSegments;
  private readonly colour = new THREE.Color();
  private count = 0;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    this.lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;
    this.root.add(this.lines);
  }

  update(enemies: readonly Character[]): void {
    this.count = 0;
    const half = (AI.fov / 2) * (Math.PI / 180);
    for (let i = 0; i < enemies.length; i++) {
      const c = enemies[i]!;
      const ai = c.ai;
      let gem = this.gems[i];
      if (!gem) {
        gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), new THREE.MeshBasicMaterial());
        this.gems[i] = gem;
        this.root.add(gem);
      }
      gem.visible = !!ai && !c.health.dead;
      if (!ai || c.health.dead) continue;
      gem.position.set(c.x, c.y + c.height + 0.4, c.z);
      gem.material.color.setHex(AWARENESS_COLOURS[ai.awareness]);
      this.colour.setHex(AWARENESS_COLOURS[ai.awareness]);

      const ey = eyeHeight(c);
      for (let side = -1; side <= 1; side += 2) {
        const yaw = c.yaw + side * half;
        this.segment(
          c.x,
          ey,
          c.z,
          c.x - Math.sin(yaw) * CONE_LENGTH,
          ey,
          c.z - Math.cos(yaw) * CONE_LENGTH,
        );
      }
      if (ai.hasGoal) {
        let px = c.x;
        let py = c.y + 0.1;
        let pz = c.z;
        for (let k = ai.pathIndex * 3; k < ai.path.length; k += 3) {
          const x = ai.path[k]!;
          const y = ai.path[k + 1]! + 0.1;
          const z = ai.path[k + 2]!;
          this.segment(px, py, pz, x, y, z);
          px = x;
          py = y;
          pz = z;
        }
      }
      if (ai.awareness !== 'unaware') {
        const { focusX: x, focusY: y, focusZ: z } = ai;
        this.segment(x - 0.5, y + 0.1, z, x + 0.5, y + 0.1, z);
        this.segment(x, y + 0.1, z - 0.5, x, y + 0.1, z + 0.5);
        this.segment(x, y, z, x, y + 1.5, z);
      }
    }
    const geometry = this.lines.geometry;
    geometry.setDrawRange(0, this.count * 2);
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
  }

  private segment(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (this.count >= MAX_SEGMENTS) return;
    const o = this.count++ * 6;
    this.positions[o] = x0;
    this.positions[o + 1] = y0;
    this.positions[o + 2] = z0;
    this.positions[o + 3] = x1;
    this.positions[o + 4] = y1;
    this.positions[o + 5] = z1;
    const { r, g, b } = this.colour;
    const cs = this.colours;
    cs[o] = cs[o + 3] = r;
    cs[o + 1] = cs[o + 4] = g;
    cs[o + 2] = cs[o + 5] = b;
  }
}
