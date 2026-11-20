import { describe, expect, it } from 'vitest';
import {
  GUN_STATS,
  PELLET_SPREAD_AT,
  STAT_CURVES,
  aimTimeAt,
  clampPoints,
  drawTimeAt,
  jumpAt,
  pointsFor,
  pointsForScale,
  pointsOf,
  statAt,
  swayAt,
  weaponDef,
  type AttachmentDef,
  type CurvedStat,
  type WeaponDef,
} from '../content/items';
import { TEST_ITEMS } from './test-items';
import { createWeapon, createWeaponStats, weaponStats } from './weapons';

const CURVED = Object.keys(STAT_CURVES) as CurvedStat[];

describe('stat curves', () => {
  it.each(CURVED)('%s runs from its value at 0 to its value at 100', (stat) => {
    const c = STAT_CURVES[stat];
    expect(statAt(stat, 0)).toBeCloseTo(c.at0, 9);
    expect(statAt(stat, 100)).toBeCloseTo(c.at100, 9);
    // Clamped past the ends.
    expect(statAt(stat, -20)).toBe(statAt(stat, 0));
    expect(statAt(stat, 140)).toBe(statAt(stat, 100));
  });

  it.each(CURVED)('%s moves by the same share for each point, anywhere on it', (stat) => {
    const step = statAt(stat, 11) / statAt(stat, 10);
    expect(statAt(stat, 81) / statAt(stat, 80)).toBeCloseTo(step, 9);
    // About 4.7% a point: 15 points doubles or halves.
    expect(Math.abs(Math.log(statAt(stat, 15) / statAt(stat, 0)))).toBeCloseTo(Math.LN2, 1);
  });

  it.each(CURVED)('%s turns values and changes back into points', (stat) => {
    const v = statAt(stat, 42);
    expect(pointsFor(stat, v)).toBeCloseTo(42, 9);
    expect(statAt(stat, 42 + pointsForScale(stat, 0.7))).toBeCloseTo(v * 0.7, 9);
  });

  it('reads higher as more of what the stat names: kick, range and noise up, spread down', () => {
    expect(statAt('recoilUp', 60)).toBeGreaterThan(statAt('recoilUp', 40));
    expect(statAt('recoilSide', 60)).toBeGreaterThan(statAt('recoilSide', 40));
    expect(statAt('range', 60)).toBeGreaterThan(statAt('range', 40));
    expect(statAt('loudness', 60)).toBeGreaterThan(statAt('loudness', 40));
    expect(statAt('hipFire', 60)).toBeLessThan(statAt('hipFire', 40));
    expect(statAt('accuracy', 60)).toBeLessThan(statAt('accuracy', 40));
  });

  it('handling and stability: higher is quicker and steadier, clamped', () => {
    expect(aimTimeAt(70)).toBeLessThan(aimTimeAt(30));
    expect(drawTimeAt(70)).toBeLessThan(drawTimeAt(30));
    expect(swayAt(70)).toBeLessThan(swayAt(30));
    expect(jumpAt(70)).toBeLessThan(jumpAt(30));
    expect(jumpAt(500)).toBe(jumpAt(100));
    expect(clampPoints(-3)).toBe(0);
    expect(clampPoints(103)).toBe(100);
  });
});

describe('stacking points', () => {
  /** Two muzzle-slot parts can't go on together, so stack a muzzle part and a rail part. */
  function setup(muzzle: AttachmentDef['mods'], rail: AttachmentDef['mods']) {
    const items = new Map(TEST_ITEMS);
    const sup = TEST_ITEMS.get('suppressor') as AttachmentDef;
    const laser = TEST_ITEMS.get('laser') as AttachmentDef;
    items.set('suppressor', { ...sup, mods: muzzle });
    items.set('laser', { ...laser, mods: rail });
    return items;
  }

  it('adds every part’s points, so two parts make the product of their changes', () => {
    const items = setup(
      { recoilUp: pointsForScale('recoilUp', 0.8), loudness: -10, stability: 6 },
      { recoilUp: pointsForScale('recoilUp', 0.9), loudness: 4, stability: 5, handling: -3 },
    );
    const base = weaponDef(items, 'rifle').stats;
    const bare = weaponStats(items, createWeapon(items, 'rifle'), createWeaponStats());
    const w = createWeapon(items, 'rifle', ['suppressor', 'laser']);
    const s = weaponStats(items, w, createWeaponStats());
    expect(s.recoilUp).toBeCloseTo(bare.recoilUp * 0.8 * 0.9, 9);
    expect(s.points.loudness).toBeCloseTo(base.loudness - 6, 9);
    expect(s.points.stability).toBe(base.stability + 11);
    expect(s.points.handling).toBeCloseTo(base.handling - 3, 9);
    for (const stat of GUN_STATS) expect(pointsOf(items, w, stat)).toBe(s.points[stat]);
  });

  it('tightens a pellet round by the share accuracy points tighten aimed spread (AT-3)', () => {
    const items = setup({ accuracy: 6 }, {});
    const rifle = weaponDef(items, 'rifle');
    const at: WeaponDef = { ...rifle, stats: { ...rifle.stats, accuracy: PELLET_SPREAD_AT } };
    items.set('rifle', at);
    // A gun at the reference has the round's own spread.
    expect(weaponStats(items, createWeapon(items, 'rifle'), createWeaponStats()).pelletScale).toBe(
      1,
    );
    const choked = weaponStats(
      items,
      createWeapon(items, 'rifle', ['suppressor']),
      createWeaponStats(),
    );
    const share = statAt('accuracy', PELLET_SPREAD_AT + 6) / statAt('accuracy', PELLET_SPREAD_AT);
    expect(choked.pelletScale).toBeCloseTo(share, 9);
    expect(choked.pelletScale).toBeLessThan(1);
  });

  it('stops at 0 and 100 however many points the parts add', () => {
    const items = setup({ stability: 40 }, { stability: 40, hipFire: 50 });
    const s = weaponStats(
      items,
      createWeapon(items, 'rifle', ['suppressor', 'laser']),
      createWeaponStats(),
    );
    expect(s.points.stability).toBe(100);
    expect(s.points.hipFire).toBe(100);
    expect(s.hipSpread).toBeCloseTo(STAT_CURVES.hipFire.at100, 9);
    const down = setup({ loudness: -200 }, {});
    const q = weaponStats(down, createWeapon(down, 'rifle', ['suppressor']), createWeaponStats());
    expect(q.loudness).toBeCloseTo(STAT_CURVES.loudness.at0, 9);
  });

  it('counts a laser switched off as not fitted, for every stat', () => {
    const items = setup({}, { stability: 10, handling: 10, hipFire: 10, recoilUp: -10 });
    const w = createWeapon(items, 'rifle', ['laser']);
    const on = { ...weaponStats(items, w, createWeaponStats()).points };
    w.laserOff = true;
    const off = weaponStats(items, w, createWeaponStats()).points;
    expect(on.stability - off.stability).toBe(10);
    expect(on.handling - off.handling).toBeCloseTo(10, 9);
    expect(off.recoilUp - on.recoilUp).toBeCloseTo(10, 9);
    expect(off).toEqual(weaponDef(items, 'rifle').stats);
  });
});
