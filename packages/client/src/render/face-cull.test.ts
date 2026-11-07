import type { HeightGridDef, Shape } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { FaceCull } from './face-cull';
import { TriangleBuilder } from './geometry';

/** A 20 m square of ground, 2 m cells, at height h(x, z) (cell corners), maybe with holes. */
function ground(h: (x: number, z: number) => number = () => 0, holes?: number[]): HeightGridDef {
  const cols = 10;
  const heights: number[] = [];
  for (let j = 0; j <= cols; j++)
    for (let i = 0; i <= cols; i++) heights.push(h(i * 2 - 10, j * 2 - 10));
  const flags = holes
    ? Array.from({ length: cols * cols }, (_, k) => (holes.includes(k) ? 1 : 0))
    : undefined;
  return { minX: -10, minZ: -10, cellSize: 2, cols, rows: cols, heights, holes: flags };
}

function box(
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  more: Partial<Shape> = {},
): Shape {
  return {
    kind: 'box',
    x,
    y,
    z,
    yaw: 0,
    pitch: 0,
    roll: 0,
    colour: 0x808080,
    hx,
    hy,
    hz,
    ...more,
  } as Shape;
}

/** How many triangles a shape keeps, with these shapes covering and this ground. */
function kept(shape: Shape, covers: Shape[], terrain = ground()): number {
  const b = new TriangleBuilder(true, new FaceCull(covers, terrain));
  b.shape(shape);
  return b.triangles;
}

describe('hidden faces (2026-11-07)', () => {
  it('leaves out the faces where two boxes stack, and nothing else', () => {
    const low = box(0, 1.5, 0, 1, 0.5, 1);
    const high = box(0, 2.5, 0, 1, 0.5, 1);
    // Each loses the one face against the other.
    expect(kept(low, [low, high])).toBe(10);
    expect(kept(high, [low, high])).toBe(10);
  });

  it('keeps a face that only lines up with another box on the same side', () => {
    // Twins: every face of each is level with the other's, facing the same way.
    const a = box(0, 2, 0, 1, 1, 1);
    expect(kept(a, [a, box(0, 2, 0, 1, 1, 1)])).toBe(12);
  });

  it('keeps a face only partly covered', () => {
    const wide = box(0, 1.5, 0, 2, 0.5, 2);
    const small = box(0, 2.5, 0, 1, 0.5, 1);
    // The small box's bottom is on the wide one's top; the wide top shows round it (and
    // its bottom is a metre up).
    expect(kept(small, [wide, small])).toBe(10);
    expect(kept(wide, [wide, small])).toBe(12);
  });

  it('leaves out faces inside another box, turned', () => {
    const big = box(0, 2, 0, 2, 2, 2, { yaw: Math.PI / 4 });
    expect(kept(box(0, 2, 0, 0.5, 0.5, 0.5), [big])).toBe(0);
  });

  it('a box with a smaller top covers nothing', () => {
    const tapered = box(0, 2, 0, 2, 2, 2, { top: [1, 1] });
    expect(kept(box(0, 2, 0, 0.5, 0.5, 0.5), [tapered])).toBe(12);
  });

  it('leaves out a bottom on the ground, but not one in the air or over a hole', () => {
    expect(kept(box(0, 1, 0, 1, 1, 1), [])).toBe(10);
    // Sunk in: the bottom and the lowest part of each side are under, but the sides aren't wholly.
    expect(kept(box(0, 0.5, 0, 1, 1, 1), [])).toBe(10);
    expect(kept(box(0, 1.5, 0, 1, 0.5, 1), [])).toBe(12);
    // Cell 55 is x 0–2, z 0–2: under the box.
    expect(
      kept(
        box(0, 1, 0, 1, 1, 1),
        [],
        ground(() => 0, [55]),
      ),
    ).toBe(12);
  });

  it('keeps a bottom the ground dips under between its corners', () => {
    // A pit at the corner (0, 0) only, under the box's middle.
    const pit = ground((x, z) => (x === 0 && z === 0 ? -1 : 0));
    expect(kept(box(0, 1, 0, 1.5, 1, 1.5), [], pit)).toBe(12);
    // Laid flat on a slope: from its highest point, the downhill side is in the air; from
    // its lowest, all of the bottom is in the ground.
    const slope = ground((x) => x * 0.5);
    expect(kept(box(0, 1.5, 0, 1, 1, 1), [], slope)).toBe(12);
    expect(kept(box(0, 0.5, 0, 1, 1, 1), [], slope)).toBe(10);
  });

  it('keeps a bottom past the edge of the ground', () => {
    expect(kept(box(10, 1, 0, 1, 1, 1), [])).toBe(12);
  });

  it('leaves out ground under a floor laid on it', () => {
    const b = new TriangleBuilder(true, new FaceCull([box(0, 0.1, 0, 4, 0.1, 4)], ground()));
    b.terrain(ground(), 0, 10, 0, 10, 0x406020);
    // The floor covers the middle 8 × 8 m; nothing is drawn under it.
    const { area, middles } = surface(b);
    expect(area).toBeCloseTo(400 - 64, 6);
    for (const [x, z] of middles) expect(Math.abs(x) < 4 && Math.abs(z) < 4).toBe(false);
  });
});

describe('flat ground merged', () => {
  it('draws a flat square as one fan, a triangle per cell along its edge', () => {
    const b = new TriangleBuilder(true);
    b.terrain(ground(), 0, 10, 0, 10, 0x406020);
    expect(b.triangles).toBe(40);
    expect(surface(b).area).toBeCloseTo(400, 6);
    expect(surface(b).up).toBe(true);
  });

  it('meets the slope beside a merged patch corner to corner', () => {
    // Flat but for a bump at (6, 6): the cells round it are drawn one by one.
    const b = new TriangleBuilder(true);
    b.terrain(
      ground((x, z) => (x === 6 && z === 6 ? 1 : 0)),
      0,
      10,
      0,
      10,
      0x406020,
    );
    const pos = b.build().getAttribute('position');
    const corners: [number, number][] = [];
    for (let i = 0; i < pos.count; i++) corners.push([pos.getX(i), pos.getZ(i)]);
    // No corner of one triangle lies along another's edge, between its ends (a T-junction).
    for (let i = 0; i < pos.count; i += 3) {
      for (let e = 0; e < 3; e++) {
        const [ax, az] = corners[i + e]!;
        const [bx, bz] = corners[i + ((e + 1) % 3)]!;
        for (const [x, z] of corners) {
          const along =
            ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2);
          const off = (x - ax) * (bz - az) - (z - az) * (bx - ax);
          expect(Math.abs(off) > 1e-9 || along <= 1e-9 || along >= 1 - 1e-9).toBe(true);
        }
      }
    }
    expect(surface(b).area).toBeCloseTo(400, 6);
    expect(surface(b).up).toBe(true);
  });

  it('leaves holes out', () => {
    const b = new TriangleBuilder(true);
    b.terrain(
      ground(() => 0, [0, 55]),
      0,
      10,
      0,
      10,
      0x406020,
    );
    expect(surface(b).area).toBeCloseTo(400 - 8, 6);
  });
});

/** What a builder drew, seen from above: area, each triangle's middle, and whether all face up. */
function surface(b: TriangleBuilder) {
  const pos = b.build().getAttribute('position');
  let area = 0;
  let up = true;
  const middles: [number, number][] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const [ax, az, bx, bz, cx, cz] = [
      pos.getX(i),
      pos.getZ(i),
      pos.getX(i + 1),
      pos.getZ(i + 1),
      pos.getX(i + 2),
      pos.getZ(i + 2),
    ];
    // y of (b − a) × (c − a).
    const cross = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    up &&= cross > 0;
    area += Math.abs(cross) / 2;
    middles.push([(ax + bx + cx) / 3, (az + bz + cz) / 3]);
  }
  return { area, middles, up };
}
