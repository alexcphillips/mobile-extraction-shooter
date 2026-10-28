import { compileMap, type MapFile, type MapNode } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import {
  collectIds,
  copyNode,
  groupNodes,
  moveWith,
  nodeAt,
  nodesAt,
  placeNode,
  toLocal,
  toParent,
  ungroup,
  uniqueId,
} from './doc';

function map(nodes: MapNode[]): MapFile {
  const row = Array<number>(11).fill(0);
  return {
    formatVersion: 3,
    id: 'test',
    name: 'Test',
    environment: { sky: '#9fb3c8', fogNear: 40, fogFar: 120 },
    terrain: {
      origin: [-20, -20],
      cellSize: 4,
      heights: Array.from({ length: 11 }, () => row),
      colour: '#6b8f4e',
    },
    nodes,
    zones: [],
  };
}

const box = (x: number, z: number, yaw?: number): MapNode => ({
  type: 'box',
  pos: [x, 0, z],
  ...(yaw !== undefined && { yaw }),
  size: [1, 1, 1],
  colour: '#ffffff',
});

/** Where everything ends up in the world, which grouping must not change. */
const world = (m: MapFile) => {
  const c = compileMap(m, new Map());
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    boxes: c.world.boxes.map((b) => [r(b.x), r(b.y), r(b.z), r(b.yaw)]),
    markers: c.markers.map((k) => [k.id, r(k.x), r(k.z), r(k.yaw)]),
    patrols: c.patrols.map((p) => p.points.map((q) => [r(q.x), r(q.z)])),
  };
};

describe('map editing', () => {
  it('turns positions into and out of a frame', () => {
    const p = toParent([1, 2, 0], [10, 0, 5], 90);
    expect(p.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([10, 2, 4]);
    expect(toLocal(p, [10, 0, 5], 90).map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([1, 2, 0]);
  });

  it('groups and ungroups without moving anything in the world', () => {
    const m = map([
      box(0, 0),
      box(4, 2, 30),
      { type: 'playerSpawn', id: 'start', pos: [2, 1, 6], yaw: 45 },
      { type: 'patrol', id: 'walk', points: [[0, 0, 0], { pos: [4, 0, 4], wait: 2 }] },
      { type: 'questMarker', id: 'radio', pos: [9, 0, 9] },
    ]);
    const before = world(m);
    expect(groupNodes(m.nodes, [3, 1, 2], 'Yard')).toBe(1);
    expect(m.nodes.map((n) => n.type)).toEqual(['box', 'group', 'questMarker']);
    const g = m.nodes[1] as Extract<MapNode, { type: 'group' }>;
    expect(g).toMatchObject({ name: 'Yard', pos: [2, 0, 2.667] });
    expect(world(m)).toEqual(before);

    // Turned as a group: still all one piece, then back out in the right places.
    placeNode(g, [10, 0, 0], 90);
    const turned = world(m);
    expect(ungroup(m.nodes, 1)).toEqual([1, 2, 3]);
    expect(world(m)).toEqual(turned);
    expect(m.nodes[1]).toMatchObject({ type: 'box', yaw: 120 });
  });

  it('finds nodes by path through groups', () => {
    const m = map([box(0, 0), { type: 'group', pos: [0, 0, 0], nodes: [box(1, 1), box(2, 2)] }]);
    expect(nodesAt(m, [1])).toHaveLength(2);
    expect(nodeAt(m, [1, 1])).toMatchObject({ pos: [2, 0, 2] });
    expect(nodeAt(m, [0, 0])).toBeUndefined();
    expect(() => nodesAt(m, [0])).toThrow();
  });

  it('moves a patrol by its first point, and keeps tidy numbers', () => {
    const n: MapNode = { type: 'patrol', id: 'p', points: [[1, 0, 1], { pos: [3, 0, 1] }] };
    placeNode(n, [1.1 + 0.2, 0, 1]);
    expect(n.points).toEqual([[1.3, 0, 1], { pos: [3.3, 0, 1] }]);
    const b = box(0, 0);
    placeNode(b, [0, 0, 0], 360 + 15);
    expect(b).toMatchObject({ yaw: 15 });
    placeNode(b, [0, 0, 0], 360);
    expect(b).not.toHaveProperty('yaw');
  });

  it('copies with ids unique across groups, and a spawn follows its copied patrol', () => {
    const g: MapNode = {
      type: 'group',
      pos: [0, 0, 0],
      nodes: [
        { type: 'enemySpawn', id: 'guard', pos: [0, 0, 0], enemy: 'scav', patrol: 'route' },
        {
          type: 'patrol',
          id: 'route',
          points: [
            [0, 0, 0],
            [1, 0, 0],
          ],
        },
      ],
    };
    const m = map([g, { type: 'questMarker', id: 'guard-2', pos: [0, 0, 0] }]);
    const taken = collectIds(m.nodes);
    expect([...taken].sort()).toEqual(['guard', 'guard-2', 'route']);
    const copy = copyNode(g, taken) as typeof g;
    expect(copy.nodes).toMatchObject([{ id: 'guard-3', patrol: 'route-2' }, { id: 'route-2' }]);
    expect(uniqueId('crate', new Set())).toBe('crate');
    m.nodes.push(copy);
    expect(() => compileMap(m, new Map())).not.toThrow();
  });

  it('moves and turns nodes with the gizmo, patrols as one piece', () => {
    const n: MapNode = { type: 'patrol', id: 'p', points: [[0, 0, 0], { pos: [0, 0, -2] }] };
    // Turned 90° about its first point and moved 5 m along x: −z turns to −x.
    moveWith(n, [0, 0, 0], [5, 0, 0], 90);
    expect(n.points).toEqual([[5, 0, 0], { pos: [3, 0, 0] }]);
    const b = box(2, 0, 10);
    moveWith(b, [0, 0, 0], [0, 1, 0], 90);
    expect(b).toMatchObject({ pos: [0, 1, -2], yaw: 100 });
  });
});
