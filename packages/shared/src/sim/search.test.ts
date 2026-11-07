import { describe, expect, it } from 'vitest';
import { createGrid, placeAt } from '../inventory/grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import { equip } from './gear';
import { HEAD, dealDamage } from './health';
import { applyInventory, type InventoryAction, type LootContainer, type Owner } from './looting';
import { SEARCH, revealed } from './search';
import { createState, spawnCharacter, type Character, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';

const world = new CollisionWorld({
  terrain: { minX: -20, minZ: -20, cellSize: 4, cols: 10, rows: 10, heights: Array(121).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});

const stand: PlayerInput = {
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

const self: Owner = { kind: 'self' };
const box: Owner = { kind: 'container', id: 'crate' };

/**
 * A raid (searches on) with a player by a crate holding a watch, a bandage and rounds, in
 * that order across its top row, and a dead enemy wearing a rifle with a watch in its pockets.
 */
function setup() {
  const state = createState(1);
  state.raid = { endTick: 1e9, extractions: [], investigate: [], searches: {} };
  const c = spawnCharacter(state, world, 0, 0);
  equip(c, items, 'backpack', createItem(items, 'backpack'));
  const crate: LootContainer = {
    id: 'crate',
    def: 'crate',
    x: 0,
    y: 0,
    z: 1,
    grid: createGrid(4, 3, true),
  };
  placeAt(items, crate.grid, createItem(items, 'round', 30), 2, 0, false);
  placeAt(items, crate.grid, createItem(items, 'watch'), 0, 0, false);
  placeAt(items, crate.grid, createItem(items, 'bandage'), 1, 0, false);
  state.loot.push(crate);
  const enemy = spawnEnemy(state, world, 1, 0, 0, 0, {});
  equip(enemy, items, 'primary1', createItem(items, 'rifle'));
  placeAt(items, enemy.gear.pockets, createItem(items, 'watch'), 0, 0, false);
  dealDamage(state, enemy, HEAD, 1000, 0);
  const body: Owner = { kind: 'body', id: enemy.id };
  /** Steps with what's open being searched, for so many seconds. */
  const search = (key: string | null, seconds: number, who: Character = c): void => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++)
      step(state, world, items, { [who.id]: { ...stand, looting: key } });
  };
  const act = (a: InventoryAction): boolean => applyInventory(state, c, items, a);
  return { state, c, crate, enemy, body, search, act };
}

const take = (index: number, item: string): InventoryAction => ({
  type: 'quick',
  from: { owner: box, grid: 'loot', index, item },
  to: self,
});

describe('searching', () => {
  it('finds a container’s items one at a time, top left first, while it’s open', () => {
    const { state, c, crate, search, act } = setup();
    expect(revealed(state, c, box)).toMatchObject({ found: 0, total: 3 });
    // Hidden: can't be taken.
    expect(act(take(1, 'watch'))).toBe(false);
    search('c:crate', SEARCH.perItem + 0.02);
    const r = revealed(state, c, box)!;
    expect(r.found).toBe(1);
    expect(r.shown.has(crate.grid.items[1]!.item)).toBe(true);
    // Closed: no further.
    search(null, 5);
    expect(revealed(state, c, box)!.found).toBe(1);
    // Taking the watch shows nothing more; the search carries on where it stopped.
    expect(act(take(1, 'watch'))).toBe(true);
    expect(revealed(state, c, box)).toMatchObject({ found: 0, total: 2 });
    expect(act(take(1, 'bandage'))).toBe(false);
    search('c:crate', SEARCH.perItem * 2 + 0.05);
    expect(revealed(state, c, box)).toMatchObject({ found: 2, total: 2 });
    expect(act(take(1, 'bandage'))).toBe(true);
  });

  it('is each player’s own, and needs the container in reach', () => {
    const { state, c, search } = setup();
    const friend = spawnCharacter(state, world, 0.5, 0);
    search('c:crate', 5);
    expect(revealed(state, c, box)!.found).toBe(3);
    expect(revealed(state, friend, box)!.found).toBe(0);
    // Out of reach: no searching.
    friend.x = 15;
    search('c:crate', 5, friend);
    expect(revealed(state, friend, box)!.found).toBe(0);
  });

  it('shows what a body wears at once, and searches its pockets, rig and backpack', () => {
    const { state, c, enemy, body, search, act } = setup();
    // The rifle it wears can be taken straight away.
    expect(
      act({
        type: 'quick',
        from: { owner: body, slot: 'primary1', item: 'rifle' },
        to: self,
      }),
    ).toBe(true);
    const fromPockets: InventoryAction = {
      type: 'quick',
      from: { owner: body, grid: 'pockets', index: 0, item: 'watch' },
      to: self,
    };
    expect(act(fromPockets)).toBe(false);
    search(`b:${enemy.id}`, SEARCH.perItem + 0.02);
    expect(revealed(state, c, body)).toMatchObject({ found: 1, total: 1 });
    expect(act(fromPockets)).toBe(true);
  });

  it('won’t take a drop onto something not yet found', () => {
    const { c, act } = setup();
    c.gear.backpack!.grid.items.push({
      x: 0,
      y: 0,
      rotated: false,
      item: createItem(items, 'watch'),
    });
    // Onto the hidden rounds at (2, 0): refused. Onto an empty cell: fine.
    const drop = (x: number): InventoryAction => ({
      type: 'move',
      from: { owner: self, grid: 'backpack', index: 0, item: 'watch' },
      to: { owner: box, grid: 'loot', x, y: 0, rotated: false },
    });
    expect(act(drop(2))).toBe(false);
    expect(act(drop(3))).toBe(true);
  });

  it('is off outside a raid that keeps searches: everything shows', () => {
    const { state, c, act } = setup();
    delete state.raid!.searches;
    expect(revealed(state, c, box)).toBeNull();
    expect(act(take(1, 'watch'))).toBe(true);
  });
});
