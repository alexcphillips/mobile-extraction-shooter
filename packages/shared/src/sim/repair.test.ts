import { describe, expect, it } from 'vitest';
import type { Item } from '../inventory/grid';
import { REPAIR, maxDurability, repairArmor, repairLossOf, repairable } from './repair';
import { TEST_ITEMS as items } from './test-items';
import { armorDef } from '../content/items';

/** The plate (100 durability, repairLoss 0.1) worn down to this much. */
const plate = (durability: number): Item => ({ item: 'plate', count: 1, durability });
const kit = (left: number): Item => ({ item: 'repair-kit', count: 1, left });

describe('repairs wear down the max', () => {
  it('mends to a new max: the missing durability times the loss comes off it', () => {
    const a = plate(30);
    const k = kit(200);
    // 70 missing: 7 comes off the max, 63 goes back on, and that's what the kit spends.
    expect(repairable(items, k, a)).toBeCloseTo(63);
    expect(repairArmor(items, k, a)).toBeCloseTo(63);
    expect(a.max).toBeCloseTo(93);
    expect(a.durability).toBeCloseTo(93);
    expect(k.left).toBeCloseTo(137);
    // Full for what it is now: nothing to mend.
    expect(repairable(items, k, a)).toBe(0);
    // Worn again, mended again: 50 missing, so 5 more off the max.
    a.durability = 43;
    expect(repairArmor(items, k, a)).toBeCloseTo(45);
    expect(a.max).toBeCloseTo(88);
    expect(a.durability).toBeCloseTo(88);
    expect(k.left).toBeCloseTo(92);
  });

  it('with too few points, mends what they cover, and wears the max by that share', () => {
    const a = plate(30);
    const k = kit(18);
    expect(repairArmor(items, k, a)).toBeCloseTo(18);
    // 18 added is 20 of the missing mended: 2 off the max.
    expect(a.durability).toBeCloseTo(48);
    expect(a.max).toBeCloseTo(98);
    expect(k.left).toBeCloseTo(0);
  });

  it('a new piece is at its full max, and armor with no loss never wears', () => {
    expect(maxDurability(items, plate(100))).toBe(100);
    const vest: Item = { item: 'vest', count: 1, durability: 10 };
    repairArmor(items, kit(50), vest);
    expect(vest.durability).toBe(50);
    expect(vest.max).toBe(50);
    expect(repairLossOf(armorDef(items, 'vest'))).toBe(0);
    expect(REPAIR.loss).toBeGreaterThan(0);
  });
});
