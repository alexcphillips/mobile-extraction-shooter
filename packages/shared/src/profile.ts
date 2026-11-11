import { z } from 'zod';
import type { ContentFormat } from './content/format';
import {
  ATTACHMENT_SLOTS,
  armorOf,
  firesRound,
  isArmoredRig,
  fits,
  itemDef,
  sectionsOf,
  stackSize,
  weaponDef,
  type AttachmentDef,
  type ItemDb,
  type WeaponDef,
} from './content/items';
import { idSchema } from './content/schema';
import type { StartingKitDef } from './content/starting-kits';
import {
  addItem,
  canHold,
  createGrid,
  isFree,
  itemHeight,
  itemWidth,
  sameShape,
  type Grid,
  type GridItem,
  type Item,
  type PageCategory,
  type Section,
} from './inventory/grid';
import { createItem } from './sim/create-item';
import {
  CARRIED_GRIDS,
  GEAR,
  GEAR_SLOTS,
  POCKET_SECTIONS,
  carriedGrid,
  createGear,
  fitsSlot,
  gearConflict,
  type Gear,
  type GearSlot,
} from './sim/gear';
import {
  createWeapon,
  createWeaponStats,
  loadedAmmo,
  weaponStats,
  type WeaponState,
} from './sim/weapons';

/*
 * A player's profile (session 12): the account balance, the stash's pages, and the gear they'll
 * take into the next raid (the vault and knife included). The server stores it as JSON
 * and is the truth; the client trusts it. The server applies sanity limits to whatever
 * the client sends (design.md → Trust model): checkProfile for well-formed items in
 * grids that fit, and itemGained for edits outside a raid that make items from nothing.
 */

export const PROFILE = {
  /**
   * A stash page's size, [width, height]. Session 13 kept 10×30: ten columns fit beside
   * the gear and carried grids on a landscape phone, and the rows scroll. It was 9×30 for part of 2026-11-09, then
   * back to 10×30 (the user's call). H4 (2026-11-10) shrank it to 10×20, a placeholder
   * until the user balances it, so the Stash module's pages matter (hangar.md); settleStash
   * reshapes pages saved at another size.
   */
  stash: [10, 20],
  /**
   * What each extra stash page costs, in order: everyone starts with one, so the most is
   * one more than there are prices. First guesses (session 13), kept against the item
   * values in 13b. Each needs Stash a level higher (H4): page 2 at level 1, and so on.
   */
  pagePrices: [100_000, 250_000, 500_000],
  /**
   * The vault's size, [width, height], by the Secure locker's level (H4): 2 wide and 1
   * tall unbuilt (the user's call, hangar.md), up to 3×3. The steps between are
   * placeholders until the user balances them.
   */
  vaults: [
    [2, 1],
    [2, 2],
    [3, 2],
    [3, 3],
  ],
  /**
   * The category pages (H4, hangar.md → Stash), unlocked together at this Stash
   * level, each its size. Placeholders until the user balances them.
   */
  categoryLevel: 3,
  categoryPages: [
    { only: 'guns', size: [10, 10] },
    { only: 'ammo', size: [10, 10] },
    { only: 'meds', size: [10, 10] },
  ],
  /** Money above this is refused as a sanity limit. */
  maxMoney: 1_000_000_000,
} as const;

/**
 * Where a quest is (session 14), by its id in the profile: accepted, with how far each
 * objective has got by its id (items handed over, or 1 once done), or done and rewarded.
 * A quest not in the profile hasn't been accepted.
 */
export type QuestState =
  { status: 'active'; progress: Record<string, number> } | { status: 'done' };

/**
 * Where a player stands with a vendor (2026-11-06): reputation from its quests, and the
 * money spent with it. Together they set its level (vendorLevel, vendors.ts). A vendor not
 * in the profile is at 0 and 0.
 */
export interface VendorStanding {
  rep: number;
  spent: number;
}

export interface Profile {
  formatVersion: 18;
  money: number;
  /** The stash's pages, bought with money (at least one). */
  stash: Grid[];
  gear: Gear;
  /** Only the server changes these (PUT /api/profile refuses it). */
  quests: Record<string, QuestState>;
  /** By vendor id. Only the server changes these, as for quests. */
  vendors: Record<string, VendorStanding>;
  /** Each Hangar module's level by its id (H1); a module not here is unbuilt. Only the server changes these. */
  hangar: Record<string, number>;
  /** The craft in each Hangar module, by module id (H2): running, or done and waiting to be collected. Only the server changes these. */
  crafts: Record<string, Craft>;
}

/**
 * A craft in a Hangar module (H2). Its output is copied from the recipe when it starts, so
 * a recipe changed or deleted later can't strand it. `done` is the server's clock (ms).
 */
export interface Craft {
  recipe: string;
  item: string;
  count: number;
  done: number;
}

const count = z.int().min(0);
const amount = z.number().refine((n) => Number.isFinite(n) && n >= 0, 'must be 0 or more');

// The shape of items and grids. What an item's fields must be for its type, and whether
// it fits where it is, needs the item database: that's checkProfile's job.
const itemShape: z.ZodType = z.lazy(() =>
  z.strictObject({
    item: idSchema,
    count: z.int().min(1),
    durability: amount.optional(),
    max: amount.optional(),
    left: amount.optional(),
    mag: count.optional(),
    loaded: idSchema.optional(),
    attachments: z.record(z.enum(ATTACHMENT_SLOTS), idSchema.nullable()).optional(),
    grid: gridShape.optional(),
    found: z.literal(true).optional(),
    // A gun's state in the sim; restGear resets it before it's stored.
    cooldown: z.number().optional(),
    reloading: z.number().optional(),
    reloadWith: idSchema.optional(),
    reloadByHand: z.literal(true).optional(),
    triggerHeld: z.boolean().optional(),
  }),
);

const gridShape = z.strictObject({
  w: count,
  h: count,
  containers: z.boolean(),
  bags: z.literal(true).optional(),
  sections: z.array(z.strictObject({ x: count, y: count, w: count, h: count })).optional(),
  only: z.enum(['guns', 'ammo', 'meds']).optional(),
  items: z.array(z.strictObject({ x: count, y: count, rotated: z.boolean(), item: itemShape })),
});

const slotShape = itemShape.nullable();

export const gearShape = z.strictObject({
  primary1: slotShape,
  primary2: slotShape,
  sidearm: slotShape,
  knife: slotShape,
  hand: z.enum(['primary1', 'primary2', 'sidearm', 'knife']),
  helmet: slotShape,
  bodyArmor: slotShape,
  rig: slotShape,
  backpack: slotShape,
  pockets: gridShape,
  vault: gridShape.nullable(),
});

const questStateShape = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('active'), progress: z.record(idSchema, count) }),
  z.strictObject({ status: z.literal('done') }),
]);

const profileShape = z.strictObject({
  formatVersion: z.literal(18),
  money: count,
  stash: z.array(gridShape).min(1),
  gear: gearShape,
  quests: z.record(idSchema, questStateShape),
  vendors: z.record(idSchema, z.strictObject({ rep: amount, spent: count })),
  hangar: z.record(idSchema, count),
  crafts: z.record(
    idSchema,
    z.strictObject({ recipe: idSchema, item: idSchema, count: z.int().min(1), done: count }),
  ),
});

export const PROFILE_FORMAT_VERSION = 18;

export const PROFILE_FORMAT: ContentFormat<Profile> = {
  kind: 'profile',
  version: PROFILE_FORMAT_VERSION,
  // The shapes are checked loosely typed (items nest through grids); checkProfile does the rest.
  schema: profileShape as unknown as z.ZodType<Profile>,
  migrations: {
    // Session 13: the one stash grid became the first of its pages.
    1: (doc) => ({ ...doc, stash: [doc.stash] }),
    // Session 14: quests.
    2: (doc) => ({ ...doc, quests: {} }),
    // Session 19za: the assault rifle became the AKM, so 5.56 rounds and mags became 7.62×39.
    3: (doc) => renameItems(doc, RENAMED_IN_4),
    // 2026-11-05: the .45 ACP and 7.62×54R sets were reshaped from Tarkov's rounds.
    4: (doc) => renameItems(doc, RENAMED_IN_5),
    // 2026-11-05: the generic pistol was deleted; pistols become M9A3s, which take no optic.
    5: (doc) => dropOptics(renameItems(doc, { pistol: 'm9a3' }), 'm9a3'),
    // 2026-11-05: the generic sniper rifle was deleted; it becomes an SV-98, which fires
    // 7.62×54R, so any 7.62×51 round it was loaded with is forgotten (it keeps its count).
    6: (doc) => unload(renameItems(doc, { 'sniper-rifle': 'sv-98' }), 'sv-98'),
    // 2026-11-06: vendor levels; everyone starts at nothing with every vendor.
    7: (doc) => ({ ...doc, vendors: {} }),
    // 2026-11-09: guns named by class got their real names' ids.
    8: (doc) => renameItems(doc, { 'assault-rifle': 'akm', shotgun: 'mp-133', smg: 'k10' }),
    // 2026-11-09: the medkit became the field first aid kit.
    9: (doc) => renameItems(doc, { medkit: 'field-first-aid-kit' }),
    // 2026-11-10 (H1): the Hangar; every module starts unbuilt.
    10: (doc) => ({ ...doc, hangar: {} }),
    // 2026-11-10 (H2): Hangar crafting; nothing is being made.
    11: (doc) => ({ ...doc, crafts: {} }),
    // 2026-11-10 (H6): the Intel desk's contracts; none taken.
    12: (doc) => ({ ...doc, contracts: { day: 0, taken: [] } }),
    // 2026-11-10: the encrypted drive became the encrypted USB drive, and the
    // nuclear facility blueprint became the nuclear facility schematics.
    13: (doc) =>
      renameItems(doc, {
        'encrypted-drive': 'encrypted-usb-drive',
        'nuclear-facility-blueprint': 'nuclear-facility-schematics',
      }),
    // 2026-11-11: vendor ids say what they sell (the quartermaster became the
    // guns-ammo-vendor, the gunsmith the attachments-vendor). Rep and decryptions follow.
    14: (doc) => renameVendors(doc, RENAMED_VENDORS_IN_15),
    // 2026-11-11: the Intel desk was deleted (the user's call), with its contracts, its
    // decryptions and the flash and hard drives they took.
    15: (doc) => dropIntelDesk(doc),
    // 2026-11-11: the Quarters module was renamed the Stash module (id `stash`); its level carries over.
    16: (doc) => {
      const { quarters, ...hangar } = (doc.hangar ?? {}) as Record<string, unknown>;
      return { ...doc, hangar: quarters === undefined ? hangar : { ...hangar, stash: quarters } };
    },
    // 2026-11-11: guns gained a laser slot, empty on every stored gun.
    17: (doc) => {
      eachObject(doc, (o) => {
        const a = o.attachments as Record<string, unknown> | undefined;
        if (a && !('laser' in a)) a.laser = null;
      });
      return doc;
    },
  },
};

/**
 * Takes the Intel desk out of a stored profile (format 15 → 16): its level, any decryption
 * in it (or any craft paying rep, which only it made), the contracts, and every flash and
 * hard drive, wherever they lie.
 */
function dropIntelDesk(doc: Record<string, unknown>): Record<string, unknown> {
  const d = { ...doc } as {
    hangar?: Record<string, unknown>;
    crafts?: Record<string, { vendor?: unknown }>;
    contracts?: unknown;
  };
  delete d.contracts;
  const { 'intel-desk': _level, ...hangar } = d.hangar ?? {};
  d.hangar = hangar;
  d.crafts = Object.fromEntries(
    Object.entries(d.crafts ?? {}).filter(([id, c]) => id !== 'intel-desk' && !('vendor' in c)),
  );
  return dropItems(d as Record<string, unknown>, new Set(['flash-drive', 'hard-drive']));
}

/** Takes items of these ids out of every grid in a stored profile, at any depth. */
function dropItems(doc: Record<string, unknown>, ids: ReadonlySet<string>) {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || v === null) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x);
    // A grid's items: { x, y, rotated, item: { item: id, ... } }.
    if (Array.isArray(out.items))
      out.items = out.items.filter(
        (g) => !ids.has((g as { item?: { item?: string } }).item?.item ?? ''),
      );
    return out;
  };
  return walk(doc) as Record<string, unknown>;
}

const RENAMED_VENDORS_IN_15: Readonly<Record<string, string>> = {
  quartermaster: 'guns-ammo-vendor',
  gunsmith: 'attachments-vendor',
};

/** Moves a stored profile's standing with renamed vendors, and crafts that pay them rep. */
function renameVendors(
  doc: Record<string, unknown>,
  renamed: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const d = doc as {
    vendors?: Record<string, unknown>;
    crafts?: Record<string, { vendor?: string }>;
  };
  const vendors: Record<string, unknown> = {};
  for (const [id, standing] of Object.entries(d.vendors ?? {}))
    vendors[renamed[id] ?? id] = standing;
  const crafts: Record<string, unknown> = {};
  for (const [id, c] of Object.entries(d.crafts ?? {}))
    crafts[id] = c.vendor && renamed[c.vendor] ? { ...c, vendor: renamed[c.vendor] } : c;
  return { ...d, vendors, crafts };
}

const RENAMED_IN_4: Readonly<Record<string, string>> = {
  'ammo-556': 'ammo-762x39',
  'mag-556-45': 'mag-762x39-45',
};

const RENAMED_IN_5: Readonly<Record<string, string>> = {
  'ammo-45acp-match': 'ammo-45acp',
  'ammo-762x54r-t46m': 'ammo-762x54r-hpbt',
};

/** Calls `visit` on every object in a stored profile, at any depth. */
function eachObject(doc: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(doc)) return doc.forEach((v) => eachObject(v, visit));
  if (typeof doc !== 'object' || doc === null) return;
  const o = doc as Record<string, unknown>;
  visit(o);
  for (const v of Object.values(o)) eachObject(v, visit);
}

/** A stored profile with guns of this item back on their own round (Item.loaded removed). */
function unload(doc: Record<string, unknown>, gun: string): Record<string, unknown> {
  eachObject(doc, (o) => {
    if (o.item === gun) delete o.loaded;
  });
  return doc;
}

/** A stored profile with any optic taken off guns of this item (the optic is lost). */
function dropOptics(doc: Record<string, unknown>, gun: string): Record<string, unknown> {
  eachObject(doc, (o) => {
    const a = o.attachments as Record<string, unknown> | undefined;
    if (o.item === gun && a?.optic) a.optic = null;
  });
  return doc;
}

/**
 * A copy of a stored profile with item ids (items, fitted attachments and the round a gun
 * is loaded with) renamed.
 */
function renameItems(doc: Record<string, unknown>, ids: Readonly<Record<string, string>>) {
  const renamed = (key?: string): boolean =>
    key === 'item' || key === 'attachment' || key === 'loaded';
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (typeof v === 'string') return renamed(key) ? (ids[v] ?? v) : v;
    if (typeof v !== 'object' || v === null) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v))
      out[k] = walk(x, key === 'attachments' ? 'attachment' : k);
    return out;
  };
  return walk(doc) as Record<string, unknown>;
}

/** Checks the shape of gear sent by a client, before checkGear. Null if it's malformed. */
export function parseGear(raw: unknown): Gear | null {
  const parsed = gearShape.safeParse(raw);
  return parsed.success ? (parsed.data as unknown as Gear) : null;
}

/**
 * A kit's item: a gun has the attachments kit.fitted names for it, and a full magazine of
 * the round kit.loaded names for it, or none.
 */
function kitItem(items: ItemDb, kit: StartingKitDef, id: string, count = 1): Item {
  if (itemDef(items, id).type !== 'weapon') return createItem(items, id, count);
  const gun = createWeapon(items, id, kit.fitted[id] ?? [], kit.loaded[id]);
  if (kit.loaded[id] === undefined) gun.mag = 0;
  return gun;
}

/**
 * A new profile from a starting kit, with the knife. Throws if the kit doesn't fit, loads
 * a gun with a round it can't fire, or fits a gun with an attachment it can't take.
 */
export function newProfile(items: ItemDb, kit: StartingKitDef): Profile {
  for (const [gun, round] of Object.entries(kit.loaded)) {
    if (!firesRound(items, weaponDef(items, gun), round))
      throw new Error(`kit ${kit.id}: ${gun} can't be loaded with "${round}"`);
  }
  const gear = createGear(true);
  gear.knife = createItem(items, 'knife');
  const slots = gear as unknown as Record<GearSlot, Item | null>;
  for (const [slot, id] of Object.entries(kit.gear) as [GearSlot, string][]) {
    const item = kitItem(items, kit, id);
    if (!fitsSlot(items, slot, item)) throw new Error(`kit ${kit.id}: "${id}" can't go in ${slot}`);
    const conflict = gearConflict(items, gear, slot, item);
    if (conflict) throw new Error(`kit ${kit.id}: "${id}": ${conflict}`);
    slots[slot] = item;
  }
  gear.hand = gear.primary1 ? 'primary1' : gear.sidearm ? 'sidearm' : 'knife';
  for (const s of kit.carried) {
    let left = s.count ?? 1;
    const item = kitItem(items, kit, s.item, left);
    for (let i = 0; i < CARRIED_GRIDS && left > 0; i++) {
      const grid = carriedGrid(gear, i);
      if (grid) left = addItem(items, grid, item);
    }
    if (left > 0) throw new Error(`kit ${kit.id}: no room to carry "${s.item}"`);
  }
  const stash = createGrid(PROFILE.stash[0], PROFILE.stash[1], true);
  for (const s of kit.stash) {
    if (addItem(items, stash, kitItem(items, kit, s.item, s.count ?? 1)) > 0)
      throw new Error(`kit ${kit.id}: no room in the stash for "${s.item}"`);
  }
  return {
    formatVersion: 18,
    money: kit.money,
    stash: [stash],
    gear,
    quests: {},
    vendors: {},
    hangar: {},
    crafts: {},
  };
}

/** The Hangar modules whose levels give stash space (H4; hangar.md). */
export const STASH_MODULE = 'stash';
export const SECURE_LOCKER = 'secure-locker';

const levelOf = (p: Profile, module: string) => p.hangar[module] ?? 0;

/** How many bought pages (not category pages) a profile has: they come first. */
export function boughtPages(p: Profile): number {
  const n = p.stash.findIndex((g) => g.only);
  return n < 0 ? p.stash.length : n;
}

/** What the next stash page costs, or null if there are already as many as there can be. */
export function nextPagePrice(p: Profile): number | null {
  return PROFILE.pagePrices[boughtPages(p) - 1] ?? null;
}

/** The Stash level the next page needs (H4), or null if there are no more pages. */
export function nextPageStashLevel(p: Profile): number | null {
  return nextPagePrice(p) === null ? null : boughtPages(p);
}

/**
 * Buys the next stash page, empty, after the bought ones (before any category pages): the
 * money goes down by its price. Returns why it can't (no more pages, Stash too low, not
 * enough money), or null once bought. The server does this; the client only shows the price.
 */
export function buyStashPage(p: Profile): string | null {
  const price = nextPagePrice(p);
  if (price === null) return 'the stash has every page it can';
  const level = nextPageStashLevel(p)!;
  if (levelOf(p, STASH_MODULE) < level)
    return `the next page needs the Stash module at level ${level}`;
  if (p.money < price) return `a page costs ${price}, and you have ${p.money}`;
  p.money -= price;
  p.stash.splice(boughtPages(p), 0, createGrid(PROFILE.stash[0], PROFILE.stash[1], true));
  return null;
}

/** The vault's size, [width, height], at a profile's Secure locker level. */
export function vaultSize(p: Profile): readonly [number, number] {
  const sizes = PROFILE.vaults;
  return sizes[Math.min(levelOf(p, SECURE_LOCKER), sizes.length - 1)]!;
}

/** The category pages a profile's Stash level has unlocked, in order. */
export function categoryPages(
  p: Profile,
): readonly { only: PageCategory; size: readonly [number, number] }[] {
  return levelOf(p, STASH_MODULE) >= PROFILE.categoryLevel ? PROFILE.categoryPages : [];
}

/**
 * Gives a profile the stash space its Hangar levels give (H4): the vault at the Secure
 * locker's size (see reshape: what no longer fits goes to the stash), and any category
 * page Stash has unlocked, empty, at the end. Run after an upgrade, and on stored
 * profiles where settleVault ran (only ever on what the server stored: a raid's vault
 * must come back the size it went in, checkGear's job).
 */
export function settleHangarSpace(items: ItemDb, p: Profile): void {
  const [w, h] = vaultSize(p);
  const vault = p.gear.vault;
  if (vault && (vault.w !== w || vault.h !== h)) reshape(items, vault, w, h, undefined, p.stash);
  for (const c of categoryPages(p)) {
    if (p.stash.some((g) => g.only === c.only)) continue;
    const page = createGrid(c.size[0], c.size[1]);
    page.only = c.only;
    p.stash.push(page);
  }
}

/**
 * Auto sort on close (H4, the user's call, 2026-11-10): moves what lies loose on the bought
 * pages onto the category page for its kind, as much as fits (stacks topped up first), so
 * a double-tap into the stash needn't know about category pages. Returns whether anything
 * moved. What doesn't fit stays where it was.
 */
export function sortToCategoryPages(items: ItemDb, p: Profile): boolean {
  let moved = false;
  for (const page of p.stash.slice(0, boughtPages(p))) {
    page.items = page.items.filter((g) => {
      const to = p.stash.find((c) => c.only && canHold(items, c, g.item));
      if (!to) return true;
      // addItem lowers the count by what it placed (the object itself goes over if it all fits).
      const count = g.item.count;
      const left = addItem(items, to, g.item);
      if (left < count) moved = true;
      return left > 0;
    });
  }
  return moved;
}

/**
 * Moves a pistol out of a primary slot, where it could go before 2026-10-30: into the
 * sidearm if that's empty, else onto the first stash page with room (none: it stays, and
 * checkGear refuses it). Run on stored profiles and raid results before they're checked.
 */
export function settleGuns(items: ItemDb, gear: Gear, stash: readonly Grid[]): void {
  for (const slot of ['primary1', 'primary2'] as const) {
    const item = gear[slot];
    if (!item || fitsSlot(items, slot, item)) continue;
    if (!gear.sidearm && fitsSlot(items, 'sidearm', item)) gear.sidearm = item;
    else if (!stash.some((page) => addItem(items, page, item) === 0)) continue;
    gear[slot] = null;
    if (gear.hand === slot) gear.hand = gear.sidearm === item ? 'sidearm' : 'knife';
  }
}

/**
 * Gives bought stash pages saved at another size (9×30 briefly on 2026-11-09, 10×30 until
 * H4) PROFILE.stash's (see reshape: what no longer fits moves to another page, or stays and
 * checkProfile refuses it; prod was wiped for H4). Only for stored profiles. Run where
 * settleGuns is, before settleFits.
 */
export function settleStash(items: ItemDb, stash: readonly Grid[]): void {
  const [w, h] = PROFILE.stash;
  for (const page of stash) {
    if (page.only || (page.w === w && page.h === h)) continue;
    // Not one with an item that doesn't exist: checkProfile refuses it.
    if (page.items.every((g) => items.has(g.item.item)))
      reshape(items, page, w, h, undefined, stash);
  }
}

/**
 * Turns pockets saved as the old 4×1 grid (until 2026-11-08) into GEAR.pockets' five 1×1
 * slots (see reshape): anything bigger than 1×1 goes to the stash. As for the vault, only
 * the old shape is settled. Run where settleGuns is.
 */
export function settlePockets(items: ItemDb, gear: Gear, stash: readonly Grid[]): void {
  const p = gear.pockets;
  if (p.w !== 4 || p.h !== 1 || p.sections) return;
  reshape(
    items,
    p,
    GEAR.pockets[0],
    GEAR.pockets[1],
    POCKET_SECTIONS.map((s) => ({ ...s })),
    stash,
  );
}

/**
 * Gives every rig and backpack (worn, or stored on a stash page) its def's grid shape, when
 * the def changed after it was saved: sections came in on 2026-11-06 (see reshape). The
 * shape is the def's, whatever was sent, and a bag's contents stay the owner's either way
 * (kept with it, or moved to the stash), so nothing is gained by sending another. Run
 * where settleGuns is.
 */
export function settleBags(items: ItemDb, gear: Gear, stash: readonly Grid[]): void {
  const settle = (bag: Item | null) => {
    if (!bag?.grid) return;
    const def = itemDef(items, bag.item);
    if (def.type !== 'container') return;
    // Backpacks saved before 2026-11-10 take empty bags too (Grid.bags); a bag that
    // stopped being a backpack sheds any it holds to the stash, as reshape moves things.
    if (def.slot === 'backpack') bag.grid.bags = true;
    else if (bag.grid.bags) {
      delete bag.grid.bags;
      const grid = bag.grid;
      const shed = grid.items.filter((g) => !canHold(items, grid, g.item));
      grid.items = grid.items.filter((g) => !shed.includes(g));
      // No room in the stash: it stays, and checkGear refuses it.
      for (const g of shed)
        if (!stash.some((page) => addItem(items, page, g.item) === 0)) grid.items.push(g);
    }
    // A rig that gained armor in content since starts it new; one that lost it, sheds it.
    if (def.armor) {
      if (bag.durability === undefined) bag.durability = def.armor.durability;
      if (bag.max !== undefined && bag.max > def.armor.durability) delete bag.max;
      bag.durability = Math.min(bag.durability, bag.max ?? def.armor.durability);
    } else {
      delete bag.durability;
      delete bag.max;
    }
    // The empty bags a backpack holds are settled as well.
    for (const g of bag.grid.items) settle(g.item);
    const sections = sectionsOf(def);
    if (sameShape(bag.grid, def.grid[0], def.grid[1], sections)) return;
    reshape(items, bag.grid, def.grid[0], def.grid[1], sections, stash);
  };
  settle(gear.rig);
  settle(gear.backpack);
  for (const page of stash) for (const g of page.items) settle(g.item);
  // Body armor worn under a rig that became armored goes to the stash (no room: it
  // stays, and checkGear refuses it).
  const body = gear.bodyArmor;
  if (body && gear.rig && isArmoredRig(itemDef(items, gear.rig.item))) {
    if (stash.some((page) => addItem(items, page, body) === 0)) gear.bodyArmor = null;
  }
}

/**
 * Re-fits every grid of a stored profile's (2026-11-06): an item that no longer fits where
 * it was saved, because its size changed in content (the MP-133 grew to 4×2), moves as
 * reshape moves it. Stash pages first, so what the gear sheds lands on them as they'll
 * be. Only for stored profiles and extracted raid results: after a death it would move a
 * vault's overstuffing into the stash.
 */
export function settleFits(items: ItemDb, gear: Gear, stash: readonly Grid[]): void {
  const grids: Grid[] = [];
  for (const page of stash) {
    grids.push(page);
    for (const g of page.items) if (g.item.grid) grids.push(g.item.grid);
  }
  for (const bag of [gear.rig, gear.backpack]) if (bag?.grid) grids.push(bag.grid);
  grids.push(gear.pockets);
  if (gear.vault) grids.push(gear.vault);
  for (const grid of grids) {
    // Not one with an item that doesn't exist (a forged result): checkGear refuses it.
    if (grid.items.every((g) => items.has(g.item.item))) refit(items, grid, stash);
  }
}

/** Gives a grid a new shape, then re-fits what's in it (see refit). */
function reshape(
  items: ItemDb,
  grid: Grid,
  w: number,
  h: number,
  sections: Section[] | undefined,
  stash: readonly Grid[],
): void {
  grid.w = w;
  grid.h = h;
  if (sections) grid.sections = sections;
  else delete grid.sections;
  refit(items, grid, stash);
}

/**
 * Moves anything in a grid that doesn't fit where it is (past its edge, across its
 * sections, or over an item before it) to a free spot in it, else onto the first stash
 * page with room (none: it stays, and checkGear refuses it).
 */
function refit(items: ItemDb, grid: Grid, stash: readonly Grid[]): void {
  const all = grid.items;
  const off: GridItem[] = [];
  grid.items = [];
  for (const g of all) {
    const w = itemWidth(items, g.item.item, g.rotated);
    const h = itemHeight(items, g.item.item, g.rotated);
    if (isFree(items, grid, g.x, g.y, w, h)) grid.items.push(g);
    else off.push(g);
  }
  for (const g of off) {
    if (addItem(items, grid, g.item) === 0) continue;
    if (stash.some((page) => page !== grid && addItem(items, page, g.item) === 0)) continue;
    grid.items.push(g);
  }
}

/** Puts every gun down: no cooldown, reload or trigger held, as stored between raids. */
export function restGear(gear: Gear): void {
  forEachItem(gear, [], (item) => {
    if (item.mag === undefined) return;
    const w = item as WeaponState;
    w.cooldown = 0;
    w.reloading = 0;
    w.triggerHeld = false;
    delete w.reloadWith;
    delete w.reloadByHand;
  });
}

/** Calls fn for every item in the gear and stash, containers' contents included. */
function forEachItem(gear: Gear, stash: readonly Grid[], fn: (item: Item) => void): void {
  const grid = (g: Grid) => {
    for (const gi of g.items) visit(gi.item);
  };
  const visit = (item: Item) => {
    fn(item);
    if (item.grid) grid(item.grid);
  };
  for (const slot of GEAR_SLOTS) {
    const item = gear[slot];
    if (item) visit(item);
  }
  grid(gear.pockets);
  if (gear.vault) grid(gear.vault);
  for (const page of stash) grid(page);
}

/**
 * How many of each item a profile has, counting stacks, the attachments on guns and the
 * rounds loaded in them (as their ammo item, so unloading a gun makes nothing).
 */
export function countItems(items: ItemDb, p: Profile): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, n: number) => out.set(id, (out.get(id) ?? 0) + n);
  forEachItem(p.gear, p.stash, (item) => {
    add(item.item, item.count);
    for (const a of Object.values(item.attachments ?? {})) if (a) add(a, 1);
    if (item.mag) add(loadedAmmo(items, item), item.mag);
  });
  return out;
}

/**
 * The first item there's more of in after than in before, or null. Moving things around
 * between raids (the stash, session 13) can't make items: only raids and vendors can.
 */
export function itemGained(items: ItemDb, before: Profile, after: Profile): string | null {
  const had = countItems(items, before);
  for (const [id, n] of countItems(items, after)) if (n > (had.get(id) ?? 0)) return id;
  return null;
}

/**
 * The durability of all the armor, its max durability (sim/repair.ts), and the points
 * left in all the repair kits.
 */
function repairTotals(items: ItemDb, p: Profile) {
  const out = { durability: 0, max: 0, points: 0 };
  forEachItem(p.gear, p.stash, (item) => {
    const def = items.get(item.item);
    // Armor, and armored rigs (2026-11-11).
    const armor = def && armorOf(def);
    if (armor) {
      out.durability += item.durability ?? 0;
      out.max += item.max ?? armor.durability;
    } else if (def?.type === 'repair') out.points += item.left ?? 0;
  });
  return out;
}

/**
 * Whether armor gained more durability between two profiles than repair kits lost
 * points (session 13b): between raids, only repairs mend armor. Or gained max durability,
 * which nothing gives back (2026-11-06).
 */
export function overRepaired(items: ItemDb, before: Profile, after: Profile): boolean {
  const a = repairTotals(items, before);
  const b = repairTotals(items, after);
  return b.durability - a.durability > a.points - b.points + 1e-6 || b.max > a.max + 1e-6;
}

/**
 * Checks a profile against the items: see checkGear, plus the stash pages' number and
 * size and the money's sanity limit. Returns the first problem, or null.
 */
export function checkProfile(items: ItemDb, p: Profile): string | null {
  if (p.money > PROFILE.maxMoney) return `money ${p.money} is over the limit`;
  const bought = boughtPages(p);
  if (bought > PROFILE.pagePrices.length + 1)
    return `${bought} stash pages is more than there can be`;
  // The category pages Stash has unlocked, each once, after the bought ones (H4).
  const cats = categoryPages(p);
  if (p.stash.length - bought !== cats.length)
    return `${p.stash.length - bought} category pages, not ${cats.length}`;
  for (let i = 0; i < p.stash.length; i++) {
    const cat = cats[i - bought];
    const [w, h] = cat ? cat.size : PROFILE.stash;
    const page = p.stash[i]!;
    if (page.only !== cat?.only)
      return `stash page ${i + 1} must be ${cat?.only ?? 'a bought page'}`;
    const bad = checkGrid(items, page, w, h, !cat, `stash page ${i + 1}`);
    if (bad) return bad;
  }
  return checkGear(items, p.gear, vaultSize(p));
}

/**
 * Checks gear against the items: every item exists, has the fields its type needs within
 * its limits (stack size, durability, rounds, uses), and fits where it is (its gear slot,
 * or inside its grid without overlapping, with no containers in containers). Pockets and
 * the vault must be their usual size (the vault's, from the Secure locker: vaultSize). Returns the first problem, or null.
 */
export function checkGear(
  items: ItemDb,
  gear: Gear,
  vault: readonly [number, number] = GEAR.vault,
): string | null {
  for (const slot of GEAR_SLOTS) {
    const item = gear[slot];
    if (!item) continue;
    const bad = checkItem(items, item, slot);
    if (bad) return bad;
    if (!fitsSlot(items, slot, item)) return `${slot}: "${item.item}" can't go there`;
  }
  if (gear.bodyArmor && gear.rig && isArmoredRig(itemDef(items, gear.rig.item)))
    return "body armor can't be worn with an armored rig";
  if (!gear.vault) return 'a player must have a vault';
  // Only a backpack's grid takes empty bags (checkItem checks those).
  if (gear.pockets.bags || gear.vault.bags) return "pockets and the vault can't take bags";
  return (
    checkGrid(
      items,
      gear.pockets,
      GEAR.pockets[0],
      GEAR.pockets[1],
      false,
      'pockets',
      POCKET_SECTIONS,
    ) ?? checkGrid(items, gear.vault, vault[0], vault[1], false, 'vault')
  );
}

function checkGrid(
  items: ItemDb,
  grid: Grid,
  w: number,
  h: number,
  containers: boolean,
  where: string,
  sections?: readonly Section[],
): string | null {
  if (!sameShape(grid, w, h, sections) || grid.containers !== containers)
    return `${where}: must be ${w}×${h}${sections ? ` in ${sections.length} sections` : ''}${containers ? ' and hold containers' : ''}`;
  for (let i = 0; i < grid.items.length; i++) {
    const gi = grid.items[i]!;
    const at = `${where}[${gi.x},${gi.y}]`;
    const bad = checkItem(items, gi.item, at);
    if (bad) return bad;
    if (!canHold(items, grid, gi.item)) return `${at}: "${gi.item.item}" can't go in ${where}`;
    const iw = itemWidth(items, gi.item.item, gi.rotated);
    const ih = itemHeight(items, gi.item.item, gi.rotated);
    if (!isFree(items, grid, gi.x, gi.y, iw, ih, i))
      return `${at}: "${gi.item.item}" is outside the grid or overlaps another item`;
  }
  return null;
}

const scratchStats = createWeaponStats();

/** Armor's durability, or an armored rig's: 0 to its max, and its max to the def's. */
function checkDurability(item: Item, full: number, at: string): string | null {
  if (item.max !== undefined && item.max > full)
    return `${at}: max durability must be 0 to ${full}`;
  if (item.durability === undefined || item.durability > (item.max ?? full) + 1e-6)
    return `${at}: durability must be 0 to ${item.max ?? full}`;
  return null;
}

function checkItem(items: ItemDb, item: Item, where: string): string | null {
  const def = items.get(item.item);
  if (!def) return `${where}: no item "${item.item}"`;
  const at = `${where}: ${def.id}`;
  if (item.count > stackSize(def)) return `${at}: ${item.count} is more than a stack`;
  if (item.grid && def.type !== 'container') return `${at}: only rigs and backpacks have a grid`;
  if (item.attachments && def.type !== 'weapon') return `${at}: only guns have attachments`;
  switch (def.type) {
    case 'weapon':
      return checkWeapon(items, item, def, at);
    case 'armor':
      return checkDurability(item, def.durability, at);
    case 'container':
      if (!item.grid) return `${at}: no grid`;
      // An armored rig has armor's durability (2026-11-11); another rig has none.
      if (def.armor) {
        const bad = checkDurability(item, def.armor.durability, at);
        if (bad) return bad;
      } else if (item.durability !== undefined || item.max !== undefined)
        return `${at}: only armor has durability`;
      if (!!item.grid.bags !== (def.slot === 'backpack'))
        return `${at}: ${def.slot === 'backpack' ? 'must' : "mustn't"} take empty bags`;
      return checkGrid(items, item.grid, def.grid[0], def.grid[1], false, def.id, sectionsOf(def));
    case 'med':
      return checkLeft(item, def.hp ?? def.uses ?? 1, at);
    case 'repair':
      return checkLeft(item, def.points, at);
    case 'key':
      return def.uses === undefined ? null : checkLeft(item, def.uses, at);
    default:
      return null;
  }
}

function checkLeft(item: Item, max: number, at: string): string | null {
  return item.left === undefined || item.left > max
    ? `${at}: what's left must be 0 to ${max}`
    : null;
}

function checkWeapon(items: ItemDb, item: Item, def: WeaponDef, at: string): string | null {
  if (item.mag === undefined || !item.attachments) return `${at}: a gun needs mag and attachments`;
  for (const slot of ATTACHMENT_SLOTS) {
    const id = item.attachments[slot];
    if (!id) continue;
    const a = items.get(id);
    if (a?.type !== 'attachment' || a.slot !== slot || !fits(def, a as AttachmentDef))
      return `${at}: "${id}" doesn't fit its ${slot} slot`;
  }
  const w = { cooldown: 0, reloading: 0, triggerHeld: false, ...item } as WeaponState;
  const magazine = weaponStats(items, w, scratchStats).magazine;
  if (item.mag > magazine) return `${at}: ${item.mag} rounds is more than its magazine`;
  if (item.loaded !== undefined && !firesRound(items, def, item.loaded))
    return `${at}: it doesn't fire "${item.loaded}"`;
  return null;
}
