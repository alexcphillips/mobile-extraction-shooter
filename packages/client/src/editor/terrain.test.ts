import { HeightGrid, mapSchema, type MapNode, type PrefabFile } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { findOverlaps, solidsOverlap } from './overlap';
import {
  applyBrush,
  cellRect,
  extendMap,
  holeCells,
  levelCells,
  newMap,
  setHeights,
  terrainDef,
  terrainGrid,
} from './terrain';

const house: PrefabFile = {
  formatVersion: 3,
  id: 'house',
  building: { size: [4, 4] },
  nodes: [{ type: 'box', pos: [0, 0, 0], size: [4, 3, 4], colour: '#ffffff' }],
};
const crate: PrefabFile = {
  formatVersion: 3,
  id: 'crate',
  nodes: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: '#ffffff' }],
};
const prefabs = new Map([
  ['house', house],
  ['crate', crate],
]);

/** A flat 40 m map of 4 m cells, centred on the origin. */
const map = (nodes: MapNode[]) => ({ ...newMap('test', 'Test', 40, 4), nodes });

describe('level and hole', () => {
  it('cover every cell a drag touches, at least one', () => {
    const t = terrainGrid(map([]));
    // Corners at −20, −16 … 20; cell 5 is x 0..4.
    expect(cellRect(t, 1, 1, 1, 1)).toEqual([5, 6, 5, 6]);
    expect(cellRect(t, 1, 1, -3, 9)).toEqual([4, 6, 5, 8]);
    expect(cellRect(t, 1, 1, 100, 100)).toEqual([5, 10, 5, 10]);
    expect(cellRect(t, 100, 1, 1, 1)).toBeNull();
  });

  it('level the corners of the cells, moving what stood on them', () => {
    const m = map([{ type: 'prefab', prefab: 'crate', pos: [2, 0, 2] }]);
    const t = terrainGrid(m);
    levelCells(t, [5, 6, 5, 6], 2.5);
    setHeights(m, t.heights, t.holes, prefabs);
    expect(m.terrain.heights[5]![5]).toBe(2.5);
    expect(m.terrain.heights[6]![6]).toBe(2.5);
    expect(m.terrain.heights[7]![7]).toBe(0);
    expect(m.nodes[0]!.type === 'prefab' && m.nodes[0]!.pos).toEqual([2, 2.5, 2]);
  });

  it('write holes to the map as cells, and drop the field when none are left', () => {
    const m = map([]);
    const t = terrainGrid(m);
    holeCells(t, [5, 7, 2, 3], true);
    setHeights(m, t.heights, t.holes, prefabs);
    expect(m.terrain.holes).toEqual([
      [5, 2],
      [6, 2],
    ]);
    expect(mapSchema.safeParse(m).success).toBe(true);
    expect(terrainGrid(m).holes[2 * 10 + 6]).toBe(1);
    holeCells(t, [0, 10, 0, 10], false);
    setHeights(m, t.heights, t.holes, prefabs);
    expect('holes' in m.terrain).toBe(false);
  });

  it('are checked against the terrain', () => {
    const m = map([]);
    m.terrain.holes = [[10, 0]];
    expect(mapSchema.safeParse(m).success).toBe(false);
  });
});

describe('extending the map', () => {
  it('adds ground on a side at the edge height, keeping the world and holes in place', () => {
    const m = map([{ type: 'prefab', prefab: 'crate', pos: [2, 0, 2] }]);
    // A slope along x, and one hole at cell (5, 5): x 0..4, z 0..4.
    m.terrain.heights = m.terrain.heights.map((row) => row.map((_, i) => i));
    m.terrain.holes = [[5, 5]];
    const before = new HeightGrid(terrainDef(m));
    extendMap(m, 'west', 2);
    extendMap(m, 'north', 3);
    extendMap(m, 'east', 1);
    extendMap(m, 'south', 1);
    expect(m.terrain.origin).toEqual([-28, -32]);
    expect(m.terrain.heights[0]!.length).toBe(11 + 3);
    expect(m.terrain.heights.length).toBe(11 + 4);
    expect(m.terrain.holes).toEqual([[7, 8]]);
    expect(mapSchema.safeParse(m).success).toBe(true);
    const after = new HeightGrid(terrainDef(m));
    for (const [x, z] of [
      [-20, -20],
      [1.5, 3],
      [20, 20],
      [-7, 11],
    ] as const)
      expect(after.heightAt(x, z)).toBeCloseTo(before.heightAt(x, z));
    expect(after.holeAt(2, 2)).toBe(true);
    expect(after.holeAt(6, 2)).toBe(false);
    // The new ground carries on the edges: 0 to the west, 10 to the east.
    expect(after.heightAt(-26, 0)).toBe(0);
    expect(after.heightAt(23, 0)).toBe(10);
    expect(after.heightAt(0, -30)).toBe(5);
    expect(m.nodes[0]!.type === 'prefab' && m.nodes[0]!.pos).toEqual([2, 0, 2]);
  });
});

describe('brushes', () => {
  it('raise most in the middle, nothing outside the radius', () => {
    const t = terrainGrid(map([]));
    const changed = applyBrush(
      t,
      { mode: 'raise', radius: 6, strength: 2, height: null },
      0,
      0,
      0.5,
      0,
    );
    expect(changed).toEqual([4, 6, 4, 6]);
    const at = (i: number, j: number) => t.heights[j * 11 + i]!;
    expect(at(5, 5)).toBeCloseTo(1);
    expect(at(6, 5)).toBeGreaterThan(0);
    expect(at(6, 5)).toBeLessThan(1);
    expect(at(7, 5)).toBe(0);
  });

  it('flatten towards the level and smooth towards the neighbours', () => {
    const t = terrainGrid(map([]));
    t.heights[5 * 11 + 5] = 4;
    applyBrush(t, { mode: 'smooth', radius: 2, strength: 1, height: null }, 0, 0, 1, 0);
    expect(t.heights[5 * 11 + 5]).toBeCloseTo(0);
    t.heights[5 * 11 + 5] = 4;
    applyBrush(t, { mode: 'flatten', radius: 2, strength: 1, height: null }, 0, 0, 0.1, 1);
    expect(t.heights[5 * 11 + 5]).toBeCloseTo(4 - 3 * 0.4);
  });

  it('do nothing off the terrain', () => {
    const t = terrainGrid(map([]));
    expect(
      applyBrush(t, { mode: 'raise', radius: 2, strength: 1, height: null }, 100, 0, 1, 0),
    ).toBeNull();
  });
});

describe('setHeights', () => {
  it('rounds to a centimetre and moves what stood on the ground, not buildings', () => {
    const m = map([
      { type: 'prefab', prefab: 'crate', pos: [0, 0, 0] },
      { type: 'prefab', prefab: 'crate', pos: [0, 2, 0] },
      { type: 'prefab', id: 'home', prefab: 'house', pos: [0, 0, 0] },
      {
        type: 'group',
        pos: [4, 0, 0],
        yaw: 90,
        nodes: [{ type: 'lootSpawn', lootTable: 'household', pos: [0, 0, 4] }],
      },
      { type: 'patrol', id: 'walk', points: [[0, 0, 0], { pos: [8, 0, 8], wait: 2 }] },
    ]);
    const t = terrainGrid(m);
    // Corner (5, 5) is at the origin and (7, 5) at x = 8, the group's spawn in the world.
    t.heights[5 * 11 + 5] = 1.234;
    t.heights[5 * 11 + 7] = 0.5;
    setHeights(m, t.heights, t.holes, prefabs);
    expect(m.terrain.heights[5]![5]).toBe(1.23);
    const [c1, c2, h, g, p] = m.nodes as [MapNode, MapNode, MapNode, MapNode, MapNode];
    expect(c1.type === 'prefab' && c1.pos).toEqual([0, 1.23, 0]);
    // Up in the air, so it stays.
    expect(c2.type === 'prefab' && c2.pos).toEqual([0, 2, 0]);
    expect(h.type === 'prefab' && h.pos).toEqual([0, 0, 0]);
    expect(g.type === 'group' && g.nodes[0]!.type === 'lootSpawn' && g.nodes[0]!.pos).toEqual([
      0, 0.5, 4,
    ]);
    expect(p.type === 'patrol' && p.points).toEqual([[0, 1.23, 0], { pos: [8, 0, 8], wait: 2 }]);
  });
});

describe('newMap', () => {
  it('is a valid map of flat ground with a spawn', () => {
    const m = newMap('fresh', 'Fresh', 128, 2);
    expect(mapSchema.safeParse(m).success).toBe(true);
    expect(m.terrain.heights).toHaveLength(65);
    expect(m.terrain.origin).toEqual([-64, -64]);
  });
});

describe('overlaps', () => {
  it('count cutting in, not touching', () => {
    const a = { x: 0, z: 0, yaw: 0, hx: 1, hz: 1, y0: 0, y1: 1 };
    expect(solidsOverlap(a, { ...a, x: 2 }, 0.05)).toBe(false);
    expect(solidsOverlap(a, { ...a, x: 1.9 }, 0.05)).toBe(true);
    expect(solidsOverlap(a, { ...a, y0: 1, y1: 2 }, 0.05)).toBe(false);
    // Turned 45°, its corner reaches √2 out.
    expect(solidsOverlap(a, { ...a, x: 2.3, yaw: Math.PI / 4 }, 0.05)).toBe(true);
    expect(solidsOverlap(a, { ...a, x: 2.5, yaw: Math.PI / 4 }, 0.05)).toBe(false);
  });

  it("don't count joints: cuts thin on two axes", () => {
    const wall = { x: 0, z: 0, yaw: 0, hx: 2, hz: 0.1, y0: 0, y1: 3 };
    // Another wall meeting it at a corner: 0.2 by 0.2 across, 3 m tall.
    const corner = { x: 1.9, z: 1.9, yaw: 0, hx: 0.1, hz: 2, y0: 0, y1: 3 };
    expect(solidsOverlap(wall, corner, 0.05, 0.45)).toBe(false);
    expect(solidsOverlap(wall, corner, 0.05)).toBe(true);
    // Turned a quarter, the same corner in the other wall's frame.
    expect(solidsOverlap(wall, { ...corner, hx: 2, hz: 0.1, yaw: Math.PI / 2 }, 0.05, 0.45)).toBe(
      false,
    );
    // A floor slab the wall stands through: thin in y and z.
    const slab = { x: 0, z: 0, yaw: 0, hx: 5, hz: 5, y0: 1, y1: 1.3 };
    expect(solidsOverlap(wall, slab, 0.05, 0.45)).toBe(false);
    // A crate cut half into another is deep on every axis.
    const crate = { x: 0, z: 0, yaw: 0, hx: 0.5, hz: 0.5, y0: 0, y1: 1 };
    expect(solidsOverlap(crate, { ...crate, x: 0.5 }, 0.05, 0.45)).toBe(true);
  });

  it('find props cutting into each other and buildings whose footprints overlap', () => {
    const o = findOverlaps(
      map([
        { type: 'prefab', prefab: 'house', pos: [0, 0, 0] },
        { type: 'prefab', prefab: 'house', pos: [3, 5, 0], yaw: 90 },
        { type: 'prefab', prefab: 'crate', pos: [10, 0, 0] },
        {
          type: 'group',
          pos: [10, 0, 0],
          nodes: [{ type: 'prefab', prefab: 'crate', pos: [0.5, 0, 0] }],
        },
        { type: 'prefab', prefab: 'crate', pos: [11.5, 0, 0] },
      ]),
      prefabs,
    );
    // Stacked above the first house, the second still overlaps it on the ground.
    expect(o.buildings).toEqual([[[0], [1]]]);
    expect(o.props).toEqual([[[2], [3, 0]]]);
    expect(o.buried).toEqual([]);
  });

  it('find buildings with the ground through the floor', () => {
    const m = map([{ type: 'prefab', prefab: 'house', pos: [0, 0, 0] }]);
    const t = terrainGrid(m);
    t.heights[5 * 11 + 5] = 0.5;
    setHeights(m, t.heights, t.holes, prefabs);
    expect(findOverlaps(m, prefabs).buried).toEqual([[0]]);
  });
});
