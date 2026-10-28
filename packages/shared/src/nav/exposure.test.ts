import { describe, expect, it } from 'vitest';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { Exposure, SPOT } from './exposure';
import { NavGrid } from './nav-grid';

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

/** Flat ground 40 m across with these boxes, and the exposure from an enemy at (-15, 0, -15). */
function exposure(boxes: BoxDef[]): {
  nav: NavGrid;
  kind: (x: number, y: number, z: number) => number;
} {
  const world = new CollisionWorld({
    terrain: { minX: -20, minZ: -20, cellSize: 4, cols: 10, rows: 10, heights: Array(121).fill(0) },
    boxes,
    ramps: [],
    ladders: [],
  });
  const nav = new NavGrid(world);
  const e = new Exposure(nav, world, [[-15, 0, -15]]);
  while (!e.step(500));
  return { nav, kind: (x, y, z) => e.kind[nav.nearest(x, y, z)]! };
}

describe('Exposure', () => {
  it('counts the ground as reachable and an open platform as seen', () => {
    const { kind } = exposure([aabb(5, 0, 5, 9, 3, 9)]);
    expect(kind(0, 0, 0)).toBe(SPOT.reachable);
    expect(kind(7, 3, 7)).toBe(SPOT.seen);
  });

  it('finds a walled-in roof hidden, but not the open one beside it', () => {
    const walls = [
      aabb(4, 3, 4, 10, 5.5, 4.2),
      aabb(4, 3, 9.8, 10, 5.5, 10),
      aabb(4, 3, 4, 4.2, 5.5, 10),
      aabb(9.8, 3, 4, 10, 5.5, 10),
    ];
    const { kind } = exposure([aabb(4, 0, 4, 10, 3, 10), ...walls, aabb(-10, 0, 5, -6, 3, 9)]);
    expect(kind(7, 3, 7)).toBe(SPOT.hidden);
    expect(kind(-8, 3, 7)).toBe(SPOT.seen);
  });

  it('uses the biggest area when there are no enemy spawns', () => {
    const world = new CollisionWorld({
      terrain: {
        minX: -20,
        minZ: -20,
        cellSize: 4,
        cols: 10,
        rows: 10,
        heights: Array(121).fill(0),
      },
      boxes: [aabb(5, 0, 5, 9, 3, 9)],
      ramps: [],
      ladders: [],
    });
    const nav = new NavGrid(world);
    const e = new Exposure(nav, world, []);
    expect(e.kind[nav.nearest(0, 0, 0)]).toBe(SPOT.reachable);
    expect(e.total).toBeGreaterThan(0);
    while (!e.step(100));
    expect(e.left).toBe(0);
    expect(e.kind[nav.nearest(7, 3, 7)]).toBe(SPOT.seen);
  });
});
