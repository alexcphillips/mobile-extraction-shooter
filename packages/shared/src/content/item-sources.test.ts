import { describe, expect, it } from 'vitest';
import { TEST_ITEMS as items } from '../sim/test-items';
import type { CompiledMarker } from './compile';
import type { EnemyDef, LoadoutDef } from './enemies';
import type { HangarModuleDef } from './hangar';
import { hasSource, itemUsage, sourceIndex, type SourceContent } from './item-sources';
import type { LootContainerDef } from './loot-containers';
import type { LootTableDef } from './loot-tables';
import type { QuestDef } from './quests';
import type { RecipeDef } from './recipes';
import type { VendorDef } from './vendors';

const table = (id: string, ...ids: string[]): LootTableDef => ({
  formatVersion: 1,
  id,
  name: id,
  rolls: [1, 1],
  items: ids.map((item) => ({ item, weight: 1 })),
});
const kind = (id: string, name: string, tables?: Record<string, number>): LootContainerDef =>
  ({
    formatVersion: 1,
    id,
    name,
    grid: [2, 2],
    ...(tables && { loot: { tables } }),
  }) as LootContainerDef;
const at = { x: 0, y: 0, z: 0, yaw: 0 };
const box = (container: string, lootTable?: string): CompiledMarker =>
  ({
    type: 'lootContainer',
    id: 'c',
    ...at,
    container,
    ...(lootTable && { lootTable }),
  }) as CompiledMarker;
const spot = (lootTable: string): CompiledMarker =>
  ({ type: 'lootSpawn', id: 's', ...at, lootTable }) as CompiledMarker;

const quest = {
  formatVersion: 1,
  id: 'q',
  name: 'Lost notes',
  vendor: 'v',
  description: 'x',
  requires: [],
  objectives: [
    { id: 'a', type: 'extract', item: 'notes', map: 'np', spots: ['p'] },
    { id: 'b', type: 'handOver', item: 'watch', count: 1 },
  ],
  rewards: { money: 0, items: [{ item: 'medkit' }], rep: 0 },
} as unknown as QuestDef;

const content: SourceContent = {
  items,
  lootTables: new Map([
    ['valuables', table('valuables', 'watch', 'cash')],
    ['meds', table('meds', 'bandage')],
    ['scav-pockets', table('scav-pockets', 'bandage')],
  ]),
  lootContainers: new Map([
    ['desk', kind('desk', 'Desk', { valuables: 1 })],
    ['safe', kind('safe', 'Safe', { valuables: 1 })],
  ]),
  enemies: new Map([
    [
      'scav',
      {
        id: 'scav',
        name: 'Scav',
        loadout: 'kit',
        loot: { rolls: [1, 1], tables: { 'scav-pockets': 1 } },
      } as unknown as EnemyDef,
    ],
  ]),
  loadouts: new Map([
    [
      'kit',
      {
        formatVersion: 1,
        id: 'kit',
        weapons: [{ weight: 1, item: 'rifle', spare: [0, 0], attachments: [{ item: 'scope' }] }],
        helmets: [
          { weight: 1, item: 'helmet' },
          { weight: 1, item: null },
        ],
      } as LoadoutDef,
    ],
  ]),
  vendors: [
    { name: 'Gunsmith', sells: [{ item: 'rifle' }, { item: 'scope', level: 3 }] } as VendorDef,
  ],
  quests: [quest],
  maps: [
    // A desk with its own table (meds) counts toward meds, not its kind's valuables.
    {
      id: 'np',
      name: 'Northpoint',
      markers: [box('desk'), box('desk'), box('safe'), box('desk', 'meds'), spot('valuables')],
    },
    { id: 'mall', name: 'Mall', markers: [box('safe'), spot('valuables')] },
  ],
};

describe('sourceIndex', () => {
  const index = sourceIndex(content);

  it('lists container kinds by how many could roll it, and maps it lies loose on', () => {
    // Two desks and two safes roll valuables; the third desk has its own table.
    expect(index.get('watch')!.containers).toEqual(['Desk', 'Safe']);
    expect(index.get('watch')!.loose).toEqual(['Northpoint', 'Mall']);
    expect(index.get('bandage')!.containers).toEqual(['Desk']);
  });

  it('names enemies that wear or carry it, from their loadout and their loot', () => {
    for (const id of ['rifle', 'round', 'scope', 'helmet', 'bandage'])
      expect(index.get(id)!.enemies, id).toEqual(['Scav']);
    expect(index.get('vest')).toBeUndefined();
  });

  it('names vendors with their level, quest rewards and quest spots', () => {
    expect(index.get('scope')!.vendors).toEqual([{ vendor: 'Gunsmith', level: 3 }]);
    expect(index.get('rifle')!.vendors).toEqual([{ vendor: 'Gunsmith', level: 1 }]);
    expect(index.get('medkit')!.rewards).toEqual(['Lost notes']);
    expect(index.get('notes')!.questSpots).toEqual([{ map: 'Northpoint', quest: 'Lost notes' }]);
    expect(hasSource(index.get('vest'))).toBe(false);
    expect(hasSource(index.get('medkit'))).toBe(true);
  });

  it('usage: the quests that want it', () => {
    expect(itemUsage([quest], 'watch').quests.map((q) => q.objective.id)).toEqual(['b']);
    expect(itemUsage([quest], 'notes').quests.map((q) => q.objective.id)).toEqual(['a']);
    expect(itemUsage([quest], 'vest').quests).toEqual([]);
  });

  it('the Hangar: what crafts it, and the recipes and upgrades that take it', () => {
    const level = (item: string, count = 1) => ({ cost: [{ item, count }], unlocks: 'x' });
    const bay = {
      id: 'bay',
      name: 'Trauma bay',
      levels: [level('bandage'), level('watch', 2), level('bandage', 3)],
    } as HangarModuleDef;
    const recipe = (id: string, lvl: number, input: string, output: string): RecipeDef =>
      ({
        id,
        module: 'bay',
        level: lvl,
        inputs: [{ item: input, count: 2 }],
        output: { item: output },
        minutes: 10,
      }) as RecipeDef;
    const hangar = {
      modules: new Map([['bay', bay]]),
      recipes: [recipe('a', 2, 'bandage', 'vest'), recipe('b', 1, 'watch', 'vest')],
    };
    const crafted = sourceIndex({ ...content, hangar }).get('vest');
    // Two recipes in one module: the lower level is the one that counts.
    expect(crafted!.crafted).toEqual([{ module: 'Trauma bay', level: 1 }]);
    expect(hasSource(crafted)).toBe(true);
    const uses = itemUsage([quest], 'bandage', hangar);
    expect(uses.recipes.map((r) => [r.recipe.id, r.module])).toEqual([['a', 'Trauma bay']]);
    expect(uses.upgrades).toEqual([
      {
        module: 'Trauma bay',
        levels: [
          { level: 1, count: 1 },
          { level: 3, count: 3 },
        ],
      },
    ]);
    expect(itemUsage([quest], 'vest', hangar)).toMatchObject({ recipes: [], upgrades: [] });
  });
});
