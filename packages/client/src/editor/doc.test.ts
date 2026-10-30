import { compileMap, type MapFile, type MapNode, type PrefabFile } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import {
  collectIds,
  copyNode,
  countPlacements,
  groupNodes,
  insertPatrolPoint,
  makePrefab,
  markerPath,
  movePatrolPoint,
  moveWith,
  nodeAt,
  nodesAt,
  patrolIds,
  placeNode,
  removePatrolPoint,
  scopePrefabs,
  setPatrolStop,
  toLocal,
  toParent,
  ungroup,
  unpackPrefab,
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
const world = (m: MapFile, prefabs: ReadonlyMap<string, PrefabFile> = new Map()) => {
  const c = compileMap(m, prefabs);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    boxes: c.world.boxes.map((b) => [r(b.x), r(b.y), r(b.z), r(b.yaw)]),
    colours: c.shapes.map((s) => s.colour),
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

describe('prefabs in the editor', () => {
  const shed: PrefabFile = {
    formatVersion: 3,
    id: 'shed',
    colours: { walls: '#aa0000', roof: '#00aa00' },
    building: { size: [2, 2] },
    nodes: [
      { type: 'box', pos: [0, 0, 0], size: [2, 2, 2], colour: 'walls' },
      { type: 'box', pos: [0, 2, 0], size: [2, 0.2, 2], colour: 'roof' },
      { type: 'lootSpawn', id: 'shelf', pos: [0, 1, 0], lootTable: 'household' },
    ],
  };

  it('makes a prefab of what is selected, leaving the world as it was', () => {
    const m = map([
      box(-5, 0),
      { type: 'box', pos: [4, 0, 2], yaw: 30, size: [1, 2, 1], colour: 'paint' },
      { type: 'box', pos: [6, 1, 2], size: [1, 1, 1], colour: '#123456' },
      { type: 'questMarker', id: 'radio', pos: [5, 1, 3] },
    ]);
    m.colours = { paint: '#336699', unused: '#000000' };
    const before = world(m);
    const taken = collectIds(m.nodes);
    const { prefab, index } = makePrefab(m.nodes, [3, 1, 2], 'well', 'Well', m.colours, taken);
    expect(index).toBe(1);
    // Only the slots it uses come along, and the placement passes the map's on.
    expect(prefab).toMatchObject({ id: 'well', name: 'Well', colours: { paint: '#336699' } });
    expect(prefab.nodes).toHaveLength(3);
    expect(m.nodes[1]).toEqual({
      type: 'prefab',
      id: 'well',
      prefab: 'well',
      pos: [5, 0, 2.333],
      colours: { paint: 'paint' },
    });
    const prefabs = new Map([['well', prefab]]);
    const after = world(m, prefabs);
    expect(after.boxes).toEqual(before.boxes);
    expect(after.colours).toEqual(before.colours);
    // Ids inside a prefab come out under the placement's.
    expect(after.markers).toEqual([['well/radio', 5, 3, 0]]);
    expect(before.markers).toEqual([['radio', 5, 3, 0]]);
  });

  it('gives a placement no id when nothing in it has one', () => {
    const m = map([box(0, 0), box(2, 0)]);
    makePrefab(m.nodes, [0, 1], 'pair', '', {}, new Set());
    expect(m.nodes).toEqual([{ type: 'prefab', prefab: 'pair', pos: [1, 0, 0] }]);
  });

  it('unpacks a placement into a group, colours and all, with ids made unique', () => {
    const m = map([
      { type: 'questMarker', id: 'shelf', pos: [20, 0, 20] },
      {
        type: 'prefab',
        id: 'shed-a',
        prefab: 'shed',
        pos: [10, 0, 5],
        yaw: 90,
        colours: { walls: '#0000ff' },
      },
    ]);
    const prefabs = new Map([['shed', shed]]);
    const before = world(m, prefabs);
    unpackPrefab(m.nodes, 1, shed, collectIds(m.nodes));
    expect(m.nodes[1]).toMatchObject({ type: 'group', name: 'shed-a', pos: [10, 0, 5], yaw: 90 });
    const g = m.nodes[1] as Extract<MapNode, { type: 'group' }>;
    expect(g.nodes).toMatchObject([
      { colour: '#0000ff' },
      { colour: '#00aa00' },
      { id: 'shelf-2' },
    ]);
    const after = world(m, new Map());
    // The same boxes, less the concrete base (a group isn't a building).
    expect(after.boxes).toEqual(before.boxes.slice(0, 2));
    expect(after.colours).toEqual(before.colours.slice(0, after.colours.length));
    // The prefab itself is left as it was.
    expect(shed.nodes[0]).toMatchObject({ colour: 'walls' });
  });

  it('finds nodes inside placed prefabs, and counts the copies', () => {
    const yard: PrefabFile = {
      formatVersion: 3,
      id: 'yard',
      nodes: [box(0, 0), { type: 'prefab', prefab: 'shed', pos: [3, 0, 0] }],
    };
    const prefabs = new Map([
      ['shed', shed],
      ['yard', yard],
    ]);
    const m = map([
      { type: 'prefab', prefab: 'yard', pos: [0, 0, 0] },
      {
        type: 'group',
        pos: [0, 0, 0],
        nodes: [{ type: 'prefab', prefab: 'shed', pos: [9, 0, 9] }],
      },
    ]);
    expect(nodesAt(m, [0], prefabs)).toBe(yard.nodes);
    expect(nodesAt(m, [0, 1], prefabs)).toBe(shed.nodes);
    expect(nodeAt(m, [0, 1, 2], prefabs)).toMatchObject({ id: 'shelf' });
    // Without the prefabs, a path only goes through groups.
    expect(() => nodesAt(m, [0])).toThrow();
    expect(scopePrefabs(m, [0, 1], prefabs).map((s) => [s.prefab.id, s.path])).toEqual([
      ['yard', [0]],
      ['shed', [0, 1]],
    ]);
    expect(countPlacements(m.nodes, 'shed', prefabs)).toBe(2);
    expect(countPlacements(m.nodes, 'yard', prefabs)).toBe(1);
  });
});

describe('markerPath', () => {
  it("finds the node a compiled marker's id names, through groups", () => {
    const m = map([
      { type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: '#ffffff' },
      {
        type: 'group',
        pos: [5, 0, 0],
        nodes: [
          { type: 'playerSpawn', id: 'spawn', pos: [0, 0, 0] },
          { type: 'enemySpawn', pos: [1, 0, 0], enemy: 'scav' },
        ],
      },
    ]);
    for (const marker of compileMap(m, new Map()).markers)
      expect(nodeAt(m, markerPath(m, marker.id)!)).toMatchObject({ type: marker.type });
    expect(markerPath(m, 'missing')).toBeNull();
  });
});

describe('patrol points', () => {
  const patrol = (): Extract<MapNode, { type: 'patrol' }> => ({
    type: 'patrol',
    id: 'p',
    points: [[0, 0, 0], { pos: [1, 0, 0], wait: 5 }, [2, 0, 0], [3, 0, 0]],
    repeatFrom: 1,
  });

  it('moves a point and keeps it a stop', () => {
    const p = patrol();
    movePatrolPoint(p, 1, [4.00001, 1, 2]);
    expect(p.points[1]).toEqual({ pos: [4, 1, 2], wait: 5 });
  });

  it('keeps the same points repeating when points go in or come out', () => {
    const p = patrol();
    insertPatrolPoint(p, 0, [9, 0, 9]);
    expect(p.repeatFrom).toBe(2);
    insertPatrolPoint(p, p.points.length, [8, 0, 8]);
    expect(p.repeatFrom).toBe(2);
    expect(removePatrolPoint(p, 0)).toBe(true);
    expect(p.repeatFrom).toBe(1);
    expect(p.points[1]).toEqual({ pos: [1, 0, 0], wait: 5 });
  });

  it('leaves at least two points, two of them repeating', () => {
    const p = patrol();
    p.repeatFrom = 2;
    removePatrolPoint(p, 3);
    expect(p.repeatFrom).toBe(1);
    removePatrolPoint(p, 2);
    expect(p.repeatFrom).toBeUndefined();
    expect(removePatrolPoint(p, 0)).toBe(false);
    expect(p.points).toHaveLength(2);
  });

  it('makes a point a stop or a walk-through, leaving defaults out', () => {
    const p = patrol();
    setPatrolStop(p, 0, { wait: 3, radius: 2 });
    expect(p.points[0]).toEqual({ pos: [0, 0, 0], radius: 2 });
    setPatrolStop(p, 1, null);
    expect(p.points[1]).toEqual([1, 0, 0]);
  });

  it('finds patrols inside groups', () => {
    const nodes: MapNode[] = [
      patrol(),
      { type: 'group', pos: [0, 0, 0], nodes: [{ ...patrol(), id: 'q' }] },
    ];
    expect(patrolIds(nodes)).toEqual(['p', 'q']);
  });
});
