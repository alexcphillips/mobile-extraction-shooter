import { RAID, type CompiledMap, type CompiledMarker, type HeightGrid } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { bakedMaterial } from './material';

const MARKER_COLOURS: Record<CompiledMarker['type'], number> = {
  playerSpawn: 0x2e86de,
  pmcSpawn: 0x1abc9c,
  enemySpawn: 0xe74c3c,
  lootContainer: 0xf1c40f,
  lootSpawn: 0xf39c12,
  questMarker: 0x9b59b6,
  poi: 0x00cec9,
  zombieSpawn: 0x6ab04c,
  wallBuy: 0xe1b12c,
  mysteryBox: 0x8e44ad,
};
const ZONE_COLOUR = 0xffffff;
/** Extraction zones: light green, flat at their floor's height, with their top. */
const EXTRACTION_COLOUR = 0x9dffb0;
const PATROL_COLOUR = 0xff7675;
/** Half the size of the block loot markers get: small enough to see what's at the spot. */
const LOOT_MARKER = 0.08;

/**
 * Markers as coloured posts (loot markers are just a small block on the spot, so they
 * don't hide what's there), named zones as outlines over the terrain (extraction zones in
 * green, on their floor), and patrols as lines with a ring at each stop. Turned on with
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
    if (m.type === 'lootContainer' || m.type === 'lootSpawn') {
      const r = LOOT_MARKER;
      b.shape({ kind: 'box', x: m.x, y: m.y + r, z: m.z, hx: r, hy: r, hz: r, ...post });
      continue;
    }
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
  }
  if (b.triangles > 0) group.add(new THREE.Mesh(b.build(), bakedMaterial()));

  const line = new THREE.LineBasicMaterial({ color: ZONE_COLOUR });
  const extractLine = new THREE.LineBasicMaterial({ color: EXTRACTION_COLOUR });
  for (const zone of map.zones) {
    const points: THREE.Vector3[] = [];
    const n = zone.points.length;
    const floor = zone.extraction?.y;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = zone.points[i]!;
      const [x1, z1] = zone.points[(i + 1) % n]!;
      // Every 2 m, so the outline follows the hills; an extraction's lies on its floor.
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
      for (let k = 0; k < steps; k++) {
        const x = x0 + ((x1 - x0) * k) / steps;
        const z = z0 + ((z1 - z0) * k) / steps;
        points.push(new THREE.Vector3(x, (floor ?? terrain.heightAt(x, z)) + 0.3, z));
      }
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.LineLoop(geometry, floor === undefined ? line : extractLine));
    // An extraction's top too, and its corners joined: the room it counts in.
    if (floor !== undefined && zone.extraction) {
      const top = floor + (zone.extraction.height ?? RAID.extractHeight);
      const ring = zone.points.map(([x, z]) => new THREE.Vector3(x, top, z));
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), extractLine));
      const posts = zone.points.flatMap(([x, z]) => [
        new THREE.Vector3(x, floor + 0.3, z),
        new THREE.Vector3(x, top, z),
      ]);
      group.add(
        new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(posts), extractLine),
      );
    }
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
