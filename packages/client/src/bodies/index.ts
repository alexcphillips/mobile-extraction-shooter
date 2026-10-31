import {
  MOVEMENT,
  createHealth,
  giveWeapon,
  wearArmour,
  type Character,
  type ItemDb,
  heldWeapon,
  createGear,
  createItem,
  equip,
} from '@mes/shared';
import * as THREE from 'three';
import { loadItems } from '../content';
import { CapsuleBody } from '../render/capsule-body';
import { DEFAULT_OUTFIT, loadCharacter } from '../render/character';
import { CharacterBody, CharacterRig } from '../render/character-body';

/** One pose to show: a character set up in that state. */
interface Pose {
  name: string;
  set: (c: Character, items: ItemDb) => void;
  /** Swings its knife over and over. */
  slash?: boolean;
}

const rifle = (c: Character, items: ItemDb): void =>
  void giveWeapon(c, items, 'assault-rifle', ['red-dot']);
const pistol = (c: Character, items: ItemDb): void => void giveWeapon(c, items, 'pistol');
const knife = (c: Character, items: ItemDb): void => {
  equip(c, items, 'knife', createItem(items, 'knife'));
  c.gear.hand = 'knife';
};
const moving = (fwd: number, right: number) => (c: Character) => {
  // Facing −z: forward is −z and right is +x.
  c.vx = right;
  c.vz = -fwd;
};

const POSES: Pose[] = [
  { name: 'rifle low', set: rifle },
  { name: 'rifle aimed', set: (c, i) => (rifle(c, i), (c.aim = 1)) },
  { name: 'rifle aim up', set: (c, i) => (rifle(c, i), (c.aim = 1), (c.pitch = 0.5)) },
  { name: 'rifle aim down', set: (c, i) => (rifle(c, i), (c.aim = 1), (c.pitch = -0.5)) },
  { name: 'pistol low', set: pistol },
  { name: 'pistol aimed', set: (c, i) => (pistol(c, i), (c.aim = 1)) },
  { name: 'walk', set: (c, i) => (rifle(c, i), moving(1.6, 0)(c)) },
  { name: 'jog', set: (c, i) => (rifle(c, i), moving(MOVEMENT.walkSpeed, 0)(c)) },
  { name: 'sprint', set: (c, i) => (rifle(c, i), moving(MOVEMENT.sprintSpeed, 0)(c)) },
  { name: 'strafe right', set: (c, i) => (rifle(c, i), moving(0, MOVEMENT.walkSpeed)(c)) },
  { name: 'backwards', set: (c, i) => (rifle(c, i), moving(-MOVEMENT.walkSpeed, 0)(c)) },
  {
    name: 'crouch aimed',
    set: (c, i) => (rifle(c, i), (c.aim = 1), (c.height = MOVEMENT.crouchHeight)),
  },
  {
    name: 'crouch walk',
    set: (c, i) => (rifle(c, i), (c.height = MOVEMENT.crouchHeight), moving(1.5, 0)(c)),
  },
  { name: 'reload', set: (c, i) => (rifle(c, i), (heldWeapon(c)!.reloading = 2.4)) },
  { name: 'dead', set: (c, i) => (rifle(c, i), (c.health.dead = true)) },
  {
    name: 'using a med',
    set: (c, i) => (rifle(c, i), (c.using = { grid: 0, index: 0, item: 'bandage', left: 1 })),
  },
  { name: 'knife', set: knife },
  { name: 'knife slash', set: knife, slash: true },
  { name: 'unarmed', set: () => {} },
];

function character(id: number, x: number): Character {
  return {
    id,
    kind: 'character',
    x,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    mode: 'ground',
    height: MOVEMENT.standHeight,
    ladder: -1,
    vaulting: null,
    jumpHeld: false,
    landingSpeed: 0,
    health: createHealth(),
    gear: createGear(false),
    aim: 0,
    draw: 0,
    swing: 0,
    using: null,
    extracting: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    ai: null,
  };
}

/**
 * /bodies: every pose the character body has, side by side, with the simulation's hit
 * zones drawn see-through over them, to check animation and that bodies match their hit
 * zones. ?focus=<n> looks at one, ?view=front|side|back|top turns the camera, ?zones=0
 * hides the hit zones, ?t=<seconds> stops time there (for screenshots).
 */
export async function startBodies(canvas: HTMLCanvasElement, status: HTMLElement): Promise<void> {
  const q = new URLSearchParams(location.search);
  const items = loadItems();
  const rig = new CharacterRig(await loadCharacter('/characters/mannequin.glb'));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c4);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x7d8a6a }),
  );
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);

  const spacing = 1.4;
  const shown = POSES.map((pose, i) => {
    const c = character(i + 1, (i - (POSES.length - 1) / 2) * spacing);
    if (i % 3 === 1) wearArmour(c, items, 'steel-helmet');
    if (i % 2 === 0) wearArmour(c, items, 'plate-carrier');
    if (i % 4 === 1) equip(c, items, 'backpack', createItem(items, 'small-backpack'));
    pose.set(c, items);
    const body = new CharacterBody(rig, DEFAULT_OUTFIT, c);
    scene.add(body.root);
    const zones = q.get('zones') === '0' ? null : new CapsuleBody(0.35);
    if (zones) scene.add(zones.root);
    return { pose, c, body, zones };
  });
  // For poking at from the console.
  (window as { bodies?: unknown }).bodies = shown;
  status.textContent = POSES.map((p, i) => `${i} ${p.name}`).join('  ');

  const focus = q.has('focus') ? shown[Number(q.get('focus'))] : undefined;
  if (focus)
    for (const s of shown) {
      s.body.root.visible = s === focus;
      if (s.zones) s.zones.root.visible = s === focus;
    }
  const at = new THREE.Vector3(focus ? focus.c.x : 0, 1, 0);
  const far = focus ? 3.2 : 26;
  const DIRS: Record<string, readonly [number, number, number]> = {
    front: [0, 0.15, -1],
    side: [1, 0.15, 0],
    back: [0, 0.15, 1],
    top: [0.01, 1, -0.3],
  };
  // One view, or with ?focus and no ?view, front, side and top side by side.
  const views = q.has('view') || !focus ? [q.get('view') ?? 'front'] : ['front', 'side', 'top'];
  const place = (view: string): void => {
    const dir = DIRS[view] ?? DIRS.front!;
    camera.position.set(at.x + dir[0] * far, at.y + dir[1] * far, at.z + dir[2] * far);
    camera.lookAt(at);
    camera.updateMatrixWorld();
  };
  place(views[0]!);

  const frustum = new THREE.Frustum();
  const vp = new THREE.Matrix4();
  const stopAt = q.has('t') ? Number(q.get('t')) : Infinity;
  let elapsed = 0;
  let last = performance.now();
  const frame = (now: number): void => {
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (elapsed >= stopAt) dt = 0;
    // Jump straight to ?t in small steps, so screenshots are repeatable.
    const steps = elapsed === 0 && stopAt < Infinity ? Math.ceil(stopAt / (1 / 60)) : 1;
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    const vw = w / views.length;
    camera.aspect = vw / h;
    camera.updateProjectionMatrix();
    place(views[0]!);
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(vp);
    for (let s = 0; s < steps; s++) {
      const d = steps > 1 ? 1 / 60 : dt;
      elapsed += d;
      for (const { pose, c, body, zones } of shown) {
        // Slashes go round again, every 0.8 s.
        if (pose.slash && Math.floor(elapsed / 0.8) !== Math.floor((elapsed - d) / 0.8)) {
          body.swung();
        }
        // Reloads go round again.
        const w = heldWeapon(c);
        if (w && w.reloading > 0) {
          w.reloading -= d;
          if (w.reloading <= 0) w.reloading = 2.4;
        }
        body.update(c, items, 1, d, camera, frustum);
        zones?.update(c, items);
      }
    }
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
