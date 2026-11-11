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
import {
  CURVE_DEFAULTS,
  curveBoxes,
  cutHole,
  followSweep,
  holeAt,
  pieceCount,
  snapArc,
  stairsSlope,
  stepCount,
  type Arc,
  type CurveSettings,
} from './curves';
import { findOverlaps } from './overlap';
import { newMap } from './terrain';

const settings = (patch: Partial<CurveSettings>): CurveSettings => ({
  ...CURVE_DEFAULTS,
  ...patch,
});

function worldOf(nodes: MapNode[]): CollisionWorld {
  const { boxes } = compileNodes(nodes, new Map());
  const flat = Array(51 * 51).fill(0);
  const terrain = { minX: -50, minZ: -50, cellSize: 2, cols: 50, rows: 50, heights: flat };
  return new CollisionWorld({ terrain, boxes, ramps: [], ladders: [] });
}

describe('curves', () => {
  const full: Arc = { center: [0, 0, 0], radius: 6, start: 0, sweep: 360 };

  it('make a round floor with a round hole, with no gaps to fall through', () => {
    const floor = settings({ mode: 'floor', floorWidth: 3, floorThickness: 0.3, raise: 4 });
    const boxes = curveBoxes(full, floor, '#fff');
    expect(boxes.length).toBe(pieceCount(full, 3));
    expect(boxes.every((b) => b.pos[1] === 3.7 && b.size[1] === 0.3)).toBe(true);
    const world = worldOf(boxes);
    for (let a = 0; a < 360; a += 1.3) {
      const [c, s] = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
      // On the ring, right out to its outside edge, you stand at the raise...
      for (const r of [6.05, 7.5, 8.95])
        expect(world.groundAt(r * c, r * s, 0.01, 10)).toBeCloseTo(4, 3);
      // ...and in the hole you fall to the ground.
      expect(world.groundAt(5.95 * c, 5.95 * s, 0.01, 10)).toBe(0);
    }
  });

  it('make walls whose inside is the circle clicked, so a railing sits on the hole’s edge', () => {
    const wall = settings({ mode: 'wall', wallHeight: 1, wallThickness: 0.2 });
    const quarter: Arc = { center: [2, 0, 3], radius: 5, start: 0, sweep: 90 };
    const boxes = curveBoxes(quarter, wall, '#fff');
    expect(boxes.length).toBe(6);
    // The first piece faces out along 7.5°: its middle is 5.1 m out, turned 82.5°.
    expect(boxes[0]!.yaw).toBe(82.5);
    const [x, , z] = boxes[0]!.pos;
    expect(Math.hypot(x - 2, z - 3)).toBeCloseTo(5.1, 2);
  });

  it('follow the mouse past halfway either way, and no further than a full circle', () => {
    expect(followSweep(0, 170, 200)).toBe(200);
    expect(followSweep(0, -170, -200)).toBe(-200);
    expect(followSweep(30, 0, 60)).toBe(30);
    expect(followSweep(0, 350, 20)).toBe(360);
    expect(snapArc({ ...full, radius: 5.8, start: 7, sweep: 2 }, 0.5, 15)).toEqual({
      center: [0, 0, 0],
      radius: 6,
      start: 0,
      sweep: 15,
    });
  });

  it('make pieces that only meet at joints, so they don’t warn as overlapping', () => {
    const kinds = [
      settings({ mode: 'floor', raise: 4 }),
      settings({ mode: 'wall', wallHeight: 1 }),
      settings({ mode: 'stairs', stairsRise: 4 }),
    ];
    for (const kind of kinds) {
      const map = newMap('t', 'T', 40, 2);
      map.nodes.push(...curveBoxes({ ...full, sweep: 180 }, kind, '#fff'));
      expect(findOverlaps(map, new Map()).props).toEqual([]);
    }
  });

  it('make curved stairs the real movement code walks up', () => {
    const stairs = settings({ mode: 'stairs', stairsWidth: 1.6, stairsRise: 2 });
    const arc: Arc = { center: [0, 0, 0], radius: 4, start: 0, sweep: 90 };
    expect(stepCount(arc, stairs)).toBe(8);
    expect(stairsSlope(arc, stairs)).toBeLessThan(20);
    const world = worldOf(curveBoxes(arc, stairs, '#fff'));
    const state = createState(1);
    const r = 4.8;
    // Starting just before the first step, at angle −0.3 rad.
    const c = spawnCharacter(state, world, r * Math.cos(-0.3), r * Math.sin(-0.3), 0);
    let top = 0;
    for (let i = 0; i < TICK_RATE * 8 && Math.atan2(c.z, c.x) < Math.PI / 2 - 0.1; i++) {
      // Facing along the circle the way it rises: forward is (−sin yaw, −cos yaw).
      const yaw = Math.PI - Math.atan2(c.z, c.x);
      const input: PlayerInput = {
        moveX: 0,
        moveY: 1,
        yaw,
        pitch: 0,
        sprint: false,
        crouch: false,
        jump: false,
        fire: false,
        aim: false,
        reload: false,
      };
      step(state, world, new Map(), { [c.id]: input });
      top = Math.max(top, c.y);
    }
    expect(Math.atan2(c.z, c.x)).toBeGreaterThan(Math.PI / 2 - 0.1);
    expect(top).toBeGreaterThan(1.7);
  });

  describe('round holes', () => {
    // A floor 20 × 16, 0.3 thick, its top at 4, turned 30°.
    const floor: MapNode & { type: 'box' } = {
      type: 'box',
      id: 'upstairs',
      pos: [5, 3.7, -2],
      yaw: 30,
      size: [20, 0.3, 16],
      color: '#888888',
    };
    // From the floor's own frame to the world.
    const world = (lx: number, lz: number): [number, number] => {
      const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
      return [5 + lx * c + lz * s, -2 - lx * s + lz * c];
    };

    it('leave floor everywhere but the hole, with no gaps, and a fall through the hole', () => {
      const hole = { x: 2, z: -1, radius: 4 };
      const cut = cutHole(floor, hole, 1.1, '#ffffff');
      const w = worldOf(cut.floor);
      for (let lx = -9.9; lx <= 9.9; lx += 0.3)
        for (let lz = -7.9; lz <= 7.9; lz += 0.3) {
          const r = Math.hypot(lx - hole.x, lz - hole.z);
          const [x, z] = world(lx, lz);
          // The hole's edge is a polygon just outside the circle.
          if (r > hole.radius + 0.1) expect(w.groundAt(x, z, 0.01, 10)).toBeCloseTo(4, 3);
          if (r < hole.radius - 0.05) expect(w.groundAt(x, z, 0.01, 10)).toBe(0);
        }
      // Only the first piece keeps the floor's id, and pieces keep its color.
      expect(cut.floor.filter((b) => b.id)).toHaveLength(1);
      expect(cut.floor.every((b) => b.color === '#888888')).toBe(true);
    });

    it('stand a railing on the hole’s edge', () => {
      const { railing } = cutHole(floor, { x: 0, z: 0, radius: 4 }, 1.1, '#ffffff');
      expect(railing.length).toBeGreaterThan(8);
      for (const b of railing) {
        expect(b.pos[1]).toBe(4);
        expect(b.size[1]).toBe(1.1);
        expect(Math.hypot(b.pos[0] - 5, b.pos[2] + 2)).toBeCloseTo(4.075, 2);
      }
      expect(cutHole(floor, { x: 0, z: 0, radius: 4 }, null, '#fff').railing).toEqual([]);
    });

    it("refuse a hole that doesn't fit in the floor", () => {
      expect(() => cutHole(floor, { x: 6, z: 0, radius: 4 }, null, '#fff')).toThrow('fit');
      expect(() => cutHole(floor, { x: 0, z: 0, radius: 7.5 }, null, '#fff')).toThrow('fit');
      expect(() =>
        cutHole({ ...floor, pitch: 5 }, { x: 0, z: 0, radius: 2 }, null, '#fff'),
      ).toThrow('tilted');
    });

    it('make pieces that don’t warn as overlapping', () => {
      const map = newMap('t', 'T', 40, 2);
      const cut = cutHole(floor, { x: 2, z: -1, radius: 4 }, 1.1, '#fff');
      map.nodes.push(...cut.floor, ...cut.railing);
      expect(findOverlaps(map, new Map()).props).toEqual([]);
    });

    it("go on the floor's middle when clicked near it, else on the grid", () => {
      expect(holeAt(0.6, -0.8, 0.5)).toEqual({ x: 0, z: 0 });
      expect(holeAt(3.2, 0.4, 0.5)).toEqual({ x: 3, z: 0 });
      expect(holeAt(3.2, 1.4, 0)).toEqual({ x: 3.2, z: 1.4 });
    });
  });
});
