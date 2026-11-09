import { attachmentDef, weaponDef, type ItemDb } from '../content/items';
import type {
  ArmourOption,
  ContainerOption,
  GrenadeOption,
  LoadoutDef,
  MedOption,
} from '../content/enemies';
import { byWeight, nextFloat, nextRange, type Rng } from '../rng';
import { createItem } from './create-item';
import { createGear, equip, stow, type GearSlot } from './gear';
import { createArmour } from './health';
import type { Character } from './state';
import { giveWeapon } from './weapons';

/**
 * Rolls a loadout and equips a character with it, each part picked by weight on its own:
 * a gun with its attachments and a full magazine of its round (picked by weight, if it
 * lists rounds), taken out; armour, a rig and a backpack
 * (or none) in each slot; grenades (AI-6), stowed first so they're in reach to throw; and
 * spare rounds stowed in pockets, rig and backpack (what doesn't fit is left out). What it
 * always carries (`carried`, TU-2) is stowed before the grenades.
 * Replaces everything it had except the vault.
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
  const ammo = w.ammo?.length ? byWeight(rng, w.ammo).item : weaponDef(items, w.item).ammo;
  giveWeapon(c, items, w.item, attachments, ammo);
  c.gear.helmet = rollArmour(items, loadout.helmets, rng);
  c.gear.bodyArmour = rollArmour(items, loadout.bodyArmour, rng);
  rollContainer(c, items, 'rig', loadout.rigs, rng);
  rollContainer(c, items, 'backpack', loadout.backpacks, rng);
  for (const k of loadout.carried ?? [])
    for (let i = 0; i < (k.count ?? 1); i++) stow(c, items, createItem(items, k.item));
  rollGrenades(c, items, loadout.grenades, rng);
  for (const group of loadout.meds ?? []) rollGrenades(c, items, group, rng);
  if (spare > 0) stow(c, items, { item: ammo, count: spare });
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

/** One of options by weight, stowed: grenades, or a group of meds (the same shape). */
function rollGrenades(
  c: Character,
  items: ItemDb,
  options: readonly (GrenadeOption | MedOption)[] | undefined,
  rng: Rng,
): void {
  if (!options?.length) return;
  const o = byWeight(rng, options);
  if (o.item === null) return;
  const [min, max] = o.count ?? [1, 1];
  const n = min + Math.floor(nextFloat(rng) * (max - min + 1));
  for (let i = 0; i < n; i++) stow(c, items, createItem(items, o.item));
}
