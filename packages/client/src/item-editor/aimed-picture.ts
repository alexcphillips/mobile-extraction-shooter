import type { ItemDb, WeaponState } from '@mes/shared';
import * as THREE from 'three';
import { AIM_FOV } from '../hud/optic';
import { Viewmodel } from '../render/viewmodel';

/*
 * A gun aimed in first person as a still picture (IE-1, the fits page): the game's own
 * viewmodel, fully aimed, at the aimed field of view, over the sky and ground the model
 * tab's first person uses. Only for iron sights and optics without zoom: through a scope the
 * game hides the gun behind the mask. One renderer, made on first use and kept.
 */

const SKY = 0x9fb3c6;
let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
const backdrop = new THREE.Scene();
backdrop.background = new THREE.Color(SKY);
backdrop.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2).translate(0, -1.6, 0),
    new THREE.MeshBasicMaterial({ color: 0x6b8a4e }),
  ),
);
const camera = new THREE.PerspectiveCamera(AIM_FOV, 16 / 9, 0.01, 100);

/** A picture, `width` × `height` pixels, as a data URL; null without WebGL. */
export function aimedPicture(
  gun: WeaponState,
  db: ItemDb,
  width: number,
  height: number,
): string | null {
  if (failed) return null;
  try {
    renderer ??= new THREE.WebGLRenderer({
      canvas: document.createElement('canvas'),
      antialias: true,
    });
  } catch {
    failed = true;
    return null;
  }
  renderer.autoClear = false;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const vm = new Viewmodel();
  vm.setGun(gun, db);
  vm.update(camera, 0, 0, 1, 0, 0, 1, 0);
  renderer.clear();
  renderer.render(backdrop, camera);
  renderer.clearDepth();
  renderer.render(vm.scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  vm.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of [m.material ?? []].flat()) mat.dispose();
  });
  return url;
}
