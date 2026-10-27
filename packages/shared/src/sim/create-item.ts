import { itemDef, type ItemDb } from '../content/items';
import { createGrid, type Item } from '../inventory/grid';
import { createArmour } from './health';
import { createWeapon } from './weapons';

/**
 * A new item with the fields its type needs: a gun with a full magazine and no
 * attachments, armour at full durability, an empty rig or backpack, a med, repair kit
 * or key unused. count is for items that stack (it isn't checked against the stack size).
 */
export function createItem(items: ItemDb, id: string, count = 1): Item {
  const def = itemDef(items, id);
  switch (def.type) {
    case 'weapon':
      return createWeapon(items, id);
    case 'armour':
      return createArmour(items, id);
    case 'container':
      return { item: id, count: 1, grid: createGrid(def.grid[0], def.grid[1]) };
    case 'med':
      return { item: id, count: 1, left: def.hp ?? def.uses ?? 1 };
    case 'repair':
      return { item: id, count: 1, left: def.points };
    case 'key':
      return def.uses === undefined ? { item: id, count } : { item: id, count, left: def.uses };
    default:
      return { item: id, count };
  }
}
