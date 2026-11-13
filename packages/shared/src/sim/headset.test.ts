import { describe, expect, it } from 'vitest';
import { ITEM_FORMAT_VERSION, itemSchema } from '../content/items';
import { createItem } from './create-item';
import { EARS_COVERED, HEADSET_WORN, createGear, gearConflict, hearingOf, type Gear } from './gear';
import { createArmor } from './health';
import { TEST_ITEMS as items } from './test-items';

// GZ-2: the headset slot, and helmets that cover the ears.

describe('headsets', () => {
  it("hear better; a helmet's loss or comms adds on", () => {
    const gear: Gear = createGear(true);
    expect(hearingOf(items, gear)).toBe(0);
    gear.headset = createItem(items, 'headset');
    expect(hearingOf(items, gear)).toBeCloseTo(0.2);
    gear.headset = null;
    gear.helmet = createArmor(items, 'full-helmet', 1);
    expect(hearingOf(items, gear)).toBeCloseTo(0.1);
  });

  it("don't go with a helmet that covers the ears, either way round", () => {
    const gear: Gear = createGear(true);
    gear.helmet = createArmor(items, 'full-helmet', 1);
    expect(gearConflict(items, gear, 'headset', createItem(items, 'headset'))).toBe(EARS_COVERED);
    gear.helmet = createArmor(items, 'helmet', 1);
    expect(gearConflict(items, gear, 'headset', createItem(items, 'headset'))).toBeNull();
    gear.headset = createItem(items, 'headset');
    gear.helmet = null;
    expect(gearConflict(items, gear, 'helmet', createArmor(items, 'full-helmet', 1))).toBe(
      HEADSET_WORN,
    );
    expect(gearConflict(items, gear, 'helmet', createArmor(items, 'helmet', 1))).toBeNull();
  });

  it('content refuses a hearing boost on a helmet that leaves the ears open', () => {
    const helmet = {
      formatVersion: ITEM_FORMAT_VERSION,
      id: 'h',
      name: 'H',
      type: 'armor',
      slot: 'helmet',
      size: [2, 2],
      value: 1,
      weight: 1,
      rarity: 'common',
      level: 3,
      durability: 30,
      hearing: 0.1,
      model: { parts: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], color: '#000000' }] },
    };
    expect(itemSchema.safeParse(helmet).success).toBe(false);
    expect(itemSchema.safeParse({ ...helmet, blocksHeadset: true }).success).toBe(true);
    expect(itemSchema.safeParse({ ...helmet, hearing: -0.15 }).success).toBe(true);
    expect(itemSchema.safeParse({ ...helmet, slot: 'body', hearing: -0.1 }).success).toBe(false);
  });
});
