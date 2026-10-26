import { attachmentDef, type ItemDb, type Shape, type WeaponState } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { shadedMaterial } from './material';

/** A box in the gun's frame: centre and half-extents in metres; the barrel points along −z. */
function box(
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  colour: number,
): Shape {
  return { kind: 'box', x, y, z, hx, hy, hz, yaw: 0, pitch: 0, roll: 0, colour };
}

/** A cylinder lying along z. */
function tube(y: number, z: number, r: number, hz: number, colour: number): Shape {
  return {
    kind: 'cylinder',
    x: 0,
    y,
    z,
    radius: r,
    radiusTop: r,
    hy: hz,
    sides: 8,
    yaw: 0,
    pitch: Math.PI / 2,
    roll: 0,
    colour,
  };
}

const DARK = 0x2a2d30;
const BLACK = 0x1d1f21;

/*
 * A placeholder gun and attachments until the item editor builds real models with mount
 * points and sight lines (session 18), and arms arrive (session 8b). Each part's sight
 * line is the height the camera lines up with when aimed.
 */
const GUN: Shape[] = [
  box(0, 0, -0.1, 0.03, 0.045, 0.16, 0x3a3f44),
  box(0, 0.02, -0.36, 0.013, 0.013, 0.12, DARK),
  box(0, -0.075, 0.04, 0.022, 0.045, 0.02, 0x4a3a2c),
  box(0, -0.015, 0.11, 0.026, 0.04, 0.05, 0x4a3a2c),
];
const MAG = [box(0, -0.09, -0.06, 0.022, 0.055, 0.03, DARK)];
const LONG_MAG = [box(0, -0.12, -0.06, 0.022, 0.085, 0.03, DARK)];
/** Iron sights, folded away under an optic. */
const IRONS = { shapes: [box(0, 0.055, -0.06, 0.008, 0.01, 0.03, BLACK)], sightY: 0.065 };
/** An open frame on a low base; the dot is drawn on the screen (hud/optic.ts). */
const RED_DOT = {
  shapes: [
    box(0, 0.052, -0.08, 0.016, 0.007, 0.03, BLACK),
    box(-0.018, 0.088, -0.09, 0.003, 0.03, 0.006, BLACK),
    box(0.018, 0.088, -0.09, 0.003, 0.03, 0.006, BLACK),
    box(0, 0.118, -0.09, 0.021, 0.003, 0.006, BLACK),
  ],
  sightY: 0.09,
};
const SCOPE = {
  shapes: [
    box(0, 0.06, -0.03, 0.008, 0.015, 0.008, BLACK),
    box(0, 0.06, -0.13, 0.008, 0.015, 0.008, BLACK),
    tube(0.09, -0.08, 0.016, 0.1, BLACK),
    tube(0.09, -0.2, 0.022, 0.025, BLACK),
    tube(0.09, 0.03, 0.02, 0.02, BLACK),
  ],
  sightY: 0.09,
};
const MUZZLE_Z = -0.49;
const SUPPRESSOR = { shapes: [tube(0.02, -0.56, 0.02, 0.08, BLACK)], muzzleZ: -0.65 };
const BRAKE = { shapes: [box(0, 0.02, -0.505, 0.018, 0.018, 0.025, BLACK)], muzzleZ: -0.54 };

/** Where the gun sits relative to the camera, from the hip and aimed down the sight. */
const HIP = new THREE.Vector3(0.13, -0.14, -0.42);
const AIMED_Z = -0.3;

/**
 * The first-person gun. It's drawn in its own pass after the world with the depth buffer
 * cleared, so it never pokes into walls. It follows the camera, slides between the hip
 * and the sight as the character aims, kicks back on each shot and shows a muzzle flash.
 */
export class Viewmodel {
  /** Its own scene, drawn after the world. */
  readonly scene = new THREE.Scene();
  private readonly holder = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly model: THREE.Mesh;
  private readonly flash: THREE.Mesh;
  private readonly muzzle = new THREE.Object3D();
  private readonly aimed = new THREE.Vector3(0, -IRONS.sightY, AIMED_Z);
  private kick = 0;
  private flashUntil = 0;
  /** The attachments the model was built with, as one string, to rebuild only on change. */
  private built = '';
  private suppressed = false;

  constructor() {
    this.model = new THREE.Mesh(new THREE.BufferGeometry(), shadedMaterial());
    this.flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffd36b }),
    );
    // Visible until the first update, so the warm-up draw compiles its shader.
    this.gun.add(this.model, this.flash, this.muzzle);
    this.holder.add(this.gun);
    this.scene.add(this.holder);
    this.build(null, null);
  }

  /** Shows the gun's attachments, rebuilding the model only when they change. */
  setAttachments(w: WeaponState, items: ItemDb): void {
    const { optic, muzzle, magazine } = w.attachments;
    const key = `${optic} ${muzzle} ${magazine}`;
    if (key === this.built) return;
    this.built = key;
    this.build(w, items);
  }

  private build(w: WeaponState | null, items: ItemDb | null): void {
    const a = w && items ? w.attachments : null;
    const def = (id: string | null | undefined) => (id && items ? attachmentDef(items, id) : null);
    const optic = def(a?.optic)?.optic;
    const sight = !optic ? IRONS : optic.zoom > 1 ? SCOPE : RED_DOT;
    // Placeholders by kind: anything that makes a gun quieter looks like a suppressor.
    const muzzleDef = def(a?.muzzle);
    this.suppressed = (muzzleDef?.mods?.loudness ?? 1) < 1;
    const front = !muzzleDef ? null : this.suppressed ? SUPPRESSOR : BRAKE;
    const parts = [GUN, a?.magazine ? LONG_MAG : MAG, sight.shapes, front?.shapes ?? []];

    const b = new TriangleBuilder(false);
    for (const list of parts) for (const s of list) b.shape(s);
    this.model.geometry.dispose();
    this.model.geometry = b.build();
    this.aimed.y = -sight.sightY;
    const muzzleZ = front?.muzzleZ ?? MUZZLE_Z;
    this.flash.position.set(0, 0.02, muzzleZ);
    this.muzzle.position.set(0, 0.02, muzzleZ);
  }

  set visible(on: boolean) {
    this.holder.visible = on;
  }

  /** A shot: kick back and flash (no flash through a suppressor). */
  fired(now: number): void {
    this.kick = Math.min(1.5, this.kick + 1);
    if (!this.suppressed) this.flashUntil = now + 40;
  }

  /** Follows the camera; aim is 0 at the hip to 1 aimed; sway grows with broken arms. */
  update(camera: THREE.Camera, now: number, dtMs: number, aim: number, sway: number): void {
    this.holder.position.copy(camera.position);
    this.holder.quaternion.copy(camera.quaternion);
    this.kick *= Math.exp(-dtMs / 60);
    const t = now / 1000;
    const swayX = Math.sin(t * 1.3) * 0.004 * sway;
    const swayY = Math.sin(t * 2.1) * 0.003 * sway;
    this.gun.position.lerpVectors(HIP, this.aimed, aim);
    this.gun.position.x += swayX;
    this.gun.position.y += swayY;
    this.gun.position.z += this.kick * 0.03;
    this.gun.rotation.x = this.kick * 0.04;
    this.flash.visible = now < this.flashUntil;
  }

  /** The muzzle's position in the world, for tracers. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.holder.updateMatrixWorld();
    return this.muzzle.getWorldPosition(out);
  }
}
