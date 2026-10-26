import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { shade } from './shade';

const HEIGHT = 1.8;

export interface CharacterTemplate {
  root: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  triangles: number;
}

/**
 * Loads a glTF character and bakes all its parts (rigid meshes parented to bones and
 * skinned meshes alike) into ONE skinned mesh with flat per-face vertex colours,
 * drawn unlit. One draw call per character instead of one per part.
 */
export async function loadCharacter(url: string): Promise<CharacterTemplate> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const src = gltf.scene;
  src.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  let skeleton: THREE.Skeleton | undefined;
  src.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) skeleton ??= o.skeleton;
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  if (!skeleton) throw new Error(`${url}: no skeleton`);
  const bones = skeleton.bones;
  const boneIndex = new Map(bones.map((b, i) => [b as THREE.Object3D, i]));

  let vertCount = 0;
  for (const m of meshes)
    vertCount += m.geometry.index?.count ?? m.geometry.getAttribute('position').count;
  const pos = new Float32Array(vertCount * 3);
  const col = new Float32Array(vertCount * 3);
  const skinIndex = new Uint16Array(vertCount * 4);
  const skinWeight = new Float32Array(vertCount * 4);

  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let v = 0;
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const position = geo.getAttribute('position');
    const index = geo.index;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const colour = material.color;
    const skinned = mesh instanceof THREE.SkinnedMesh ? mesh : undefined;
    const sIdx = skinned ? geo.getAttribute('skinIndex') : undefined;
    const sW = skinned ? geo.getAttribute('skinWeight') : undefined;
    const ownBones = skinned?.skeleton.bones;

    // A rigid part follows its nearest bone ancestor.
    let rigidBone = 0;
    if (!skinned) {
      let a: THREE.Object3D | null = mesh.parent;
      while (a && !boneIndex.has(a)) a = a.parent;
      rigidBone = a ? boneIndex.get(a)! : 0;
    }

    const n = index ? index.count : position.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(t + k) : t + k;
        const pk = p[k]!.fromBufferAttribute(position, vi);
        // Rest-pose world position; the new bind pose is the rest pose.
        if (skinned) skinned.applyBoneTransform(vi, pk);
        pk.applyMatrix4(mesh.matrixWorld);
        const o = (v + k) * 4;
        if (skinned && sIdx && sW && ownBones) {
          for (let j = 0; j < 4; j++) {
            skinIndex[o + j] = boneIndex.get(ownBones[sIdx.getComponent(vi, j)]!) ?? 0;
            skinWeight[o + j] = sW.getComponent(vi, j);
          }
        } else {
          skinIndex[o] = rigidBone;
          skinWeight[o] = 1;
        }
      }
      e1.subVectors(p[1], p[0]);
      e2.subVectors(p[2], p[0]);
      e1.cross(e2).normalize();
      const f = shade(e1.x, e1.y);
      for (let k = 0; k < 3; k++) {
        pos.set([p[k]!.x, p[k]!.y, p[k]!.z], (v + k) * 3);
        col.set([colour.r * f, colour.g * f, colour.b * f], (v + k) * 3);
      }
      v += 3;
    }
  }

  for (const m of meshes) m.removeFromParent();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geometry.computeBoundingBox();

  const merged = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true }),
  );
  src.add(merged);
  src.updateMatrixWorld(true);
  merged.bind(new THREE.Skeleton(bones), new THREE.Matrix4());

  const height = geometry.boundingBox!.max.y - geometry.boundingBox!.min.y;
  const root = new THREE.Group();
  src.scale.setScalar(HEIGHT / height);
  src.position.y = -geometry.boundingBox!.min.y * src.scale.y;
  root.add(src);

  // Drop facial morph tracks; their meshes were merged away.
  const clips = new Map(
    gltf.animations.map((clip) => {
      clip.tracks = clip.tracks.filter((t) => !t.name.endsWith('.morphTargetInfluences'));
      return [clip.name, clip];
    }),
  );
  return { root, clips, triangles: vertCount / 3 };
}

export function cloneCharacter(template: CharacterTemplate): THREE.Object3D {
  return cloneSkinned(template.root);
}
