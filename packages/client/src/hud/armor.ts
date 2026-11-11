import { armorStatsOf, type ArmorState, type ItemDb } from '@mes/shared';

export type ArmorCondition = 'good' | 'damaged' | 'low' | 'broken';

/** Below these fractions of full durability armor counts as damaged or low; at 0, broken. */
const DAMAGED = 0.75;
const LOW = 0.35;

export const CONDITION_COLORS: Readonly<Record<ArmorCondition, string>> = {
  good: '#e8ecef',
  damaged: '#f1c40f',
  low: '#e67e22',
  broken: '#e74c3c',
};

export function armorCondition(a: ArmorState, items: ItemDb): ArmorCondition {
  const left = a.durability / armorStatsOf(items, a.item).durability;
  return left <= 0 ? 'broken' : left < LOW ? 'low' : left < DAMAGED ? 'damaged' : 'good';
}

export function armorColor(a: ArmorState, items: ItemDb): string {
  return CONDITION_COLORS[armorCondition(a, items)];
}
