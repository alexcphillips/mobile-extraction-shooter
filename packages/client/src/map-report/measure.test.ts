import { CollisionWorld, compileMap, NavGrid, type MapFile, type MapNode } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { measureMap } from './measure';

// The map report's measures (MK-4) on a small field built for it: a spawn, a crate to climb
// onto a block, a tower with a ladder and no rail, and open ground.
function field(nodes: MapNode[]): MapFile {
  const row = Array<number>(31).fill(0);
  return {
    formatVersion: 4,
    id: 'test',
    name: 'Test',
    environment: { sky: '#9fb3c8', fogNear: 40, fogFar: 120 },
    terrain: {
      origin: [-60, -60],
      cellSize: 4,
      heights: Array.from({ length: 31 }, () => row),
      color: '#6b8f4e',
    },
    nodes,
    zones: [],
  };
}

const grey = '#808080';
const nodes: MapNode[] = [
  { type: 'playerSpawn', pos: [0, 0, 0] },
  { type: 'mapLabel', pos: [0, 0, 0], text: 'Field', size: 'area' },
  // Crate (1.2 m), then a block (2.6 m): a perch a player climbs onto and the AI doesn't.
  { type: 'box', pos: [-20, 0, 0], size: [1.4, 1.2, 1.4], color: grey },
  { type: 'box', pos: [-22, 0, 0], size: [3, 2.6, 3], color: grey },
  // A tower 6 m high with a ladder on its south face: a perch by ladder, and a drop.
  { type: 'box', pos: [20, 0, 20], size: [4, 6, 4], color: grey },
  { type: 'ladder', pos: [20, 0, 22], yaw: 0, height: 6, color: grey },
];

describe('measureMap', () => {
  const map = compileMap(field(nodes), new Map());
  const world = new CollisionWorld(map.world);
  const nav = new NavGrid(world);
  const m = measureMap(map, world, nav);

  it('finds the perches and how a player gets onto each', () => {
    const block = m.perches.find((p) => Math.abs(p.x + 22) < 2 && Math.abs(p.z) < 2);
    const tower = m.perches.find((p) => Math.abs(p.x - 20) < 2 && Math.abs(p.z - 20) < 2);
    expect(block?.reach).toBe('climb');
    expect(block?.above).toBeCloseTo(2.6, 1);
    expect(tower?.reach).toBe('ladder');
    expect(tower?.above).toBeCloseTo(6, 1);
  });

  it('finds the drop off the tower, from ground only a player gets onto', () => {
    const drop = m.drops.find((d) => Math.abs(d.x - 20) < 4 && Math.abs(d.z - 20) < 4);
    expect(drop?.drop).toBeCloseTo(6, 1);
    expect(drop?.ai).toBe(false);
    // Nothing off the 2.6 m block: under the 3.3 m that costs health.
    expect(m.drops.some((d) => Math.abs(d.x + 22) < 4)).toBe(false);
  });

  it('measures open ground: the field is open, with runs far over 40 m', () => {
    const a = m.areas[0]!;
    expect(a.name).toBe('Field');
    expect(a.openRun.length).toBeGreaterThan(100);
    expect(a.openCircle.d).toBeGreaterThan(40);
    expect(a.overCap).toBeGreaterThan(5000);
    // A look sees 70 m wherever the map's edge (120 m across) is that far: about a third.
    expect(a.outdoor70 / a.outdoor).toBeGreaterThan(0.3);
    expect(a.outdoor30 / a.outdoor).toBeGreaterThan(0.6);
  });

  it('keeps the play edge: nothing outside is reached', () => {
    expect(m.escapes).toEqual([]);
    expect(m.mainShare).toBeGreaterThan(0.9);
  });
});
