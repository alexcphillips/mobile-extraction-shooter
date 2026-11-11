import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import { ammoDef, type ItemDb, type ItemDef } from '../content/items';
import { LOOT_TABLE_FORMAT_VERSION, type LootTableDef } from '../content/loot-tables';
import { countOf, createGrid } from '../inventory/grid';
import { createRng } from '../rng';
import { CollisionWorld } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import { equip } from './gear';
import {
  fillLootContainers,
  lootRounds,
  rollEnemyLoot,
  rollLootSpawns,
  rollMix,
  rollTable,
  type LootKinds,
} from './loot-roll';
import { createState } from './state';
import { loadedAmmo } from './weapons';
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

const kinds: LootKinds = new Map([
  ['desk', { formatVersion: 1, id: 'desk', name: 'Desk', grid: [4, 3] }],
  [
    'fridge',
    {
      formatVersion: 1,
      id: 'fridge',
      name: 'Fridge',
      grid: [4, 3],
      loot: { tables: { meds: 1 } },
    },
  ],
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
    // A gun whose caliber has no common or uncommon round of level 1 or 2 comes empty.
    expect(rollTable(items, tables.get('guns')!, rng)[0]).toMatchObject({ item: 'rifle', mag: 0 });
  });

  it('loads a found gun full, with a common or uncommon round of level 1 or 2 of its caliber', () => {
    const round = (id: string, level: number, rarity: string): [string, ItemDef] => [
      id,
      { ...ammoDef(items, 'round'), id, level, rarity } as ItemDef,
    ];
    const db: ItemDb = new Map([
      ...items,
      round('soft', 1, 'common'),
      round('fmj', 2, 'uncommon'),
      round('rare-low', 2, 'rare'),
    ]);
    const rng = createRng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const gun = rollTable(db, tables.get('guns')!, rng)[0]!;
      expect(gun.mag).toBe(30);
      seen.add(loadedAmmo(db, gun));
    }
    // Never its own round (level 3), a rare one or another caliber's.
    expect([...seen].sort()).toEqual(['fmj', 'soft']);
    expect(lootRounds(db, 'round')).toEqual(['soft', 'fmj']);
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
      fillLootContainers(state, map, items, tables, kinds);
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
      fillLootContainers(state, missing as unknown as CompiledMap, items, tables, kinds),
    ).toThrow(/no loot table "nope"/);
  });

  it('fills a container from one table of its mix, its own or its kind’s', () => {
    const mix = { tables: { meds: 4, guns: 1 }, empty: 5 };
    const rng = createRng(5);
    const seen = { meds: 0, guns: 0, empty: 0 };
    for (let i = 0; i < 1000; i++) {
      const out = rollMix(items, tables, mix, rng);
      if (!out.length) seen.empty++;
      else if (out[0]!.item === 'bandage') seen.meds++;
      else seen.guns++;
    }
    // 40%, 10% and 50%.
    expect(seen.meds / 1000).toBeGreaterThan(0.34);
    expect(seen.meds / 1000).toBeLessThan(0.46);
    expect(seen.guns / 1000).toBeGreaterThan(0.06);
    expect(seen.guns / 1000).toBeLessThan(0.14);

    const map = {
      markers: [
        { type: 'lootContainer', id: 'a', container: 'fridge' },
        { type: 'lootContainer', id: 'b', container: 'fridge', mix: { tables: { guns: 1 } } },
      ],
    } as unknown as CompiledMap;
    const state = createState(2);
    for (const id of ['a', 'b'])
      state.loot.push({ id, def: 'fridge', x: 0, y: 0, z: 0, grid: createGrid(4, 3, true) });
    fillLootContainers(state, map, items, tables, kinds);
    expect(state.loot.map((l) => l.grid.items.map((g) => g.item.item))).toEqual([
      ['bandage'],
      ['rifle'],
    ]);

    const none = { markers: [{ type: 'lootContainer', id: 'a', container: 'desk' }] };
    expect(() =>
      fillLootContainers(state, none as unknown as CompiledMap, items, tables, kinds),
    ).toThrow(/no loot/);
  });

  it('with each, picks every item’s table from the mix', () => {
    const rng = createRng(9);
    let mixed = 0;
    let fewer = 0;
    for (let i = 0; i < 200; i++) {
      // house's 2 to 4 rolls or meds' 1, each a bandage, a house item or nothing.
      const mix = { tables: { house: 1, meds: 1 }, empty: 1, each: true as const };
      const out = rollMix(items, tables, mix, rng);
      expect(out.length).toBeLessThanOrEqual(4);
      const kinds = new Set(out.map((it) => (it.item === 'bandage' ? 'meds' : 'house')));
      if (kinds.size === 2) mixed++;
      if (out.length < 2) fewer++;
    }
    expect(mixed).toBeGreaterThan(20);
    expect(fewer).toBeGreaterThan(0);
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

  it("picks a group's pick of units, a grouped copy's spots all together", () => {
    const spot = (id: string, x: number, oneOf?: string, unit?: string) => ({
      type: 'lootSpawn',
      id,
      lootTable: 'meds',
      x,
      y: 0,
      z: 0,
      yaw: 0,
      ...(oneOf === undefined ? {} : { oneOf }),
      ...(unit === undefined ? {} : { unit }),
    });
    const map = {
      markers: [
        spot('s1/a', 1, 'shelves', 's1'),
        spot('s1/b', 1.5, 'shelves', 's1'),
        spot('s2/a', 2, 'shelves', 's2'),
        spot('s3/a', 3, 'shelves', 's3'),
        spot('lone', 4, 'shelves'),
      ],
      lootGroups: { shelves: { pick: 2 } },
    } as unknown as CompiledMap;
    const units = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      const state = createState(seed);
      rollLootSpawns(state, map, items, tables);
      const xs = state.ground.map((g) => g.x);
      const picked = new Set(xs.map((x) => (x < 2 ? 's1' : String(x))));
      expect(picked.size).toBe(2);
      // A picked copy has all its spots.
      if (picked.has('s1')) expect(xs).toEqual(expect.arrayContaining([1, 1.5]));
      for (const u of picked) units.add(u);
    }
    expect([...units].sort()).toEqual(['2', '3', '4', 's1']);
    // A pick above the group's size uses all of it.
    const all = { ...map, lootGroups: { shelves: { pick: 9 } } } as CompiledMap;
    const state = createState(1);
    rollLootSpawns(state, all, items, tables);
    expect(state.ground).toHaveLength(5);
    // A pick of 0 switches the group off.
    const off = { ...map, lootGroups: { shelves: { pick: 0 } } } as CompiledMap;
    const none = createState(1);
    rollLootSpawns(none, off, items, tables);
    expect(none.ground).toEqual([]);
  });

  it("rolls a spot's mix: a table by weight, or nothing by its empty weight", () => {
    const spot = (mix: object) => ({
      type: 'lootSpawn',
      id: 'm',
      mix,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
    });
    const seen = new Map<string, number>();
    let empty = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const state = createState(seed);
      const map = { markers: [spot({ tables: { meds: 1, guns: 1 }, empty: 2 })] };
      rollLootSpawns(state, map as unknown as CompiledMap, items, tables);
      if (!state.ground.length) empty++;
      for (const g of state.ground) seen.set(g.item.item, (seen.get(g.item.item) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual(['bandage', 'rifle']);
    expect(empty).toBeGreaterThan(150);
    expect(empty).toBeLessThan(250);
  });
});
