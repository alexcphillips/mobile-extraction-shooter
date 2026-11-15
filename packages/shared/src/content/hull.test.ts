import { describe, expect, it } from 'vitest';
import { convexHull, loftPieces, loftRing, type P3 } from './hull';
import { ITEM_FORMAT } from './items';
import { loadContent } from './format';

const cube: P3[] = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [x, y, z] as P3)));
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('convex hull (CH-3a)', () => {
  it('closes a cube with outward triangles, leaving inside points out', () => {
    const faces = convexHull([...cube, [0.5, 0.5, 0.5]])!;
    expect(faces).toHaveLength(12);
    expect(faces.flat()).not.toContain(8);
    const mid: P3 = [0.5, 0.5, 0.5];
    for (const [a, b, c] of faces) {
      const pts = [cube[a]!, cube[b]!, cube[c]!];
      const n = cross(sub(pts[1]!, pts[0]!), sub(pts[2]!, pts[0]!));
      expect(dot(n, sub(pts[0]!, mid))).toBeGreaterThan(0);
    }
    // Closed: every edge is used once each way.
    const edges = new Set(faces.flatMap(([a, b, c]) => [`${a},${b}`, `${b},${c}`, `${c},${a}`]));
    for (const e of edges) expect(edges.has(e.split(',').reverse().join(','))).toBe(true);
  });

  it('has no hull for points on one plane', () => {
    expect(convexHull(cube.filter((p) => p[1] === 0))).toBeNull();
  });

  it('puts loft rings flat face forward, sized face to face', () => {
    const ring = loftRing([0.2, 0.3, 0.1, 0.05, 0], 8);
    const xs = ring.map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(0.05 + 0.15, 6);
    expect(Math.min(...ring.map((p) => p[2]))).toBeCloseTo(-0.05, 6);
    expect(ring.every((p) => p[1] === 0.2)).toBe(true);
    expect(
      loftPieces(
        [
          [0, 1, 1],
          [1, 1, 1],
          [2, 0.5, 0.5],
        ],
        6,
      ),
    ).toHaveLength(2);
  });

  it('refuses lofts whose rings go down and flat hulls', () => {
    const item = (part: unknown) => ({
      formatVersion: 12,
      id: 'thing',
      name: 'Thing',
      type: 'loot',
      size: [1, 1],
      value: 1,
      weight: 0.1,
      rarity: 'common',
      model: { parts: [part] },
    });
    const loft = { type: 'loft', pos: [0, 0, 0], color: '#000000' };
    expect(() =>
      loadContent(
        ITEM_FORMAT,
        item({
          ...loft,
          rings: [
            [0, 1, 1],
            [1, 1, 1],
          ],
        }),
        't',
      ),
    ).not.toThrow();
    expect(() =>
      loadContent(
        ITEM_FORMAT,
        item({
          ...loft,
          rings: [
            [1, 1, 1],
            [0, 1, 1],
          ],
        }),
        't',
      ),
    ).toThrow(/go up in y/);
    const flat = {
      type: 'hull',
      pos: [0, 0, 0],
      color: '#000000',
      points: cube.filter((p) => p[1] === 0),
    };
    expect(() => loadContent(ITEM_FORMAT, item(flat), 't')).toThrow(/plane/);
  });
});
