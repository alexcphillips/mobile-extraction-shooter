import { describe, expect, it } from 'vitest';
import { centerline, gradeRoads, roadStrip, ROAD } from './roads';
import { HeightGrid, type HeightGridDef } from './terrain';

/** A 200 × 200 m grid of 2 m cells, its corners from `height`. */
function grid(height: (x: number, z: number) => number): HeightGridDef & { heights: number[] } {
  const cols = 100;
  const rows = 100;
  const heights: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) heights.push(height(i * 2, j * 2));
  return { minX: 0, minZ: 0, cellSize: 2, cols, rows, heights };
}

const bumpy = (x: number, z: number) => 0.05 * x + Math.sin(x / 7) * 1.5 + Math.cos(z / 5);

describe('centerline', () => {
  it('runs through both ends, a sample a meter or so apart', () => {
    const { x, z } = centerline([
      [10, 10],
      [60, 10],
      [60, 70],
    ]);
    expect([x[0], z[0]]).toEqual([10, 10]);
    expect([x.at(-1), z.at(-1)]).toEqual([60, 70]);
    for (let k = 1; k < x.length; k++)
      expect(Math.hypot(x[k]! - x[k - 1]!, z[k]! - z[k - 1]!)).toBeLessThanOrEqual(1.01);
  });

  it('rounds a corner: no sample comes within the arc of it', () => {
    const { x, z } = centerline([
      [10, 10],
      [60, 10],
      [60, 70],
    ]);
    const nearest = Math.min(...x.map((v, k) => Math.hypot(v - 60, z[k]! - 10)));
    // A 12 m arc round a right angle passes 12(√2 − 1) ≈ 5 m from the corner.
    expect(nearest).toBeGreaterThan(4.5);
    expect(nearest).toBeLessThan(5.5);
  });

  it('keeps a corner sharp with no radius', () => {
    const { x, z } = centerline(
      [
        [10, 10],
        [60, 10],
        [60, 70],
      ],
      0,
    );
    expect(x.some((v, k) => v === 60 && z[k] === 10)).toBe(true);
  });
});

describe('gradeRoads', () => {
  it('levels the ground across a road and leaves it alone far off', () => {
    const t = grid(bumpy);
    const before = t.heights.slice();
    gradeRoads(t, t.heights, [
      {
        points: [
          [20, 100],
          [180, 100],
        ],
        width: 8,
      },
    ]);
    const g = new HeightGrid(t);
    for (let x = 30; x <= 170; x += 10) {
      const mid = g.heightAt(x, 100);
      // Across the surface, level.
      expect(g.heightAt(x, 96)).toBeCloseTo(mid, 6);
      expect(g.heightAt(x, 104)).toBeCloseTo(mid, 6);
    }
    // Past the shoulder, as it was.
    const k = 20 * 101 + 50; // (100, 40)
    expect(t.heights[k]).toBe(before[k]);
  });

  it('smooths the bumps along it', () => {
    const t = grid(bumpy);
    const [line] = gradeRoads(t, t.heights, [
      {
        points: [
          [20, 100],
          [180, 100],
        ],
        width: 8,
      },
    ]);
    const steepest = Math.max(...line!.y.slice(1).map((y, k) => Math.abs(y - line!.y[k]!)));
    // The ground's own steepest is 0.05 + 1.5 / 7 ≈ 0.26 a meter.
    expect(steepest).toBeLessThan(0.15);
  });

  it('holds a road to its steepest grade', () => {
    const t = grid((x) => (x > 100 ? 10 : 0));
    const [line] = gradeRoads(t, t.heights, [
      {
        points: [
          [20, 100],
          [180, 100],
        ],
        width: 6,
        maxGrade: 0.08,
      },
    ]);
    for (let k = 1; k < line!.y.length; k++)
      expect(Math.abs(line!.y[k]! - line!.y[k - 1]!)).toBeLessThanOrEqual(0.08 + 1e-9);
  });

  it('meets a road it joins at that road’s height, and leaves its surface alone', () => {
    const t = grid(bumpy);
    const lines = gradeRoads(t, t.heights, [
      {
        points: [
          [20, 100],
          [180, 100],
        ],
        width: 8,
      },
      {
        points: [
          [100, 20],
          [100, 100],
        ],
        width: 6,
      },
    ]);
    const [main, side] = lines;
    const g = new HeightGrid(t);
    const at = main!.x.findIndex((x) => x >= 100);
    expect(side!.y.at(-1)).toBeCloseTo(main!.y[at]!, 1);
    // The main road is still level across where the side road comes in.
    expect(g.heightAt(100, 96)).toBeCloseTo(g.heightAt(100, 104), 6);
  });
});

describe('roadStrip', () => {
  it('lies just over the graded ground, a road width across', () => {
    const t = grid(bumpy);
    const roads = [
      {
        points: [
          [20, 100],
          [180, 100],
        ] as [number, number][],
        width: 8,
      },
    ];
    const [line] = gradeRoads(t, t.heights, roads);
    const s = roadStrip(t, t.heights, line!, 8);
    const g = new HeightGrid(t);
    expect(s.length).toBe(line!.x.length * 6);
    for (let k = 0; k < s.length; k += 6) {
      expect(Math.hypot(s[k]! - s[k + 3]!, s[k + 2]! - s[k + 5]!)).toBeCloseTo(8, 6);
      expect(s[k + 1]! - g.heightAt(s[k]!, s[k + 2]!)).toBeCloseTo(ROAD.lift, 6);
    }
  });
});
