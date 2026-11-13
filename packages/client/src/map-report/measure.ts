// The map report's measures (MK-4, 2026-11-12): what level-design.md asks of a layout,
// measured on the real collision world and nav grid instead of guessed. Pure (no three.js,
// no DOM) so scripts/map-report.mjs runs it in Node and the map editor can paint the same
// rasters on the ground (MK-8). Measures and yardsticks: docs/level-design.md → Map report.
import {
  CollisionWorld,
  DIR_Q,
  DIR_R,
  MOVEMENT,
  NavGrid,
  type CompiledMap,
  type CompiledMarker,
} from '@mes/shared';

/** The numbers the measures use; level-design.md's table is where they come from. */
export const REPORT = {
  /** Standing eye above the feet. */
  eye: MOVEMENT.standHeight - MOVEMENT.eyeBelowTop,
  /** The AI's sight, and the long line level-design.md counts. */
  longLine: 70,
  /** A mid line: the mall's indoor lines are held near this. */
  midLine: 30,
  /** District's open-ground cap: no crossing longer with nothing on it. */
  openCap: 40,
  /**
   * Open ground with something this near is a lane beside cover, not open ground: a
   * crossing is a straight run over ground with nothing within a dive of it (2026-11-12).
   */
  cover: 3,
  /** Something this far above the ground (or foliage) is "something on it". */
  onGround: 0.5,
  /** A raised spot this far above the terrain under it, under open sky, is a perch. */
  perch: 2.5,
  /** Jump, then vault: the highest ledge a player gets onto from the ground. */
  climb: 1.7,
  /** Falls past this cost a little health (keep to it); past safeFall, a real fall. */
  dropKeep: 3.3,
  safeFall: 3.9,
  /** A drop past this breaks both legs: not a way anyone takes on purpose. */
  brokenLegs: 7,
  /** An island smaller than this many nav nodes (4 m²) isn't listed. */
  islandNodes: 16,
  walk: MOVEMENT.walkSpeed,
  sprint: MOVEMENT.sprintSpeed,
} as const;

/** Offsets across the way a crossing is checked at: a body's middle and both sides. */
const PASS_SIDE = [-0.25, 0, 0.25];

/** Columns within a meter (two cells) on the axes and diagonals, for climbing onto a ledge. */
const REACH_Q = [1, 2, -1, -2, 0, 0, 0, 0, 1, 2, -1, -2, 1, 2, -1, -2];
const REACH_R = [0, 0, 0, 0, 1, 2, -1, -2, 1, 2, 1, 2, -1, -2, -1, -2];

/** Eight unit directions on the ground, east first, counterclockwise seen from above. */
const DIRS: readonly [number, number][] = Array.from({ length: 8 }, (_, k) => {
  const a = (k * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)] as [number, number];
});

export interface NamedSpot {
  name: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Lines are counted by look: a spot every meter, eight headings from each at standing eye
 * height, so 70 m+ is the share of looks that see that far (a spot with one long line in
 * eight counts an eighth, not whole: almost every spot has one somewhere).
 */
export interface AreaStats {
  name: string;
  /** Standing spots under open sky, and their looks seeing 30 m and 70 m or more. */
  outdoor: number;
  outdoor30: number;
  outdoor70: number;
  /** Spots under a roof, and their looks seeing 30 m or more. */
  indoor: number;
  indoor30: number;
  /** The biggest circle of open ground, its diameter in meters, and where. */
  openCircle: { d: number; x: number; z: number };
  /** The longest straight run over exposed ground, and where it starts and ends. */
  openRun: { length: number; x0: number; z0: number; x1: number; z1: number };
  /** Square meters of exposed ground lying on a run longer than REPORT.openCap. */
  overCap: number;
}

/**
 * How a player gets onto a nav component: the AI's main area; by jump, vault or drop from
 * there; by ladder somewhere on the way; into but not back out of (a pit); not at all; or
 * not at all because it's outside the play edge (touching the map's edge).
 */
export type Reach = 'AI' | 'climb' | 'ladder' | 'pit' | 'none' | 'outside';

/** Where a player gets onto a component: the spot they climb, drop or ladder from. */
export interface Way {
  ladder: boolean;
  x: number;
  y: number;
  z: number;
}

export interface Island {
  component: number;
  via?: Way | undefined;
  nodes: number;
  x: number;
  y: number;
  z: number;
  /** Height over the terrain under its middle. */
  above: number;
  area: string;
  reach: Reach;
}

export interface Perch {
  x: number;
  y: number;
  z: number;
  above: number;
  /** Square meters. */
  size: number;
  area: string;
  reach: Reach;
  via?: Way | undefined;
  /** Of eight directions from its middle at eye height, how many see 70 m or more. */
  long: number;
}

export interface Drop {
  x: number;
  z: number;
  /** Height fallen, the worst in this 4 m patch. */
  drop: number;
  /** Edges in the patch past REPORT.dropKeep. */
  edges: number;
  area: string;
  /** Whether the AI walks the ground it's dropped from. */
  ai: boolean;
  /** For ground only a player gets onto: where they get on. */
  via?: Way | undefined;
}

/** Rasters at 1 m, one value per cell, for heatmaps and editor overlays. */
export interface Rasters {
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** 0 no standing spot; 1 lines under 30 m; 2 a 30 m line; 3 a 70 m line (the best spot in the cell). */
  lines: Uint8Array;
  /**
   * 0 not open ground (building, water, steep, a deck); 1 something on it; 2 open, with
   * something within REPORT.cover; 3 exposed (nothing that near); 4 exposed, on a straight
   * run over REPORT.openCap.
   */
  open: Uint8Array;
  /** Nav: 0 none; 1 the AI's main area; 2 an island players reach; 3 an island nobody does (or a pit); 4 a perch; 5 a drop past dropKeep. */
  nav: Uint8Array;
}

export interface Measures {
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  navNodes: number;
  mainShare: number;
  areas: AreaStats[];
  islands: Island[];
  /** Where a player gets onto ground outside the play edge. */
  escapes: Way[];
  perches: Perch[];
  drops: Drop[];
  /** Walking distance along the nav grid (8-way, a few percent over a smoothed path). */
  walks: { from: string[]; to: string[]; meters: number[][] };
  spawns: { name: string; nearest: number; farthest: number; nearestTo: string }[];
  rasters: Rasters;
}

export interface MeasureOptions {
  /** Only this area's spots are measured for lines and open ground (by name, any case). */
  zone?: string | undefined;
}

type MapLabel = Extract<CompiledMarker, { type: 'mapLabel' }>;
const mapLabels = (map: CompiledMap): MapLabel[] =>
  map.markers.filter((m): m is MapLabel => m.type === 'mapLabel');

/** The map's named areas: its 'area' labels, or every label if it has none. */
export function namedAreas(map: CompiledMap): NamedSpot[] {
  const labels = mapLabels(map);
  const areas = labels.filter((m) => m.size === 'area');
  const named = (areas.length ? areas : labels).map((m) => ({
    name: m.text,
    x: m.x,
    y: m.y,
    z: m.z,
  }));
  if (named.length) return named;
  // No labels yet (a new map, or Northpoint): the map as one area.
  const t = map.world.terrain;
  const x = t.minX + (t.cols * t.cellSize) / 2;
  const z = t.minZ + (t.rows * t.cellSize) / 2;
  return [{ name: 'Whole map', x, y: 0, z }];
}

export function measureMap(
  map: CompiledMap,
  world: CollisionWorld,
  nav: NavGrid,
  opts: MeasureOptions = {},
): Measures {
  const t = world.terrain;
  const areas = namedAreas(map);
  const labels = mapLabels(map);
  const areaIndex = (x: number, z: number): number => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i]!;
      const d = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  /** The nearest label of any size: for naming a perch or a drop. */
  const placeName = (x: number, z: number): string => {
    let best = '';
    let bestD = Infinity;
    for (const m of labels) {
      const d = (m.x - x) ** 2 + (m.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = m.text;
      }
    }
    return best ? `${best} (${Math.round(Math.sqrt(bestD))} m)` : '';
  };
  const zone = opts.zone?.toLowerCase();
  const zoneArea = zone ? areas.findIndex((a) => a.name.toLowerCase().includes(zone)) : -1;
  if (zone && zoneArea < 0)
    throw new Error(`no area "${opts.zone}"; areas: ${areas.map((a) => a.name).join(', ')}`);

  const minX = t.minX;
  const minZ = t.minZ;
  const cols = Math.floor((t.maxX - t.minX) / 1);
  const rows = Math.floor((t.maxZ - t.minZ) / 1);
  const cells = cols * rows;
  const lines = new Uint8Array(cells);
  const open = new Uint8Array(cells);
  const navR = new Uint8Array(cells);
  const cellArea = new Int16Array(cells).fill(-1);

  const stats: AreaStats[] = areas.map((a) => ({
    name: a.name,
    outdoor: 0,
    outdoor30: 0,
    outdoor70: 0,
    indoor: 0,
    indoor30: 0,
    openCircle: { d: 0, x: 0, z: 0 },
    openRun: { length: 0, x0: 0, z0: 0, x1: 0, z1: 0 },
    overCap: 0,
  }));

  const edgeDist = (x: number, z: number, dx: number, dz: number): number => {
    const ex = dx > 1e-9 ? (t.maxX - x) / dx : dx < -1e-9 ? (t.minX - x) / dx : Infinity;
    const ez = dz > 1e-9 ? (t.maxZ - z) / dz : dz < -1e-9 ? (t.minZ - z) / dz : Infinity;
    return Math.min(ex, ez);
  };
  /** Of eight looks from an eye, how many see 30 m or more, and 70 m or more (bounded by the map's edge). */
  const looks = { mid: 0, long: 0 };
  const lookFrom = (x: number, eye: number, z: number): typeof looks => {
    looks.mid = 0;
    looks.long = 0;
    for (const [dx, dz] of DIRS) {
      const limit = Math.min(REPORT.longLine, edgeDist(x, z, dx, dz));
      if (limit < REPORT.midLine) continue;
      const d = world.raycast(x, eye, z, dx, 0, dz, limit, undefined, true);
      const clear = d === Infinity ? limit : d;
      if (clear < REPORT.midLine || world.foliageWithin(x, eye, z, dx, 0, dz, REPORT.midLine))
        continue;
      looks.mid++;
      if (clear >= REPORT.longLine && !world.foliageWithin(x, eye, z, dx, 0, dz, REPORT.longLine))
        looks.long++;
    }
    return looks;
  };
  /** The ground under a spot: the terrain, or a water surface over it; NaN over a hole. */
  const groundAt = (x: number, z: number): number =>
    t.holeAt(x, z) ? NaN : t.heightAt(x, z) + world.waterDepth(x, z);
  const skyAbove = (x: number, y: number, z: number): boolean =>
    world.raycast(x, y + REPORT.eye + 0.1, z, 0, 1, 0, 60) === Infinity;

  // Nav components: the AI's main area, and how a player gets onto every other one.
  const sizes = nav.componentSizes;
  const main = mainComponent(map, nav);
  const total = nav.nodeCount;
  const near = (x: number, z: number, radius: number, visit: (n: number) => void): void => {
    const q0 = Math.max(0, Math.floor((x - radius - nav.minX) / nav.cellSize));
    const q1 = Math.min(nav.cols - 1, Math.floor((x + radius - nav.minX) / nav.cellSize));
    const r0 = Math.max(0, Math.floor((z - radius - nav.minZ) / nav.cellSize));
    const r1 = Math.min(nav.rows - 1, Math.floor((z + radius - nav.minZ) / nav.cellSize));
    for (let r = r0; r <= r1; r++)
      for (let q = q0; q <= q1; q++) {
        const col = r * nav.cols + q;
        for (let n = nav.columnStart[col]!; n < nav.columnStart[col + 1]!; n++) visit(n);
      }
  };
  // Ways between components a player takes and the AI doesn't: a jump and vault up onto a
  // ledge within a meter (a wall's thickness and the grid's clearance part a ledge from the
  // ground), a drop off one (up to a fall that breaks legs), and ladders both ways.
  const edges = new Map<number, Map<number, Way>>();
  const addEdge = (a: number, b: number, ladder: boolean, at: number): void => {
    let m = edges.get(a);
    if (!m) edges.set(a, (m = new Map()));
    const was = m.get(b);
    if (!was || (was.ladder && !ladder))
      m.set(b, { ladder, x: nav.nodeX(at), y: nav.heights[at]!, z: nav.nodeZ(at) });
  };
  const hasEdge = (a: number, b: number): boolean => edges.get(a)?.has(b) ?? false;
  /** Open air from the low spot up past the high one, and across between them at that height. */
  const passable = (lo: number, hi: number): boolean => {
    const lx = nav.nodeX(lo);
    const lz = nav.nodeZ(lo);
    const hx = nav.nodeX(hi);
    const hz = nav.nodeZ(hi);
    const ly = nav.heights[lo]!;
    const top = nav.heights[hi]! + 0.6;
    if (world.raycast(lx, ly + 0.1, lz, 0, 1, 0, top - ly - 0.1) !== Infinity) return false;
    if (world.overlaps(lx, lz, 0.06, ly + MOVEMENT.stepUp, top)) return false;
    return crossable(hx, hz, lx, lz, top - 0.6);
  };
  /**
   * Whether a body gets from one spot to another standing at feet height y: nothing solid
   * from a step above y to a head's height along the way, at its middle and both sides,
   * sampled every 10 cm so a fence of bars stops it. By overlap, not raycast: rays pass
   * invisible walls (blockers), which bodies don't.
   */
  const crossable = (ax: number, az: number, bx: number, bz: number, y: number): boolean => {
    const d = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / d;
    const uz = (bz - az) / d;
    for (const side of PASS_SIDE)
      for (let s = 0; s <= d; s += 0.1) {
        const px = ax + ux * s - uz * side;
        const pz = az + uz * s + ux * side;
        if (world.overlaps(px, pz, 0.06, y + MOVEMENT.stepUp, y + MOVEMENT.standHeight - 0.1))
          return false;
      }
    return true;
  };
  const outside = new Set<number>();
  const edgeBand = 1;
  for (let n = 0; n < total; n++) {
    const comp = nav.component[n]!;
    const col = nav.nodeColumn[n]!;
    const q = col % nav.cols;
    const r = Math.floor(col / nav.cols);
    const h = nav.heights[n]!;
    const x = nav.x(q);
    const z = nav.z(r);
    if (
      x < t.minX + edgeBand ||
      x > t.maxX - edgeBand ||
      z < t.minZ + edgeBand ||
      z > t.maxZ - edgeBand
    )
      outside.add(comp);
    for (let k = 0; k < 16; k++) {
      const nq = q + REACH_Q[k]!;
      const nr = r + REACH_R[k]!;
      if (nq < 0 || nr < 0 || nq >= nav.cols || nr >= nav.rows) continue;
      const ncol = nr * nav.cols + nq;
      for (let m = nav.columnStart[ncol]!; m < nav.columnStart[ncol + 1]!; m++) {
        const other = nav.component[m]!;
        if (other === comp || hasEdge(comp, other)) continue;
        const rise = nav.heights[m]! - h;
        if (rise > REPORT.climb || rise < -REPORT.brokenLegs) continue;
        if (rise >= 0 ? passable(n, m) : passable(m, n)) addEdge(comp, other, false, n);
      }
    }
  }
  for (const l of map.world.ladders) {
    const foot = new Map<number, number>();
    const head = new Map<number, number>();
    near(l.x, l.z, 1.5, (n) => {
      const h = nav.heights[n]!;
      if (Math.abs(h - l.bottom) < 0.6) foot.set(nav.component[n]!, n);
      if (h > l.top - 1.5 && h < l.top + 1) head.set(nav.component[n]!, n);
    });
    for (const [a, na] of foot)
      for (const [b, nb] of head)
        if (a !== b) {
          addEdge(a, b, true, na);
          addEdge(b, a, true, nb);
        }
  }
  // Reached from the main area (by ladder if the first way found needs one), and whether
  // the main area is reached back: a component you get into but not out of is a pit.
  const reach = new Map<number, Reach>();
  const via = new Map<number, Way>();
  reach.set(main, 'AI');
  const queue = [main];
  while (queue.length) {
    const a = queue.shift()!;
    for (const [b, way] of edges.get(a) ?? []) {
      if (reach.has(b)) continue;
      reach.set(b, way.ladder || reach.get(a) === 'ladder' ? 'ladder' : 'climb');
      via.set(b, way);
      queue.push(b);
    }
  }
  const back = new Set<number>([main]);
  const reverse = new Map<number, number[]>();
  for (const [a, m] of edges)
    for (const b of m.keys()) reverse.set(b, [...(reverse.get(b) ?? []), a]);
  queue.push(main);
  while (queue.length) {
    const b = queue.shift()!;
    for (const a of reverse.get(b) ?? [])
      if (!back.has(a)) {
        back.add(a);
        queue.push(a);
      }
  }
  for (const [comp] of reach) if (!back.has(comp)) reach.set(comp, 'pit');
  // Reached ground outside the play edge: a way out of the map.
  const escapes: Way[] = [];
  for (const comp of outside)
    if (reach.has(comp) && comp !== main) {
      const way = via.get(comp);
      if (way) escapes.push(way);
      reach.delete(comp);
    }
  // A strip one node wide (a rail's or a wall's top) is stood on but isn't a place.
  const wide = new Uint8Array(sizes.length);
  for (let n = 0; n < total; n++)
    if ((nav.links[n]! & 0b1111) === 0b1111) wide[nav.component[n]!] = 1;
  const strip = (comp: number): boolean => !wide[comp];
  const reachOf = (comp: number): Reach =>
    reach.get(comp) ?? (outside.has(comp) ? 'outside' : 'none');
  /** Ground a player stands on: measured for lines and open ground. */
  const walked = (comp: number): boolean => reach.has(comp) && !strip(comp);

  // Lines of sight and open ground, a spot every meter (every other nav column).
  const bottoms = new Float64Array(64);
  const tops = new Float64Array(64);
  const somethingOn = (x: number, z: number, g: number): boolean => {
    for (const [ox, oz] of [
      [-0.25, -0.25],
      [0.25, -0.25],
      [-0.25, 0.25],
      [0.25, 0.25],
    ] as const) {
      const n = world.solidsAt(x + ox, z + oz, bottoms, tops);
      for (let k = 0; k < n; k++)
        if (tops[k]! > g + REPORT.onGround && bottoms[k]! < g + MOVEMENT.standHeight) return true;
      if (world.foliageWithin(x + ox, g + REPORT.onGround, z + oz, 0, 1, 0, 1.3)) return true;
    }
    return false;
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const q = i * 2;
      const r = j * 2;
      if (q >= nav.cols || r >= nav.rows) continue;
      const c = j * cols + i;
      const x = nav.x(q);
      const z = nav.z(r);
      const ai = areaIndex(x, z);
      cellArea[c] = ai;
      if (zoneArea >= 0 && ai !== zoneArea) continue;
      const col = r * nav.cols + q;
      const ground = t.holeAt(x, z) ? NaN : t.heightAt(x, z);
      for (let n = nav.columnStart[col]!; n < nav.columnStart[col + 1]!; n++) {
        if (!walked(nav.component[n]!)) continue;
        const y = nav.heights[n]!;
        const outdoor = skyAbove(x, y, z);
        const l = lookFrom(x, y + REPORT.eye, z);
        lines[c] = Math.max(lines[c]!, l.long ? 3 : l.mid ? 2 : 1);
        const s = stats[ai];
        if (s) {
          if (outdoor) {
            s.outdoor += 8;
            s.outdoor30 += l.mid;
            s.outdoor70 += l.long;
          } else {
            s.indoor += 8;
            s.indoor30 += l.mid;
          }
        }
        if (outdoor && Math.abs(y - ground) < 0.6 && !open[c])
          open[c] = somethingOn(x, z, y) ? 1 : 2;
      }
    }
  }

  // The biggest open circle: a two-pass chamfer distance to the nearest cell that isn't open.
  const dist = new Float32Array(cells);
  for (let c = 0; c < cells; c++) dist[c] = open[c]! >= 2 ? 1e9 : 0;
  const relax = (c: number, i: number, j: number, di: number, dj: number, w: number): void => {
    const ni = i + di;
    const nj = j + dj;
    const nd = ni < 0 || nj < 0 || ni >= cols || nj >= rows ? 0 : dist[nj * cols + ni]!;
    if (nd + w < dist[c]!) dist[c] = nd + w;
  };
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i;
      if (!dist[c]) continue;
      relax(c, i, j, -1, 0, 1);
      relax(c, i, j, 0, -1, 1);
      relax(c, i, j, -1, -1, Math.SQRT2);
      relax(c, i, j, 1, -1, Math.SQRT2);
    }
  for (let j = rows - 1; j >= 0; j--)
    for (let i = cols - 1; i >= 0; i--) {
      const c = j * cols + i;
      if (!dist[c]) continue;
      relax(c, i, j, 1, 0, 1);
      relax(c, i, j, 0, 1, 1);
      relax(c, i, j, 1, 1, Math.SQRT2);
      relax(c, i, j, -1, 1, Math.SQRT2);
    }
  // Exposed: open ground with nothing within a dive (REPORT.cover) of it.
  for (let c = 0; c < cells; c++) if (open[c] === 2 && dist[c]! > REPORT.cover) open[c] = 3;
  // Straight runs over exposed ground on four axes; cells on one over the cap become 4.
  const axes: [number, number, number][] = [
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
  ];
  for (const [di, dj, step] of axes) {
    const starts: [number, number][] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const pi = i - di;
        const pj = j - dj;
        if (pi < 0 || pj < 0 || pi >= cols || pj >= rows) starts.push([i, j]);
      }
    for (const [si, sj] of starts) {
      let i = si;
      let j = sj;
      let count = 0;
      const close = (ei: number, ej: number): void => {
        const length = count * step;
        if (length > REPORT.openCap) {
          for (let k = 0; k < count; k++) {
            const c = (ej - dj * k) * cols + (ei - di * k);
            open[c] = 4;
          }
        }
        const mid = (ej - dj * Math.floor(count / 2)) * cols + (ei - di * Math.floor(count / 2));
        const s = stats[cellArea[mid] ?? -1];
        if (s && length > s.openRun.length) {
          const fi = ei - di * (count - 1);
          const fj = ej - dj * (count - 1);
          s.openRun = {
            length,
            x0: minX + fi + 0.25,
            z0: minZ + fj + 0.25,
            x1: minX + ei + 0.25,
            z1: minZ + ej + 0.25,
          };
        }
      };
      while (i >= 0 && j >= 0 && i < cols && j < rows) {
        const o = open[j * cols + i]!;
        if (o >= 3) count++;
        else if (count) {
          close(i - di, j - dj);
          count = 0;
        }
        i += di;
        j += dj;
      }
      if (count) close(i - di, j - dj);
    }
  }
  for (let c = 0; c < cells; c++) {
    const s = stats[cellArea[c] ?? -1];
    if (!s) continue;
    if (open[c] === 4) s.overCap++;
    const d = 2 * dist[c]! - 1;
    if (dist[c]! > 0 && d > s.openCircle.d)
      s.openCircle = { d, x: minX + (c % cols) + 0.25, z: minZ + Math.floor(c / cols) + 0.25 };
  }

  // Islands: sums per component.
  const sumX = new Float64Array(sizes.length);
  const sumY = new Float64Array(sizes.length);
  const sumZ = new Float64Array(sizes.length);
  for (let n = 0; n < total; n++) {
    const comp = nav.component[n]!;
    sumX[comp]! += nav.nodeX(n);
    sumY[comp]! += nav.heights[n]!;
    sumZ[comp]! += nav.nodeZ(n);
  }
  const islands: Island[] = [];
  for (let k = 0; k < sizes.length; k++) {
    if (k === main || sizes[k]! < REPORT.islandNodes || outside.has(k) || strip(k)) continue;
    const x = sumX[k]! / sizes[k]!;
    const y = sumY[k]! / sizes[k]!;
    const z = sumZ[k]! / sizes[k]!;
    islands.push({
      component: k,
      nodes: sizes[k]!,
      x,
      y,
      z,
      above: y - (groundAt(x, z) || 0),
      area: placeName(x, z),
      reach: reachOf(k),
      via: via.get(k),
    });
  }
  islands.sort((a, b) => b.nodes - a.nodes);

  // Nav raster: the main area and islands by reach.
  for (let n = 0; n < total; n++) {
    const col = nav.nodeColumn[n]!;
    const i = Math.floor((col % nav.cols) / 2);
    const j = Math.floor(Math.floor(col / nav.cols) / 2);
    if (i >= cols || j >= rows) continue;
    const c = j * cols + i;
    const comp = nav.component[n]!;
    const r0 = reachOf(comp);
    const v =
      comp === main
        ? 1
        : sizes[comp]! < 4 || r0 === 'outside'
          ? 0
          : r0 === 'none' || r0 === 'pit'
            ? 3
            : 2;
    if (v > navR[c]!) navR[c] = v;
  }

  // Perches: raised spots under open sky, clustered along nav links.
  const seen = new Uint8Array(total);
  const isPerch = (n: number): boolean => {
    const x = nav.nodeX(n);
    const z = nav.nodeZ(n);
    // Over a hole (a tunnel's mouth) there's no ground to be above.
    const ground = groundAt(x, z);
    return nav.heights[n]! - ground >= REPORT.perch && skyAbove(x, nav.heights[n]!, z);
  };
  const perches: Perch[] = [];
  const stack: number[] = [];
  for (let n = 0; n < total; n++) {
    if (seen[n]) continue;
    seen[n] = 1;
    if (!isPerch(n)) continue;
    const members: number[] = [];
    stack.push(n);
    while (stack.length) {
      const a = stack.pop()!;
      members.push(a);
      for (let d = 0; d < 8; d++) {
        const b = nav.neighbor(a, d);
        if (b < 0 || seen[b]) continue;
        seen[b] = 1;
        if (isPerch(b)) stack.push(b);
      }
    }
    if (members.length < 4 || outside.has(nav.component[n]!) || strip(nav.component[n]!)) continue;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let above = 0;
    for (const m of members) {
      sx += nav.nodeX(m);
      sy += nav.heights[m]!;
      sz += nav.nodeZ(m);
      above += nav.heights[m]! - groundAt(nav.nodeX(m), nav.nodeZ(m));
      const col = nav.nodeColumn[m]!;
      const i = Math.floor((col % nav.cols) / 2);
      const j = Math.floor(Math.floor(col / nav.cols) / 2);
      if (i < cols && j < rows) navR[j * cols + i] = 4;
    }
    const x = sx / members.length;
    const y = sy / members.length;
    const z = sz / members.length;
    // The member nearest the middle, for its view.
    let mid = members[0]!;
    let midD = Infinity;
    for (const m of members) {
      const d = (nav.nodeX(m) - x) ** 2 + (nav.nodeZ(m) - z) ** 2;
      if (d < midD) {
        midD = d;
        mid = m;
      }
    }
    const { long } = lookFrom(nav.nodeX(mid), nav.heights[mid]! + REPORT.eye, nav.nodeZ(mid));
    perches.push({
      x,
      y,
      z,
      above: above / members.length,
      size: members.length * nav.cellSize * nav.cellSize,
      area: placeName(x, z),
      reach: reachOf(nav.component[mid]!),
      via: via.get(nav.component[mid]!),
      long,
    });
  }
  // Ones someone gets onto first, highest first; then the roofs nobody does.
  const unreached = (p: Perch): number => (p.reach === 'none' ? 1 : 0);
  perches.sort((a, b) => unreached(a) - unreached(b) || b.above - a.above);

  // Drops past dropKeep, from ground a player walks (the main area, or an island reached).
  const patches = new Map<string, Drop>();
  for (let n = 0; n < total; n++) {
    const comp = nav.component[n]!;
    const r0 = reachOf(comp);
    if ((r0 !== 'AI' && r0 !== 'climb' && r0 !== 'ladder') || strip(comp)) continue;
    const col = nav.nodeColumn[n]!;
    const q = col % nav.cols;
    const r = Math.floor(col / nav.cols);
    const h = nav.heights[n]!;
    for (let d = 0; d < 4; d++) {
      if (nav.links[n]! & (1 << d)) continue;
      const nq = q + DIR_Q[d]!;
      const nr = r + DIR_R[d]!;
      if (nq < 0 || nr < 0 || nq >= nav.cols || nr >= nav.rows) continue;
      const x = nav.x(nq);
      const z = nav.z(nr);
      const count = world.solidsAt(x, z, bottoms, tops);
      let blocked = false;
      let landing = t.holeAt(x, z) ? -Infinity : t.heightAt(x, z);
      const onTerrain = landing;
      if (landing > h - MOVEMENT.stepDown) continue;
      for (let k = 0; k < count; k++) {
        if (tops[k]! > h + MOVEMENT.stepUp && bottoms[k]! < h + MOVEMENT.standHeight - 0.1) {
          blocked = true;
          break;
        }
        if (tops[k]! <= h + MOVEMENT.stepUp && tops[k]! > landing) landing = tops[k]!;
      }
      // Something within a step down (a floor beside a low prop) is walked onto, not fallen to.
      if (landing >= h - MOVEMENT.stepDown) continue;
      // Nothing under a hole is a pit below the map: not a drop anyone takes.
      if (blocked || landing === -Infinity) continue;
      // A rail or a low wall between the ledge and the column past it.
      const dx = DIR_Q[d]!;
      const dz = DIR_R[d]!;
      const hx = nav.x(q);
      const hz = nav.z(r);
      const reachOut = nav.cellSize + MOVEMENT.radius;
      if (!crossable(hx, hz, hx + dx * reachOut, hz + dz * reachOut, h)) continue;
      const drop = h - landing;
      if (drop <= REPORT.dropKeep) continue;
      if (landing === onTerrain && world.waterDepth(x, z) > 1.2) continue;
      const key = `${Math.floor(x / 4)},${Math.floor(z / 4)},${Math.round(h)}`;
      const p = patches.get(key);
      if (p) {
        p.edges++;
        if (drop > p.drop) p.drop = drop;
        p.ai ||= comp === main;
      } else
        patches.set(key, { x, z, drop, edges: 1, area: '', ai: comp === main, via: via.get(comp) });
      const i = Math.floor(nq / 2);
      const j = Math.floor(nr / 2);
      if (i < cols && j < rows) navR[j * cols + i] = 5;
    }
  }
  // Off the AI's ground first (every player walks it), then the worst.
  const drops = [...patches.values()].sort(
    (a, b) => Number(b.ai) - Number(a.ai) || b.drop - a.drop,
  );
  for (const d of drops) d.area = placeName(d.x, d.z);

  // Walks between the areas, and from each player spawn to the extractions.
  const spotNode = (s: NamedSpot): number => nav.nearest(s.x, s.y + 0.2, s.z, 2);
  const extractions: NamedSpot[] = map.zones
    .filter((z) => z.extraction)
    .map((z) => {
      const n = z.points.length;
      const x = z.points.reduce((a, p) => a + p[0], 0) / n;
      const zz = z.points.reduce((a, p) => a + p[1], 0) / n;
      return { name: z.name ?? z.id, x, y: z.extraction!.y, z: zz };
    });
  const spawnSpots: NamedSpot[] = map.markers
    .filter((m) => m.type === 'playerSpawn')
    .map((m, k) => ({
      name: `spawn ${k + 1} (${Math.round(m.x)}, ${Math.round(m.z)})`,
      x: m.x,
      y: m.y,
      z: m.z,
    }));
  const walker = new NavDistances(nav);
  const meters: number[][] = [];
  for (const a of areas) {
    const field = walker.from(spotNode(a));
    meters.push(areas.map((b) => walker.at(field, spotNode(b))));
  }
  const toExtract = extractions.map((e) => {
    const field = walker.from(spotNode(e));
    return spawnSpots.map((s) => walker.at(field, spotNode(s)));
  });
  const spawns = spawnSpots.map((s, k) => {
    let nearest = Infinity;
    let farthest = 0;
    let nearestTo = '';
    extractions.forEach((e, x) => {
      const m = toExtract[x]![k]!;
      if (m < nearest) {
        nearest = m;
        nearestTo = e.name;
      }
      if (m !== Infinity && m > farthest) farthest = m;
    });
    return { name: s.name, nearest, farthest, nearestTo };
  });

  return {
    bounds: { minX: t.minX, minZ: t.minZ, maxX: t.maxX, maxZ: t.maxZ },
    navNodes: total,
    mainShare: sizes[main]! / total,
    areas: stats,
    islands,
    escapes,
    perches,
    drops,
    walks: { from: areas.map((a) => a.name), to: areas.map((a) => a.name), meters },
    spawns,
    rasters: { minX, minZ, cols, rows, lines, open, nav: navR },
  };
}

/** Walking distances over the nav grid from one node to all (Dijkstra, no node budget). */
export class NavDistances {
  private readonly heap: Int32Array;
  private readonly heapD: Float32Array;

  constructor(private readonly nav: NavGrid) {
    this.heap = new Int32Array(nav.nodeCount * 2 + 8);
    this.heapD = new Float32Array(nav.nodeCount * 2 + 8);
  }

  /** Distances in meters from a node (Infinity where it can't walk); empty if node is -1. */
  from(start: number): Float32Array {
    const nav = this.nav;
    const dist = new Float32Array(nav.nodeCount).fill(Infinity);
    if (start < 0) return dist;
    const heap = this.heap;
    const hd = this.heapD;
    let size = 0;
    const push = (n: number, d: number): void => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hd[p]! <= d) break;
        heap[i] = heap[p]!;
        hd[i] = hd[p]!;
        i = p;
      }
      heap[i] = n;
      hd[i] = d;
    };
    const pop = (): number => {
      const top = heap[0]!;
      const n = heap[--size]!;
      const d = hd[size]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && hd[c + 1]! < hd[c]!) c++;
        if (hd[c]! >= d) break;
        heap[i] = heap[c]!;
        hd[i] = hd[c]!;
        i = c;
      }
      heap[i] = n;
      hd[i] = d;
      return top;
    };
    dist[start] = 0;
    push(start, 0);
    const cs = nav.cellSize;
    while (size) {
      const d0 = hd[0]!;
      const a = pop();
      if (d0 > dist[a]!) continue;
      for (let d = 0; d < 8; d++) {
        const b = nav.neighbor(a, d);
        if (b < 0) continue;
        const nd = d0 + (d < 4 ? cs : cs * Math.SQRT2);
        if (nd < dist[b]! && size < heap.length) {
          dist[b] = nd;
          push(b, nd);
        }
      }
    }
    return dist;
  }

  at(field: Float32Array, node: number): number {
    return node < 0 ? Infinity : field[node]!;
  }
}

/**
 * The AI's main area: the nav component holding the most spawns (player, PMC and enemy),
 * else the largest. Not simply the largest: Northpoint's unused ground outside its fences
 * is bigger than the mall.
 */
export function mainComponent(map: CompiledMap, nav: NavGrid): number {
  const votes = new Map<number, number>();
  for (const m of map.markers) {
    if (m.type !== 'playerSpawn' && m.type !== 'pmcSpawn' && m.type !== 'enemySpawn') continue;
    const n = nav.nearest(m.x, m.y + 0.2, m.z, 2);
    if (n >= 0) votes.set(nav.component[n]!, (votes.get(nav.component[n]!) ?? 0) + 1);
  }
  let main = -1;
  for (const [k, v] of votes) if (main < 0 || v > votes.get(main)!) main = k;
  if (main >= 0) return main;
  const sizes = nav.componentSizes;
  main = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k]! > sizes[main]!) main = k;
  return main;
}
