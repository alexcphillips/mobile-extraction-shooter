import { armourDef, type ArmourState, type ItemDb } from '@mes/shared';

export type ArmourCondition = 'good' | 'damaged' | 'low' | 'broken';

/** Below these fractions of full durability armour counts as damaged or low; at 0, broken. */
const DAMAGED = 0.75;
const LOW = 0.35;

export const CONDITION_COLOURS: Readonly<Record<ArmourCondition, string>> = {
  good: '#e8ecef',
  damaged: '#f1c40f',
  low: '#e67e22',
  broken: '#e74c3c',
};

export function armourCondition(a: ArmourState, items: ItemDb): ArmourCondition {
  const left = a.durability / armourDef(items, a.item).durability;
  return left <= 0 ? 'broken' : left < LOW ? 'low' : left < DAMAGED ? 'damaged' : 'good';
}

export function armourColour(a: ArmourState, items: ItemDb): string {
  return CONDITION_COLOURS[armourCondition(a, items)];
}
