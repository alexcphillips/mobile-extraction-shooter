import type { ModelPart } from '@mes/shared';

/*
 * Color swatches for model parts (IE-2): the house palette for items (docs/props.md → Item
 * palette, taken from the colors the content's items use most) and the colors the open
 * item already uses.
 */

export const HOUSE_PALETTE: readonly { color: string; name: string }[] = [
  { color: '#141516', name: 'black' },
  { color: '#1d1f21', name: 'gun black' },
  { color: '#2b2d2f', name: 'dark gray' },
  { color: '#3a3d40', name: 'gray' },
  { color: '#8d8f91', name: 'bare steel' },
  { color: '#a08c64', name: 'tan (FDE)' },
  { color: '#b49a6c', name: 'light tan' },
  { color: '#6e6a48', name: 'khaki' },
  { color: '#5a6340', name: 'olive' },
  { color: '#3f4636', name: 'dark olive' },
  { color: '#7a4524', name: 'wood' },
  { color: '#6b3a2e', name: 'dark wood' },
  { color: '#b08d3c', name: 'brass' },
  { color: '#b87333', name: 'copper' },
  { color: '#e6e0d3', name: 'pale' },
  { color: '#d8461c', name: 'orange' },
  { color: '#4677b3', name: 'blue' },
  { color: '#5c9a4a', name: 'green' },
  { color: '#8a56b3', name: 'purple' },
  { color: '#39ff6a', name: 'glow green' },
];

/** The colors a model's parts use, most used first (lower case). */
export function colorsOf(parts: readonly ModelPart[]): string[] {
  const n = new Map<string, number>();
  for (const p of parts) {
    const c = p.color.toLowerCase();
    n.set(c, (n.get(c) ?? 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
