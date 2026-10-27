import {
  ITEM_FORMAT,
  RAID_FORMAT,
  STARTING_KIT_FORMAT,
  checkItems,
  loadById,
  type ItemDb,
  type RaidDef,
  type StartingKitDef,
} from '@mes/shared';
import files from './generated/content.js';

// The content the server checks against, bundled by scripts/bundle-content.mjs. Each kind
// is loaded and checked the first time it's needed, then kept for the isolate's life.

function ofKind(kind: string): Record<string, unknown> {
  const prefix = `content/${kind}/`;
  return Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(prefix)));
}

let items: ItemDb | undefined;
let raids: Map<string, RaidDef> | undefined;
let kits: Map<string, StartingKitDef> | undefined;

export function loadItems(): ItemDb {
  if (!items) {
    const all = loadById(ITEM_FORMAT, ofKind('items'));
    checkItems(all);
    items = all;
  }
  return items;
}

/** A raid config by id, or undefined. */
export function raidDef(id: string): RaidDef | undefined {
  raids ??= loadById(RAID_FORMAT, ofKind('raids'));
  return raids.get(id);
}

export function startingKit(id: string): StartingKitDef {
  kits ??= loadById(STARTING_KIT_FORMAT, ofKind('starting-kits'));
  const kit = kits.get(id);
  if (!kit) throw new Error(`no starting kit "${id}" in content/starting-kits`);
  return kit;
}
