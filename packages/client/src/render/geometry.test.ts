import { modelShapes, partSchema } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { mirrorPart } from '../item-editor/model-edit';
import { TriangleBuilder } from './geometry';

/** A slab's mesh: its points' bounds, and how far from each corner of its box it reaches. */
function slab(corners: [number, number, number, number], segments?: number) {
  const part = partSchema.parse({
    type: 'slab',
    pos: [0, 0, 0],
    size: [0.2, 0.04, 0.1],
    corners,
    color: '#aa3322',
    ...(segments !== undefined && { segments }),
  });
  const b = new TriangleBuilder(true);
  for (const s of modelShapes({ parts: [part] })) b.shape(s);
  const pos = b.build().getAttribute('position');
  const points: [number, number, number][] = [];
  for (let i = 0; i < pos.count; i++) points.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  /** How close the outline comes to a box corner (sx, sz are ±1). */
  const reach = (sx: number, sz: number) =>
    Math.min(...points.map(([x, , z]) => Math.hypot(x - sx * 0.1, z - sz * 0.05)));
  return { triangles: b.triangles, points, reach };
}

describe('slab parts (2026-11-02)', () => {
  it('rounds each corner by its own radius, inside its box', () => {
    // A steak: the back two corners rounded more than the front.
    const s = slab([0.04, 0.04, 0.01, 0]);
    for (const [x, y, z] of s.points) {
      expect(Math.abs(x)).toBeLessThanOrEqual(0.1 + 1e-6);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.02 + 1e-6);
      expect(Math.abs(z)).toBeLessThanOrEqual(0.05 + 1e-6);
    }
    // A corner of radius r is cut back r(√2 − 1) from the box's corner; 0 stays square.
    expect(s.reach(-1, -1)).toBeCloseTo(0.04 * (Math.SQRT2 - 1), 4);
    expect(s.reach(1, -1)).toBeCloseTo(0.04 * (Math.SQRT2 - 1), 4);
    expect(s.reach(1, 1)).toBeCloseTo(0.01 * (Math.SQRT2 - 1), 4);
    expect(s.reach(-1, 1)).toBeCloseTo(0, 6);
  });

  it('cuts a radius down to half the depth, and steps by its segments', () => {
    const big = slab([1, 1, 1, 1]);
    // Cut to 0.05 (half the depth): the ends are half circles.
    expect(big.reach(-1, -1)).toBeCloseTo(0.05 * (Math.SQRT2 - 1), 4);
    // Sides, top and bottom: 4 corners of 4 steps (5 points each) make 20 sides.
    expect(slab([0.02, 0.02, 0.02, 0.02]).triangles).toBe(20 * 2 + 2 * 18);
    expect(slab([0.02, 0.02, 0.02, 0.02], 1).triangles).toBe(8 * 2 + 2 * 6);
  });

  it('mirrors left for right', () => {
    const p = partSchema.parse({
      type: 'slab',
      pos: [0.1, 0, 0],
      size: [0.2, 0.04, 0.1],
      corners: [0.04, 0.03, 0.02, 0.01],
      color: '#aa3322',
    });
    expect(mirrorPart(p)).toMatchObject({ pos: [-0.1, 0, 0], corners: [0.03, 0.04, 0.01, 0.02] });
  });
});

describe('terrain cliffs (2026-11-14)', () => {
  it('colors triangles steeper than the walk limit with the cliff color', () => {
    // Two cells along x: a 0.5 m rise over 2 m (walkable), then 4 m over 2 m (a cliff).
    const row = [0, 0.5, 4.5];
    const t = { minX: 0, minZ: 0, cellSize: 2, cols: 2, rows: 1, heights: [...row, ...row] };
    const b = new TriangleBuilder(false);
    b.terrain(t, 0, 2, 0, 1, 0x00ff00, 0xff0000);
    const g = b.build();
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    const seen = { gentle: new Set<string>(), steep: new Set<string>() };
    for (let v = 0; v < pos.count; v += 3) {
      const x = (pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2)) / 3;
      const rgb = [col.getX(v), col.getY(v), col.getZ(v)].map((n) => Math.round(n)).join();
      seen[x < 2 ? 'gentle' : 'steep'].add(rgb);
    }
    expect([...seen.gentle]).toEqual(['0,1,0']);
    expect([...seen.steep]).toEqual(['1,0,0']);
  });
});
