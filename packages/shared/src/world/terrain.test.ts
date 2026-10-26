import { describe, expect, it } from 'vitest';
import { createRng, nextFloat } from '../rng';
import { HeightGrid, type SurfaceHit } from './terrain';

const hills = (x: number, z: number): number =>
  3 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 1.5 * Math.sin(x * 0.13 + z * 0.09);

describe('HeightGrid', () => {
  it('rejects the wrong number of heights', () => {
    expect(
      () => new HeightGrid({ minX: 0, minZ: 0, cellSize: 1, cols: 2, rows: 2, heights: [0] }),
    ).toThrow();
  });

  it('matches the corners and is planar within each triangle', () => {
    // One cell with corners 0 (i, j), 1 (i+1, j), 2 (i, j+1), 5 (i+1, j+1).
    const g = new HeightGrid({
      minX: 0,
      minZ: 0,
      cellSize: 2,
      cols: 1,
      rows: 1,
      heights: [0, 1, 2, 5],
    });
    expect(g.heightAt(0, 0)).toBeCloseTo(0);
    expect(g.heightAt(2, 0)).toBeCloseTo(1);
    expect(g.heightAt(0, 2)).toBeCloseTo(2);
    expect(g.heightAt(2, 2)).toBeCloseTo(5);
    // Triangle A (u + v ≤ 1) and triangle B (u + v ≥ 1).
    expect(g.heightAt(0.5, 0.5)).toBeCloseTo(0 + 0.25 * 1 + 0.25 * 2);
    expect(g.heightAt(1.5, 1.5)).toBeCloseTo(5 - 0.25 * (5 - 2) - 0.25 * (5 - 1));
    // The diagonal is shared, so both halves agree on it.
    expect(g.heightAt(1, 1)).toBeCloseTo(1.5);
    const grad = { x: 0, z: 0 };
    g.gradientAt(0.5, 0.5, grad);
    expect(grad).toEqual({ x: 0.5, z: 1 });
    g.gradientAt(1.5, 1.5, grad);
    expect(grad).toEqual({ x: 1.5, z: 2 });
  });

  it('clamps outside the grid to its edge', () => {
    const g = HeightGrid.fromFunction(0, 0, 1, 4, 4, (x) => x);
    expect(g.heightAt(-5, 2)).toBeCloseTo(0);
    expect(g.heightAt(10, 2)).toBeCloseTo(4);
  });

  it('raycasts to the same point as marching the ray', () => {
    const g = HeightGrid.fromFunction(-64, -64, 2, 64, 64, hills);
    const rng = createRng(5);
    const hit: SurfaceHit = { distance: 0, nx: 0, ny: 0, nz: 0 };
    let hits = 0;
    for (let n = 0; n < 300; n++) {
      const ox = nextFloat(rng) * 100 - 50;
      const oz = nextFloat(rng) * 100 - 50;
      const oy = g.heightAt(ox, oz) + 0.5 + nextFloat(rng) * 4;
      const a = nextFloat(rng) * Math.PI * 2;
      const e = -0.05 - nextFloat(rng) * 0.6;
      const [dx, dy, dz] = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      let expected = Infinity;
      for (let t = 0; t <= 60; t += 0.002) {
        const x = ox + dx * t;
        const z = oz + dz * t;
        // There's no terrain past the grid's edge.
        if (Math.abs(x) > 64 || Math.abs(z) > 64) break;
        if (oy + dy * t < g.heightAt(x, z)) {
          expected = t;
          break;
        }
      }
      const got = g.raycast(ox, oy, oz, dx, dy, dz, 60, hit);
      if (expected === Infinity) expect(got).toBe(Infinity);
      else {
        hits++;
        expect(got).toBeCloseTo(expected, 2);
        expect(hit.ny).toBeGreaterThan(0);
        expect(Math.hypot(hit.nx, hit.ny, hit.nz)).toBeCloseTo(1);
      }
    }
    expect(hits).toBeGreaterThan(100);
  });

  it('returns 0 from under the ground and skips rays above every hill', () => {
    const g = HeightGrid.fromFunction(0, 0, 1, 8, 8, () => 1);
    expect(g.raycast(4, 0.5, 4, 1, 0, 0, 10)).toBe(0);
    expect(g.raycast(4, 2, 4, 0, 1, 0, 10)).toBe(Infinity);
    expect(g.raycast(4, 2, 4, 0, -1, 0, 10)).toBeCloseTo(1);
  });
});
