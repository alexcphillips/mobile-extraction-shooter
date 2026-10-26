import { itemDef, type ItemDb } from '../content/items';
import { addItem, countOf, createGrid, takeFrom, type Grid, type Item } from '../inventory/grid';
import type { ArmourState } from './health';
import type { Character } from './state';
import type { WeaponState } from './weapons';

/** Sizes of the grids every player has. */
export const GEAR = {
  /** Pockets, [width, height]: always there, lost on death like the rest. */
  pockets: [4, 1],
  /** The vault: kept on death. Players only. */
  vault: [2, 3],
} as const;

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
    pockets: createGrid(GEAR.pockets[0], GEAR.pockets[1]),
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
      return def.type === 'weapon';
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
 * Puts an item in a gear slot and returns what was there (or null) for the caller to put
 * somewhere. Throws if it doesn't fit, so check with fitsSlot first. Items made by
 * createItem have the fields their slot needs.
 */
export function equip(c: Character, items: ItemDb, slot: GearSlot, item: Item): Item | null {
  if (!fitsSlot(items, slot, item)) throw new Error(`"${item.item}" can't go in ${slot}`);
  const old = unequip(c, slot);
  (c.gear as unknown as Record<GearSlot, Item | null>)[slot] = item;
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
 * Takes out a gun slot or the knife. The gun put away stops reloading and aiming starts
 * over. Drawing takes no time yet (session 10).
 */
export function switchHand(c: Character, hand: Hand): void {
  if (hand === c.gear.hand) return;
  const w = heldWeapon(c);
  if (w) holster(w);
  c.gear.hand = hand;
  c.aim = 0;
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

/** Rounds of an ammo item carried (not counting the vault or what's loaded). */
export function carriedAmmo(c: Character, ammo: string): number {
  let n = 0;
  for (let i = 0; i < CARRIED_GRIDS; i++) {
    const grid = carriedGrid(c.gear, i);
    if (grid) n += countOf(grid, ammo);
  }
  return n;
}

/** Takes up to n rounds from what's carried, pockets first. Returns how many. */
export function takeAmmo(c: Character, ammo: string, n: number): number {
  let taken = 0;
  for (let i = 0; i < CARRIED_GRIDS && taken < n; i++) {
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
