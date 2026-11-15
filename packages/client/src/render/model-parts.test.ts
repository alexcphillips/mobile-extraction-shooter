import { modelShapes, type ModelPart } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { mirrorPart } from '../item-editor/model-edit';
import { TriangleBuilder } from './geometry';

const draw = (parts: ModelPart[]): Float32Array => {
  const b = new TriangleBuilder(false);
  for (const s of modelShapes({ parts })) b.shape(s);
  return b.build().getAttribute('position').array as Float32Array;
};
/** Every drawn corner, rounded, sorted: what a part looks like, whatever its triangles. */
const corners = (parts: ModelPart[]): string[] => {
  const p = draw(parts);
  const out = new Set<string>();
  for (let i = 0; i < p.length; i += 3)
    out.add(
      [p[i]!, p[i + 1]!, p[i + 2]!].map((n) => (Math.round(n * 1e4) / 1e4 || 0).toFixed(4)).join(),
    );
  return [...out].sort();
};

const loft: ModelPart = {
  type: 'loft',
  pos: [0.1, 1, 0],
  yaw: 20,
  pitch: 10,
  roll: 5,
  sides: 6,
  rings: [
    [-0.1, 0.1, 0.08, 0.01, 0],
    [0, 0.12, 0.1],
    [0.1, 0.06, 0.05, 0, 0.02],
  ],
  color: '#556677',
};
const hull: ModelPart = {
  type: 'hull',
  pos: [0.1, 1, -0.1],
  yaw: 30,
  roll: -12,
  points: [
    [0, 0, 0],
    [0.1, 0, 0],
    [0, 0.12, 0.01],
    [0.02, 0.03, 0.08],
    [0.05, 0.05, 0.03],
  ],
  color: '#556677',
};

describe('loft and hull parts (CH-3a)', () => {
  it('draws a loft as sides × 2 per segment plus two capped ends', () => {
    expect(draw([loft]).length / 9).toBe(6 * 2 * 2 + 2 * (6 - 2));
  });

  it('draws a hull closed: 2 × points − 4 triangles', () => {
    // Five points, none inside: a closed hull of 5 has 6 triangles.
    expect(draw([hull]).length / 9).toBe(6);
  });

  it('mirrors both into true mirror images along x, y and z', () => {
    for (const part of [loft, hull])
      for (const [k, axis] of (['x', 'y', 'z'] as const).entries()) {
        const flipped = corners([part]).map((c) => {
          const v = c.split(',').map(Number);
          v[k] = -v[k]! || 0;
          return v.map((n) => n.toFixed(4)).join();
        });
        expect(corners([mirrorPart(part, axis)]), `${part.type} ${axis}`).toEqual(flipped.sort());
      }
  });
});
