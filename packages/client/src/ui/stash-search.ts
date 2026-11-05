import { itemDef, type Grid, type Item, type ItemDb } from '@mes/shared';

/*
 * Searching the stash (2026-11-05): what's typed picks out items by name. They stay where
 * they are, the rest dimmed, so a page keeps its layout and drags still land true.
 */

/** Item names use ×, which nobody types on a phone: "7.62x39" should find them. */
const normalise = (text: string): string => text.toLowerCase().replaceAll('×', 'x');

/** An item's name, and the names of what's fitted to it or stored in it. */
function namesOf(items: ItemDb, item: Item): string {
  const names = [itemDef(items, item.item).name];
  for (const part of Object.values(item.attachments ?? {})) {
    if (part !== null) names.push(itemDef(items, part).name);
  }
  for (const inside of item.grid?.items ?? []) names.push(namesOf(items, inside.item));
  return names.join(' ');
}

/**
 * Whether an item is one being looked for, or null with nothing typed. Every word typed
 * must be in the item's name, or a fitted part's or a stored item's ("akm red" finds an
 * AKM with a red dot on it; a backpack lights up for what's in it).
 */
export function searcher(items: ItemDb, query: string): ((item: Item) => boolean) | null {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return (item) => {
    const names = normalise(namesOf(items, item));
    return words.every((w) => names.includes(w));
  };
}

/** How many of a grid's items are being looked for: a stack is one. */
export function countHits(grid: Grid, hit: (item: Item) => boolean): number {
  let n = 0;
  for (const g of grid.items) if (hit(g.item)) n++;
  return n;
}
