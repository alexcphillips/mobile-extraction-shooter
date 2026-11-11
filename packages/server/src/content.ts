import {
  CONTRACT_FORMAT,
  HANGAR_FORMAT,
  ITEM_FORMAT,
  QUEST_FORMAT,
  RECIPE_FORMAT,
  RAID_FORMAT,
  STARTING_KIT_FORMAT,
  VENDOR_FORMAT,
  checkContracts,
  checkHangar,
  checkItems,
  checkQuests,
  checkRecipes,
  checkVendors,
  loadById,
  type ContractDef,
  type HangarModuleDef,
  type ItemDb,
  type QuestDef,
  type RaidDef,
  type RecipeDef,
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
let quests: Map<string, QuestDef> | undefined;
let hangar: Map<string, HangarModuleDef> | undefined;
let recipes: Map<string, RecipeDef> | undefined;
let contracts: Map<string, ContractDef> | undefined;

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

function loadVendors(): Map<string, VendorDef> {
  if (!vendors) {
    const all = loadById(VENDOR_FORMAT, ofKind('vendors'));
    checkVendors(all, loadItems());
    vendors = all;
  }
  return vendors;
}

/** A vendor by id, or undefined. Its offers are checked against the items. */
export function vendorDef(id: string): VendorDef | undefined {
  return loadVendors().get(id);
}

/** Every quest, checked against the vendors and items. */
export function loadQuests(): ReadonlyMap<string, QuestDef> {
  if (!quests) {
    const all = loadById(QUEST_FORMAT, ofKind('quests'));
    checkQuests(all, loadVendors(), loadItems());
    quests = all;
  }
  return quests;
}

/** A quest by id, or undefined. */
export function questDef(id: string): QuestDef | undefined {
  return loadQuests().get(id);
}

/** Every Hangar module, checked against the items. */
export function loadHangar(): ReadonlyMap<string, HangarModuleDef> {
  if (!hangar) {
    const all = loadById(HANGAR_FORMAT, ofKind('hangar'));
    checkHangar(all, loadItems());
    hangar = all;
  }
  return hangar;
}

/** A Hangar module by id, or undefined. */
export function hangarModule(id: string): HangarModuleDef | undefined {
  return loadHangar().get(id);
}

/** Every crafting recipe, checked against the modules and items. */
export function loadRecipes(): ReadonlyMap<string, RecipeDef> {
  if (!recipes) {
    const all = loadById(RECIPE_FORMAT, ofKind('recipes'));
    checkRecipes(all, loadHangar(), loadItems(), loadVendors());
    recipes = all;
  }
  return recipes;
}

/** A crafting recipe by id, or undefined. */
export function recipeDef(id: string): RecipeDef | undefined {
  return loadRecipes().get(id);
}

/** Every Intel desk contract (H6), checked against the vendors, items and the raids' maps. */
export function loadContracts(): ReadonlyMap<string, ContractDef> {
  if (!contracts) {
    const all = loadById(CONTRACT_FORMAT, ofKind('contracts'));
    raids ??= loadById(RAID_FORMAT, ofKind('raids'));
    const maps = new Set([...raids.values()].map((r) => r.map));
    checkContracts(all, loadVendors(), loadItems(), maps);
    contracts = all;
  }
  return contracts;
}
