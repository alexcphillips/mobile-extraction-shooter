import type { ModelPart } from '@mes/shared';

/*
 * Colour swatches for model parts (IE-2): the house palette for items (docs/props.md → Item
 * palette, taken from the colours the content's items use most) and the colours the open
 * item already uses.
 */

export const HOUSE_PALETTE: readonly { colour: string; name: string }[] = [
  { colour: '#141516', name: 'black' },
  { colour: '#1d1f21', name: 'gun black' },
  { colour: '#2b2d2f', name: 'dark grey' },
  { colour: '#3a3d40', name: 'grey' },
  { colour: '#8d8f91', name: 'bare steel' },
  { colour: '#a08c64', name: 'tan (FDE)' },
  { colour: '#b49a6c', name: 'light tan' },
  { colour: '#6e6a48', name: 'khaki' },
  { colour: '#5a6340', name: 'olive' },
  { colour: '#3f4636', name: 'dark olive' },
  { colour: '#7a4524', name: 'wood' },
  { colour: '#6b3a2e', name: 'dark wood' },
  { colour: '#b08d3c', name: 'brass' },
  { colour: '#b87333', name: 'copper' },
  { colour: '#e6e0d3', name: 'pale' },
  { colour: '#d8461c', name: 'orange' },
  { colour: '#4677b3', name: 'blue' },
  { colour: '#5c9a4a', name: 'green' },
  { colour: '#8a56b3', name: 'purple' },
  { colour: '#39ff6a', name: 'glow green' },
];

/** The colours a model's parts use, most used first (lower case). */
export function coloursOf(parts: readonly ModelPart[]): string[] {
  const n = new Map<string, number>();
  for (const p of parts) {
    const c = p.colour.toLowerCase();
    n.set(c, (n.get(c) ?? 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
