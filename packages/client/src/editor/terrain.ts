import {
  MAP_FORMAT_VERSION,
  HeightGrid,
  holeFlags,
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
 *
 * Level and hole (roadmap 19zm) are area tools instead: a drag marks every cell the
 * rectangle touches, and letting go levels their corners or makes them holes (⇧ fills them).
 */

const DEG = Math.PI / 180;
/** Heights in files are kept to a centimetre. */
const HEIGHT_STEP = 0.01;
/** Something whose base is this close to the ground is standing on it. */
const ON_GROUND = 0.02;

export type BrushMode = 'raise' | 'lower' | 'flatten' | 'smooth' | 'level' | 'hole';
export const BRUSH_MODES: readonly BrushMode[] = [
  'raise',
  'lower',
  'flatten',
  'smooth',
  'level',
  'hole',
];

/** Whether a mode is dragged as a rectangle of cells rather than painted. */
export const isAreaMode = (mode: BrushMode): boolean => mode === 'level' || mode === 'hole';

export interface Brush {
  mode: BrushMode;
  /** Metres. */
  radius: number;
  /** Raise and lower: metres a second at the middle. Flatten and smooth: how fast, 1 is usual. */
  strength: number;
  /** Level: the height to level to, or null for the ground where the drag starts. */
  height: number | null;
}

/** The terrain as the sim takes it, with its heights as one array. */
export interface TerrainGrid {
  minX: number;
  minZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  heights: Float64Array;
  /** cols × rows flags: 1 where the cell is a hole. */
  holes: Uint8Array;
}

export function terrainGrid(map: MapFile): TerrainGrid {
  const h = map.terrain.heights;
  const cols = h[0]!.length - 1;
  const rows = h.length - 1;
  return {
    minX: map.terrain.origin[0],
    minZ: map.terrain.origin[1],
    cellSize: map.terrain.cellSize,
    cols,
    rows,
    heights: Float64Array.from(h.flat()),
    holes: holeFlags(cols, rows, map.terrain.holes) ?? new Uint8Array(cols * rows),
  };
}

/** Cells [i0, i1) × [j0, j1). */
export type CellRect = [number, number, number, number];

/**
 * The cells a rectangle with corners (x0, z0) and (x1, z1) touches, at least the one under
 * the first corner, or null if it's off the terrain.
 */
export function cellRect(
  t: TerrainGrid,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): CellRect | null {
  const [ax, bx] = [(x0 - t.minX) / t.cellSize, (x1 - t.minX) / t.cellSize];
  const [az, bz] = [(z0 - t.minZ) / t.cellSize, (z1 - t.minZ) / t.cellSize];
  if (ax < 0 || az < 0 || ax >= t.cols || az >= t.rows) return null;
  const i0 = Math.max(0, Math.floor(Math.min(ax, bx)));
  const j0 = Math.max(0, Math.floor(Math.min(az, bz)));
  const i1 = Math.min(t.cols, Math.max(i0 + 1, Math.ceil(Math.max(ax, bx))));
  const j1 = Math.min(t.rows, Math.max(j0 + 1, Math.ceil(Math.max(az, bz))));
  return [i0, i1, j0, j1];
}

/** Sets every corner of the cells to a height. */
export function levelCells(t: TerrainGrid, [i0, i1, j0, j1]: CellRect, level: number): void {
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) t.heights[j * (t.cols + 1) + i] = level;
}

/** Makes the cells holes, or fills them back in. */
export function holeCells(t: TerrainGrid, [i0, i1, j0, j1]: CellRect, hole: boolean): void {
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) t.holes[j * t.cols + i] = hole ? 1 : 0;
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
 * Writes new corner heights and holes into the map, heights to a centimetre, and moves
 * what stood on the old ground onto the new: shapes, markers and prefabs (not buildings),
 * and each point of a patrol on its own. Groups aren't moved themselves, only what's in them.
 */
export function setHeights(
  map: MapFile,
  heights: ArrayLike<number>,
  holes: ArrayLike<number>,
  prefabs: PrefabLookup,
): void {
  const cols = map.terrain.heights[0]!.length;
  const old = new HeightGrid(terrainDef(map));
  map.terrain.heights = map.terrain.heights.map((row, j) =>
    row.map((_, i) => round(heights[j * cols + i]!, HEIGHT_STEP)),
  );
  const cells: [number, number][] = [];
  for (let k = 0; k < holes.length; k++)
    if (holes[k]) cells.push([k % (cols - 1), Math.floor(k / (cols - 1))]);
  if (cells.length) map.terrain.holes = cells;
  else delete map.terrain.holes;
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
  const cols = h[0]!.length - 1;
  const rows = h.length - 1;
  return {
    minX: map.terrain.origin[0],
    minZ: map.terrain.origin[1],
    cellSize: map.terrain.cellSize,
    cols,
    rows,
    heights: h.flat(),
    holes: holeFlags(cols, rows, map.terrain.holes),
  };
}

/** A side of the map: north is −z, as the map tab draws it, and east +x. */
export type Side = 'north' | 'south' | 'east' | 'west';
export const SIDES: readonly Side[] = ['north', 'south', 'east', 'west'];

/**
 * Adds `cells` rows or columns of terrain on one side. The new ground carries on at the
 * edge's height, and nothing moves in the world: adding on the north or west moves the
 * origin out instead, and the holes' cells with it.
 */
export function extendMap(map: MapFile, side: Side, cells: number): void {
  const t = map.terrain;
  const cs = t.cellSize;
  if (side === 'north' || side === 'south') {
    const edge = side === 'north' ? t.heights[0]! : t.heights.at(-1)!;
    const rows = Array.from({ length: cells }, () => [...edge]);
    t.heights = side === 'north' ? [...rows, ...t.heights] : [...t.heights, ...rows];
  } else {
    t.heights = t.heights.map((row) => {
      const edge = Array<number>(cells).fill(side === 'west' ? row[0]! : row.at(-1)!);
      return side === 'west' ? [...edge, ...row] : [...row, ...edge];
    });
  }
  if (side === 'west') t.origin = [round(t.origin[0] - cells * cs), t.origin[1]];
  if (side === 'north') t.origin = [t.origin[0], round(t.origin[1] - cells * cs)];
  if (t.holes && (side === 'west' || side === 'north')) {
    const [di, dj] = side === 'west' ? [cells, 0] : [0, cells];
    t.holes = t.holes.map(([i, j]) => [i + di, j + dj]);
  }
}

/** A new map: flat ground at 0 centred on the origin, with a player spawn in the middle. */
export function newMap(id: string, name: string, size: number, cellSize: number): MapFile {
  const cells = Math.max(2, Math.round(size / cellSize));
  const half = round((cells * cellSize) / 2);
  return {
    formatVersion: MAP_FORMAT_VERSION,
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
