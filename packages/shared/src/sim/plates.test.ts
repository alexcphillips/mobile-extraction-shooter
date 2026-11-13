import { describe, expect, it } from 'vitest';
import { addItem } from '../inventory/grid';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { CARRIER_BULKY, RIG_WORN, equip, gearConflict } from './gear';
import { CHEST, createArmor, woundZone } from './health';
import { applyInventory, type Owner } from './looting';
import { updateMedUse } from './meds';
import { createState, spawnCharacter } from './state';
import { TEST_ITEMS as items } from './test-items';
import { TICK_RATE } from '../tick';

// GZ-4: plates in carriers, one check per hit by the side hit.

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});
const self: Owner = { kind: 'self' };
const round = { damage: 40, level: 3, armorDamage: 5, bleedChance: 0 };

function setup(carrier = 'carrier') {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  c.yaw = 0; // facing −z
  equip(c, items, 'bodyArmor', createArmor(items, carrier));
  equip(c, items, 'backpack', createItem(items, 'backpack'));
  return { state, c };
}

describe('plates', () => {
  it('a carrier comes with its plates, as worn as it is', () => {
    const a = createArmor(items, 'carrier', 0.5);
    expect(a.plates?.front).toMatchObject({ item: 'plate-4', durability: 20 });
    expect(a.plates?.back).toBeUndefined();
  });

  it('the front plate takes a hit from the front; from behind, no plate and no soft: flesh', () => {
    const { state, c } = setup();
    const chest = c.gear.bodyArmor!;
    const hp = c.health.hp[CHEST]!;
    woundZone(state, items, c, CHEST, 40, round, 0, 'shot', 0, -10);
    expect(chest.plates!.front!.durability).toBeLessThan(40);
    expect(c.health.hp[CHEST]).toBeGreaterThan(hp - 40); // level 4 stopped most of a level 3
    const before = c.health.hp[CHEST]!;
    woundZone(state, items, c, CHEST, 40, round, 0, 'shot', 0, 10);
    expect(chest.durability).toBe(30); // its own rating covers nothing: it has plate slots
    expect(c.health.hp[CHEST]).toBeCloseTo(before - 40);
  });

  it("with no plate on the side hit, the carrier's own rating covers where it says", () => {
    const { state, c } = setup('bulky-carrier');
    woundZone(state, items, c, CHEST, 40, round, 0, 'shot', 0, -10);
    expect(c.gear.bodyArmor!.durability).toBeLessThan(30);
  });

  it('a bulky carrier and a chest rig never go together, either way round', () => {
    const { c } = setup('bulky-carrier');
    expect(gearConflict(items, c.gear, 'rig', createItem(items, 'rig'))).toBe(CARRIER_BULKY);
    c.gear.bodyArmor = null;
    c.gear.rig = createItem(items, 'rig') as never;
    expect(gearConflict(items, c.gear, 'bodyArmor', createArmor(items, 'bulky-carrier'))).toBe(
      RIG_WORN,
    );
  });

  it('go in at once between raids, the old one where the new one was', () => {
    const { state, c } = setup();
    addItem(items, c.gear.backpack!.grid, createItem(items, 'plate-2'));
    const carrier = { owner: self, slot: 'bodyArmor', item: 'carrier' } as const;
    const from = { owner: self, grid: 'backpack', index: 0, item: 'plate-2' } as const;
    const plate = { type: 'plate', carrier, from, side: 'front' } as const;
    expect(applyInventory(state, c, items, plate, world, true)).toBe(true);
    expect(c.gear.bodyArmor!.plates!.front!.item).toBe('plate-2');
    expect(c.gear.backpack!.grid.items[0]!.item.item).toBe('plate-4');
  });

  it('in a raid take the swap time, like a med, and a shot calls it off', () => {
    const { state, c } = setup('bulky-carrier');
    addItem(items, c.gear.backpack!.grid, createItem(items, 'plate-4'));
    const carrier = { owner: self, slot: 'bodyArmor', item: 'bulky-carrier' } as const;
    const from = { owner: self, grid: 'backpack', index: 0, item: 'plate-4' } as const;
    expect(applyInventory(state, c, items, { type: 'plate', carrier, from }, world)).toBe(true);
    expect(c.using?.left).toBe(4);
    for (let i = 0; i < 2 * TICK_RATE; i++) updateMedUse(state, c, items, undefined);
    expect(c.gear.bodyArmor!.plates).toBeUndefined();
    for (let i = 0; i < 2 * TICK_RATE + 1; i++) updateMedUse(state, c, items, undefined);
    expect(c.gear.bodyArmor!.plates!.front!.item).toBe('plate-4');
    // Called off by firing.
    addItem(items, c.gear.backpack!.grid, createItem(items, 'plate-2'));
    applyInventory(
      state,
      c,
      items,
      { type: 'plate', carrier, from: { ...from, item: 'plate-2' } },
      world,
    );
    updateMedUse(state, c, items, { fire: true } as never);
    expect(c.using).toBeNull();
  });
});
