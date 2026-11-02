import {
  CollisionWorld,
  TICK_RATE,
  compileNodes,
  createState,
  spawnCharacter,
  step,
  type MapNode,
  type PlayerInput,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { newMap } from './terrain';
import { findOverlaps } from './overlap';
import {
  DOOR_HEIGHT,
  WINDOW_HEIGHT,
  WINDOW_SILL,
  alongWall,
  cutWall,
  doorIn,
  edgeRailing,
  evenOpenings,
  glassIn,
  spaceEvenly,
  splitWall,
  toWall,
  isRailing,
  nearestEnd,
  snapCorner,
  wallAlong,
  wallEnds,
  wallBoxes,
  windowAt,
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

  it('cut several windows spaced evenly, with the same gap between and at the ends', () => {
    const wall = {
      type: 'box' as const,
      pos: [0, 0, 0] as [number, number, number],
      size: [10, 2.6, 0.2] as [number, number, number],
      colour: '#fff',
    };
    const window = { along: 3, width: 1.5, bottom: 0.9, top: 2 };
    const openings = evenOpenings(10, window, 3);
    // (10 − 3 × 1.5) / 4 = 1.375 between each.
    expect(openings.map((o) => o.along)).toEqual([-2.875, 0, 2.875]);
    const pieces = cutWall(wall, openings);
    // Four solid stretches, and a sill and lintel each.
    expect(pieces).toHaveLength(4 + 3 * 2);
    const full = pieces.filter((p) => p.size[1] === 2.6);
    // Placed to the millimetre.
    const want = [-4.3125, -1.4375, 1.4375, 4.3125];
    full.forEach((p, k) => {
      expect(p.pos[0]).toBeCloseTo(want[k]!, 2);
      expect(p.size[0]).toBe(1.375);
    });
    expect(() => evenOpenings(10, window, 7)).toThrow("don't fit");
    // A set gap: a row centred on the wall, 1.5 + 0.5 + 1.5 + 0.5 + 1.5 = 5.5 m long.
    expect(evenOpenings(10, window, 3, 0.5).map((o) => o.along)).toEqual([-2, 0, 2]);
    expect(() => evenOpenings(10, window, 5, 2)).toThrow('2 m apart');
    expect(() => cutWall(wall, [window, { ...window, along: 3.5 }])).toThrow('overlap');
  });

  it('become wall nodes that compile to the same boxes as cutting them', () => {
    const box = {
      type: 'box' as const,
      pos: [10, 0, 5] as [number, number, number],
      size: [0.2, 2.6, 4] as [number, number, number],
      yaw: 90,
      colour: '#fff',
    };
    const gap = { along: 0.5, width: 1.2, bottom: 0.9, top: 2 };
    const wall = toWall(box, [gap]);
    expect(wall).toMatchObject({ size: [4, 2.6, 0.2], openings: [gap] });
    expect(wall.yaw).toBeUndefined();
    expect(wallAlong(wall, [11, 0, 5])).toBeCloseTo(alongWall(box, [11, 0, 5]));
    const byKey = (b: { x: number; y: number; z: number }) =>
      [b.x, b.y, b.z].map((v) => v.toFixed(3)).join();
    const want = compileNodes(cutWall(box, gap), new Map()).boxes.map(byKey).sort();
    expect(compileNodes([wall], new Map()).boxes.map(byKey).sort()).toEqual(want);
  });

  it('split a wall node around a doorway, keeping each side its windows', () => {
    const wall = toWall(
      { type: 'box', id: 'front', pos: [0, 0, 0], size: [10, 2.6, 0.2], colour: '#fff' },
      [
        { along: -3, width: 1, bottom: 0.9, top: 2 },
        { along: 3, width: 1, bottom: 0.9, top: 2, glass: '#abc' },
      ],
    );
    const { left, lintel, right, door } = splitWall(wall, {
      along: 0,
      width: 1,
      bottom: 0,
      top: 2.1,
    });
    expect(left).toMatchObject({ id: 'front', pos: [-2.75, 0, 0], size: [4.5, 2.6, 0.2] });
    expect(left!.openings).toEqual([{ along: -0.25, width: 1, bottom: 0.9, top: 2 }]);
    expect(right!.id).toBeUndefined();
    expect(right!.openings).toEqual([
      { along: 0.25, width: 1, bottom: 0.9, top: 2, glass: '#abc' },
    ]);
    expect(lintel).toMatchObject({ pos: [0, 2.1, 0], size: [1, 0.5, 0.2] });
    expect(door).toEqual([0, 0, 0]);
    expect(() => splitWall(wall, { along: 2.8, width: 1, bottom: 0, top: 2.1 })).toThrow('window');
  });

  it("space a wall node's windows evenly, keeping their widths", () => {
    const wall = toWall({ type: 'box', pos: [0, 0, 0], size: [10, 2.6, 0.2], colour: '#fff' }, [
      { along: 4, width: 2, bottom: 0.9, top: 2 },
      { along: -4, width: 1, bottom: 0.9, top: 2 },
    ]);
    spaceEvenly(wall);
    // (10 − 3) / 3 between each: −5 + 2.333 + 0.5, then 2.333 + 1 further on.
    expect(wall.openings.map((o) => o.along)).toEqual([-2.167, 1.667]);
    // 1 m apart, centred: a row 1 + 1 + 2 = 4 m long.
    spaceEvenly(wall, 1);
    expect(wall.openings.map((o) => o.along)).toEqual([-1.5, 1]);
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
  function cutWorld(bottom: number, top: number, glazed = false): CollisionWorld {
    const [wall] = wallBoxes(
      [
        [-4, 0, -3],
        [4, 0, -3],
      ],
      2.6,
      0.2,
      '#fff',
    );
    const gap = { along: 0, width: 1, bottom, top };
    const pieces: MapNode[] = cutWall(wall!, gap);
    if (glazed) pieces.push(glassIn(wall!, gap, '#a8d4e0'));
    const { boxes, glass } = compileNodes(pieces, new Map());
    const flat = Array(51 * 51).fill(0);
    const terrain = { minX: -50, minZ: -50, cellSize: 2, cols: 50, rows: 50, heights: flat };
    return new CollisionWorld({ terrain, boxes, ramps: [], ladders: [], glass });
  }

  /**
   * Walks up to the wall for a second, then (if `jump`) jumps, and goes on a second; with
   * the glass broken if `broken`.
   */
  function walkInto(world: CollisionWorld, jump = false, broken = false): number {
    const state = createState(1);
    state.glass = world.glass.map(() => broken);
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

  it('glaze a window so it is vaulted through only once the glass breaks', () => {
    const glazed = cutWorld(WINDOW_SILL, WINDOW_SILL + WINDOW_HEIGHT, true);
    expect(glazed.glass).toHaveLength(1);
    expect(glazed.glass[0]).toMatchObject({ width: 1, height: WINDOW_HEIGHT, thickness: 0.02 });
    expect(walkInto(glazed, true)).toBeGreaterThan(-3);
    expect(walkInto(glazed, true, true)).toBeLessThan(-3.2);
  });

  it("vault through a wall node's window, by the real movement code", () => {
    const [box] = wallBoxes(
      [
        [-4, 0, -3],
        [4, 0, -3],
      ],
      2.6,
      0.2,
      '#fff',
    );
    const wall = toWall(box!, [
      { along: 0, width: 1, bottom: WINDOW_SILL, top: WINDOW_SILL + WINDOW_HEIGHT },
    ]);
    const { boxes } = compileNodes([wall], new Map());
    const flat = Array(51 * 51).fill(0);
    const terrain = { minX: -50, minZ: -50, cellSize: 2, cols: 50, rows: 50, heights: flat };
    const world = new CollisionWorld({ terrain, boxes, ramps: [], ladders: [] });
    expect(walkInto(world)).toBeGreaterThan(-3);
    expect(walkInto(world, true)).toBeLessThan(-3.2);
  });

  it("glaze a window from its sill or lintel, in a turned wall, but not twice or a side's", () => {
    const wall = {
      type: 'box' as const,
      pos: [10, 0, 5] as [number, number, number],
      size: [0.2, 2.6, 4] as [number, number, number],
      yaw: 90,
      colour: '#fff',
    };
    const gap = { along: 0.5, width: 1.2, bottom: 0.9, top: 2 };
    const pieces: MapNode[] = cutWall(wall, gap);
    const [side, sill, lintel] = pieces as (typeof wall)[];
    const want = glassIn(wall, gap, '#abc');
    expect(want).toEqual({
      type: 'glass',
      pos: [10.5, 0.9, 5],
      size: [1.2, 1.1],
      colour: '#abc',
    });
    expect(windowAt(sill!, pieces, '#abc')).toEqual(want);
    expect(windowAt(lintel!, pieces, '#abc')).toEqual(want);
    expect(windowAt(side!, pieces, '#abc')).toBeNull();
    expect(windowAt(sill!, [...pieces, want], '#abc')).toBeNull();
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

describe('railings', () => {
  type Box = Extract<MapNode, { type: 'box' }>;
  type Stairs = Extract<MapNode, { type: 'stairs' }>;
  const floor = (y = 0, yaw?: number): Box => ({
    type: 'box',
    pos: [0, y, 0],
    size: [10, 0.2, 6],
    colour: '#fff',
    ...(yaw !== undefined && { yaw }),
  });
  const stairs: Stairs = { type: 'stairs', pos: [0, 0, 0], size: [2, 3, 6], colour: '#fff' };

  it('go along the edge of a floor nearest the click, flush with it', () => {
    expect(edgeRailing(floor(), [4.8, 0.2, 1], 1.1, '#000')).toEqual([
      { type: 'box', pos: [4.95, 0.2, 0], size: [0.1, 1.1, 6], colour: '#000' },
    ]);
    expect(edgeRailing(floor(), [1, 0.2, -2.9], 1.1, '#000')).toEqual([
      { type: 'box', pos: [0, 0.2, -2.95], size: [10, 1.1, 0.1], colour: '#000' },
    ]);
    // Turned 90°, local +x points along −z.
    expect(edgeRailing(floor(0, 90), [0, 0.2, -4.8], 1.1, '#000')).toEqual([
      { type: 'box', pos: [0, 0.2, -4.95], size: [0.1, 1.1, 6], colour: '#000', yaw: 90 },
    ]);
    expect(() => edgeRailing({ ...floor(), pitch: 10 }, [4.8, 0.2, 0], 1.1, '#000')).toThrow(
      'tilted',
    );
  });

  it('follow stairs up their side in short tilted pieces, with no overlap warnings', () => {
    const pieces = edgeRailing(stairs, [0.9, 1.5, 0], 1.1, '#000');
    // 6.7 m up the slope: 7 pieces of 0.958 m, tilted up towards +z.
    expect(pieces).toHaveLength(7);
    for (const [k, p] of pieces.entries()) {
      // Beside the stairs, so it only touches them.
      expect(p.pos[0]).toBeCloseTo(1.05);
      expect(p.pos[1]).toBeCloseTo((3 * (k + 0.5)) / 7, 2);
      expect(p.pitch).toBeCloseTo(-26.6);
      expect(p.size).toEqual([0.1, 1.1, 0.958]);
    }
    const map = { ...newMap('t', 'T', 40, 4), nodes: [stairs, ...pieces] };
    expect(findOverlaps(map, new Map()).props).toEqual([]);
    // Two of the same crate overlapping still warn.
    const crate: Box = { type: 'box', pos: [5, 0, 0], size: [0.2, 1, 2], colour: '#fff' };
    const twice = { ...map, nodes: [crate, { ...crate, pos: [5, 0, 0.5] as Box['pos'] }] };
    expect(findOverlaps(twice, new Map()).props).toHaveLength(1);
  });

  it('are found to cut gaps in, and a gap cuts them through', () => {
    const [rail] = edgeRailing(floor(), [4.8, 0.2, 0], 1.1, '#000');
    expect(isRailing(rail!)).toBe(true);
    expect(isRailing(floor())).toBe(false);
    expect(isRailing({ ...rail!, size: [0.1, 2.6, 6] })).toBe(false);
    const pieces = cutWall(rail!, { along: 0, width: 1, bottom: 0, top: 1.1 });
    expect(pieces.map((p) => [p.pos[2], p.size[2]])).toEqual([
      [-1.75, 2.5],
      [1.75, 2.5],
    ]);
  });

  /** Walks for two seconds from (x, z) along (moveX, moveY) facing yaw; where it ends. */
  function walk(nodes: MapNode[], x: number, z: number, yaw: number, moveX: number, moveY: number) {
    const { boxes, ramps } = compileNodes(nodes, new Map());
    const flat = Array(51 * 51).fill(0);
    const terrain = { minX: -50, minZ: -50, cellSize: 2, cols: 50, rows: 50, heights: flat };
    const world = new CollisionWorld({ terrain, boxes, ramps, ladders: [] });
    const state = createState(1);
    const c = spawnCharacter(state, world, x, z, yaw);
    const input: PlayerInput = {
      moveX,
      moveY,
      yaw,
      pitch: 0,
      sprint: false,
      crouch: false,
      jump: false,
      fire: false,
      aim: false,
      reload: false,
    };
    for (let i = 0; i < TICK_RATE * 2; i++) step(state, world, new Map(), { [c.id]: input });
    return c;
  }

  it('keep you on a raised floor, and let you through a gap, by the real movement code', () => {
    const high = floor(2.8);
    const [rail] = edgeRailing(high, [4.8, 3, 0], 1.1, '#000');
    // Facing +x is yaw −90°.
    const kept = walk([high, rail!], 3, 0, -Math.PI / 2, 0, 1);
    expect(kept.y).toBe(3);
    expect(kept.x).toBeLessThan(4.9);
    const gap = cutWall(rail!, { along: 0, width: 1, bottom: 0, top: 1.1 });
    const out = walk([high, ...gap], 3, 0, -Math.PI / 2, 0, 1);
    expect(out.x).toBeGreaterThan(5);
    expect(out.y).toBe(0);
  });

  it('keep you on stairs you walk up sideways, by the real movement code', () => {
    // Facing +z (yaw π), up the stairs, and sidestepping towards the railing on +x.
    const pieces = edgeRailing(stairs, [0.9, 1.5, 0], 1.1, '#000');
    const bare = walk([stairs], 0, -2.5, Math.PI, -1, 1);
    const railed = walk([stairs, ...pieces], 0, -2.5, Math.PI, -1, 1);
    // Without it you step off the side; with it you stay on, by the railing.
    expect(Math.abs(bare.x)).toBeGreaterThan(1.2);
    expect(railed.x).toBeGreaterThan(0.5);
    expect(railed.x).toBeLessThan(0.9);
    expect(railed.y).toBeGreaterThan(1);
  });
});
