import { compileMap, loadContent, MAP_FORMAT, type MapFile } from '@mes/shared';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildMap, updateDoors } from './map';

const row = Array<number>(11).fill(0);
const map = compileMap(
  loadContent(
    MAP_FORMAT,
    {
      formatVersion: 4,
      id: 'test',
      name: 'Test',
      environment: { sky: '#9fb3c8', fogNear: 40, fogFar: 120 },
      terrain: {
        origin: [-20, -20],
        cellSize: 4,
        heights: Array.from({ length: 11 }, () => row),
        colour: '#6b8f4e',
      },
      nodes: [
        { type: 'door', id: 'a', pos: [0, 0, 0], size: [1, 2.1], colour: '#4a3520' },
        { type: 'door', id: 'b', pos: [5, 0, 3], yaw: 90, size: [1, 2.1], colour: '#4a3520' },
      ],
      zones: [],
    } satisfies MapFile,
    'test.json',
  ),
  new Map(),
);

/** Each door's points where its own mesh would draw them, from its own geometry and place. */
function ownPoints(mesh: THREE.Mesh): number[] {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++)
    out.push(...v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray());
  return out;
}

describe('doors at rest, merged (2026-11-07)', () => {
  it('draws the doors at rest as one mesh, where each would be, and a moving one by itself', () => {
    const view = buildMap(map);
    const batch = view.doorBatch;
    const closed = [false, false].map((open) => ({ open }));
    updateDoors(view, closed, 1 / 60);
    expect(view.batched).toEqual([true, true]);
    expect(view.doors.map((d) => d.mesh.visible)).toEqual([false, false]);
    const all = [...batch.geometry.getAttribute('position').array];
    const own = view.doors.flatMap((d) => ownPoints(d.mesh));
    all.forEach((x, i) => expect(x).toBeCloseTo(own[i]!, 5));

    // The first opens: it swings by itself, and the batch holds the other.
    const open = [{ open: true }, { open: false }];
    updateDoors(view, open, 1 / 60);
    expect(view.batched).toEqual([false, true]);
    expect(view.doors[0]!.mesh.visible).toBe(true);
    expect(batch.geometry.getAttribute('position').count).toBe(
      view.doors[1]!.mesh.geometry.getAttribute('position').count,
    );

    // Swung open and still: back in the batch, open.
    for (let i = 0; i < 30; i++) updateDoors(view, open, 1 / 60);
    expect(view.batched).toEqual([true, true]);
    const now = [...batch.geometry.getAttribute('position').array];
    const swung = view.doors.flatMap((d) => ownPoints(d.mesh));
    now.forEach((x, i) => expect(x).toBeCloseTo(swung[i]!, 5));
    expect(now).not.toEqual(all);
  });
});
