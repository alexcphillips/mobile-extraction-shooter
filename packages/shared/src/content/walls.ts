/*
 * A wall node (2026-11-02): one straight wall with its openings (windows and gaps) kept as
 * data, so the editor can slide and resize them. It compiles to plain boxes: the stretches
 * of wall between the openings, and each one's sill and lintel.
 */

/** A gap in a wall: its middle along the wall (from the wall's middle), width, bottom, top. */
export interface WallOpening {
  along: number;
  width: number;
  bottom: number;
  top: number;
}

/** A piece of a wall in its own frame: from and to along it, and bottom and top. */
export interface WallPiece {
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/**
 * The pieces a wall `length` long and `height` tall is made of around its openings (in any
 * order), those with any size. Null with the problem if an opening is outside the wall or
 * overlaps another.
 */
export function wallPieces(
  length: number,
  height: number,
  openings: readonly WallOpening[],
): WallPiece[] | string {
  const sorted = [...openings].sort((a, b) => a.along - b.along);
  const out: WallPiece[] = [];
  const add = (from: number, to: number, bottom: number, top: number) => {
    if (to - from >= 0.01 && top - bottom >= 0.01) out.push({ from, to, bottom, top });
  };
  let at = -length / 2;
  for (const o of sorted) {
    const g0 = o.along - o.width / 2;
    const g1 = o.along + o.width / 2;
    if (g0 < -length / 2 - 1e-6 || g1 > length / 2 + 1e-6)
      return `an opening at ${o.along} m runs past the end of the wall`;
    if (o.bottom < 0 || o.top > height + 1e-6 || o.top <= o.bottom)
      return `an opening at ${o.along} m isn't within the wall's height`;
    if (g0 < at - 1e-6) return `openings overlap at ${o.along} m`;
    add(at, g0, 0, height);
    add(g0, g1, 0, o.bottom);
    add(g0, g1, o.top, height);
    at = g1;
  }
  add(at, length / 2, 0, height);
  return out;
}
