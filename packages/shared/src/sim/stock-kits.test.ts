import { describe, expect, it } from 'vitest';
import {
  ITEM_FORMAT_VERSION,
  blockedBy,
  fitsIn,
  fitsOn,
  itemSchema,
  placeParts,
  weaponDef,
  type AttachmentDef,
  type ItemDb,
  type ItemDef,
} from '../content/items';
import { placeAt } from '../inventory/grid';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip } from './gear';
import { applyInventory, type InventoryAction, type Owner } from './looting';
import { createState, spawnCharacter } from './state';
import { TEST_ITEMS } from './test-items';
import { attach, createWeapon, slotFor } from './weapons';

// AT-7b: a stock kit is a stock with its own foregrip; while it's on, the foregrip slot
// can't be used.

const box = { type: 'box', pos: [0, 0, 0], size: [0.02, 0.02, 0.02], color: '#333333' } as const;
const part = (id: string, slot: 'foregrip' | 'stock', extra: object = {}): ItemDef =>
  ({
    formatVersion: ITEM_FORMAT_VERSION,
    id,
    name: id,
    size: [1, 1],
    value: 100,
    weight: 0.1,
    rarity: 'common',
    type: 'attachment',
    slot,
    ...(slot === 'stock' && { stock: { length: 1 } }),
    model: { parts: [box] },
    ...extra,
  }) as ItemDef;

const kitModel = { parts: [box], foregrip: { parts: [box], support: [0, -0.03, 0] } };
const items: ItemDb = new Map(TEST_ITEMS)
  .set('gripped', {
    ...TEST_ITEMS.get('carbine')!,
    id: 'gripped',
    slots: ['optic', 'foregrip', 'stock'],
  } as ItemDef)
  .set('fore', part('fore', 'foregrip', { mods: { recoilUp: -6 } }))
  .set('kit', part('kit', 'stock', { mods: { recoilUp: -12 }, model: kitModel }))
  .set('plain-stock', part('plain-stock', 'stock'));
const kit = items.get('kit') as AttachmentDef;
const fore = items.get('fore') as AttachmentDef;

describe('stock kits', () => {
  it('fits only a gun with a foregrip slot', () => {
    expect(fitsIn(items, weaponDef(items, 'gripped'), kit, 'stock')).toBe(true);
    expect(fitsIn(items, weaponDef(items, 'carbine'), kit, 'stock')).toBe(false);
  });

  it('blocks the foregrip slot while fitted', () => {
    const gun = createWeapon(items, 'gripped', ['kit']);
    expect(blockedBy(items, gun, 'foregrip')).toBe('kit');
    expect(blockedBy(items, gun, 'optic')).toBeNull();
    expect(fitsOn(items, gun, fore, 'foregrip')).toBe(false);
    expect(slotFor(gun, items, 'fore')).toBeNull();
    // Swapping the kit for a plain stock frees it.
    attach(gun, items, 'plain-stock');
    expect(fitsOn(items, gun, fore, 'foregrip')).toBe(true);
  });

  it("won't go on over a foregrip by itself", () => {
    const gun = createWeapon(items, 'gripped', ['fore']);
    expect(() => attach(gun, items, 'kit')).toThrow(/foregrip/);
  });

  it('places a kit or a foregrip, whichever comes first, not both', () => {
    const gun = weaponDef(items, 'gripped');
    expect(placeParts(gun, items, ['kit', 'fore'])).toEqual(['stock', null]);
    expect(placeParts(gun, items, ['fore', 'kit'])).toEqual(['foregrip', null]);
  });

  it('only a stock may have a built-in foregrip', () => {
    const bad = { ...part('bad', 'foregrip'), model: kitModel };
    expect(itemSchema.safeParse(bad).success).toBe(false);
    expect(itemSchema.safeParse(kit).success).toBe(true);
  });

  it('takes the fitted foregrip off into what you carry as it goes on', () => {
    const world = new CollisionWorld({
      terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
      boxes: [],
      ramps: [],
      ladders: [],
    });
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    equip(c, items, 'backpack', createItem(items, 'backpack'));
    const pack = c.gear.backpack!.grid;
    const gun = createWeapon(items, 'gripped', ['fore']);
    placeAt(items, pack, gun, 0, 0, false);
    placeAt(items, pack, createItem(items, 'kit'), 0, 3, false);
    const self: Owner = { kind: 'self' };
    const act = (a: InventoryAction) => applyInventory(state, c, items, a, world, true);
    expect(
      act({
        type: 'attach',
        gun: { owner: self, grid: 'backpack', index: 0, item: 'gripped' },
        from: { owner: self, grid: 'backpack', index: 1, item: 'kit' },
      }),
    ).toBe(true);
    expect(gun.attachments.stock).toBe('kit');
    expect(gun.attachments.foregrip).toBeNull();
    // Off into what c carries, not dropped.
    const carried = [...c.gear.pockets.items, ...pack.items];
    expect(carried.some((g) => g.item.item === 'fore')).toBe(true);
    expect(pack.items.some((g) => g.item.item === 'kit')).toBe(false);
  });
});
