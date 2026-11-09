import type { Character, ItemDb, Outfit } from '@mes/shared';
import * as THREE from 'three';
import { DEFAULT_OUTFIT, loadCharacter } from './character';
import { CharacterBody, CharacterRig } from './character-body';

/*
 * The main menu's character (2026-11-09): you, in the gear you're wearing, standing on a
 * lit plinth in the middle of the lobby. Drag it round; let go and it drifts back to
 * facing you. Its own small WebGL canvas, drawn at 30 fps and freed when the lobby goes,
 * so the menu costs a phone next to nothing. One draw call for the body (gear included)
 * and three for the plinth.
 */

/** The rig, loaded once per page: every lobby after the first shows at once. */
let rigPromise: Promise<CharacterRig> | null = null;
function lobbyRig(): Promise<CharacterRig> {
  rigPromise ??= loadCharacter('/characters/mannequin.glb').then((t) => new CharacterRig(t));
  return rigPromise;
}

/** Frames this far apart at least, in ms: 30 fps is plenty for an idle pose. */
const FRAME_MS = 1000 / 30 - 2;
/** Radians per pixel dragged. */
const DRAG_TURN = 0.012;
/** How fast it swings back to its rest turn, per second, once let go. */
const SETTLE = 1.6;
/** Turned slightly off square, so the gun and the side of the gear show. */
const REST_TURN = -0.45;

export class LobbyCharacter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  private readonly turntable = new THREE.Group();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly plinth: THREE.Mesh[] = [];
  private body: CharacterBody | null = null;
  private character: Character | null = null;
  private outfit: Outfit = DEFAULT_OUTFIT;
  private raf = 0;
  private last = 0;
  private turn = REST_TURN;
  private spin = 0;
  private dragX: number | null = null;
  private idleFor = 0;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly items: ItemDb,
    accent: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(this.turntable);

    // The plinth: a dark disc, a lighter top and a thin ring in the mode's colour.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.78, 0.86, 0.12, 40),
      new THREE.MeshBasicMaterial({ color: 0x161c21 }),
    );
    base.position.y = -0.06;
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(0.74, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x232c33 }),
    );
    top.position.y = 0.001;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.74, 0.78, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: accent }),
    );
    ring.position.y = 0.002;
    this.plinth.push(base, top, ring);
    this.scene.add(base, top, ring);

    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The ring's colour, for the mode shown. */
  setAccent(accent: number): void {
    (this.plinth[2]!.material as THREE.MeshBasicMaterial).color.set(accent);
  }

  /**
   * Shows this character (read, never changed) in this outfit. Called again with the same
   * one, nothing happens; its gear is read every frame, so changes in the stash show.
   */
  show(c: Character, outfit: Outfit = DEFAULT_OUTFIT): void {
    if (c === this.character && outfit === this.outfit) return;
    this.character = c;
    this.outfit = outfit;
    void lobbyRig().then((rig) => {
      if (this.disposed || this.character !== c) return;
      if (this.body) {
        this.turntable.remove(this.body.root);
        this.body.dispose();
      }
      this.body = new CharacterBody(rig, outfit, c);
      this.turntable.add(this.body.root);
      this.canvas.classList.add('ready');
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.body?.dispose();
    for (const m of this.plinth) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
    // A phone allows only a few WebGL contexts: give this one back now.
    this.renderer.forceContextLoss();
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.dragX = e.clientX;
    this.spin = 0;
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.dragX === null) return;
    const dx = e.clientX - this.dragX;
    this.dragX = e.clientX;
    this.turn += dx * DRAG_TURN;
    // Kept as a speed (rad per frame-ish), so a flick carries on a little.
    this.spin = dx * DRAG_TURN;
    this.idleFor = 0;
  };

  private readonly onUp = (): void => {
    this.dragX = null;
  };

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (now - this.last < FRAME_MS) return;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;

    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
    }
    // Framed so the whole body fits, from a little below eye height, whatever the shape.
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.75 ? 38 : 30;
    this.camera.updateProjectionMatrix();
    const far = 5.2;
    this.camera.position.set(0, 1.25, -far);
    this.camera.lookAt(0, 0.92, 0);
    this.camera.updateMatrixWorld();

    // A flick carries on and fades; left alone a while, it turns back to rest.
    if (this.dragX === null) {
      this.turn += this.spin;
      this.spin *= Math.pow(0.02, dt);
      this.idleFor += dt;
      if (this.idleFor > 2.5) {
        let d = REST_TURN - this.turn;
        d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        this.turn += d * Math.min(1, SETTLE * dt);
      }
    }
    this.turntable.rotation.y = this.turn;

    if (this.body && this.character) {
      this.frustum.setFromProjectionMatrix(
        this.viewProj.multiplyMatrices(
          this.camera.projectionMatrix,
          this.camera.matrixWorldInverse,
        ),
      );
      this.body.update(this.character, this.items, 1, dt, this.camera, this.frustum);
    }
    this.renderer.render(this.scene, this.camera);
  };
}
