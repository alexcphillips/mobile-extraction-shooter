import { itemDef, sectionsOf, type ItemDb } from '../content/items';
import { createGrid, type Item } from '../inventory/grid';
import { createArmor, withPlates } from './health';
import { createWeapon } from './weapons';

/**
 * A new item with the fields its type needs: a gun with a full magazine and no
 * attachments, armor at full durability, an empty rig or backpack, a med, repair kit
 * or key unused. count is for items that stack (it isn't checked against the stack size).
 */
export function createItem(items: ItemDb, id: string, count = 1): Item {
  const def = itemDef(items, id);
  switch (def.type) {
    case 'weapon':
      return createWeapon(items, id);
    case 'armor':
      return createArmor(items, id);
    case 'plate':
      return createArmor(items, id);
    case 'visor':
      // A seed for where its cracks run (GZ-5, the client's): looks only, so not the sim's RNG.
      return { ...createArmor(items, id), seed: Math.floor(Math.random() * 1e9) };
    case 'container': {
      const grid = createGrid(def.grid[0], def.grid[1], false, sectionsOf(def));
      // A backpack takes empty rigs and backpacks (see Grid.bags).
      if (def.slot === 'backpack') grid.bags = true;
      // An armored rig at full durability, as armor (2026-11-11).
      if (def.armor)
        return withPlates(items, { item: id, count: 1, grid, durability: def.armor.durability });
      return { item: id, count: 1, grid };
    }
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
