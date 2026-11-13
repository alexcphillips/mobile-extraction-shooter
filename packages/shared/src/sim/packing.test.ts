import { describe, expect, it } from 'vitest';
import { addItem, countOf, type Item } from '../inventory/grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip } from './gear';
import { applyInventory, type InventoryAction, type Owner } from './looting';
import { PACKING, packable } from './packing';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { canReload, createWeapon, giveWeapon } from './weapons';
import { spawnEnemy } from './ai';
import { NavGrid } from '../nav/nav-grid';
import { MOVEMENT } from './movement';

// MG-2: packing and unloading magazines take time in a raid.

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

const mag = (n: number, round = 'round'): Item => ({
  ...createItem(items, 'smg-mag'),
  ...(n > 0 && { mag: n, loaded: round }),
});

function setup() {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  equip(c, items, 'rig', createItem(items, 'rig'));
  const gun = createWeapon(items, 'smg');
  equip(c, items, 'primary1', gun);
  c.gear.hand = 'primary1';
  c.draw = 0;
  const rig = c.gear.rig!.grid;
  const tick = (input: Partial<PlayerInput> = {}, n = 1) => {
    for (let i = 0; i < n; i++) step(state, world, items, { [c.id]: { ...idle, ...input } });
  };
  const act = (a: InventoryAction, stash = false) =>
    applyInventory(state, c, items, a, world, stash);
  /** Ticks for that many seconds. */
  const secs = (s: number, input: Partial<PlayerInput> = {}) =>
    tick(input, Math.round(s * TICK_RATE));
  return { state, c, gun, rig, tick, act, secs };
}

describe('Pack Mags', () => {
  it('fills the fullest magazine first, a round every 0.45 s', () => {
    const { c, rig, act, secs } = setup();
    addItem(items, rig, mag(0));
    addItem(items, rig, mag(5));
    addItem(items, rig, createItem(items, 'round', 30));
    expect(packable(c, items)).toBe(30);
    expect(act({ type: 'pack' })).toBe(true);
    expect(c.packing).toMatchObject({ kind: 'pack', done: 0, total: 30 });
    secs(PACKING.perRound * 10 + 0.01);
    expect(rig.items[1]!.item.mag).toBe(15);
    expect(rig.items[0]!.item.mag).toBeUndefined();
    // Walking doesn't stop it.
    secs(PACKING.perRound * 20, { moveY: 1 });
    expect(rig.items[1]!.item.mag).toBe(20);
    expect(rig.items[0]!.item).toMatchObject({ mag: 15, loaded: 'round' });
    expect(c.packing).toBeUndefined();
    // The loose rounds are all gone.
    expect(rig.items.some((g) => g.item.item === 'round')).toBe(false);
  });

  it('firing, aiming or reloading stops it, keeping what is packed', () => {
    for (const input of [{ fire: true }, { aim: true }, { reload: true }] as const) {
      const { c, rig, act, secs, tick } = setup();
      addItem(items, rig, mag(0));
      addItem(items, rig, createItem(items, 'round', 30));
      act({ type: 'pack' });
      secs(PACKING.perRound * 3 + 0.01);
      tick(input);
      expect(c.packing).toBeUndefined();
      expect(rig.items[0]!.item.mag).toBe(3);
    }
  });

  it("an empty magazine takes the held gun's round, else the highest level", () => {
    const { c, gun, rig, act } = setup();
    addItem(items, rig, mag(0));
    addItem(items, rig, createItem(items, 'ap-round', 30));
    addItem(items, rig, createItem(items, 'round', 30));
    // The SMG has `round` loaded: that's what goes in.
    expect(act({ type: 'pack' }, true)).toBe(true);
    expect(rig.items[0]!.item).toMatchObject({ mag: 20, loaded: 'round' });
    gun.mag = 0;
    c.gear.hand = 'knife';
    addItem(items, rig, mag(0));
    act({ type: 'pack' }, true);
    expect(rig.items.find((g, i) => i > 0 && g.item.item === 'smg-mag')!.item.loaded).toBe(
      'ap-round',
    );
  });

  it('is at once between raids, and refused with nothing to pack', () => {
    const { c, rig, act } = setup();
    expect(act({ type: 'pack' })).toBe(false);
    addItem(items, rig, mag(0));
    addItem(items, rig, createItem(items, 'round', 50));
    expect(act({ type: 'pack' }, true)).toBe(true);
    expect(c.packing).toBeUndefined();
    expect(rig.items[0]!.item.mag).toBe(20);
  });

  it('a tap on stop ends it', () => {
    const { c, rig, act } = setup();
    addItem(items, rig, mag(0));
    addItem(items, rig, createItem(items, 'round', 30));
    act({ type: 'pack' });
    expect(act({ type: 'pack', stop: true })).toBe(true);
    expect(c.packing).toBeUndefined();
  });
});

describe('loading and unloading a magazine in a raid', () => {
  it('rounds dropped on a magazine go in a round at a time', () => {
    const { c, rig, act, secs } = setup();
    addItem(items, rig, mag(0));
    addItem(items, rig, createItem(items, 'round', 8));
    const m = { owner: self, grid: 'rig', index: 0, item: 'smg-mag' } as const;
    const from = { owner: self, grid: 'rig', index: 1, item: 'round' } as const;
    expect(act({ type: 'load', gun: m, from })).toBe(true);
    expect(rig.items[0]!.item.mag).toBeUndefined();
    secs(PACKING.perRound * 4 + 0.01);
    expect(rig.items[0]!.item.mag).toBe(4);
    secs(PACKING.perRound * 4);
    expect(rig.items[0]!.item.mag).toBe(8);
    expect(rig.items).toHaveLength(1);
    expect(c.packing).toBeUndefined();
  });

  it('unloading takes them out a round at a time, quicker', () => {
    const { c, rig, act, secs } = setup();
    addItem(items, rig, mag(10));
    const m = { owner: self, grid: 'rig', index: 0, item: 'smg-mag' } as const;
    expect(act({ type: 'unload', gun: m })).toBe(true);
    secs(PACKING.unloadPerRound * 4 + 0.01);
    expect(rig.items[0]!.item.mag).toBe(6);
    // Into what you carry (pockets first).
    expect(countOf(c.gear.pockets, 'round') + countOf(rig, 'round')).toBe(4);
    secs(PACKING.unloadPerRound * 6);
    expect(rig.items[0]!.item.mag).toBeUndefined();
    expect(c.packing).toBeUndefined();
  });

  it('unloading the gun in hand empties its magazine, and firing stops it', () => {
    const { c, gun, act, secs, tick } = setup();
    gun.mag = 10;
    const ref = { owner: self, slot: 'primary1', item: 'smg' } as const;
    expect(act({ type: 'unload', gun: ref })).toBe(true);
    secs(PACKING.unloadPerRound * 3 + 0.01);
    expect(gun.mag).toBe(7);
    tick({ fire: true });
    expect(c.packing).toBeUndefined();
  });

  it('a med stops it', () => {
    const { c, rig, act, tick } = setup();
    addItem(items, rig, mag(10));
    act({ type: 'unload', gun: { owner: self, grid: 'rig', index: 0, item: 'smg-mag' } });
    c.using = { grid: 0, index: 0, item: 'bandage', left: 3 };
    tick();
    expect(c.packing).toBeUndefined();
  });
});

describe('enemies keep their magazines full (MG-4)', () => {
  function enemy() {
    const state = createState(1);
    const nav = new NavGrid(world);
    const e = spawnEnemy(state, world, 0, 0, 0, 0, { faction: 'scav' });
    equip(e, items, 'rig', createItem(items, 'rig'));
    const gun = giveWeapon(e, items, 'smg');
    return { state, nav, e, gun, rig: e.gear.rig!.grid };
  }

  it('swaps only to a full magazine, or when under half', () => {
    const { state, e, gun, rig } = enemy();
    gun.mag = 12;
    addItem(items, rig, mag(15));
    expect(canReload(state, e, items, gun)).toBe(false);
    gun.mag = 9;
    expect(canReload(state, e, items, gun)).toBe(true);
    gun.mag = 12;
    addItem(items, rig, mag(20));
    expect(canReload(state, e, items, gun)).toBe(true);
  });

  it("its magazine fills from its loose rounds as it goes in: the magazine's round", () => {
    const { state, nav, e, gun, rig } = enemy();
    gun.mag = 0;
    addItem(items, rig, mag(5, 'ap-round'));
    addItem(items, rig, createItem(items, 'ap-round', 30));
    addItem(items, rig, createItem(items, 'round', 30));
    e.ai!.input.reload = true;
    for (let t = 0; t < 3 * TICK_RATE; t++) step(state, world, items, {}, nav);
    expect([gun.mag, gun.loaded]).toEqual([20, 'ap-round']);
    expect(countOf(rig, 'ap-round')).toBe(15);
    expect(countOf(rig, 'round')).toBe(30);
  });

  it("an empty spare takes the gun's round; it never packs", () => {
    const { state, nav, e, gun, rig } = enemy();
    gun.mag = 3;
    addItem(items, rig, mag(0));
    addItem(items, rig, createItem(items, 'round', 30));
    expect(canReload(state, e, items, gun)).toBe(true);
    for (let t = 0; t < 4 * TICK_RATE; t++) step(state, world, items, {}, nav);
    expect(gun.mag).toBe(20);
    expect(e.packing).toBeUndefined();
    // The old one back with its 3, not packed.
    expect(
      [...e.gear.pockets.items, ...rig.items].find((g) => g.item.item === 'smg-mag')!.item.mag,
    ).toBe(3);
  });
});

describe('packing slows you (MG-4)', () => {
  it('walks at most MOVEMENT.packSpeed, sprint or not, and full speed again after', () => {
    const { c, rig, act, tick } = setup();
    addItem(items, rig, mag(0));
    addItem(items, rig, createItem(items, 'round', 30));
    act({ type: 'pack' });
    tick({ moveY: 1, sprint: true }, 5);
    expect(Math.hypot(c.vx, c.vz)).toBeCloseTo(MOVEMENT.packSpeed, 5);
    act({ type: 'pack', stop: true });
    tick({ moveY: 1 }, 5);
    expect(Math.hypot(c.vx, c.vz)).toBeGreaterThan(MOVEMENT.packSpeed);
  });
});
