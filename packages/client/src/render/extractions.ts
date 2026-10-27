import type { CompiledMap } from '@mes/shared';
import * as THREE from 'three';

const COLOUR = 0x6cff8a;
const HEIGHT = 12;
const SIDES = 24;

/**
 * Extraction points as faint green columns of their radius, so you can find them until
 * the map tab (session 11b). Open-ended tubes in one mesh: one draw call for them all.
 * See-through and unlit, faded by fog like everything else.
 */
export function buildExtractions(map: CompiledMap): THREE.Mesh {
  const positions: number[] = [];
  for (const m of map.markers) {
    if (m.type !== 'extraction') continue;
    for (let i = 0; i < SIDES; i++) {
      const a0 = (i / SIDES) * Math.PI * 2;
      const a1 = ((i + 1) / SIDES) * Math.PI * 2;
      const x0 = m.x + Math.cos(a0) * m.radius;
      const z0 = m.z + Math.sin(a0) * m.radius;
      const x1 = m.x + Math.cos(a1) * m.radius;
      const z1 = m.z + Math.sin(a1) * m.radius;
      const y0 = m.y - 1;
      const y1 = m.y + HEIGHT;
      positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: COLOUR,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  // After the opaque world, so it shows through nothing but blends over what's behind.
  mesh.renderOrder = 1;
  return mesh;
}
