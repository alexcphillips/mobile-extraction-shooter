import { describe, expect, it } from 'vitest';
import { itemSize } from '../content/items';
import { foldParts } from '../content/models';
import { placeAt, type Item } from '../inventory/grid';
import { buyPrice } from '../vendors';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip } from './gear';
import { applyInventory, FOLD_TIME, type InventoryAction, type Owner } from './looting';
import { createState, spawnCharacter } from './state';
import { TEST_ITEMS as items } from './test-items';
import { createWeapon, createWeaponStats, detach, weaponStats, type WeaponState } from './weapons';

// WF-1: stocks as parts, folding, and a gun's size following its stock.

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
  const act = (a: InventoryAction, stash = false): boolean =>
    applyInventory(state, c, items, a, world, stash);
  const inPack = (index: number, item: string) =>
    ({ owner: self, grid: 'backpack', index, item }) as const;
  return { state, c, pack, act, inPack };
}

describe('stocks', () => {
  it('come on a new gun by default, and set its length', () => {
    const gun = createWeapon(items, 'carbine');
    expect(gun.attachments.stock).toBe('stock');
    expect(itemSize(items, gun)).toEqual([4, 2]);
    detach(gun, items, 'stock');
    expect(itemSize(items, gun)).toEqual([3, 2]);
    // Asking for another stock puts it on over the default.
    const other = createWeapon(items, 'carbine', ['folding-stock']);
    expect(other.attachments.stock).toBe('folding-stock');
    expect(itemSize(items, other)).toEqual([5, 2]);
    other.folded = true;
    expect(itemSize(items, other)).toEqual([4, 2]);
  });

  it('are the big recoil part: off, or folded, none of their mods apply', () => {
    const s = createWeaponStats();
    const gun = createWeapon(items, 'carbine');
    weaponStats(items, gun, s);
    expect([s.recoilUp, s.recoilSide, s.recoilRecovery]).toEqual([1, 0.5, 20]);
    const folding = createWeapon(items, 'carbine', ['folding-stock']);
    expect(weaponStats(items, folding, s).recoilUp).toBe(0.5);
    folding.folded = true;
    expect(weaponStats(items, folding, s).recoilUp).toBe(2);
    detach(gun, items, 'stock');
    expect(weaponStats(items, gun, s).recoilUp).toBe(2);
  });

  it('a vendor charges for the stock a gun comes with', () => {
    expect(buyPrice(items, { item: 'carbine' } as never)).toBe(200);
    expect(buyPrice(items, { item: 'carbine', attachments: ['folding-stock'] } as never)).toBe(200);
  });

  it('going on a gun in a grid needs the cells it grows into', () => {
    const { pack, act, inPack } = setup();
    const gun = createWeapon(items, 'carbine');
    detach(gun, items, 'stock');
    expect(placeAt(items, pack, gun, 0, 0, false)).toBe(true); // 3 × 2 at the top left
    const stock = createItem(items, 'stock');
    expect(placeAt(items, pack, stock, 2, 2, false)).toBe(true);
    const blocker: Item = createItem(items, 'bandage');
    expect(placeAt(items, pack, blocker, 3, 0, false)).toBe(true);
    const attach: InventoryAction = {
      type: 'attach',
      gun: inPack(0, 'carbine'),
      from: inPack(1, 'stock'),
    };
    expect(act(attach)).toBe(false);
    expect(gun.attachments.stock).toBeNull();
    pack.items.splice(2, 1); // the bandage goes
    expect(act(attach)).toBe(true);
    expect(gun.attachments.stock).toBe('stock');
    expect(pack.items).toHaveLength(1);
  });

  it('a stock lying where the gun grows can still go on it', () => {
    const { pack, act, inPack } = setup();
    const gun = createWeapon(items, 'carbine');
    detach(gun, items, 'stock');
    placeAt(items, pack, gun, 0, 0, false);
    placeAt(items, pack, createItem(items, 'stock'), 3, 0, true);
    expect(act({ type: 'attach', gun: inPack(0, 'carbine'), from: inPack(1, 'stock') })).toBe(true);
  });
});

describe('folding', () => {
  it('only a stock that folds; unfolding needs room; folding never does', () => {
    const { pack, act, inPack } = setup();
    const fixed = createWeapon(items, 'carbine');
    placeAt(items, pack, fixed, 0, 2, false);
    expect(act({ type: 'fold', gun: inPack(0, 'carbine'), folded: true })).toBe(false);

    const gun = createWeapon(items, 'carbine', ['folding-stock']) as WeaponState;
    gun.folded = true;
    placeAt(items, pack, gun, 0, 0, false); // 4 × 2 folded, the whole width
    // Unfolded it's 5 long: off the edge of the 4-wide grid.
    expect(act({ type: 'fold', gun: inPack(1, 'carbine'), folded: false })).toBe(false);
    expect(gun.folded).toBe(true);
    // Already folded: nothing to do.
    expect(act({ type: 'fold', gun: inPack(1, 'carbine'), folded: true })).toBe(false);
  });

  it('the gun in hand takes a moment to be ready again, not one in the stash', () => {
    const { c, act } = setup();
    const gun = createWeapon(items, 'carbine', ['folding-stock']);
    equip(c, items, 'primary1', gun);
    c.gear.hand = 'primary1';
    c.draw = 0;
    const hand = { owner: self, slot: 'primary1', item: 'carbine' } as const;
    expect(act({ type: 'fold', gun: hand, folded: true })).toBe(true);
    expect(gun.folded).toBe(true);
    expect(c.draw).toBe(FOLD_TIME);
    c.draw = 0;
    expect(act({ type: 'fold', gun: hand, folded: false }, true)).toBe(true);
    expect(gun.folded).toBeUndefined();
    expect(c.draw).toBe(0);
  });

  it('taking a folded stock off leaves the gun unfolded', () => {
    const gun = createWeapon(items, 'carbine', ['folding-stock']);
    gun.folded = true;
    detach(gun, items, 'stock');
    expect(gun.folded).toBeUndefined();
  });

  it('turns parts about the hinge, their own yaw included', () => {
    const [p] = foldParts(
      [{ type: 'box', pos: [0, 0.01, 0.2], size: [0.04, 0.07, 0.2], color: '#000000' }],
      { pivot: [-0.03, 0, 0], yaw: 180 },
    );
    expect(p!.pos[0]).toBeCloseTo(-0.06);
    expect(p!.pos[1]).toBe(0.01);
    expect(p!.pos[2]).toBeCloseTo(-0.2);
    expect(p!.yaw).toBe(180);
    const [slid] = foldParts(
      [{ type: 'box', pos: [0, 0, 0.2], size: [0.04, 0.07, 0.2], color: '#000000' }],
      { pivot: [0, 0, 0], shift: [0, 0, -0.15] },
    );
    expect(slid!.pos[2]).toBeCloseTo(0.05);
    expect(slid!.yaw).toBeUndefined();
  });
});
