import type { WeaponState } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadItems } from '../content';
import { gunModel, knifeModel } from './gun-model';

const items = loadItems();
const rifle = (attachments: Partial<Record<'optic' | 'muzzle' | 'magazine', string>>) =>
  ({
    item: 'akm',
    mag: 0,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: { optic: null, muzzle: null, magazine: null, laser: null, ...attachments },
  }) as WeaponState;

describe('gun models', () => {
  it('draws a bare gun with its irons and standard magazine', () => {
    const g = gunModel(rifle({}), items);
    expect(g.shapes).toHaveLength(23);
    expect(g.sight).toEqual([0, 0.06, -0.19]);
    expect(g.muzzle).toEqual([0, 0.005, -0.57]);
    expect(g.suppressed).toBe(false);
  });

  it('puts attachments on their mounts, hiding what they replace', () => {
    const g = gunModel(
      rifle({ optic: 'red-dot', muzzle: 'suppressor', magazine: 'mag-762x39-45' }),
      items,
    );
    // The rear sight (3), slant brake and standard magazine (2) go; the red dot (5),
    // suppressor (1) and mag (2) come.
    expect(g.shapes).toHaveLength(23 - 6 + 5 + 1 + 2);
    // The optic mount (0, 0.041, -0.04) plus the red dot's sight point.
    expect(g.sight[1]).toBeCloseTo(0.076);
    expect(g.sight[2]).toBeCloseTo(-0.13);
    // The muzzle mount plus the suppressor's own muzzle point.
    expect(g.muzzle[2]).toBeCloseTo(-0.7);
    expect(g.suppressed).toBe(true);
  });

  it('counts a built-in suppressor, with nothing fitted', () => {
    expect(gunModel({ ...rifle({}), item: 'as-val' }, items).suppressed).toBe(true);
  });

  it('draws the knife from its item', () => {
    const k = knifeModel(items, 'knife');
    expect(k.shapes).toHaveLength(4);
    expect(k.grip).toEqual([0, -0.055, 0.005]);
  });
});
