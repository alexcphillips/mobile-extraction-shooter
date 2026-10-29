import { itemDef, modelShapes, type ItemDb, type Outfit, type Shape } from '@mes/shared';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { TriangleBuilder } from './geometry';

/** Characters are drawn this tall, the simulation's standing height. */
const HEIGHT = 1.8;
/** The bone gear without a body bone hangs on: the gun, placed by the animator. */
export const WEAPON_BONE = 'weapon';

/**
 * Where worn and carried gear attaches: a bone each. Gear is drawn in the rest pose and
 * moves rigidly with its bone.
 */
export const MOUNTS = {
  helmet: 'DEF-head',
  armour: 'DEF-spine002',
  rig: 'DEF-spine002',
  backpack: 'DEF-spine003',
  weapon: WEAPON_BONE,
} as const;

/** The worn gear slots, in the order they're built. */
const WORN = ['helmet', 'armour', 'rig', 'backpack'] as const;

export const DEFAULT_OUTFIT: Outfit = {
  skin: '#c99a78',
  top: '#5d6670',
  bottom: '#3f4650',
  hands: '#3b3530',
  feet: '#2e2a26',
};

type Part = keyof Outfit;
const PARTS: readonly Part[] = ['skin', 'top', 'bottom', 'hands', 'feet'];
/** The mannequin's joint bands are drawn this much darker than the part they're on. */
const JOINT_SHADE = 0.8;

/** Which outfit part a bone's skin wears, from its name in the Universal Animation Library rig. */
function partOf(bone: string): Part {
  if (/head|neck/.test(bone)) return 'skin';
  if (/hand|f_|thumb/.test(bone)) return 'hands';
  if (/foot|toe/.test(bone)) return 'feet';
  if (/hips|thigh|shin/.test(bone)) return 'bottom';
  return 'top';
}

/** What a character wears (item ids, or null) and holds. */
export interface Gear {
  helmet: string | null;
  armour: string | null;
  rig: string | null;
  backpack: string | null;
  /** The gun's or knife's shapes, in its own frame; drawn on the weapon bone. */
  gun: readonly Shape[] | null;
}

/**
 * A character model ready to clone: the rig, its clips, and the body as flat triangles
 * (face normals, skin weights and which outfit part each vertex is) to build each look's
 * geometry from. Every look, gear included, is ONE skinned mesh: one draw call.
 */
export interface CharacterTemplate {
  root: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  bones: Map<string, number>;
  triangles: number;
  body: {
    position: Float32Array;
    normal: Float32Array;
    skinIndex: Uint16Array;
    skinWeight: Float32Array;
    /** Per vertex: the index into PARTS, plus 8 on a joint band. */
    part: Uint8Array;
  };
  material: THREE.Material;
  looks: Map<string, THREE.BufferGeometry>;
  /**
   * How the rest pose was scaled and raised to stand 1.8 m tall on y = 0 (it's also turned
   * to face −z), to put worn gear, modelled in game metres, into the rig's frame.
   */
  rest: { scale: number; y: number };
}

/**
 * Loads a glTF character, here the Universal Animation Library's mannequin, and bakes it
 * into flat triangles: each face takes the outfit part of the bone that moves it most.
 * The model is turned to face −z and scaled to the simulation's height, and gets an extra
 * weapon bone for the gun.
 */
export async function loadCharacter(url: string): Promise<CharacterTemplate> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const src = gltf.scene;
  src.updateMatrixWorld(true);

  const meshes: THREE.SkinnedMesh[] = [];
  src.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) meshes.push(o);
  });
  const skeleton = meshes[0]?.skeleton;
  if (!skeleton) throw new Error(`${url}: no skinned mesh`);
  const weapon = new THREE.Bone();
  weapon.name = WEAPON_BONE;
  const bones = [...skeleton.bones, weapon];
  const boneIndex = new Map(bones.map((b, i) => [b, i]));

  let vertCount = 0;
  for (const m of meshes) vertCount += m.geometry.index?.count ?? 0;
  const position = new Float32Array(vertCount * 3);
  const normal = new Float32Array(vertCount * 3);
  const skinIndex = new Uint16Array(vertCount * 4);
  const skinWeight = new Float32Array(vertCount * 4);
  const part = new Uint8Array(vertCount);

  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const weightByBone = new Map<number, number>();
  let v = 0;
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const index = geo.index!;
    const sIdx = geo.getAttribute('skinIndex');
    const sW = geo.getAttribute('skinWeight');
    const own = mesh.skeleton.bones;
    const joint = (mesh.material as THREE.Material).name === 'M_Joints' ? 8 : 0;
    for (let t = 0; t < index.count; t += 3) {
      weightByBone.clear();
      for (let k = 0; k < 3; k++) {
        const vi = index.getX(t + k);
        // Rest-pose position; the new bind pose is the rest pose.
        mesh.applyBoneTransform(vi, p[k]!.fromBufferAttribute(pos, vi));
        p[k]!.applyMatrix4(mesh.matrixWorld);
        const o = (v + k) * 4;
        for (let j = 0; j < 4; j++) {
          const b = boneIndex.get(own[sIdx.getComponent(vi, j)]!) ?? 0;
          const w = sW.getComponent(vi, j);
          skinIndex[o + j] = b;
          skinWeight[o + j] = w;
          weightByBone.set(b, (weightByBone.get(b) ?? 0) + w);
        }
      }
      let top = 0;
      let topWeight = -1;
      for (const [b, w] of weightByBone) if (w > topWeight) [top, topWeight] = [b, w];
      const face = PARTS.indexOf(partOf(bones[top]!.name)) + joint;
      e1.subVectors(p[1], p[0]);
      e2.subVectors(p[2], p[0]);
      e1.cross(e2).normalize();
      for (let k = 0; k < 3; k++) {
        position.set([p[k]!.x, p[k]!.y, p[k]!.z], (v + k) * 3);
        normal.set([e1.x, e1.y, e1.z], (v + k) * 3);
        part[v + k] = face;
      }
      v += 3;
    }
  }
  for (const m of meshes) m.removeFromParent();

  const material = characterMaterial();
  const template: CharacterTemplate = {
    root: new THREE.Group(),
    clips: new Map(gltf.animations.map((clip) => [clip.name, clip])),
    bones: new Map(bones.map((b, i) => [b.name, i])),
    triangles: vertCount / 3,
    body: { position, normal, skinIndex, skinWeight, part },
    material,
    looks: new Map(),
    rest: { scale: 1, y: 0 },
  };

  // Bind in the rest pose with the weapon bone at the origin, so gun shapes are given in
  // the gun's own frame. Then turn and scale the body; the weapon bone stays unscaled.
  const mesh = new THREE.SkinnedMesh(
    characterGeometry(template, DEFAULT_OUTFIT, NO_GEAR, new Map()),
    material,
  );
  src.add(mesh, weapon);
  src.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(position, 3));
  src.scale.setScalar(HEIGHT / (box.max.y - box.min.y));
  src.rotation.y = Math.PI;
  src.position.y = -box.min.y * src.scale.y;
  template.rest = { scale: src.scale.y, y: src.position.y };
  template.root.add(src, weapon);
  return template;
}

export const NO_GEAR: Gear = { helmet: null, armour: null, rig: null, backpack: null, gun: null };

/**
 * Worn gear's shapes, modelled on the body in game metres facing −z, moved into the rig's
 * rest frame: unscaled, unraised and turned back to face +z.
 */
function inRestFrame(shapes: Shape[], rest: CharacterTemplate['rest']): Shape[] {
  const k = 1 / rest.scale;
  return shapes.map((s) => {
    const out = { ...s, x: -s.x * k, y: (s.y - rest.y) * k, z: -s.z * k, yaw: s.yaw + Math.PI };
    if (out.kind === 'cylinder') {
      out.radius *= k;
      out.radiusTop *= k;
      out.hy *= k;
    } else {
      out.hx *= k;
      out.hy *= k;
      out.hz *= k;
    }
    return out;
  });
}

/**
 * The geometry for one look: the body in an outfit's colours, plus gear from its item
 * models. Cached by look, since a raid has only a few.
 */
export function characterGeometry(
  t: CharacterTemplate,
  outfit: Outfit,
  gear: Gear,
  items: ItemDb,
): THREE.BufferGeometry {
  const key = `${PARTS.map((p) => outfit[p]).join()} ${WORN.map((w) => gear[w]).join()} ${JSON.stringify(gear.gun)}`;
  const cached = t.looks.get(key);
  if (cached) return cached;

  const pieces: { shapes: readonly Shape[]; bone: number }[] = [];
  for (const slot of WORN) {
    const id = gear[slot];
    if (!id) continue;
    const shapes = inRestFrame(modelShapes(itemDef(items, id).model), t.rest);
    pieces.push({ shapes, bone: t.bones.get(MOUNTS[slot])! });
  }
  if (gear.gun) pieces.push({ shapes: gear.gun, bone: t.bones.get(MOUNTS.weapon)! });
  const built = pieces.map((piece) => {
    const b = new TriangleBuilder(false);
    for (const s of piece.shapes) b.shape(s);
    return { geo: b.build(), bone: piece.bone };
  });

  const bodyCount = t.body.part.length;
  const count = bodyCount + built.reduce((n, b) => n + b.geo.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const colour = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  position.set(t.body.position);
  normal.set(t.body.normal);
  skinIndex.set(t.body.skinIndex);
  skinWeight.set(t.body.skinWeight);
  const c = new THREE.Color();
  const palette = PARTS.flatMap((p) => c.set(outfit[p]).toArray());
  for (let i = 0; i < bodyCount; i++) {
    const part = t.body.part[i]!;
    const f = part >= 8 ? JOINT_SHADE : 1;
    const o = (part & 7) * 3;
    colour[i * 3] = palette[o]! * f;
    colour[i * 3 + 1] = palette[o + 1]! * f;
    colour[i * 3 + 2] = palette[o + 2]! * f;
  }
  let v = bodyCount;
  for (const { geo, bone } of built) {
    const n = geo.getAttribute('position').count;
    position.set(geo.getAttribute('position').array, v * 3);
    normal.set(geo.getAttribute('normal').array, v * 3);
    colour.set(geo.getAttribute('color').array, v * 3);
    for (let i = 0; i < n; i++) {
      skinIndex[(v + i) * 4] = bone;
      skinWeight[(v + i) * 4] = 1;
    }
    v += n;
    geo.dispose();
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  t.looks.set(key, g);
  return g;
}

/** A clone of the template with its own skeleton and the default look. */
export function cloneCharacter(t: CharacterTemplate): {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
} {
  const root = cloneSkinned(t.root) as THREE.Group;
  let mesh: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) mesh = o;
  });
  // Animation moves it far from its rest-pose bounds (lying dead, arms out), so cull by a
  // sphere around the whole body instead. It's in the rest pose's frame: metres, unscaled.
  mesh!.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
  return { root, mesh: mesh! };
}

/**
 * Unlit vertex colours shaded per face on the GPU from the skinned normal, with the same
 * formula as shade.ts, so the shading stays right as the body moves.
 */
function characterMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <fog_vertex>',
      `#include <fog_vertex>
      #ifdef USE_SKINNING
        vec3 shadeN = normalize( mat3( modelMatrix ) * objectNormal );
        vColor.rgb *= ( shadeN.y >= 0.0 ? 0.7 + 0.3 * shadeN.y : 0.7 + 0.2 * shadeN.y ) + 0.1 * abs( shadeN.x );
      #endif`,
    );
  };
  return m;
}
