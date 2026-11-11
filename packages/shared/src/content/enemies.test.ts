import { describe, expect, it } from 'vitest';
import { mirrorShape, outfitSchema, platingShapes } from './enemies';

const colors = {
  skin: '#000000',
  top: '#000000',
  bottom: '#000000',
  hands: '#000000',
  feet: '#000000',
};

describe('plating (Jug, 2026-11-08)', () => {
  it('mirrors a group onto the twin bone, flipped across x', () => {
    const outfit = outfitSchema.parse({
      ...colors,
      plating: [
        {
          bone: 'upperArmL',
          mirror: true,
          parts: [
            {
              type: 'box',
              pos: [-0.2, 1.5, 0.06],
              size: [0.1, 0.1, 0.1],
              roll: 12,
              yaw: 5,
              pitch: 7,
              color: '#5f6469',
            },
          ],
        },
        {
          bone: 'hips',
          parts: [{ type: 'box', pos: [0, 1, 0], size: [0.3, 0.06, 0.25], color: '#3e3a2e' }],
        },
      ],
    });
    const groups = platingShapes(outfit.plating);
    expect(groups.map((g) => g.bone)).toEqual(['upperArmL', 'upperArmR', 'hips']);
    const [left, right] = [groups[0]!.shapes[0]!, groups[1]!.shapes[0]!];
    expect(right.x).toBeCloseTo(-left.x);
    expect(right.y).toBe(left.y);
    expect(right.z).toBe(left.z);
    expect(right.roll).toBeCloseTo(-left.roll);
    expect(right.yaw).toBeCloseTo(-left.yaw);
    expect(right.pitch).toBe(left.pitch);
  });

  it('swaps a slab’s left and right corners', () => {
    const slab = mirrorShape({
      kind: 'slab',
      x: 0.1,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      color: 0,
      hx: 0.1,
      hy: 0.1,
      hz: 0.1,
      corners: [1, 2, 3, 4],
      segments: 4,
    });
    expect(slab.kind === 'slab' && slab.corners).toEqual([2, 1, 4, 3]);
  });

  it('leaves an outfit without plating as it was', () => {
    expect(platingShapes(outfitSchema.parse(colors).plating)).toEqual([]);
  });

  it('rejects a bone the body does not have', () => {
    const bad = {
      ...colors,
      plating: [
        {
          bone: 'tail',
          parts: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], color: '#000000' }],
        },
      ],
    };
    expect(outfitSchema.safeParse(bad).success).toBe(false);
  });
});
