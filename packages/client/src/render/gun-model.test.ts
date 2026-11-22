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
  // The gun's own model, read from its item so a rebuilt model (GM-3) doesn't break these.
  const akm = items.get('akm')!;
  if (akm.type !== 'weapon') throw new Error('not a gun');
  const own = akm.model;

  it('draws a bare gun with its irons and standard magazine', () => {
    const g = gunModel(rifle({}), items);
    // Every part, its factory stock (AT-1b) among them, and no magazine: a part since MG-1.
    expect(g.shapes).toHaveLength(own.parts.length);
    expect(g.sight).toEqual(own.sight);
    expect(g.muzzle).toEqual(own.muzzle);
    expect(g.suppressed).toBe(false);
  });

  it('puts attachments on their mounts, hiding what they replace', () => {
    const g = gunModel(
      rifle({ optic: 'red-dot', muzzle: 'field-suppressor', magazine: 'mag-762x39-45' }),
      items,
    );
    // The rear sight and slant brake go; the red dot, suppressor and mag come.
    const dot = items.get('red-dot')!;
    const can = items.get('field-suppressor')!;
    const mag = items.get('mag-762x39-45')!;
    if (dot.type !== 'attachment' || can.type !== 'attachment' || mag.type !== 'attachment')
      throw new Error('not parts');
    const gone = own.parts.filter((p) => p.hiddenBy === 'optic' || p.hiddenBy === 'muzzle');
    expect(gone.length).toBeGreaterThan(0);
    expect(g.shapes).toHaveLength(
      own.parts.length -
        gone.length +
        dot.model.parts.length +
        can.model.parts.length +
        mag.model.parts.length,
    );
    // The optic mount plus the red dot's sight point.
    const optic = own.mounts!.optic!;
    expect(g.sight[1]).toBeCloseTo(optic[1] + dot.model.sight![1]);
    expect(g.sight[2]).toBeCloseTo(optic[2] + dot.model.sight![2]);
    // The muzzle mount plus the suppressor's own muzzle point.
    expect(g.muzzle[2]).toBeCloseTo(own.mounts!.muzzle![2] + can.model.muzzle![2]);
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
    // The rearmost part is the butt; the AKS-74U's factory stock folds along its left side.
    const ak = { ...rifle({}), item: 'aks-74u' };
    const back = (w: WeaponState) => Math.max(...gunModel(w, items).shapes.map((s) => s.z));
    const left = (w: WeaponState) => Math.min(...gunModel(w, items).shapes.map((s) => s.x));
    expect(back(ak)).toBeGreaterThan(0.3);
    const shut = { ...ak, folded: true as const };
    expect(gunModel(shut, items).shapes).toHaveLength(gunModel(ak, items).shapes.length);
    expect(back(shut)).toBeLessThan(0.3);
    expect(left(shut)).toBeLessThan(-0.03);
  });

  it("draws a stock kit's foregrip on the foregrip mount, where the hand goes (AT-7b)", () => {
    const kit = items.get('heavy-integrated-stock')!;
    const gun = items.get('m416')!;
    if (kit.type !== 'attachment' || gun.type !== 'weapon') throw new Error('wrong types');
    const fg = kit.model.foregrip!;
    const bare = { ...rifle({}), item: 'm416' };
    const kitted = { ...rifle({ stock: 'heavy-integrated-stock' }), item: 'm416' };
    const plain = { ...rifle({ stock: 'standard-tactical-stock' }), item: 'm416' };
    const at = gun.model.mounts!.foregrip!;
    const g = gunModel(kitted, items);
    expect(g.support).toEqual(at.map((v, i) => v + fg.support[i]!));
    expect(gunModel(plain, items).support).toEqual(gunModel(bare, items).support);
    // The kit's own parts and its foregrip's both drawn.
    const stock =
      gunModel(plain, items).shapes.length -
      items.get('standard-tactical-stock')!.model.parts.length;
    expect(g.shapes.length).toBe(stock + kit.model.parts.length + fg.parts.length);
  });

  it("draws a grip's magwell look round the well on a gun whose grip wraps it (GM-4)", () => {
    const mp7 = items.get('mp7')!;
    const grip = items.get('balanced-tactical-grip')!;
    if (mp7.type !== 'weapon' || grip.type !== 'attachment') throw new Error('wrong items');
    const look = grip.model.magwell!;
    const at = mp7.model.mounts!.grip!;
    const g = gunModel(
      { ...rifle({}), item: 'mp7', attachments: { ...noAttachments(), grip: grip.id } },
      items,
    );
    // The gun less its grip shell, plus the magwell look (not the grip's normal look).
    const kept = mp7.model.parts.filter((p) => p.hiddenBy !== 'grip').length;
    expect(g.shapes).toHaveLength(kept + look.parts.length);
    expect(g.grip).toEqual(at.map((v, i) => v + look.grip[i]!));
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
