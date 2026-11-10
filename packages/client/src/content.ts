import {
  containerMix,
  ENEMY_FORMAT,
  ITEM_FORMAT,
  LOADOUT_FORMAT,
  LOOT_CONTAINER_FORMAT,
  LOOT_TABLE_FORMAT,
  MAP_FORMAT,
  PREFAB_FORMAT,
  QUEST_FORMAT,
  RAID_FORMAT,
  SOUND_FORMAT,
  STARTING_KIT_FORMAT,
  TUTORIAL_FORMAT,
  VENDOR_FORMAT,
  ZOMBIES_FORMAT,
  checkEnemies,
  checkEnemyLoot,
  checkItems,
  checkLootTables,
  checkQuests,
  checkVendors,
  checkProfile,
  calibreOf,
  roundCalibre,
  roundOf,
  checkSounds,
  itemSounds,
  compileMap,
  compileTutorial,
  loadById,
  newProfile,
  type CompiledMap,
  type CompiledTutorial,
  type EnemyDef,
  type ItemDb,
  type ItemDef,
  type LoadoutDef,
  type LootContainerDef,
  type LootTableDef,
  type MapFile,
  type PrefabFile,
  type QuestDef,
  type RaidDef,
  type SoundDb,
  type SoundDef,
  type StartingKitDef,
  type VendorDef,
  type ZombiesDef,
  sourceIndex,
  type CompiledMarker,
  type ItemSource,
} from '@mes/shared';
import { GAME_SOUNDS } from './audio/sound-ids';
import { CONTROLS } from './hud/layout';

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

const soundFiles = import.meta.glob<unknown>('../../../content/sounds/*.json', {
  eager: true,
  import: 'default',
});

const zombiesFiles = import.meta.glob<unknown>('../../../content/zombies/*.json', {
  eager: true,
  import: 'default',
});

const tutorialFiles = import.meta.glob<unknown>('../../../content/tutorials/*.json', {
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
let sounds: SoundDb | undefined;

export function mapIds(): string[] {
  maps ??= loadById(MAP_FORMAT, mapFiles);
  return [...maps.keys()];
}

export function loadMap(id: string): CompiledMap {
  maps ??= loadById(MAP_FORMAT, mapFiles);
  prefabs ??= loadById(PREFAB_FORMAT, prefabFiles);
  const map = maps.get(id);
  if (!map) throw new Error(`no map "${id}" in content/maps`);
  const compiled = compileMap(map, prefabs);
  compiledMarkers.set(id, compiled.markers);
  return compiled;
}

/** Each map's markers from when it was last compiled, for the item sources (a raid's own map is). */
const compiledMarkers = new Map<string, readonly CompiledMarker[]>();
let origins: ReadonlyMap<string, ItemSource> | undefined;

/**
 * Where every item comes from (UX-2, 2026-11-08), worked out from content and every raid's
 * map, for the item details. Compiling a map takes a moment (Northpoint about 40 ms on a
 * Mac), so warmItemOrigins does it in idle time first; this does what's left at once.
 */
export function itemOrigins(): ReadonlyMap<string, ItemSource> {
  if (!origins) {
    raids ??= loadById(RAID_FORMAT, raidFiles);
    // The tutorial's raid (offline) isn't somewhere items come from.
    const raidMaps = [...raids.values()]
      .filter((r) => !r.offline)
      .map((r) => ({
        id: r.map,
        name: r.name,
        markers: compiledMarkers.get(r.map) ?? loadMap(r.map).markers,
      }));
    const e = loadEnemies();
    origins = sourceIndex({
      items: loadItems(),
      lootTables: loadLootTables(),
      lootContainers: loadLootContainers(),
      enemies: e.types,
      loadouts: e.loadouts,
      vendors: loadVendors().values(),
      quests: [...loadQuests().values()],
      maps: raidMaps,
    });
  }
  return origins;
}

/** Compiles the raids' maps for itemOrigins one at a time, between frames, then builds it. */
export function warmItemOrigins(): void {
  if (origins) return;
  raids ??= loadById(RAID_FORMAT, raidFiles);
  const online = [...raids.values()].filter((r) => !r.offline);
  const left = [...new Set(online.map((r) => r.map))].filter((m) => !compiledMarkers.has(m));
  const step = (): void => {
    if (origins) return;
    const next = left.shift();
    if (next === undefined) {
      itemOrigins();
      return;
    }
    if (!compiledMarkers.has(next)) loadMap(next);
    setTimeout(step, 50);
  };
  setTimeout(step, 50);
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

/**
 * The item files as written, by id, for the item editor (session 18), so what it saves keeps
 * their key order. Like mapSources: checked first, migrated if older. Don't change them.
 */
export function itemSources(): ReadonlyMap<string, ItemDef> {
  return asWritten(itemFiles, loadById(ITEM_FORMAT, itemFiles));
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

/**
 * Every sound in content/sounds, checked against the items (each sound an item names is
 * there) and the game (each sound it plays itself is there).
 */
export function loadSounds(): SoundDb {
  if (!sounds) {
    const all = loadById(SOUND_FORMAT, soundFiles);
    checkSounds(all, loadItems(), gameSounds());
    sounds = all;
  }
  return sounds;
}

/** The sound files as written, for the sound editor (see itemSources). */
export function soundSources(): ReadonlyMap<string, SoundDef> {
  return asWritten(soundFiles, loadById(SOUND_FORMAT, soundFiles));
}

/** What the items and the game would find missing with these sounds, or null. */
export function soundContentProblem(all: SoundDb): string | null {
  try {
    checkSounds(all, loadItems(), gameSounds());
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/** Where items name a sound, for the sound editor: "pistol shot", say. */
export function soundUses(id: string): string[] {
  const out: string[] = [];
  for (const item of loadItems().values()) {
    for (const [use, sound] of Object.entries(itemSounds(item))) {
      if (sound === id) out.push(`${item.id} ${use}`);
    }
  }
  for (const [cue, sound] of Object.entries(GAME_SOUNDS))
    if (sound === id) out.push(`game: ${cue}`);
  for (const type of loadEnemies().types.values()) {
    for (const [line, sound] of Object.entries(type.voice ?? {}))
      if (sound === id) out.push(`${type.id} ${line}`);
    if (type.steps === id) out.push(`${type.id} steps`);
  }
  return out;
}

/** The sounds the game plays itself, and enemies' voice lines (AI rework session 5) and steps (AI-8). */
function gameSounds(): string[] {
  const ids: string[] = Object.values(GAME_SOUNDS);
  for (const type of loadEnemies().types.values()) {
    for (const sound of Object.values(type.voice ?? {})) if (sound) ids.push(sound);
    if (type.steps) ids.push(type.steps);
  }
  return ids;
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
  // The map's PMC squads (AI-3): an enemy type that's a PMC, so its squads are allies.
  if (map.pmcs) {
    const id = map.pmcs.enemy ?? 'pmc';
    const type = types.get(id);
    if (!type) throw new Error(`pmcs: no enemy type "${id}"`);
    if (type.faction !== 'pmc') throw new Error(`pmcs: "${id}" is not a PMC`);
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
  if (!lootContainers) {
    const all = loadById(LOOT_CONTAINER_FORMAT, lootContainerFiles);
    checkLootKinds(all, loadLootTables());
    lootContainers = all;
  }
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
    if (m.type === 'lootSpawn' && !tables.has(m.lootTable))
      throw new Error(`${m.type} ${m.id}: no loot table "${m.lootTable}"`);
    if (m.type === 'lootContainer') {
      const mix = containerMix(m, kinds);
      if (!mix)
        throw new Error(`loot container ${m.id}: no loot, and kind "${m.container}" has none`);
      for (const t of Object.keys(mix.tables))
        if (!tables.has(t)) throw new Error(`loot container ${m.id}: no loot table "${t}"`);
    }
  }
}

/** Checks that container kinds' loot names tables that exist. */
export function checkLootKinds(
  kinds: ReadonlyMap<string, LootContainerDef>,
  tables: ReadonlyMap<string, LootTableDef>,
): void {
  for (const k of kinds.values()) {
    for (const t of Object.keys(k.loot?.tables ?? {}))
      if (!tables.has(t))
        throw new Error(`content/loot-containers/${k.id}.json: no loot table "${t}"`);
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

/** The loot container files as written, for the loot editor (see itemSources). */
export function lootContainerSources(): ReadonlyMap<string, LootContainerDef> {
  return asWritten(lootContainerFiles, loadById(LOOT_CONTAINER_FORMAT, lootContainerFiles));
}

/**
 * Where a container kind is placed, for the loot editor: one line a map, like "map mall: 12
 * (3 with their own loot)".
 */
export function lootContainerUses(id: string): readonly Use[] {
  const lines: Use[] = [];
  for (const map of mapIds()) {
    let n = 0;
    let own = 0;
    for (const m of loadMap(map).markers) {
      if (m.type !== 'lootContainer' || m.container !== id) continue;
      n++;
      if (m.mix || m.lootTable !== undefined) own++;
    }
    if (n)
      lines.push({ text: `map ${map}: ${n}${own ? ` (${own} with their own loot)` : ''}`, map });
  }
  return lines;
}

/** The loot table files as written, for the loot editor (see itemSources). */
export function lootTableSources(): ReadonlyMap<string, LootTableDef> {
  return asWritten(lootTableFiles, loadById(LOOT_TABLE_FORMAT, lootTableFiles));
}

/** What the items and enemy types would find wrong with these loot tables, or null. */
export function lootTableContentProblem(tables: ReadonlyMap<string, LootTableDef>): string | null {
  try {
    checkLootTables(tables, loadItems());
    checkEnemyLoot(rawContent().enemies, tables);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/**
 * A line saying where something is used, for the loot editor: with `map`, a link to that
 * map in the map editor; with `open`, a loot editor file key to open.
 */
export interface Use {
  text: string;
  map?: string;
  open?: string;
}

let lootUses: Map<string, Use[]> | undefined;

/**
 * Where a loot table is rolled, for the loot editor: one line each, like "map mall: 12
 * containers". Worked out for every table at once, as it compiles every map.
 */
export function lootTableUses(id: string): readonly Use[] {
  if (!lootUses) {
    const uses = new Map<string, Use[]>();
    const add = (table: string, text: string, link: Omit<Use, 'text'> = {}): void => {
      const line = { text, ...link };
      const lines = uses.get(table);
      if (lines) lines.push(line);
      else uses.set(table, [line]);
    };
    for (const map of mapIds()) {
      const counts = new Map<string, { containers: number; spots: number; odds: number }>();
      const count = (table: string) => {
        let c = counts.get(table);
        if (!c) counts.set(table, (c = { containers: 0, spots: 0, odds: 0 }));
        return c;
      };
      for (const m of loadMap(map).markers) {
        if (m.type === 'lootContainer') {
          for (const t of Object.keys(containerMix(m, loadLootContainers())?.tables ?? {}))
            count(t).containers++;
        }
        if (m.type === 'lootSpawn') {
          const c = count(m.lootTable);
          c.spots++;
          c.odds += m.chance ?? 1;
        }
        if (m.type === 'enemySpawn') {
          for (const [table, w] of Object.entries(m.lootWeights ?? {}))
            add(table, `enemy spawn ${m.id} on ${map}: weight ×${w}`, { map });
        }
      }
      for (const [table, c] of counts) {
        const parts = [
          c.containers && `${c.containers} container${c.containers === 1 ? '' : 's'}`,
          c.spots &&
            `${c.spots} loose spot${c.spots === 1 ? '' : 's'} (${Math.round((c.odds / c.spots) * 100)}% chance each, on average)`,
        ].filter(Boolean);
        add(table, `map ${map}: ${parts.join(', ')}`, { map });
      }
    }
    prefabs ??= loadById(PREFAB_FORMAT, prefabFiles);
    const tables = loadById(LOOT_TABLE_FORMAT, lootTableFiles);
    for (const [prefab, doc] of prefabs) {
      for (const table of tables.keys()) {
        const n = countLootTable(doc, table);
        if (n) add(table, `prefab ${prefab}: ${n} (counted in the maps above)`);
      }
    }
    for (const k of loadLootContainers().values()) {
      for (const [table, w] of Object.entries(k.loot?.tables ?? {}))
        add(table, `container kind ${k.name}: weight ${w} (its containers counted above)`, {
          open: `loot-containers/${k.id}`,
        });
    }
    for (const e of rawContent().enemies.values()) {
      for (const [table, w] of Object.entries(e.loot?.tables ?? {}))
        add(table, `enemy ${e.id}: weight ${w}`);
    }
    lootUses = uses;
  }
  return lootUses.get(id) ?? [];
}

/** Whether a loot mix (as written) has a weight for a table. */
const namesTable = (mix: unknown, id: string): boolean =>
  !!mix && typeof mix === 'object' && id in ((mix as { tables?: object }).tables ?? {});

/** How many times a doc names a loot table. */
function countLootTable(value: unknown, id: string): number {
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countLootTable(v, id), 0);
  if (value === null || typeof value !== 'object') return 0;
  return Object.entries(value).reduce(
    (n, [k, v]) =>
      n +
      ((k === 'lootTable' && v === id) || (k === 'mix' && namesTable(v, id))
        ? 1
        : countLootTable(v, id)),
    0,
  );
}

/** The raids to pick from, in their `order`: not the offline ones (the tutorial's). */
export function raidIds(): string[] {
  raids ??= loadById(RAID_FORMAT, raidFiles);
  return [...raids.values()]
    .filter((r) => !r.offline)
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id))
    .map((r) => r.id);
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

export function tutorialIds(): string[] {
  return [...loadById(TUTORIAL_FORMAT, tutorialFiles).keys()];
}

/**
 * A tutorial from content/tutorials (TU-2, 2026-11-09), checked against the rest of content:
 * its raid (offline), its kit, the items its steps name, and the zones, doors and markers
 * in its map.
 */
export function loadTutorial(id: string): CompiledTutorial {
  const def = loadById(TUTORIAL_FORMAT, tutorialFiles).get(id);
  const source = `content/tutorials/${id}.json`;
  if (!def) throw new Error(`no tutorial "${id}" in content/tutorials`);
  const raid = loadRaid(def.raid);
  if (!raid.offline) throw new Error(`${source}: raid "${raid.id}" isn't offline`);
  loadStartingKit(def.kit);
  const items = loadItems();
  const buttons = new Set<string>(CONTROLS.map((c) => c.id));
  for (const s of def.steps) {
    if (s.trigger.type === 'carry' && !items.has(s.trigger.item))
      throw new Error(`${source}: step "${s.id}": no item "${s.trigger.item}"`);
    for (const b of s.buttons ?? [])
      if (!buttons.has(b)) throw new Error(`${source}: step "${s.id}": no HUD button "${b}"`);
  }
  return compileTutorial(def, loadMap(raid.map));
}

let zombies: Map<string, ZombiesDef> | undefined;

export function zombiesIds(): string[] {
  zombies ??= loadById(ZOMBIES_FORMAT, zombiesFiles);
  return [...zombies.keys()];
}

/**
 * A zombies mode from content/zombies (2026-11-04), checked against the rest of content: its
 * map (with zombie spawns, see checkZombieMarkers), its kit, its claws and the box's guns.
 */
export function loadZombies(id: string): ZombiesDef {
  zombies ??= loadById(ZOMBIES_FORMAT, zombiesFiles);
  const def = zombies.get(id);
  const file = `content/zombies/${id}.json`;
  if (!def) throw new Error(`no zombies mode "${id}" in content/zombies`);
  if (!mapIds().includes(def.map)) throw new Error(`${file}: no map "${def.map}"`);
  const map = loadMap(def.map);
  checkZombieMarkers(map);
  if (!map.markers.some((m) => m.type === 'zombieSpawn'))
    throw new Error(`${file}: map ${def.map} has no zombie spawns`);
  loadStartingKit(def.kit);
  const items = loadItems();
  if (items.get(def.zombie.claws)?.type !== 'melee')
    throw new Error(`${file}: "${def.zombie.claws}" is not a melee item`);
  for (const o of def.box)
    if (items.get(o.item)?.type !== 'weapon')
      throw new Error(`${file}: box gun "${o.item}" is not a weapon`);
  for (const [gun, round] of Object.entries(def.ammo ?? {})) {
    const g = items.get(gun);
    const r = roundOf(items, round);
    if (g?.type !== 'weapon' || !r || roundCalibre(r) !== calibreOf(items, g))
      throw new Error(`${file}: "${round}" is not a round "${gun}" fires`);
  }
  const minigun = items.get(def.powerups.minigun);
  if (minigun?.type !== 'weapon' || !minigun.infiniteAmmo)
    throw new Error(`${file}: the death machine "${def.powerups.minigun}" needs infiniteAmmo`);
  return def;
}

/** Checks that a map's wall guns name weapons (zombies mode). */
export function checkZombieMarkers(map: CompiledMap): void {
  const items = loadItems();
  for (const m of map.markers) {
    if (m.type === 'wallBuy' && items.get(m.item)?.type !== 'weapon')
      throw new Error(`map ${map.id}: wall gun ${m.id}: "${m.item}" is not a weapon`);
  }
}

/**
 * A starting kit from content/starting-kits. The server gives new players theirs; the client
 * needs one only for play-testing from the map editor, and for zombies mode's loadout.
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
    // In their order on the vendors page.
    vendors = new Map([...all].sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0)));
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

// The item editor (session 18) checks everything that names items against the items as
// edited, so these are loaded without the checks against content/items that the game runs.
let raw:
  | {
      enemies: ReadonlyMap<string, EnemyDef>;
      loadouts: ReadonlyMap<string, LoadoutDef>;
      lootTables: ReadonlyMap<string, LootTableDef>;
      vendors: ReadonlyMap<string, VendorDef>;
      quests: ReadonlyMap<string, QuestDef>;
      kits: ReadonlyMap<string, StartingKitDef>;
      doors: { map: string; id: string; key: string }[];
    }
  | undefined;

function rawContent(): NonNullable<typeof raw> {
  if (!raw) {
    const doors = mapIds().flatMap((map) =>
      loadMap(map).doors.flatMap((d) =>
        d.key === undefined ? [] : [{ map, id: d.id, key: d.key }],
      ),
    );
    raw = {
      enemies: loadById(ENEMY_FORMAT, enemyFiles),
      loadouts: loadById(LOADOUT_FORMAT, loadoutFiles),
      lootTables: loadById(LOOT_TABLE_FORMAT, lootTableFiles),
      vendors: loadById(VENDOR_FORMAT, vendorFiles),
      quests: loadById(QUEST_FORMAT, questFiles),
      kits: loadById(STARTING_KIT_FORMAT, startingKitFiles),
      doors,
    };
  }
  return raw;
}

/**
 * What the rest of content/ would have wrong with these items, as the game and server load
 * it: references between the items, enemy loadouts, loot tables, vendors, quests, maps'
 * door keys, and each starting kit making a new player's profile that passes the server's
 * checks. The first problem, or null.
 */
export function itemContentProblem(items: ItemDb): string | null {
  const c = rawContent();
  try {
    checkItems(items);
    checkEnemies(c.enemies, c.loadouts, items);
    checkLootTables(c.lootTables, items);
    checkVendors(c.vendors, items);
    checkQuests(c.quests, c.vendors, items);
    checkSounds(loadById(SOUND_FORMAT, soundFiles), items, []);
    for (const d of c.doors) {
      if (items.get(d.key)?.type !== 'key')
        return `door ${d.id} on ${d.map}: "${d.key}" is not a key item`;
    }
    for (const kit of c.kits.values()) {
      const bad = checkProfile(items, newProfile(items, kit));
      if (bad) return `content/starting-kits/${kit.id}.json: ${bad}`;
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/**
 * Where the rest of content/ names an item, for the item editor: one line each, like
 * "loot table household". Items naming it (a gun's ammo, an attachment's guns) come from
 * the items given, as edited.
 */
export function itemUses(id: string, items: ItemDb): string[] {
  const c = rawContent();
  const out: string[] = [];
  for (const def of items.values()) {
    if (def.type === 'weapon' && def.ammo === id) out.push(`${def.id} fires it`);
    if (def.type === 'attachment' && def.weapons?.includes(id)) out.push(`${def.id} fits it`);
  }
  const kinds: [string, ReadonlyMap<string, unknown>][] = [
    ['loadout', c.loadouts],
    ['loot table', c.lootTables],
    ['vendor', c.vendors],
    ['quest', c.quests],
    ['starting kit', c.kits],
  ];
  for (const [kind, docs] of kinds) {
    for (const [docId, doc] of docs) if (names(doc, id)) out.push(`${kind} ${docId}`);
  }
  for (const d of c.doors) if (d.key === id) out.push(`door ${d.id} on ${d.map}`);
  return out;
}

/** Whether a content doc names an item: as an `item`, or in a starting kit's gear. */
function names(value: unknown, id: string, key = ''): boolean {
  if (Array.isArray(value)) return value.some((v) => names(v, id, key));
  if (value === null || typeof value !== 'object') return key === 'item' && value === id;
  return Object.entries(value).some(([k, v]) => (key === 'gear' ? v === id : names(v, id, k)));
}
