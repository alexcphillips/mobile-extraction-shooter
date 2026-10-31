import type { WorldDef } from '@mes/shared';

/*
 * The cutaway: everything above a height is hidden, to see inside buildings a floor at a
 * time. The arrows step it from floor to floor, found from the map's solids.
 */

/** How far above a floor the cut sits: over furniture and window sills, under the ceiling. */
export const CUT_ABOVE = 1.5;
/** The step when there's no floor further that way. */
const STOREY = 3;
/** A floor is a solid at least this wide both ways (so not a wall)... */
const FLOOR_SIDE = 1.5;
/** ...and this big... */
const FLOOR_AREA = 6;
/** ...and no thicker than a slab (so not a counter or a shelf). */
const FLOOR_THICKNESS = 0.6;
/** Floor tops this close together are one level (a kerb, a raised stage). */
const SAME_LEVEL = 0.5;

/** The heights of the floors in a world, lowest first: the tops of broad, thin slabs. */
export function floorLevels(world: WorldDef): number[] {
  const tops = world.boxes
    .filter(
      (b) =>
        Math.min(b.hx, b.hz) * 2 >= FLOOR_SIDE &&
        b.hx * b.hz * 4 >= FLOOR_AREA &&
        b.hy * 2 <= FLOOR_THICKNESS,
    )
    .map((b) => b.y + b.hy)
    .sort((a, b) => a - b);
  const levels: number[] = [];
  for (const t of tops) if (!levels.length || t - levels.at(-1)! > SAME_LEVEL) levels.push(t);
  return levels;
}

/** Where the cut starts: over the floor at or just below `y` (the camera's target). */
export function startCut(levels: readonly number[], y: number): number {
  const floor = levels.filter((l) => l <= y + SAME_LEVEL).at(-1) ?? y;
  return round(floor + CUT_ABOVE);
}

/** The cut over the next floor up (`dir` 1) or down (−1), or a storey on if there's none. */
export function stepCut(levels: readonly number[], cut: number, dir: 1 | -1): number {
  const cuts = levels.map((l) => round(l + CUT_ABOVE));
  const next =
    dir > 0 ? cuts.find((c) => c > cut + 0.05) : cuts.filter((c) => c < cut - 0.05).at(-1);
  return next ?? round(cut + dir * STOREY);
}

const round = (v: number): number => Math.round(v * 100) / 100;
