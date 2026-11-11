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

/**
 * What's picked: parts by index (one or several, IE-1), or a point by its key ("grip",
 * "mounts.optic"…).
 */
export type Picked =
  { kind: 'parts'; indices: readonly number[] } | { kind: 'point'; key: string } | null;

/** A part's new place after a gizmo drag: its center and its yaw, pitch and roll (degrees). */
export interface PartMove {
  index: number;
  pos: Vec3;
  angles: Vec3;
}

export interface ModelScene {
  parts: readonly ModelPart[];
  /** Parts hidden by these slots are drawn faint (something is fitted there). */
  fitted: ReadonlySet<AttachmentSlot>;
  points: readonly { key: string; at: Vec3 }[];
  /** Drawn around the item and not pickable, in the item's frame. */
  context: readonly Shape[];
  /** Worn gear: the body it's modeled on. */
  body: boolean;
  /** Where the eye looks along −z from, when aimed. */
  sightLine: Vec3 | null;
}

/** What first person shows: a gun with attachments, or a knife. */
export type FirstPerson =
  | { kind: 'gun'; gun: WeaponState; db: ItemDb; optic: OpticDef | null }
  | { kind: 'knife'; id: string; db: ItemDb };

export type ViewMode = 'build' | 'hip' | 'aimed';

/**
 * How building is looked at (IE-2): the orbit camera, or flat (orthographic) from one side.
 * Side looks from −x, so a gun's barrel points left as in its picture; top looks down with
 * the barrel left too, so the two line up; front looks along +z from −z, at the muzzle.
 */
export type Look = 'orbit' | 'side' | 'top' | 'front';
export const FLAT_LOOKS = ['side', 'top', 'front'] as const;
type FlatLook = (typeof FLAT_LOOKS)[number];

/** Where each flat camera sits from what it looks at, and which way is up on screen. */
const FLAT: Record<FlatLook, { from: THREE.Vector3; up: THREE.Vector3 }> = {
  side: { from: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { from: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(1, 0, 0) },
  front: { from: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
};

/**
 * A picture to trace under the side view (IE-2), kept in the editor only: `width` meters
 * along z, its middle at (y, z), its left towards −z (the barrel) unless flipped.
 */
export interface Reference {
  url: string;
  width: number;
  y: number;
  z: number;
  opacity: number;
  flip: boolean;
}

export interface ModelViewEvents {
  /** A click: what's under it (null for nothing); `add` with shift held. */
  pick(p: Picked, add: boolean): void;
  /** A box dragged on the view: the parts whose centers are inside it. */
  boxPick(indices: number[], add: boolean): void;
  /** The gizmo moved the picked parts. */
  movedParts(moves: PartMove[]): void;
  /** The gizmo moved a point. */
  movedPoint(key: string, pos: Vec3): void;
  dragStart(): void;
  dragEnd(): void;
}

const POINT_COLORS: Record<string, number> = {
  grip: 0xff7043,
  support: 0xffca28,
  muzzle: 0xef5350,
  sight: 0x42a5f5,
};
const MOUNT_COLOR = 0xab47bc;
const DEG = Math.PI / 180;
const SKY = 0x9fb3c6;

export const pointColor = (key: string): string =>
  `#${(POINT_COLORS[key] ?? MOUNT_COLOR).toString(16).padStart(6, '0')}`;

export class ModelView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.005, 50);
  private readonly fpCamera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  private readonly fpBackdrop = new THREE.Scene();
  private readonly orbit: OrbitControls;
  /** The flat cameras, each with its own pan and zoom (OrbitControls fixes a camera's up). */
  private readonly flats: Record<
    FlatLook,
    { camera: THREE.OrthographicCamera; controls: OrbitControls }
  >;
  private look: Look = 'orbit';
  /** Half the height a flat camera shows at zoom 1, in meters. */
  private flatSize = 0.4;
  private readonly grids = new THREE.Group();
  private readonly reference = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateY(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  private referenceUrl: string | null = null;
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
  /** What the gizmo drives: the one picked part's place, or the middle of several. */
  private readonly pivot = new THREE.Object3D();
  /** The picked parts' meshes, and where each and the pivot were when a drag began. */
  private chosen: { index: number; mesh: THREE.Mesh }[] = [];
  private dragFrom: { pivot: THREE.Matrix4; parts: THREE.Matrix4[] } | null = null;
  /** The box being dragged out to pick parts. */
  private readonly band: HTMLDivElement;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;
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
    this.grids.add(grid, fine);
    this.reference.visible = false;
    this.reference.renderOrder = -1;
    this.scene.add(this.grids, this.reference, new THREE.AxesHelper(0.1), this.context, this.item);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.zoomSpeed = 1.5;
    const flat = (look: FlatLook) => {
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
      camera.up.copy(FLAT[look].up);
      camera.position.copy(FLAT[look].from).multiplyScalar(10);
      const controls = new OrbitControls(camera, canvas);
      controls.enableRotate = false;
      controls.zoomToCursor = true;
      controls.zoomSpeed = 1.5;
      controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
      controls.enabled = false;
      return { camera, controls };
    };
    this.flats = { side: flat('side'), top: flat('top'), front: flat('front') };
    // Option-drag orbits on a trackpad, as in the map editor (pans, in a flat view).
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        this.orbit.mouseButtons.LEFT = e.altKey ? THREE.MOUSE.ROTATE : null;
        for (const f of Object.values(this.flats))
          f.controls.mouseButtons.LEFT = e.altKey ? THREE.MOUSE.PAN : null;
        this.gizmo.enabled = !e.altKey;
      },
      { capture: true },
    );
    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSpace('local');
    this.gizmo.setSize(0.8);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) {
        this.pivot.updateMatrix();
        this.dragFrom = {
          pivot: this.pivot.matrix.clone().invert(),
          parts: this.chosen.map(({ mesh }) => (mesh.updateMatrix(), mesh.matrix.clone())),
        };
        this.events.dragStart();
      } else {
        this.dragFrom = null;
        this.events.dragEnd();
        const p = this.pending;
        this.pending = null;
        if (p) this.show(p.scene, p.picked);
      }
    });
    this.gizmo.addEventListener('objectChange', () => this.dragged());
    this.scene.add(this.gizmo.getHelper(), this.pivot);

    // A left click picks; a left drag off the gizmo draws a box that picks every part whose
    // center is inside it. Shift adds to what's picked.
    this.band = document.createElement('div');
    this.band.className = 'ie-band';
    this.band.hidden = true;
    canvas.parentElement?.append(this.band);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !e.altKey && this.gizmo.axis === null)
        this.down = { x: e.clientX, y: e.clientY };
    });
    this.onMove = (e) => {
      const d = this.down;
      if (!d || this.gizmo.dragging || this.mode !== 'build') return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 4) return;
      const r = canvas.getBoundingClientRect();
      Object.assign(this.band.style, {
        left: `${Math.min(d.x, e.clientX) - r.left}px`,
        top: `${Math.min(d.y, e.clientY) - r.top}px`,
        width: `${Math.abs(e.clientX - d.x)}px`,
        height: `${Math.abs(e.clientY - d.y)}px`,
      });
      this.band.hidden = false;
    };
    this.onUp = (e) => {
      const d = this.down;
      this.down = null;
      this.band.hidden = true;
      if (!d || this.gizmo.dragging || this.mode !== 'build') return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) {
        this.events.boxPick(this.inBox(d.x, d.y, e.clientX, e.clientY), e.shiftKey);
      } else if (e.target === canvas) this.events.pick(this.pick(e), e.shiftKey);
    };
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
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
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.band.remove();
    this.gizmo.dispose();
    this.orbit.dispose();
    for (const f of Object.values(this.flats)) f.controls.dispose();
    this.setReference(null);
    this.renderer.dispose();
  }

  /** Move or turn with the gizmo, snapped to `step` meters (0: off) and `angle` degrees. */
  setGizmo(mode: 'translate' | 'rotate', step: number, angle: number): void {
    this.gizmo.setMode(mode);
    this.gizmo.setTranslationSnap(step || null);
    this.gizmo.setRotationSnap(angle ? angle * DEG : null);
  }

  /** The camera building is drawn with. */
  private get active(): THREE.Camera {
    return this.look === 'orbit' ? this.camera : this.flats[this.look].camera;
  }

  private get controls(): OrbitControls {
    return this.look === 'orbit' ? this.orbit : this.flats[this.look].controls;
  }

  /**
   * Looks at the item flat from one side, or with the orbit camera again. A flat view starts
   * on what the orbit camera looked at; the grid moves behind the item, square to the view.
   */
  setLook(look: Look): void {
    if (look === this.look) return;
    const from = this.controls.target.clone();
    this.controls.enabled = false;
    this.look = look;
    this.controls.enabled = true;
    this.gizmo.camera = this.active;
    if (look !== 'orbit') {
      const f = this.flats[look];
      f.controls.target.copy(from);
      f.camera.position.copy(from).addScaledVector(FLAT[look].from, 10);
      f.controls.update();
    }
    // The grid behind the item: in the plane square to the view, a meter back.
    this.grids.rotation.set(0, 0, 0);
    this.grids.position.set(0, 0, 0);
    if (look === 'side') {
      this.grids.rotation.z = Math.PI / 2;
      this.grids.position.x = 1;
    } else if (look === 'front') {
      this.grids.rotation.x = Math.PI / 2;
      this.grids.position.z = 1;
    } else if (look === 'top') this.grids.position.y = -1;
    this.reference.visible = look === 'side' && !!this.referenceUrl;
  }

  /** A picture to trace under the side view, or none. */
  setReference(ref: Reference | null): void {
    const m = this.reference.material as THREE.MeshBasicMaterial;
    if (ref?.url !== this.referenceUrl) {
      m.map?.dispose();
      m.map = null;
      this.referenceUrl = ref?.url ?? null;
      if (ref) {
        const tex = new THREE.TextureLoader().load(ref.url, (t) => {
          // Its height from its width, once the picture has loaded.
          const img = t.image as { width: number; height: number };
          this.reference.userData.aspect = img.height / Math.max(1, img.width);
          this.placeReference();
        });
        tex.colorSpace = THREE.SRGBColorSpace;
        m.map = tex;
      }
      m.needsUpdate = true;
    }
    this.reference.userData.ref = ref;
    this.placeReference();
    this.reference.visible = this.look === 'side' && !!ref;
  }

  private placeReference(): void {
    const ref = this.reference.userData.ref as Reference | null | undefined;
    if (!ref) return;
    const aspect = (this.reference.userData.aspect as number | undefined) ?? 0.5;
    const m = this.reference.material as THREE.MeshBasicMaterial;
    m.opacity = ref.opacity;
    // The plane faces −x, its own +x along +z; just in front of the grid.
    this.reference.position.set(0.95, ref.y, ref.z);
    this.reference.scale.set(1, ref.width * aspect, ref.width * (ref.flip ? -1 : 1));
  }

  /**
   * Which model axes the arrow keys move along: right and up on screen, and towards the
   * viewer (⇧). The orbit view uses x, y and −z (forward, along a barrel).
   */
  screenAxes(): { right: Vec3; up: Vec3; out: Vec3 } {
    if (this.look === 'orbit') return { right: [1, 0, 0], up: [0, 1, 0], out: [0, 0, -1] };
    const c = this.flats[this.look].camera;
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    const r = (v: number): number => Math.round(v);
    return {
      right: [r(e[0]!), r(e[1]!), r(e[2]!)],
      up: [r(e[4]!), r(e[5]!), r(e[6]!)],
      out: [r(e[8]!), r(e[9]!), r(e[10]!)],
    };
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
    this.chosen = [];
    const chosen = new Set(picked?.kind === 'parts' ? picked.indices : []);
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
      if (chosen.has(index)) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry),
          new THREE.LineBasicMaterial({ color: 0xffe082, depthTest: false }),
        );
        edges.renderOrder = 5;
        mesh.add(edges);
        this.chosen.push({ index, mesh });
      }
    });
    this.placePivot();
    for (const { key, at } of scene.points) {
      const on = picked?.kind === 'point' && picked.key === key;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(on ? 0.008 : 0.006, 12, 8),
        new THREE.MeshBasicMaterial({
          color: POINT_COLORS[key] ?? MOUNT_COLOR,
          depthTest: false,
        }),
      );
      dot.renderOrder = 4;
      dot.position.set(...at);
      dot.userData = { point: key };
      this.item.add(dot);
      if (on) this.gizmo.attach(dot);
    }
    if (picked?.kind === 'point') {
      this.gizmo.setMode('translate');
      this.gizmo.setSpace('local');
    }
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

  /**
   * The gizmo on the picked parts: one part's own place and turn (moved along its own
   * axes), or the middle of several, square to the world.
   */
  private placePivot(): void {
    const c = this.chosen;
    if (!c.length) return;
    if (c.length === 1) {
      this.pivot.position.copy(c[0]!.mesh.position);
      this.pivot.quaternion.copy(c[0]!.mesh.quaternion);
      this.gizmo.setSpace('local');
    } else {
      const box = new THREE.Box3();
      for (const { mesh } of c) box.expandByObject(mesh);
      box.getCenter(this.pivot.position);
      this.pivot.quaternion.identity();
      this.gizmo.setSpace('world');
    }
    this.pivot.updateMatrix();
    this.gizmo.attach(this.pivot);
  }

  /** Points the camera at the picked parts, or at everything drawn. */
  frame(): void {
    const box = new THREE.Box3();
    for (const { mesh } of this.chosen) box.expandByObject(mesh);
    if (box.isEmpty()) box.setFromObject(this.item);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
    if (this.look !== 'orbit') {
      const f = this.flats[this.look];
      f.controls.target.copy(center);
      f.camera.position.copy(center).addScaledVector(FLAT[this.look].from, 10);
      f.camera.zoom = this.flatSize / (r * 1.15);
      f.camera.updateProjectionMatrix();
      f.controls.update();
      return;
    }
    this.orbit.target.copy(center);
    if (this.bodyWanted) {
      // Worn gear: from outside the body, on the gear's side of it (the front by default).
      const out = new THREE.Vector3(center.x, 0, center.z);
      if (out.length() < 0.05) out.set(0, 0, -1);
      out
        .normalize()
        .add(new THREE.Vector3(0.5, 0.4, 0))
        .normalize();
      this.camera.position.copy(center).addScaledVector(out, 1.4);
    } else {
      // From the right and a little above: guns point along −z, so their right side.
      this.camera.position
        .copy(center)
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
    this.ray.setFromCamera(ndc, this.active);
    const hits = this.ray.intersectObjects(this.item.children, false);
    // Dots are drawn on top, so they win.
    const dot = hits.find((h) => h.object.userData.point !== undefined);
    const hit = dot ?? hits[0];
    if (!hit) return null;
    const u = hit.object.userData as { part?: number; point?: string };
    return u.point !== undefined
      ? { kind: 'point', key: u.point }
      : { kind: 'parts', indices: [u.part!] };
  }

  /** The parts whose centers are inside a box dragged between two screen points. */
  private inBox(x0: number, y0: number, x1: number, y1: number): number[] {
    const r = this.canvas.getBoundingClientRect();
    const [l, rt] = [Math.min(x0, x1) - r.left, Math.max(x0, x1) - r.left];
    const [t, b] = [Math.min(y0, y1) - r.top, Math.max(y0, y1) - r.top];
    const v = new THREE.Vector3();
    const out: number[] = [];
    for (const o of this.item.children) {
      const index = (o.userData as { part?: number }).part;
      if (index === undefined) continue;
      v.copy(o.position).project(this.active);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * r.width;
      const sy = ((1 - v.y) / 2) * r.height;
      if (sx >= l && sx <= rt && sy >= t && sy <= b) out.push(index);
    }
    return out;
  }

  private dragged(): void {
    const o = this.gizmo.object;
    const p = this.picked;
    if (!o || !p) return;
    if (p.kind === 'point')
      return this.events.movedPoint(p.key, [o.position.x, o.position.y, o.position.z]);
    const from = this.dragFrom;
    if (!from) return;
    // What the gizmo did to the pivot since the drag began, done to every picked part.
    this.pivot.updateMatrix();
    const delta = this.pivot.matrix.clone().multiply(from.pivot);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const moves: PartMove[] = this.chosen.map(({ index, mesh }, k) => {
      m.multiplyMatrices(delta, from.parts[k]!);
      m.decompose(mesh.position, mesh.quaternion, s);
      e.setFromQuaternion(mesh.quaternion, 'YXZ');
      return {
        index,
        pos: [mesh.position.x, mesh.position.y, mesh.position.z],
        angles: [e.y / DEG, e.x / DEG, e.z / DEG],
      };
    });
    this.events.movedParts(moves);
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
    const half = this.flatSize;
    for (const { camera } of Object.values(this.flats)) {
      camera.left = -half * (w / Math.max(1, h));
      camera.right = half * (w / Math.max(1, h));
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
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
      this.renderer.render(this.scene, this.active);
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

/** One part as a mesh at its place, turned about its center, so the gizmo can move it. */
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
