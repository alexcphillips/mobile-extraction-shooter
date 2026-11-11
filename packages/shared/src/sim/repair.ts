import { armorOf, armorStatsOf, itemDef, type ArmorStats, type ItemDb } from '../content/items';
import type { Item } from '../inventory/grid';

/*
 * Armor repair kits (session 13b). A kit holds points of durability, spent across
 * repairs. Between raids a repair is done at once in the stash; in a raid it takes the
 * kit's use time, like a med (a 'repair' inventory action starts it, see looting.ts).
 *
 * Repairs wear down the most an armor piece can have, as in Delta Force (the user's
 * call, 2026-11-06): mending x of the durability it's missing takes x × its repairLoss
 * off its max and adds the rest, x × (1 − repairLoss), which is what the kit spends. A
 * full repair leaves it at its new, lower max. The max is Item.max, left out while it's
 * still the def's durability.
 */

export const REPAIR = {
  /** An armor's repairLoss when its item file doesn't give one. */
  loss: 0.1,
} as const;

/** The share of the durability mended that comes off an armor's max. */
export function repairLossOf(def: ArmorStats): number {
  return def.repairLoss ?? REPAIR.loss;
}

/** The most durability an armor piece can have now: its def's, less what repairs took. */
export function maxDurability(items: ItemDb, armor: Item): number {
  return armor.max ?? armorStatsOf(items, armor.item).durability;
}

/** How much a kit could restore to an armor piece now: 0 if either is used up or full. */
export function repairable(items: ItemDb, kit: Item, armor: Item): number {
  const k = itemDef(items, kit.item);
  // Armor, or an armored rig's (2026-11-11).
  const a = armorOf(itemDef(items, armor.item));
  if (k.type !== 'repair' || !a) return 0;
  const missing = maxDurability(items, armor) - (armor.durability ?? 0);
  // Not for what's left over from rounding a full repair.
  if (missing < 1e-6) return 0;
  return Math.max(0, Math.min(kit.left ?? 0, missing * (1 - repairLossOf(a))));
}

/**
 * Spends a kit's points on an armor piece, up to its new max (see above), which goes
 * down by what it costs. Returns the points spent (0 if nothing changed). The caller
 * removes a kit left with none.
 */
export function repairArmor(items: ItemDb, kit: Item, armor: Item): number {
  const n = repairable(items, kit, armor);
  if (n <= 0) return 0;
  const loss = repairLossOf(armorStatsOf(items, armor.item));
  // The durability that was missing that this mends: what's added, plus what's lost.
  const mended = n / (1 - loss);
  armor.max = maxDurability(items, armor) - mended * loss;
  armor.durability = (armor.durability ?? 0) + n;
  kit.left = (kit.left ?? 0) - n;
  return n;
}

/** Whether a kit has been spent and should go. */
export const kitUsedUp = (kit: Item): boolean => (kit.left ?? 0) <= 1e-9;
