import type { ItemDef } from '@mes/shared';

/** Ammo and armor levels 1–6 (design.md → Damage): gray, green, blue, purple, gold, red. */
export const LEVEL_COLORS = ['#8d8f91', '#5c9a4a', '#4677b3', '#8a56b3', '#c99a2e', '#b8423a'];

/** An item's ammo or armor level (an armored rig's too), or null for items without one. */
export function levelOf(def: ItemDef): number | null {
  if (def.type === 'ammo' || def.type === 'armor') return def.level;
  return def.type === 'container' ? (def.armor?.level ?? null) : null;
}

export function levelColor(level: number): string {
  return LEVEL_COLORS[level - 1] ?? LEVEL_COLORS[0]!;
}
