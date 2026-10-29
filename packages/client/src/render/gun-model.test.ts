import type { WeaponState } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadItems } from '../content';
import { gunModel, knifeModel } from './gun-model';

const items = loadItems();
const rifle = (attachments: Partial<Record<'optic' | 'muzzle' | 'magazine', string>>) =>
  ({
    item: 'assault-rifle',
    mag: 0,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: { optic: null, muzzle: null, magazine: null, ...attachments },
  }) as WeaponState;

describe('gun models', () => {
  it('draws a bare gun with its irons and standard magazine', () => {
    const g = gunModel(rifle({}), items);
    expect(g.shapes).toHaveLength(6);
    expect(g.sight).toEqual([0, 0.065, -0.06]);
    expect(g.muzzle).toEqual([0, 0.02, -0.49]);
    expect(g.suppressed).toBe(false);
  });

  it('puts attachments on their mounts, hiding what they replace', () => {
    const g = gunModel(
      rifle({ optic: 'red-dot', muzzle: 'suppressor', magazine: 'mag-556-45' }),
      items,
    );
    // Irons and the standard magazine go; the red dot (4), suppressor (1) and mag (1) come.
    expect(g.shapes).toHaveLength(4 + 4 + 1 + 1);
    // The optic mount (0, 0.045, 0) plus the red dot's sight point.
    expect(g.sight[1]).toBeCloseTo(0.09);
    expect(g.sight[2]).toBeCloseTo(-0.09);
    // The muzzle mount plus the suppressor's own muzzle point.
    expect(g.muzzle[2]).toBeCloseTo(-0.65);
    expect(g.suppressed).toBe(true);
  });

  it('draws the knife from its item', () => {
    const k = knifeModel(items, 'knife');
    expect(k.shapes).toHaveLength(3);
    expect(k.grip).toEqual([0, -0.055, 0.005]);
  });
});
