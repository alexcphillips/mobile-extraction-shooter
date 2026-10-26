import {
  ContentError,
  ITEM_FORMAT,
  MAP_FORMAT,
  PREFAB_FORMAT,
  checkItems,
  compileMap,
  loadContent,
  type CompiledMap,
  type ContentFormat,
  type ItemDb,
  type MapFile,
  type PrefabFile,
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

/** Loads every file of a kind by id, checking each one's id matches its file name. */
function loadAll<T extends { id: string }>(
  format: ContentFormat<T>,
  files: Record<string, unknown>,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [path, raw] of Object.entries(files)) {
    const source = path.slice(path.indexOf('content/'));
    const doc = loadContent(format, raw, source);
    const name = path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
    if (doc.id !== name) throw new ContentError(source, `id "${doc.id}" must match the file name`);
    out.set(doc.id, doc);
  }
  return out;
}

let prefabs: Map<string, PrefabFile> | undefined;
let items: ItemDb | undefined;
let maps: Map<string, MapFile> | undefined;

export function mapIds(): string[] {
  maps ??= loadAll(MAP_FORMAT, mapFiles);
  return [...maps.keys()];
}

export function loadMap(id: string): CompiledMap {
  maps ??= loadAll(MAP_FORMAT, mapFiles);
  prefabs ??= loadAll(PREFAB_FORMAT, prefabFiles);
  const map = maps.get(id);
  if (!map) throw new Error(`no map "${id}" in content/maps`);
  return compileMap(map, prefabs);
}

/** Every item in content/items, with references between them checked. */
export function loadItems(): ItemDb {
  if (!items) {
    const all = loadAll(ITEM_FORMAT, itemFiles);
    checkItems(all);
    items = all;
  }
  return items;
}
