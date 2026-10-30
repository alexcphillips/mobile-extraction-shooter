import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import { LOOT_TABLE_FORMAT_VERSION, type LootTableDef } from '../content/loot-tables';
import { countOf, createGrid } from '../inventory/grid';
import { createRng } from '../rng';
import { CollisionWorld } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import { equip } from './gear';
import { fillLootContainers, rollEnemyLoot, rollLootSpawns, rollTable } from './loot-roll';
import { createState } from './state';
import { TEST_ITEMS as items } from './test-items';

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});

function table(
  id: string,
  rolls: [number, number],
  entries: LootTableDef['items'],
): [string, LootTableDef] {
  return [id, { formatVersion: LOOT_TABLE_FORMAT_VERSION, id, name: id, rolls, items: entries }];
}

const tables = new Map([
  table(
    'house',
    [2, 4],
    [
      { item: 'cash', weight: 3, count: [10, 50] },
      { item: 'watch', weight: 1 },
    ],
  ),
  table('meds', [1, 1], [{ item: 'bandage', weight: 1 }]),
  table('guns', [1, 1], [{ item: 'rifle', weight: 1 }]),
]);

describe('loot tables', () => {
  it('rolls its number of items by weight, with counts for stacks', () => {
    const rng = createRng(7);
    const seen = { cash: 0, watch: 0 };
    let total = 0;
    for (let i = 0; i < 300; i++) {
      const out = rollTable(items, tables.get('house')!, rng);
      expect(out.length).toBeGreaterThanOrEqual(2);
      expect(out.length).toBeLessThanOrEqual(4);
      for (const item of out) {
        seen[item.item as keyof typeof seen]++;
        total++;
        if (item.item === 'cash') {
          expect(item.count).toBeGreaterThanOrEqual(10);
          expect(item.count).toBeLessThanOrEqual(50);
        } else expect(item.count).toBe(1);
      }
    }
    // About 3 to 1.
    expect(seen.cash / total).toBeGreaterThan(0.68);
    expect(seen.cash / total).toBeLessThan(0.82);
    // A gun comes with a full magazine, like any new one.
    expect(rollTable(items, tables.get('guns')!, rng)[0]).toMatchObject({ item: 'rifle', mag: 30 });
  });

  it('fills containers from their markers’ tables, the same for the same seed', () => {
    const map = {
      markers: [
        { type: 'lootContainer', id: 'a', lootTable: 'house' },
        { type: 'lootContainer', id: 'b', lootTable: 'meds' },
      ],
    } as unknown as CompiledMap;
    const fill = (seed: number) => {
      const state = createState(seed);
      for (const id of ['a', 'b']) {
        state.loot.push({ id, def: 'desk', x: 0, y: 0, z: 0, grid: createGrid(4, 3, true) });
      }
      fillLootContainers(state, map, items, tables);
      return state.loot;
    };
    const [a, b] = fill(3);
    expect(a!.grid.items.length).toBeGreaterThanOrEqual(1);
    expect(b!.grid.items.map((g) => g.item.item)).toEqual(['bandage']);
    expect(fill(3)).toEqual(fill(3));

    const missing = { markers: [{ type: 'lootContainer', id: 'a', lootTable: 'nope' }] };
    const state = createState(1);
    state.loot.push({ id: 'a', def: 'desk', x: 0, y: 0, z: 0, grid: createGrid(4, 3, true) });
    expect(() =>
      fillLootContainers(state, missing as unknown as CompiledMap, items, tables),
    ).toThrow(/no loot table "nope"/);
  });

  it('stows enemy loot from its tables, weighted by the spawn, leaving out what doesn’t fit', () => {
    const loot = { rolls: [4, 4] as [number, number], tables: { meds: 1, guns: 0 } };
    const state = createState(1);
    const e = spawnEnemy(state, world, 0, 0, 0, 0, {});
    equip(e, items, 'backpack', createItem(items, 'backpack'));
    // Only meds: guns has no weight, and the spawn can't raise a 0.
    rollEnemyLoot(e, items, tables, loot, { guns: 5 }, state.rng);
    expect(countOf(e.gear.pockets, 'bandage') + countOf(e.gear.backpack!.grid, 'bandage')).toBe(4);

    // The spawn's weights turn meds off and guns on: rifles go in the backpack (4×4 fits
    // two 4×2), and the pockets can't take them.
    const f = spawnEnemy(state, world, 0, 0, 0, 0, {});
    equip(f, items, 'backpack', createItem(items, 'backpack'));
    rollEnemyLoot(
      f,
      items,
      tables,
      { ...loot, tables: { meds: 1, guns: 1 } },
      { meds: 0 },
      state.rng,
    );
    expect(f.gear.backpack!.grid.items.map((g) => g.item.item)).toEqual(['rifle', 'rifle']);
    expect(f.gear.pockets.items).toEqual([]);

    // No loot, or nothing with weight: nothing.
    const g = spawnEnemy(state, world, 0, 0, 0, 0, {});
    rollEnemyLoot(g, items, tables, undefined, undefined, state.rng);
    rollEnemyLoot(g, items, tables, loot, { meds: 0 }, state.rng);
    expect(g.gear.pockets.items).toEqual([]);
  });

  it('puts one item on the ground at each loot spawn that rolls its chance', () => {
    const spot = (id: string, x: number, chance?: number) => ({
      type: 'lootSpawn',
      id,
      lootTable: 'house',
      x,
      y: 2,
      z: 0,
      yaw: 0,
      ...(chance === undefined ? {} : { chance }),
    });
    const map = {
      markers: [spot('a', 1), spot('never', 2, 0), spot('b', 3, 1)],
    } as unknown as CompiledMap;
    const roll = (seed: number) => {
      const state = createState(seed);
      rollLootSpawns(state, map, items, tables);
      return state.ground;
    };
    const ground = roll(5);
    // One item each, however many the table's rolls say, lying where the marker is.
    expect(ground.map((g) => [g.x, g.y])).toEqual([
      [1, 2],
      [3, 2],
    ]);
    for (const g of ground) expect(['cash', 'watch']).toContain(g.item.item);
    expect(roll(5)).toEqual(roll(5));
    // Plain data: a JSON round trip changes nothing.
    expect(JSON.parse(JSON.stringify(ground))).toEqual(ground);
  });

  it('uses only one of the loot spawns sharing a oneOf name, picked at random', () => {
    const spot = (id: string, x: number, oneOf?: string) => ({
      type: 'lootSpawn',
      id,
      lootTable: 'meds',
      x,
      y: 0,
      z: 0,
      yaw: 0,
      ...(oneOf === undefined ? {} : { oneOf }),
    });
    const map = {
      markers: [spot('a', 1, 'key'), spot('b', 2, 'key'), spot('c', 3, 'key'), spot('d', 4)],
    } as unknown as CompiledMap;
    const used = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const state = createState(seed);
      rollLootSpawns(state, map, items, tables);
      const xs = state.ground.map((g) => g.x);
      // One of the group, and the spot outside it as usual.
      expect(xs).toHaveLength(2);
      expect(xs).toContain(4);
      used.add(xs.find((x) => x !== 4)!);
    }
    expect([...used].sort()).toEqual([1, 2, 3]);
  });
});
