import { describe, expect, it } from 'vitest';
import { CollisionWorld, type BoxDef, type WorldDef } from '../world/collision-world';
import { CellWalk } from '../world/grid';
import { HeightGrid } from '../world/terrain';
import { NavGrid } from './nav-grid';
import { findPath, straight } from './path';

function makeWorld(parts: Partial<WorldDef> = {}): CollisionWorld {
  return new CollisionWorld({
    terrain: { minX: -20, minZ: -20, cellSize: 4, cols: 10, rows: 10, heights: Array(121).fill(0) },
    boxes: [],
    ramps: [],
    ladders: [],
    ...parts,
  });
}

function aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BoxDef {
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    z: (z0 + z1) / 2,
    hx: (x1 - x0) / 2,
    hy: (y1 - y0) / 2,
    hz: (z1 - z0) / 2,
    yaw: 0,
  };
}

/** A path's waypoints as [x, y, z] triples. */
function points(path: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < path.length; i += 3) out.push(path.slice(i, i + 3));
  return out;
}

function route(nav: NavGrid, a: number[], b: number[]): { result: string; pts: number[][] } {
  const out: number[] = [];
  const result = findPath(
    nav,
    nav.nearest(a[0]!, a[1]!, a[2]!),
    nav.nearest(b[0]!, b[1]!, b[2]!),
    out,
  );
  return { result, pts: points(out) };
}

/** How many nodes the column at (x, z) has. */
function layersAt(nav: NavGrid, x: number, z: number): number {
  const c =
    Math.floor((z - nav.minZ) / nav.cellSize) * nav.cols +
    Math.floor((x - nav.minX) / nav.cellSize);
  return nav.columnStart[c + 1]! - nav.columnStart[c]!;
}

/** Length of a path across the ground. */
function length(pts: number[][]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++)
    sum += Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![2]! - pts[i - 1]![2]!);
  return sum;
}

describe('NavGrid', () => {
  it('covers open ground with one layer, apart from the map edge', () => {
    const nav = new NavGrid(makeWorld());
    expect(nav.cols).toBe(80);
    // Columns within a body's radius of the edge are left out.
    expect(nav.nodeCount).toBe(78 * 78);
    expect(nav.componentSizes).toEqual([78 * 78]);
    const n = nav.nearest(1.1, 0, 2.2);
    expect(nav.nodeX(n)).toBeCloseTo(1.25);
    expect(nav.nodeZ(n)).toBeCloseTo(2.25);
    expect(nav.nodeY(n)).toBe(0);
  });

  it('leaves out walls with room around them, but not low steps', () => {
    const nav = new NavGrid(
      makeWorld({ boxes: [aabb(0, 0, -10, 0.2, 3, 10), aabb(5, 0, 5, 7, 0.3, 7)] }),
    );
    // The wall is x 0..0.2: the columns at x = 0.25 and −0.25 are 0.05 and 0.25 m from it.
    expect(layersAt(nav, 0.25, 0.25)).toBe(0);
    expect(layersAt(nav, -0.25, 0.25)).toBe(1);
    expect(layersAt(nav, 0.75, 0.25)).toBe(1);
    // A 0.3 m step is walkable on top.
    expect(nav.nodeY(nav.nearest(6, 0.3, 6))).toBeCloseTo(0.3);
  });

  it('needs headroom', () => {
    const nav = new NavGrid(makeWorld({ boxes: [aabb(-2, 1.4, -2, 2, 1.7, 2)] }));
    expect(nav.nearest(0, 0, 0)).toBe(-1);
    // But its top is a surface (cut off from the ground below).
    const top = nav.nearest(0, 1.7, 0);
    expect(nav.nodeY(top)).toBeCloseTo(1.7);
    expect(nav.component[top]).not.toBe(nav.component[nav.nearest(5, 0, 5)]);
  });

  it('stacks floors in layers and links them by stairs, not ladders', () => {
    // A 3 m platform with a ramp up its south side, and one with only a ladder.
    const world = makeWorld({
      boxes: [aabb(-3, 0, -9, 3, 3, -3), aabb(8, 0, -9, 14, 3, -3)],
      ramps: [{ x: 0, z: 0, hx: 1, hz: 3, yaw: Math.PI, bottom: 0, low: 0, high: 3 }],
      ladders: [{ x: 8, z: -6, yaw: -Math.PI / 2, halfWidth: 0.3, bottom: 0, top: 3 }],
    });
    const nav = new NavGrid(world);
    const ground = nav.nearest(0, 0, 8);
    const stairsTop = nav.nearest(0, 3, -6);
    const ladderTop = nav.nearest(11, 3, -6);
    expect(nav.nodeY(stairsTop)).toBeCloseTo(3);
    expect(nav.component[stairsTop]).toBe(nav.component[ground]);
    expect(nav.component[ladderTop]).not.toBe(nav.component[ground]);

    const up = route(nav, [5, 0, 8], [0, 3, -6]);
    expect(up.result).toBe('found');
    // It goes round to the foot of the ramp and up it.
    expect(up.pts.some((p) => Math.abs(p[0]!) < 1 && p[2]! > 1)).toBe(true);
    expect(up.pts.at(-1)![1]).toBeCloseTo(3);
  });

  it('has a column under a roof as well as the roof', () => {
    // A shelter: four posts and a roof at 2.4 m.
    const posts = [-2, 2].flatMap((x) =>
      [-2, 2].map((z) => aabb(x - 0.1, 0, z - 0.1, x + 0.1, 2.4, z + 0.1)),
    );
    const nav = new NavGrid(makeWorld({ boxes: [...posts, aabb(-2.2, 2.4, -2.2, 2.2, 2.6, 2.2)] }));
    expect(layersAt(nav, 0.25, 0.25)).toBe(2);
    expect(nav.nodeY(nav.nearest(0, 2.6, 0))).toBeCloseTo(2.6);
  });

  it('keeps 1 m doorways open however the grid lines up', () => {
    for (const offset of [0, 0.1, 0.2, 0.3, 0.4]) {
      // A wall along x = 0 with a 1 m gap.
      const gap = offset - 0.5;
      const world = makeWorld({
        boxes: [aabb(-0.1, 0, -20, 0.1, 3, gap), aabb(-0.1, 0, gap + 1, 0.1, 3, 20)],
      });
      const nav = new NavGrid(world);
      const { result, pts } = route(nav, [-5, 0, 10], [5, 0, 10]);
      expect(result, `offset ${offset}`).toBe('found');
      // Through the gap, not round the end of the wall.
      expect(length(pts)).toBeLessThan(30);
    }
  });

  it("doesn't link up steep terrain", () => {
    // A ridge along x = 0 with 60° sides between flat ground.
    const terrain = HeightGrid.fromFunction(-20, -20, 1, 40, 40, (x) =>
      Math.max(0, 6 - Math.abs(x) * Math.tan((60 * Math.PI) / 180)),
    );
    const heights = Array.from({ length: 41 * 41 }, (_, k) =>
      terrain.corner(k % 41, Math.floor(k / 41)),
    );
    const nav = new NavGrid(
      makeWorld({ terrain: { minX: -20, minZ: -20, cellSize: 1, cols: 40, rows: 40, heights } }),
    );
    const west = nav.nearest(-10, 0, 0);
    const east = nav.nearest(10, 0, 0);
    expect(nav.component[west]).not.toBe(nav.component[east]);
  });
});

describe('findPath', () => {
  it('goes straight across open ground in one leg', () => {
    const nav = new NavGrid(makeWorld());
    const { result, pts } = route(nav, [-10, 0, -10], [12, 0, 7]);
    expect(result).toBe('found');
    expect(pts).toHaveLength(2);
  });

  it('goes round a wall, and straight() refuses to go through it', () => {
    const nav = new NavGrid(makeWorld({ boxes: [aabb(-0.1, 0, -10, 0.1, 3, 10)] }));
    const { result, pts } = route(nav, [-5, 0, 0], [5, 0, 0]);
    expect(result).toBe('found');
    expect(pts.length).toBeGreaterThan(2);
    // Round one end of the wall.
    expect(pts.some((p) => Math.abs(p[2]!) >= 10)).toBe(true);
    expect(straight(nav, new CellWalk(), nav.nearest(-5, 0, 0), nav.nearest(5, 0, 0))).toBe(false);
    expect(straight(nav, new CellWalk(), nav.nearest(-5, 0, 12), nav.nearest(5, 0, 12))).toBe(true);
  });

  it('gets as close as it can to somewhere it can never reach', () => {
    // A closed pen.
    const nav = new NavGrid(
      makeWorld({
        boxes: [
          aabb(-3, 0, -3, 3, 3, -2.8),
          aabb(-3, 0, 2.8, 3, 3, 3),
          aabb(-3, 0, -3, -2.8, 3, 3),
          aabb(2.8, 0, -3, 3, 3, 3),
        ],
      }),
    );
    const { result, pts } = route(nav, [10, 0, 0], [0, 0, 0]);
    expect(result).toBe('partial');
    const end = pts.at(-1)!;
    expect(Math.hypot(end[0]!, end[2]!)).toBeLessThan(4);
  });
});
