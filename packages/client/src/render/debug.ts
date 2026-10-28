import type { CompiledMap, CompiledMarker, HeightGrid } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { bakedMaterial } from './material';

const MARKER_COLOURS: Record<CompiledMarker['type'], number> = {
  playerSpawn: 0x2e86de,
  enemySpawn: 0xe74c3c,
  lootContainer: 0xf1c40f,
  lootSpawn: 0xf39c12,
  extraction: 0x2ecc71,
  questMarker: 0x9b59b6,
};
const ZONE_COLOUR = 0xffffff;
const PATROL_COLOUR = 0xff7675;

/**
 * Markers as coloured posts (extractions also get a disc of their radius), named zones as
 * outlines over the terrain, and patrols as lines with a ring at each stop. Turned on with
 * ?debug in the URL, and drawn in the map editor.
 */
export function buildDebug(
  map: Pick<CompiledMap, 'markers' | 'patrols' | 'zones'>,
  terrain: HeightGrid,
): THREE.Group {
  const group = new THREE.Group();
  const b = new TriangleBuilder(true);
  for (const m of map.markers) {
    const colour = MARKER_COLOURS[m.type];
    const post = { yaw: m.yaw, pitch: 0, roll: 0, colour };
    b.shape({ kind: 'box', x: m.x, y: m.y + 1, z: m.z, hx: 0.1, hy: 1, hz: 0.1, ...post });
    // A flag pointing the marker's way.
    const fx = -Math.sin(m.yaw) * 0.3;
    const fz = -Math.cos(m.yaw) * 0.3;
    b.shape({
      kind: 'box',
      x: m.x + fx,
      y: m.y + 1.8,
      z: m.z + fz,
      hx: 0.05,
      hy: 0.15,
      hz: 0.3,
      ...post,
    });
    if (m.type === 'extraction') {
      b.shape({
        kind: 'cylinder',
        x: m.x,
        y: m.y + 0.05,
        z: m.z,
        radius: m.radius,
        radiusTop: m.radius,
        hy: 0.05,
        sides: 24,
        ...post,
      });
    }
  }
  if (b.triangles > 0) group.add(new THREE.Mesh(b.build(), bakedMaterial()));

  const line = new THREE.LineBasicMaterial({ color: ZONE_COLOUR });
  for (const zone of map.zones) {
    const points: THREE.Vector3[] = [];
    const n = zone.points.length;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = zone.points[i]!;
      const [x1, z1] = zone.points[(i + 1) % n]!;
      // Every 2 m, so the outline follows the hills.
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
      for (let k = 0; k < steps; k++) {
        const x = x0 + ((x1 - x0) * k) / steps;
        const z = z0 + ((z1 - z0) * k) / steps;
        points.push(new THREE.Vector3(x, terrain.heightAt(x, z) + 0.3, z));
      }
    }
    group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), line));
  }

  const patrolLine = new THREE.LineBasicMaterial({ color: PATROL_COLOUR });
  for (const p of map.patrols) {
    const points = p.points.map(({ x, y, z }) => new THREE.Vector3(x, y + 0.2, z));
    // The way in, then the repeating part (closed if it loops).
    const way = points.slice(0, p.repeatFrom + 1);
    if (way.length > 1)
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(way), patrolLine));
    const repeat = new THREE.BufferGeometry().setFromPoints(points.slice(p.repeatFrom));
    group.add(p.loop ? new THREE.LineLoop(repeat, patrolLine) : new THREE.Line(repeat, patrolLine));
    // A ring round each stop: its radius, or a small one.
    for (const q of p.points) {
      if (q.wait <= 0 && q.radius <= 0) continue;
      const r = Math.max(q.radius, 0.4);
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        ring.push(new THREE.Vector3(q.x + Math.cos(a) * r, q.y + 0.2, q.z + Math.sin(a) * r));
      }
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), patrolLine));
    }
  }
  return group;
}
