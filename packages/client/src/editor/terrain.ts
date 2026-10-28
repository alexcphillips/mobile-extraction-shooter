import {
  HeightGrid,
  type HeightGridDef,
  type MapFile,
  type MapNode,
  type PrefabLookup,
} from '@mes/shared';
import { nodePos, nodeYaw, round } from './doc';

/*
 * Terrain editing (session 16): brushes work on a copy of the corner heights while the
 * mouse is down, and the stroke is written to the map as one edit when it's let go. Things
 * standing on the ground then move with it, except buildings, whose concrete bases fill
 * the gap instead.
 */

const DEG = Math.PI / 180;
/** Heights in files are kept to a centimetre. */
const HEIGHT_STEP = 0.01;
/** Something whose base is this close to the ground is standing on it. */
const ON_GROUND = 0.02;

export type BrushMode = 'raise' | 'lower' | 'flatten' | 'smooth';
export const BRUSH_MODES: readonly BrushMode[] = ['raise', 'lower', 'flatten', 'smooth'];

export interface Brush {
  mode: BrushMode;
  /** Metres. */
  radius: number;
  /** Raise and lower: metres a second at the middle. Flatten and smooth: how fast, 1 is usual. */
  strength: number;
}

/** The terrain as the sim takes it, with its heights as one array. */
export interface TerrainGrid {
  minX: number;
  minZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  heights: Float64Array;
}

export function terrainGrid(map: MapFile): TerrainGrid {
  const h = map.terrain.heights;
  return {
    minX: map.terrain.origin[0],
    minZ: map.terrain.origin[1],
    cellSize: map.terrain.cellSize,
    cols: h[0]!.length - 1,
    rows: h.length - 1,
    heights: Float64Array.from(h.flat()),
  };
}

/** 1 in the middle, falling smoothly to 0 at the edge. */
const falloff = (d: number, r: number): number => {
  if (d >= r) return 0;
  const k = 1 - (d / r) ** 2;
  return k * k;
};

/**
 * One frame of a brush at (x, z), `dt` seconds long. Flatten pulls towards `level` (the
 * height where the stroke started). Returns the corners changed as [i0, i1, j0, j1]
 * (inclusive), or null if the brush is off the terrain.
 */
export function applyBrush(
  t: TerrainGrid,
  brush: Brush,
  x: number,
  z: number,
  dt: number,
  level: number,
): [number, number, number, number] | null {
  const cs = t.cellSize;
  const i0 = Math.max(0, Math.ceil((x - brush.radius - t.minX) / cs));
  const i1 = Math.min(t.cols, Math.floor((x + brush.radius - t.minX) / cs));
  const j0 = Math.max(0, Math.ceil((z - brush.radius - t.minZ) / cs));
  const j1 = Math.min(t.rows, Math.floor((z + brush.radius - t.minZ) / cs));
  if (i0 > i1 || j0 > j1) return null;
  const c = t.cols + 1;
  const h = t.heights;
  // Smoothing reads the heights as they were at the start of the frame.
  const before = brush.mode === 'smooth' ? h.slice() : h;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const w = falloff(Math.hypot(t.minX + i * cs - x, t.minZ + j * cs - z), brush.radius);
      if (w === 0) continue;
      const k = j * c + i;
      switch (brush.mode) {
        case 'raise':
        case 'lower':
          h[k]! += (brush.mode === 'raise' ? 1 : -1) * brush.strength * w * dt;
          break;
        case 'flatten':
          h[k]! += (level - h[k]!) * Math.min(1, 4 * brush.strength * w * dt);
          break;
        case 'smooth': {
          let sum = 0;
          let n = 0;
          for (const [di, dj] of NEIGHBOURS) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni > t.cols || nj > t.rows) continue;
            sum += before[nj * c + ni]!;
            n++;
          }
          h[k]! += (sum / n - before[k]!) * Math.min(1, 8 * brush.strength * w * dt);
          break;
        }
      }
    }
  }
  return [i0, i1, j0, j1];
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Writes new corner heights into the map, to a centimetre, and moves what stood on the old
 * ground onto the new: shapes, markers and prefabs (not buildings), and each point of a
 * patrol on its own. Groups aren't moved themselves, only what's in them.
 */
export function setHeights(map: MapFile, heights: ArrayLike<number>, prefabs: PrefabLookup): void {
  const cols = map.terrain.heights[0]!.length;
  const old = new HeightGrid(terrainDef(map));
  map.terrain.heights = map.terrain.heights.map((row, j) =>
    row.map((_, i) => round(heights[j * cols + i]!, HEIGHT_STEP)),
  );
  const now = new HeightGrid(terrainDef(map));
  /** How much a point (local y, world x, z) should rise, or 0 if it wasn't on the ground. */
  const rise = (wy: number, x: number, z: number): number => {
    const ground = old.heightAt(x, z);
    return Math.abs(wy - ground) <= ON_GROUND ? now.heightAt(x, z) - ground : 0;
  };
  const walk = (nodes: MapNode[], ox: number, oy: number, oz: number, yaw: number): void => {
    const c = Math.cos(yaw * DEG);
    const s = Math.sin(yaw * DEG);
    const world = (p: readonly number[]): [number, number, number] => [
      ox + p[0]! * c + p[2]! * s,
      oy + p[1]!,
      oz - p[0]! * s + p[2]! * c,
    ];
    for (const n of nodes) {
      if (n.type === 'group') {
        const [x, y, z] = world(n.pos);
        walk(n.nodes, x, y, z, yaw + nodeYaw(n));
        continue;
      }
      if (n.type === 'patrol') {
        n.points = n.points.map((p) => {
          const at = Array.isArray(p) ? p : p.pos;
          const [x, y, z] = world(at);
          const moved: [number, number, number] = [at[0], round(at[1] + rise(y, x, z)), at[2]];
          return Array.isArray(p) ? moved : { ...p, pos: moved };
        });
        continue;
      }
      if (n.type === 'prefab' && prefabs.get(n.prefab)?.building) continue;
      const [x, y, z] = world(nodePos(n));
      const dy = rise(y, x, z);
      if (dy !== 0) n.pos = [n.pos[0], round(n.pos[1] + dy), n.pos[2]];
    }
  };
  walk(map.nodes, 0, 0, 0, 0);
}

/** The map's terrain as HeightGrid takes it. */
export function terrainDef(map: MapFile): HeightGridDef {
  const h = map.terrain.heights;
  return {
    minX: map.terrain.origin[0],
    minZ: map.terrain.origin[1],
    cellSize: map.terrain.cellSize,
    cols: h[0]!.length - 1,
    rows: h.length - 1,
    heights: h.flat(),
  };
}

/** A new map: flat ground at 0 centred on the origin, with a player spawn in the middle. */
export function newMap(id: string, name: string, size: number, cellSize: number): MapFile {
  const cells = Math.max(2, Math.round(size / cellSize));
  const half = round((cells * cellSize) / 2);
  return {
    formatVersion: 3,
    id,
    name,
    environment: { sky: '#9fb3c8', fogNear: 48, fogFar: 120 },
    terrain: {
      origin: [-half, -half],
      cellSize,
      heights: Array.from({ length: cells + 1 }, () => Array<number>(cells + 1).fill(0)),
      colour: '#6b8f4e',
    },
    nodes: [{ type: 'playerSpawn', id: 'spawn', pos: [0, 0, 0] }],
    zones: [],
  };
}
