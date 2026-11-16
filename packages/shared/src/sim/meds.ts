import {
  itemDef,
  type ItemDb,
  type ItemDef,
  type MedEffect,
  type PlateSide,
} from '../content/items';
import { removeAt } from '../inventory/grid';
import { TICK_SECONDS } from '../tick';
import { CARRIED_GRIDS, QUICK_GRIDS, carriedGrid, heldWeapon } from './gear';
import {
  CHEST,
  HEAD,
  HEALTH,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_ARM,
  RIGHT_LEG,
  STOMACH,
  isBleeding,
  isLimb,
  isVital,
  type Health,
  type Zone,
} from './health';
import { insertPlate, reachableItem, type ItemRef } from './looting';
import { kitUsedUp, repairArmor } from './repair';
import type { Character, PlayerInput, SimState } from './state';

/**
 * The order meds treat zones in when none is chosen (a tap on the heal button, the AI, the
 * inventory's Use). The heal button's body picker can choose a zone instead (2026-11-15).
 */
export const TREATMENT_ORDER: readonly Zone[] = [
  HEAD,
  CHEST,
  STOMACH,
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

/** Whether an effect would do something for a zone. */
export function needs(h: Health, zone: Zone, effect: MedEffect): boolean {
  const hp = h.hp[zone]!;
  switch (effect) {
    case 'bandage':
      return h.bleeding[zone]!;
    case 'splint':
      return isLimb(zone) && hp <= 0 && !h.splinted[zone];
    case 'surgery':
      // A broken limb or a blacked stomach (GZ-3).
      return !isVital(zone) && hp <= 0;
    case 'heal':
      return hp > 0 && hp < HEALTH.maxHp[zone]!;
  }
}

/** Whether a heal stops bleeding too (bleedCost), and there's bleeding to stop. */
function stopsBleeding(h: Health, def: ItemDef): boolean {
  return def.type === 'med' && def.bleedCost !== undefined && !h.dead && isBleeding(h);
}

/** Whether a med would do something now: its effect, or a heal stopping a bleed. */
export function medHelps(h: Health, def: ItemDef): boolean {
  if (def.type !== 'med') return false;
  return zoneToTreat(h, def.effect) >= 0 || stopsBleeding(h, def);
}

/** Whether a zone index (as a guest sent it) is a real zone. */
function isZone(zone: unknown): zone is Zone {
  return (
    Number.isInteger(zone) && (zone as number) >= 0 && (zone as number) < TREATMENT_ORDER.length
  );
}

/** Whether a med would do something for this one zone: its effect, or a heal stopping its bleed. */
export function medHelpsZone(h: Health, def: ItemDef, zone: Zone): boolean {
  if (def.type !== 'med' || h.dead) return false;
  return needs(h, zone, def.effect) || (def.bleedCost !== undefined && h.bleeding[zone]!);
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
  /** The zone chosen in the heal button's body picker; left out, the med picks (TREATMENT_ORDER). */
  zone?: Zone;
}

/**
 * A med being used: which one, and the seconds left until it takes effect. Or a repair
 * kit (session 13b), with the armor it's repairing.
 */
export interface MedUse extends MedRef {
  left: number;
  /** A repair kit's: the armor piece, as the sender saw it. */
  armor?: ItemRef;
  /** A plate going into a carrier (GZ-4): which, and which slot. */
  plate?: { carrier: ItemRef; side: PlateSide };
}

/**
 * What the heal button can offer: the first med in reach (pockets, then rig: QUICK_GRIDS)
 * of each kind that would do something now, best first by EFFECT_PRIORITY. A tap uses the
 * first; a long press offers them all. Empty when nothing's wrong or nothing in reach
 * helps. A med in the backpack is used from the inventory instead (startUse takes any
 * carried grid).
 */
export function treatments(c: Character, items: ItemDb): MedRef[] {
  const out: MedRef[] = [];
  const seen = new Set<string>();
  for (const effect of EFFECT_PRIORITY) {
    if (zoneToTreat(c.health, effect) < 0) continue;
    for (let g = 0; g < QUICK_GRIDS; g++) {
      const grid = carriedGrid(c.gear, g);
      if (!grid) continue;
      grid.items.forEach((gi, index) => {
        const def = itemDef(items, gi.item.item);
        if (def.type !== 'med' || seen.has(def.id)) return;
        // A heal that stops bleeding is offered for bleeding too, after the bandages.
        const fits = def.effect === effect || (effect === 'bandage' && def.bleedCost !== undefined);
        if (!fits) return;
        seen.add(def.id);
        out.push({ grid: g, index, item: def.id });
      });
    }
  }
  return out;
}

/**
 * What the body picker offers for one zone: the first med in reach of each kind that would
 * do something for it, best first (as treatments: bandages, then heals that stop a bleed,
 * splint, surgery, heal). Each ref carries the zone.
 */
export function treatmentsFor(c: Character, items: ItemDb, zone: Zone): MedRef[] {
  const out: MedRef[] = [];
  const h = c.health;
  if (h.dead) return out;
  const seen = new Set<string>();
  for (const effect of EFFECT_PRIORITY) {
    const bleed = effect === 'bandage' && h.bleeding[zone]!;
    if (!bleed && !needs(h, zone, effect)) continue;
    for (let g = 0; g < QUICK_GRIDS; g++) {
      const grid = carriedGrid(c.gear, g);
      if (!grid) continue;
      grid.items.forEach((gi, index) => {
        const def = itemDef(items, gi.item.item);
        if (def.type !== 'med' || seen.has(def.id)) return;
        const fits = def.effect === effect || (bleed && def.bleedCost !== undefined);
        if (!fits) return;
        seen.add(def.id);
        out.push({ grid: g, index, item: def.id, zone });
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
  if (def.type !== 'med') return false;
  const zone = ref.zone;
  if (zone !== undefined && !isZone(zone)) return false;
  if (zone === undefined ? !medHelps(c.health, def) : !medHelpsZone(c.health, def, zone))
    return false;
  const w = heldWeapon(c);
  if (w) w.reloading = 0;
  c.using = { grid: ref.grid, index: ref.index, item: ref.item, left: def.useTime };
  if (zone !== undefined) c.using.zone = zone;
  return true;
}

/**
 * One tick of using a med: a press starts or stops one; firing, reloading, climbing or
 * putting yourself out stops it (moving and sprinting don't: you walk slowly, 2026-11-10); when its time is up it takes effect (useMed). If the med moved in
 * the meantime, the first carried one of the same item is used; if there's none, nothing
 * happens.
 */
export function updateMedUse(
  state: SimState,
  c: Character,
  items: ItemDb,
  input: PlayerInput | undefined,
): void {
  if (c.health.dead) {
    c.using = null;
    return;
  }
  if (input?.use === 'cancel') c.using = null;
  else if (input?.use) startUse(c, items, input.use);
  const u = c.using;
  if (!u) return;
  if (input?.fire || input?.reload || c.mode === 'ladder' || c.mode === 'vault') {
    c.using = null;
    return;
  }
  u.left -= TICK_SECONDS;
  if (u.left > 1e-9) return;
  c.using = null;
  const still = carriedGrid(c.gear, u.grid)?.items[u.index]?.item.item === u.item;
  const found = still ? u : firstCarried(c, u.item);
  if (!found) return;
  const ref: CarriedRef & { zone?: Zone } = found;
  if (!still && u.zone !== undefined) ref.zone = u.zone;
  if (u.plate) {
    const grid = carriedGrid(c.gear, ref.grid)!;
    const carrier = reachableItem(state, c, u.plate.carrier);
    if (carrier) insertPlate(state, c, items, carrier, u.plate.side, grid, ref.index);
  } else if (u.armor) finishRepair(state, c, items, ref, u.armor);
  else useMed(c, items, ref);
}

/**
 * A repair's time is up: the kit's points go into the armor, if it's still there and in
 * reach (a body's or a crate's: walked away, nothing happens).
 */
function finishRepair(
  state: SimState,
  c: Character,
  items: ItemDb,
  ref: CarriedRef,
  armorRef: ItemRef,
): void {
  const grid = carriedGrid(c.gear, ref.grid)!;
  const kit = grid.items[ref.index]!.item;
  const armor = reachableItem(state, c, armorRef);
  const points = kit.left ?? 0;
  if (!armor || repairArmor(items, kit, armor) <= 0) return;
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
 * the use time and canceling). With a zone (chosen in the body picker) it treats only that
 * zone: a heal stops its bleed (bleedCost) and restores its HP, keeping the rest of the pool;
 * if the zone no longer needs it, nothing is used. Without one, a bandage, splint or surgery
 * kit treats one zone, the first in TREATMENT_ORDER that needs it; a heal restores HP down that order, skipping broken
 * limbs, until its pool or the damage runs out. A heal with a bleedCost first stops every
 * bleeding zone, down the same order, for that much of its pool each. Used up, it's removed (never, with the
 * infinite consumables cheat). Returns whether it did anything.
 */
export function useMed(c: Character, items: ItemDb, ref: CarriedRef & { zone?: Zone }): boolean {
  const grid = carriedGrid(c.gear, ref.grid);
  const it = grid?.items[ref.index]?.item;
  if (!grid || !it) return false;
  const def = itemDef(items, it.item);
  if (def.type !== 'med') return false;
  const h = c.health;
  const chosen = ref.zone;
  if (chosen !== undefined) {
    if (!isZone(chosen) || !medHelpsZone(h, def, chosen)) return false;
    let left = it.left ?? 1;
    if (def.effect === 'heal') {
      if (def.bleedCost !== undefined && h.bleeding[chosen]) {
        h.bleeding[chosen] = false;
        left -= Math.min(left, def.bleedCost);
      }
      if (needs(h, chosen, 'heal')) {
        const n = Math.min(left, HEALTH.maxHp[chosen]! - h.hp[chosen]!);
        h.hp[chosen]! += n;
        left -= n;
      }
    } else {
      treatOne(h, def.effect, chosen);
      left--;
    }
    return spend(c, grid, ref.index, it, left);
  }
  const zone = zoneToTreat(h, def.effect);
  const bleeds = def.effect === 'heal' && stopsBleeding(h, def);
  if (zone < 0 && !bleeds) return false;

  let left = it.left ?? 1;
  switch (def.effect) {
    case 'bandage':
    case 'splint':
    case 'surgery':
      treatOne(h, def.effect, zone as Zone);
      left--;
      break;
    case 'heal':
      if (bleeds)
        for (const z of TREATMENT_ORDER) {
          if (left <= 0) break;
          if (!h.bleeding[z]) continue;
          h.bleeding[z] = false;
          left -= Math.min(left, def.bleedCost!);
        }
      for (const z of TREATMENT_ORDER) {
        if (left <= 0) break;
        if (!needs(h, z, 'heal')) continue;
        const n = Math.min(left, HEALTH.maxHp[z]! - h.hp[z]!);
        h.hp[z]! += n;
        left -= n;
      }
      break;
  }
  return spend(c, grid, ref.index, it, left);
}

/** A bandage, splint or surgery kit's one use on a zone. */
function treatOne(h: Health, effect: Exclude<MedEffect, 'heal'>, zone: Zone): void {
  if (effect === 'bandage') h.bleeding[zone] = false;
  else if (effect === 'splint') h.splinted[zone] = true;
  else {
    h.hp[zone] = HEALTH.surgeryHp;
    h.splinted[zone] = false;
  }
}

/**
 * What's left of a med after a use: removed when used up, else its pool or uses kept (the
 * infinite consumables cheat leaves it as it was). Returns true: it did something.
 */
function spend(
  c: Character,
  grid: NonNullable<ReturnType<typeof carriedGrid>>,
  index: number,
  it: { left?: number },
  left: number,
): boolean {
  if (c.admin?.infiniteConsumables) return true;
  if (left <= 1e-9) removeAt(grid, index);
  else it.left = left;
  return true;
}
