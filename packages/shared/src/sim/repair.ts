import { itemDef, type ItemDb } from '../content/items';
import type { Item } from '../inventory/grid';

/*
 * Armour repair kits (session 13b). A kit holds points of durability, spent across
 * repairs. Between raids a repair is done at once in the stash; in a raid it takes the
 * kit's use time, like a med (a 'repair' inventory action starts it, see looting.ts).
 * Repairs bring armour back to full: there's no wear on the most it can have.
 */

/** How much a kit could restore to an armour piece now: 0 if either is used up or full. */
export function repairable(items: ItemDb, kit: Item, armour: Item): number {
  const k = itemDef(items, kit.item);
  const a = itemDef(items, armour.item);
  if (k.type !== 'repair' || a.type !== 'armour') return 0;
  return Math.max(0, Math.min(kit.left ?? 0, a.durability - (armour.durability ?? 0)));
}

/**
 * Spends a kit's points on an armour piece, up to its full durability. Returns the points
 * spent (0 if nothing changed). The caller removes a kit left with none.
 */
export function repairArmour(items: ItemDb, kit: Item, armour: Item): number {
  const n = repairable(items, kit, armour);
  if (n <= 0) return 0;
  armour.durability = (armour.durability ?? 0) + n;
  kit.left = (kit.left ?? 0) - n;
  return n;
}

/** Whether a kit has been spent and should go. */
export const kitUsedUp = (kit: Item): boolean => (kit.left ?? 0) <= 1e-9;
