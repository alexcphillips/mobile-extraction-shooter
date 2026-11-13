import { attachmentDef, itemDef, type AttachmentSlot, type ItemDb } from './content/items';
import { VENDOR_LEVELS, type VendorDef, type VendorOffer } from './content/vendors';
import { removeAt, type Grid, type Item } from './inventory/grid';
import { PROFILE, type Profile, type VendorStanding } from './profile';
import { createRng, nextInt } from './rng';
import { type Gear, type GearSlot } from './sim/gear';
import { loadedAmmo } from './sim/weapons';
import type { ItemRef } from './sim/looting';
import { addToStash, newStashItem, stashGridOf } from './stash';

/*
 * Buying and selling (session 13b, decided with the user 2026-10-27). Every item has a
 * value. Vendors sell new items for their value, with unlimited stock, into the stash.
 * They buy anything with a value for a share of it, less for one worn or part-used, so
 * selling always loses money and buying back is never a profit. Cash is money: what comes
 * out of a raid goes into the balance at its full value (depositMoney). The server does
 * all of this; the client shows the prices.
 */

export const VENDOR = {
  /** The share of an item's value a vendor pays for it, new. */
  sellShare: 0.5,
} as const;

/** How used an item is, from 0 (spent) to 1 (new): armor's durability, a med's uses. */
export function condition(items: ItemDb, item: Item): number {
  const def = itemDef(items, item.item);
  const of = (left: number | undefined, max: number) => Math.min(1, (left ?? max) / max);
  switch (def.type) {
    case 'armor':
      return of(item.durability, def.durability);
    case 'container':
      // An armored rig wears as armor does (2026-11-11).
      return def.armor ? of(item.durability, def.armor.durability) : 1;
    case 'med':
      return of(item.left, def.hp ?? def.uses ?? 1);
    case 'repair':
      return of(item.left, def.points);
    case 'key':
      return def.uses === undefined ? 1 : of(item.left, def.uses);
    default:
      return 1;
  }
}

/** Whether an item is money (cash), which goes into the balance at its full value. */
export function isMoney(items: ItemDb, id: string): boolean {
  const def = itemDef(items, id);
  return def.type === 'loot' && !!def.money;
}

/** One line of what a vendor pays for an item: the item itself, an attachment, or rounds. */
export interface SellPart {
  id: string;
  count: number;
  price: number;
}

/**
 * What a vendor pays for an item (or stack), part by part: the item first, then a gun's
 * attachments and loaded rounds. For the item details; sellPrice is their sum.
 */
export function sellParts(items: ItemDb, item: Item): SellPart[] {
  const def = itemDef(items, item.item);
  const share = (id: string): number => Math.floor(itemDef(items, id).value * VENDOR.sellShare);
  if (isMoney(items, def.id))
    return [{ id: def.id, count: item.count, price: def.value * item.count }];
  const parts: SellPart[] = [
    {
      id: def.id,
      count: item.count,
      price: Math.floor(def.value * VENDOR.sellShare * condition(items, item)) * item.count,
    },
  ];
  for (const a of Object.values(item.attachments ?? {})) {
    if (a) parts.push({ id: a, count: 1, price: share(a) });
  }
  // A gun's loaded rounds, or a loose magazine's (MG-1).
  if (def.type === 'weapon' || item.loaded) {
    const mag = item.mag ?? 0;
    const round = loadedAmmo(items, item);
    if (mag > 0) parts.push({ id: round, count: mag, price: share(round) * mag });
  }
  return parts;
}

/**
 * What a vendor pays for an item (or stack): its share of the value by condition, whole
 * money per item; money at its full value. A gun's attachments and loaded rounds count.
 */
export function sellPrice(items: ItemDb, item: Item): number {
  return sellParts(items, item).reduce((n, p) => n + p.price, 0);
}

/** What a raid gained you of one item: how many, and what a vendor pays for them. */
export interface RaidGain {
  id: string;
  count: number;
  price: number;
}

/**
 * What's new from this raid among the items kept from it, not yet settled (settleFound):
 * not brought, nor found before and taken back in (refound). By what a vendor pays, cash
 * at its full value: each found item with what's on it. What no vendor wants is left out.
 */
export function raidGains(items: ItemDb, kept: readonly Item[]): RaidGain[] {
  const gains = new Map<string, RaidGain>();
  for (const item of kept) {
    if (item.brought || item.refound) continue;
    for (const p of sellParts(items, item)) {
      if (p.price <= 0) continue;
      const gain = gains.get(p.id) ?? { id: p.id, count: 0, price: 0 };
      gain.count += p.count;
      gain.price += p.price;
      gains.set(p.id, gain);
    }
  }
  return [...gains.values()];
}

/** Why an item can't be sold, or null if it can. */
export function cantSell(items: ItemDb, item: Item): string | null {
  if (item.grid?.items.length) return 'Empty it first';
  if (sellPrice(items, item) <= 0) return 'No vendor wants it';
  return null;
}

/**
 * What an offer costs: the item, and any attachments it comes with (a gun's own, its
 * `defaults`, unless the offer fits another in that slot), times the vendor's markup
 * (whole money).
 */
export function buyPrice(items: ItemDb, offer: VendorOffer, vendor?: VendorDef): number {
  const def = itemDef(items, offer.item);
  const listed = offer.attachments ?? [];
  let parts = listed.reduce((n, a) => n + itemDef(items, a).value, 0);
  if (def.type === 'weapon') {
    const taken = new Set(listed.map((a) => attachmentDef(items, a).slot));
    for (const [slot, a] of Object.entries(def.defaults ?? {}))
      if (!taken.has(slot as AttachmentSlot)) parts += itemDef(items, a).value;
  }
  const base = def.value * (offer.count ?? 1) + parts;
  return Math.round(base * (vendor?.markup ?? 1));
}

/** The most of one offer bought in one go. */
export const MAX_BUY = 50;

/** Where a player stands with a vendor: nothing if they've never dealt. */
export function standingOf(profile: Profile, vendor: string): VendorStanding {
  return profile.vendors[vendor] ?? { rep: 0, spent: 0 };
}

/** A vendor's level for a player (1 to VENDOR_LEVELS): each level needs the ones before it. */
export function vendorLevel(vendor: VendorDef, standing: VendorStanding): number {
  let level = 1;
  for (const need of vendor.levels) {
    if (standing.rep + 1e-9 < need.rep || standing.spent < need.spent) break;
    level++;
  }
  return Math.min(level, VENDOR_LEVELS);
}

/** The level an offer is sold from. */
export const offerLevel = (offer: VendorOffer): number => offer.level ?? 1;

/**
 * Which of a vendor's offers it has at a time (Unix ms), by index: all of them, or for one
 * with a rotation, `shown` of them picked by the vendor and the time window, so everyone
 * sees the same and the server agrees with the page.
 */
export function vendorStock(vendor: VendorDef, now: number): number[] {
  const all = vendor.sells.map((_, i) => i);
  const r = vendor.rotation;
  if (!r) return all;
  const window = Math.floor(now / (r.hours * 3_600_000));
  let seed = window;
  for (const ch of vendor.id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
  const rng = createRng(seed >>> 0);
  // A shuffle's first `shown`, back in the vendor's order.
  for (let i = all.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.slice(0, r.shown).sort((a, b) => a - b);
}

/** When a vendor with a rotation next changes its stock (Unix ms), or null for one without. */
export function nextRestock(vendor: VendorDef, now: number): number | null {
  const r = vendor.rotation;
  if (!r) return null;
  const span = r.hours * 3_600_000;
  return (Math.floor(now / span) + 1) * span;
}

/**
 * Buys `times` of a vendor's offer into the stash, page `page` first, then the others:
 * the money goes down by the price and the spending with the vendor up by it. The offer
 * must be in stock now (vendorStock) and at a level the player has reached. Returns why
 * it can't be (no such offer, too low a level, not enough money, no room), or null once
 * bought; refused, nothing changes.
 */
export function buyOffer(
  profile: Profile,
  items: ItemDb,
  vendor: VendorDef,
  index: number,
  page = 0,
  times = 1,
  now = Date.now(),
): string | null {
  const offer = vendor.sells[index];
  if (!offer || !items.has(offer.item)) return `${vendor.name} has no offer ${index}`;
  if (!Number.isInteger(times) || times < 1 || times > MAX_BUY)
    return `buy 1 to ${MAX_BUY} at a time`;
  if (!vendorStock(vendor, now).includes(index))
    return `${vendor.name} doesn't have that any more: the stock has changed`;
  const standing = standingOf(profile, vendor.id);
  const need = offerLevel(offer);
  if (vendorLevel(vendor, standing) < need) return `${vendor.name} sells that from level ${need}`;
  const price = buyPrice(items, offer, vendor) * times;
  if (profile.money < price)
    return `that costs ${price.toLocaleString('en')}, and you have ${profile.money.toLocaleString('en')}`;
  if (!addToStash(profile, items, Array<VendorOffer>(times).fill(offer), page, newStashItem))
    return 'there is no room in your stash';
  profile.money -= price;
  profile.vendors[vendor.id] = { ...standing, spent: standing.spent + price };
  return null;
}

/** The most items sold in one go. */
export const MAX_SELL = 200;

/** An item to sell, found where a ref says: the item, and how to take it out. */
interface ToSell {
  item: Item;
  take: () => void;
}

function findToSell(profile: Profile, ref: ItemRef): ToSell | string {
  const gear = profile.gear as unknown as Record<GearSlot, Item | null>;
  if ('ground' in ref) return 'that is on the ground';
  if ('slot' in ref) {
    if (ref.owner.kind !== 'self') return 'that is not yours';
    if (ref.slot === 'knife') return 'your knife stays with you';
    const item = gear[ref.slot];
    if (!item || item.item !== ref.item) return 'that item has moved';
    return { item, take: () => (gear[ref.slot] = null) };
  }
  const grid: Grid | null = stashGridOf(profile, ref);
  const item = grid?.items[ref.index]?.item;
  if (!grid || !item || item.item !== ref.item) return 'that item has moved';
  // By the item, not the index: selling others from the same grid moves it.
  return {
    item,
    take: () =>
      removeAt(
        grid,
        grid.items.findIndex((g) => g.item === item),
      ),
  };
}

/**
 * Sells items from the gear or the stash (refs as the stash screen sees them), all or
 * none: they're gone, and their sellPrice goes into the money. The knife can't be sold,
 * nor a rig or backpack with anything in it that isn't being sold too. If the slot in
 * hand was sold, the knife is in hand. Returns why they can't be, or null once sold.
 */
export function sellItems(
  profile: Profile,
  items: ItemDb,
  refs: readonly ItemRef[],
): string | null {
  if (!refs.length) return 'nothing to sell';
  if (refs.length > MAX_SELL) return `at most ${MAX_SELL} items at once`;
  const found: ToSell[] = [];
  for (const ref of refs) {
    const f = findToSell(profile, ref);
    if (typeof f === 'string') return f;
    if (found.some((o) => o.item === f.item)) return 'an item is listed twice';
    found.push(f);
  }
  const selling = new Set(found.map((f) => f.item));
  let price = 0;
  for (const { item } of found) {
    if (item.grid?.items.some((g) => !selling.has(g.item)))
      return `empty the ${itemDef(items, item.item).name.toLowerCase()} first`;
    const p = sellPrice(items, item);
    if (p <= 0) return `no vendor wants the ${itemDef(items, item.item).name.toLowerCase()}`;
    price += p;
  }
  if (profile.money + price > PROFILE.maxMoney) return 'you have as much money as there can be';
  for (const f of found) f.take();
  profile.money += price;
  if (!profile.gear[profile.gear.hand]) profile.gear.hand = 'knife';
  return null;
}

/** What a list of items sells for, in all. */
export function sellTotal(items: ItemDb, list: readonly Item[]): number {
  return list.reduce((n, item) => n + sellPrice(items, item), 0);
}

/**
 * Takes the money (cash) out of gear, from its grids (vault included), and returns how
 * much it was worth: what a raid brought out goes into the balance (session 13b).
 */
export function depositMoney(items: ItemDb, gear: Gear): number {
  let total = 0;
  const grids = [gear.pockets, gear.vault, gear.rig?.grid, gear.backpack?.grid];
  for (const grid of grids) {
    if (!grid) continue;
    for (let i = grid.items.length - 1; i >= 0; i--) {
      const it = grid.items[i]!.item;
      if (!isMoney(items, it.item)) continue;
      total += sellPrice(items, it);
      removeAt(grid, i);
    }
  }
  return total;
}

/** Money from a raid: deposits it into the profile, up to the limit. Returns how much. */
export function depositInto(profile: Profile, items: ItemDb): number {
  const n = depositMoney(items, profile.gear);
  profile.money = Math.min(PROFILE.maxMoney, profile.money + n);
  return n;
}
