import type { WindowState } from '@mes/shared';
import * as THREE from 'three';
import { shadedMaterial } from './material';

/** A plank: how far past the window's sides it reaches, how tall and thick it is. */
const OVERHANG = 0.15;
const PLANK_HEIGHT = 0.14;
const PLANK_THICKNESS = 0.035;
/** How far inside the window's middle the planks are nailed: just past the wall's face. */
const INSIDE = 0.18;
/** Planks lie a little crooked, alternately, up to this many degrees. */
const TILT = 14;
const WOOD = [0x8a6239, 0x7a5532, 0x94704a];

/**
 * Zombies mode's barricades (2026-11-04): every window's planks as one instanced mesh, one
 * draw call. Each window has a slot for each plank it can take, stacked up its opening on
 * the inside, each a little crooked; a plank that's off is shrunk to nothing. Only what
 * changed is rewritten.
 */
export class Barricades {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh | null = null;
  /** Where each window's slots start in the mesh. */
  private readonly first: number[] = [];
  private readonly shown: number[] = [];
  private readonly matrices: THREE.Matrix4[] = [];
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(windows: readonly WindowState[]) {
    const total = windows.reduce((n, w) => n + w.max, 0);
    if (!total) return;
    const geo = new THREE.BoxGeometry(1, PLANK_HEIGHT, PLANK_THICKNESS);
    const colour = new THREE.Color();
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(
        new Float32Array(geo.getAttribute('position').count * 3).fill(1),
        3,
      ),
    );
    this.mesh = new THREE.InstancedMesh(geo, shadedMaterial(), total);
    // Its bounds would be worked out while every plank is shrunk away, and then never again.
    this.mesh.frustumCulled = false;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    let k = 0;
    for (const w of windows) {
      this.first.push(k);
      this.shown.push(-1);
      const inX = Math.sin(w.yaw) * INSIDE;
      const inZ = Math.cos(w.yaw) * INSIDE;
      for (let i = 0; i < w.max; i++) {
        const up = (i + 0.5) / w.max;
        const tilt = (i % 2 ? 1 : -1) * TILT * (0.4 + (0.6 * ((i * 7) % 5)) / 4);
        e.set(0, w.yaw, (tilt * Math.PI) / 180);
        p.set(w.x + inX, w.y + 0.08 + up * (w.height - 0.16), w.z + inZ);
        s.set(w.width + OVERHANG * 2, 1, 1);
        this.matrices.push(new THREE.Matrix4().compose(p, q.setFromEuler(e), s));
        this.mesh.setColorAt(k, colour.setHex(WOOD[(i + k) % WOOD.length]!));
        this.mesh.setMatrixAt(k, this.hidden);
        k++;
      }
    }
    this.root.add(this.mesh);
  }

  /** Call once per tick or frame: shows each window's planks that are up. */
  update(windows: readonly WindowState[]): void {
    const mesh = this.mesh;
    if (!mesh) return;
    let changed = false;
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      if (w.planks === this.shown[i]) continue;
      this.shown[i] = w.planks;
      for (let k = 0; k < w.max; k++) {
        const slot = this.first[i]! + k;
        mesh.setMatrixAt(slot, k < w.planks ? this.matrices[slot]! : this.hidden);
      }
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }
}
