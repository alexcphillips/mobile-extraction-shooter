import {
  itemDef,
  modelShapes,
  type Item,
  type ItemDb,
  type ItemDef,
  type ItemView,
  type Shape,
  type WeaponState,
} from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { gunKey, gunModel } from './gun-model';
import { shadedMaterial } from './material';

/*
 * Item pictures for the item details (2026-10-30) and inventory tiles (2026-11-02): the
 * item's own model, drawn once into a small offscreen renderer and kept as an image by item
 * (a gun by its attachments too) and shape. The renderer is made on first use and kept, so
 * pictures don't make a WebGL context each. Each item picks its view (ItemDef.view); a
 * tile's picture is drawn at its tile's shape, so a long item fills a long tile.
 */

/** Pixels across a square picture, and per cell of a tile's. */
const SIZE = 320;
const CELL_PX = 72;

let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
const mesh = new THREE.Mesh(new THREE.BufferGeometry(), shadedMaterial());
scene.add(mesh);
const cache = new Map<string, string>();

/** An item's view: its own, or by its kind. */
export function viewOf(def: ItemDef): ItemView {
  if (def.view) return def.view;
  const long =
    def.type === 'weapon' ||
    def.type === 'melee' ||
    (def.type === 'attachment' && def.slot === 'magazine');
  return long ? 'side' : 'angled';
}

/** Where the camera is for each view, towards the model, and which way is up in the picture. */
const VIEWS: Record<ItemView, { from: THREE.Vector3; up: THREE.Vector3 }> = {
  // Straight down, the back (−z) at the top.
  top: { from: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  front: { from: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  // Every picture faces left (2026-11-09, the user's rule): every item model faces −z (a
  // gun's barrel, worn gear's front; content/models.ts), so −z is towards the left.
  // Side on from −x, so the barrel points left, a little from above. (It was from +x, which
  // pointed it right.)
  side: { from: new THREE.Vector3(-1, 0.25, 0).normalize(), up: new THREE.Vector3(0, 1, 0) },
  // A near-diagonal three-quarter turn from the front-left, so the front (−z) faces left,
  // about 18° from above (2026-11-09: half the old 35°, turned from 40° to 43° off the
  // front-back line). It was from the back-right (+x, +z), which showed worn gear's back.
  angled: {
    from: new THREE.Vector3(-1, 0.47, -1.08).normalize(),
    up: new THREE.Vector3(0, 1, 0),
  },
  // The same turn from the other three corners (2026-11-09, the user's call, to pick
  // from instead of turning a model by hand). These don't face left; the item chooses.
  frontRight: {
    from: new THREE.Vector3(1, 0.47, -1.08).normalize(),
    up: new THREE.Vector3(0, 1, 0),
  },
  backLeft: {
    from: new THREE.Vector3(-1, 0.47, 1.08).normalize(),
    up: new THREE.Vector3(0, 1, 0),
  },
  backRight: {
    from: new THREE.Vector3(1, 0.47, 1.08).normalize(),
    up: new THREE.Vector3(0, 1, 0),
  },
};

/**
 * A picture of an item as a data URL, or null if it can't be drawn (no WebGL). With
 * `shape` ([w, h] cells) it's drawn that shape, for a tile; else square, for the details.
 */
export function itemPortrait(
  items: ItemDb,
  item: Item,
  shape?: readonly [number, number],
): string | null {
  const def = itemDef(items, item.item);
  const gun = def.type === 'weapon' && item.attachments;
  const key = `${gun ? gunKey(item as WeaponState) : def.id}@${shape ? shape.join('x') : 'sq'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const shapes = gun ? gunModel(item as WeaponState, items).shapes : modelShapes(def.model);
  const url = drawPortrait(shapes, viewOf(def), shape);
  if (url) cache.set(key, url);
  return url;
}

/**
 * A picture of a model as it's edited, for the item editor: not kept, so every change
 * shows. Drawn square, or with `shape` as a tile.
 */
export function previewPortrait(def: ItemDef, shape?: readonly [number, number]): string | null {
  try {
    return drawPortrait(modelShapes(def.model), viewOf(def), shape);
  } catch {
    // A model half typed in (a size of 0, say) draws nothing until it's fixed.
    return null;
  }
}

const corner = new THREE.Vector3();

/** Half the width and height of a box as the camera sees it. */
function extent(box: THREE.Box3): [number, number] {
  let hx = 1e-3;
  let hy = 1e-3;
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    corner.applyMatrix4(camera.matrixWorldInverse);
    hx = Math.max(hx, Math.abs(corner.x));
    hy = Math.max(hy, Math.abs(corner.y));
  }
  return [hx, hy];
}

function drawPortrait(
  shapes: readonly Shape[],
  view: ItemView,
  shape?: readonly [number, number],
): string | null {
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
  const [w, h] = shape ?? [1, 1];
  const width = shape ? w * CELL_PX : SIZE;
  const height = shape ? h * CELL_PX : SIZE;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const b = new TriangleBuilder(false);
  for (const s of shapes) b.shape(s);
  const g = b.build();
  g.computeBoundingSphere();
  const sphere = g.boundingSphere!;
  g.translate(-sphere.center.x, -sphere.center.y, -sphere.center.z);
  mesh.geometry = g;

  const { from, up } = VIEWS[view];
  const r = Math.max(sphere.radius, 1e-3);
  camera.up.copy(up);
  camera.position.copy(from).multiplyScalar(r * 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  // Fit the model's box as the camera sees it into the picture's shape, with a margin.
  g.computeBoundingBox();
  const box = g.boundingBox!;
  let [hx, hy] = extent(box);
  // A model long one way in a tile long the other (a medkit, long front to back, in a
  // tall 1×2 tile) is rolled a quarter turn to fill it (2026-11-09, the user's call). Its
  // left goes to the bottom, so the tile turned (rotate(90deg), clockwise) faces left again.
  if (width !== height && width > height !== hx > hy) {
    camera.up.setFromMatrixColumn(camera.matrixWorld, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    [hx, hy] = extent(box);
  }
  const aspect = width / height;
  const half = Math.max(hy, hx / aspect) * 1.08;
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.bottom = -half;
  camera.top = half;
  camera.near = r * 0.5;
  camera.far = r * 6;
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  g.dispose();
  mesh.geometry = new THREE.BufferGeometry();
  return url;
}
