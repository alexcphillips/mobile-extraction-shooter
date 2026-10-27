import { itemDef, type GroundItem, type Item, type ItemDb, type ItemDef } from '@mes/shared';
import * as THREE from 'three';
import { shadedMaterial } from './material';

/** How big one inventory cell is on the ground, in metres. */
const CELL = 0.14;
const HEIGHT = 0.07;
/** How much lighter the item the use button would take is drawn. */
const LIT = 1.6;

/** A colour per item type, like the inventory screen's, until items get models (session 18). */
const COLOURS: Record<ItemDef['type'], number> = {
  weapon: 0x56653f,
  ammo: 0x9a8238,
  armour: 0x3f5266,
  attachment: 0x5a4870,
  med: 0xb04848,
  container: 0x4c5a36,
  melee: 0x5e5e5e,
  key: 0xc29a30,
  quest: 0x8b4a8b,
  loot: 0xa08a40,
  repair: 0x2f7a7a,
};

/**
 * Items on the ground as flat boxes sized by their inventory grid size and coloured by
 * type: one instanced mesh, one draw call for them all. Rebuilt only when the list
 * changes, which is checked each tick by comparing the items.
 */
export class GroundItems {
  readonly root = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private capacity = 0;
  private readonly geometry: THREE.BoxGeometry;
  private readonly material = shadedMaterial();
  private drawn: GroundItem[] = [];
  /** Each drawn one's item, so an item swapped in place on the ground counts as a change. */
  private drawnItems: Item[] = [];
  private lit = -1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly items: ItemDb) {
    // Base at y = 0, white vertex colours for the instance colours to tint.
    this.geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const n = this.geometry.attributes.position!.count;
    this.geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Array(n * 3).fill(1), 3),
    );
  }

  /** Call once per tick. `lit`: the index of the item the use button would take, or -1. */
  update(ground: readonly GroundItem[], lit: number): void {
    if (this.changed(ground)) this.rebuild(ground);
    if (lit !== this.lit && this.mesh) {
      if (this.lit >= 0 && this.lit < this.drawn.length) this.colour(this.lit, 1);
      if (lit >= 0 && lit < this.drawn.length) this.colour(lit, LIT);
      this.mesh.instanceColor!.needsUpdate = true;
    }
    this.lit = lit;
  }

  private changed(ground: readonly GroundItem[]): boolean {
    if (ground.length !== this.drawn.length) return true;
    for (let i = 0; i < ground.length; i++) {
      const g = ground[i]!;
      if (g !== this.drawn[i] || g.item !== this.drawnItems[i]) return true;
    }
    return false;
  }

  private rebuild(ground: readonly GroundItem[]): void {
    this.drawn = ground.slice();
    this.drawnItems = ground.map((g) => g.item);
    this.lit = -1;
    if (!this.mesh || this.capacity < ground.length) {
      if (this.mesh) {
        this.root.remove(this.mesh);
        this.mesh.dispose();
      }
      this.capacity = 64;
      while (this.capacity < ground.length) this.capacity *= 2;
      this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(this.mesh);
    }
    const mesh = this.mesh;
    ground.forEach((g, i) => {
      const def = itemDef(this.items, g.item.item);
      this.p.set(g.x, g.y, g.z);
      this.q.setFromAxisAngle(this.up, g.yaw);
      this.s.set(def.size[0] * CELL, HEIGHT, def.size[1] * CELL);
      mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      this.colour(i, 1);
    });
    mesh.count = ground.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  private colour(i: number, k: number): void {
    const def = itemDef(this.items, this.drawnItems[i]!.item);
    this.c.setHex(COLOURS[def.type]).multiplyScalar(k);
    this.mesh!.setColorAt(i, this.c);
  }
}
