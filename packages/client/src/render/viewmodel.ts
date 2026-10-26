import type { ItemDb, Outfit, Shape, WeaponState } from '@mes/shared';
import * as THREE from 'three';
import { DEFAULT_OUTFIT } from './character';
import { TriangleBuilder } from './geometry';
import { KNIFE, gunKey, gunModel } from './gun-model';
import { shadedMaterial } from './material';

/** A box from one point to another (in the gun's frame), as thick as given: a limb. */
function limb(
  from: readonly number[],
  to: readonly number[],
  hw: number,
  hh: number,
  colour: number,
): Shape {
  const dx = to[0]! - from[0]!;
  const dy = to[1]! - from[1]!;
  const dz = to[2]! - from[2]!;
  const len = Math.hypot(dx, dy, dz);
  return {
    kind: 'box',
    x: (from[0]! + to[0]!) / 2,
    y: (from[1]! + to[1]!) / 2,
    z: (from[2]! + to[2]!) / 2,
    hx: hw,
    hy: hh,
    hz: len / 2,
    yaw: Math.atan2(dx, dz),
    pitch: -Math.asin(dy / len),
    roll: 0,
    colour,
  };
}

const hex = (c: string): number => parseInt(c.slice(1), 16);

type Point = readonly [number, number, number];

/**
 * Low-poly forearms and hands on the gun: the right hand on the grip, the left on the
 * support point (if any), the sleeves running back and down out of view.
 */
function arms(grip: Point, support: Point | null, outfit: Outfit): Shape[] {
  const sleeve = hex(outfit.top);
  const glove = hex(outfit.hands);
  const [gx, gy, gz] = grip;
  const right = [
    limb([gx, gy - 0.01, gz - 0.02], [gx + 0.01, gy - 0.02, gz + 0.06], 0.022, 0.032, glove),
    limb([gx + 0.01, gy - 0.03, gz + 0.06], [gx + 0.1, gy - 0.22, gz + 0.36], 0.03, 0.034, sleeve),
  ];
  if (!support) return right;
  const [sx, sy, sz] = support;
  return [
    ...right,
    limb([sx, sy - 0.02, sz + 0.035], [sx, sy - 0.02, sz - 0.045], 0.026, 0.03, glove),
    limb(
      [sx - 0.005, sy - 0.04, sz + 0.03],
      [sx - 0.22, sy - 0.26, sz + 0.26],
      0.03,
      0.034,
      sleeve,
    ),
  ];
}

/** Where the gun sits relative to the camera, from the hip and aimed down the sight. */
const HIP = new THREE.Vector3(0.13, -0.14, -0.42);
const AIMED_Z = -0.3;
/** A pistol is held further out. */
const PISTOL_HIP = new THREE.Vector3(0.12, -0.13, -0.38);
const PISTOL_AIMED_Z = -0.34;
/** The knife is held low to the right, and never aimed. */
const KNIFE_HIP = new THREE.Vector3(0.16, -0.12, -0.46);
/** How long a swing's slash takes on screen, at most (it's shorter if the knife is faster). */
const SLASH_MS = 320;

/**
 * The first-person gun or knife. It's drawn in its own pass after the world with the depth
 * buffer cleared, so it never pokes into walls. It follows the camera, slides between the
 * hip and the sight as the character aims, kicks back on each shot and shows a muzzle
 * flash; it comes up from below when drawn, dips while using a med, and the knife slashes.
 */
export class Viewmodel {
  /** Its own scene, drawn after the world. */
  readonly scene = new THREE.Scene();
  private readonly holder = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly model: THREE.Mesh;
  private readonly flash: THREE.Mesh;
  private readonly muzzle = new THREE.Object3D();
  private readonly aimed = new THREE.Vector3();
  private readonly hip = new THREE.Vector3();
  private kick = 0;
  private flashUntil = 0;
  /** The gun the model was built for, as one string, to rebuild only on change. */
  private built = '';
  private suppressed = false;
  /** How long the current reload takes, from when it started; 0 when not reloading. */
  private reloadTotal = 0;
  /** When the last knife swing started, and how long its slash lasts (ms). */
  private slashAt = -Infinity;
  private slashMs = SLASH_MS;

  constructor(private readonly outfit: Outfit = DEFAULT_OUTFIT) {
    this.model = new THREE.Mesh(new THREE.BufferGeometry(), shadedMaterial());
    this.flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffd36b }),
    );
    // Visible until the first update, so the warm-up draw compiles its shader.
    this.gun.add(this.model, this.flash, this.muzzle);
    this.holder.add(this.gun);
    this.scene.add(this.holder);
  }

  /** Shows the gun and its attachments, rebuilding the model only when they change. */
  setGun(w: WeaponState, items: ItemDb): void {
    const key = gunKey(w);
    if (key === this.built) return;
    this.built = key;
    const gun = gunModel(w, items);
    this.suppressed = gun.suppressed;
    this.build([...gun.shapes, ...arms(gun.grip, gun.support, this.outfit)]);
    const pistol = gun.hold === 'pistol';
    this.hip.copy(pistol ? PISTOL_HIP : HIP);
    this.aimed.set(0, -gun.sightY, pistol ? PISTOL_AIMED_Z : AIMED_Z);
    this.flash.position.set(0, gun.muzzleY, gun.muzzleZ);
    this.muzzle.position.set(0, gun.muzzleY, gun.muzzleZ);
  }

  /** Shows the knife in the right hand. */
  setKnife(): void {
    if (this.built === 'knife') return;
    this.built = 'knife';
    this.suppressed = true;
    this.build([...KNIFE.shapes, ...arms(KNIFE.grip, null, this.outfit)]);
    this.hip.copy(KNIFE_HIP);
    this.aimed.copy(KNIFE_HIP);
  }

  private build(shapes: readonly Shape[]): void {
    const b = new TriangleBuilder(false);
    for (const s of shapes) b.shape(s);
    this.model.geometry.dispose();
    this.model.geometry = b.build();
  }

  set visible(on: boolean) {
    this.holder.visible = on;
  }

  /** A shot: kick back and flash (no flash through a suppressor). */
  fired(now: number): void {
    this.kick = Math.min(1.5, this.kick + 1);
    if (!this.suppressed) this.flashUntil = now + 40;
  }

  /** A knife swing: a slash across the view, within the swing time (seconds). */
  swung(now: number, swingTime: number): void {
    this.slashAt = now;
    this.slashMs = Math.min(SLASH_MS, swingTime * 1000 * 0.8);
  }

  /**
   * Follows the camera; aim is 0 at the hip to 1 aimed; sway grows with broken arms; the
   * gun dips and tilts while reloading (seconds left, or 0); drawn goes from 0 (just
   * switched, out of view below) to 1 (ready); lowered is 1 while using a med.
   */
  update(
    camera: THREE.Camera,
    now: number,
    dtMs: number,
    aim: number,
    sway: number,
    reloading: number,
    drawn: number,
    lowered: number,
  ): void {
    this.holder.position.copy(camera.position);
    this.holder.quaternion.copy(camera.quaternion);
    this.kick *= Math.exp(-dtMs / 60);
    const t = now / 1000;
    const swayX = Math.sin(t * 1.3) * 0.004 * sway;
    const swayY = Math.sin(t * 2.1) * 0.003 * sway;
    if (reloading <= 0) this.reloadTotal = 0;
    else if (reloading > this.reloadTotal) this.reloadTotal = reloading;
    const dip = this.reloadTotal ? Math.sin(Math.PI * (1 - reloading / this.reloadTotal)) : 0;
    // Drawing brings it up from below, pointing down; easing out, so it arrives gently.
    const down = (1 - drawn) ** 2;
    const p = (now - this.slashAt) / this.slashMs;
    // A slash: out to the right, then across and forward to the left.
    const slash = p >= 0 && p < 1 ? Math.sin(Math.PI * p) : 0;
    const across = p >= 0 && p < 1 ? (1 - Math.cos(Math.PI * p)) / 2 : 0;
    this.gun.position.lerpVectors(this.hip, this.aimed, aim);
    this.gun.position.x += swayX - across * 0.26 + slash * 0.04;
    this.gun.position.y += swayY - dip * 0.08 - down * 0.3 - lowered * 0.14 + slash * 0.05;
    this.gun.position.z += this.kick * 0.03 - slash * 0.16 + lowered * 0.04;
    this.gun.rotation.x = this.kick * 0.04 - dip * 0.35 - down * 1.1 - lowered * 0.7;
    this.gun.rotation.y = slash * 0.9;
    this.gun.rotation.z = dip * 0.5 - slash * 1.2;
    this.flash.visible = now < this.flashUntil;
  }

  /** The muzzle's position in the world, for tracers. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.holder.updateMatrixWorld();
    return this.muzzle.getWorldPosition(out);
  }
}
