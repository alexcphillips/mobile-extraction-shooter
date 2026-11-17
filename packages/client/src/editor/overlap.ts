import {
  HeightGrid,
  compileNodes,
  groundUnder,
  type CompiledBuilding,
  type CompiledNodes,
  type MapFile,
  type MapNode,
  type PrefabFile,
  type PrefabLookup,
} from '@mes/shared';
import { isTilted, nodePos, nodeYaw, type NodePath } from './doc';
import { terrainDef } from './terrain';

/*
 * Overlaps in a map (session 16). Each thing placed (a shape or a prefab, inside groups
 * too) is its solids, as the game collides with them: rectangles turned about y, from a
 * bottom to a top. Things whose solids cut into each other get a warning; buildings, whose
 * footprints may not overlap at all, are refused by the editor. Touching isn't overlapping.
 */

const DEG = Math.PI / 180;
/** How far solids must cut into each other to count, so touching faces don't. */
const PROP_TOLERANCE = 0.05;
/**
 * A cut this thin on two of its three axes is a joint, not a mistake: walls meeting at a
 * corner, a wall through a floor slab, a leg through a shelf. Those don't warn.
 */
const JOINT = 0.45;
const BUILDING_TOLERANCE = 0.01;
/** Slabs this thin (floors) at the same level may overlap: it's floor laid over floor. */
const SLAB = 0.6;
/** A sloped railing's pieces no thicker than this may overlap their neighbors. */
const RUN_THICKNESS = 0.3;
/** Ground this far above a building's floor shows through it. */
const FLOOR_TOLERANCE = 0.05;

/**
 * A rectangle centered on (x, z), turned by yaw (radians), from y0 up to y1. A tilted box
 * (a roof slope) also has slope: its sloped top and underside, which cut it inside those
 * bounds as the game collides with it.
 */
export interface Solid {
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
  y0: number;
  y1: number;
  slope?: WorldSlope;
}

/** A tilted solid's top and underside over (x, z): each its height there, plus rise per meter along world x and z. */
export interface WorldSlope {
  top: number;
  topX: number;
  topZ: number;
  under: number;
  underX: number;
  underZ: number;
}

export interface Placed {
  path: NodePath;
  solids: Solid[];
  buildings: CompiledBuilding[];
  /** Around all its solids, in x and z. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type Pair = readonly [NodePath, NodePath];

export interface Overlaps {
  /** Things whose solids overlap: a warning. */
  props: Pair[];
  /** Buildings whose footprints overlap: refused. */
  buildings: Pair[];
  /** Buildings with the ground coming up through the floor: a warning. */
  buried: NodePath[];
}

/**
 * What compileNodes gives for each prefab, in its own frame. The editor gives an edited
 * prefab a new object, and forgets them all then, since a prefab can hold others.
 */
let prefabSolids = new WeakMap<PrefabFile, CompiledNodes>();

export function forgetPrefabSolids(): void {
  prefabSolids = new WeakMap();
}

export function findOverlaps(map: MapFile, prefabs: PrefabLookup): Overlaps {
  const placed = placedNodes(map, prefabs);
  const out: Overlaps = { props: [], buildings: [], buried: [] };
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i]!;
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j]!;
      if (a.buildings.length && b.buildings.length && buildingsOverlap(a, b))
        out.buildings.push([a.path, b.path]);
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ) continue;
      if (
        a.solids.some((s) =>
          b.solids.some(
            (t) => !sameSlab(s, t) && !sameRun(s, t) && solidsOverlap(s, t, PROP_TOLERANCE, JOINT),
          ),
        )
      )
        out.props.push([a.path, b.path]);
    }
  }
  const terrain = new HeightGrid(terrainDef(map));
  for (const p of placed) {
    if (p.buildings.some((b) => groundUnder(terrain, b).high > b.y + FLOOR_TOLERANCE))
      out.buried.push(p.path);
  }
  return out;
}

/**
 * Whether two solids are floor slabs at the same level (same top and bottom, both thin),
 * which may overlap: a round hole's pieces tuck under the floor beside them, say.
 */
export function sameSlab(a: Solid, b: Solid): boolean {
  return Math.abs(a.y1 - b.y1) < 0.01 && Math.abs(a.y0 - b.y0) < 0.01 && a.y1 - a.y0 <= SLAB;
}

/**
 * Whether two solids are pieces of one sloped railing (roadmap 19zo): the same thin
 * rectangle turned the same way, in line across it, at different heights. Tilted pieces
 * collide as their bounding boxes, which overlap their neighbors'.
 */
export function sameRun(a: Solid, b: Solid): boolean {
  if (Math.abs(a.yaw - b.yaw) > 1e-6 || Math.abs(a.y0 - b.y0) < 0.01) return false;
  if (Math.abs(a.hx - b.hx) > 1e-3 || Math.abs(a.hz - b.hz) > 1e-3) return false;
  if (2 * Math.min(a.hx, a.hz) > RUN_THICKNESS) return false;
  // Across the thin side: local x is (cos, −sin) in the world, local z (sin, cos).
  const c = Math.cos(a.yaw);
  const s = Math.sin(a.yaw);
  const [ax, az] = a.hx <= a.hz ? [c, -s] : [s, c];
  return Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) < 0.01;
}

/** Whether two buildings' footprints (any height) overlap. */
export function footprintsOverlap(a: CompiledBuilding, b: CompiledBuilding): boolean {
  const flat = (f: CompiledBuilding): Solid => ({ ...f, y0: 0, y1: 1 });
  return solidsOverlap(flat(a), flat(b), BUILDING_TOLERANCE);
}

function buildingsOverlap(a: Placed, b: Placed): boolean {
  return a.buildings.some((f) => b.buildings.some((g) => footprintsOverlap(f, g)));
}

/**
 * Whether two solids cut into each other by more than `tolerance` on every axis: their
 * heights, and both rectangles' sides (the separating axis test). With `joint`, a cut no
 * deeper than that on two of its three axes (in either rectangle's frame) doesn't count.
 */
export function solidsOverlap(a: Solid, b: Solid, tolerance: number, joint = 0): boolean {
  let height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (height <= tolerance) return false;
  // Sloped: the bounds only rule out; what's shared is measured under the slopes.
  let spread: number[] | null = null;
  if (a.slope || b.slope) {
    for (const yaw of [a.yaw, b.yaw]) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (const [ax, az] of [
        [c, -s],
        [s, c],
      ] as const) {
        const d = Math.abs((b.x - a.x) * ax + (b.z - a.z) * az);
        if (extent(a, ax, az) + extent(b, ax, az) - d <= tolerance) return false;
      }
    }
    const axes = [a.yaw, b.yaw].flatMap((yaw) => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      return [
        [c, -s],
        [s, c],
      ] as const;
    });
    spread = [0, 0, 0, 0];
    height = slopedCut(a, b, tolerance, axes, spread);
    if (height <= tolerance) return false;
  }
  let isJoint = false;
  let axis = 0;
  for (const yaw of [a.yaw, b.yaw]) {
    // The rectangle's local x and z axes in the world (yaw 0 faces −z, as in compile).
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let thin = height <= joint ? 1 : 0;
    for (const [ax, az] of [
      [c, -s],
      [s, c],
    ] as const) {
      const ra = extent(a, ax, az);
      const rb = extent(b, ax, az);
      const d = Math.abs((b.x - a.x) * ax + (b.z - a.z) * az);
      let cut = ra + rb - d;
      if (spread) cut = Math.min(cut, spread[axis]!);
      axis++;
      if (cut <= tolerance) return false;
      // How deep the shared part is: no more than either solid is thick.
      if (Math.min(cut, 2 * ra, 2 * rb) <= joint) thin++;
    }
    if (thin >= 2) isJoint = true;
  }
  return !isJoint;
}

/** A box's slope (rises along its own x and z) in the world, its rectangle at yaw. */
function worldSlope(
  b: { top: number; topX: number; topZ: number; under: number; underX: number; underZ: number },
  yaw: number,
  y: number,
): WorldSlope {
  // Local x is (cos, −sin) in the world, local z (sin, cos).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    top: b.top + y,
    topX: b.topX * c + b.topZ * s,
    topZ: -b.topX * s + b.topZ * c,
    under: b.under + y,
    underX: b.underX * c + b.underZ * s,
    underZ: -b.underX * s + b.underZ * c,
  };
}

/** A solid's top and underside at world (x, z): its bounds, cut by its slope. */
function topAt(r: Solid, x: number, z: number): number {
  if (!r.slope) return r.y1;
  const t = r.slope.top + r.slope.topX * (x - r.x) + r.slope.topZ * (z - r.z);
  return Math.min(r.y1, t);
}
function underAt(r: Solid, x: number, z: number): number {
  if (!r.slope) return r.y0;
  const u = r.slope.under + r.slope.underX * (x - r.x) + r.slope.underZ * (z - r.z);
  return Math.max(r.y0, u);
}

/** Whether world (x, z) is inside a solid's rectangle. */
function insideRect(r: Solid, x: number, z: number): boolean {
  const c = Math.cos(r.yaw);
  const s = Math.sin(r.yaw);
  const dx = x - r.x;
  const dz = z - r.z;
  return Math.abs(dx * c - dz * s) <= r.hx + 1e-6 && Math.abs(dx * s + dz * c) <= r.hz + 1e-6;
}

/** Sample spacing over a sloped pair's rectangles, in meters. */
const SLOPE_STEP = 0.1;

/**
 * Where two solids, one or both sloped, really share space: sampled over both rectangles,
 * the deepest shared height, and how far the spots sharing more than tolerance spread
 * along each of the axes given (an extent each, as a cut). Bounds alone overlap all along
 * a roof's ridge and into the ceiling under its eaves.
 */
function slopedCut(
  a: Solid,
  b: Solid,
  tolerance: number,
  axes: readonly (readonly [number, number])[],
  spread: number[],
): number {
  let deepest = -Infinity;
  const lo = axes.map(() => Infinity);
  const hi = axes.map(() => -Infinity);
  for (const [r, o] of [
    [a, b],
    [b, a],
  ] as const) {
    const c = Math.cos(r.yaw);
    const s = Math.sin(r.yaw);
    const nx = Math.max(1, Math.ceil((2 * r.hx) / SLOPE_STEP));
    const nz = Math.max(1, Math.ceil((2 * r.hz) / SLOPE_STEP));
    for (let i = 0; i <= nx; i++) {
      const lx = -r.hx + (2 * r.hx * i) / nx;
      for (let k = 0; k <= nz; k++) {
        const lz = -r.hz + (2 * r.hz * k) / nz;
        const x = r.x + lx * c + lz * s;
        const z = r.z - lx * s + lz * c;
        if (!insideRect(o, x, z)) continue;
        const h =
          Math.min(topAt(a, x, z), topAt(b, x, z)) - Math.max(underAt(a, x, z), underAt(b, x, z));
        if (h > deepest) deepest = h;
        if (h <= tolerance) continue;
        axes.forEach(([ax, az], m) => {
          const p = x * ax + z * az;
          lo[m] = Math.min(lo[m]!, p);
          hi[m] = Math.max(hi[m]!, p);
        });
      }
    }
  }
  axes.forEach((_, m) => (spread[m] = hi[m]! >= lo[m]! ? hi[m]! - lo[m]! + SLOPE_STEP : 0));
  return deepest;
}

/** Half the length of a rectangle's shadow on a unit axis. */
function extent(r: Solid, ax: number, az: number): number {
  const c = Math.cos(r.yaw);
  const s = Math.sin(r.yaw);
  return r.hx * Math.abs(c * ax - s * az) + r.hz * Math.abs(s * ax + c * az);
}

/** Every shape and prefab in the map, groups opened, with its solids in world space. */
export function placedNodes(map: MapFile, prefabs: PrefabLookup): Placed[] {
  const out: Placed[] = [];
  const walk = (nodes: readonly MapNode[], f: Frame, path: number[]): void => {
    nodes.forEach((n, i) => {
      const p = [...path, i];
      const [x, y, z] = place(f, nodePos(n));
      const g: Frame = { x, y, z, yaw: f.yaw + nodeYaw(n) * DEG };
      // A tilted group's nodes don't fit a yaw-only frame: its bounds stand for them.
      if (n.type === 'group' && !isTilted(n)) return walk(n.nodes, g, p);
      const local = solidsOf(n, prefabs, map.colors ?? {});
      if (!local) return;
      const solids = [
        ...local.boxes.map((b) => {
          const s = toWorld(g, b.x, b.z, b.yaw, b.hx, b.hz, b.y - b.hy, b.y + b.hy);
          if (b.slope) s.slope = worldSlope(b.slope, s.yaw, g.y);
          return s;
        }),
        ...local.ramps.map((r) => toWorld(g, r.x, r.z, r.yaw, r.hx, r.hz, r.bottom, r.high)),
      ];
      const buildings = local.buildings.map((b) => {
        const s = toWorld(g, b.x, b.z, b.yaw, b.hx, b.hz, b.y, b.y);
        return { ...b, x: s.x, y: s.y0, z: s.z, yaw: s.yaw };
      });
      if (!solids.length && !buildings.length) return;
      const reach = solids.map((s) => Math.hypot(s.hx, s.hz));
      out.push({
        path: p,
        solids,
        buildings,
        minX: Math.min(...solids.map((s, k) => s.x - reach[k]!)),
        maxX: Math.max(...solids.map((s, k) => s.x + reach[k]!)),
        minZ: Math.min(...solids.map((s, k) => s.z - reach[k]!)),
        maxZ: Math.max(...solids.map((s, k) => s.z + reach[k]!)),
      });
    });
  };
  walk(map.nodes, { x: 0, y: 0, z: 0, yaw: 0 }, []);
  return out;
}

/** A node's solids and buildings in its own frame, or null for markers and the broken. */
function solidsOf(
  n: MapNode,
  prefabs: PrefabLookup,
  colors: Readonly<Record<string, string>>,
): CompiledNodes | null {
  if (isTilted(n)) return tryCompile({ ...n, pos: [0, 0, 0], yaw: 0 } as MapNode, prefabs, colors);
  if (n.type === 'prefab') {
    const prefab = prefabs.get(n.prefab);
    if (!prefab) return null;
    let solids = prefabSolids.get(prefab) ?? null;
    if (!solids) {
      // Its own colors, so overrides naming the map's slots don't matter here.
      solids = tryCompile({ type: 'prefab', prefab: n.prefab, pos: [0, 0, 0] }, prefabs, {});
      if (!solids) return null;
      prefabSolids.set(prefab, solids);
    }
    return solids;
  }
  // Ladders stand against walls and markers aren't solid.
  if (n.type !== 'box' && n.type !== 'cylinder' && n.type !== 'ramp' && n.type !== 'stairs')
    return null;
  return tryCompile({ ...n, pos: [0, 0, 0], yaw: 0 }, prefabs, colors);
}

function tryCompile(
  n: MapNode,
  prefabs: PrefabLookup,
  colors: Readonly<Record<string, string>>,
): CompiledNodes | null {
  try {
    return compileNodes([n], prefabs, colors);
  } catch {
    return null;
  }
}

interface Frame {
  x: number;
  y: number;
  z: number;
  /** Radians. */
  yaw: number;
}

function place(f: Frame, [lx, ly, lz]: readonly number[]): [number, number, number] {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return [f.x + lx! * c + lz! * s, f.y + ly!, f.z - lx! * s + lz! * c];
}

function toWorld(
  f: Frame,
  x: number,
  z: number,
  yaw: number,
  hx: number,
  hz: number,
  y0: number,
  y1: number,
): Solid {
  const [wx, , wz] = place(f, [x, 0, z]);
  return { x: wx, z: wz, yaw: f.yaw + yaw, hx, hz, y0: f.y + y0, y1: f.y + y1 };
}
