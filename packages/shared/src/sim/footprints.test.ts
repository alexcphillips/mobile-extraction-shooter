import { describe, expect, it } from 'vitest';
import { itemSize } from '../content/items';
import { placeAt } from '../inventory/grid';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip } from './gear';
import { applyInventory, type InventoryAction, type Owner } from './looting';
import { createState, spawnCharacter } from './state';
import { TEST_ITEMS as items } from './test-items';
import { createWeapon } from './weapons';

// WF-2: a fitted magazine can add a row, a muzzle device a column; growth needs room.

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});
const self: Owner = { kind: 'self' };

function setup() {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  equip(c, items, 'backpack', createItem(items, 'backpack')); // a 4 × 4 grid
  const pack = c.gear.backpack!.grid;
  const act = (a: InventoryAction): boolean => applyInventory(state, c, items, a, world, true);
  const inPack = (index: number, item: string) =>
    ({ owner: self, grid: 'backpack', index, item }) as const;
  return { pack, act, inPack };
}

describe('footprints', () => {
  it('a drum adds a row, a long suppressor a column; the usual parts add nothing', () => {
    const gun = createWeapon(items, 'smg');
    expect(itemSize(items, gun)).toEqual([3, 2]);
    gun.attachments.magazine = 'smg-drum';
    expect(itemSize(items, gun)).toEqual([3, 3]);
    gun.attachments.muzzle = 'long-can';
    expect(itemSize(items, gun)).toEqual([4, 3]);
    gun.attachments.magazine = null;
    expect(itemSize(items, gun)).toEqual([4, 2]);
    expect(
      itemSize(items, { item: 'rifle', attachments: { ...gun.attachments, muzzle: 'suppressor' } }),
    ).toEqual([4, 2]);
  });

  it('a gun goes into a grid at its current size', () => {
    const { pack } = setup();
    const gun = createWeapon(items, 'smg');
    gun.attachments.magazine = 'smg-drum';
    expect(placeAt(items, pack, gun, 0, 2, false)).toBe(false); // 3 rows from row 2: out
    expect(placeAt(items, pack, gun, 0, 1, false)).toBe(true);
  });

  it('a drum needs the row under the gun; the magazine out goes elsewhere', () => {
    const { pack, act, inPack } = setup();
    const gun = createWeapon(items, 'smg');
    placeAt(items, pack, gun, 0, 0, false); // 3 × 2 at the top left
    placeAt(items, pack, createItem(items, 'smg-drum'), 2, 2, false); // in the row it needs
    placeAt(items, pack, createItem(items, 'bandage'), 0, 2, false);
    const attach: InventoryAction = {
      type: 'attach',
      gun: inPack(0, 'smg'),
      from: inPack(1, 'smg-drum'),
    };
    expect(act(attach)).toBe(false);
    expect(gun.attachments.magazine).toBe('smg-mag');
    pack.items.splice(2, 1); // the bandage goes
    expect(act(attach)).toBe(true);
    expect(gun.attachments.magazine).toBe('smg-drum');
    expect(itemSize(items, gun)).toEqual([3, 3]);
    const out = pack.items.find((g) => g.item.item === 'smg-mag')!;
    expect(out).toBeDefined();
    expect(out.x >= 3 || out.y >= 3).toBe(true); // not under the grown gun
  });

  it('a long suppressor grows the gun right, or down when turned', () => {
    const { pack, act, inPack } = setup();
    const gun = createWeapon(items, 'smg');
    placeAt(items, pack, gun, 0, 0, true); // turned: 2 × 3
    placeAt(items, pack, createItem(items, 'long-can'), 2, 0, false);
    placeAt(items, pack, createItem(items, 'bandage'), 1, 3, false);
    const attach: InventoryAction = {
      type: 'attach',
      gun: inPack(0, 'smg'),
      from: inPack(1, 'long-can'),
    };
    expect(act(attach)).toBe(false);
    pack.items.splice(2, 1);
    expect(act(attach)).toBe(true);
    expect(gun.attachments.muzzle).toBe('long-can');
  });

  it('taking a drum off shrinks the gun', () => {
    const { pack, act, inPack } = setup();
    const gun = createWeapon(items, 'smg');
    gun.attachments.magazine = 'smg-drum';
    gun.mag = 0;
    placeAt(items, pack, gun, 0, 0, false);
    expect(
      act({ type: 'detach', gun: inPack(0, 'smg'), slot: 'magazine', part: 'smg-drum', to: null }),
    ).toBe(true);
    expect(itemSize(items, gun)).toEqual([3, 2]);
  });
});
