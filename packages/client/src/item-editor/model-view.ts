import {
  modelShapes,
  type AttachmentSlot,
  type ItemDb,
  type ModelPart,
  type OpticDef,
  type Shape,
  type Vec3,
  type WeaponState,
} from '@mes/shared';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { AIM_FOV, FOV, aimedFov, reticleMarkup } from '../hud/optic';
import { cloneCharacter, loadCharacter } from '../render/character';
import { TriangleBuilder } from '../render/geometry';
import { shadedMaterial } from '../render/material';
import { Viewmodel } from '../render/viewmodel';

/*
 * The item editor's 3D view (session 18b). Building: the open item's parts, each its own
 * mesh to click and drag with the gizmo, its points as dots, and what it goes with (the gun
 * an attachment sits on, the body gear is worn on) drawn but not pickable. Hip and aimed:
 * the game's own first-person gun (render/viewmodel.ts) and reticle overlay, through the
 * game's field of view, to check the sight line.
 */

/** What's picked: a part by index, or a point by its key ("grip", "mounts.optic"…). */
export type Picked = { kind: 'part'; index: number } | { kind: 'point'; key: string } | null;

export interface ModelScene {
  parts: readonly ModelPart[];
  /** Parts hidden by these slots are drawn faint (something is fitted there). */
  fitted: ReadonlySet<AttachmentSlot>;
  points: readonly { key: string; at: Vec3 }[];
  /** Drawn around the item and not pickable, in the item's frame. */
  context: readonly Shape[];
  /** Worn gear: the body it's modelled on. */
  body: boolean;
  /** Where the eye looks along −z from, when aimed. */
  sightLine: Vec3 | null;
}

/** What first person shows: a gun with attachments, or a knife. */
export type FirstPerson =
  | { kind: 'gun'; gun: WeaponState; db: ItemDb; optic: OpticDef | null }
  | { kind: 'knife'; id: string; db: ItemDb };

export type ViewMode = 'build' | 'hip' | 'aimed';

export interface ModelViewEvents {
  pick(p: Picked): void;
  /** The gizmo moved what's picked: its new centre, and for a part its yaw, pitch and roll. */
  moved(p: Picked, pos: Vec3, angles: Vec3 | null): void;
  dragStart(): void;
  dragEnd(): void;
}

const POINT_COLOURS: Record<string, number> = {
  grip: 0xff7043,
  support: 0xffca28,
  muzzle: 0xef5350,
  sight: 0x42a5f5,
};
const MOUNT_COLOUR = 0xab47bc;
const DEG = Math.PI / 180;
const SKY = 0x9fb3c6;

export const pointColour = (key: string): string =>
  `#${(POINT_COLOURS[key] ?? MOUNT_COLOUR).toString(16).padStart(6, '0')}`;

export class ModelView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.005, 50);
  private readonly fpCamera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  private readonly fpBackdrop = new THREE.Scene();
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  /** Parts and point dots: rebuilt by show(). */
  private readonly item = new THREE.Group();
  private readonly context = new THREE.Group();
  private readonly material = shadedMaterial();
  private readonly faint = shadedMaterial();
  private body: THREE.Object3D | null = null;
  private bodyWanted = false;
  private viewmodel: Viewmodel | null = null;
  private mode: ViewMode = 'build';
  private fp: FirstPerson | null = null;
  private picked: Picked = null;
  private pending: { scene: ModelScene; picked: Picked } | null = null;
  private down: { x: number; y: number } | null = null;
  private running = true;
  private readonly ray = new THREE.Raycaster();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: SVGSVGElement,
    private readonly events: ModelViewEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.faint.transparent = true;
    this.faint.opacity = 0.25;
    this.faint.depthWrite = false;
    this.scene.background = new THREE.Color(0x1d2229);
    this.fpBackdrop.background = new THREE.Color(SKY);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2).translate(0, -1.6, 0),
      new THREE.MeshBasicMaterial({ color: 0x6b8a4e }),
    );
    this.fpBackdrop.add(ground);

    const grid = new THREE.GridHelper(2, 40, 0x56606c, 0x343b44);
    const fine = new THREE.GridHelper(0.4, 40, 0x56606c, 0x2a3038);
    fine.position.y = 0.0001;
    this.scene.add(grid, fine, new THREE.AxesHelper(0.1), this.context, this.item);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.zoomSpeed = 1.5;
    // Option-drag orbits on a trackpad, as in the map editor.
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        this.orbit.mouseButtons.LEFT = e.altKey ? THREE.MOUSE.ROTATE : null;
        this.gizmo.enabled = !e.altKey;
      },
      { capture: true },
    );
    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSpace('local');
    this.gizmo.setSize(0.8);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (e.value) this.events.dragStart();
      else {
        this.events.dragEnd();
        const p = this.pending;
        this.pending = null;
        if (p) this.show(p.scene, p.picked);
      }
    });
    this.gizmo.addEventListener('objectChange', () => this.dragged());
    this.scene.add(this.gizmo.getHelper());

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !e.altKey && this.gizmo.axis === null)
        this.down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || this.gizmo.dragging || this.mode !== 'build') return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      this.events.pick(this.pick(e));
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.camera.position.set(0.5, 0.3, 0.6);
    this.orbit.update();

    let last = performance.now();
    const frame = (now: number): void => {
      if (!this.running) return;
      this.resize();
      this.render(now, now - last);
      last = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  dispose(): void {
    this.running = false;
    this.gizmo.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
  }

  /** Move or turn with the gizmo, snapped to `step` metres (0: off) and `angle` degrees. */
  setGizmo(mode: 'translate' | 'rotate', step: number, angle: number): void {
    this.gizmo.setMode(mode);
    this.gizmo.setTranslationSnap(step || null);
    this.gizmo.setRotationSnap(angle ? angle * DEG : null);
  }

  setMode(mode: ViewMode, fp: FirstPerson | null): void {
    this.mode = mode;
    this.fp = fp;
    this.viewmodel = null;
    if (mode === 'build' || !fp) {
      this.overlay.innerHTML = '';
      return;
    }
    const vm = new Viewmodel();
    if (fp.kind === 'gun') vm.setGun(fp.gun, fp.db);
    else vm.setKnife(fp.id, fp.db);
    this.viewmodel = vm;
    const optic = fp.kind === 'gun' && mode === 'aimed' ? fp.optic : null;
    this.overlay.innerHTML = optic ? reticleMarkup(optic) : '';
  }

  /** Redraws the item; while the gizmo is dragging, waits for it to let go. */
  show(scene: ModelScene, picked: Picked): void {
    if (this.gizmo.dragging) {
      this.pending = { scene, picked };
      return;
    }
    this.picked = picked;
    this.gizmo.detach();
    for (const g of [this.item, this.context]) {
      for (const o of g.children) (o as THREE.Mesh).geometry?.dispose();
      g.clear();
    }
    scene.parts.forEach((p, index) => {
      const mesh = partMesh(
        p,
        p.hiddenBy && scene.fitted.has(p.hiddenBy) ? this.faint : this.material,
      );
      if (!mesh) return;
      mesh.userData = { part: index };
      this.item.add(mesh);
      if (picked?.kind === 'part' && picked.index === index) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry),
          new THREE.LineBasicMaterial({ color: 0xffe082, depthTest: false }),
        );
        edges.renderOrder = 5;
        mesh.add(edges);
        this.gizmo.attach(mesh);
      }
    });
    for (const { key, at } of scene.points) {
      const on = picked?.kind === 'point' && picked.key === key;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(on ? 0.008 : 0.006, 12, 8),
        new THREE.MeshBasicMaterial({
          color: POINT_COLOURS[key] ?? MOUNT_COLOUR,
          depthTest: false,
        }),
      );
      dot.renderOrder = 4;
      dot.position.set(...at);
      dot.userData = { point: key };
      this.item.add(dot);
      if (on) this.gizmo.attach(dot);
    }
    if (picked?.kind === 'point') this.gizmo.setMode('translate');
    if (scene.sightLine) {
      const [x, y, z] = scene.sightLine;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, y, z + 0.3),
          new THREE.Vector3(x, y, z - 1),
        ]),
        new THREE.LineDashedMaterial({ color: 0x42a5f5, dashSize: 0.01, gapSize: 0.006 }),
      );
      line.computeLineDistances();
      this.context.add(line);
    }
    if (scene.context.length) {
      const b = new TriangleBuilder(false);
      for (const s of scene.context) b.shape(s);
      this.context.add(new THREE.Mesh(b.build(), this.material));
    }
    this.bodyWanted = scene.body;
    if (scene.body) void this.loadBody();
    if (this.body) this.body.visible = scene.body;
  }

  /** Points the camera at what's drawn. */
  frame(): void {
    const box = new THREE.Box3().setFromObject(this.item);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
    this.orbit.target.copy(centre);
    if (this.bodyWanted) {
      // Worn gear: from outside the body, on the gear's side of it (the front by default).
      const out = new THREE.Vector3(centre.x, 0, centre.z);
      if (out.length() < 0.05) out.set(0, 0, -1);
      out
        .normalize()
        .add(new THREE.Vector3(0.5, 0.4, 0))
        .normalize();
      this.camera.position.copy(centre).addScaledVector(out, 1.4);
    } else {
      // From the right and a little above: guns point along −z, so their right side.
      this.camera.position
        .copy(centre)
        .add(new THREE.Vector3(1.4, 0.7, -0.6).multiplyScalar(r * 1.6));
    }
    this.orbit.update();
  }

  private async loadBody(): Promise<void> {
    if (this.body) return;
    const template = await loadCharacter('/characters/mannequin.glb');
    if (this.body) return;
    this.body = cloneCharacter(template).root;
    this.body.visible = this.bodyWanted;
    this.scene.add(this.body);
  }

  private pick(e: PointerEvent): Picked {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.item.children, false);
    // Dots are drawn on top, so they win.
    const dot = hits.find((h) => h.object.userData.point !== undefined);
    const hit = dot ?? hits[0];
    if (!hit) return null;
    const u = hit.object.userData as { part?: number; point?: string };
    return u.point !== undefined
      ? { kind: 'point', key: u.point }
      : { kind: 'part', index: u.part! };
  }

  private dragged(): void {
    const o = this.gizmo.object;
    if (!o || !this.picked) return;
    const pos: Vec3 = [o.position.x, o.position.y, o.position.z];
    if (this.picked.kind === 'point') return this.events.moved(this.picked, pos, null);
    const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ');
    this.events.moved(this.picked, pos, [e.y / DEG, e.x / DEG, e.z / DEG]);
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width === Math.floor(w * this.renderer.getPixelRatio())) {
      if (this.canvas.height === Math.floor(h * this.renderer.getPixelRatio())) return;
    }
    this.renderer.setSize(w, h, false);
    for (const c of [this.camera, this.fpCamera]) {
      c.aspect = w / Math.max(1, h);
      c.updateProjectionMatrix();
    }
    this.overlay.setAttribute(
      'viewBox',
      `${-50 * (w / Math.max(1, h))} -50 ${100 * (w / Math.max(1, h))} 100`,
    );
  }

  private render(now: number, dtMs: number): void {
    this.renderer.clear();
    const vm = this.viewmodel;
    if (this.mode === 'build' || !vm || !this.fp) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const aimed = this.mode === 'aimed' && this.fp.kind === 'gun';
    const zoom = aimed && this.fp.kind === 'gun' ? (this.fp.optic?.zoom ?? 1) : 1;
    const fov = aimed ? (zoom > 1 ? aimedFov(zoom) : AIM_FOV) : FOV;
    if (this.fpCamera.fov !== fov) {
      this.fpCamera.fov = fov;
      this.fpCamera.updateProjectionMatrix();
    }
    this.renderer.render(this.fpBackdrop, this.fpCamera);
    // As in the game: a scope hides the gun behind its mask.
    vm.visible = zoom <= 1;
    vm.update(this.fpCamera, now, dtMs, aimed ? 1 : 0, 0, 0, 1, 0);
    this.renderer.clearDepth();
    this.renderer.render(vm.scene, this.fpCamera);
  }
}

/** One part as a mesh at its place, turned about its centre, so the gizmo can move it. */
function partMesh(p: ModelPart, material: THREE.Material): THREE.Mesh | null {
  const [shape] = modelShapes({ parts: [{ ...p, pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 }] });
  if (!shape || !Object.values(shape).every((v) => typeof v !== 'number' || Number.isFinite(v)))
    return null;
  const b = new TriangleBuilder(false);
  b.shape(shape);
  const mesh = new THREE.Mesh(b.build(), material);
  mesh.position.set(...p.pos);
  mesh.rotation.set((p.pitch ?? 0) * DEG, (p.yaw ?? 0) * DEG, (p.roll ?? 0) * DEG, 'YXZ');
  return mesh;
}
