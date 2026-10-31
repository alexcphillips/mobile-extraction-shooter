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
import { nodePos, nodeYaw, type NodePath } from './doc';
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
/** Ground this far above a building's floor shows through it. */
const FLOOR_TOLERANCE = 0.05;

/** A rectangle centred on (x, z), turned by yaw (radians), from y0 up to y1. */
export interface Solid {
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
  y0: number;
  y1: number;
}

interface Placed {
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
      if (a.solids.some((s) => b.solids.some((t) => solidsOverlap(s, t, PROP_TOLERANCE, JOINT))))
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
  const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (height <= tolerance) return false;
  let isJoint = false;
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
      const cut = ra + rb - d;
      if (cut <= tolerance) return false;
      // How deep the shared part is: no more than either solid is thick.
      if (Math.min(cut, 2 * ra, 2 * rb) <= joint) thin++;
    }
    if (thin >= 2) isJoint = true;
  }
  return !isJoint;
}

/** Half the length of a rectangle's shadow on a unit axis. */
function extent(r: Solid, ax: number, az: number): number {
  const c = Math.cos(r.yaw);
  const s = Math.sin(r.yaw);
  return r.hx * Math.abs(c * ax - s * az) + r.hz * Math.abs(s * ax + c * az);
}

/** Every shape and prefab in the map, groups opened, with its solids in world space. */
function placedNodes(map: MapFile, prefabs: PrefabLookup): Placed[] {
  const out: Placed[] = [];
  const walk = (nodes: readonly MapNode[], f: Frame, path: number[]): void => {
    nodes.forEach((n, i) => {
      const p = [...path, i];
      const [x, y, z] = place(f, nodePos(n));
      const g: Frame = { x, y, z, yaw: f.yaw + nodeYaw(n) * DEG };
      if (n.type === 'group') return walk(n.nodes, g, p);
      const local = solidsOf(n, prefabs, map.colours ?? {});
      if (!local) return;
      const solids = [
        ...local.boxes.map((b) => toWorld(g, b.x, b.z, b.yaw, b.hx, b.hz, b.y - b.hy, b.y + b.hy)),
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
  colours: Readonly<Record<string, string>>,
): CompiledNodes | null {
  if (n.type === 'prefab') {
    const prefab = prefabs.get(n.prefab);
    if (!prefab) return null;
    let solids = prefabSolids.get(prefab) ?? null;
    if (!solids) {
      // Its own colours, so overrides naming the map's slots don't matter here.
      solids = tryCompile({ type: 'prefab', prefab: n.prefab, pos: [0, 0, 0] }, prefabs, {});
      if (!solids) return null;
      prefabSolids.set(prefab, solids);
    }
    return solids;
  }
  // Ladders stand against walls and markers aren't solid.
  if (n.type !== 'box' && n.type !== 'cylinder' && n.type !== 'ramp' && n.type !== 'stairs')
    return null;
  return tryCompile({ ...n, pos: [0, 0, 0], yaw: 0 }, prefabs, colours);
}

function tryCompile(
  n: MapNode,
  prefabs: PrefabLookup,
  colours: Readonly<Record<string, string>>,
): CompiledNodes | null {
  try {
    return compileNodes([n], prefabs, colours);
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
