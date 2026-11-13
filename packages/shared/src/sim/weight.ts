import { itemDef, weaponDef, type ItemDb } from '../content/items';
import type { Grid, Item } from '../inventory/grid';
import { GEAR_SLOTS, gearBurden, type Gear } from './gear';
import type { Character, SimState } from './state';
import { TICK_RATE } from '../tick';
import type { WeaponState } from './weapons';

/**
 * Weight and encumbrance (BW-3, 2026-11-12; design/movement.md → Weight). Every item has a
 * weight in kg; what a player wears, holds and carries adds up to a load that slows them
 * over WEIGHT.from and stops sprinting over WEIGHT.heavy, and makes their footsteps louder
 * or quieter about WEIGHT.reference. Players only: enemies ignore it. First guesses.
 */
export const WEIGHT = {
  /** Over this (kg), walking and sprinting slow down... */
  from: 25,
  /** ...evenly to `slowest` here, where sprinting stops. Heavier, no slower. */
  heavy: 45,
  slowest: 0.8,
  /**
   * Footsteps are as loud as before weight at this load: about the new-player kit's 18 kg,
   * so the AI's hearing keeps its balance.
   */
  reference: 18,
  /** Footstep noise with nothing carried, and the most it gets. Linear between. */
  quietest: 0.6,
  loudest: 1.6,
  /** Seconds between recounts when no inventory action came: ammo fired, meds used. */
  recount: 1,
} as const;

/** A gun's attachments, its magazine's rounds, a helmet's visor, a carrier's plates and a bag's contents count. */
export function itemWeight(items: ItemDb, item: Item): number {
  let kg = itemDef(items, item.item).weight * item.count;
  if (item.attachments) {
    for (const id of Object.values(item.attachments)) if (id) kg += itemDef(items, id).weight;
    const gun = item as WeaponState;
    if (gun.mag > 0) {
      const round = gun.loaded ?? weaponDef(items, gun.item).ammo;
      kg += gun.mag * itemDef(items, round).weight;
    }
  } else if (item.mag && item.loaded) {
    kg += item.mag * itemDef(items, item.loaded).weight;
  }
  if (item.fitted) kg += itemWeight(items, item.fitted);
  if (item.plates?.front) kg += itemWeight(items, item.plates.front);
  if (item.plates?.back) kg += itemWeight(items, item.plates.back);
  if (item.grid) kg += gridWeight(items, item.grid);
  return kg;
}

export function gridWeight(items: ItemDb, grid: Grid): number {
  let kg = 0;
  for (const g of grid.items) kg += itemWeight(items, g.item);
  return kg;
}

/** Everything worn, held and carried, the vault included. */
export function gearWeight(items: ItemDb, gear: Gear): number {
  let kg = gridWeight(items, gear.pockets);
  if (gear.vault) kg += gridWeight(items, gear.vault);
  for (const slot of GEAR_SLOTS) {
    const it = gear[slot];
    if (it) kg += itemWeight(items, it);
  }
  return kg;
}

/** Walking and sprinting speed for a load: 1 up to WEIGHT.from, down to WEIGHT.slowest at WEIGHT.heavy. */
export function loadSpeed(load: number): number {
  const k = Math.min(1, Math.max(0, (load - WEIGHT.from) / (WEIGHT.heavy - WEIGHT.from)));
  return 1 - (1 - WEIGHT.slowest) * k;
}

/** Whether a load is light enough to sprint. */
export function canSprint(load: number): boolean {
  return load <= WEIGHT.heavy;
}

/** Footstep noise for a load: 1 at WEIGHT.reference, quieter lighter, louder heavier. */
export function loadNoise(load: number): number {
  const k = WEIGHT.quietest + ((1 - WEIGHT.quietest) * load) / WEIGHT.reference;
  return Math.min(WEIGHT.loudest, k);
}

/** Recounts a player's load and its gear's burden (GZ-1) together. */
export function countLoad(items: ItemDb, c: Character): void {
  c.load = gearWeight(items, c.gear);
  c.burden = gearBurden(items, c.gear);
}

/**
 * Recounts players' loads (Character.load) every WEIGHT.recount seconds, and for anyone
 * with none yet; step() recounts a player after their inventory actions too. Never every
 * tick.
 */
export function updateLoads(state: SimState, items: ItemDb): void {
  const due = state.tick % Math.round(WEIGHT.recount * TICK_RATE) === 0;
  for (const e of state.entities) {
    if (e.ai || (!due && e.load !== undefined)) continue;
    countLoad(items, e);
  }
}
