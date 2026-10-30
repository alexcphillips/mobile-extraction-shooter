import type { ItemDef } from '@mes/shared';

/** Ammo and armour levels 1–6 (Delta Force's tiers): grey, green, blue, purple, gold, red. */
export const LEVEL_COLOURS = ['#8d8f91', '#5c9a4a', '#4677b3', '#8a56b3', '#c99a2e', '#b8423a'];

/** An item's ammo or armour level, or null for items without one. */
export function levelOf(def: ItemDef): number | null {
  return def.type === 'ammo' || def.type === 'armour' ? def.level : null;
}

export function levelColour(level: number): string {
  return LEVEL_COLOURS[level - 1] ?? LEVEL_COLOURS[0]!;
}
