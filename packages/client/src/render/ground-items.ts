import { itemDef, modelShapes, type GroundItem, type Item, type ItemDb } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { shadedMaterial } from './material';

/** How much lighter the item the use button would take is drawn. */
const LIT = 1.6;

/**
 * Items on the ground, drawn with their models (session 18b) merged into one mesh: one draw
 * call for them all. Rebuilt only when the list changes, which is checked each tick by
 * comparing the items. Guns, knives and magazines lie on their side, body armour, rigs and backpacks
 * on their back; everything else stands as modelled, its lowest point on the ground.
 */
export class GroundItems {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  /** Each item's model, laid down, by item id. */
  private readonly laid = new Map<string, THREE.BufferGeometry>();
  private drawn: GroundItem[] = [];
  /** Each drawn one's item, so an item swapped in place on the ground counts as a change. */
  private drawnItems: Item[] = [];
  /** Where each drawn item's vertices start in the mesh, and one past the last item's. */
  private starts: number[] = [];
  private lit = -1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly items: ItemDb) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), shadedMaterial());
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  /** Call once per tick. `lit`: the index of the item the use button would take, or -1. */
  update(ground: readonly GroundItem[], lit: number): void {
    if (this.changed(ground)) this.rebuild(ground);
    if (lit !== this.lit) {
      if (this.lit >= 0 && this.lit < this.drawn.length) this.colour(this.lit, 1 / LIT);
      if (lit >= 0 && lit < this.drawn.length) this.colour(lit, LIT);
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

  /** An item's model as it lies on the ground: centred on its origin, resting on y = 0. */
  private laidDown(id: string): THREE.BufferGeometry {
    let g = this.laid.get(id);
    if (g) return g;
    const def = itemDef(this.items, id);
    const b = new TriangleBuilder(false);
    for (const s of modelShapes(def.model)) b.shape(s);
    g = b.build();
    const long = def.type === 'attachment' && def.slot === 'magazine';
    if (def.type === 'weapon' || def.type === 'melee' || long) g.rotateZ(Math.PI / 2);
    else if ((def.type === 'armour' && def.slot === 'body') || def.type === 'container')
      g.rotateX(Math.PI / 2);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    g.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    this.laid.set(id, g);
    return g;
  }

  private rebuild(ground: readonly GroundItem[]): void {
    this.drawn = ground.slice();
    this.drawnItems = ground.map((g) => g.item);
    this.lit = -1;
    const parts = ground.map((g) => this.laidDown(g.item.item));
    this.starts = [0];
    for (const p of parts) this.starts.push(this.starts.at(-1)! + p.getAttribute('position').count);
    const n = this.starts.at(-1)!;
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const colour = new Float32Array(n * 3);
    ground.forEach((g, i) => {
      const src = parts[i]!;
      this.m.compose(this.p.set(g.x, g.y, g.z), this.q.setFromAxisAngle(this.up, g.yaw), ONE);
      const pos = src.getAttribute('position');
      const nor = src.getAttribute('normal');
      const start = this.starts[i]!;
      for (let k = 0; k < pos.count; k++) {
        this.v
          .fromBufferAttribute(pos, k)
          .applyMatrix4(this.m)
          .toArray(position, (start + k) * 3);
        this.v
          .fromBufferAttribute(nor, k)
          .applyQuaternion(this.q)
          .toArray(normal, (start + k) * 3);
      }
      colour.set(src.getAttribute('color').array, start * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colour, 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }

  /** Multiplies one drawn item's colours by k. */
  private colour(i: number, k: number): void {
    const attr = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    for (let j = this.starts[i]! * 3; j < this.starts[i + 1]! * 3; j++) a[j]! *= k;
    attr.needsUpdate = true;
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
