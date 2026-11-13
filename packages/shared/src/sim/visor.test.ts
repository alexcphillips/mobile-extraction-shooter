import { describe, expect, it } from 'vitest';
import { addItem } from '../inventory/grid';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip } from './gear';
import { HEAD, createArmor, woundZone } from './health';
import { applyInventory, type Owner } from './looting';
import { createState, spawnCharacter } from './state';
import { TEST_ITEMS as items } from './test-items';

// GZ-5: visors on helmets: the face's armor, fitted and taken off in the inventory.

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});
const self: Owner = { kind: 'self' };
const round = { damage: 30, level: 3, armorDamage: 5, bleedChance: 0 };

function setup() {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  c.yaw = 0; // facing −z
  equip(c, items, 'helmet', createArmor(items, 'full-helmet'));
  equip(c, items, 'rig', createItem(items, 'rig'));
  return { state, c };
}

describe('visors', () => {
  it('take a face hit (GZ-3); any other head hit, the helmet does', () => {
    const { state, c } = setup();
    const helmet = c.gear.helmet!;
    helmet.fitted = createItem(items, 'visor');
    woundZone(state, items, c, HEAD, 30, round, 0, 'shot', 0, -10, true);
    expect(helmet.fitted.durability).toBeLessThan(20);
    expect(helmet.durability).toBe(40);
    // From the front, but over the brow.
    woundZone(state, items, c, HEAD, 30, round, 0, 'shot', 0, -10);
    expect(helmet.durability).toBeLessThan(40);
  });

  it('a face with no visor, or a broken one, is bare (GZ-3)', () => {
    const { state, c } = setup();
    const helmet = c.gear.helmet!;
    helmet.fitted = { ...createItem(items, 'visor'), durability: 0 };
    woundZone(state, items, c, HEAD, 30, round, 0, 'shot', 0, -10, true);
    expect(helmet.durability).toBe(40);
    expect(c.health.hp[HEAD]).toBe(5);
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: 'damage', zone: HEAD, face: true, absorbed: 0 }),
    );
  });

  it('a helmet that covers the face takes a face hit with no visor (GZ-3)', () => {
    const { state, c } = setup();
    equip(c, items, 'helmet', createArmor(items, 'mask-helmet'));
    woundZone(state, items, c, HEAD, 30, round, 0, 'shot', 0, -10, true);
    expect(c.gear.helmet!.durability).toBeLessThan(50);
    expect(c.health.hp[HEAD]).toBe(35);
  });

  it('go on a helmet with the mount and come off again, keeping their wear', () => {
    const { state, c } = setup();
    const visor = { ...createItem(items, 'visor'), durability: 12 };
    addItem(items, c.gear.rig!.grid, visor);
    const helmet = { owner: self, slot: 'helmet', item: 'full-helmet' } as const;
    const from = { owner: self, grid: 'rig', index: 0, item: 'visor' } as const;
    expect(applyInventory(state, c, items, { type: 'mount', helmet, from })).toBe(true);
    expect(c.gear.helmet!.fitted).toMatchObject({ item: 'visor', durability: 12 });
    expect(c.gear.rig!.grid.items).toHaveLength(0);
    expect(
      applyInventory(state, c, items, { type: 'unmount', helmet, part: 'visor', to: null }),
    ).toBe(true);
    expect(c.gear.helmet!.fitted).toBeUndefined();
    // A helmet without the mount takes none.
    c.gear.helmet = createArmor(items, 'helmet');
    const plain = { owner: self, slot: 'helmet', item: 'helmet' } as const;
    const loose = c.gear.pockets.items.length
      ? ({ owner: self, grid: 'pockets', index: 0, item: 'visor' } as const)
      : ({ owner: self, grid: 'rig', index: 0, item: 'visor' } as const);
    expect(applyInventory(state, c, items, { type: 'mount', helmet: plain, from: loose })).toBe(
      false,
    );
  });
});
