import { describe, expect, it } from 'vitest';
import {
  ERGO,
  aimTimeAt,
  drawTimeAt,
  ergonomicsOf,
  swayAt,
  weaponDef,
  type AttachmentDef,
} from '../content/items';
import { createGear, drawTime } from './gear';
import { TEST_ITEMS } from './test-items';
import { createWeapon, createWeaponStats, weaponStats } from './weapons';

describe('ergonomics', () => {
  it('sets aim time, draw time and sway: handier is quicker and steadier', () => {
    expect(aimTimeAt(80)).toBeLessThan(aimTimeAt(40));
    expect(drawTimeAt(80)).toBeLessThan(drawTimeAt(40));
    expect(swayAt(80)).toBeLessThan(1);
    expect(swayAt(ERGO.swayAt)).toBe(1);
    expect(swayAt(20)).toBeGreaterThan(1);
    // Clamped at the ends.
    expect(aimTimeAt(1000)).toBe(aimTimeAt(100));
    expect(swayAt(-50)).toBeLessThanOrEqual(ERGO.maxSway);
  });

  it("adds attachments' points, and a folded stock's count for nothing", () => {
    const items = new Map(TEST_ITEMS);
    const sup = TEST_ITEMS.get('suppressor') as AttachmentDef;
    items.set('suppressor', { ...sup, mods: { ...sup.mods, ergonomics: -10 } });
    const base = weaponDef(items, 'rifle').ergonomics;
    const bare = weaponStats(items, createWeapon(items, 'rifle'), createWeaponStats());
    const w = createWeapon(items, 'rifle', ['suppressor']);
    const s = weaponStats(items, w, createWeaponStats());
    expect(bare.ergonomics).toBeCloseTo(base, 5);
    expect(s.ergonomics).toBeCloseTo(base - 10, 5);
    expect(s.aimTime).toBeCloseTo(aimTimeAt(base - 10), 5);
    expect(s.aimTime).toBeGreaterThan(bare.aimTime);
    expect(ergonomicsOf(items, w)).toBeCloseTo(base - 10, 5);
  });

  it('times taking a gun out by its ergonomics', () => {
    const gear = createGear(false);
    gear.primary1 = createWeapon(TEST_ITEMS, 'rifle');
    const e = weaponDef(TEST_ITEMS, 'rifle').ergonomics;
    expect(drawTime(TEST_ITEMS, gear, 'primary1')).toBeCloseTo(drawTimeAt(e), 5);
  });
});
