import { itemDef, itemSize, type Item, type ItemDb } from '@mes/shared';
import type { ReactNode } from 'react';
import { itemPortrait } from '../render/item-portrait';
import { colorOf, tileName } from './raid-screen';

/*
 * An item as a small card outside the inventory (2026-11-06): the results screen's
 * brought-out and lost, a quest's rewards. Its picture on its rarity's color, its short
 * name, how many, and an optional line under it (a price).
 */
export function ItemTile({
  items,
  item,
  count = item.count,
  note,
  lost = false,
}: {
  items: ItemDb;
  item: Item;
  count?: number;
  note?: ReactNode;
  /** Gone (lost in a raid): grayed. */
  lost?: boolean;
}): ReactNode {
  const def = itemDef(items, item.item);
  const url = itemPortrait(items, item, itemSize(items, item));
  return (
    <span
      className={`item-tile${lost ? ' lost' : ''}`}
      style={{ ['--rarity' as string]: colorOf(def) }}
      title={def.name}
    >
      <span className="item-tile-art">
        {url && <img src={url} alt="" draggable={false} />}
        {count > 1 && <span className="item-tile-count">×{count.toLocaleString()}</span>}
      </span>
      <span className="item-tile-name">{tileName(def)}</span>
      {note !== undefined && <span className="item-tile-note">{note}</span>}
    </span>
  );
}

/** Items of the same kind as one tile with their count, dearest kinds first by `price`. */
export function tallied(
  list: readonly Item[],
  price: (item: Item) => number,
): { item: Item; count: number; price: number }[] {
  const by = new Map<string, { item: Item; count: number; price: number }>();
  for (const i of list) {
    const t = by.get(i.item);
    if (t) {
      t.count += i.count;
      t.price += price(i);
    } else by.set(i.item, { item: i, count: i.count, price: price(i) });
  }
  return [...by.values()].sort((a, b) => b.price - a.price);
}
