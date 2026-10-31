import {
  HeightGrid,
  compileNodes,
  concreteBase,
  type CompiledBuilding,
  type CompiledMap,
  type MapFile,
  type MapNode,
  type PrefabFile,
  type PrefabLookup,
} from '@mes/shared';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { buildDebug } from '../render/debug';
import { TriangleBuilder } from '../render/geometry';
import { CHUNK, buildDoor } from '../render/map';
import { bakedMaterial, shadedMaterial } from '../render/material';
import { nodePos, nodeYaw, round, type NodePath, type Vec3 } from './doc';
import { disposeLabels } from '../notes';
import { footprintsOverlap } from './overlap';
import { applyBrush, terrainGrid, type Brush, type TerrainGrid } from './terrain';

const DEG = Math.PI / 180;
const SELECTED = 0xffd400;
const ACTIVE = 0xff8c00;
const SCOPE = 0x36d1dc;
/** The outline of a prefab being edited inside: what changes there changes every copy. */
const PREFAB_SCOPE = 0xc77dff;
const BROKEN = 0xff00ff;
const WARNING = 0xff2a2a;
const BRUSH = 0xffffff;
/** Handles on the points of a patrol or zone being edited, and the one picked. */
const HANDLE = 0xffffff;
const HANDLE_ON = 0xff8c00;
const HANDLE_SIZE = 0.25;
/** How far the drop looks up for a surface to land on, so things climb kerbs and slopes. */
const DROP_REACH = 0.3;
/** How near a face must come to another thing's to snap to it, and how near that thing must be. */
const OBJECT_SNAP = 0.25;
const OBJECT_SNAP_NEAR = 1;
/** The outline of the thing a drag has snapped to. */
const SNAP_GUIDE = 0x4dd2ff;
/** Where the cutaway cuts through solids. */
const CAP = 0x2b2f36;

/** What a drag of the gizmo did: each selected index moved from `from` to `to`, turned `yaw`°. */
export interface Moved {
  index: number;
  from: Vec3;
  to: Vec3;
  yaw: number;
}

export interface ViewOptions {
  gridSnap: number;
  angleSnap: number;
  snapDown: boolean;
  /** Snap what's dragged flush with, or in line with, the faces of things beside it. */
  objectSnap: boolean;
}

export interface ViewEvents {
  /**
   * A click on the scene (not a drag): the node in scope under it, or null; or, for a node
   * outside the group being edited, its top-level path in `outside`.
   */
  click(e: MouseEvent, index: number | null, outside: NodePath | null): void;
  doubleClick(index: number | null): void;
  moved(moves: Moved[]): void;
  /** A node failed to build (an unknown colour slot or prefab, say). */
  broken(message: string): void;
  /** A brush stroke ended, with the terrain's corner heights as they now are. */
  terrain(heights: Float64Array): void;
  /** A handle was dragged to `to` (in the scope's frame), or just clicked (`to` null). */
  handle(index: number, to: Vec3 | null): void;
  /** The mouse moved over the scene (not dragging anything). */
  hover(e: PointerEvent): void;
}

/** Points drawn as handles: a patrol's or zone's being edited, or one being drawn. */
export interface Handles {
  /** In the scope's frame. */
  points: readonly Vec3[];
  /** The picked one, drawn orange. */
  picked: number | null;
  /** Joined by a line, closed into a loop or not; patrols draw their own. */
  line: 'none' | 'open' | 'closed';
  /** Dragged on the terrain only (zones), or onto any surface (patrol points). */
  terrainOnly: boolean;
}

/**
 * The map editor's scene. Each node is its own object at its pos and yaw (a group's holds
 * its nodes' objects, and so does a placed prefab's while it's being edited inside), so it
 * can be picked and moved; nothing is merged as it is in play.
 */
export class EditorView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  private readonly scene = new THREE.Scene();
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly pivot = new THREE.Object3D();
  private readonly ground = new THREE.Group();
  private root = new THREE.Group();
  private readonly helpers = new THREE.Group();
  private readonly handleGroup = new THREE.Group();
  private handles: Handles | null = null;
  private handleDrag: { index: number; moved: boolean } | null = null;
  private overlay: THREE.Object3D | null = null;
  private placingNow = false;
  private readonly material = shadedMaterial();
  private prefabs: PrefabLookup = new Map();
  private readonly baked = bakedMaterial();
  private terrain: HeightGrid;
  /** The terrain as edited, and its meshes by chunk. */
  private grid: TerrainGrid | null = null;
  private terrainColour = 0;
  private chunks: THREE.Mesh[] = [];
  private chunkCells = 1;
  /** What the ground was built from, to rebuild it only when it changes. */
  private groundKey = '';
  private readonly bases = new THREE.Group();
  /** Paths (joined with dots) of what overlaps something. */
  private warnings: string[] = [];
  /** The brush while the terrain tool is on, its ring, and the stroke being made. */
  private brushSettings: Brush | null = null;
  private readonly ring = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: BRUSH, depthTest: false, transparent: true }),
  );
  private stroke: { x: number; z: number; level: number; shift: boolean } | null = null;
  private pointer: { clientX: number; clientY: number } | null = null;
  /** The object of each node, by its path joined with dots. */
  private objects = new Map<string, THREE.Object3D>();
  private scope: NodePath = [];
  private selected: number[] = [];
  private readonly keys = new Set<string>();
  private readonly raycaster = new THREE.Raycaster();
  private drag: {
    start: THREE.Vector3;
    objects: { index: number; object: THREE.Object3D; pos: THREE.Vector3; yaw: number }[];
    exclude: Set<THREE.Object3D>;
    moving: Set<THREE.Object3D>;
    still: CompiledBuilding[];
    /**
     * Around what's dragged, in `snapFrame` (the scope's frame turned to its yaw, so a turned
     * wall snaps to walls turned the same way); null if its parts aren't square to each other.
     */
    box: THREE.Box3 | null;
    /** What it can snap to: everything else that's square to that frame. */
    targets: THREE.Box3[];
  } | null = null;
  private readonly snapGuide = new THREE.Box3Helper(new THREE.Box3(), SNAP_GUIDE);
  private readonly snapFrame = new THREE.Object3D();
  private labels: THREE.Object3D | null = null;
  /** What's being drawn (walls), shown see-through in the scope's frame. */
  private preview: THREE.Object3D | null = null;
  private readonly previewMaterial = Object.assign(shadedMaterial(), {
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private down: { x: number; y: number } | null = null;
  /** The cutaway's height in the world (everything above is hidden), or null. */
  private cutY: number | null = null;
  /** Every material in the scene clips by these: the cutaway's plane, or none. */
  private readonly clipPlanes: THREE.Plane[] = [];
  /**
   * The cutaway's caps (the stencil technique): solids' back faces count up and front faces
   * down, so what's left non-zero is inside a cut solid, where the cap is drawn.
   */
  private readonly capCount = [THREE.BackSide, THREE.FrontSide].map(
    (side) =>
      new THREE.MeshBasicMaterial({
        side,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        ...stencilOp(
          side === THREE.BackSide ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp,
        ),
        clippingPlanes: this.clipPlanes,
      }),
  );
  private readonly capScene = new THREE.Scene();
  private readonly cap = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: CAP,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      ...stencilOp(THREE.ReplaceStencilOp),
    }),
  );
  options: ViewOptions = { gridSnap: 0.5, angleSnap: 15, snapDown: true, objectSnap: true };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    compiled: CompiledMap,
    private readonly events: ViewEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    darkenBackFaces(this.material);
    this.material.clippingPlanes = this.clipPlanes;
    this.baked.clippingPlanes = this.clipPlanes;
    this.terrain = new HeightGrid(compiled.world.terrain);
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    this.snapGuide.visible = false;
    this.snapGuide.raycast = () => {};
    this.snapFrame.add(this.snapGuide);
    this.cap.raycast = () => {};
    this.capScene.add(this.cap);
    this.scene.add(this.ground, this.root, this.bases, this.helpers, this.ring, this.handleGroup);

    const t = compiled.world.terrain;
    const cx = t.minX + (t.cols * t.cellSize) / 2;
    const cz = t.minZ + (t.rows * t.cellSize) / 2;
    const target = new THREE.Vector3(cx, this.terrain.heightAt(cx, cz), cz);
    this.camera.position.copy(target).add(new THREE.Vector3(30, 35, 30));

    this.orbit = new OrbitControls(this.camera, canvas);
    // Left button is for selecting and the gizmo, unless Option is held (see below). A
    // mouse's middle and right buttons work too; the wheel is handled in `wheel`.
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.target.copy(target);
    this.orbit.enableDamping = false;
    this.orbit.enableZoom = false;
    this.orbit.update();

    // On a trackpad: Option-drag orbits and Option-Shift-drag pans (OrbitControls turns a
    // rotate with Shift into a pan). Set before OrbitControls and the gizmo see the press.
    window.addEventListener(
      'pointerdown',
      (e) => {
        this.orbit.mouseButtons.LEFT = e.altKey ? THREE.MOUSE.ROTATE : null;
        this.gizmo.enabled = !e.altKey;
      },
      { capture: true },
    );
    window.addEventListener('pointerup', () => (this.gizmo.enabled = true));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSpace('local');
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (e.value) this.startDrag();
      else this.endDrag();
    });
    this.gizmo.addEventListener('objectChange', () => this.dragged());
    this.scene.add(this.gizmo.getHelper());

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !e.altKey && this.brushSettings) return this.startStroke(e);
      if (e.button === 0 && !e.altKey && this.gizmo.axis === null && this.startHandleDrag(e))
        return;
      // A press on the gizmo (it lights up an axis on hover) is a drag, not a click.
      // An Option-drag moves the camera.
      if (e.button === 0 && this.gizmo.axis === null && !e.altKey)
        this.down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { clientX: e.clientX, clientY: e.clientY };
      if (this.handleDrag) this.dragHandle(e);
      if (this.stroke) this.stroke.shift = e.shiftKey;
      this.moveRing();
      if (!this.handleDrag && !this.stroke && !this.gizmo.dragging) this.events.hover(e);
    });
    canvas.addEventListener('pointerleave', () => {
      if (!this.stroke) this.ring.visible = false;
    });
    window.addEventListener('pointerup', () => {
      this.endStroke();
      this.endHandleDrag();
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (e.button !== 0 || !d || this.gizmo.dragging) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      const hit = this.pick(e);
      this.events.click(e, hit.index, hit.outside);
    });
    canvas.addEventListener('dblclick', (e) => this.events.doubleClick(this.pick(e).index));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (!typing(e)) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('resize', () => this.resize());
    this.resize();

    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      this.fly(dt);
      this.brushFrame(dt);
      last = now;
      for (const h of this.helpers.children) (h as THREE.BoxHelper).update?.();
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /**
   * Draws the scene. With the cutaway on: everything but what's drawn over it, then the
   * caps over cut solids, then the outlines, handles and gizmo on top.
   */
  private render(): void {
    const r = this.renderer;
    if (this.cutY === null) return r.render(this.scene, this.camera);
    const kids = this.scene.children;
    const shown = kids.map((k) => k.visible);
    const only = (keep: readonly THREE.Object3D[]): void =>
      kids.forEach((k, i) => (k.visible = shown[i]! && keep.includes(k)));
    const over: THREE.Object3D[] = [
      this.helpers,
      this.ring,
      this.handleGroup,
      this.gizmo.getHelper(),
      ...(this.labels ? [this.labels] : []),
    ];
    only(kids.filter((k) => !over.includes(k)));
    r.render(this.scene, this.camera);
    // The later passes add to it: no clearing, and no sky drawn over it.
    r.autoClear = false;
    const sky = this.scene.background;
    this.scene.background = null;
    only([this.root, this.bases]);
    for (const m of this.capCount) {
      this.scene.overrideMaterial = m;
      r.render(this.scene, this.camera);
    }
    this.scene.overrideMaterial = null;
    this.cap.position.set(this.camera.position.x, this.cutY, this.camera.position.z);
    r.render(this.capScene, this.camera);
    only(over);
    r.render(this.scene, this.camera);
    kids.forEach((k, i) => (k.visible = shown[i]!));
    this.scene.background = sky;
    r.autoClear = true;
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Trackpad gestures, as Blender does them: two-finger scroll orbits, with Shift it pans,
   * and a pinch (which browsers send as a wheel with ctrlKey) zooms towards the cursor. A
   * mouse wheel orbits too; zoom with ⌘ or Ctrl and the wheel.
   */
  private wheel(e: WheelEvent): void {
    e.preventDefault();
    // Lines or pages (some mice) to pixels.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const target = this.orbit.target;
    const cam = this.camera.position;
    if (e.ctrlKey || e.metaKey) {
      // Towards what's under the cursor, or the point at the target's distance.
      this.aim(e);
      const hit = this.raycaster.intersectObjects([this.ground, this.root], true).find(this.seen);
      const at = hit?.point ?? this.raycaster.ray.at(cam.distanceTo(target), new THREE.Vector3());
      const f = Math.exp(Math.max(-0.5, Math.min(0.5, dy * 0.01)));
      if (f < 1 && cam.distanceTo(at) * f < 0.5) return;
      cam.sub(at).multiplyScalar(f).add(at);
      target.sub(at).multiplyScalar(f).add(at);
    } else if (e.shiftKey) {
      // Shift turns a vertical scroll into deltaX in some browsers; take whichever came.
      const [px, py] = dx !== 0 && dy === 0 ? [dx, 0] : [dx, dy];
      const k =
        (cam.distanceTo(target) * 2 * Math.tan((this.camera.fov * DEG) / 2)) /
        this.canvas.clientHeight;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      const move = right.multiplyScalar(px * k).add(up.multiplyScalar(-py * k));
      cam.add(move);
      target.add(move);
    } else {
      const s = new THREE.Spherical().setFromVector3(cam.clone().sub(target));
      s.theta += dx * 0.005;
      s.phi = Math.max(0.05, Math.min(Math.PI - 0.05, s.phi + dy * 0.005));
      cam.copy(target).add(new THREE.Vector3().setFromSpherical(s));
    }
    this.orbit.update();
  }

  /** WASD along the ground, Q and E down and up, faster with shift and when zoomed out. */
  private fly(dt: number): void {
    const k = this.keys;
    if (k.has('MetaLeft') || k.has('MetaRight') || k.has('ControlLeft')) return;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const up = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (!fwd && !right && !up) return;
    const dist = this.camera.position.distanceTo(this.orbit.target);
    const speed = Math.max(4, dist * 0.8) * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1);
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const move = f
      .multiplyScalar(fwd)
      .add(r.multiplyScalar(right))
      .add(new THREE.Vector3(0, up, 0))
      .multiplyScalar(speed * dt);
    this.camera.position.add(move);
    this.orbit.target.add(move);
  }

  /**
   * Builds every node's object again (and the ground if it changed), keeping the camera. A
   * placed prefab the scope goes into is built part by part.
   */
  build(map: MapFile, prefabs: PrefabLookup, scope: NodePath, selected: readonly number[]): void {
    this.prefabs = prefabs;
    const key = JSON.stringify([map.terrain, map.water, map.environment.sky, map.zones]);
    if (key !== this.groundKey) {
      this.groundKey = key;
      this.buildGround(map);
    }
    this.gizmo.detach();
    this.scene.remove(this.root);
    dispose(this.root, this.material);
    this.root = new THREE.Group();
    this.objects = new Map();
    const problems: string[] = [];
    const add = (
      nodes: readonly MapNode[],
      parent: THREE.Object3D,
      path: number[],
      colours: Readonly<Record<string, string>>,
    ): void => {
      nodes.forEach((n, i) => {
        const p = [...path, i];
        const prefab = n.type === 'prefab' ? prefabs.get(n.prefab) : undefined;
        const open = !!prefab && p.length <= scope.length && p.every((v, k) => scope[k] === v);
        const o = this.nodeObject(n, colours, problems, open);
        o.userData.path = p;
        parent.add(o);
        this.objects.set(p.join('.'), o);
        if (n.type === 'group') add(n.nodes, o, p, colours);
        else if (open && prefab && n.type === 'prefab') {
          o.userData.prefab = true;
          add(prefab.nodes, o, p, placementColours(prefab, n, colours));
        }
      });
    };
    add(map.nodes, this.root, [], map.colours ?? {});
    this.clip(this.root);
    this.scene.add(this.root);
    this.root.updateMatrixWorld(true);
    this.buildBases();
    if (problems.length) this.events.broken(problems[0]!);
    this.setSelection(scope, selected);
    this.drawHandles();
  }

  /** The terrain by chunk, water and zones, and the sky. */
  private buildGround(map: MapFile): void {
    this.scene.background = new THREE.Color(hex(map.environment.sky));
    dispose(this.ground, this.material);
    this.ground.clear();
    const t = terrainGrid(map);
    this.grid = t;
    this.terrain = new HeightGrid(t);
    this.terrainColour = hex(map.terrain.colour);
    this.chunkCells = Math.max(1, Math.round(CHUNK / t.cellSize));
    const nx = Math.ceil(t.cols / this.chunkCells);
    const nz = Math.ceil(t.rows / this.chunkCells);
    this.chunks = [];
    for (let k = 0; k < nx * nz; k++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.baked);
      this.chunks.push(mesh);
      this.ground.add(mesh);
      this.buildChunk(k);
    }
    if (map.water) {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(t.cols * t.cellSize, t.rows * t.cellSize).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: hex(map.water.colour),
          transparent: true,
          opacity: map.water.opacity,
          depthWrite: false,
        }),
      );
      water.position.set(
        t.minX + (t.cols * t.cellSize) / 2,
        map.water.level,
        t.minZ + (t.rows * t.cellSize) / 2,
      );
      // Not a surface to land on.
      water.raycast = () => {};
      this.ground.add(water);
    }
    const zones = buildDebug({ markers: [], patrols: [], zones: map.zones }, this.terrain);
    zones.traverse((o) => (o.raycast = () => {}));
    this.ground.add(zones);
    this.clip(this.ground);
  }

  private buildChunk(k: number): void {
    const t = this.grid!;
    const n = this.chunkCells;
    const nx = Math.ceil(t.cols / n);
    const i0 = (k % nx) * n;
    const j0 = Math.floor(k / nx) * n;
    const b = new TriangleBuilder(true);
    b.terrain(t, i0, Math.min(t.cols, i0 + n), j0, Math.min(t.rows, j0 + n), this.terrainColour);
    const mesh = this.chunks[k]!;
    mesh.geometry.dispose();
    mesh.geometry = b.build();
  }

  /** The concrete bases under buildings, as the game makes them. */
  private buildBases(only?: ReadonlySet<THREE.Object3D>): void {
    for (const m of [...this.bases.children]) {
      if (only && !only.has(m.userData.owner as THREE.Object3D)) continue;
      (m as THREE.Mesh).geometry.dispose();
      this.bases.remove(m);
    }
    const objects = only ?? new Set(this.objects.values());
    for (const o of objects) {
      for (const b of worldBuildings(o)) {
        const base = concreteBase(this.terrain, b);
        if (!base) continue;
        const tb = new TriangleBuilder(false);
        tb.shape(base);
        const mesh = new THREE.Mesh(tb.build(), this.material);
        mesh.userData.owner = o;
        this.bases.add(mesh);
      }
    }
  }

  /** Outlines what overlaps something in red. */
  setWarnings(paths: readonly NodePath[]): void {
    this.warnings = paths.map((p) => p.join('.'));
    this.setSelection(this.scope, this.selected);
  }

  /**
   * Whether clicks place things (a placing tool, or drawing): the gizmo is hidden then, so
   * a click beside what was just placed doesn't grab it.
   */
  set placing(on: boolean) {
    if (on === this.placingNow) return;
    this.placingNow = on;
    this.attachGizmo();
  }

  // Handles

  /** Shows these handles (or none), in the frame of the scope as last built. */
  setHandles(handles: Handles | null): void {
    this.handles = handles;
    this.drawHandles();
  }

  private drawHandles(): void {
    for (const c of this.handleGroup.children) dispose(c, this.material);
    this.handleGroup.clear();
    const h = this.handles;
    if (!h) return;
    const frame = this.scopeObject();
    frame.updateMatrixWorld();
    const world = h.points.map((p) => frame.localToWorld(new THREE.Vector3(...p)));
    const ball = new THREE.SphereGeometry(HANDLE_SIZE, 10, 6);
    world.forEach((p, k) => {
      const m = new THREE.Mesh(
        ball,
        new THREE.MeshBasicMaterial({
          color: k === h.picked ? HANDLE_ON : HANDLE,
          depthTest: false,
          transparent: true,
        }),
      );
      m.position.copy(p);
      m.renderOrder = 11;
      m.userData.handle = k;
      this.handleGroup.add(m);
    });
    if (h.line !== 'none' && world.length > 1) {
      const lifted = world.map((p) => p.clone().setY(p.y + 0.1));
      const geometry = new THREE.BufferGeometry().setFromPoints(lifted);
      const line = new THREE.LineBasicMaterial({ color: HANDLE_ON, depthTest: false });
      const o =
        h.line === 'closed' ? new THREE.LineLoop(geometry, line) : new THREE.Line(geometry, line);
      o.renderOrder = 10;
      o.raycast = () => {};
      this.handleGroup.add(o);
    }
  }

  /** Starts dragging the handle under the mouse, if there is one. */
  private startHandleDrag(e: PointerEvent): boolean {
    if (!this.handles) return false;
    this.aim(e);
    const hit = this.raycaster.intersectObjects(this.handleGroup.children, false)[0];
    const index = hit?.object.userData.handle as number | undefined;
    if (index === undefined) return false;
    this.handleDrag = { index, moved: false };
    this.orbit.enabled = false;
    this.down = null;
    return true;
  }

  private dragHandle(e: PointerEvent): void {
    const d = this.handleDrag!;
    const h = this.handles!;
    const p = this.handlePoint(e, h.terrainOnly);
    if (!p) return;
    d.moved = true;
    this.handleGroup.children[d.index]?.position.copy(p);
  }

  private endHandleDrag(): void {
    const d = this.handleDrag;
    if (!d) return;
    this.handleDrag = null;
    this.orbit.enabled = true;
    const o = this.handleGroup.children[d.index];
    if (!d.moved || !o) return this.events.handle(d.index, null);
    const local = this.scopeObject().worldToLocal(o.position.clone());
    this.events.handle(d.index, [round(local.x), round(local.y), round(local.z)]);
  }

  /** Where a dragged handle goes, in the world: on a surface, snapped to the grid. */
  private handlePoint(e: PointerEvent, terrainOnly: boolean): THREE.Vector3 | null {
    this.aim(e);
    const targets = terrainOnly ? this.chunks : [this.ground, this.root];
    const hit = this.raycaster
      .intersectObjects(targets, true)
      .find((h) => surface(h.object) && this.seen(h));
    if (!hit) return null;
    const frame = this.scopeObject();
    const p = frame.worldToLocal(hit.point.clone());
    const grid = this.options.gridSnap;
    if (grid) {
      p.x = snap(p.x, grid);
      p.z = snap(p.z, grid);
    }
    const world = frame.localToWorld(p);
    world.y = terrainOnly
      ? this.terrain.heightAt(world.x, world.z)
      : this.surfaceBelow(world.setY(hit.point.y));
    return world;
  }

  // Previews

  /** Shows nodes see-through in the scope's frame (walls being drawn), or none. */
  setPreview(nodes: readonly MapNode[] | null): void {
    if (this.preview) {
      this.preview.removeFromParent();
      dispose(this.preview, this.previewMaterial);
      this.preview = null;
    }
    if (!nodes?.length) return;
    const b = new TriangleBuilder(false);
    try {
      for (const s of compileNodes(nodes, this.prefabs).shapes) b.shape(s);
    } catch {
      return;
    }
    const mesh = new THREE.Mesh(b.build(), this.previewMaterial);
    mesh.raycast = () => {};
    mesh.renderOrder = 5;
    this.previewMaterial.clippingPlanes = this.clipPlanes;
    this.preview = mesh;
    this.scopeObject().add(mesh);
  }

  /** Shows these labels (map notes) over everything, in the world, replacing the last. */
  setLabels(labels: THREE.Object3D | null): void {
    if (this.labels) {
      this.scene.remove(this.labels);
      disposeLabels(this.labels);
    }
    this.labels = labels;
    if (labels) this.scene.add(labels);
  }

  /** A world point in the scope's frame. */
  toScope(p: readonly number[]): Vec3 {
    const v = this.scopeObject().worldToLocal(new THREE.Vector3(p[0], p[1], p[2]));
    return [v.x, v.y, v.z];
  }

  // The navigation overlay

  /** Shows an overlay over the map (the navigation grid), replacing the last; null removes it. */
  setOverlay(o: THREE.Object3D | null): void {
    if (this.overlay) {
      this.scene.remove(this.overlay);
      dispose(this.overlay, this.material);
    }
    this.overlay = o;
    if (o) {
      o.traverse((c) => (c.raycast = () => {}));
      this.clip(o);
      this.scene.add(o);
    }
  }

  // The cutaway

  /** Hides everything above a world height (null shows it all), to see inside a floor. */
  set cut(y: number | null) {
    this.cutY = y;
    this.clipPlanes.length = 0;
    if (y !== null) this.clipPlanes.push(new THREE.Plane(DOWN, y));
    // Cut solids are open: their insides show, darker, so walls read as a plan.
    const side = y === null ? THREE.FrontSide : THREE.DoubleSide;
    if (this.material.side !== side) {
      this.material.side = side;
      this.material.needsUpdate = true;
    }
  }

  /** Gives everything under `root` the cutaway's planes (the shared materials have them). */
  private clip(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.clippingPlanes = this.clipPlanes;
    });
  }

  /** Whether a ray's hit is below the cutaway, so can be seen (and picked). */
  private readonly seen = (h: THREE.Intersection): boolean =>
    this.cutY === null || h.point.y <= this.cutY + 0.01;

  /** The terrain's height at a world x, z. */
  groundAt(x: number, z: number): number {
    return round(this.terrain.heightAt(x, z));
  }

  /** The point the camera orbits: where play-testing can start. */
  target(): Vec3 {
    const t = this.orbit.target;
    return [t.x, t.y, t.z];
  }

  /** Points the camera at a world point, from where it looks now, about `distance` away. */
  lookAt(x: number, y: number, z: number, distance = 20): void {
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.set(x, y, z);
    this.camera.position.set(x, y, z).addScaledVector(dir, distance);
    this.orbit.update();
  }

  /** The size of what's selected along x, in metres. */
  selectionWidth(): number {
    const box = new THREE.Box3();
    for (const i of this.selected) {
      const o = this.objectOf(i);
      if (o) box.expandByObject(o);
    }
    return box.isEmpty() ? 0 : box.max.x - box.min.x;
  }

  // Terrain brushes

  /** Turns the terrain brush on (with these settings) or off. */
  set brush(brush: Brush | null) {
    this.brushSettings = brush;
    if (!brush) this.ring.visible = false;
    else this.moveRing();
  }

  private groundUnder(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    this.aim(e);
    return this.raycaster.intersectObjects(this.chunks, false).find(this.seen)?.point ?? null;
  }

  private startStroke(e: PointerEvent): void {
    const p = this.groundUnder(e);
    if (!p || !this.grid) return;
    this.pointer = e;
    this.stroke = { x: p.x, z: p.z, level: this.terrain.heightAt(p.x, p.z), shift: e.shiftKey };
  }

  private brushFrame(dt: number): void {
    const s = this.stroke;
    const brush = this.brushSettings;
    if (!s || !brush || !this.grid || !this.pointer) return;
    const p = this.groundUnder(this.pointer);
    if (p) [s.x, s.z] = [p.x, p.z];
    // Shift turns raising into lowering and back.
    const mode =
      s.shift && brush.mode === 'raise'
        ? 'lower'
        : s.shift && brush.mode === 'lower'
          ? 'raise'
          : brush.mode;
    const changed = applyBrush(this.grid, { ...brush, mode }, s.x, s.z, dt, s.level);
    if (!changed) return;
    this.terrain = new HeightGrid(this.grid);
    const [i0, i1, j0, j1] = changed;
    const n = this.chunkCells;
    const nx = Math.ceil(this.grid.cols / n);
    // Corners on a chunk's edge belong to the chunks either side.
    const cx0 = Math.max(0, Math.floor((i0 - 1) / n));
    const cz0 = Math.max(0, Math.floor((j0 - 1) / n));
    const cx1 = Math.min(nx - 1, Math.floor(i1 / n));
    const cz1 = Math.min(this.chunks.length / nx - 1, Math.floor(j1 / n));
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) this.buildChunk(cz * nx + cx);
    this.buildBases();
    this.moveRing();
  }

  private endStroke(): void {
    if (!this.stroke || !this.grid) return;
    this.stroke = null;
    this.events.terrain(this.grid.heights.slice());
  }

  /** The brush's ring on the ground under the mouse. */
  private moveRing(): void {
    const brush = this.brushSettings;
    const p = brush && this.pointer && this.groundUnder(this.pointer);
    this.ring.visible = !!p;
    if (!p || !brush) return;
    const points: THREE.Vector3[] = [];
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const x = p.x + Math.cos(a) * brush.radius;
      const z = p.z + Math.sin(a) * brush.radius;
      points.push(new THREE.Vector3(x, this.terrain.heightAt(x, z) + 0.1, z));
    }
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }

  /** A node's object; for a prefab being edited inside (`open`), only its frame and base. */
  private nodeObject(
    n: MapNode,
    colours: Readonly<Record<string, string>>,
    problems: string[],
    open = false,
  ): THREE.Object3D {
    const o = new THREE.Group();
    const [x, y, z] = nodePos(n);
    o.position.set(x, y, z);
    o.rotation.y = nodeYaw(n) * DEG;
    if (n.type === 'group') return o;
    // Built at the origin, so the object carries the position and the gizmo sits on it.
    const local = structuredClone(n);
    if (local.type === 'patrol') {
      local.points = local.points.map((q) => {
        const at = Array.isArray(q) ? q : q.pos;
        const moved: Vec3 = [at[0] - x, at[1] - y, at[2] - z];
        return Array.isArray(q) ? moved : { ...q, pos: moved };
      });
    } else {
      local.pos = [0, 0, 0];
      if ('yaw' in local) delete local.yaw;
    }
    try {
      const out = compileNodes([local], this.prefabs, colours);
      if (out.buildings.length) o.userData.buildings = out.buildings;
      // Its parts are built one by one as the nodes they are.
      if (open) return o;
      if (out.shapes.length) {
        const b = new TriangleBuilder(false);
        for (const s of out.shapes) b.shape(s);
        o.add(new THREE.Mesh(b.build(), this.material));
      }
      for (const d of out.doors) o.add(buildDoor(d, this.material));
      if (out.markers.length || out.patrols.length) {
        const posts = buildDebug(
          { markers: out.markers, patrols: out.patrols, zones: [] },
          this.terrain,
        );
        // Picked, but not something to stand things on.
        posts.traverse((c) => (c.userData.marker = true));
        o.add(posts);
      }
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
      const b = new TriangleBuilder(false);
      const s = { x: 0, y: 0.5, z: 0, yaw: 0, pitch: 0, roll: 0, colour: BROKEN };
      b.shape({ kind: 'box', ...s, hx: 0.5, hy: 0.5, hz: 0.5 });
      o.add(new THREE.Mesh(b.build(), this.material));
    }
    return o;
  }

  private scopeObject(): THREE.Object3D {
    return this.scope.length ? this.objects.get(this.scope.join('.'))! : this.root;
  }

  private objectOf(index: number): THREE.Object3D | undefined {
    return this.objects.get([...this.scope, index].join('.'));
  }

  /** Outlines what's selected (the last one, the active one, in orange) and the group in. */
  setSelection(scope: NodePath, selected: readonly number[]): void {
    this.scope = scope;
    this.selected = [...selected];
    for (const h of this.helpers.children) (h as THREE.BoxHelper).dispose?.();
    this.helpers.clear();
    if (scope.length) {
      const o = this.scopeObject();
      this.helpers.add(new THREE.BoxHelper(o, o.userData.prefab ? PREFAB_SCOPE : SCOPE));
    }
    for (const w of this.warnings) {
      const o = this.objects.get(w);
      if (o) this.helpers.add(new THREE.BoxHelper(o, WARNING));
    }
    this.clip(this.helpers);
    selected.forEach((i, k) => {
      const o = this.objectOf(i);
      if (!o) return;
      const colour = k === selected.length - 1 ? ACTIVE : SELECTED;
      const box = new THREE.BoxHelper(o, colour);
      box.userData.selection = colour;
      this.helpers.add(box);
    });
    this.attachGizmo();
  }

  setGizmoMode(mode: 'translate' | 'rotate'): void {
    this.gizmo.setMode(mode);
    // Only yaw: pitch and roll are typed in, and only boxes and cylinders have them.
    this.gizmo.showX = mode === 'translate';
    this.gizmo.showZ = mode === 'translate';
  }

  /**
   * The gizmo sits on a pivot in the scope's frame, unturned so the grid lines up with it:
   * on the one selected node, or the middle of several.
   */
  private attachGizmo(): void {
    const objects = this.selected.map((i) => this.objectOf(i)).filter((o) => o !== undefined);
    if (objects.length === 0 || this.placingNow) {
      this.gizmo.detach();
      return;
    }
    const scope = this.scopeObject();
    scope.add(this.pivot);
    this.pivot.position.set(0, 0, 0);
    for (const o of objects) this.pivot.position.add(o.position);
    this.pivot.position.divideScalar(objects.length);
    if (objects.length > 1) this.pivot.position.y = Math.min(...objects.map((o) => o.position.y));
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.updateMatrixWorld();
    this.gizmo.attach(this.pivot);
  }

  private startDrag(): void {
    const objects = this.selected.flatMap((index) => {
      const object = this.objectOf(index);
      return object
        ? [{ index, object, pos: object.position.clone(), yaw: object.rotation.y }]
        : [];
    });
    const exclude = new Set<THREE.Object3D>();
    for (const { object } of objects) object.traverse((c) => exclude.add(c));
    // Buildings that move with the drag, and the footprints of those that don't.
    const moving = new Set<THREE.Object3D>();
    const still: CompiledBuilding[] = [];
    for (const o of this.objects.values()) {
      if (!o.userData.buildings) continue;
      if (exclude.has(o)) moving.add(o);
      else still.push(...worldBuildings(o));
    }
    // The snapping frame: the scope's, turned to the yaw of the first thing dragged.
    const scope = this.scopeObject();
    const first = [...exclude].find(surface);
    const frame = this.snapFrame;
    scope.add(frame);
    frame.position.set(0, 0, 0);
    frame.rotation.set(0, first ? quarterYaw(first, scope) : 0, 0);
    frame.updateMatrixWorld();
    const box = new THREE.Box3();
    const targets: THREE.Box3[] = [];
    let square = true;
    this.root.traverse((o) => {
      if (!surface(o)) return;
      const b = frameBox(o as THREE.Mesh, frame);
      if (exclude.has(o)) {
        if (b) box.union(b);
        else square = false;
      } else if (b) targets.push(b);
    });
    this.drag = {
      start: this.pivot.position.clone(),
      objects,
      exclude,
      moving,
      still,
      box: square && !box.isEmpty() ? box : null,
      targets,
    };
  }

  /** Snaps the pivot, then moves the selection with it, dropping it onto surfaces. */
  private dragged(): void {
    const d = this.drag;
    if (!d) return;
    const { gridSnap, angleSnap, snapDown } = this.options;
    const single = d.objects.length === 1 ? d.objects[0]! : null;
    const axis = this.gizmo.axis ?? '';
    let yaw = 0;
    let guide: THREE.Box3 | null = null;
    if (this.gizmo.mode === 'translate') {
      const p = this.pivot.position;
      for (const k of ['x', 'y', 'z'] as const) {
        if (!axis.includes(k.toUpperCase())) continue;
        const near = this.options.objectSnap ? this.objectSnap(d, k, p.clone().sub(d.start)) : null;
        if (near) {
          p[k] = d.start[k] + near.move;
          guide = near.target;
        } else if (gridSnap)
          // One thing snaps to the grid; several keep their spacing and move by whole steps.
          p[k] = single ? snap(p[k], gridSnap) : d.start[k] + snap(p[k] - d.start[k], gridSnap);
      }
    } else {
      yaw = this.pivot.rotation.y;
      if (angleSnap) {
        const step = angleSnap * DEG;
        yaw = single ? snap(single.yaw + yaw, step) - single.yaw : snap(yaw, step);
      }
      this.pivot.rotation.set(0, yaw, 0);
    }
    this.showSnapGuide(guide);
    const drop = snapDown && this.gizmo.mode === 'translate' && !axis.includes('Y');
    const scope = this.scopeObject();
    for (const o of d.objects) {
      const rel = o.pos.clone().sub(d.start).applyAxisAngle(UP, yaw);
      o.object.position.copy(this.pivot.position).add(rel);
      o.object.rotation.y = o.yaw + yaw;
      if (drop) o.object.position.y = this.dropY(scope, o.object.position, d.exclude);
      o.object.updateMatrixWorld();
    }
    if (d.moving.size) {
      this.buildBases(d.moving);
      // Buildings can't overlap: show it now; the editor refuses the move at the end.
      const clash = [...d.moving].some((o) =>
        worldBuildings(o).some((b) => d.still.some((s) => footprintsOverlap(b, s))),
      );
      for (const h of this.helpers.children) {
        const box = h as THREE.BoxHelper;
        if (box.userData.selection)
          (box.material as THREE.LineBasicMaterial).color.set(
            clash ? WARNING : box.userData.selection,
          );
      }
    }
  }

  /**
   * How far along axis `k` a drag (by `offset` so far) goes so a face of what's dragged meets,
   * or lines up with, a face of something near it (the nearest within OBJECT_SNAP), if any.
   */
  private objectSnap(
    d: NonNullable<EditorView['drag']>,
    k: 'x' | 'y' | 'z',
    offset: THREE.Vector3,
  ): { move: number; target: THREE.Box3 } | null {
    if (!d.box) return null;
    // The drag and its axis in the snapping frame, which may be turned.
    const turn = -this.snapFrame.rotation.y;
    const moved = d.box.clone().translate(offset.clone().applyAxisAngle(UP, turn));
    const dir = new THREE.Vector3().setComponent(AXIS_INDEX[k], 1).applyAxisAngle(UP, turn);
    const reach = moved.clone().expandByScalar(OBJECT_SNAP_NEAR);
    let best: { move: number; target: THREE.Box3 } | null = null;
    let bestMove = OBJECT_SNAP;
    for (const t of d.targets) {
      if (!t.intersectsBox(reach)) continue;
      for (const u of ['x', 'y', 'z'] as const) {
        // How fast the drag closes gaps along this side; too slant a way isn't a snap.
        const rate = dir[u];
        if (Math.abs(rate) < 0.25) continue;
        const [a0, a1, b0, b1] = [moved.min[u], moved.max[u], t.min[u], t.max[u]];
        // Flush either side, or the same side in line.
        for (const gap of [b1 - a0, b0 - a1, b0 - a0, b1 - a1]) {
          const shift = gap / rate;
          if (Math.abs(shift) < bestMove) {
            bestMove = Math.abs(shift);
            best = { move: offset[k] + shift, target: t };
          }
        }
      }
    }
    return best;
  }

  /** Outlines what a drag has snapped to (in the snapping frame), or nothing. */
  private showSnapGuide(box: THREE.Box3 | null): void {
    this.snapGuide.visible = !!box;
    if (box) this.snapGuide.box.copy(box);
  }

  private endDrag(): void {
    this.showSnapGuide(null);
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const moves = d.objects.map((o) => ({
      index: o.index,
      from: o.pos.toArray(),
      to: o.object.position.toArray(),
      yaw: (o.object.rotation.y - o.yaw) / DEG,
    }));
    const still = moves.every(
      (m) => m.yaw === 0 && m.from.every((v, k) => Math.abs(v - m.to[k]!) < 1e-9),
    );
    if (!still) this.events.moved(moves);
  }

  /**
   * The height in the scope's frame of the surface under a point there: the first thing
   * below it from a step above, or else the terrain.
   */
  private dropY(
    scope: THREE.Object3D,
    local: THREE.Vector3,
    exclude: ReadonlySet<THREE.Object3D>,
  ): number {
    const world = scope.localToWorld(local.clone());
    const y = this.surfaceBelow(world, exclude);
    return scope.worldToLocal(world.setY(y)).y;
  }

  /** The world height of the surface under a world point, skipping `exclude`. */
  surfaceBelow(world: THREE.Vector3, exclude: ReadonlySet<THREE.Object3D> = new Set()): number {
    this.raycaster.set(new THREE.Vector3(world.x, world.y + DROP_REACH, world.z), DOWN);
    this.raycaster.far = Infinity;
    const hits = this.raycaster.intersectObjects([this.ground, this.root], true);
    const hit = hits.find((h) => !exclude.has(h.object) && surface(h.object) && this.seen(h));
    return hit ? hit.point.y : this.terrain.heightAt(world.x, world.z);
  }

  /** The surface point under the mouse, in the scope's frame, for placing things. */
  pointUnder(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    this.aim(e);
    const hit = this.raycaster
      .intersectObjects([this.ground, this.root], true)
      .find((h) => surface(h.object) && this.seen(h));
    return hit ? this.scopeObject().worldToLocal(hit.point.clone()) : null;
  }

  /** In the scope's frame. */
  dropPoint(local: THREE.Vector3, exclude: readonly number[] = []): number {
    const skip = new Set<THREE.Object3D>();
    for (const i of exclude) this.objectOf(i)?.traverse((c) => skip.add(c));
    return this.dropY(this.scopeObject(), local, skip);
  }

  private aim(e: { clientX: number; clientY: number }): void {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.params.Line.threshold = 0.2;
  }

  /**
   * The node in scope under the mouse. A hit outside the group being edited gives the
   * top-level node's path in `outside` instead.
   */
  private pick(e: MouseEvent): { index: number | null; outside: NodePath | null } {
    this.aim(e);
    for (const h of this.raycaster.intersectObjects([this.root], true)) {
      if (!this.seen(h)) continue;
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.path === undefined) o = o.parent;
      if (!o) continue;
      const path = o.userData.path as number[];
      // Walk up to the node directly in scope.
      const inScope = this.scope.every((v, k) => path[k] === v) && path.length > this.scope.length;
      if (inScope) return { index: path[this.scope.length]!, outside: null };
      return { index: null, outside: [path[0]!] };
    }
    return { index: null, outside: null };
  }

  /**
   * The node under the mouse however deep in the groups in scope (a placed prefab not gone
   * into is one node), and the point hit, in the frame it's placed in.
   */
  pickLeaf(e: { clientX: number; clientY: number }): { path: NodePath; at: Vec3 } | null {
    this.aim(e);
    for (const h of this.raycaster.intersectObjects([this.root], true)) {
      if (!this.seen(h) || !surface(h.object)) continue;
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.path === undefined) o = o.parent;
      if (!o?.parent) continue;
      const path = o.userData.path as number[];
      const inScope = this.scope.every((v, k) => path[k] === v) && path.length > this.scope.length;
      if (!inScope) return null;
      const at = o.parent.worldToLocal(h.point.clone());
      return { path, at: [at.x, at.y, at.z] };
    }
    return null;
  }

  /** Points the camera at the selection, or the whole group being edited. */
  focus(): void {
    const objects = this.selected.length
      ? this.selected.map((i) => this.objectOf(i)).filter((o) => o !== undefined)
      : [this.scopeObject()];
    const box = new THREE.Box3();
    for (const o of objects) box.expandByObject(o);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const size = Math.max(2, box.getSize(new THREE.Vector3()).length());
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(centre);
    this.camera.position.copy(centre).addScaledVector(dir, size * 1.2);
    this.orbit.update();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const TO_FRAME = new THREE.Matrix4();
const AXIS = new THREE.Vector3();

/** An object's yaw in a frame, as an angle from 0 up to a quarter turn (radians). */
function quarterYaw(o: THREE.Object3D, frame: THREE.Object3D): number {
  TO_FRAME.copy(frame.matrixWorld).invert().multiply(o.matrixWorld);
  AXIS.set(1, 0, 0).transformDirection(TO_FRAME);
  const quarter = Math.PI / 2;
  const yaw = ((Math.atan2(-AXIS.z, AXIS.x) % quarter) + quarter) % quarter;
  // A hair under a quarter turn is square too.
  return quarter - yaw < 1e-6 ? 0 : yaw;
}

/**
 * A mesh's bounds in `frame`, or null if it's turned off the frame's axes (its box there
 * would be loose, so not a face to snap to).
 */
function frameBox(mesh: THREE.Mesh, frame: THREE.Object3D): THREE.Box3 | null {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  TO_FRAME.copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld);
  AXIS.set(1, 0, 0).transformDirection(TO_FRAME);
  if (Math.abs(AXIS.x) < 0.9999 && Math.abs(AXIS.z) < 0.9999) return null;
  return g.boundingBox!.clone().applyMatrix4(TO_FRAME);
}
const DOWN = new THREE.Vector3(0, -1, 0);

const surface = (o: THREE.Object3D): boolean => o.type === 'Mesh' && !o.userData.marker;

/** A stencil op for fail, depth-fail and pass alike. */
function stencilOp(op: THREE.StencilOp) {
  return { stencilFail: op, stencilZFail: op, stencilZPass: op };
}

/** Draws a material's back faces (the insides of solids the cutaway opens) darker. */
function darkenBackFaces(m: THREE.Material): void {
  const before = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      if ( !gl_FrontFacing ) gl_FragColor.rgb *= 0.45;`,
    );
  };
}

const hex = (colour: string): number => parseInt(colour.slice(1), 16);

/**
 * The hex colour of each slot of a placed prefab: its overrides (a hex colour, or a slot of
 * the enclosing file's, `outer`) over the prefab's own.
 */
function placementColours(
  prefab: PrefabFile,
  n: Extract<MapNode, { type: 'prefab' }>,
  outer: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = { ...prefab.colours };
  for (const [slot, ref] of Object.entries(n.colours ?? {})) {
    const c = ref.startsWith('#') ? ref : outer[ref];
    if (c !== undefined) out[slot] = c;
  }
  return out;
}

const AXIS_X = new THREE.Vector3();
const AT = new THREE.Vector3();

/** An object's buildings (kept in its own frame by nodeObject) in world space. */
function worldBuildings(o: THREE.Object3D): CompiledBuilding[] {
  const local = o.userData.buildings as CompiledBuilding[] | undefined;
  if (!local) return [];
  // Local +x is (cos yaw, −sin yaw) in the world.
  AXIS_X.set(1, 0, 0).transformDirection(o.matrixWorld);
  const turn = Math.atan2(-AXIS_X.z, AXIS_X.x);
  return local.map((b) => {
    AT.set(b.x, b.y, b.z).applyMatrix4(o.matrixWorld);
    return { ...b, x: AT.x, y: AT.y, z: AT.z, yaw: b.yaw + turn };
  });
}

const snap = (v: number, step: number): number => Math.round(v / step) * step;

export const typing = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
};

function dispose(root: THREE.Object3D, keep: THREE.Material): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) if (mat !== keep) mat.dispose();
  });
}
