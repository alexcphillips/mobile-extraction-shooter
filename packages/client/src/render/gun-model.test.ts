import type { WeaponState } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadItems } from '../content';
import { gunModel, knifeModel } from './gun-model';

const items = loadItems();
const rifle = (attachments: Partial<Record<'optic' | 'muzzle' | 'magazine' | 'stock', string>>) =>
  ({
    item: 'akm',
    mag: 0,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: {
      optic: null,
      muzzle: null,
      magazine: null,
      laser: null,
      stock: null,
      ...attachments,
    },
  }) as WeaponState;

describe('gun models', () => {
  it('draws a bare gun with its irons and standard magazine', () => {
    const g = gunModel(rifle({}), items);
    // No stock or magazine: parts since WF-1 and MG-1 (3 boxes and 2).
    expect(g.shapes).toHaveLength(18);
    expect(g.sight).toEqual([0, 0.06, -0.19]);
    expect(g.muzzle).toEqual([0, 0.005, -0.57]);
    expect(g.suppressed).toBe(false);
  });

  it('puts attachments on their mounts, hiding what they replace', () => {
    const g = gunModel(
      rifle({ optic: 'red-dot', muzzle: 'suppressor', magazine: 'mag-762x39-45' }),
      items,
    );
    // The rear sight (3) and slant brake go; the red dot (5), suppressor (1) and mag (2)
    // come.
    expect(g.shapes).toHaveLength(18 - 4 + 5 + 1 + 2);
    // The optic mount (0, 0.041, -0.04) plus the red dot's sight point.
    expect(g.sight[1]).toBeCloseTo(0.076);
    expect(g.sight[2]).toBeCloseTo(-0.13);
    // The muzzle mount plus the suppressor's own muzzle point.
    expect(g.muzzle[2]).toBeCloseTo(-0.7);
    expect(g.suppressed).toBe(true);
  });

  it('puts the stock on its mount, folded about the hinge when folded (WF-1)', () => {
    const g = gunModel(rifle({ stock: 'akm-stock' }), items);
    expect(g.shapes).toHaveLength(21);
    const butt = (w: WeaponState) => {
      const shapes = gunModel(w, items).shapes;
      return shapes[shapes.length - 1]!;
    };
    // The AK-74M's mount folds any stock along its left side.
    const ak = { ...rifle({ stock: 'ak-74m-stock' }), item: 'ak-74m' };
    const open = butt(ak);
    const shut = butt({ ...ak, folded: true });
    expect(open.z).toBeGreaterThan(0.3);
    expect(shut.z).toBeLessThan(0);
    expect(shut.x).toBeLessThan(-0.04);
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
