import { CollisionWorld, createWeapon, type CompiledMap, type ItemDb } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { gunModel } from './gun-model';
import { shadedMaterial } from './material';

/** How high a wall gun hangs above its marker. */
const HANG = 1.4;
/** How far behind its marker a wall is looked for; with none, the gun hangs this far back. */
const WALL_SEARCH = 2;
/** A hair off the wall's face, so the two never flicker into each other. */
const OFF_WALL = 0.01;

/**
 * Zombies mode's wall guns (2026-11-04): each wallBuy marker's gun, from its model, hung
 * side-on flat against the face of the wall behind the marker (found with a ray, so the
 * marker needn't be exactly on it). Built once, as one mesh: one draw call for them all.
 */
export function buildWallBuys(map: CompiledMap, items: ItemDb, world: CollisionWorld): THREE.Group {
  const root = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const marker of map.markers) {
    if (marker.type !== 'wallBuy' || items.get(marker.item)?.type !== 'weapon') continue;
    const b = new TriangleBuilder(false);
    for (const s of gunModel(createWeapon(items, marker.item), items).shapes) b.shape(s);
    const gun = b.build();
    // Barrel along the wall (local −z to +x), its side facing out into the room, its back
    // on z = 0.
    gun.rotateY(-Math.PI / 2);
    gun.computeBoundingBox();
    const box = gun.boundingBox!;
    gun.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
    // Out of the wall is the marker's +z, so the wall is towards its −z.
    const yaw = marker.yaw;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const y = marker.y + HANG;
    const hit = world.raycast(marker.x, y, marker.z, dx, 0, dz, WALL_SEARCH);
    const d = (hit === Infinity ? WALL_SEARCH : hit) - OFF_WALL;
    m.compose(
      new THREE.Vector3(marker.x + dx * d, y, marker.z + dz * d),
      q.setFromAxisAngle(up, yaw),
      ONE,
    );
    gun.applyMatrix4(m);
    parts.push(gun);
  }
  if (!parts.length) return root;
  root.add(new THREE.Mesh(merge(parts), shadedMaterial()));
  return root;
}

/** Joins non-indexed geometries with position, normal and color into one. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const n = parts.reduce((k, p) => k + p.getAttribute('position').count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = new Float32Array(n * 3);
    let at = 0;
    for (const p of parts) {
      const src = p.getAttribute(name).array as Float32Array;
      a.set(src, at);
      at += src.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(a, 3));
  }
  for (const p of parts) p.dispose();
  return out;
}

const ONE = new THREE.Vector3(1, 1, 1);
