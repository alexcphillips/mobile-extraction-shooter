import {
  CollisionWorld,
  TICK_RATE,
  compileNodes,
  createState,
  spawnCharacter,
  step,
  type PlayerInput,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import {
  DOOR_HEIGHT,
  WINDOW_HEIGHT,
  WINDOW_SILL,
  alongWall,
  cutWall,
  doorIn,
  nearestEnd,
  snapCorner,
  wallEnds,
  wallBoxes,
} from './walls';

describe('walls', () => {
  it('draw a box per side, running past the corners by half their thickness', () => {
    const [a, b] = wallBoxes(
      [
        [0, 1, 0],
        [4, 1, 0],
        [4, 1, 3],
      ],
      2.6,
      0.2,
      '#ffffff',
    );
    expect(a).toEqual({ type: 'box', pos: [2, 1, 0], size: [4.2, 2.6, 0.2], colour: '#ffffff' });
    // Along +z: local +x is (cos yaw, −sin yaw), so yaw −90.
    expect(b).toEqual({
      type: 'box',
      pos: [4, 1, 1.5],
      size: [3.2, 2.6, 0.2],
      colour: '#ffffff',
      yaw: -90,
    });
  });

  it('snap corners to the angle snap and the length to the grid', () => {
    expect(snapCorner([0, 0, 0], [3.1, 0, 0.4], 15, 0.5)).toEqual([3, 0, 0]);
    expect(snapCorner([1, 0, 1], [1.2, 0, 3.9], 90, 1)).toEqual([1, 0, 4]);
    // Off: where clicked.
    expect(snapCorner([0, 0, 0], [3.1, 0, 0.4], 0, 0.5)).toEqual([3.1, 0, 0.4]);
  });

  it('cut a window into sides, a sill and a lintel', () => {
    const wall = {
      type: 'box' as const,
      pos: [0, 0, 0] as [number, number, number],
      size: [4, 2.6, 0.2] as [number, number, number],
      colour: '#fff',
    };
    const pieces = cutWall(wall, { along: 0.5, width: 1, bottom: 0.9, top: 2 });
    expect(pieces.map((p) => [p.pos, p.size])).toEqual([
      [
        [-1, 0, 0],
        [2, 2.6, 0.2],
      ],
      [
        [0.5, 0, 0],
        [1, 0.9, 0.2],
      ],
      [
        [0.5, 2, 0],
        [1, 0.6, 0.2],
      ],
      [
        [1.5, 0, 0],
        [1, 2.6, 0.2],
      ],
    ]);
  });

  it('cut a door with no sill, kept inside the wall, in a wall turned and long along z', () => {
    const wall = {
      type: 'box' as const,
      pos: [10, 0, 5] as [number, number, number],
      size: [0.2, 2.6, 3] as [number, number, number],
      yaw: 90,
      colour: '#fff',
    };
    // Local z, turned 90°, runs along world +x.
    expect(alongWall(wall, [11, 0, 5])).toBeCloseTo(1);
    const door = { along: 5, width: 1, bottom: 0, top: 2.1 };
    const pieces = cutWall(wall, door);
    // Pushed to the end: a side, a lintel, and nothing past it.
    expect(pieces.map((p) => [p.pos, p.size])).toEqual([
      [
        [9.5, 0, 5],
        [0.2, 2.6, 2],
      ],
      [
        [11, 2.1, 5],
        [0.2, 0.5, 1],
      ],
    ]);
    expect(pieces.every((p) => p.yaw === 90)).toBe(true);
    // The door's width runs along the wall: its local x along world +x, so yaw 0.
    expect(doorIn(wall, door)).toEqual({ pos: [11, 0, 5], yaw: 0 });
  });

  it("refuse gaps that don't fit", () => {
    const wall = {
      type: 'box' as const,
      pos: [0, 0, 0] as [number, number, number],
      size: [0.8, 2, 0.2] as [number, number, number],
      colour: '#fff',
    };
    expect(() => cutWall(wall, { along: 0, width: 1, bottom: 0, top: 1.8 })).toThrow('long');
    expect(() =>
      cutWall({ ...wall, size: [4, 2, 0.2] }, { along: 0, width: 1, bottom: 0, top: 2.1 }),
    ).toThrow('tall');
  });

  /** A wall along x at z = −3 with a gap cut in it, as the game collides with it. */
  function cutWorld(bottom: number, top: number): CollisionWorld {
    const [wall] = wallBoxes(
      [
        [-4, 0, -3],
        [4, 0, -3],
      ],
      2.6,
      0.2,
      '#fff',
    );
    const pieces = cutWall(wall!, { along: 0, width: 1, bottom, top });
    const { boxes } = compileNodes(pieces, new Map());
    const flat = Array(51 * 51).fill(0);
    const terrain = { minX: -50, minZ: -50, cellSize: 2, cols: 50, rows: 50, heights: flat };
    return new CollisionWorld({ terrain, boxes, ramps: [], ladders: [] });
  }

  /** Walks up to the wall for a second, then (if `jump`) jumps, and goes on a second. */
  function walkInto(world: CollisionWorld, jump = false): number {
    const state = createState(1);
    // yaw 0 faces −z, towards the wall.
    const c = spawnCharacter(state, world, 0, -1.5, 0);
    const input = (jump: boolean): PlayerInput => ({
      moveX: 0,
      moveY: 1,
      yaw: 0,
      pitch: 0,
      sprint: false,
      crouch: false,
      jump,
      fire: false,
      aim: false,
      reload: false,
    });
    for (let i = 0; i < TICK_RATE * 2; i++)
      step(state, world, new Map(), { [c.id]: input(jump && i === TICK_RATE) });
    return c.z;
  }

  it('cut windows the game vaults through, and doorways it walks through', () => {
    const window = cutWorld(WINDOW_SILL, WINDOW_SILL + WINDOW_HEIGHT);
    // Walking stops at the wall; jumping at the window vaults it.
    expect(walkInto(window)).toBeGreaterThan(-3);
    expect(walkInto(window, true)).toBeLessThan(-3.2);
    expect(walkInto(cutWorld(0, DOOR_HEIGHT))).toBeLessThan(-3.2);
  });

  it('find the ends of walls to snap to, not of slabs or crates', () => {
    const ends = wallEnds([
      // A wall 4.2 long, 0.2 thick, along x at z = 1, standing on y = 0.
      { x: 2, y: 1.3, z: 1, hx: 2.1, hy: 1.3, hz: 0.1, yaw: 0 },
      // Turned a quarter: long along local x, which runs along −z.
      { x: 0, y: 1.3, z: 0, hx: 1.1, hy: 1.3, hz: 0.1, yaw: Math.PI / 2 },
      { x: 0, y: 0, z: 0, hx: 5, hy: 0.1, hz: 5, yaw: 0 },
      { x: 0, y: 0.5, z: 0, hx: 0.5, hy: 0.5, hz: 0.5, yaw: 0 },
    ]).map((e) => e.map((v) => Math.round(v * 100) / 100 + 0));
    expect(ends).toEqual([
      [0, 0, 1],
      [4, 0, 1],
      [0, 0, 1],
      [0, 0, -1],
    ]);
    expect(nearestEnd(ends as never, [3.8, 0, 1.2])).toEqual([4, 0, 1]);
    expect(nearestEnd(ends as never, [3, 0, 1])).toBeNull();
  });
});
