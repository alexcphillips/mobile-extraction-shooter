import type { ItemDef, Shape } from '@mes/shared';
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
  switch (def.type) {
    case 'weapon':
      return def.hold === 'pistol'
        ? { triangles: 1000, kind: 'pistol' }
        : { triangles: 2000, kind: 'long gun' };
    case 'attachment':
      return def.slot === 'optic'
        ? { triangles: 500, kind: 'optic' }
        : { triangles: 300, kind: `${def.slot} attachment` };
    case 'melee':
      return { triangles: 400, kind: 'knife' };
    case 'armor':
    case 'container':
      // Worn on every body.
      return { triangles: 1200, kind: 'worn gear' };
    default:
      // Loot: on the ground and in pictures, many at once.
      return { triangles: 400, kind: 'loot' };
  }
}

/** Triangles the game draws for these shapes. */
export function triangleCount(shapes: readonly Shape[]): number {
  const b = new TriangleBuilder(false);
  for (const s of shapes) b.shape(s);
  return b.triangles;
}
