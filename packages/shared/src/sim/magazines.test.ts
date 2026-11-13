import { describe, expect, it } from 'vitest';
import { addItem, type Item } from '../inventory/grid';
import { sellPrice } from '../vendors';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip } from './gear';
import { applyInventory, loadKind, type InventoryAction, type Owner } from './looting';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { TICK_RATE } from '../tick';
import { createWeapon, spareRounds, weaponStats, createWeaponStats, RELOAD } from './weapons';

// MG-1: magazines as items, and reloads that swap them.

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});
const self: Owner = { kind: 'self' };
const idle: PlayerInput = {
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  crouch: false,
  jump: false,
  fire: false,
  aim: false,
  reload: false,
};

const mag = (id: string, n: number, round = 'round'): Item => ({
  ...createItem(items, id),
  ...(n > 0 && { mag: n, loaded: round }),
});

/** A player holding the SMG with its magazine at `left` rounds, a rig and a backpack. */
function setup(left = 5) {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  equip(c, items, 'rig', createItem(items, 'rig'));
  equip(c, items, 'backpack', createItem(items, 'backpack'));
  const gun = createWeapon(items, 'smg');
  gun.mag = left;
  equip(c, items, 'primary1', gun);
  c.gear.hand = 'primary1';
  c.draw = 0;
  const tick = (input: Partial<PlayerInput> = {}) =>
    step(state, world, items, { [c.id]: { ...idle, ...input } });
  const act = (a: InventoryAction, stash = false) =>
    applyInventory(state, c, items, a, world, stash);
  return { state, c, gun, tick, act };
}

describe('magazines', () => {
  it('a new gun comes with its magazine, full', () => {
    const gun = createWeapon(items, 'smg');
    expect(gun.attachments.magazine).toBe('smg-mag');
    expect(gun.mag).toBe(20);
    expect(weaponStats(items, gun, createWeaponStats()).magazine).toBe(20);
    gun.attachments.magazine = null;
    expect(weaponStats(items, gun, createWeaponStats()).magazine).toBe(0);
  });

  it('a reload puts in the fullest magazine from pockets or rig, the old one back', () => {
    const { c, gun, tick, state } = setup(5);
    addItem(items, c.gear.pockets, mag('smg-mag', 12));
    addItem(items, c.gear.rig!.grid, mag('smg-mag', 18, 'ap-round'));
    addItem(items, c.gear.backpack!.grid, mag('smg-mag', 20)); // out of reach for R
    expect(spareRounds(state, c, items, gun)).toBe(30);
    tick({ reload: true });
    for (let i = 0; i < 2 * TICK_RATE + 2; i++) tick();
    expect(gun.mag).toBe(18);
    expect(gun.loaded).toBe('ap-round');
    // The old one, with its 5 rounds, went back into pockets or rig.
    const carried = [...c.gear.pockets.items, ...c.gear.rig!.grid.items].map((g) => g.item);
    expect(carried).toContainEqual(expect.objectContaining({ item: 'smg-mag', mag: 5 }));
    expect(state.ground).toHaveLength(0);
  });

  it("won't swap to a magazine with no more rounds than the one in", () => {
    const { c, gun, tick } = setup(15);
    addItem(items, c.gear.pockets, mag('smg-mag', 10));
    tick({ reload: true });
    expect(gun.reloading).toBe(0);
  });

  it('with no room for the old one, it goes on the ground', () => {
    // A 2 × 2 drum out, with only 1 × 1 pockets to put it in.
    const { c, gun, tick, state } = setup(3);
    gun.attachments.magazine = 'smg-drum';
    addItem(items, c.gear.pockets, mag('smg-mag', 20));
    c.gear.rig = null;
    tick({ reload: true });
    for (let i = 0; i < 3 * TICK_RATE + 2; i++) tick();
    expect(gun.mag).toBe(20);
    expect(state.ground.map((g) => g.item)).toEqual([
      expect.objectContaining({ item: 'smg-drum', mag: 3 }),
    ]);
  });

  it('a fast reload is about 30% quicker and drops the old magazine', () => {
    const { c, gun, tick, state } = setup(5);
    addItem(items, c.gear.pockets, mag('smg-mag', 20));
    tick({ quickReload: true });
    expect(gun.reloading).toBeCloseTo(2 * RELOAD.quick, 5);
    for (let i = 0; i < 2 * TICK_RATE; i++) tick();
    expect(gun.mag).toBe(20);
    expect(state.ground.map((g) => g.item)).toEqual([
      expect.objectContaining({ item: 'smg-mag', mag: 5 }),
    ]);
  });

  it('a double-tap during a reload speeds it up', () => {
    const { c, gun, tick } = setup(5);
    addItem(items, c.gear.pockets, mag('smg-mag', 20));
    tick({ reload: true });
    const left = gun.reloading;
    tick({ quickReload: true });
    expect(gun.reloading).toBeCloseTo(left - 2 * (1 - RELOAD.quick) - 1 / TICK_RATE, 5);
    expect(gun.reloadQuick).toBe(true);
  });

  it('an enemy with no loaded magazine loads loose rounds into the one in its gun (MG-3)', () => {
    const { c, gun, tick } = setup(5);
    c.ai = c.ai ?? ({} as never);
    addItem(items, c.gear.pockets, createItem(items, 'round', 40));
    tick({ reload: true });
    const extra = 15 * RELOAD.aiLoosePerRound;
    for (let i = 0; i < (2 + extra) * TICK_RATE + 2; i++) tick();
    expect(gun.mag).toBe(20);
    expect(gun.attachments.magazine).toBe('smg-mag');
  });

  it('an enemy swaps to its fullest magazine, as a player does (MG-3)', () => {
    const { c, gun, tick } = setup(5);
    c.ai = c.ai ?? ({} as never);
    addItem(items, c.gear.pockets, mag('smg-mag', 20));
    addItem(items, c.gear.pockets, createItem(items, 'round', 40));
    tick({ reload: true });
    for (let i = 0; i < 2 * TICK_RATE + 2; i++) tick();
    expect(gun.mag).toBe(20);
    // The old one back in the pockets with its 5.
    expect(c.gear.pockets.items.some((g) => g.item.item === 'smg-mag' && g.item.mag === 5)).toBe(
      true,
    );
  });
});

describe('magazines in the inventory', () => {
  it('come off a gun with their rounds, and go on with them', () => {
    const { c, gun, act } = setup(7);
    const hand = { owner: self, slot: 'primary1', item: 'smg' } as const;
    expect(
      act({ type: 'detach', gun: hand, slot: 'magazine', part: 'smg-mag', to: null }, true),
    ).toBe(true);
    expect(gun.mag).toBe(0);
    expect(gun.attachments.magazine).toBeNull();
    const [loose] = c.gear.pockets.items;
    expect(loose!.item).toMatchObject({ item: 'smg-mag', mag: 7, loaded: 'round' });
    addItem(items, c.gear.rig!.grid, mag('smg-drum', 40, 'ap-round'));
    const drum = { owner: self, grid: 'rig', index: 0, item: 'smg-drum' } as const;
    expect(act({ type: 'attach', gun: hand, from: drum }, true)).toBe(true);
    expect(gun.mag).toBe(40);
    expect(gun.loaded).toBe('ap-round');
  });

  it('take rounds of one type, up to what they hold; unloading empties them (between raids)', () => {
    const { c, act, state } = setup();
    addItem(items, c.gear.rig!.grid, mag('smg-mag', 0));
    addItem(items, c.gear.rig!.grid, createItem(items, 'round', 30));
    addItem(items, c.gear.rig!.grid, createItem(items, 'ap-round', 30));
    const m = { owner: self, grid: 'rig', index: 0, item: 'smg-mag' } as const;
    const rounds = { owner: self, grid: 'rig', index: 1, item: 'round' } as const;
    const ap = { owner: self, grid: 'rig', index: 2, item: 'ap-round' } as const;
    expect(act({ type: 'load', gun: m, from: rounds }, true)).toBe(true);
    const loaded = c.gear.rig!.grid.items[0]!.item;
    expect(loaded).toMatchObject({ mag: 20, loaded: 'round' });
    expect(c.gear.rig!.grid.items[1]!.item.count).toBe(10);
    // Full; and another round type needs it emptied first.
    expect(loadKind(state, c, items, m, rounds, false)).toBeNull();
    loaded.mag = 10;
    expect(loadKind(state, c, items, m, ap, false)).toBeNull();
    expect(act({ type: 'unload', gun: m }, true)).toBe(true);
    expect(loaded.mag).toBeUndefined();
    expect(loadKind(state, c, items, m, ap, false)).toBe('load');
  });

  it("a magazine's rounds count when it's sold", () => {
    expect(sellPrice(items, mag('smg-mag', 10))).toBeGreaterThan(
      sellPrice(items, mag('smg-mag', 0)),
    );
  });
});
