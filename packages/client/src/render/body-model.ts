import {
  OUTFIT_SLOTS,
  itemDef,
  modelShapes,
  outfitSlotOf,
  platingShapes,
  type BodyBone,
  type BodyDef,
  type ItemDb,
  type Outfit,
  type OutfitSlot,
  type ModelShape,
  type SkeletonBone,
} from '@mes/shared';
import * as THREE from 'three';
import { characterMaterial } from './character';
import { TriangleBuilder } from './geometry';
import type { Pose, Skeleton } from './skeleton-pose';

/*
 * Our own body (CH-2): content/characters/body.json drawn as ONE skinned mesh per look,
 * every vertex on one bone with weight 1 (rigid pieces, no bending), with the outfit's
 * plating and worn gear in the same mesh, so a character is one draw call. Posed by a
 * Pose (render/skeleton-pose.ts). Behind ?body=own until CH-5.
 */

/** Plating's body bones (the pack's names, BODY_BONES) on our skeleton. */
export const PLATING_TO_SKELETON: Readonly<Record<BodyBone, SkeletonBone>> = {
  hips: 'hips',
  belly: 'spine',
  chest: 'chest',
  upperChest: 'chest',
  neck: 'neck',
  head: 'head',
  upperArmL: 'upperArmL',
  upperArmR: 'upperArmR',
  forearmL: 'forearmL',
  forearmR: 'forearmR',
  handL: 'handL',
  handR: 'handR',
  thighL: 'thighL',
  thighR: 'thighR',
  shinL: 'shinL',
  shinR: 'shinR',
  footL: 'footL',
  footR: 'footR',
  toeL: 'footL',
  toeR: 'footR',
};

/**
 * Worn gear, by item id (null for none). The visor is the one fitted to the helmet's
 * mount; it and the headset hang on the helmet's mount bone (CH-3).
 */
export interface WornGear {
  helmet: string | null;
  visor: string | null;
  headset: string | null;
  armor: string | null;
  rig: string | null;
  backpack: string | null;
}
export const NO_WORN: WornGear = {
  helmet: null,
  visor: null,
  headset: null,
  armor: null,
  rig: null,
  backpack: null,
};
const WORN = ['helmet', 'visor', 'headset', 'armor', 'rig', 'backpack'] as const;
/** The skeleton mount each worn slot hangs on. */
export const MOUNT_OF = {
  helmet: 'helmet',
  visor: 'helmet',
  headset: 'helmet',
  armor: 'armor',
  rig: 'rig',
  backpack: 'backpack',
} as const;

const tint = new THREE.Color();
const base = new THREE.Color();

/** Per outfit slot, the color each channel is multiplied by (outfit over the body's own). */
function tints(body: BodyDef, outfit: Outfit): Record<OutfitSlot, [number, number, number]> {
  const out = {} as Record<OutfitSlot, [number, number, number]>;
  for (const slot of OUTFIT_SLOTS) {
    tint.set(outfit[slot]);
    base.set(body.colors[slot]);
    out[slot] = [tint.r / base.r, tint.g / base.g, tint.b / base.b];
  }
  return out;
}

/**
 * A body part's color in an outfit: tinted as bodyGeometry tints it (for the item editor's
 * outfit preview).
 */
export function tintedHex(body: BodyDef, outfit: Outfit, bone: SkeletonBone, hex: string): string {
  const slot = outfitSlotOf(bone);
  tint.set(outfit[slot]);
  base.set(body.colors[slot]);
  const c = new THREE.Color(hex);
  c.r = Math.min(1, (c.r * tint.r) / base.r);
  c.g = Math.min(1, (c.g * tint.g) / base.g);
  c.b = Math.min(1, (c.b * tint.b) / base.b);
  return `#${c.getHexString()}`;
}

/**
 * The geometry for one look: the body tinted to the outfit (its head left out under a
 * helmet that hides it), the outfit's plating, and worn gear on its mount bones. Every
 * vertex carries its bone in skinIndex (weight 1). In the rest pose's frame.
 */
export function bodyGeometry(
  body: BodyDef,
  skeleton: Skeleton,
  outfit: Outfit,
  gear: WornGear,
  items: ItemDb,
): THREE.BufferGeometry {
  const helmet = gear.helmet ? itemDef(items, gear.helmet) : null;
  const hidesHead = helmet?.type === 'armor' && !!helmet.hidesHead;
  const pieces: { shapes: ModelShape[]; bone: number; tint?: [number, number, number] }[] = [];
  const tinted = tints(body, outfit);
  for (const part of body.model.parts) {
    const bone = part.group as SkeletonBone;
    if (hidesHead && bone === 'head') continue;
    pieces.push({
      shapes: modelShapes({ parts: [part] }),
      bone: skeleton.index[bone],
      tint: tinted[outfitSlotOf(bone)],
    });
  }
  for (const group of platingShapes(outfit.plating))
    pieces.push({ shapes: group.shapes, bone: skeleton.index[PLATING_TO_SKELETON[group.bone]] });
  for (const slot of WORN) {
    const id = gear[slot];
    if (id)
      pieces.push({
        shapes: modelShapes(itemDef(items, id).model),
        bone: skeleton.mounts[MOUNT_OF[slot]],
      });
  }

  const built = pieces.map((p) => {
    const b = new TriangleBuilder(false);
    for (const s of p.shapes) b.shape(s);
    return { geo: b.build(), bone: p.bone, tint: p.tint };
  });
  const count = built.reduce((n, b) => n + b.geo.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  let v = 0;
  for (const { geo, bone, tint: k } of built) {
    const n = geo.getAttribute('position').count;
    position.set(geo.getAttribute('position').array, v * 3);
    normal.set(geo.getAttribute('normal').array, v * 3);
    const c = geo.getAttribute('color').array;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 3; j++)
        color[(v + i) * 3 + j] = Math.min(1, c[i * 3 + j]! * (k ? k[j]! : 1));
      skinIndex[(v + i) * 4] = bone;
      skinWeight[(v + i) * 4] = 1;
    }
    v += n;
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  return g;
}

/**
 * A body drawn from a look's geometry and posed by a Pose: a skinned mesh whose bones are
 * its children, each set to the pose's world matrix (character frame), with the inverse
 * bind the rest position, so the GPU applies the pose's skin matrices.
 */
export class BodyMesh {
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[];

  constructor(geometry: THREE.BufferGeometry, skeleton: Skeleton, material = characterMaterial()) {
    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.bones = [];
    const inverses: THREE.Matrix4[] = [];
    for (let i = 0; i < skeleton.count; i++) {
      const bone = new THREE.Bone();
      bone.matrixAutoUpdate = false;
      this.mesh.add(bone);
      this.bones.push(bone);
      const r = skeleton.rest;
      inverses.push(
        new THREE.Matrix4().makeTranslation(-r[i * 3]!, -r[i * 3 + 1]!, -r[i * 3 + 2]!),
      );
    }
    this.mesh.bind(new THREE.Skeleton(this.bones, inverses), new THREE.Matrix4());
    // Poses move it far from its rest bounds, so cull by a sphere round the whole body.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
    this.mesh.frustumCulled = true;
  }

  /** Shows a pose (call after the pose's update()). */
  pose(pose: Pose): void {
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i]!;
      bone.matrix.fromArray(pose.world, i * 16);
      bone.matrixWorldNeedsUpdate = true;
    }
  }
}
