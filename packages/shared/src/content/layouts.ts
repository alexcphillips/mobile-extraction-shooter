import { z } from 'zod';
import { loadContent, type ContentFormat } from './format';
import { hexColorSchema, idSchema } from './schema';

/*
 * A map's bones as data (content/layouts/<map>.json, MK-3, 2026-11-12; tech/editors.md →
 * Layout board): where the areas stand, how big, how tall and how deep, where you get in,
 * the roads, the ground's levels, the landmarks and the named zones. The board (/layout)
 * edits it, the review sketch is drawn from it, and a map's generator builds the graybox
 * from it with heightAt and the footprint helpers below. Meters, x and z as in the map
 * (z grows south, as the map tab draws it), yaw in degrees (0 faces −z, as in maps).
 */

export const LAYOUT_FORMAT_VERSION = 1;

const meters = z.number().finite();
const size = z.number().positive();
const point = z.tuple([meters, meters]);

/** A rotated rectangle: its middle, full width (local x) and depth (local z), yaw. */
const rect = {
  x: meters,
  z: meters,
  w: size,
  d: size,
  yaw: z.number().finite().default(0),
};

/** A flat level of ground. Later pads win where they overlap. */
export const layoutPadSchema = z.strictObject({
  id: idSchema,
  name: z.string().optional(),
  ...rect,
  /** Its height. */
  y: meters,
  /**
   * How its edge meets the ground around: a bank sloping over `blend` meters, or a
   * retaining wall (a sheer step the generator builds a wall on).
   */
  edge: z.enum(['bank', 'wall']).default('bank'),
  blend: z.number().nonnegative().default(6),
});

/** A way in, on a side of its area (local: front is −z, as yaw 0 faces). */
export const layoutEntranceSchema = z.strictObject({
  side: z.enum(['front', 'back', 'left', 'right']),
  /** Its middle's distance from the middle of that side, along it (local +x or +z). */
  along: meters.default(0),
  width: size.default(2),
  /** Which floor it opens on (0 is the ground floor). */
  floor: z.number().int().nonnegative().default(0),
  /** What kind of way in: a door, a wide opening, a roll-up, a breakable panel, … */
  kind: z.string().optional(),
});

/** A building, a block or a yard: one rectangle. An L-shaped place is several, one poi. */
export const layoutAreaSchema = z.strictObject({
  id: idSchema,
  name: z.string().optional(),
  /** The place it belongs to (the mall, the plaza, …): drawn in one color, listed together. */
  poi: idSchema.optional(),
  ...rect,
  /**
   * Its ground floor's height; left out, the highest ground under it (District since RD-1:
   * a foundation fills down to the lowest).
   */
  y: meters.optional(),
  /** 0 for open ground (a yard, a lot, a court). */
  floors: z.number().int().nonnegative().default(1),
  /** 5 m (was 4 until 2026-11-12: the user found the bones' rooms low and cramped). */
  floorHeight: size.default(5),
  /** How much of it is built: every room, one or two rooms, or a facade only. */
  tier: z.enum(['full', 'partial', 'facade']).default('full'),
  entrances: z.array(layoutEntranceSchema).default([]),
  color: hexColorSchema.optional(),
});

export const layoutRoadSchema = z.strictObject({
  id: idSchema,
  name: z.string().optional(),
  kind: z.enum(['road', 'service', 'path']).default('road'),
  width: size.default(7),
  points: z.array(point).min(2),
});

export const layoutLandmarkSchema = z.strictObject({
  id: idSchema,
  name: z.string().optional(),
  ...rect,
  /** Its top above the ground at its middle. */
  height: size,
});

export const layoutZoneSchema = z.strictObject({
  id: idSchema,
  name: z.string().optional(),
  points: z.array(point).min(3),
});

export const layoutSchema = z
  .strictObject({
    formatVersion: z.literal(LAYOUT_FORMAT_VERSION),
    /** The map's id: content/maps/<id>.json is built from it. */
    id: idSchema,
    name: z.string().optional(),
    bounds: z.strictObject({ x0: meters, z0: meters, x1: meters, z1: meters }),
    /**
     * The hill: the ground rises in a straight line from `low` (height `lowY`) to `high`
     * (`highY`), level beyond either end. Left out, the ground is flat at 0.
     */
    slope: z.strictObject({ low: point, lowY: meters, high: point, highY: meters }).optional(),
    pads: z.array(layoutPadSchema).default([]),
    areas: z.array(layoutAreaSchema).default([]),
    roads: z.array(layoutRoadSchema).default([]),
    landmarks: z.array(layoutLandmarkSchema).default([]),
    zones: z.array(layoutZoneSchema).default([]),
    /** The poi names and colors, by id, for the board and the sketch. */
    pois: z
      .record(idSchema, z.strictObject({ name: z.string(), color: hexColorSchema }))
      .default({}),
  })
  .superRefine((l, ctx) => {
    const b = l.bounds;
    if (b.x1 <= b.x0 || b.z1 <= b.z0)
      ctx.addIssue({
        code: 'custom',
        path: ['bounds'],
        message: 'x1 and z1 must be past x0 and z0',
      });
    if (l.slope && l.slope.low[0] === l.slope.high[0] && l.slope.low[1] === l.slope.high[1])
      ctx.addIssue({ code: 'custom', path: ['slope'], message: 'low and high are the same point' });
    // Ids are unique across every kind, so a review can name any piece by id alone.
    const seen = new Set<string>();
    for (const kind of ['pads', 'areas', 'roads', 'landmarks', 'zones'] as const) {
      l[kind].forEach((p, i) => {
        if (seen.has(p.id))
          ctx.addIssue({
            code: 'custom',
            path: [kind, i, 'id'],
            message: `"${p.id}" is used twice`,
          });
        seen.add(p.id);
      });
    }
    l.areas.forEach((a, i) => {
      if (a.poi && !(a.poi in l.pois))
        ctx.addIssue({ code: 'custom', path: ['areas', i, 'poi'], message: `no poi "${a.poi}"` });
      a.entrances.forEach((e, k) => {
        const half = (e.side === 'front' || e.side === 'back' ? a.w : a.d) / 2;
        if (Math.abs(e.along) + e.width / 2 > half + 1e-6)
          ctx.addIssue({
            code: 'custom',
            path: ['areas', i, 'entrances', k],
            message: `runs past the end of its side (${2 * half} m)`,
          });
        if (a.floors > 0 && e.floor >= a.floors)
          ctx.addIssue({
            code: 'custom',
            path: ['areas', i, 'entrances', k, 'floor'],
            message: `the area has ${a.floors} floor${a.floors === 1 ? '' : 's'}`,
          });
      });
    });
  });

export type LayoutDef = z.output<typeof layoutSchema>;
export type LayoutPad = LayoutDef['pads'][number];
export type LayoutArea = LayoutDef['areas'][number];
export type LayoutEntrance = LayoutArea['entrances'][number];
export type LayoutRoad = LayoutDef['roads'][number];
export type LayoutLandmark = LayoutDef['landmarks'][number];
export type LayoutZone = LayoutDef['zones'][number];
export type LayoutRect = Pick<LayoutArea, 'x' | 'z' | 'w' | 'd' | 'yaw'>;

export const LAYOUT_FORMAT: ContentFormat<LayoutDef> = {
  kind: 'layout',
  version: LAYOUT_FORMAT_VERSION,
  schema: layoutSchema,
  migrations: {},
};

/** Walking and sprinting speeds for the board's rings (sim movement.ts's walk and sprint). */
export const LAYOUT_SPEEDS = { walk: 3.5, sprint: 6 } as const;

const RAD = Math.PI / 180;

/** A point in a rect's own frame (x along its width, z along its depth). */
export function toLocal(r: LayoutRect, x: number, z: number): [number, number] {
  const a = r.yaw * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - r.x;
  const dz = z - r.z;
  // Yaw turns about y as in three.js: local x = (cos, −sin), local z = (sin, cos).
  return [dx * c - dz * s, dx * s + dz * c];
}

/** A point in a rect's frame back in the map's. */
export function toWorld(r: LayoutRect, lx: number, lz: number): [number, number] {
  const a = r.yaw * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [r.x + lx * c + lz * s, r.z - lx * s + lz * c];
}

/** A rect's corners in the map, going round: front-left, front-right, back-right, back-left. */
export function rectCorners(r: LayoutRect): [number, number][] {
  const hw = r.w / 2;
  const hd = r.d / 2;
  return [toWorld(r, -hw, -hd), toWorld(r, hw, -hd), toWorld(r, hw, hd), toWorld(r, -hw, hd)];
}

/** How far a point is outside a rect (0 inside). */
export function rectDistance(r: LayoutRect, x: number, z: number): number {
  const [lx, lz] = toLocal(r, x, z);
  const ox = Math.max(0, Math.abs(lx) - r.w / 2);
  const oz = Math.max(0, Math.abs(lz) - r.d / 2);
  return Math.hypot(ox, oz);
}

/** The ground's height from the slope alone. */
export function slopeHeight(layout: Pick<LayoutDef, 'slope'>, x: number, z: number): number {
  const s = layout.slope;
  if (!s) return 0;
  const dx = s.high[0] - s.low[0];
  const dz = s.high[1] - s.low[1];
  const t = ((x - s.low[0]) * dx + (z - s.low[1]) * dz) / (dx * dx + dz * dz);
  return s.lowY + (s.highY - s.lowY) * Math.min(1, Math.max(0, t));
}

/**
 * The ground's height at a point: the slope, then each pad in order, flat inside it and
 * eased back to what was there over its blend (a wall's step is sheer). Generators sample
 * it for the terrain; the board and sketch shade by it.
 */
export function heightAt(layout: Pick<LayoutDef, 'slope' | 'pads'>, x: number, z: number): number {
  let y = slopeHeight(layout, x, z);
  for (const p of layout.pads) {
    const d = rectDistance(p, x, z);
    if (d === 0) y = p.y;
    else if (p.edge === 'bank' && d < p.blend) {
      const t = 1 - d / p.blend;
      y += (p.y - y) * t * t * (3 - 2 * t);
    }
  }
  return y;
}

/** An area's ground-floor height: its own, or the ground's at its middle. */
export function areaFloor(layout: Pick<LayoutDef, 'slope' | 'pads'>, a: LayoutArea): number {
  return a.y ?? heightAt(layout, a.x, a.z);
}

/**
 * An entrance's ends in the map, on its side of its area, and the side's outward normal.
 */
export function entranceEnds(
  a: LayoutArea,
  e: LayoutEntrance,
): { from: [number, number]; to: [number, number]; out: [number, number] } {
  const hw = a.w / 2;
  const hd = a.d / 2;
  const h = e.width / 2;
  // Each side's ends and outward normal, in the area's frame.
  const sides = {
    front: [
      [e.along - h, -hd],
      [e.along + h, -hd],
      [0, -1],
    ],
    back: [
      [e.along - h, hd],
      [e.along + h, hd],
      [0, 1],
    ],
    left: [
      [-hw, e.along - h],
      [-hw, e.along + h],
      [-1, 0],
    ],
    right: [
      [hw, e.along - h],
      [hw, e.along + h],
      [1, 0],
    ],
  } as const;
  const [a0, a1, normal] = sides[e.side];
  const from = toWorld(a, ...a0);
  const to = toWorld(a, ...a1);
  const o = toWorld({ ...a, x: 0, z: 0 }, normal[0], normal[1]);
  return { from, to, out: o };
}

/** Each id a layout uses, to name a new piece without a clash. */
export function layoutIds(l: LayoutDef): Set<string> {
  return new Set([...l.pads, ...l.areas, ...l.roads, ...l.landmarks, ...l.zones].map((p) => p.id));
}

/** A layout from a JSON value (migrated and checked), or a ContentError naming source. */
export function loadLayout(raw: unknown, source: string): LayoutDef {
  return loadContent(LAYOUT_FORMAT, raw, source);
}
