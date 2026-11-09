import type { ReticleShape } from '@mes/shared';

/*
 * Edits to reticle shapes (session 18, arcs, triangles and repeats in IE-2): what a drag of
 * a handle does, mirrored copies, and a shape repeated along an offset. Units are % of the
 * screen height from the aim point, y down; arc angles are degrees clockwise from up.
 */

/** What a drag holds: the whole shape, a line's or triangle's corner, a radius, an arc's end. */
export type Handle = 'move' | 'a' | 'b' | 'c' | 'r' | 'from' | 'to';

/** Rounds away float noise (0.30000000000000004). */
const tidy = (v: number): number => Number(v.toFixed(3));

/** Moves a shape by (dx, dy). */
export function moved(s: ReticleShape, dx: number, dy: number): ReticleShape {
  switch (s.type) {
    case 'line':
      return {
        ...s,
        x1: tidy(s.x1 + dx),
        y1: tidy(s.y1 + dy),
        x2: tidy(s.x2 + dx),
        y2: tidy(s.y2 + dy),
      };
    case 'triangle':
      return {
        ...s,
        x1: tidy(s.x1 + dx),
        y1: tidy(s.y1 + dy),
        x2: tidy(s.x2 + dx),
        y2: tidy(s.y2 + dy),
        x3: tidy(s.x3 + dx),
        y3: tidy(s.y3 + dy),
      };
    default:
      return { ...s, x: tidy(s.x + dx), y: tidy(s.y + dy) };
  }
}

/** The angle of (x, y) about a centre, degrees clockwise from up. */
const angleAt = (cx: number, cy: number, x: number, y: number): number =>
  (Math.atan2(x - cx, cy - y) * 180) / Math.PI;

/**
 * A shape after dragging one of its handles by (dx, dy), the pointer now at `at`. `snap`
 * rounds a coordinate; arc ends snap to 5° when coordinates snap, else to 1°.
 */
export function dragged(
  s: ReticleShape,
  h: Handle,
  dx: number,
  dy: number,
  snap: (v: number) => number,
  at: { x: number; y: number },
  snapAngles: boolean,
): ReticleShape {
  const sn = (v: number): number => tidy(snap(v));
  switch (s.type) {
    case 'line':
      return {
        ...s,
        ...(h !== 'b' && { x1: sn(s.x1 + dx), y1: sn(s.y1 + dy) }),
        ...(h !== 'a' && { x2: sn(s.x2 + dx), y2: sn(s.y2 + dy) }),
      };
    case 'triangle':
      return {
        ...s,
        ...((h === 'move' || h === 'a') && { x1: sn(s.x1 + dx), y1: sn(s.y1 + dy) }),
        ...((h === 'move' || h === 'b') && { x2: sn(s.x2 + dx), y2: sn(s.y2 + dy) }),
        ...((h === 'move' || h === 'c') && { x3: sn(s.x3 + dx), y3: sn(s.y3 + dy) }),
      };
    case 'arc':
      if (h === 'from' || h === 'to') {
        const step = snapAngles ? 5 : 1;
        const a = Math.round(angleAt(s.x, s.y, at.x, at.y) / step) * step;
        return h === 'from'
          ? { ...s, from: tidy(inTurnBelow(a, s.to)) }
          : { ...s, to: tidy(inTurnAbove(a, s.from)) };
      }
      // Its centre and radius drag as a ring's.
      return round(s, h, dx, dy, sn);
    case 'dot':
    case 'ring':
      return round(s, h, dx, dy, sn);
  }
}

/** A round shape's radius handle, or the shape moved. */
function round<T extends { x: number; y: number; r: number }>(
  s: T,
  h: Handle,
  dx: number,
  dy: number,
  sn: (v: number) => number,
): T {
  if (h === 'r') return { ...s, r: Math.max(sn(s.r + dx) || 0.05, 0.05) };
  return { ...s, x: sn(s.x + dx), y: sn(s.y + dy) };
}

/** `a` plus or minus whole turns, so it's in [to − 360, to). */
function inTurnBelow(a: number, to: number): number {
  let f = a;
  while (f >= to) f -= 360;
  while (f < to - 360) f += 360;
  return f;
}

/** `a` plus or minus whole turns, so it's in (from, from + 360]. */
function inTurnAbove(a: number, from: number): number {
  let t = a;
  while (t <= from) t += 360;
  while (t > from + 360) t -= 360;
  return t;
}

/** A copy mirrored left to right (`x`: across the up-down line) or top to bottom (`y`). */
export function mirrored(s: ReticleShape, axis: 'x' | 'y'): ReticleShape {
  const f = (v: number, on: boolean): number => (on ? -v || 0 : v);
  const x = axis === 'x';
  switch (s.type) {
    case 'line':
      return { ...s, x1: f(s.x1, x), x2: f(s.x2, x), y1: f(s.y1, !x), y2: f(s.y2, !x) };
    case 'triangle':
      return {
        ...s,
        x1: f(s.x1, x),
        x2: f(s.x2, x),
        x3: f(s.x3, x),
        y1: f(s.y1, !x),
        y2: f(s.y2, !x),
        y3: f(s.y3, !x),
      };
    case 'arc': {
      // Clockwise from up: left for right turns a to −a, top for bottom to 180 − a. Either
      // way the run goes the other way round, so the ends swap.
      const [from, to] = x ? [-s.to, -s.from] : [180 - s.to, 180 - s.from];
      // Whole turns taken off, so from is in [−180, 180).
      const shift = Math.floor((from + 180) / 360) * 360;
      return { ...s, x: f(s.x, x), y: f(s.y, !x), from: from - shift || 0, to: to - shift };
    }
    default:
      return { ...s, x: f(s.x, x), y: f(s.y, !x) };
  }
}

/** `n` copies of a shape, each (dx, dy) on from the one before (mil ticks, a ladder). */
export function repeated(s: ReticleShape, n: number, dx: number, dy: number): ReticleShape[] {
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, k) =>
    moved(s, dx * (k + 1), dy * (k + 1)),
  );
}

export const NEW_SHAPES: Record<ReticleShape['type'], ReticleShape> = {
  dot: { type: 'dot', x: 0, y: 0, r: 0.6 },
  line: { type: 'line', x1: 0, y1: 2, x2: 0, y2: 10, width: 0.3 },
  ring: { type: 'ring', x: 0, y: 0, r: 4, width: 0.3 },
  arc: { type: 'arc', x: 0, y: 0, r: 6, width: 0.3, from: -45, to: 45 },
  // A chevron's head, its tip on the aim point.
  triangle: { type: 'triangle', x1: 0, y1: 0, x2: 1.5, y2: 2.5, x3: -1.5, y3: 2.5 },
};

export function describe(s: ReticleShape): string {
  switch (s.type) {
    case 'line':
      return `line (${s.x1}, ${s.y1}) → (${s.x2}, ${s.y2})`;
    case 'triangle':
      return `triangle (${s.x1}, ${s.y1}) (${s.x2}, ${s.y2}) (${s.x3}, ${s.y3})`;
    case 'arc':
      return `arc at (${s.x}, ${s.y}), r ${s.r}, ${s.from}° → ${s.to}°`;
    default:
      return `${s.type} at (${s.x}, ${s.y}), r ${s.r}`;
  }
}

/** The number fields each shape has, in order. */
export const SHAPE_FIELDS: Record<ReticleShape['type'], readonly string[]> = {
  dot: ['x', 'y', 'r'],
  line: ['x1', 'y1', 'x2', 'y2', 'width'],
  ring: ['x', 'y', 'r', 'width'],
  arc: ['x', 'y', 'r', 'width', 'from', 'to'],
  triangle: ['x1', 'y1', 'x2', 'y2', 'x3', 'y3'],
};
