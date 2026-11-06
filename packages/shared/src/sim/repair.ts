import { armourDef, itemDef, type ArmourDef, type ItemDb } from '../content/items';
import type { Item } from '../inventory/grid';

/*
 * Armour repair kits (session 13b). A kit holds points of durability, spent across
 * repairs. Between raids a repair is done at once in the stash; in a raid it takes the
 * kit's use time, like a med (a 'repair' inventory action starts it, see looting.ts).
 *
 * Repairs wear down the most an armour piece can have, as in Delta Force (the user's
 * call, 2026-11-06): mending x of the durability it's missing takes x × its repairLoss
 * off its max and adds the rest, x × (1 − repairLoss), which is what the kit spends. A
 * full repair leaves it at its new, lower max. The max is Item.max, left out while it's
 * still the def's durability.
 */

export const REPAIR = {
  /** An armour's repairLoss when its item file doesn't give one. */
  loss: 0.1,
} as const;

/** The share of the durability mended that comes off an armour's max. */
export function repairLossOf(def: ArmourDef): number {
  return def.repairLoss ?? REPAIR.loss;
}

/** The most durability an armour piece can have now: its def's, less what repairs took. */
export function maxDurability(items: ItemDb, armour: Item): number {
  return armour.max ?? armourDef(items, armour.item).durability;
}

/** How much a kit could restore to an armour piece now: 0 if either is used up or full. */
export function repairable(items: ItemDb, kit: Item, armour: Item): number {
  const k = itemDef(items, kit.item);
  const a = itemDef(items, armour.item);
  if (k.type !== 'repair' || a.type !== 'armour') return 0;
  const missing = maxDurability(items, armour) - (armour.durability ?? 0);
  // Not for what's left over from rounding a full repair.
  if (missing < 1e-6) return 0;
  return Math.max(0, Math.min(kit.left ?? 0, missing * (1 - repairLossOf(a))));
}

/**
 * Spends a kit's points on an armour piece, up to its new max (see above), which goes
 * down by what it costs. Returns the points spent (0 if nothing changed). The caller
 * removes a kit left with none.
 */
export function repairArmour(items: ItemDb, kit: Item, armour: Item): number {
  const n = repairable(items, kit, armour);
  if (n <= 0) return 0;
  const loss = repairLossOf(armourDef(items, armour.item));
  // The durability that was missing that this mends: what's added, plus what's lost.
  const mended = n / (1 - loss);
  armour.max = maxDurability(items, armour) - mended * loss;
  armour.durability = (armour.durability ?? 0) + n;
  kit.left = (kit.left ?? 0) - n;
  return n;
}

/** Whether a kit has been spent and should go. */
export const kitUsedUp = (kit: Item): boolean => (kit.left ?? 0) <= 1e-9;
