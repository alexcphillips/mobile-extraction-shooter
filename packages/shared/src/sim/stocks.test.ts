import { describe, expect, it } from 'vitest';
import {
  clampPoints,
  FOLDED_STOCK,
  GUN_STATS,
  itemSize,
  pointsOf,
  statAt,
  stockFolds,
} from '../content/items';
import { foldParts } from '../content/models';
import { placeAt, type Item } from '../inventory/grid';
import { buyPrice } from '../vendors';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip } from './gear';
import { applyInventory, FOLD_TIME, type InventoryAction, type Owner } from './looting';
import { createState, spawnCharacter } from './state';
import { TEST_ITEMS as items } from './test-items';
import {
  attach,
  createWeapon,
  createWeaponStats,
  detach,
  weaponStats,
  type WeaponState,
} from './weapons';

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
  it('a new gun comes bare: its factory stock is in its size, a fitted one takes its place', () => {
    const gun = createWeapon(items, 'carbine');
    expect(gun.attachments.stock).toBeNull();
    expect(itemSize(items, gun)).toEqual([3, 2]);
    expect(itemSize(items, createWeapon(items, 'carbine', ['stock']))).toEqual([4, 2]);
    // The folder's one-cell factory stock is in its size, and a one-cell stock takes its place.
    const folder = createWeapon(items, 'folder');
    expect(itemSize(items, folder)).toEqual([4, 2]);
    expect(itemSize(items, createWeapon(items, 'folder', ['stock']))).toEqual([4, 2]);
    folder.folded = true;
    expect(itemSize(items, folder)).toEqual([3, 2]);
    const other = createWeapon(items, 'carbine', ['folding-stock']);
    expect(itemSize(items, other)).toEqual([5, 2]);
    other.folded = true;
    expect(itemSize(items, other)).toEqual([4, 2]);
    // Taking it off puts the factory stock back.
    detach(other, items, 'stock');
    expect(itemSize(items, other)).toEqual([3, 2]);
  });

  it("a fitted stock adds its points to the gun's own; folded, the fold change applies", () => {
    const s = createWeaponStats();
    const gun = createWeapon(items, 'carbine');
    weaponStats(items, gun, s);
    expect(s.recoilUp).toBeCloseTo(1);
    expect(s.recoilSide).toBeCloseTo(0.5);
    expect(s.recoilRecovery).toBe(10);
    const folding = createWeapon(items, 'carbine', ['folding-stock']);
    expect(weaponStats(items, folding, s).recoilUp).toBeCloseTo(0.25);
    folding.folded = true;
    const folded = { ...gun, folded: true as const };
    expect(weaponStats(items, folding, s).recoilUp).toBeCloseTo(
      statAt('recoilUp', pointsOf(items, folded, 'recoilUp')),
    );
    for (const stat of GUN_STATS)
      expect(pointsOf(items, folded, stat)).toBe(
        clampPoints(pointsOf(items, gun, stat) + (FOLDED_STOCK[stat] ?? 0)),
      );
    expect(FOLDED_STOCK.handling).toBeGreaterThan(0);
    expect(FOLDED_STOCK.stability).toBeLessThan(0);
  });

  it('a vendor charges for the gun, and for any stock the offer fits', () => {
    expect(buyPrice(items, { item: 'carbine' } as never)).toBe(100);
    expect(buyPrice(items, { item: 'carbine', attachments: ['folding-stock'] } as never)).toBe(200);
  });

  it('going on a gun in a grid needs the cells it grows into', () => {
    const { pack, act, inPack } = setup();
    const gun = createWeapon(items, 'carbine');
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

  it('a factory stock folds by itself, and with a fixed stock fitted the gun no longer folds', () => {
    const gun = createWeapon(items, 'folder');
    expect(stockFolds(items, gun)).toBe(true);
    expect(stockFolds(items, createWeapon(items, 'carbine'))).toBe(false);
    expect(stockFolds(items, createWeapon(items, 'folder', ['stock']))).toBe(false);
    expect(stockFolds(items, createWeapon(items, 'folder', ['folding-stock']))).toBe(true);
  });

  it('a stock going on a gun with its factory stock folded leaves it unfolded', () => {
    const gun = createWeapon(items, 'folder');
    gun.folded = true;
    attach(gun, items, 'stock');
    expect(gun.folded).toBeUndefined();
    expect(stockFolds(items, gun)).toBe(false);
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
