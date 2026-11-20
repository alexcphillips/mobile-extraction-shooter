import { type WeaponState, noAttachments } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadItems } from '../content';
import { scopeEyeDistance } from '../hud/optic';
import { gunKey, gunModel, knifeModel } from './gun-model';

const items = loadItems();
const rifle = (attachments: Partial<Record<'optic' | 'muzzle' | 'magazine' | 'stock', string>>) =>
  ({
    item: 'akm',
    mag: 0,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: { ...noAttachments(), ...attachments },
  }) as WeaponState;

describe('gun models', () => {
  it('draws a bare gun with its irons and standard magazine', () => {
    const g = gunModel(rifle({}), items);
    // Its factory stock (AT-1b, 3 boxes), and no magazine: a part since MG-1.
    expect(g.shapes).toHaveLength(21);
    expect(g.sight).toEqual([0, 0.06, -0.19]);
    expect(g.muzzle).toEqual([0, 0.005, -0.57]);
    expect(g.suppressed).toBe(false);
  });

  it('puts attachments on their mounts, hiding what they replace', () => {
    const g = gunModel(
      rifle({ optic: 'red-dot', muzzle: 'field-suppressor', magazine: 'mag-762x39-45' }),
      items,
    );
    // The rear sight (3) and slant brake go; the red dot and suppressor (their parts, read
    // from the items so a rebuilt model doesn't break this) and mag (2) come.
    const dot = items.get('red-dot')!;
    const can = items.get('field-suppressor')!;
    if (dot.type !== 'attachment' || can.type !== 'attachment') throw new Error('not parts');
    expect(g.shapes).toHaveLength(21 - 4 + dot.model.parts.length + can.model.parts.length + 2);
    // The optic mount (0, 0.041, 0: moved 4 cm back toward the eye, 2026-11-18) plus the
    // red dot's sight point.
    expect(g.sight[1]).toBeCloseTo(0.041 + dot.model.sight![1]);
    expect(g.sight[2]).toBeCloseTo(dot.model.sight![2]);
    // The muzzle mount plus the suppressor's own muzzle point.
    expect(g.muzzle[2]).toBeCloseTo(-0.54 + can.model.muzzle![2]);
    expect(g.suppressed).toBe(true);
  });

  it("looks through a combo sight's red dot unmagnified, rebuilt when the sight switches", () => {
    const scope = rifle({ optic: 'tandem-combo-sight' });
    const dot = { ...scope, sight: 1 } as WeaponState;
    const through = gunModel(scope, items);
    const over = gunModel(dot, items);
    // The scope: looked through (its parts in the line of sight hidden), at its eyepiece.
    expect(through.scope).not.toBeNull();
    // The red dot on top: no scope view, its own window and sight point, higher up.
    expect(over.scope).toBeNull();
    expect(over.window).not.toBeNull();
    expect(over.sight[1]).toBeGreaterThan(through.sight[1]);
    // The first-person gun is cached by this key, so the switch has to change it.
    expect(gunKey(dot)).not.toBe(gunKey(scope));
  });

  it("holds a second sight far enough out that the optic's eyepiece stays ahead of the eye", () => {
    // A small window with a big fill is held so close that the scope behind it passes the
    // camera, and the view fills with the sight. The main sight point is the eyepiece.
    for (const def of items.values()) {
      if (def.type !== 'attachment') continue;
      const alt = def.optic?.alt;
      const main = def.model.sight;
      if (!alt || alt.fill === undefined || alt.lens === undefined || !main) continue;
      const eye = scopeEyeDistance(alt.lens, alt.fill);
      expect(eye, def.id).toBeGreaterThan(main[2] - alt.sight[2] + 0.01);
    }
  });

  it('folds the factory stock about the hinge when folded (WF-1, AT-1b)', () => {
    // The rearmost part is the butt; the AK-74M's mount folds it along its left side.
    const ak = { ...rifle({}), item: 'ak-74m' };
    const back = (w: WeaponState) => Math.max(...gunModel(w, items).shapes.map((s) => s.z));
    const left = (w: WeaponState) => Math.min(...gunModel(w, items).shapes.map((s) => s.x));
    expect(back(ak)).toBeGreaterThan(0.3);
    const shut = { ...ak, folded: true as const };
    expect(gunModel(shut, items).shapes).toHaveLength(gunModel(ak, items).shapes.length);
    expect(back(shut)).toBeLessThan(0.3);
    expect(left(shut)).toBeLessThan(-0.04);
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
