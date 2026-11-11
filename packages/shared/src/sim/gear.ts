import { isArmouredRig, itemDef, type ItemDb } from '../content/items';
import {
  addItem,
  countOf,
  createGrid,
  takeFrom,
  type Grid,
  type Item,
  type Section,
} from '../inventory/grid';
import type { ArmourState } from './health';
import type { Character } from './state';
import type { WeaponState } from './weapons';

/** Sizes of the grids every player has. */
export const GEAR = {
  /**
   * Pockets, [width, height]: always there, lost on death like the rest. Five 1×1 slots
   * (POCKET_SECTIONS; the user's call, 2026-11-08, UX-3), so nothing bigger than 1×1 goes
   * in: a 4×1 grid until then.
   */
  pockets: [5, 1],
  /**
   * The vault: kept on death. Players only. This is its size with the Secure locker
   * unbuilt (H4: 2 wide, 1 tall); the locker grows it (PROFILE.vaults, vaultSize).
   */
  vault: [2, 1],
} as const;

/** The pockets' sections: one 1×1 slot per cell (see GEAR.pockets). */
export const POCKET_SECTIONS: readonly Section[] = Array.from(
  { length: GEAR.pockets[0] },
  (_, x) => ({ x, y: 0, w: 1, h: 1 }),
);

/** A new, empty pockets grid. */
export function createPockets(): Grid {
  return createGrid(GEAR.pockets[0], GEAR.pockets[1], false, POCKET_SECTIONS);
}

/**
 * The item every player's vault is shown as, equipped beside its grid (the user's call,
 * 2026-11-06). Only shown: the vault is still Gear.vault, a grid, so there's nothing to
 * move, drop or sell.
 */
export const VAULT_ITEM = 'small-vault';

/** A rig or backpack being worn. */
export interface ContainerState extends Item {
  grid: Grid;
}

/** The gear slots. */
export const GEAR_SLOTS = [
  'primary1',
  'primary2',
  'sidearm',
  'knife',
  'helmet',
  'bodyArmour',
  'rig',
  'backpack',
] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];

/** What can be in a character's hands: a gun slot, or the knife. */
export type Hand = 'primary1' | 'primary2' | 'sidearm' | 'knife';

/**
 * What a character carries. Plain JSON-safe data. Two primary guns (any gun), a sidearm
 * (pistols only), the knife, armour, a rig and a backpack, each holding one item or null;
 * pockets always; and, for players, the vault.
 */
export interface Gear {
  primary1: WeaponState | null;
  primary2: WeaponState | null;
  sidearm: WeaponState | null;
  knife: Item | null;
  /** What's in its hands. A gun slot that's empty means empty hands. */
  hand: Hand;
  helmet: ArmourState | null;
  bodyArmour: ArmourState | null;
  rig: ContainerState | null;
  backpack: ContainerState | null;
  pockets: Grid;
  /** Kept on death; null for enemies. */
  vault: Grid | null;
}

export function createGear(vault: boolean): Gear {
  return {
    primary1: null,
    primary2: null,
    sidearm: null,
    knife: null,
    hand: 'primary1',
    helmet: null,
    bodyArmour: null,
    rig: null,
    backpack: null,
    pockets: createPockets(),
    vault: vault ? createGrid(GEAR.vault[0], GEAR.vault[1]) : null,
  };
}

/** The gun in a character's hands, or null (empty hands or the knife). */
export function heldWeapon(c: Character): WeaponState | null {
  const g = c.gear;
  return g.hand === 'knife' ? null : g[g.hand];
}

/** Whether an item may go in a gear slot. */
export function fitsSlot(items: ItemDb, slot: GearSlot, item: Item): boolean {
  const def = itemDef(items, item.item);
  switch (slot) {
    case 'primary1':
    case 'primary2':
      // Pistols only go in the sidearm (the user's call, 2026-10-30).
      return def.type === 'weapon' && def.hold !== 'pistol';
    case 'sidearm':
      return def.type === 'weapon' && def.hold === 'pistol';
    case 'knife':
      return def.type === 'melee';
    case 'helmet':
      return def.type === 'armour' && def.slot === 'helmet';
    case 'bodyArmour':
      return def.type === 'armour' && def.slot === 'body';
    case 'rig':
    case 'backpack':
      return def.type === 'container' && def.slot === slot;
  }
}

/**
 * What covers the chest (2026-11-11): body armour, or else an armoured rig, which can't be
 * worn with it (gearConflict). Null with neither.
 */
export function chestArmour(items: ItemDb, gear: Gear): ArmourState | null {
  if (gear.bodyArmour) return gear.bodyArmour;
  const rig = gear.rig;
  return rig && isArmouredRig(itemDef(items, rig.item)) ? (rig as ArmourState) : null;
}

/** Why the body armour slot is shut while an armoured rig is worn (gearConflict). */
export const ARMOURED_RIG_WORN = 'Your rig is armoured: take it off to wear body armour';
/** Why an armoured rig can't go on over body armour (gearConflict). */
export const BODY_ARMOUR_WORN = 'Take off your body armour first: this rig is armoured';

/**
 * Why an item can't go in a slot it fits, given what else is worn (2026-11-11, the user's
 * call): body armour and an armoured rig never go together, and nothing is moved to make
 * room. Null if it can.
 */
export function gearConflict(items: ItemDb, gear: Gear, slot: GearSlot, item: Item): string | null {
  const def = itemDef(items, item.item);
  if (slot === 'bodyArmour' && def.type === 'armour') {
    const rig = gear.rig;
    if (rig && isArmouredRig(itemDef(items, rig.item))) return ARMOURED_RIG_WORN;
  }
  if (slot === 'rig' && isArmouredRig(def) && gear.bodyArmour) return BODY_ARMOUR_WORN;
  return null;
}

/**
 * Puts an item in a gear slot and returns what was there (or null) for the caller to put
 * somewhere. Throws if it doesn't fit, so check with fitsSlot first. Items made by
 * createItem have the fields their slot needs. Into the slot in its hands, it's drawn.
 */
export function equip(c: Character, items: ItemDb, slot: GearSlot, item: Item): Item | null {
  if (!fitsSlot(items, slot, item)) throw new Error(`"${item.item}" can't go in ${slot}`);
  const old = unequip(c, slot);
  (c.gear as unknown as Record<GearSlot, Item | null>)[slot] = item;
  if (slot === c.gear.hand) c.draw = drawTime(items, c.gear, slot);
  return old;
}

/** Empties a gear slot, returning what was in it. A gun taken from the hands stops reloading. */
export function unequip(c: Character, slot: GearSlot): Item | null {
  const g = c.gear as unknown as Record<GearSlot, Item | null>;
  const old = g[slot];
  g[slot] = null;
  if (old && slot === c.gear.hand) holster(old as WeaponState);
  return old;
}

/**
 * Takes out a gun slot or the knife, which takes its draw time. The gun put away stops
 * reloading, aiming starts over, and using a med stops. An empty slot is empty hands.
 */
export function switchHand(c: Character, items: ItemDb, hand: Hand): void {
  if (hand === c.gear.hand) return;
  const w = heldWeapon(c);
  if (w) holster(w);
  c.gear.hand = hand;
  c.aim = 0;
  c.draw = drawTime(items, c.gear, hand);
  c.using = null;
}

/** How long taking out what's in a hand slot takes; 0 for an empty one. */
export function drawTime(items: ItemDb, gear: Gear, hand: Hand): number {
  const it = gear[hand];
  if (!it) return 0;
  const def = itemDef(items, it.item);
  return def.type === 'weapon' || def.type === 'melee' ? def.drawTime : 0;
}

function holster(w: WeaponState): void {
  w.reloading = 0;
  w.triggerHeld = false;
  w.cooldown = 0;
}

/**
 * The grids a character carries things in that it can reach for ammo and meds, in the
 * order they're used: pockets, then rig, then backpack. Not the vault. i is 0 to 2; null
 * for a slot with nothing worn. Indexed rather than returned as a list, so a tick can
 * walk them without allocating.
 */
export function carriedGrid(gear: Gear, i: number): Grid | null {
  return i === 0
    ? gear.pockets
    : i === 1
      ? (gear.rig?.grid ?? null)
      : (gear.backpack?.grid ?? null);
}
export const CARRIED_GRIDS = 3;

/**
 * The first of carriedGrid's that quick actions reach: pockets and rig, as in Tarkov, not
 * the backpack (the user's call, 2026-11-01). A reload, the heal button and a throw take
 * from these; the inventory reaches the backpack by hand.
 */
export const QUICK_GRIDS = 2;

/** Rounds of an ammo item in reach for a reload: pockets and rig (not what's loaded). */
export function carriedAmmo(c: Character, ammo: string): number {
  let n = 0;
  for (let i = 0; i < QUICK_GRIDS; i++) {
    const grid = carriedGrid(c.gear, i);
    if (grid) n += countOf(grid, ammo);
  }
  return n;
}

/**
 * Takes up to n rounds from pockets, then rig (then backpack, with grids CARRIED_GRIDS).
 * Returns how many.
 */
export function takeAmmo(c: Character, ammo: string, n: number, grids = QUICK_GRIDS): number {
  let taken = 0;
  for (let i = 0; i < grids && taken < n; i++) {
    const grid = carriedGrid(c.gear, i);
    if (grid) taken += takeFrom(grid, ammo, n - taken);
  }
  return taken;
}

/**
 * Auto-places an item in what's carried: pockets, then rig, then backpack (not the
 * vault). Returns how many didn't fit, still in item.
 */
export function stow(c: Character, items: ItemDb, item: Item): number {
  let left = item.count;
  for (let i = 0; i < CARRIED_GRIDS && left > 0; i++) {
    const grid = carriedGrid(c.gear, i);
    if (grid) left = addItem(items, grid, item);
  }
  return left;
}
