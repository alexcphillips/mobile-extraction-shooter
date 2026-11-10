import type { CompiledMap, Shape } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';

/** A silhouette is the sky's colour times this: a hazy shape, darker than the fog. */
export const SILHOUETTE_SHADE = 0.72;
/** Shapes smaller than this (their largest size, in metres) are left out: no detail. */
export const SILHOUETTE_MIN = 0.5;

/**
 * The landmarks past the fog (MT-1, design.md → Raids and maps → Silver Creek): every
 * landmark's shapes merged into one flat-coloured mesh, drawn first with a camera that sees
 * the whole map, then the world over it with depth cleared. So where the world is drawn
 * (up to the fog's far plane) it wins, and the silhouette shows only against the sky
 * beyond. One draw call, and none with no landmarks.
 */
export class LandmarkPass {
  readonly scene = new THREE.Scene();
  /** Null when the map has no landmarks. */
  readonly mesh: THREE.Mesh | null;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(map: CompiledMap) {
    this.mesh = buildSilhouettes(map);
    if (this.mesh) this.scene.add(this.mesh);
    const t = map.world.terrain;
    const reach = Math.hypot(t.cols * t.cellSize, t.rows * t.cellSize) + 100;
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, reach);
    // It takes the eye's matrices as they are; render must not recompute them.
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
  }

  /**
   * Draws the silhouettes from where eye is, into whatever is cleared; says whether it
   * drew, so the caller clears depth only then.
   */
  render(renderer: THREE.WebGLRenderer, eye: THREE.PerspectiveCamera): boolean {
    if (!this.mesh) return false;
    const c = this.camera;
    eye.updateMatrixWorld();
    c.matrixWorld.copy(eye.matrixWorld);
    c.matrixWorldInverse.copy(eye.matrixWorldInverse);
    if (c.fov !== eye.fov || c.aspect !== eye.aspect || c.zoom !== eye.zoom) {
      c.fov = eye.fov;
      c.aspect = eye.aspect;
      c.zoom = eye.zoom;
      c.updateProjectionMatrix();
    }
    renderer.render(this.scene, c);
    return true;
  }
}

/** The landmarks' shapes, small ones left out, as one mesh in a flat colour; or null. */
export function buildSilhouettes(map: CompiledMap): THREE.Mesh | null {
  const b = new TriangleBuilder(false);
  for (const s of map.landmarks) if (largestSize(s) >= SILHOUETTE_MIN) b.shape(s);
  if (b.triangles === 0) return null;
  const geometry = b.build();
  // One colour for all of it: the per-vertex colours and normals aren't used.
  geometry.deleteAttribute('color');
  geometry.deleteAttribute('normal');
  const colour = new THREE.Color(map.environment.sky).multiplyScalar(SILHOUETTE_SHADE);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colour, fog: false }));
  mesh.name = 'landmarks';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function largestSize(s: Shape): number {
  if (s.kind === 'cylinder') return 2 * Math.max(s.radius, s.radiusTop, s.hy);
  return 2 * Math.max(s.hx, s.hy, s.hz);
}
