import { itemDef, type ItemDb } from './content/items';
import type { VendorDef, VendorOffer } from './content/vendors';
import { removeAt, type Grid, type Item } from './inventory/grid';
import { PROFILE, type Profile } from './profile';
import { GEAR_SLOTS, type Gear, type GearSlot } from './sim/gear';
import { loadedAmmo } from './sim/weapons';
import type { GridName, ItemRef } from './sim/looting';
import { addToStash, stashGridOf, stashOwner } from './stash';

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

/** How used an item is, from 0 (spent) to 1 (new): armour's durability, a med's uses. */
export function condition(items: ItemDb, item: Item): number {
  const def = itemDef(items, item.item);
  const of = (left: number | undefined, max: number) => Math.min(1, (left ?? max) / max);
  switch (def.type) {
    case 'armour':
      return of(item.durability, def.durability);
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
  if (def.type === 'weapon') {
    for (const a of Object.values(item.attachments ?? {})) {
      if (a) parts.push({ id: a, count: 1, price: share(a) });
    }
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

/** Why an item can't be sold, or null if it can. */
export function cantSell(items: ItemDb, item: Item): string | null {
  if (item.grid?.items.length) return 'Empty it first';
  if (sellPrice(items, item) <= 0) return 'No vendor wants it';
  return null;
}

/** What an offer costs. */
export function buyPrice(items: ItemDb, offer: VendorOffer): number {
  return itemDef(items, offer.item).value * (offer.count ?? 1);
}

/**
 * Buys a vendor's offer into the stash, page `page` first, then the others: the money goes
 * down by its price. Returns why it can't be (no such offer, not enough money, no room),
 * or null once bought; refused, nothing changes.
 */
export function buyOffer(
  profile: Profile,
  items: ItemDb,
  vendor: VendorDef,
  index: number,
  page = 0,
): string | null {
  const offer = vendor.sells[index];
  if (!offer || !items.has(offer.item)) return `${vendor.name} has no offer ${index}`;
  const price = buyPrice(items, offer);
  if (profile.money < price)
    return `that costs ${price.toLocaleString('en')}, and you have ${profile.money.toLocaleString('en')}`;
  if (!addToStash(profile, items, [offer], page)) return 'there is no room in your stash';
  profile.money -= price;
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

/** The grids you carry, as sellAll names them. */
const CARRIED: readonly GridName[] = ['pockets', 'rig', 'backpack', 'vault'];

/**
 * Everything you have that can be sold, as refs for sellItems (2026-10-31, the stash's
 * "Sell everything"): what's in the grids you carry (vault too) and on every stash page,
 * then your gear slots. Left out: the knife, whatever no vendor wants (admin items, keys
 * worth nothing), a stored rig or backpack with anything in it (its contents can't be
 * named), and a worn one holding anything that won't sell. Worn ones come after their
 * contents, so selling them in order, at most MAX_SELL at a time, never meets one that
 * isn't empty yet. Refs are by index, so sell a batch and ask again for the rest.
 */
export function sellAll(profile: Profile, items: ItemDb): ItemRef[] {
  const out: ItemRef[] = [];
  const sellable = (it: Item): boolean => !it.grid?.items.length && sellPrice(items, it) > 0;
  const grids: [ItemRef['owner'], GridName][] = [
    ...CARRIED.map((g): [ItemRef['owner'], GridName] => [{ kind: 'self' }, g]),
    ...profile.stash.map((_, p): [ItemRef['owner'], GridName] => [stashOwner(p), 'loot']),
  ];
  for (const [owner, grid] of grids) {
    const list = stashGridOf(profile, { owner, grid })?.items ?? [];
    list.forEach((g, index) => {
      if (sellable(g.item)) out.push({ owner, grid, index, item: g.item.item });
    });
  }
  const gear = profile.gear as unknown as Record<GearSlot, Item | null>;
  for (const slot of GEAR_SLOTS) {
    const it = gear[slot];
    if (!it || slot === 'knife' || sellPrice(items, it) <= 0) continue;
    if (it.grid?.items.some((g) => !sellable(g.item))) continue;
    out.push({ owner: { kind: 'self' }, slot, item: it.item });
  }
  return out;
}

/** What selling everything (sellAll) would bring in. */
export function sellAllPrice(profile: Profile, items: ItemDb): number {
  let n = 0;
  for (const ref of sellAll(profile, items)) {
    const f = findToSell(profile, ref);
    if (typeof f !== 'string') n += sellPrice(items, f.item);
  }
  return n;
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
