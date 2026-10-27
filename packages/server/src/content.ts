import {
  ITEM_FORMAT,
  RAID_FORMAT,
  STARTING_KIT_FORMAT,
  VENDOR_FORMAT,
  checkItems,
  checkVendors,
  loadById,
  type ItemDb,
  type RaidDef,
  type StartingKitDef,
  type VendorDef,
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
let vendors: Map<string, VendorDef> | undefined;

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

/** A vendor by id, or undefined. Its offers are checked against the items. */
export function vendorDef(id: string): VendorDef | undefined {
  if (!vendors) {
    const all = loadById(VENDOR_FORMAT, ofKind('vendors'));
    checkVendors(all, loadItems());
    vendors = all;
  }
  return vendors.get(id);
}
