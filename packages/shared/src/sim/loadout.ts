import {
  attachmentDef,
  isArmoredRig,
  itemDef,
  magazineFed,
  weaponDef,
  type ItemDb,
} from '../content/items';
import type {
  ArmorOption,
  ContainerOption,
  GrenadeOption,
  LoadoutDef,
  MedOption,
} from '../content/enemies';
import { byWeight, nextFloat, nextRange, type Rng } from '../rng';
import { createItem } from './create-item';
import { createGear, equip, gearConflict, stow, type GearSlot } from './gear';
import { createArmor } from './health';
import type { Character } from './state';
import { giveWeapon, type WeaponState } from './weapons';

/**
 * Rolls a loadout and equips a character with it, each part picked by weight on its own:
 * a gun with its attachments and a full magazine of its round (picked by weight, if it
 * lists rounds), taken out; armor, a rig and a backpack
 * (or none) in each slot; grenades (AI-6), stowed first so they're in reach to throw; and
 * spare rounds stowed in pockets, rig and backpack (what doesn't fit is left out). What it
 * always carries (`carried`, TU-2) is stowed before the grenades.
 * Replaces everything it had except the vault.
 */
export function equipLoadout(
  c: Character,
  items: ItemDb,
  loadout: LoadoutDef,
  rng: Rng,
  /** Spare magazines for a magazine-fed gun (MG-3); false in zombies mode. */
  magazines = true,
): void {
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
  const gun = giveWeapon(c, items, w.item, attachments, ammo);
  c.gear.helmet = rollArmor(items, loadout.helmets, rng);
  // GZ-2: a headset, kept off under a helmet that covers the ears (the helmet wins).
  rollContainer(c, items, 'headset', loadout.headsets, rng);
  const headset = c.gear.headset;
  if (headset && gearConflict(items, c.gear, 'headset', headset)) c.gear.headset = null;
  c.gear.bodyArmor = rollArmor(items, loadout.bodyArmor, rng);
  rollContainer(c, items, 'rig', loadout.rigs, rng);
  // An armored rig is its chest armor (2026-11-11): body armor rolled too comes off. A
  // bulky carrier (GZ-4) keeps its place and the rig comes off instead.
  const rig = c.gear.rig;
  if (rig && gearConflict(items, c.gear, 'rig', rig)) {
    if (isArmoredRig(itemDef(items, rig.item))) c.gear.bodyArmor = null;
    else c.gear.rig = null;
  }
  rollContainer(c, items, 'backpack', loadout.backpacks, rng);
  for (const k of loadout.carried ?? [])
    for (let i = 0; i < (k.count ?? 1); i++) stow(c, items, createItem(items, k.item));
  rollGrenades(c, items, loadout.grenades, rng);
  // MG-3: spare magazines first, so they land in pockets and rig, in reach of a reload.
  const loose = spare - (magazines ? stowMagazines(c, items, gun, ammo, spare) : 0);
  for (const group of loadout.meds ?? []) rollGrenades(c, items, group, rng);
  if (loose > 0) stow(c, items, { item: ammo, count: loose });
}

/** How many full spare magazines an enemy carries (MG-3): 3, or 4 with rounds for 5. */
export const SPARE_MAGAZINES = { few: 3, many: 4 };

/**
 * A magazine-fed gun's spare magazines (MG-3): of the kind fitted, full of its round, 3 or
 * 4 (4 with rounds for 5 or more), as many as the spare rounds fill. Returns the rounds
 * they took; the rest go loose. Nothing for other guns.
 */
function stowMagazines(
  c: Character,
  items: ItemDb,
  gun: WeaponState,
  ammo: string,
  spare: number,
): number {
  const id = gun.attachments.magazine;
  if (!id || !magazineFed(weaponDef(items, gun.item))) return 0;
  const cap = attachmentDef(items, id).capacity ?? 0;
  if (cap <= 0) return 0;
  const want = spare >= cap * 5 ? SPARE_MAGAZINES.many : SPARE_MAGAZINES.few;
  const n = Math.min(want, Math.floor(spare / cap));
  let took = 0;
  for (let i = 0; i < n; i++) {
    const m = { ...createItem(items, id), mag: cap, loaded: ammo };
    if (stow(c, items, m) > 0) break;
    took += cap;
  }
  return took;
}

function rollArmor(
  items: ItemDb,
  options: readonly ArmorOption[] | undefined,
  rng: Rng,
): Character['gear']['helmet'] {
  if (!options?.length) return null;
  const o = byWeight(rng, options);
  if (o.item === null) return null;
  const [min, max] = o.condition ?? [1, 1];
  const condition = nextRange(rng, min, max);
  const armor = createArmor(items, o.item, condition);
  // GZ-5: a visor or goggles on the helmet; a visor as worn as the helmet.
  if (o.fitted?.length) {
    const f = byWeight(rng, o.fitted);
    if (f.item !== null)
      armor.fitted =
        itemDef(items, f.item).type === 'visor'
          ? createArmor(items, f.item, condition)
          : createItem(items, f.item);
  }
  return armor;
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
