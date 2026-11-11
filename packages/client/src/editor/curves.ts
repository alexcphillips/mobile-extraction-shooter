import type { MapNode } from '@mes/shared';
import { placeNode, round, type Vec3 } from './doc';

/*
 * The curve tool (2026-11-01): curved walls, round floors with a hole in the middle, and
 * curved stairs, each made of plain boxes round a circle, like the wall tool's walls. Nothing
 * new in the map format. The circle clicked is the inside edge: everything is built outwards
 * from it, so a floor and a railing drawn on the same circle meet at the hole's edge.
 */

type Box = Extract<MapNode, { type: 'box' }>;

const DEG = Math.PI / 180;

export type CurveMode = 'wall' | 'floor' | 'stairs' | 'hole';
export const CURVE_MODES: readonly CurveMode[] = ['wall', 'floor', 'stairs', 'hole'];
/** What each is called, on its button and its group: not just "wall", which the wall tool is. */
export const CURVE_NAMES: Readonly<Record<CurveMode, string>> = {
  wall: 'Curved wall',
  floor: 'Round floor',
  stairs: 'Curved stairs',
  hole: 'Round hole',
};

export interface CurveSettings {
  mode: CurveMode;
  wallHeight: number;
  wallThickness: number;
  floorWidth: number;
  floorThickness: number;
  stairsWidth: number;
  stairsRise: number;
  /** How far above the center clicked it's built: a wall's foot, a floor's top, the stairs' foot. */
  raise: number;
  holeRadius: number;
  /** Whether a hole gets a railing round its edge, and how tall. */
  railing: boolean;
  railingHeight: number;
}

export const CURVE_DEFAULTS: CurveSettings = {
  mode: 'wall',
  wallHeight: 2.6,
  wallThickness: 0.2,
  floorWidth: 3,
  floorThickness: 0.3,
  stairsWidth: 1.2,
  stairsRise: 4,
  raise: 0,
  holeRadius: 4,
  railing: true,
  railingHeight: 1.1,
};

/** A part of a circle: its center (on the floor it's built from), radius and angles in degrees. */
export interface Arc {
  center: Vec3;
  radius: number;
  /** Where it starts, from +x towards +z. */
  start: number;
  /** How far round it goes, either way; ±360 is the whole circle. */
  sweep: number;
}

/** The longest a piece's outside edge gets, and the most of the circle it covers. */
const PIECE_LENGTH = 2;
const PIECE_ANGLE = 15;
/**
 * The most neighboring pieces overlap at the inside edge (about depth × the angle each
 * covers): under overlap.ts's JOINT, so wide floors don't warn.
 */
const PIECE_OVERLAP = 0.35;
const MAX_PIECES = 120;
/** As the stairs shape steps: about this much rise a step. */
const STEP_HEIGHT = 0.25;

/** How many boxes a curve `depth` thick (out from the radius) is made of. */
export function pieceCount(arc: Arc, depth: number): number {
  const outer = arc.radius + depth;
  const most = Math.min(PIECE_ANGLE, PIECE_LENGTH / outer / DEG, PIECE_OVERLAP / depth / DEG);
  return Math.min(MAX_PIECES, Math.max(1, Math.ceil(Math.abs(arc.sweep) / most - 1e-6)));
}

/** How deep, low and high piece i (from angle `from` to `to`) is. */
type Piece = (
  i: number,
  from: number,
  to: number,
) => { depth: number; bottom: number; top: number };

/**
 * Boxes filling an arc in n pieces, each from the radius out its depth. Each piece's
 * outside face is a side of the polygon round its outer circle, so neighbors as deep meet
 * there with no gap and overlap a sliver further in.
 */
function sectorBoxes(arc: Arc, n: number, color: string, piece: Piece): Box[] {
  const step = arc.sweep / n;
  const half = Math.tan((Math.abs(step) / 2) * DEG);
  const [cx, , cz] = arc.center;
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const a = arc.start + (i + 0.5) * step;
    const from = arc.start + i * step;
    const { depth, bottom, top } = piece(i, from, from + step);
    const length = 2 * (arc.radius + depth) * half;
    const middle = arc.radius + depth / 2;
    const box: Box = {
      type: 'box',
      pos: [0, 0, 0],
      size: [round(length), round(top - bottom), round(depth)],
      color,
    };
    // Local +z faces out from the center: (sin yaw, cos yaw) = (cos a, sin a).
    const yaw = Math.round((90 - a) * 10) / 10;
    placeNode(box, [cx + middle * Math.cos(a * DEG), bottom, cz + middle * Math.sin(a * DEG)], yaw);
    out.push(box);
  }
  return out;
}

/** The boxes of a curve drawn with these settings. */
export function curveBoxes(arc: Arc, s: CurveSettings, color: string): Box[] {
  // A hole is cut into a floor (cutHole), not drawn.
  if (s.mode === 'hole') return [];
  const base = arc.center[1] + s.raise;
  if (s.mode === 'wall') {
    const n = pieceCount(arc, s.wallThickness);
    return sectorBoxes(arc, n, color, () => ({
      depth: s.wallThickness,
      bottom: base,
      top: base + s.wallHeight,
    }));
  }
  if (s.mode === 'floor') {
    const n = pieceCount(arc, s.floorWidth);
    return sectorBoxes(arc, n, color, () => ({
      depth: s.floorWidth,
      bottom: base - s.floorThickness,
      top: base,
    }));
  }
  const n = stepCount(arc, s);
  const rise = s.stairsRise / n;
  // Each step a slab two steps deep, so the underside is open (walk under an escalator)
  // and neighbors share no more than a step's height.
  return sectorBoxes(arc, n, color, (i) => {
    const top = base + (i + 1) * rise;
    return { depth: s.stairsWidth, bottom: Math.max(base, top - 2 * rise), top };
  });
}

/** How many steps curved stairs have: about one per 0.25 m of rise, and enough to look round. */
export function stepCount(arc: Arc, s: CurveSettings): number {
  return Math.max(Math.round(s.stairsRise / STEP_HEIGHT), pieceCount(arc, s.stairsWidth), 1);
}

/** How steep curved stairs are along their middle, in degrees. */
export function stairsSlope(arc: Arc, s: CurveSettings): number {
  const run = (arc.radius + s.stairsWidth / 2) * Math.abs(arc.sweep) * DEG;
  return Math.atan2(s.stairsRise, run) / DEG;
}

/** Steeper than this is hard going: the stairs shape's 0.25 m steps are about 35°. */
export const STEEP = 40;

/** The angle (degrees, from +x towards +z) of `p` seen from `c`. */
export function angleFrom(c: Vec3, p: Vec3): number {
  return Math.atan2(p[2] - c[2], p[0] - c[0]) / DEG;
}

/** The point on the circle round `c` at `radius` and `angle`, at c's height. */
export function onCircle(c: Vec3, radius: number, angle: number): Vec3 {
  return [
    round(c[0] + radius * Math.cos(angle * DEG)),
    c[1],
    round(c[2] + radius * Math.sin(angle * DEG)),
  ];
}

/**
 * The sweep after moving to `angle`, from the sweep before: the change taken the short way
 * round, so following the mouse goes past halfway, and held within a whole circle.
 */
export function followSweep(start: number, before: number, angle: number): number {
  const change = ((((angle - start - before) % 360) + 540) % 360) - 180;
  return Math.max(-360, Math.min(360, before + change));
}

/** A radius and angles snapped to the grid and angle snap (either may be 0, off). */
export function snapArc(arc: Arc, grid: number, angleSnap: number): Arc {
  const snap = (v: number, by: number) => (by ? Math.round(v / by) * by : v);
  return {
    center: arc.center,
    radius: round(Math.max(grid || 0.1, snap(arc.radius, grid))),
    start: snap(arc.start, angleSnap),
    // Never nothing: at least one snap's worth, the way it was going.
    sweep: snap(arc.sweep, angleSnap) || (Math.sign(arc.sweep) || 1) * (angleSnap || 1),
  };
}

/** A round hole in a floor: its middle from the floor's middle, in the floor's own frame. */
export interface Hole {
  x: number;
  z: number;
  radius: number;
}

/** How far past the hole the square of floor cut round it goes. */
const HOLE_MARGIN = 0.5;
export const RAILING_THICKNESS = 0.15;

/**
 * The pieces a floor (a box) splits into round a round hole, in the floor's parent frame:
 * the floor either side of a square round the hole and before and behind it, then pieces
 * round the hole reaching out to the square (and a little past, under the floor beside it,
 * which as a slab at the same level doesn't warn). With `railing`, a railing that tall
 * stands round the hole's edge, in `color`. The pieces copy the floor; only the first
 * keeps its id. Throws if the floor is tilted or the hole doesn't fit inside it.
 */
export function cutHole(
  floor: Box,
  hole: Hole,
  railing: number | null,
  color: string,
): { floor: Box[]; railing: Box[] } {
  if (floor.pitch || floor.roll) throw new Error("a tilted box can't have a hole cut in it");
  const [w, h, d] = floor.size;
  const [hx, hz] = [w / 2, d / 2];
  const { x, z, radius } = hole;
  const sq = radius + HOLE_MARGIN;
  const local: Box[] = [];
  const rect = (x0: number, x1: number, z0: number, z1: number): void => {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    const b: Box = { ...structuredClone(floor), size: [round(x1 - x0), h, round(z1 - z0)] };
    b.pos = [(x0 + x1) / 2, 0, (z0 + z1) / 2];
    delete b.yaw;
    local.push(b);
  };
  rect(-hx, x - sq, -hz, hz);
  rect(x + sq, hx, -hz, hz);
  rect(x - sq, x + sq, -hz, z - sq);
  rect(x - sq, x + sq, z + sq, hz);
  const arc: Arc = { center: [x, 0, z], radius, start: 0, sweep: 360 };
  const n = pieceCount(arc, sq * Math.SQRT2 - radius);
  const ring = sectorBoxes(arc, n, floor.color, (_, from, to) => ({
    depth: squareReach(sq, from, to) - radius,
    bottom: 0,
    top: h,
  }));
  for (const piece of ring) {
    for (const [cx, cz] of corners(piece))
      if (Math.abs(cx) > hx + 1e-3 || Math.abs(cz) > hz + 1e-3)
        throw new Error(
          `it doesn't fit: the floor needs about ${round(sq + 0.3, 0.1)} m all round the hole's middle`,
        );
    local.push({ ...structuredClone(floor), size: piece.size, pos: piece.pos, yaw: piece.yaw });
  }
  const rails = railing
    ? curveBoxes(
        { ...arc, center: [x, h, z] },
        { ...CURVE_DEFAULTS, mode: 'wall', wallHeight: railing, wallThickness: RAILING_THICKNESS },
        color,
      )
    : [];
  // Out of the floor's frame into its parent's.
  const yaw = floor.yaw ?? 0;
  const [c, s] = [Math.cos(yaw * DEG), Math.sin(yaw * DEG)];
  const [px, py, pz] = floor.pos;
  const out = (b: Box): Box => {
    const [lx, ly, lz] = b.pos;
    placeNode(b, [px + lx * c + lz * s, py + ly, pz - lx * s + lz * c], yaw + (b.yaw ?? 0));
    return b;
  };
  local.forEach((b, k) => k > 0 && delete b.id);
  return { floor: local.map(out), railing: rails.map(out) };
}

/** The furthest the edge of a square (half side `sq`) round the origin is between two angles. */
function squareReach(sq: number, from: number, to: number): number {
  const at = (a: number) => sq / Math.max(Math.abs(Math.cos(a * DEG)), Math.abs(Math.sin(a * DEG)));
  let most = Math.max(at(from), at(to));
  // A corner between them is further than either end.
  for (let k = Math.ceil((Math.min(from, to) - 45) / 90); 45 + 90 * k <= Math.max(from, to); k++)
    most = sq * Math.SQRT2;
  return most;
}

/** A box's four corners across the ground, in its frame. */
function corners(b: Box): [number, number][] {
  const yaw = (b.yaw ?? 0) * DEG;
  const [ax, az] = [Math.cos(yaw), -Math.sin(yaw)];
  const [bx, bz] = [Math.sin(yaw), Math.cos(yaw)];
  const [w, d] = [b.size[0] / 2, b.size[2] / 2];
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => [b.pos[0] + i! * w * ax + j! * d * bx, b.pos[2] + i! * w * az + j! * d * bz]);
}

/** Where a hole goes for a point clicked on a floor (in its frame): its middle if near, else the grid. */
export function holeAt(lx: number, lz: number, grid: number): { x: number; z: number } {
  const snap = (v: number) =>
    Math.abs(v) < MIDDLE_SNAP ? 0 : grid ? round(Math.round(v / grid) * grid) : round(v);
  return { x: snap(lx), z: snap(lz) };
}

/** How near a floor's middle a click must be for the hole to go on it. */
export const MIDDLE_SNAP = 1;
