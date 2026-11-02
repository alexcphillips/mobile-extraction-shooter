import { wallPieces, type BoxDef, type MapNode } from '@mes/shared';
import { placeNode, round, type Vec3 } from './doc';

/*
 * The wall tool: walls drawn a corner at a time come out as plain boxes, and doors and
 * windows are cut into a wall by splitting its box around the gap. Railings (roadmap 19zo)
 * are boxes too, along the edge of a floor, ramp or stairs. Nothing new in the map format;
 * the game sees boxes as it always has. A window can be glazed as it's cut, or later by
 * clicking its sill or lintel (2026-11-02): a glass node fills the gap.
 */

type Box = Extract<MapNode, { type: 'box' }>;
type Sloped = Extract<MapNode, { type: 'ramp' | 'stairs' }>;
type Glass = Extract<MapNode, { type: 'glass' }>;

const DEG = Math.PI / 180;

export type WallMode = 'draw' | 'door' | 'window' | 'glass' | 'railing';
export const WALL_MODES: readonly WallMode[] = ['draw', 'door', 'window', 'glass', 'railing'];

export interface WallSettings {
  mode: WallMode;
  height: number;
  thickness: number;
  /** How wide a door or window cut is, or a gap cut in a railing. */
  width: number;
  railingHeight: number;
  /** How many windows one click cuts, spaced evenly along the wall (2026-11-02). */
  count: number;
  /**
   * With a count over 1, the gap between the windows, the row centred on the wall; 0 spaces
   * them evenly along the whole wall instead (2026-11-02).
   */
  gap: number;
  /** Cutting a window glazes it. */
  glass: boolean;
  /** The tint of glass put in. */
  glassColour: string;
}

export const WALL_DEFAULTS: WallSettings = {
  mode: 'draw',
  height: 2.6,
  thickness: 0.2,
  width: 1,
  railingHeight: 1.1,
  count: 1,
  gap: 0,
  glass: true,
  glassColour: '#a8d4e0',
};

export const RAILING_THICKNESS = 0.1;
/**
 * A railing up a slope is tilted pieces about this long: a tilted box collides as its
 * bounding box, so short pieces keep what blocks shots close to what's drawn.
 */
const RAILING_PIECE = 1;
/** A box this low and thin (and longer than it's thick) is taken for a railing. */
const RAILING_MAX_HEIGHT = 1.5;
const RAILING_MAX_THICKNESS = 0.3;

/** Whether a box looks like a railing, for cutting a gap in it. */
export function isRailing(b: Box): boolean {
  const thin = Math.min(b.size[0], b.size[2]);
  return (
    !b.pitch &&
    !b.roll &&
    b.size[1] <= RAILING_MAX_HEIGHT &&
    thin <= RAILING_MAX_THICKNESS &&
    Math.max(b.size[0], b.size[2]) > 3 * thin
  );
}

/**
 * A railing along the edge of a floor (a box), ramp or stairs nearest `at` (in the node's
 * parent frame). On a box (any side) it stands on the top with its outside flush with the
 * edge; on a ramp or stairs (either long side) it's tilted pieces following the slope just
 * outside it. Throws for a tilted box.
 */
export function edgeRailing(
  n: Box | Sloped,
  at: readonly number[],
  height: number,
  colour: string,
): Box[] {
  if (n.type === 'box' && (n.pitch || n.roll)) throw new Error('a tilted box has no flat edge');
  const yaw = (n.yaw ?? 0) * DEG;
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  // Local +x is (cos, −sin) in the parent's frame, local +z (sin, cos).
  const dx = at[0]! - n.pos[0];
  const dz = at[2]! - n.pos[2];
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const [w, h, d] = n.size;
  const t = RAILING_THICKNESS;
  const toParent = (x: number, y: number, z: number): Vec3 => [
    n.pos[0] + x * c + z * s,
    y,
    n.pos[2] - x * s + z * c,
  ];
  const piece = (size: Vec3, pos: Vec3, pitch = 0): Box => {
    const b: Box = { type: 'box', pos: [0, 0, 0], size, colour };
    if (pitch) b.pitch = pitch;
    placeNode(b, pos, n.yaw ?? 0);
    return b;
  };
  const side = Math.sign(lx) || 1;
  if (n.type === 'box') {
    const sideX = side * (w / 2 - t / 2);
    const top = n.pos[1] + h;
    // Nearer a side along local x (at ±z) than one along z.
    if (d / 2 - Math.abs(lz) < w / 2 - Math.abs(lx)) {
      const sideZ = (Math.sign(lz) || 1) * (d / 2 - t / 2);
      return [piece([round(w), height, t], toParent(0, top, sideZ))];
    }
    return [piece([t, height, round(d)], toParent(sideX, top, 0))];
  }
  // Up the slope, from local −z (the bottom) to +z, just outside it so it only touches.
  const sideX = side * (w / 2 + t / 2);
  const count = Math.max(1, Math.ceil(Math.hypot(d, h) / RAILING_PIECE));
  const length = round(Math.hypot(d, h) / count);
  const pitch = -Math.round((Math.atan2(h, d) / DEG) * 10) / 10;
  return Array.from({ length: count }, (_, k) => {
    const z = -d / 2 + (d * (k + 0.5)) / count;
    const y = n.pos[1] + (h * (k + 0.5)) / count;
    return piece([t, height, length], toParent(sideX, y, z), pitch);
  });
}

/** A door's gap: as tall as the door the marker tool places. */
export const DOOR_HEIGHT = 2.1;
/**
 * A window's gap, in the middle of what can be vaulted through (design.md → Movement): its
 * sill 0.7–1.1 m up, at least 0.8 m tall and 0.7 m wide, in a wall at most 0.5 m thick.
 */
export const WINDOW_SILL = 0.9;
export const WINDOW_HEIGHT = 1.1;
export const WINDOW_MIN_WIDTH = 0.7;
export const VAULT_THICKNESS = 0.5;

/**
 * The boxes of walls along a line of corners (in the frame they go in), at the first
 * corner's height. Each runs half its thickness past both ends, so corners are filled.
 */
export function wallBoxes(
  corners: readonly Vec3[],
  height: number,
  thickness: number,
  colour: string,
): Box[] {
  const y = corners[0]?.[1] ?? 0;
  const out: Box[] = [];
  for (let k = 1; k < corners.length; k++) {
    const [ax, , az] = corners[k - 1]!;
    const [bx, , bz] = corners[k]!;
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.01) continue;
    // Local +x runs along the wall: (cos yaw, −sin yaw), as compile turns things.
    // To a tenth of a degree: corners rounded to the millimetre would leave 14.99° for 15°.
    const yaw = Math.round((Math.atan2(-(bz - az), bx - ax) / DEG) * 10) / 10;
    const box: Box = {
      type: 'box',
      pos: [0, 0, 0],
      size: [round(length + thickness), round(height), round(thickness)],
      colour,
    };
    placeNode(box, [(ax + bx) / 2, y, (az + bz) / 2], yaw);
    out.push(box);
  }
  return out;
}

/** A box no thicker than this, and longer than it is thick, is a wall whose ends snap. */
const WALL_MAX_THICKNESS = 0.6;
/** How near a click must be to a wall's end to snap to it. */
export const END_SNAP = 0.4;

/**
 * The ends of the walls among some solids (world boxes, as compiled): each end of a thin
 * box's middle line, a half-thickness in from its face, at its foot. A wall drawn from one
 * meets it as wallBoxes makes corners.
 */
export function wallEnds(boxes: readonly BoxDef[]): Vec3[] {
  const out: Vec3[] = [];
  for (const b of boxes) {
    const [long, thin] = b.hx >= b.hz ? [b.hx, b.hz] : [b.hz, b.hx];
    if (thin * 2 > WALL_MAX_THICKNESS || long <= thin) continue;
    // Along local x (cos, −sin) or local z (sin, cos).
    const [dx, dz] =
      b.hx >= b.hz ? [Math.cos(b.yaw), -Math.sin(b.yaw)] : [Math.sin(b.yaw), Math.cos(b.yaw)];
    const reach = long - thin;
    for (const k of [-1, 1]) out.push([b.x + dx * reach * k, b.y - b.hy, b.z + dz * reach * k]);
  }
  return out;
}

/** The nearest of `ends` to `p` across the ground within END_SNAP (and 1.5 m up or down). */
export function nearestEnd(ends: readonly Vec3[], p: Vec3): Vec3 | null {
  let best: Vec3 | null = null;
  let bestDist = END_SNAP;
  for (const e of ends) {
    const d = Math.hypot(e[0] - p[0], e[2] - p[2]);
    if (d < bestDist && Math.abs(e[1] - p[1]) < 1.5) [best, bestDist] = [e, d];
  }
  return best;
}

/** Where a corner goes after `from`: the angle snapped to `angleSnap`°, the length to `grid`. */
export function snapCorner(from: Vec3, to: Vec3, angleSnap: number, grid: number): Vec3 {
  let dx = to[0] - from[0];
  let dz = to[2] - from[2];
  let length = Math.hypot(dx, dz);
  if (angleSnap) {
    const a = Math.round(Math.atan2(dz, dx) / DEG / angleSnap) * angleSnap * DEG;
    if (grid) length = Math.max(grid, Math.round(length / grid) * grid);
    dx = Math.cos(a) * length;
    dz = Math.sin(a) * length;
  }
  return [round(from[0] + dx), from[1], round(from[2] + dz)];
}

/** A gap cut in a wall: its middle along the wall's length, its width, bottom and top. */
export interface Opening {
  along: number;
  width: number;
  bottom: number;
  top: number;
}

/** Which of a box's sides is its length (local x or z), with that way in its parent's frame. */
export function wallAxis(b: Box): { axis: 0 | 2; length: number; dx: number; dz: number } {
  const yaw = (b.yaw ?? 0) * DEG;
  return b.size[0] >= b.size[2]
    ? { axis: 0, length: b.size[0], dx: Math.cos(yaw), dz: -Math.sin(yaw) }
    : { axis: 2, length: b.size[2], dx: Math.sin(yaw), dz: Math.cos(yaw) };
}

/** How far along a wall (from its middle, along its length) a point in its parent's frame is. */
export function alongWall(b: Box, p: readonly number[]): number {
  const { dx, dz } = wallAxis(b);
  return (p[0]! - b.pos[0]) * dx + (p[2]! - b.pos[2]) * dz;
}

/**
 * `count` openings like `o` (its along is ignored) along a wall `length` long: `gap` apart in
 * a row centred on the wall, or with no gap given (or 0), spaced evenly, the same gap between
 * each and at both ends. Throws if they don't fit (with 10 cm between, spaced evenly).
 */
export function evenOpenings(length: number, o: Opening, count: number, gap = 0): Opening[] {
  const fixed = gap > 0;
  const space = fixed ? gap : (length - count * o.width) / (count + 1);
  const row = count * o.width + (count - 1) * space;
  if ((!fixed && space < 0.1) || row > length + 1e-6)
    throw new Error(
      `${count} gaps ${o.width} m wide${fixed ? ` ${gap} m apart` : ''} don't fit in ${round(length, 0.01)} m`,
    );
  return Array.from({ length: count }, (_, k) => ({
    ...o,
    along: round(-row / 2 + (o.width + space) * k + o.width / 2, 0.001),
  }));
}

/**
 * The pieces a wall splits into around openings (one, or several side by side): the wall
 * between and beside them, and each one's sill below and lintel above (those with any
 * size). Throws if the wall is tilted or a gap doesn't fit or overlaps another.
 */
export function cutWall(b: Box, openings: Opening | readonly Opening[]): Box[] {
  if (b.pitch || b.roll) throw new Error("a tilted box can't be cut");
  const { axis, length, dx, dz } = wallAxis(b);
  const height = b.size[1];
  const list = (Array.isArray(openings) ? openings : [openings]) as readonly Opening[];
  for (const o of list) {
    if (o.width > length + 1e-6) throw new Error(`the wall is only ${round(length, 0.01)} m long`);
    if (o.top > height + 1e-6) throw new Error(`the wall is only ${round(height, 0.01)} m tall`);
  }
  const gaps = list
    .map((o) => {
      const along = Math.max(
        -length / 2 + o.width / 2,
        Math.min(length / 2 - o.width / 2, o.along),
      );
      return { o, g0: along - o.width / 2, g1: along + o.width / 2 };
    })
    .sort((a, b) => a.g0 - b.g0);
  for (let k = 1; k < gaps.length; k++)
    if (gaps[k]!.g0 < gaps[k - 1]!.g1 - 1e-6) throw new Error('the gaps overlap');
  const piece = (from: number, to: number, y0: number, y1: number): Box | null => {
    if (to - from < 0.01 || y1 - y0 < 0.01) return null;
    const mid = (from + to) / 2;
    const size: Vec3 = [...b.size];
    size[axis] = round(to - from);
    size[1] = round(y1 - y0);
    // A copy keeps the file's key order.
    const out: Box = { ...structuredClone(b), size };
    placeNode(out, [b.pos[0] + dx * mid, b.pos[1] + y0, b.pos[2] + dz * mid]);
    return out;
  };
  const out: (Box | null)[] = [];
  let from = -length / 2;
  for (const { o, g0, g1 } of gaps) {
    out.push(piece(from, g0, 0, height), piece(g0, g1, 0, o.bottom), piece(g0, g1, o.top, height));
    from = g1;
  }
  out.push(piece(from, length / 2, 0, height));
  return out.filter((p) => p !== null);
}

/** Where a door in a gap cut by `cutWall` goes: its bottom middle and yaw (width along the wall). */
export function doorIn(b: Box, o: Opening): { pos: Vec3; yaw: number } {
  const { axis, length, dx, dz } = wallAxis(b);
  const along = Math.max(-length / 2 + o.width / 2, Math.min(length / 2 - o.width / 2, o.along));
  const yaw = (b.yaw ?? 0) - (axis === 2 ? 90 : 0);
  return {
    pos: [round(b.pos[0] + dx * along), round(b.pos[1] + o.bottom), round(b.pos[2] + dz * along)],
    yaw,
  };
}

/** A pane of glass filling a gap cut by `cutWall`. */
export function glassIn(b: Box, o: Opening, colour: string): Glass {
  const { pos, yaw } = doorIn(b, o);
  const glass: Glass = { type: 'glass', pos, size: [o.width, round(o.top - o.bottom)], colour };
  placeNode(glass, pos, yaw);
  return glass;
}

/**
 * The window a wall piece is the sill or lintel of, among the nodes beside it: the gap
 * straight above it up to the next piece of the same wall (a sill), or else straight below
 * it down to the next (a lintel), as wide as the piece. Null if it's neither, or the gap
 * has glass in it already.
 */
export function windowAt(piece: Box, siblings: readonly MapNode[], colour: string): Glass | null {
  if (piece.pitch || piece.roll) return null;
  const { axis, length, dx, dz } = wallAxis(piece);
  const thick = piece.size[2 - axis]!;
  const bottom = piece.pos[1];
  const top = bottom + piece.size[1];
  let above = Infinity;
  let below = -Infinity;
  const glazed: Vec3[] = [];
  for (const n of siblings) {
    if (n === piece) continue;
    if (n.type === 'glass') glazed.push(n.pos);
    if (n.type !== 'box' || n.pitch || n.roll) continue;
    const w = wallAxis(n);
    // The same wall: parallel, in line across it, and covering the piece's length.
    if (Math.abs(w.dx * dx + w.dz * dz) < 0.999) continue;
    const ox = n.pos[0] - piece.pos[0];
    const oz = n.pos[2] - piece.pos[2];
    if (Math.abs(ox * -dz + oz * dx) > thick / 2) continue;
    const along = ox * dx + oz * dz;
    if (Math.abs(along) - w.length / 2 > -length / 2 + 0.01) continue;
    const nb = n.pos[1];
    const nt = nb + n.size[1];
    if (nb >= top - 1e-6) above = Math.min(above, nb);
    else if (nt <= bottom + 1e-6) below = Math.max(below, nt);
  }
  const [y0, y1] = above < Infinity ? [top, above] : below > -Infinity ? [below, bottom] : [0, 0];
  if (y1 - y0 < 0.05) return null;
  // Glass already in the gap: within it up and down, and within the piece along and across.
  for (const p of glazed) {
    const ox = p[0] - piece.pos[0];
    const oz = p[2] - piece.pos[2];
    if (
      p[1] >= y0 - 1e-6 &&
      p[1] < y1 &&
      Math.abs(ox * dx + oz * dz) <= length / 2 &&
      Math.abs(ox * -dz + oz * dx) <= thick / 2
    )
      return null;
  }
  const yaw = (piece.yaw ?? 0) - (axis === 2 ? 90 : 0);
  const pos: Vec3 = [piece.pos[0], round(y0), piece.pos[2]];
  const glass: Glass = { type: 'glass', pos, size: [length, round(y1 - y0)], colour };
  placeNode(glass, pos, yaw);
  return glass;
}

type Wall = Extract<MapNode, { type: 'wall' }>;
type WallGap = Wall['openings'][number];

/**
 * A wall node with openings (2026-11-02) in place of an untilted box: its length along
 * local x, so turned −90° from a box that's long along its z.
 */
export function toWall(b: Box, openings: WallGap[] = []): Wall {
  if (b.pitch || b.roll) throw new Error("a tilted box can't be cut");
  const { axis, length } = wallAxis(b);
  const w: Wall = {
    type: 'wall',
    ...(b.id === undefined ? {} : { id: b.id }),
    pos: [...b.pos],
    size: [length, b.size[1], b.size[2 - axis]!],
    colour: b.colour,
    ...(b.collide === undefined ? {} : { collide: b.collide }),
    openings,
  };
  const yaw = round((b.yaw ?? 0) - (axis === 2 ? 90 : 0), 0.001);
  if (yaw) w.yaw = yaw;
  return w;
}

/** Along a wall node's length (local x, from its middle) to a point in its parent's frame. */
export function wallAlong(w: Wall, p: readonly number[]): number {
  const yaw = (w.yaw ?? 0) * DEG;
  return (p[0]! - w.pos[0]) * Math.cos(yaw) - (p[2]! - w.pos[2]) * Math.sin(yaw);
}

/** A point `along` a wall node, `up` from its base, in its parent's frame. */
export function wallPoint(w: Wall, along: number, up: number): Vec3 {
  const yaw = (w.yaw ?? 0) * DEG;
  return [w.pos[0] + along * Math.cos(yaw), w.pos[1] + up, w.pos[2] - along * Math.sin(yaw)];
}

/** Throws with the problem if a wall's openings don't fit (outside it, or overlapping). */
export function checkOpenings(w: Wall): void {
  const r = wallPieces(w.size[0], w.size[1], w.openings);
  if (typeof r === 'string') throw new Error(r);
}

/** The opening `along` falls in, or -1. */
export function openingAt(w: Wall, along: number): number {
  return w.openings.findIndex((o) => Math.abs(along - o.along) <= o.width / 2 + 1e-6);
}

/**
 * Moves a wall's openings so the gaps between them and at the ends are all the same, or
 * with a gap given, `gap` apart in a row centred on the wall.
 */
export function spaceEvenly(w: Wall, gap = 0): void {
  const sorted = [...w.openings].sort((a, b) => a.along - b.along);
  const total = sorted.reduce((t, o) => t + o.width, 0);
  const space = gap > 0 ? gap : (w.size[0] - total) / (sorted.length + 1);
  const row = total + (sorted.length - 1) * space;
  if (space < 0 || row > w.size[0] + 1e-6) throw new Error("the openings don't fit");
  let at = -row / 2;
  for (const o of sorted) {
    o.along = round(at + o.width / 2, 0.001);
    at += o.width + space;
  }
  w.openings = sorted;
}

/**
 * A wall node split around a doorway (doors swing, so they aren't openings): the wall
 * either side, keeping the openings on its side, and the lintel over the gap (each null
 * without any size), and where the door goes. The left keeps the wall's id. Throws if it
 * doesn't fit or crosses an opening.
 */
export function splitWall(
  w: Wall,
  o: Opening,
): { left: Wall | null; lintel: Box | null; right: Wall | null; door: Vec3; yaw: number } {
  const [length, height] = w.size;
  if (o.width > length + 1e-6) throw new Error(`the wall is only ${round(length, 0.01)} m long`);
  if (o.top > height + 1e-6) throw new Error(`the wall is only ${round(height, 0.01)} m tall`);
  const along = Math.max(-length / 2 + o.width / 2, Math.min(length / 2 - o.width / 2, o.along));
  const [g0, g1] = [along - o.width / 2, along + o.width / 2];
  for (const p of w.openings) {
    if (p.along + p.width / 2 > g0 && p.along - p.width / 2 < g1)
      throw new Error('the doorway would cross a window');
  }
  const part = (from: number, to: number): Wall | null => {
    if (to - from < 0.01) return null;
    const mid = (from + to) / 2;
    const out: Wall = { ...structuredClone(w), size: [round(to - from), height, w.size[2]] };
    delete out.id;
    out.pos = wallPoint(w, mid, 0).map((v) => round(v)) as Vec3;
    out.openings = w.openings
      .filter((p) => p.along > from && p.along < to)
      .map((p) => ({ ...p, along: round(p.along - mid, 0.001) }));
    return out;
  };
  const left = part(-length / 2, g0);
  if (left && w.id !== undefined) left.id = w.id;
  let lintel: Box | null = null;
  if (height - o.top >= 0.01) {
    lintel = {
      type: 'box',
      pos: wallPoint(w, along, o.top).map((v) => round(v)) as Vec3,
      size: [o.width, round(height - o.top), w.size[2]],
      colour: w.colour,
    };
    if (w.yaw) lintel.yaw = w.yaw;
    if (w.collide !== undefined) lintel.collide = w.collide;
  }
  return {
    left,
    lintel,
    right: part(g1, length / 2),
    door: wallPoint(w, along, 0).map((v) => round(v)) as Vec3,
    yaw: w.yaw ?? 0,
  };
}
