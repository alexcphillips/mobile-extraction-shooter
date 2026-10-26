import { itemDef, type ItemDb, type MedEffect } from '../content/items';
import { removeAt } from '../inventory/grid';
import { CARRIED_GRIDS, carriedGrid } from './gear';
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
import type { Character } from './state';

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
 * What the heal button can offer: the first carried med of each kind that would do
 * something now, best first by EFFECT_PRIORITY. A tap uses the first; a long press offers
 * them all. Empty when nothing's wrong or nothing carried helps. Not the vault.
 */
export function treatments(c: Character, items: ItemDb): CarriedRef[] {
  const out: CarriedRef[] = [];
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
        out.push({ grid: g, index });
      });
    }
  }
  return out;
}

/**
 * Uses a carried med once: the effect of finishing its use (session 10 adds the use time
 * and cancelling). A bandage, splint or surgery kit treats one zone, the first in
 * TREATMENT_ORDER that needs it; a heal restores HP down that order, skipping broken
 * limbs, until its pool or the damage runs out. Used up, it's removed. Returns whether it
 * did anything.
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
  if (left <= 1e-9) removeAt(grid, ref.index);
  else it.left = left;
  return true;
}
