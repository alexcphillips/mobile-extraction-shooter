import { describe, expect, it } from 'vitest';
import { createRng, nextFloat } from '../rng';
import { CellWalk, StaticGrid } from './grid';

describe('StaticGrid.query', () => {
  it('reports each item once, including items spanning many cells', () => {
    // Item 0 spans the whole grid, item 1 one cell, item 2 is off to the side.
    const rects = new Float64Array([0, 0, 40, 40, 1, 1, 2, 2, 30, 30, 31, 31]);
    const grid = new StaticGrid(0, 0, 40, 40, 4, rects);
    const out = new Uint32Array(3);
    const n = grid.query(0, 0, 5, 5, out);
    expect([...out.slice(0, n)].sort()).toEqual([0, 1]);
    expect(grid.query(10, 10, 11, 11, out)).toBe(1);
    expect(out[0]).toBe(0);
    expect(grid.query(29, 29, 29.5, 29.5, out)).toBe(2);
  });

  it('puts items outside the bounds in the edge cells', () => {
    const grid = new StaticGrid(0, 0, 40, 40, 4, new Float64Array([-10, -10, -5, -5]));
    expect(grid.query(0, 0, 1, 1, new Uint32Array(1))).toBe(1);
  });
});

describe('CellWalk', () => {
  /** Cells a ray passes through, found by sampling it finely. */
  function sampled(ox: number, oz: number, dx: number, dz: number, maxT: number): string[] {
    const cells: string[] = [];
    for (let t = 0; t <= maxT; t += 0.001) {
      const x = ox + dx * t;
      const z = oz + dz * t;
      if (x < 0 || z < 0 || x >= 40 || z >= 40) continue;
      const key = `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
      if (cells[cells.length - 1] !== key) cells.push(key);
    }
    return cells;
  }

  it('visits the same cells, in order, as sampling the ray', () => {
    const rng = createRng(3);
    const walk = new CellWalk();
    for (let n = 0; n < 200; n++) {
      // Some rays start outside the grid.
      const ox = nextFloat(rng) * 60 - 10;
      const oz = nextFloat(rng) * 60 - 10;
      const a = nextFloat(rng) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const cells: string[] = [];
      if (walk.begin(0, 0, 4, 10, 10, ox, oz, dx, dz, 30)) {
        do cells.push(`${walk.q},${walk.r}`);
        while (walk.next());
      }
      const expected = sampled(ox, oz, dx, dz, 30);
      // Sampling can miss a cell the ray only clips the corner of.
      expect(cells.filter((c) => expected.includes(c))).toEqual(expected);
      expect(cells.length - expected.length).toBeLessThanOrEqual(2);
    }
  });

  it('handles axis-aligned and vertical rays', () => {
    const walk = new CellWalk();
    expect(walk.begin(0, 0, 4, 10, 10, 1, 1, 1, 0, 100)).toBe(true);
    let count = 1;
    while (walk.next()) count++;
    expect(count).toBe(10);
    expect(walk.begin(0, 0, 4, 10, 10, 5, 5, 0, 0, 100)).toBe(true);
    expect([walk.q, walk.r]).toEqual([1, 1]);
    expect(walk.next()).toBe(false);
  });
});
