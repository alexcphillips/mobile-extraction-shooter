/*
 * The geometry behind the pad's menu cursor (CP-2, 2026-11-08): how fast it moves, which
 * box it snaps to, and where a D-pad press steps it. Plain functions over plain boxes, so
 * they can be unit-tested; `pad-cursor.ts` gathers the boxes from the page.
 */

/** A screen rectangle in CSS pixels, as getBoundingClientRect gives it. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Slowest and fastest the cursor moves, in CSS pixels a second, at full push. */
const SPEED_MIN = 260;
const SPEED_MAX = 1500;
/** Held at full push this long, it reaches full speed. */
const SPEED_RAMP = 0.45;

/**
 * How fast the cursor moves for a push of `mag` (0..1, after the dead zone), held
 * `heldSec` seconds: a small push creeps (about squared), and a full push speeds up.
 */
export function cursorSpeed(mag: number, heldSec: number): number {
  const ramp = Math.min(1, heldSec / SPEED_RAMP);
  const top = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * ramp;
  return 40 + (top - 40) * mag * mag;
}

/** The distance from a point to a box: 0 inside it. */
export function distanceTo(x: number, y: number, b: Box): number {
  const dx = Math.max(b.left - x, 0, x - (b.left + b.width));
  const dy = Math.max(b.top - y, 0, y - (b.top + b.height));
  return Math.hypot(dx, dy);
}

/**
 * The box to snap to when the stick lets go: the nearest within `radius`; of the boxes
 * the point is inside, the smallest (a tile over its grid). -1 if none.
 */
export function nearestBox(x: number, y: number, boxes: readonly Box[], radius: number): number {
  let best = -1;
  let bestD = radius;
  let bestArea = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    const d = distanceTo(x, y, b);
    const area = b.width * b.height;
    if (d < bestD || (d === bestD && d === 0 && area < bestArea)) {
      best = i;
      bestD = d;
      bestArea = area;
    }
  }
  return best;
}

/** Perpendicular misses count this much more than distance ahead, so a step goes straight. */
const SIDEWAYS = 3;
/** Past this size, a step lands just inside a box (a grid), not at its middle. */
const LARGE = 96;
const INSET = 20;

/**
 * Where a D-pad press steps from (x, y): the nearest box wholly ahead in that direction,
 * with sideways misses weighed more, and the point in it to go to (its middle, or just
 * inside the near edge and level with the cursor for a large one). Null if nothing is
 * ahead.
 */
export function stepTarget(
  x: number,
  y: number,
  dir: Dir,
  boxes: readonly Box[],
): { index: number; x: number; y: number } | null {
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const p = horizontal ? x : y;
  const q = horizontal ? y : x;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    const lo = horizontal ? b.left : b.top;
    const size = horizontal ? b.width : b.height;
    // The edge nearest the cursor, in the direction of travel.
    const near = sign > 0 ? lo : lo + size;
    const ahead = (near - p) * sign;
    if (ahead < 1) continue;
    const qlo = horizontal ? b.top : b.left;
    const qsize = horizontal ? b.height : b.width;
    const miss = Math.max(qlo - q, 0, q - (qlo + qsize));
    const score = ahead + SIDEWAYS * miss;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return null;
  const b = boxes[best]!;
  const lo = horizontal ? b.left : b.top;
  const size = horizontal ? b.width : b.height;
  const qlo = horizontal ? b.top : b.left;
  const qsize = horizontal ? b.height : b.width;
  const along = size <= LARGE ? lo + size / 2 : sign > 0 ? lo + INSET : lo + size - INSET;
  const inset = Math.min(INSET, qsize / 2);
  const across = qsize <= LARGE ? qlo + qsize / 2 : clamp(q, qlo + inset, qlo + qsize - inset);
  return horizontal ? { index: best, x: along, y: across } : { index: best, x: across, y: along };
}

/** The middle of the cell of a grid (`box`, cells `cell` px) a point is in, clamped to it. */
export function cellCentre(x: number, y: number, box: Box, cell: number): [number, number] {
  const cols = Math.max(1, Math.round(box.width / cell));
  const rows = Math.max(1, Math.round(box.height / cell));
  const cx = clamp(Math.floor((x - box.left) / cell), 0, cols - 1);
  const cy = clamp(Math.floor((y - box.top) / cell), 0, rows - 1);
  return [box.left + (cx + 0.5) * cell, box.top + (cy + 0.5) * cell];
}

/** One D-pad step as screen pixels. */
export function dirStep(dir: Dir): [number, number] {
  return dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
}

/**
 * A range input's value after a step of `by` (whole steps), kept on its step grid and
 * within min..max.
 */
export function stepRange(
  value: number,
  min: number,
  max: number,
  step: number,
  by: number,
): number {
  const s = step > 0 ? step : 1;
  const n = Math.round((value - min) / s) + by;
  const v = min + n * s;
  // Rounded to the step's decimals, so 0.1 steps don't drift (0.30000000000000004).
  const places = Math.max(0, -Math.floor(Math.log10(s)) + 1);
  return clamp(Number(v.toFixed(places)), min, max);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
