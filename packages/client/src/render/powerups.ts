import type { Powerup, PowerupDrop, Shape } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { shadedMaterial } from './material';

/** How high a power-up floats, how far it bobs and how fast it turns (radians a second). */
const FLOAT = 0.9;
const BOB = 0.12;
const SPIN = 1.8;
/** In its last seconds it blinks, faster as it goes. */
const BLINK_FROM = 5;
/** At most this many lie about at once; more are left undrawn. */
const MAX_SHOWN = 12;

const box = (
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  color: number,
): Shape => ({ kind: 'box', x, y, z, hx, hy, hz, color, yaw: 0, pitch: 0, roll: 0 });
const cyl = (
  x: number,
  y: number,
  z: number,
  radius: number,
  hy: number,
  color: number,
  pitch = 0,
): Shape => ({
  kind: 'cylinder',
  x,
  y,
  z,
  radius,
  radiusTop: radius,
  hy,
  sides: 12,
  color,
  yaw: 0,
  pitch,
  roll: 0,
});

/**
 * Each power-up's look, centered on its origin, about 0.5 m across: a skull for insta-kill,
 * an ammo crate for max ammo, two gold coins for double points, a hammer for carpenter, and
 * a minigun's barrels for the death machine.
 */
const LOOKS: Record<Powerup, Shape[]> = {
  instaKill: [
    box(0, 0.04, 0, 0.17, 0.15, 0.16, 0xe8e4d8),
    box(0, -0.15, -0.02, 0.11, 0.05, 0.12, 0xe8e4d8),
    box(-0.07, 0.06, -0.165, 0.045, 0.045, 0.01, 0x1a1a1a),
    box(0.07, 0.06, -0.165, 0.045, 0.045, 0.01, 0x1a1a1a),
    box(0, -0.04, -0.165, 0.02, 0.03, 0.01, 0x1a1a1a),
  ],
  maxAmmo: [
    box(0, -0.06, 0, 0.22, 0.12, 0.14, 0x4e5a2f),
    cyl(-0.1, 0.12, 0, 0.025, 0.07, 0xd9b84a),
    cyl(-0.03, 0.12, 0, 0.025, 0.07, 0xd9b84a),
    cyl(0.04, 0.12, 0, 0.025, 0.07, 0xd9b84a),
    cyl(0.11, 0.12, 0, 0.025, 0.07, 0xd9b84a),
  ],
  doublePoints: [
    cyl(-0.09, 0, 0, 0.14, 0.025, 0xf2c94c, Math.PI / 2),
    cyl(0.09, 0.04, 0.03, 0.14, 0.025, 0xe0b23a, Math.PI / 2),
  ],
  carpenter: [
    box(0, -0.06, 0, 0.03, 0.2, 0.03, 0x8a6239),
    box(0, 0.15, 0, 0.13, 0.05, 0.05, 0x9aa3ab),
  ],
  deathMachine: [
    box(0, 0, 0.12, 0.08, 0.08, 0.1, 0x3a3f45),
    cyl(0.03, 0.03, -0.1, 0.012, 0.16, 0x2a2d30, Math.PI / 2),
    cyl(-0.03, 0.03, -0.1, 0.012, 0.16, 0x2a2d30, Math.PI / 2),
    cyl(0.03, -0.03, -0.1, 0.012, 0.16, 0x2a2d30, Math.PI / 2),
    cyl(-0.03, -0.03, -0.1, 0.012, 0.16, 0x2a2d30, Math.PI / 2),
  ],
};

/**
 * Zombies mode's power-ups lying about (2026-11-04), drawn from a small pool of meshes, one
 * per drop: floating, bobbing and turning over where the zombie died, blinking before they
 * go. A handful at most, so one draw call each costs little.
 */
export class Powerups {
  readonly root = new THREE.Group();
  private readonly geometry = new Map<Powerup, THREE.BufferGeometry>();
  private readonly pool: THREE.Mesh[] = [];
  private readonly material = shadedMaterial();

  constructor() {
    for (const [kind, parts] of Object.entries(LOOKS) as [Powerup, Shape[]][]) {
      const b = new TriangleBuilder(false);
      for (const p of parts) b.shape(p);
      this.geometry.set(kind, b.build());
    }
  }

  /** Call every frame with the drops and the time in seconds. */
  update(drops: readonly PowerupDrop[], time: number): void {
    const n = Math.min(drops.length, MAX_SHOWN);
    while (this.pool.length < n) {
      const m = new THREE.Mesh(undefined, this.material);
      this.pool.push(m);
      this.root.add(m);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const m = this.pool[i]!;
      const d = drops[i];
      if (!d || i >= n) {
        m.visible = false;
        continue;
      }
      m.geometry = this.geometry.get(d.kind)!;
      const phase = d.id * 1.7;
      m.position.set(d.x, d.y + FLOAT + Math.sin(time * 2.2 + phase) * BOB, d.z);
      m.rotation.set(0.25, time * SPIN + phase, 0);
      // Blinks in its last seconds, faster as it goes.
      const rate = d.left < BLINK_FROM ? 2 + (BLINK_FROM - d.left) * 1.5 : 0;
      m.visible = rate === 0 || Math.sin(time * rate * Math.PI) > -0.3;
    }
  }
}
