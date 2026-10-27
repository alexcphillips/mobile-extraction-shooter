import { z } from 'zod';
import type { ContentFormat } from './content/format';
import {
  ATTACHMENT_SLOTS,
  fits,
  stackSize,
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
  type Grid,
  type Item,
} from './inventory/grid';
import { createItem } from './sim/create-item';
import {
  CARRIED_GRIDS,
  GEAR,
  GEAR_SLOTS,
  carriedGrid,
  createGear,
  fitsSlot,
  type Gear,
  type GearSlot,
} from './sim/gear';
import { createWeaponStats, weaponStats, type WeaponState } from './sim/weapons';

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
   * the gear and carried grids on a landscape phone, and the rows scroll.
   */
  stash: [10, 30],
  /**
   * What each extra stash page costs, in order: everyone starts with one, so the most is
   * one more than there are prices. First guesses (session 13), kept against the item
   * values in 13b.
   */
  pagePrices: [100_000, 250_000, 500_000],
  /** Money above this is refused as a sanity limit. */
  maxMoney: 1_000_000_000,
} as const;

export interface Profile {
  formatVersion: 2;
  money: number;
  /** The stash's pages, bought with money (at least one). */
  stash: Grid[];
  gear: Gear;
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
    left: amount.optional(),
    mag: count.optional(),
    attachments: z.record(z.enum(ATTACHMENT_SLOTS), idSchema.nullable()).optional(),
    grid: gridShape.optional(),
    // A gun's state in the sim; restGear resets it before it's stored.
    cooldown: z.number().optional(),
    reloading: z.number().optional(),
    triggerHeld: z.boolean().optional(),
  }),
);

const gridShape = z.strictObject({
  w: count,
  h: count,
  containers: z.boolean(),
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
  bodyArmour: slotShape,
  rig: slotShape,
  backpack: slotShape,
  pockets: gridShape,
  vault: gridShape.nullable(),
});

const profileShape = z.strictObject({
  formatVersion: z.literal(2),
  money: count,
  stash: z.array(gridShape).min(1),
  gear: gearShape,
});

export const PROFILE_FORMAT_VERSION = 2;

export const PROFILE_FORMAT: ContentFormat<Profile> = {
  kind: 'profile',
  version: PROFILE_FORMAT_VERSION,
  // The shapes are checked loosely typed (items nest through grids); checkProfile does the rest.
  schema: profileShape as unknown as z.ZodType<Profile>,
  migrations: {
    // Session 13: the one stash grid became the first of its pages.
    1: (doc) => ({ ...doc, stash: [doc.stash] }),
  },
};

/** Checks the shape of gear sent by a client, before checkGear. Null if it's malformed. */
export function parseGear(raw: unknown): Gear | null {
  const parsed = gearShape.safeParse(raw);
  return parsed.success ? (parsed.data as unknown as Gear) : null;
}

/** A new profile from a starting kit, with the knife. Throws if the kit doesn't fit. */
export function newProfile(items: ItemDb, kit: StartingKitDef): Profile {
  const gear = createGear(true);
  gear.knife = createItem(items, 'knife');
  const slots = gear as unknown as Record<GearSlot, Item | null>;
  for (const [slot, id] of Object.entries(kit.gear) as [GearSlot, string][]) {
    const item = createItem(items, id);
    if (!fitsSlot(items, slot, item)) throw new Error(`kit ${kit.id}: "${id}" can't go in ${slot}`);
    slots[slot] = item;
  }
  gear.hand = gear.primary1 ? 'primary1' : gear.sidearm ? 'sidearm' : 'knife';
  for (const s of kit.carried) {
    let left = s.count ?? 1;
    const item = createItem(items, s.item, left);
    for (let i = 0; i < CARRIED_GRIDS && left > 0; i++) {
      const grid = carriedGrid(gear, i);
      if (grid) left = addItem(items, grid, item);
    }
    if (left > 0) throw new Error(`kit ${kit.id}: no room to carry "${s.item}"`);
  }
  const stash = createGrid(PROFILE.stash[0], PROFILE.stash[1], true);
  for (const s of kit.stash) {
    if (addItem(items, stash, createItem(items, s.item, s.count ?? 1)) > 0)
      throw new Error(`kit ${kit.id}: no room in the stash for "${s.item}"`);
  }
  return { formatVersion: 2, money: kit.money, stash: [stash], gear };
}

/** What the next stash page costs, or null if there are already as many as there can be. */
export function nextPagePrice(p: Profile): number | null {
  return PROFILE.pagePrices[p.stash.length - 1] ?? null;
}

/**
 * Buys the next stash page, empty, at the end: the money goes down by its price. Returns
 * why it can't (no more pages, not enough money), or null once bought. The server does
 * this; the client only shows the price.
 */
export function buyStashPage(p: Profile): string | null {
  const price = nextPagePrice(p);
  if (price === null) return 'the stash has every page it can';
  if (p.money < price) return `a page costs ${price}, and you have ${p.money}`;
  p.money -= price;
  p.stash.push(createGrid(PROFILE.stash[0], PROFILE.stash[1], true));
  return null;
}

/** Puts every gun down: no cooldown, reload or trigger held, as stored between raids. */
export function restGear(gear: Gear): void {
  forEachItem(gear, [], (item) => {
    if (item.mag === undefined) return;
    const w = item as WeaponState;
    w.cooldown = 0;
    w.reloading = 0;
    w.triggerHeld = false;
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

/** How many of each item a profile has, counting stacks and the attachments on guns. */
export function countItems(p: Profile): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, n: number) => out.set(id, (out.get(id) ?? 0) + n);
  forEachItem(p.gear, p.stash, (item) => {
    add(item.item, item.count);
    for (const a of Object.values(item.attachments ?? {})) if (a) add(a, 1);
  });
  return out;
}

/**
 * The first item there's more of in after than in before, or null. Moving things around
 * between raids (the stash, session 13) can't make items: only raids and vendors can.
 */
export function itemGained(before: Profile, after: Profile): string | null {
  const had = countItems(before);
  for (const [id, n] of countItems(after)) if (n > (had.get(id) ?? 0)) return id;
  return null;
}

/** The durability of all the armour, and the points left in all the repair kits. */
function repairTotals(items: ItemDb, p: Profile): { durability: number; points: number } {
  const out = { durability: 0, points: 0 };
  forEachItem(p.gear, p.stash, (item) => {
    const type = items.get(item.item)?.type;
    if (type === 'armour') out.durability += item.durability ?? 0;
    else if (type === 'repair') out.points += item.left ?? 0;
  });
  return out;
}

/**
 * Whether armour gained more durability between two profiles than repair kits lost
 * points (session 13b): between raids, only repairs mend armour.
 */
export function overRepaired(items: ItemDb, before: Profile, after: Profile): boolean {
  const a = repairTotals(items, before);
  const b = repairTotals(items, after);
  return b.durability - a.durability > a.points - b.points + 1e-6;
}

/**
 * Checks a profile against the items: see checkGear, plus the stash pages' number and
 * size and the money's sanity limit. Returns the first problem, or null.
 */
export function checkProfile(items: ItemDb, p: Profile): string | null {
  if (p.money > PROFILE.maxMoney) return `money ${p.money} is over the limit`;
  if (p.stash.length > PROFILE.pagePrices.length + 1)
    return `${p.stash.length} stash pages is more than there can be`;
  for (let i = 0; i < p.stash.length; i++) {
    const [w, h] = PROFILE.stash;
    const bad = checkGrid(items, p.stash[i]!, w, h, true, `stash page ${i + 1}`);
    if (bad) return bad;
  }
  return checkGear(items, p.gear);
}

/**
 * Checks gear against the items: every item exists, has the fields its type needs within
 * its limits (stack size, durability, rounds, uses), and fits where it is (its gear slot,
 * or inside its grid without overlapping, with no containers in containers). Pockets and
 * the vault must be their usual size. Returns the first problem, or null.
 */
export function checkGear(items: ItemDb, gear: Gear): string | null {
  for (const slot of GEAR_SLOTS) {
    const item = gear[slot];
    if (!item) continue;
    const bad = checkItem(items, item, slot);
    if (bad) return bad;
    if (!fitsSlot(items, slot, item)) return `${slot}: "${item.item}" can't go there`;
  }
  if (!gear.vault) return 'a player must have a vault';
  return (
    checkGrid(items, gear.pockets, GEAR.pockets[0], GEAR.pockets[1], false, 'pockets') ??
    checkGrid(items, gear.vault, GEAR.vault[0], GEAR.vault[1], false, 'vault')
  );
}

function checkGrid(
  items: ItemDb,
  grid: Grid,
  w: number,
  h: number,
  containers: boolean,
  where: string,
): string | null {
  if (grid.w !== w || grid.h !== h || grid.containers !== containers)
    return `${where}: must be ${w}×${h}${containers ? ' and hold containers' : ''}`;
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
    case 'armour':
      if (item.durability === undefined || item.durability > def.durability)
        return `${at}: durability must be 0 to ${def.durability}`;
      return null;
    case 'container':
      if (!item.grid) return `${at}: no grid`;
      return checkGrid(items, item.grid, def.grid[0], def.grid[1], false, def.id);
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
  return null;
}
