import { describe, expect, it } from 'vitest';
import { makeRng } from './shade';
import { BoxGrid, type Box } from './raycast';

const box = (x: number, z: number, h: number, yaw = 0): Box => ({
  x,
  y: 0,
  z,
  hx: h,
  hy: h,
  hz: h,
  yaw,
});

describe('BoxGrid.raycast', () => {
  it('hits an axis-aligned box', () => {
    const grid = new BoxGrid([box(0, 0, 1)], -50, -50, 100, 8);
    expect(grid.raycast(-5, 0, 0, 1, 0, 0, 100)).toBeCloseTo(4);
    expect(grid.raycast(-5, 3, 0, 1, 0, 0, 100)).toBe(Infinity);
    expect(grid.raycast(-5, 0, 0, 1, 0, 0, 3)).toBe(Infinity);
  });

  it('hits a rotated box on its corner', () => {
    const grid = new BoxGrid([box(0, 0, 1, Math.PI / 4)], -50, -50, 100, 8);
    expect(grid.raycast(-5, 0, 0, 1, 0, 0, 100)).toBeCloseTo(5 - Math.SQRT2);
  });

  it('returns 0 from inside a box', () => {
    const grid = new BoxGrid([box(0, 0, 1)], -50, -50, 100, 8);
    expect(grid.raycast(0, 0, 0, 0, 0, 1, 100)).toBe(0);
  });

  it('matches brute force over many boxes and rays', () => {
    const rng = makeRng(1);
    const boxes = Array.from({ length: 300 }, () => ({
      x: rng() * 180 - 90,
      y: rng() * 4,
      z: rng() * 180 - 90,
      hx: 0.5 + rng() * 3,
      hy: 0.5 + rng() * 3,
      hz: 0.5 + rng() * 3,
      yaw: rng() * Math.PI * 2,
    }));
    const grid = new BoxGrid(boxes, -100, -100, 200, 8);
    const singles = boxes.map((b) => new BoxGrid([b], -100, -100, 200, 200));
    for (let n = 0; n < 500; n++) {
      const a = rng() * Math.PI * 2;
      const e = (rng() - 0.5) * 0.5;
      const [dx, dy, dz] = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      const [ox, oy, oz] = [rng() * 160 - 80, rng() * 4, rng() * 160 - 80];
      const expected = Math.min(...singles.map((g) => g.raycast(ox, oy, oz, dx, dy, dz, 80)));
      const got = grid.raycast(ox, oy, oz, dx, dy, dz, 80);
      if (expected === Infinity) expect(got).toBe(Infinity);
      else expect(got).toBeCloseTo(expected, 4);
    }
  });
});
