import { itemDef, modelShapes, type Item, type ItemDb, type WeaponState } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { gunKey, gunModel } from './gun-model';
import { shadedMaterial } from './material';

/*
 * Item pictures for the item details (2026-10-30): the item's own model, drawn once into
 * a small offscreen renderer and kept as an image by item (a gun by its attachments too).
 * The renderer is made on first use and kept, so opening details doesn't make a WebGL
 * context each time. Long items (guns, knives, magazines) are seen from the side, the rest
 * from above at an angle.
 */

const SIZE = 320;

let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
const mesh = new THREE.Mesh(new THREE.BufferGeometry(), shadedMaterial());
scene.add(mesh);
const cache = new Map<string, string>();

/** A picture of an item as a data URL, or null if it can't be drawn (no WebGL). */
export function itemPortrait(items: ItemDb, item: Item): string | null {
  const def = itemDef(items, item.item);
  const gun = def.type === 'weapon' && item.attachments;
  const key = gun ? gunKey(item as WeaponState) : def.id;
  const hit = cache.get(key);
  if (hit) return hit;
  if (failed) return null;
  try {
    renderer ??= new THREE.WebGLRenderer({
      canvas: document.createElement('canvas'),
      alpha: true,
      antialias: true,
    });
  } catch {
    failed = true;
    return null;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);

  const b = new TriangleBuilder(false);
  const shapes = gun ? gunModel(item as WeaponState, items).shapes : modelShapes(def.model);
  for (const s of shapes) b.shape(s);
  const g = b.build();
  g.computeBoundingSphere();
  const sphere = g.boundingSphere!;
  g.translate(-sphere.center.x, -sphere.center.y, -sphere.center.z);
  mesh.geometry = g;

  const side =
    def.type === 'weapon' ||
    def.type === 'melee' ||
    (def.type === 'attachment' && def.slot === 'magazine');
  // Side on (barrel to the left), a little from above; or from above at a three-quarter turn.
  const dir = side ? new THREE.Vector3(1, 0.25, 0) : new THREE.Vector3(1, 1.1, 1.2);
  const r = Math.max(sphere.radius, 1e-3);
  camera.position.copy(dir.normalize().multiplyScalar(r * 3));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  // Fit the view to the model's box as the camera sees it, square, with a margin.
  g.computeBoundingBox();
  const box = g.boundingBox!;
  let half = 1e-3;
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    v.applyMatrix4(camera.matrixWorldInverse);
    half = Math.max(half, Math.abs(v.x), Math.abs(v.y));
  }
  camera.left = camera.bottom = -half * 1.08;
  camera.right = camera.top = half * 1.08;
  camera.near = r * 0.5;
  camera.far = r * 6;
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  g.dispose();
  mesh.geometry = new THREE.BufferGeometry();
  cache.set(key, url);
  return url;
}
