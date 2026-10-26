import { armourDef, attachmentDef, type ItemDb } from '../content/items';
import type { ArmourOption, LoadoutDef } from '../content/enemies';
import { nextFloat, nextRange, type Rng } from '../rng';
import type { Character } from './state';
import { giveWeapon } from './weapons';

/** Picks one option by weight. */
function byWeight<T extends { weight: number }>(rng: Rng, options: readonly T[]): T {
  let total = 0;
  for (const o of options) total += o.weight;
  let roll = nextFloat(rng) * total;
  for (const o of options) {
    roll -= o.weight;
    if (roll < 0) return o;
  }
  return options[options.length - 1]!;
}

/**
 * Rolls a loadout and equips a character with it: a gun with its attachments, a full
 * magazine and spare rounds, and armour (or none) in each slot, each part picked by weight
 * on its own. Replaces whatever it had.
 */
export function equipLoadout(c: Character, items: ItemDb, loadout: LoadoutDef, rng: Rng): void {
  const w = byWeight(rng, loadout.weapons);
  const taken = new Set<string>();
  const attachments: string[] = [];
  for (const a of w.attachments ?? []) {
    const slot = attachmentDef(items, a.item).slot;
    if (taken.has(slot) || nextFloat(rng) >= (a.chance ?? 1)) continue;
    taken.add(slot);
    attachments.push(a.item);
  }
  const spare = Math.round(nextRange(rng, w.spare[0], w.spare[1]));
  giveWeapon(c, items, w.item, spare, attachments);
  c.helmet = rollArmour(items, loadout.helmets, rng);
  c.bodyArmour = rollArmour(items, loadout.bodyArmour, rng);
}

function rollArmour(
  items: ItemDb,
  options: readonly ArmourOption[] | undefined,
  rng: Rng,
): Character['helmet'] {
  if (!options?.length) return null;
  const o = byWeight(rng, options);
  if (o.item === null) return null;
  const [min, max] = o.condition ?? [1, 1];
  return {
    item: o.item,
    durability: armourDef(items, o.item).durability * nextRange(rng, min, max),
  };
}
