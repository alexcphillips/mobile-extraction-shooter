import { CollisionWorld, createWeapon, type BuySpot, type ItemDb } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { gunModel } from './gun-model';
import { shadedMaterial } from './material';

/** How far ahead of its marker the box is looked for, and from how high, downwards. */
const AHEAD = 1;
const LOOK_FROM = 1.8;
/** With no box found, its top is taken to be this high. */
const TOP = 1;
/** How far over the box's top the gun hovers, how far it bobs and how fast it sways. */
const HOVER = 0.45;
const BOB = 0.05;
const SWAY = 0.35;
/** In its last seconds it blinks, faster as it goes. */
const BLINK_FROM = 2;

/**
 * Zombies mode's mystery box's gun (2026-11-04): what it gave, from the gun's model,
 * hovering side-on over the box until it's taken or goes, blinking before it goes. The box
 * itself is map geometry, so its top is found with a ray down, ahead of the marker (the box
 * is the way the marker faces). One mesh per box, a draw call each while a gun shows.
 */
export class BoxOffers {
  readonly root = new THREE.Group();
  private readonly geometry = new Map<string, THREE.BufferGeometry>();
  private readonly meshes: (THREE.Mesh | null)[] = [];
  /** How high each box's gun hovers. */
  private readonly heights: number[] = [];
  private readonly material = shadedMaterial();

  constructor(
    buys: readonly BuySpot[],
    private readonly items: ItemDb,
    world: CollisionWorld,
  ) {
    for (const b of buys) {
      if (b.kind !== 'mysteryBox') {
        this.meshes.push(null);
        this.heights.push(0);
        continue;
      }
      const x = b.x - Math.sin(b.yaw) * AHEAD;
      const z = b.z - Math.cos(b.yaw) * AHEAD;
      const hit = world.raycast(x, b.y + LOOK_FROM, z, 0, -1, 0, LOOK_FROM);
      const top = hit === Infinity ? TOP : LOOK_FROM - hit;
      const m = new THREE.Mesh(undefined, this.material);
      m.position.set(x, b.y + top + HOVER, z);
      m.visible = false;
      this.meshes.push(m);
      this.heights.push(m.position.y);
      this.root.add(m);
    }
  }

  /** Call every frame with the buy spots and the time in seconds. */
  update(buys: readonly BuySpot[], time: number): void {
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      if (!m) continue;
      const offer = buys[i]?.offer;
      if (!offer) {
        m.visible = false;
        continue;
      }
      m.geometry = this.gun(offer.item);
      const b = buys[i]!;
      // Side-on to whoever stands at the marker, barrel to their right.
      m.rotation.set(0, b.yaw - Math.PI / 2 + Math.sin(time * 1.3) * SWAY, 0);
      m.position.y = this.heights[i]! + Math.sin(time * 2.2) * BOB;
      const rate = offer.left < BLINK_FROM ? 3 + (BLINK_FROM - offer.left) * 4 : 0;
      m.visible = rate === 0 || Math.sin(time * rate * Math.PI) > -0.3;
    }
  }

  /** A gun's geometry, centred on its origin, built once per gun. */
  private gun(item: string): THREE.BufferGeometry {
    let g = this.geometry.get(item);
    if (g) return g;
    const b = new TriangleBuilder(false);
    for (const s of gunModel(createWeapon(this.items, item), this.items).shapes) b.shape(s);
    g = b.build();
    g.computeBoundingBox();
    const box = g.boundingBox!;
    g.translate(
      -(box.min.x + box.max.x) / 2,
      -(box.min.y + box.max.y) / 2,
      -(box.min.z + box.max.z) / 2,
    );
    this.geometry.set(item, g);
    return g;
  }
}
