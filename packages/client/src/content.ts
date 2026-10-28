import {
  ENEMY_FORMAT,
  ITEM_FORMAT,
  LOADOUT_FORMAT,
  LOOT_CONTAINER_FORMAT,
  LOOT_TABLE_FORMAT,
  MAP_FORMAT,
  PREFAB_FORMAT,
  QUEST_FORMAT,
  RAID_FORMAT,
  STARTING_KIT_FORMAT,
  VENDOR_FORMAT,
  checkEnemies,
  checkEnemyLoot,
  checkItems,
  checkLootTables,
  checkQuests,
  checkVendors,
  compileMap,
  loadById,
  type CompiledMap,
  type EnemyDef,
  type ItemDb,
  type LoadoutDef,
  type LootContainerDef,
  type LootTableDef,
  type MapFile,
  type PrefabFile,
  type QuestDef,
  type RaidDef,
  type StartingKitDef,
  type VendorDef,
} from '@mes/shared';

// Every content file is bundled, and in dev, Vite reloads the page when one changes.
const mapFiles = import.meta.glob<unknown>('../../../content/maps/*.json', {
  eager: true,
  import: 'default',
});
const prefabFiles = import.meta.glob<unknown>('../../../content/prefabs/*.json', {
  eager: true,
  import: 'default',
});

const itemFiles = import.meta.glob<unknown>('../../../content/items/*.json', {
  eager: true,
  import: 'default',
});

const enemyFiles = import.meta.glob<unknown>('../../../content/enemies/*.json', {
  eager: true,
  import: 'default',
});
const loadoutFiles = import.meta.glob<unknown>('../../../content/loadouts/*.json', {
  eager: true,
  import: 'default',
});
const startingKitFiles = import.meta.glob<unknown>('../../../content/starting-kits/*.json', {
  eager: true,
  import: 'default',
});
const lootContainerFiles = import.meta.glob<unknown>('../../../content/loot-containers/*.json', {
  eager: true,
  import: 'default',
});
const lootTableFiles = import.meta.glob<unknown>('../../../content/loot-tables/*.json', {
  eager: true,
  import: 'default',
});
const raidFiles = import.meta.glob<unknown>('../../../content/raids/*.json', {
  eager: true,
  import: 'default',
});

const vendorFiles = import.meta.glob<unknown>('../../../content/vendors/*.json', {
  eager: true,
  import: 'default',
});

const questFiles = import.meta.glob<unknown>('../../../content/quests/*.json', {
  eager: true,
  import: 'default',
});

let prefabs: Map<string, PrefabFile> | undefined;
let items: ItemDb | undefined;
let maps: Map<string, MapFile> | undefined;
let enemies: Enemies | undefined;
let lootContainers: Map<string, LootContainerDef> | undefined;
let lootTables: Map<string, LootTableDef> | undefined;
let raids: Map<string, RaidDef> | undefined;
let vendors: ReadonlyMap<string, VendorDef> | undefined;
let quests: ReadonlyMap<string, QuestDef> | undefined;

export function mapIds(): string[] {
  maps ??= loadById(MAP_FORMAT, mapFiles);
  return [...maps.keys()];
}

export function loadMap(id: string): CompiledMap {
  maps ??= loadById(MAP_FORMAT, mapFiles);
  prefabs ??= loadById(PREFAB_FORMAT, prefabFiles);
  const map = maps.get(id);
  if (!map) throw new Error(`no map "${id}" in content/maps`);
  return compileMap(map, prefabs);
}

/**
 * The map and prefab files as written, by id, for the map editor, so what it saves keeps
 * their key order (a parsed file has its schema's order). They're checked first; one in an
 * older format comes migrated. Don't change them.
 */
export function mapSources(): {
  maps: ReadonlyMap<string, MapFile>;
  prefabs: ReadonlyMap<string, PrefabFile>;
} {
  maps ??= loadById(MAP_FORMAT, mapFiles);
  prefabs ??= loadById(PREFAB_FORMAT, prefabFiles);
  return { maps: asWritten(mapFiles, maps), prefabs: asWritten(prefabFiles, prefabs) };
}

function asWritten<T extends { id: string; formatVersion: number }>(
  files: Record<string, unknown>,
  loaded: ReadonlyMap<string, T>,
): Map<string, T> {
  const raw = new Map<string, T>();
  for (const file of Object.values(files)) {
    const doc = file as T;
    const parsed = loaded.get(doc.id);
    if (parsed) raw.set(doc.id, doc.formatVersion === parsed.formatVersion ? doc : parsed);
  }
  return raw;
}

/** Every item in content/items, with references between them checked. */
export function loadItems(): ItemDb {
  if (!items) {
    const all = loadById(ITEM_FORMAT, itemFiles);
    checkItems(all);
    items = all;
  }
  return items;
}

export interface Enemies {
  types: ReadonlyMap<string, EnemyDef>;
  loadouts: ReadonlyMap<string, LoadoutDef>;
}

/**
 * Every enemy type and loadout, with their references checked against the items and loot
 * tables.
 */
export function loadEnemies(): Enemies {
  if (!enemies) {
    const types = loadById(ENEMY_FORMAT, enemyFiles);
    const loadouts = loadById(LOADOUT_FORMAT, loadoutFiles);
    checkEnemies(types, loadouts, loadItems());
    checkEnemyLoot(types, loadLootTables());
    enemies = { types, loadouts };
  }
  return enemies;
}

/** Checks that a map's enemy spawns name enemy types and loadouts that exist. */
export function checkEnemySpawns(map: CompiledMap): void {
  const { types, loadouts } = loadEnemies();
  for (const m of map.markers) {
    if (m.type !== 'enemySpawn') continue;
    if (!types.has(m.enemy)) throw new Error(`enemy spawn ${m.id}: no enemy type "${m.enemy}"`);
    if (m.loadout !== undefined && !loadouts.has(m.loadout))
      throw new Error(`enemy spawn ${m.id}: no loadout "${m.loadout}"`);
    for (const id of Object.keys(m.lootWeights ?? {})) {
      if (!loadLootTables().has(id)) throw new Error(`enemy spawn ${m.id}: no loot table "${id}"`);
    }
  }
}

/** Checks that a map's locked doors name key items that exist. */
export function checkDoorKeys(map: CompiledMap): void {
  const items = loadItems();
  for (const d of map.doors) {
    if (d.key !== undefined && items.get(d.key)?.type !== 'key')
      throw new Error(`door ${d.id}: "${d.key}" is not a key item`);
  }
}

/** Every kind of loot container in content/loot-containers. */
export function loadLootContainers(): ReadonlyMap<string, LootContainerDef> {
  lootContainers ??= loadById(LOOT_CONTAINER_FORMAT, lootContainerFiles);
  return lootContainers;
}

/** Checks that a map's loot containers and spawns name kinds and loot tables that exist. */
export function checkLootContainers(map: CompiledMap): void {
  const kinds = loadLootContainers();
  const tables = loadLootTables();
  for (const m of map.markers) {
    if (m.type === 'lootContainer' && !kinds.has(m.container))
      throw new Error(
        `loot container ${m.id}: no kind "${m.container}" in content/loot-containers`,
      );
    if ((m.type === 'lootContainer' || m.type === 'lootSpawn') && !tables.has(m.lootTable))
      throw new Error(`${m.type} ${m.id}: no loot table "${m.lootTable}"`);
  }
}

/** Every loot table in content/loot-tables, with their items checked. */
export function loadLootTables(): ReadonlyMap<string, LootTableDef> {
  if (!lootTables) {
    const all = loadById(LOOT_TABLE_FORMAT, lootTableFiles);
    checkLootTables(all, loadItems());
    lootTables = all;
  }
  return lootTables;
}

export function raidIds(): string[] {
  raids ??= loadById(RAID_FORMAT, raidFiles);
  return [...raids.keys()];
}

/** A raid config from content/raids, checked to name a map that exists. */
export function loadRaid(id: string): RaidDef {
  raids ??= loadById(RAID_FORMAT, raidFiles);
  const raid = raids.get(id);
  if (!raid) throw new Error(`no raid "${id}" in content/raids`);
  if (!mapIds().includes(raid.map))
    throw new Error(`content/raids/${id}.json: no map "${raid.map}"`);
  return raid;
}

/**
 * A starting kit from content/starting-kits. The server gives new players theirs; the client
 * needs one only for play-testing from the map editor.
 */
export function loadStartingKit(id: string): StartingKitDef {
  const kit = loadById(STARTING_KIT_FORMAT, startingKitFiles).get(id);
  if (!kit) throw new Error(`no starting kit "${id}" in content/starting-kits`);
  return kit;
}

/** Every vendor in content/vendors, with their offers checked against the items. */
export function loadVendors(): ReadonlyMap<string, VendorDef> {
  if (!vendors) {
    const all = loadById(VENDOR_FORMAT, vendorFiles);
    checkVendors(all, loadItems());
    vendors = all;
  }
  return vendors;
}

/** Every quest in content/quests, checked against the vendors and items. */
export function loadQuests(): ReadonlyMap<string, QuestDef> {
  if (!quests) {
    const all = loadById(QUEST_FORMAT, questFiles);
    checkQuests(all, loadVendors(), loadItems());
    quests = all;
  }
  return quests;
}

/**
 * Checks that every quest's investigate objectives, and its quest items' spots (session
 * 14b), name quest markers on a map.
 */
export function checkQuestMarkers(): void {
  for (const q of loadQuests().values()) {
    for (const o of q.objectives) {
      if (o.type === 'handOver') continue;
      if (!mapIds().includes(o.map)) throw new Error(`quest ${q.id}: no map "${o.map}"`);
      const markers = loadMap(o.map).markers;
      for (const id of o.type === 'investigate' ? [o.marker] : o.spots) {
        const found = markers.some((m) => m.type === 'questMarker' && m.id === id);
        if (!found) throw new Error(`quest ${q.id}: no quest marker "${id}" on ${o.map}`);
      }
    }
  }
}
