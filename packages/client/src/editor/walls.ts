import type { BoxDef, MapNode } from '@mes/shared';
import { placeNode, round, type Vec3 } from './doc';

/*
 * The wall tool: walls drawn a corner at a time come out as plain boxes, and doors and
 * windows are cut into a wall by splitting its box around the gap. Nothing new in the map
 * format; the game sees boxes as it always has.
 */

type Box = Extract<MapNode, { type: 'box' }>;

const DEG = Math.PI / 180;

export type WallMode = 'draw' | 'door' | 'window';
export const WALL_MODES: readonly WallMode[] = ['draw', 'door', 'window'];

export interface WallSettings {
  mode: WallMode;
  height: number;
  thickness: number;
  /** How wide a door or window cut is. */
  width: number;
}

export const WALL_DEFAULTS: WallSettings = { mode: 'draw', height: 2.6, thickness: 0.2, width: 1 };

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
 * The pieces a wall splits into around an opening: either side, the sill below and the
 * lintel above (those with any size). Throws if the wall is tilted or the gap doesn't fit.
 */
export function cutWall(b: Box, o: Opening): Box[] {
  if (b.pitch || b.roll) throw new Error("a tilted box can't be cut");
  const { axis, length, dx, dz } = wallAxis(b);
  const height = b.size[1];
  if (o.width > length + 1e-6) throw new Error(`the wall is only ${round(length, 0.01)} m long`);
  if (o.top > height + 1e-6) throw new Error(`the wall is only ${round(height, 0.01)} m tall`);
  const along = Math.max(-length / 2 + o.width / 2, Math.min(length / 2 - o.width / 2, o.along));
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
  const [g0, g1] = [along - o.width / 2, along + o.width / 2];
  return [
    piece(-length / 2, g0, 0, height),
    piece(g0, g1, 0, o.bottom),
    piece(g0, g1, o.top, height),
    piece(g1, length / 2, 0, height),
  ].filter((p) => p !== null);
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
