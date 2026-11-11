import { RARITIES, itemDef, type ItemDb, type ItemDef } from '../content/items';
import { addItem, type Grid, type GridItem, type Item } from './grid';

/*
 * Sorting a stash page (2026-11-06, the user's call, as Delta Force's warehouse does):
 * everything comes out and goes back in, packed from the top left in the order asked
 * for, stacks of the same thing topped up on the way.
 */

/** What a sort orders by: kind of item, rarity (rarest first), or value (dearest first). */
export type SortKey = 'type' | 'rarity' | 'value';

/** Kinds of item in the order a sort by type puts them. */
const TYPE_ORDER: readonly ItemDef['type'][] = [
  'weapon',
  'melee',
  'attachment',
  'ammo',
  'grenade',
  'armor',
  'container',
  'med',
  'repair',
  'key',
  'quest',
  'loot',
];

/**
 * Sorts a grid's items by key, then bigger first (so they pack well), then by name.
 * Works on a copy: if the sorted items wouldn't all fit, the grid is left as it was and
 * it returns false.
 */
export function sortGrid(items: ItemDb, grid: Grid, by: SortKey): boolean {
  // A copy to work on: grids and items are plain JSON (the profile's shape).
  const list = (JSON.parse(JSON.stringify(grid.items)) as GridItem[]).map((g) => g.item);
  const def = (item: Item): ItemDef => itemDef(items, item.item);
  const rank = (item: Item): number => {
    const d = def(item);
    if (by === 'type') return TYPE_ORDER.indexOf(d.type);
    if (by === 'rarity') return -RARITIES.indexOf(d.rarity);
    return -d.value;
  };
  const area = (item: Item): number => def(item).size[0] * def(item).size[1];
  list.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      area(b) - area(a) ||
      def(a).name.localeCompare(def(b).name) ||
      b.count - a.count,
  );
  const trial: Grid = { ...grid, items: [] };
  for (const item of list) if (addItem(items, trial, item) > 0) return false;
  grid.items = trial.items;
  return true;
}
