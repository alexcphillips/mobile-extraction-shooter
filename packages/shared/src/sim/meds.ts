import { itemDef, type ItemDb, type MedEffect } from '../content/items';
import { removeAt } from '../inventory/grid';
import { TICK_SECONDS } from '../tick';
import { CARRIED_GRIDS, carriedGrid, heldWeapon } from './gear';
import {
  CHEST,
  HEAD,
  HEALTH,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_ARM,
  RIGHT_LEG,
  type Health,
  type Zone,
} from './health';
import { ownItem, type ItemRef } from './looting';
import { kitUsedUp, repairArmour } from './repair';
import type { Character, PlayerInput } from './state';

/** The fixed order meds treat zones in. There's no body diagram. */
export const TREATMENT_ORDER: readonly Zone[] = [
  HEAD,
  CHEST,
  LEFT_LEG,
  RIGHT_LEG,
  LEFT_ARM,
  RIGHT_ARM,
];

/**
 * The order the heal button picks in: bleeding first (it's the only thing that gets
 * worse by itself), then broken limbs (a splint, which is quick, before surgery), then
 * lost HP.
 */
export const EFFECT_PRIORITY: readonly MedEffect[] = ['bandage', 'splint', 'surgery', 'heal'];

const isLimb = (zone: Zone): boolean => zone !== HEAD && zone !== CHEST;

/** Whether an effect would do something for a zone. */
export function needs(h: Health, zone: Zone, effect: MedEffect): boolean {
  const hp = h.hp[zone]!;
  switch (effect) {
    case 'bandage':
      return h.bleeding[zone]!;
    case 'splint':
      return isLimb(zone) && hp <= 0 && !h.splinted[zone];
    case 'surgery':
      return isLimb(zone) && hp <= 0;
    case 'heal':
      return hp > 0 && hp < HEALTH.maxHp[zone]!;
  }
}

/** The first zone in TREATMENT_ORDER an effect would do something for, or -1. */
export function zoneToTreat(h: Health, effect: MedEffect): Zone | -1 {
  if (h.dead) return -1;
  for (const zone of TREATMENT_ORDER) if (needs(h, zone, effect)) return zone;
  return -1;
}

/** A carried item: which grid (0 to 2, see carriedGrid) and its index there. */
export interface CarriedRef {
  grid: number;
  index: number;
}

/**
 * A carried med as the heal button saw it: where it is, plus its item id, so a press that
 * has gone stale (the med moved or was used up) does nothing rather than use another item.
 */
export interface MedRef extends CarriedRef {
  item: string;
}

/**
 * A med being used: which one, and the seconds left until it takes effect. Or a repair
 * kit (session 13b), with the armour it's repairing.
 */
export interface MedUse extends MedRef {
  left: number;
  /** A repair kit's: the armour piece, as the sender saw it. */
  armour?: ItemRef;
}

/**
 * What the heal button can offer: the first carried med of each kind that would do
 * something now, best first by EFFECT_PRIORITY. A tap uses the first; a long press offers
 * them all. Empty when nothing's wrong or nothing carried helps. Not the vault.
 */
export function treatments(c: Character, items: ItemDb): MedRef[] {
  const out: MedRef[] = [];
  const seen = new Set<string>();
  for (const effect of EFFECT_PRIORITY) {
    if (zoneToTreat(c.health, effect) < 0) continue;
    for (let g = 0; g < CARRIED_GRIDS; g++) {
      const grid = carriedGrid(c.gear, g);
      if (!grid) continue;
      grid.items.forEach((gi, index) => {
        const def = itemDef(items, gi.item.item);
        if (def.type !== 'med' || def.effect !== effect || seen.has(def.id)) return;
        seen.add(def.id);
        out.push({ grid: g, index, item: def.id });
      });
    }
  }
  return out;
}

/**
 * Starts using a carried med, if it's still where the ref says and would do something
 * now. It takes effect after its use time (see updateMedUse). A reload stops. Returns
 * whether it started.
 */
export function startUse(c: Character, items: ItemDb, ref: MedRef): boolean {
  const it = carriedGrid(c.gear, ref.grid)?.items[ref.index]?.item;
  if (!it || it.item !== ref.item || c.health.dead) return false;
  const def = itemDef(items, it.item);
  if (def.type !== 'med' || zoneToTreat(c.health, def.effect) < 0) return false;
  const w = heldWeapon(c);
  if (w) w.reloading = 0;
  c.using = { grid: ref.grid, index: ref.index, item: ref.item, left: def.useTime };
  return true;
}

/**
 * One tick of using a med: a press starts or stops one; firing, reloading, sprinting or
 * climbing stops it; when its time is up it takes effect (useMed). If the med moved in
 * the meantime, the first carried one of the same item is used; if there's none, nothing
 * happens.
 */
export function updateMedUse(c: Character, items: ItemDb, input: PlayerInput | undefined): void {
  if (c.health.dead) {
    c.using = null;
    return;
  }
  if (input?.use === 'cancel') c.using = null;
  else if (input?.use) startUse(c, items, input.use);
  const u = c.using;
  if (!u) return;
  const sprinting = !!input?.sprint && input.moveY > 0 && !input.aim;
  if (input?.fire || input?.reload || sprinting || c.mode === 'ladder') {
    c.using = null;
    return;
  }
  u.left -= TICK_SECONDS;
  if (u.left > 1e-9) return;
  c.using = null;
  const still = carriedGrid(c.gear, u.grid)?.items[u.index]?.item.item === u.item;
  const ref = still ? u : firstCarried(c, u.item);
  if (!ref) return;
  if (u.armour) finishRepair(c, items, ref, u.armour);
  else useMed(c, items, ref);
}

/** A repair's time is up: the kit's points go into the armour, if it's still there. */
function finishRepair(c: Character, items: ItemDb, ref: CarriedRef, armourRef: ItemRef): void {
  const grid = carriedGrid(c.gear, ref.grid)!;
  const kit = grid.items[ref.index]!.item;
  const armour = ownItem(c.gear, armourRef);
  const points = kit.left ?? 0;
  if (!armour || repairArmour(items, kit, armour) <= 0) return;
  // The infinite consumables cheat gives the points back.
  if (c.admin?.infiniteConsumables) kit.left = points;
  else if (kitUsedUp(kit)) removeAt(grid, ref.index);
}

/** How long a med or repair kit takes to use. */
export function timeToUse(items: ItemDb, id: string): number {
  const def = itemDef(items, id);
  return def.type === 'med' || def.type === 'repair' ? def.useTime : 0;
}

/** Where the first carried item with this id is, or null. */
function firstCarried(c: Character, id: string): CarriedRef | null {
  for (let g = 0; g < CARRIED_GRIDS; g++) {
    const index = carriedGrid(c.gear, g)?.items.findIndex((gi) => gi.item.item === id) ?? -1;
    if (index >= 0) return { grid: g, index };
  }
  return null;
}

/**
 * Uses a carried med once: the effect of finishing its use (startUse and updateMedUse add
 * the use time and cancelling). A bandage, splint or surgery kit treats one zone, the first in
 * TREATMENT_ORDER that needs it; a heal restores HP down that order, skipping broken
 * limbs, until its pool or the damage runs out. Used up, it's removed (never, with the
 * infinite consumables cheat). Returns whether it did anything.
 */
export function useMed(c: Character, items: ItemDb, ref: CarriedRef): boolean {
  const grid = carriedGrid(c.gear, ref.grid);
  const it = grid?.items[ref.index]?.item;
  if (!grid || !it) return false;
  const def = itemDef(items, it.item);
  if (def.type !== 'med') return false;
  const h = c.health;
  const zone = zoneToTreat(h, def.effect);
  if (zone < 0) return false;

  let left = it.left ?? 1;
  switch (def.effect) {
    case 'bandage':
      h.bleeding[zone] = false;
      left--;
      break;
    case 'splint':
      h.splinted[zone] = true;
      left--;
      break;
    case 'surgery':
      h.hp[zone] = HEALTH.surgeryHp;
      h.splinted[zone] = false;
      left--;
      break;
    case 'heal':
      for (const z of TREATMENT_ORDER) {
        if (left <= 0) break;
        if (!needs(h, z, 'heal')) continue;
        const n = Math.min(left, HEALTH.maxHp[z]! - h.hp[z]!);
        h.hp[z]! += n;
        left -= n;
      }
      break;
  }
  // The infinite consumables cheat leaves it as it was.
  if (c.admin?.infiniteConsumables) return true;
  if (left <= 1e-9) removeAt(grid, ref.index);
  else it.left = left;
  return true;
}
