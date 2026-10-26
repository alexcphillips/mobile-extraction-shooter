import { attachmentDef, weaponDef, type ItemDb } from '../content/items';
import type { ArmourOption, ContainerOption, LoadoutDef } from '../content/enemies';
import { nextFloat, nextRange, type Rng } from '../rng';
import { createItem } from './create-item';
import { createGear, equip, stow, type GearSlot } from './gear';
import { createArmour } from './health';
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
 * Rolls a loadout and equips a character with it, each part picked by weight on its own:
 * a gun with its attachments and a full magazine, taken out; armour, a rig and a backpack
 * (or none) in each slot; and spare rounds stowed in pockets, rig and backpack (what
 * doesn't fit is left out). Replaces everything it had except the vault.
 */
export function equipLoadout(c: Character, items: ItemDb, loadout: LoadoutDef, rng: Rng): void {
  const vault = c.gear.vault;
  c.gear = createGear(false);
  c.gear.vault = vault;

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
  giveWeapon(c, items, w.item, attachments);
  c.gear.helmet = rollArmour(items, loadout.helmets, rng);
  c.gear.bodyArmour = rollArmour(items, loadout.bodyArmour, rng);
  rollContainer(c, items, 'rig', loadout.rigs, rng);
  rollContainer(c, items, 'backpack', loadout.backpacks, rng);
  if (spare > 0) stow(c, items, { item: weaponDef(items, w.item).ammo, count: spare });
}

function rollArmour(
  items: ItemDb,
  options: readonly ArmourOption[] | undefined,
  rng: Rng,
): Character['gear']['helmet'] {
  if (!options?.length) return null;
  const o = byWeight(rng, options);
  if (o.item === null) return null;
  const [min, max] = o.condition ?? [1, 1];
  return createArmour(items, o.item, nextRange(rng, min, max));
}

function rollContainer(
  c: Character,
  items: ItemDb,
  slot: GearSlot,
  options: readonly ContainerOption[] | undefined,
  rng: Rng,
): void {
  if (!options?.length) return;
  const o = byWeight(rng, options);
  if (o.item !== null) equip(c, items, slot, createItem(items, o.item));
}
