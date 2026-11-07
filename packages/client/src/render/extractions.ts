import type { ExtractionPoint } from '@mes/shared';
import * as THREE from 'three';

/** Light green, and a short band: it marks where the zone is without hiding the ground. */
const COLOUR = 0x9dffb0;
/** How tall the band is, from just over the floor. */
const BAND = 0.25;
const LIFT = 0.03;

/**
 * The raid's open extraction points (a rotating one only when this raid opened it) as a
 * thin light-green band round their outline, on their floor (the user's call, 2026-11-07:
 * a border, no fill, and short whatever the zone's height), so you can find them; kept
 * alongside the map tab. Open-ended, in one mesh: one draw call for them all.
 * See-through and unlit, faded by fog like everything else.
 */
export function buildExtractions(open: readonly ExtractionPoint[]): THREE.Mesh {
  const positions: number[] = [];
  for (const p of open) {
    const y0 = p.y + LIFT;
    const y1 = y0 + BAND;
    const n = p.points.length;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = p.points[i]!;
      const [x1, z1] = p.points[(i + 1) % n]!;
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
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  // After the opaque world, so it shows through nothing but blends over what's behind.
  mesh.renderOrder = 1;
  return mesh;
}
