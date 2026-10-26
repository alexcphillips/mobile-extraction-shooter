import { describe, expect, it } from 'vitest';
import { createRng, nextFloat } from '../rng';
import {
  CollisionWorld,
  createRayHit,
  type BoxDef,
  type RampDef,
  type WorldDef,
} from './collision-world';
import type { HeightGridDef } from './terrain';

/** Flat terrain at height h, 200 m square centred on the origin. */
function flat(h = 0): HeightGridDef {
  return {
    minX: -100,
    minZ: -100,
    cellSize: 4,
    cols: 50,
    rows: 50,
    heights: Array(51 * 51).fill(h),
  };
}

function world(parts: Partial<WorldDef> = {}): CollisionWorld {
  return new CollisionWorld({ terrain: flat(-50), boxes: [], ramps: [], ladders: [], ...parts });
}

const box = (x: number, z: number, h: number, yaw = 0, y = 0): BoxDef => ({
  x,
  y,
  z,
  hx: h,
  hy: h,
  hz: h,
  yaw,
});

describe('CollisionWorld.raycast', () => {
  it('hits an axis-aligned box with the right normal', () => {
    const w = world({ boxes: [box(0, 0, 1)] });
    const hit = createRayHit();
    expect(w.raycast(-5, 0, 0, 1, 0, 0, 100, hit)).toBeCloseTo(4);
    expect(hit).toMatchObject({ kind: 'solid', index: 0, nx: -1, ny: 0 });
    expect(w.raycast(-5, 3, 0, 1, 0, 0, 100)).toBe(Infinity);
    expect(w.raycast(-5, 0, 0, 1, 0, 0, 3)).toBe(Infinity);
    w.raycast(0, 5, 0, 0, -1, 0, 100, hit);
    expect(hit.distance).toBeCloseTo(4);
    expect(hit.ny).toBeCloseTo(1);
  });

  it('hits a rotated box on its corner', () => {
    const w = world({ boxes: [box(0, 0, 1, Math.PI / 4)] });
    expect(w.raycast(-5, 0, 0, 1, 0, 0, 100)).toBeCloseTo(5 - Math.SQRT2);
  });

  it('returns 0 from inside a box', () => {
    const w = world({ boxes: [box(0, 0, 1)] });
    expect(w.raycast(0, 0, 0, 0, 0, 1, 100)).toBe(0);
  });

  it('hits the sloped top of a ramp', () => {
    // Rises from 0 at z = −2 to 2 at z = +2 (yaw 0, so local z is world z).
    const ramp: RampDef = { x: 0, z: 0, hx: 1, hz: 2, yaw: 0, bottom: 0, low: 0, high: 2 };
    const w = world({ ramps: [ramp] });
    const hit = createRayHit();
    // Straight down onto the middle, where the top is at 1.
    expect(w.raycast(0, 5, 0, 0, -1, 0, 100, hit)).toBeCloseTo(4);
    expect(hit.ny).toBeCloseTo(2 / Math.sqrt(5));
    expect(hit.nz).toBeCloseTo(-1 / Math.sqrt(5));
    // Horizontally at y = 1.5: under the top only for z > 1.
    expect(w.raycast(0, 1.5, -10, 0, 0, 1, 100)).toBeCloseTo(11);
    // Above the high end: misses.
    expect(w.raycast(0, 2.5, -10, 0, 0, 1, 100)).toBe(Infinity);
  });

  it('hits terrain when it is nearer than any solid', () => {
    const w = new CollisionWorld({
      terrain: flat(0),
      boxes: [box(0, 0, 1, 0, 0)],
      ramps: [],
      ladders: [],
    });
    const hit = createRayHit();
    expect(w.raycast(-10, 0.5, 0, Math.SQRT1_2, -Math.SQRT1_2, 0, 100, hit)).toBeCloseTo(
      0.5 * Math.SQRT2,
    );
    expect(hit.kind).toBe('terrain');
    expect(w.raycast(-10, 5, 0, 0, 1, 0, 100, hit)).toBe(Infinity);
    expect(hit.kind).toBe('none');
  });

  it('matches brute force over many boxes, ramps and rays', () => {
    const rng = createRng(1);
    const r = (min: number, max: number): number => min + nextFloat(rng) * (max - min);
    const boxes: BoxDef[] = Array.from({ length: 300 }, () => ({
      x: r(-90, 90),
      y: r(0, 4),
      z: r(-90, 90),
      hx: r(0.5, 3.5),
      hy: r(0.5, 3.5),
      hz: r(0.5, 3.5),
      yaw: r(0, Math.PI * 2),
    }));
    const ramps: RampDef[] = Array.from({ length: 60 }, () => {
      const bottom = r(-1, 2);
      const low = bottom + r(0, 1);
      return {
        x: r(-90, 90),
        z: r(-90, 90),
        hx: r(0.5, 2),
        hz: r(1, 4),
        yaw: r(0, Math.PI * 2),
        bottom,
        low,
        high: low + r(0.5, 4),
      };
    });
    const all = world({ boxes, ramps });
    const singles = [
      ...boxes.map((b) => world({ boxes: [b] })),
      ...ramps.map((rp) => world({ ramps: [rp] })),
    ];
    for (let n = 0; n < 500; n++) {
      const a = r(0, Math.PI * 2);
      const e = r(-0.25, 0.25);
      const [dx, dy, dz] = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      const [ox, oy, oz] = [r(-80, 80), r(0, 4), r(-80, 80)];
      const expected = Math.min(...singles.map((s) => s.raycast(ox, oy, oz, dx, dy, dz, 80)));
      const got = all.raycast(ox, oy, oz, dx, dy, dz, 80);
      if (expected === Infinity) expect(got).toBe(Infinity);
      else expect(got).toBeCloseTo(expected, 6);
    }
  });
});

describe('CollisionWorld standing queries', () => {
  const ramp: RampDef = { x: 0, z: 0, hx: 1, hz: 2, yaw: 0, bottom: 0, low: 0, high: 2 };

  it('finds the highest surface at or below maxTop', () => {
    const w = new CollisionWorld({
      terrain: flat(0),
      // A 1 m crate, and a slab overhead from 3 to 3.2.
      boxes: [
        { x: 0, y: 0.5, z: 0, hx: 1, hy: 0.5, hz: 1, yaw: 0 },
        { x: 0, y: 3.1, z: 0, hx: 5, hy: 0.1, hz: 5, yaw: 0 },
      ],
      ramps: [],
      ladders: [],
    });
    const hit = { solid: -2 };
    expect(w.groundAt(0, 0, 0.3, 1.2, hit)).toBe(1);
    expect(hit.solid).toBe(0);
    expect(w.groundAt(0, 0, 0.3, 0.5, hit)).toBe(0);
    expect(hit.solid).toBe(-1);
    expect(w.groundAt(0, 0, 0.3, 10)).toBeCloseTo(3.2);
    // The circle overlaps the crate's edge from outside it.
    expect(w.groundAt(1.2, 0, 0.3, 1.2)).toBe(1);
    expect(w.groundAt(1.4, 0, 0.3, 1.2)).toBe(0);
    expect(w.ceilingAt(0, 0, 0.3, 1)).toBeCloseTo(3);
    expect(w.ceilingAt(4, 4, 0.3, 3.5)).toBe(Infinity);
  });

  it('stands on a ramp at its slope height', () => {
    const w = new CollisionWorld({ terrain: flat(0), boxes: [], ramps: [ramp], ladders: [] });
    expect(w.groundAt(0, 0, 0.3, 5)).toBeCloseTo(1);
    expect(w.groundAt(0, 1, 0.3, 5)).toBeCloseTo(1.5);
  });

  it('pushes a circle out of a rotated box along the shortest way', () => {
    const w = world({ boxes: [box(0, 0, 1, Math.PI / 4, 0)] });
    // Approaching the corner that points along +x (at x = √2).
    const pos = { x: Math.SQRT2 + 0.2, z: 0 };
    expect(w.pushOut(pos, 0.5, -0.5, 1)).toBe(true);
    // Pushed out until the circle just touches the box.
    expect(w.raycast(pos.x, 0, pos.z, -1, 0, 0, 10)).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(w.pushOut(pos, 0.5, -0.5, 1)).toBe(false);
  });

  it('pushes a centre that is inside out through the nearest side', () => {
    const w = world({ boxes: [{ x: 0, y: 0, z: 0, hx: 2, hy: 1, hz: 1, yaw: 0 }] });
    const pos = { x: 1.5, z: 0.5 };
    w.pushOut(pos, 0.3, -1, 1);
    expect(pos.x).toBeCloseTo(1.5);
    expect(pos.z).toBeCloseTo(1.3);
  });

  it('ignores solids below low or above high', () => {
    const w = world({ boxes: [box(0, 0, 1, 0, 0)] });
    expect(w.pushOut({ x: 1.2, z: 0 }, 0.5, 1, 3)).toBe(false);
    expect(w.pushOut({ x: 1.2, z: 0 }, 0.5, -5, -1)).toBe(false);
  });

  it('blocks the side of a ramp but not its foot', () => {
    const w = new CollisionWorld({ terrain: flat(0), boxes: [], ramps: [ramp], ladders: [] });
    // At the foot, the top is at 0: something to step onto.
    expect(w.pushOut({ x: 0, z: -2.2 }, 0.3, 0.45, 1.8)).toBe(false);
    // At the side near the high end, the top is above step height.
    expect(w.pushOut({ x: 1.2, z: 1.5 }, 0.3, 0.45, 1.8)).toBe(true);
  });
});
