import { describe, expect, it } from 'vitest';
import {
  entranceEnds,
  heightAt,
  layoutSchema,
  rectCorners,
  rectDistance,
  toLocal,
  toWorld,
  type LayoutDef,
} from './layouts';

const base = {
  formatVersion: 1,
  id: 'test',
  bounds: { x0: 0, z0: 0, x1: 100, z1: 100 },
};
const parse = (extra: object): LayoutDef => layoutSchema.parse({ ...base, ...extra });
const problems = (extra: object): string[] => {
  const r = layoutSchema.safeParse({ ...base, ...extra });
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('layouts (MK-3)', () => {
  it('fills the defaults in', () => {
    const l = parse({ areas: [{ id: 'a', x: 10, z: 10, w: 8, d: 6 }] });
    expect(l.areas[0]).toMatchObject({
      yaw: 0,
      floors: 1,
      floorHeight: 4,
      tier: 'full',
      entrances: [],
    });
    expect(l.pads).toEqual([]);
  });

  it('turns rects as maps do: yaw 0 faces −z, yaw 90 faces −x', () => {
    const r = { x: 10, z: 20, w: 4, d: 2, yaw: 90 };
    // Its front's middle (local 0, −1) lies to its −x.
    const [fx, fz] = toWorld(r, 0, -1);
    expect(fx).toBeCloseTo(9);
    expect(fz).toBeCloseTo(20);
    const [lx, lz] = toLocal(r, 13, 21.5);
    expect(toWorld(r, lx, lz).map((v) => +v.toFixed(6))).toEqual([13, 21.5]);
    expect(rectCorners({ ...r, yaw: 0 })).toEqual([
      [8, 19],
      [12, 19],
      [12, 21],
      [8, 21],
    ]);
    expect(rectDistance({ ...r, yaw: 0 }, 15, 20)).toBeCloseTo(3);
  });

  it('heightAt: the slope, a flat pad, its bank eased, a wall sheer', () => {
    const l = parse({
      slope: { low: [0, 100], lowY: 0, high: [0, 0], highY: 10 },
      pads: [
        { id: 'bank', x: 25, z: 50, w: 10, d: 10, y: 20, blend: 10 },
        { id: 'wall', x: 75, z: 50, w: 10, d: 10, y: -4, edge: 'wall' },
      ],
    });
    expect(heightAt(l, 50, 100)).toBeCloseTo(0);
    expect(heightAt(l, 50, 0)).toBeCloseTo(10);
    expect(heightAt(l, 50, 150)).toBeCloseTo(0); // level past the low end
    expect(heightAt(l, 25, 50)).toBe(20);
    // Halfway down the bank: halfway between the pad and the slope (5 m there).
    expect(heightAt(l, 35, 50)).toBeCloseTo(12.5);
    expect(heightAt(l, 41, 50)).toBeCloseTo(5);
    expect(heightAt(l, 80, 50)).toBe(-4);
    expect(heightAt(l, 80.01, 50)).toBeCloseTo(5);
  });

  it('puts a way in on its side, facing out', () => {
    const l = parse({
      areas: [
        {
          id: 'a',
          x: 0,
          z: 0,
          w: 10,
          d: 6,
          yaw: 90,
          entrances: [{ side: 'front', along: 2, width: 2 }],
        },
      ],
    });
    const { from, to, out } = entranceEnds(l.areas[0]!, l.areas[0]!.entrances[0]!);
    // Turned 90°, the front faces −x: the way in is on x = −3, from z = −1 to −3.
    expect(from.map((v) => +v.toFixed(6))).toEqual([-3, -1]);
    expect(to.map((v) => +v.toFixed(6))).toEqual([-3, -3]);
    expect(out.map((v) => +v.toFixed(6) + 0)).toEqual([-1, 0]);
  });

  it('refuses clashing ids, a way in off its side or floor, an unknown poi, bad bounds', () => {
    expect(
      problems({
        pads: [{ id: 'x', x: 0, z: 0, w: 1, d: 1, y: 0 }],
        zones: [
          {
            id: 'x',
            points: [
              [0, 0],
              [1, 0],
              [0, 1],
            ],
          },
        ],
      }),
    ).toEqual(['"x" is used twice']);
    expect(
      problems({
        areas: [
          {
            id: 'a',
            x: 0,
            z: 0,
            w: 4,
            d: 4,
            poi: 'mall',
            floors: 2,
            entrances: [
              { side: 'left', along: 1.5, width: 2 },
              { side: 'back', floor: 2 },
            ],
          },
        ],
      }),
    ).toEqual(['no poi "mall"', 'runs past the end of its side (4 m)', 'the area has 2 floors']);
    expect(problems({ bounds: { x0: 0, z0: 0, x1: 0, z1: 10 } })).toEqual([
      'x1 and z1 must be past x0 and z0',
    ]);
  });
});
