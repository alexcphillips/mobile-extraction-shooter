import { createWeapon, modelShapes, type ItemDb, type Outfit } from '@mes/shared';
import * as THREE from 'three';
import { loadBody, loadEnemies, loadItems, loadSkeleton } from '../content';
import { BodyMesh, NO_WORN, bodyGeometry, type WornGear } from '../render/body-model';
import { DEFAULT_OUTFIT } from '../render/character';
import {
  FIT_KIT,
  FIT_POSES,
  FIT_SLOTS,
  kitLayer,
  type FitKit,
  type FitSlot,
} from '../render/fit-check';
import { TriangleBuilder } from '../render/geometry';
import { gunModel, knifeModel } from '../render/gun-model';
import { itemMaterial } from '../render/material';
import { Pose, compileSkeleton } from '../render/skeleton-pose';

/**
 * /bodies?body=own (CH-3): our own body in the fit check's test poses (render/fit-check.ts,
 * the poses `scripts/anim-check.mjs --fit` measures), wearing the CH-3 test kit, so the
 * look and the numbers come from the same poses. ?kit=helmet=steel-helmet,visor= changes
 * slots of the kit (an empty id takes it off), ?bare wears nothing, ?outfit=scav-2 an enemy
 * outfit. ?focus, ?view, ?close as on /bodies. Still: no clips until CH-4.
 */
export function startOwnBodies(
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  q: URLSearchParams,
): void {
  const items = loadItems();
  const skeleton = compileSkeleton(loadSkeleton());
  const body = loadBody();

  const kit: FitKit = q.has('bare') ? {} : { ...FIT_KIT };
  for (const pair of (q.get('kit') ?? '').split(',').filter(Boolean)) {
    const [name, id] = pair.split('=');
    if (!(FIT_SLOTS as readonly (string | undefined)[]).includes(name)) continue;
    const slot = name as FitSlot;
    if (id) kit[slot] = id;
    else delete kit[slot];
  }
  const worn: WornGear = { ...NO_WORN, ...kit };
  const outfit = outfitOf(q.get('outfit'));
  const geometry = bodyGeometry(body, skeleton, outfit, worn, items);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c4);
  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(60, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7d8a6a }),
    ),
  );
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);

  const spacing = 1.2;
  const gunMaterial = itemMaterial();
  const shown = FIT_POSES.map((fp, i) => {
    const pose = new Pose(skeleton);
    fp.set(pose, items, kitLayer(kit));
    pose.update();
    const mesh = new BodyMesh(geometry, skeleton);
    mesh.pose(pose);
    mesh.mesh.position.x = (i - (FIT_POSES.length - 1) / 2) * spacing;
    if (fp.holds) {
      const gun = new THREE.Mesh(heldGeometry(items, fp.holds), gunMaterial);
      gun.matrixAutoUpdate = false;
      gun.matrix.fromArray(pose.weapon);
      mesh.mesh.add(gun);
    }
    scene.add(mesh.mesh);
    return mesh;
  });
  status.textContent =
    FIT_POSES.map((p, i) => `${i} ${p.name}`).join('  ') +
    `   kit: ${Object.values(kit).join(', ') || 'none'}`;

  const focusAt = q.has('focus') ? Number(q.get('focus')) : -1;
  const focus = shown[focusAt];
  if (focus) for (const s of shown) s.mesh.visible = s === focus;
  const close = q.has('close');
  const at = new THREE.Vector3(focus ? focus.mesh.position.x : 0, close ? 1.62 : 1, 0);
  const far = close ? 0.85 : focus ? 3.2 : 18;
  const DIRS: Record<string, readonly [number, number, number]> = {
    front: [0, 0.15, -1],
    side: [1, 0.15, 0],
    back: [0, 0.15, 1],
    top: [0.01, 1, -0.3],
    // From the front left and a little above, as the look target is drawn.
    three: [-0.7, 0.3, -0.75],
  };
  const views = q.has('view') || !focus ? [q.get('view') ?? 'front'] : ['front', 'side', 'three'];
  const place = (view: string): void => {
    const dir = DIRS[view] ?? DIRS.front!;
    camera.position.set(at.x + dir[0] * far, at.y + dir[1] * far, at.z + dir[2] * far);
    camera.lookAt(at);
    camera.updateMatrixWorld();
  };
  const frame = (): void => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    const vw = w / views.length;
    camera.aspect = vw / h;
    camera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    views.forEach((view, i) => {
      place(view);
      renderer.setViewport(i * vw, 0, vw, h);
      renderer.setScissor(i * vw, 0, vw, h);
      renderer.render(scene, camera);
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** `scav-2`: that enemy type's second outfit; the default outfit otherwise. */
function outfitOf(name: string | null): Outfit {
  if (!name) return DEFAULT_OUTFIT;
  const [enemy, n] = name.split(/-(?=\d+$)/);
  return loadEnemies().types.get(enemy!)?.outfits?.[Number(n ?? 1) - 1] ?? DEFAULT_OUTFIT;
}

/** A gun (with what it comes with) or knife in the gun's frame, as a body holds it. */
function heldGeometry(items: ItemDb, id: string): THREE.BufferGeometry {
  const def = items.get(id)!;
  const shapes =
    def.type === 'weapon'
      ? gunModel(createWeapon(items, id), items).shapes
      : def.type === 'melee'
        ? knifeModel(items, id).shapes
        : modelShapes(def.model);
  const b = new TriangleBuilder(false);
  for (const s of shapes) b.shape(s);
  return b.build();
}
