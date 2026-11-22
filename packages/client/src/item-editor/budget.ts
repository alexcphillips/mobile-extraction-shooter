import type { ItemDef, ModelShape } from '@mes/shared';
import { TriangleBuilder } from '../render/geometry';

/*
 * Triangle budgets (IE-1, 2026-11-09; the user agreed about 1.5–2k for a long gun). A gun is
 * drawn in first person and on every enemy that carries one, so the model tab counts what
 * an item draws and turns amber past its kind's budget. The budget is for the item as drawn
 * with what's fitted: a gun counts its attachments.
 */

export interface Budget {
  /** Triangles at most. */
  triangles: number;
  /** What the budget is for, for the readout ("long gun"). */
  kind: string;
}

export function budgetOf(def: ItemDef): Budget {
  // The body (CH-2; 1,500 since CH-3b, the user's call): drawn on every character.
  if ((def.type as string) === 'body') return { triangles: 1500, kind: 'body' };
  switch (def.type) {
    case 'weapon':
      // Raised from 1,000 and 2,000 (GM-1, the user's call): guns are what players look at
      // most, and the budget counts what's fitted, an optic's 1,200 included.
      return def.hold === 'pistol'
        ? { triangles: 1500, kind: 'pistol' }
        : { triangles: 3800, kind: 'long gun' };
    case 'attachment':
      // Optics 1,200 (2026-11-18, the user's call: the most looked-at part of the game; a
      // long gun's budget still counts its fitted optic).
      // An offset optic is a small sight beside the main one: 600.
      return def.slot === 'optic'
        ? { triangles: 1200, kind: 'optic' }
        : def.slot === 'offsetOptic'
          ? { triangles: 600, kind: 'offset optic' }
          : { triangles: 300, kind: `${def.slot} attachment` };
    case 'melee':
      return { triangles: 400, kind: 'knife' };
    case 'armor':
    case 'container':
      // Worn on every body.
      return { triangles: 1200, kind: 'worn gear' };
    default:
      // A mythic painting (2026-11-17, the user's call): rare enough to carry a richer scene,
      // painted in panels (800, then 1,250 for the eternal city traced from its reference).
      if (def.rarity === 'mythic' && 'lean' in def && def.lean !== undefined)
        return { triangles: 1250, kind: 'mythic painting' };
      // Loot: on the ground and in pictures, many at once.
      return { triangles: 400, kind: 'loot' };
  }
}

/** Triangles the game draws for these shapes. */
export function triangleCount(shapes: readonly ModelShape[]): number {
  const b = new TriangleBuilder(false);
  for (const s of shapes) b.shape(s);
  return b.triangles;
}
