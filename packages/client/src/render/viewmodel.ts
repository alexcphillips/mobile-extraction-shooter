import type { Shape } from '@mes/shared';
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

/**
 * A placeholder gun until the item editor builds real models (session 18) and arms
 * arrive (session 8b). The top of the sight is at y = SIGHT_Y.
 */
const GUN: Shape[] = [
  box(0, 0, -0.1, 0.03, 0.045, 0.16, 0x3a3f44),
  box(0, 0.02, -0.36, 0.013, 0.013, 0.12, 0x2a2d30),
  box(0, -0.09, -0.06, 0.022, 0.055, 0.03, 0x2a2d30),
  box(0, -0.075, 0.04, 0.022, 0.045, 0.02, 0x4a3a2c),
  box(0, -0.015, 0.11, 0.026, 0.04, 0.05, 0x4a3a2c),
  box(0, 0.055, -0.06, 0.008, 0.01, 0.03, 0x1d1f21),
];
const SIGHT_Y = 0.065;
const MUZZLE = new THREE.Vector3(0, 0.02, -0.49);

/** Where the gun sits relative to the camera, from the hip and aimed down the sight. */
const HIP = new THREE.Vector3(0.13, -0.14, -0.42);
const AIMED = new THREE.Vector3(0, -SIGHT_Y, -0.3);

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
  private readonly flash: THREE.Mesh;
  private readonly muzzle = new THREE.Object3D();
  private kick = 0;
  private flashUntil = 0;

  constructor() {
    const b = new TriangleBuilder(false);
    for (const s of GUN) b.shape(s);
    this.gun.add(new THREE.Mesh(b.build(), shadedMaterial()));
    this.flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffd36b }),
    );
    this.flash.position.copy(MUZZLE);
    // Visible until the first update, so the warm-up draw compiles its shader.
    this.muzzle.position.copy(MUZZLE);
    this.gun.add(this.flash, this.muzzle);
    this.holder.add(this.gun);
    this.scene.add(this.holder);
  }

  set visible(on: boolean) {
    this.holder.visible = on;
  }

  /** A shot: kick back and flash. */
  fired(now: number): void {
    this.kick = Math.min(1.5, this.kick + 1);
    this.flashUntil = now + 40;
  }

  /** Follows the camera; aim is 0 at the hip to 1 aimed; sway grows with broken arms. */
  update(camera: THREE.Camera, now: number, dtMs: number, aim: number, sway: number): void {
    this.holder.position.copy(camera.position);
    this.holder.quaternion.copy(camera.quaternion);
    this.kick *= Math.exp(-dtMs / 60);
    const t = now / 1000;
    const swayX = Math.sin(t * 1.3) * 0.004 * sway;
    const swayY = Math.sin(t * 2.1) * 0.003 * sway;
    this.gun.position.lerpVectors(HIP, AIMED, aim);
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
