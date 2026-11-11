import { describe, expect, it } from 'vitest';
import { ammoDef, containerDef, type ItemDb } from '../content/items';
import { addItem, createGrid, placeAt, type Grid } from '../inventory/grid';
import { checkGear, settleBags } from '../profile';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import {
  ARMOURED_RIG_WORN,
  BODY_ARMOUR_WORN,
  chestArmour,
  createGear,
  equip,
  gearConflict,
  type ContainerState,
} from './gear';
import { ARMOUR, CHEST, restoreHealth, shootCharacter, wearArmour } from './health';
import { applyInventory, type InventoryAction, type Owner } from './looting';
import { repairArmour } from './repair';
import { createState, spawnCharacter } from './state';
import { TEST_ITEMS as items } from './test-items';

/*
 * Armoured rigs (2026-11-11, the user's call): a rig whose armour covers the chest as body
 * armour does, and which can't be worn with body armour.
 */

const world = new CollisionWorld({
  terrain: {
    minX: -20,
    minZ: -20,
    cellSize: 2,
    cols: 20,
    rows: 20,
    heights: Array(21 * 21).fill(0),
  },
  boxes: [],
  ramps: [],
  ladders: [],
});

const self: Owner = { kind: 'self' };

function setup() {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  equip(c, items, 'backpack', createItem(items, 'backpack'));
  const act = (a: InventoryAction): boolean => applyInventory(state, c, items, a);
  return { state, c, act };
}

describe('armoured rigs', () => {
  it('come new at full durability, and other rigs have none', () => {
    expect(createItem(items, 'plate-rig').durability).toBe(60);
    expect(createItem(items, 'rig').durability).toBeUndefined();
  });

  it('cover the chest as body armour does, wearing by the same rules', () => {
    const { state, c } = setup();
    equip(c, items, 'rig', createItem(items, 'plate-rig'));
    expect(chestArmour(items, c.gear)).toBe(c.gear.rig);
    // A level 3 round against level 4: nothing through, and it wears as the vest would.
    shootCharacter(state, items, c, CHEST, ammoDef(items, 'round'), 0);
    expect(c.health.hp[CHEST]).toBe(85);
    expect(c.gear.rig?.durability).toBeCloseTo(60 - 10 * ARMOUR.wear[1]);
    // Healed back to full, it's mended too.
    restoreHealth(c, items);
    expect(c.gear.rig?.durability).toBe(60);
  });

  it("don't count as armour without armour, and body armour comes first", () => {
    const gear = createGear(false);
    gear.rig = createItem(items, 'rig') as ContainerState;
    expect(chestArmour(items, gear)).toBeNull();
  });

  it('are repaired as armour, losing some max', () => {
    const rig = createItem(items, 'plate-rig');
    rig.durability = 30;
    const kit = createItem(items, 'repair-kit');
    expect(repairArmour(items, kit, rig)).toBeGreaterThan(0);
    expect(rig.durability).toBeGreaterThan(30);
    expect(rig.max).toBeLessThan(60);
  });

  it("won't go on over body armour, nor body armour under one", () => {
    const { c, act } = setup();
    wearArmour(c, items, 'vest');
    const bag = c.gear.backpack!.grid;
    placeAt(items, bag, createItem(items, 'plate-rig'), 0, 0, false);
    expect(gearConflict(items, c.gear, 'rig', bag.items[0]!.item)).toBe(BODY_ARMOUR_WORN);
    const from = { owner: self, grid: 'backpack' as const, index: 0, item: 'plate-rig' };
    expect(act({ type: 'move', from, to: { owner: self, slot: 'rig' } })).toBe(false);
    expect(c.gear.rig).toBeNull();
    // A double-tap doesn't put it on either.
    act({ type: 'quick', from, to: self });
    expect(c.gear.rig).toBeNull();

    // The other way round: with the rig on, the vest won't go on.
    c.gear.bodyArmour = null;
    expect(act({ type: 'move', from, to: { owner: self, slot: 'rig' } })).toBe(true);
    const vest = createItem(items, 'vest');
    placeAt(items, bag, vest, 0, 0, false);
    expect(gearConflict(items, c.gear, 'bodyArmour', vest)).toBe(ARMOURED_RIG_WORN);
    const vestRef = { owner: self, grid: 'backpack' as const, index: 0, item: 'vest' };
    expect(act({ type: 'move', from: vestRef, to: { owner: self, slot: 'bodyArmour' } })).toBe(
      false,
    );
    expect(c.gear.bodyArmour).toBeNull();
  });

  it('are refused in a saved profile with body armour, and settled out of one', () => {
    const gear = createGear(true);
    gear.rig = createItem(items, 'plate-rig') as ContainerState;
    gear.bodyArmour = createItem(items, 'vest') as typeof gear.bodyArmour;
    expect(checkGear(items, gear)).toMatch(/armoured rig/);
    // Saved before the rig had armour: it gets durability, and the vest goes to the stash.
    delete gear.rig.durability;
    const page = createGrid(10, 10, true);
    settleBags(items, gear, [page]);
    expect(gear.rig.durability).toBe(60);
    expect(gear.bodyArmour).toBeNull();
    expect(page.items[0]?.item.item).toBe('vest');
    expect(checkGear(items, gear)).toBeNull();
  });
});

/** n watches (1 × 1, not stacking) in a grid. */
function fill(db: ItemDb, grid: Grid, n: number): void {
  for (let i = 0; i < n; i++) addItem(db, grid, createItem(db, 'watch'));
}

describe('swapping a bag with things in it for an empty one (2026-11-11)', () => {
  it("moves an armoured rig's contents into the plain rig put on in its place", () => {
    const { c, act } = setup();
    equip(c, items, 'rig', createItem(items, 'plate-rig'));
    fill(items, c.gear.rig!.grid, 4);
    placeAt(items, c.gear.backpack!.grid, createItem(items, 'rig'), 0, 0, false);
    const from = { owner: self, grid: 'backpack' as const, index: 0, item: 'rig' };
    expect(act({ type: 'move', from, to: { owner: self, slot: 'rig' } })).toBe(true);
    expect(c.gear.rig?.item).toBe('rig');
    expect(c.gear.rig?.grid.items).toHaveLength(4);
    // The armoured rig went into the backpack, empty, where the plain one was.
    const old = c.gear.backpack!.grid.items.find((g) => g.item.item === 'plate-rig');
    expect(old?.item.grid?.items).toHaveLength(0);
  });

  it('drops what the new rig has no room for at your feet, in a raid', () => {
    const { state, c, act } = setup();
    equip(c, items, 'rig', createItem(items, 'rig'));
    fill(items, c.gear.rig!.grid, 6);
    placeAt(items, c.gear.backpack!.grid, createItem(items, 'plate-rig'), 0, 0, false);
    const from = { owner: self, grid: 'backpack' as const, index: 0, item: 'plate-rig' };
    expect(act({ type: 'move', from, to: { owner: self, slot: 'rig' } })).toBe(true);
    expect(c.gear.rig?.grid.items).toHaveLength(4);
    expect(state.ground.filter((g) => g.item.item === 'watch')).toHaveLength(2);
  });

  it('does the same for backpacks', () => {
    const db: ItemDb = new Map(items).set('small-pack', {
      ...containerDef(items, 'backpack'),
      id: 'small-pack',
      grid: [2, 2],
    });
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    equip(c, db, 'backpack', createItem(db, 'backpack'));
    fill(db, c.gear.backpack!.grid, 6);
    state.ground.push({ item: createItem(db, 'small-pack'), x: 0, y: 0, z: 0, yaw: 0 });
    const from = { owner: { kind: 'ground' as const }, ground: 0, item: 'small-pack' };
    expect(
      applyInventory(state, c, db, { type: 'move', from, to: { owner: self, slot: 'backpack' } }),
    ).toBe(true);
    expect(c.gear.backpack?.item).toBe('small-pack');
    expect(c.gear.backpack?.grid.items).toHaveLength(4);
    // The old backpack where the new one lay, empty, and 2 watches beside it.
    const ground = state.ground.map((g) => g.item);
    expect(ground.find((i) => i.item === 'backpack')?.grid?.items).toHaveLength(0);
    expect(ground.filter((i) => i.item === 'watch')).toHaveLength(2);
  });

  it('puts what has no room on the stash pages between raids', () => {
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    const page = createGrid(6, 6, true);
    state.loot.push({ id: 'page-0', def: 'page', x: 0, y: 0, z: 0, grid: page });
    equip(c, items, 'rig', createItem(items, 'rig'));
    fill(items, c.gear.rig!.grid, 6);
    placeAt(items, page, createItem(items, 'plate-rig'), 0, 0, false);
    const from = { owner: { kind: 'container', id: 'page-0' } as Owner, grid: 'loot' as const };
    const move: InventoryAction = {
      type: 'move',
      from: { ...from, index: 0, item: 'plate-rig' },
      to: { owner: self, slot: 'rig' },
    };
    expect(applyInventory(state, c, items, move, undefined, true)).toBe(true);
    expect(c.gear.rig?.grid.items).toHaveLength(4);
    expect(state.ground).toHaveLength(0);
    expect(page.items.filter((g) => g.item.item === 'watch')).toHaveLength(2);
    expect(page.items.find((g) => g.item.item === 'rig')?.item.grid?.items).toHaveLength(0);
  });
});
