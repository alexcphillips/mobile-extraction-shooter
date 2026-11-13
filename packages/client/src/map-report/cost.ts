// The map report's cost (MK-4, 2026-11-12; MT-11's measure): the map built as the game
// builds it (buildMap), counted whole and as seen from standing spots. "In view" is the
// camera's frustum out to the fog (no occlusion), the way three.js culls, so it's the
// draw calls the phone actually issues for the map. The landmarks' silhouette past the fog
// and characters aren't counted.
import type { CompiledMap, NavGrid } from '@mes/shared';
import * as THREE from 'three';
import { FOV } from '../hud/optic';
import { buildMap } from '../render/map';
import { mainComponent } from './measure';

export interface Cost {
  triangles: number;
  meshes: number;
  /** Draw calls and triangles in view: median and 95th percentile over the samples. */
  draws: { p50: number; p95: number };
  trisInView: { p50: number; p95: number };
  samples: number;
}

/**
 * spots: standing spots to look from (eye height is added); eight headings each. aspect is
 * a phone held sideways.
 */
export function measureCost(
  map: CompiledMap,
  spots: readonly { x: number; y: number; z: number }[],
  aspect = 2.16,
): Cost {
  const view = buildMap(map);
  const root = view.root;
  root.updateMatrixWorld(true);
  const meshes: { sphere: THREE.Sphere; tris: number }[] = [];
  let triangles = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const g = mesh.geometry;
    const per = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
    const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh) : null;
    const tris = per * (inst ? inst.count : 1);
    if (!tris) return;
    triangles += tris;
    if (inst) inst.computeBoundingSphere();
    else g.computeBoundingSphere();
    const sphere = (inst ? inst.boundingSphere! : g.boundingSphere!).clone();
    sphere.applyMatrix4(mesh.matrixWorld);
    meshes.push({ sphere, tris });
  });

  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.05, map.environment.fogFar);
  const frustum = new THREE.Frustum();
  const m = new THREE.Matrix4();
  const draws: number[] = [];
  const inView: number[] = [];
  for (const s of spots) {
    for (let k = 0; k < 8; k++) {
      camera.position.set(s.x, s.y + 1.6, s.z);
      camera.rotation.set(0, (k * Math.PI) / 4, 0);
      camera.updateMatrixWorld(true);
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(m);
      let n = 0;
      let t = 0;
      for (const mesh of meshes)
        if (frustum.intersectsSphere(mesh.sphere)) {
          n++;
          t += mesh.tris;
        }
      draws.push(n);
      inView.push(t);
    }
  }
  return {
    triangles,
    meshes: meshes.length,
    draws: percentiles(draws),
    trisInView: percentiles(inView),
    samples: draws.length,
  };
}

function percentiles(values: number[]): { p50: number; p95: number } {
  if (!values.length) return { p50: 0, p95: 0 };
  const v = [...values].sort((a, b) => a - b);
  const at = (p: number): number => v[Math.min(v.length - 1, Math.floor(p * v.length))]!;
  return { p50: at(0.5), p95: at(0.95) };
}

/** Standing spots spread over the AI's main area, picked the same way every run. */
export function costSpots(
  map: CompiledMap,
  nav: NavGrid,
  count = 150,
): { x: number; y: number; z: number }[] {
  const main = mainComponent(map, nav);
  const out: { x: number; y: number; z: number }[] = [];
  let seed = 12345;
  const total = nav.nodeCount;
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const n = seed % total;
    if (nav.component[n] !== main) continue;
    out.push({ x: nav.nodeX(n), y: nav.nodeY(n), z: nav.nodeZ(n) });
  }
  return out;
}
