import type { ItemDef } from '@mes/shared';

/** Ammo and armour levels 1–6 (design.md → Damage): grey, green, blue, purple, gold, red. */
export const LEVEL_COLOURS = ['#8d8f91', '#5c9a4a', '#4677b3', '#8a56b3', '#c99a2e', '#b8423a'];

/** An item's ammo or armour level (an armoured rig's too), or null for items without one. */
export function levelOf(def: ItemDef): number | null {
  if (def.type === 'ammo' || def.type === 'armour') return def.level;
  return def.type === 'container' ? (def.armour?.level ?? null) : null;
}

export function levelColour(level: number): string {
  return LEVEL_COLOURS[level - 1] ?? LEVEL_COLOURS[0]!;
}
