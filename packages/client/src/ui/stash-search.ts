import { itemDef, type Grid, type Item, type ItemDb, type ItemDef } from '@mes/shared';

/*
 * Searching the stash (2026-11-05): what's typed picks out items by name. They stay where
 * they are, the rest dimmed, so a page keeps its layout and drags still land true.
 */

/** Item names use ×, which nobody types on a phone: "7.62x39" should find them. */
const normalize = (text: string): string => text.toLowerCase().replaceAll('×', 'x');

/** An item's name, and the names of what's fitted to it or stored in it. */
function namesOf(items: ItemDb, item: Item): string {
  const def = itemDef(items, item.item);
  // Its short name too: "m855" finds the 5.56 rounds whatever their full name says.
  const names = [def.name, def.shortName ?? ''];
  for (const part of Object.values(item.attachments ?? {})) {
    if (part !== null) names.push(itemDef(items, part).name);
  }
  for (const inside of item.grid?.items ?? []) names.push(namesOf(items, inside.item));
  return names.join(' ');
}

/**
 * The stash's category filters (2026-11-06, the user's call, as Delta Force's warehouse
 * has): each picks out kinds of item. "all" is no filter.
 */
export const CATEGORIES = [
  { id: 'all', label: 'All', types: [] },
  { id: 'guns', label: 'Guns', types: ['weapon', 'melee', 'attachment'] },
  { id: 'ammo', label: 'Ammo', types: ['ammo', 'grenade'] },
  { id: 'gear', label: 'Gear', types: ['armor', 'container'] },
  { id: 'meds', label: 'Meds', types: ['med', 'repair'] },
  { id: 'loot', label: 'Loot', types: ['loot', 'key', 'quest'] },
] as const satisfies readonly { id: string; label: string; types: readonly ItemDef['type'][] }[];
export type Category = (typeof CATEGORIES)[number]['id'];

/**
 * Whether an item is one being looked for, or null with nothing typed and no category.
 * Every word typed must be in the item's name, or a fitted part's or a stored item's
 * ("akm red" finds an AKM with a red dot on it; a backpack lights up for what's in it),
 * and it must be of the category's kinds.
 */
export function searcher(
  items: ItemDb,
  query: string,
  category: Category = 'all',
): ((item: Item) => boolean) | null {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const types: readonly string[] = CATEGORIES.find((c) => c.id === category)!.types;
  if (!words.length && !types.length) return null;
  return (item) => {
    if (types.length && !types.includes(itemDef(items, item.item).type)) return false;
    const names = normalize(namesOf(items, item));
    return words.every((w) => names.includes(w));
  };
}

/** How many of a grid's items are being looked for: a stack is one. */
export function countHits(grid: Grid, hit: (item: Item) => boolean): number {
  let n = 0;
  for (const g of grid.items) if (hit(g.item)) n++;
  return n;
}
