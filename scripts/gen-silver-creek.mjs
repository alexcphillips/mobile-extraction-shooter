// Generates the Silver Creek graybox (roadmap MT-2): content/maps/silver-creek.json and
// content/raids/silver-creek.json, from the whiteboard sketch (docs/design/raids-and-maps.md
// → Silver Creek). It's a starting point for the user to reshape in the map editor, so it
// refuses to overwrite the map unless given --force.
//
//   node scripts/gen-silver-creek.mjs [--force]
//
// The play area is x 0..320 (west to east), z 0..150 (north to south); the sketch's pixels
// are 3 to the meter from (40, 46). The valley floor is y 0, the ridge rises to the north.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { buildAi } from './silver-creek-ai.mjs';
import { buildEastEnd } from './silver-creek-east.mjs';
import { buildMiddle, buildRidge } from './silver-creek-middle.mjs';
import { buildQuests } from './silver-creek-quests.mjs';
import { buildWestEnd } from './silver-creek-west.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = resolve(ROOT, 'content/maps/silver-creek.json');
const RAID_FILE = resolve(ROOT, 'content/raids/silver-creek.json');

const W = 320;
const D = 150;
const MARGIN = 24;
const CELL = 2;
const ORIGIN = [-MARGIN, -MARGIN];
const COLS = (W + 2 * MARGIN) / CELL;
const ROWS = (D + 2 * MARGIN) / CELL;

const r2 = (n) => Math.round(n * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
/** Sketch pixels to meters. */
const sx = (px) => r2((px - 40) / 3);
const sz = (py) => r2((py - 46) / 3);

// ---------------------------------------------------------------- terrain

/** The ridge to the north: 7 m at the map's north edge, rising on past it. */
function ridge(z) {
  if (z >= 36) return 0;
  if (z >= 0) return 7 * smooth((36 - z) / 36);
  return 7 - z * 0.35;
}
/** The ridge trail runs on a bench cut level across the slope. */
const TRAIL = { z0: 17, z1: 23, z: 20 };
const TRAIL_Y = r2(ridge(TRAIL.z));

/**
 * Level ground on the ridge (MT-7): the hunting cabin's terrace above the trail, and the
 * campsite's clearing cut back into the slope, level with the trail. Each blends back into
 * the slope over `blend` meters; the trail's bench is left alone.
 */
const CABIN_PAD = { x0: 73, x1: 95, z0: 6, z1: 14.6, y: 5.4, blend: 2.4 };
const CAMP_PAD = { x0: 117, x1: 135, z0: 11, z1: 17.5, y: TRAIL_Y, blend: 3 };
function padded(x, z, h) {
  for (const p of [CABIN_PAD, CAMP_PAD]) {
    const d = Math.hypot(Math.max(p.x0 - x, 0, x - p.x1), Math.max(p.z0 - z, 0, z - p.z1));
    if (d < p.blend) h = lerp(p.y, h, d / p.blend);
  }
  return h;
}

function baseHeight(x, z) {
  const onTrail = z >= TRAIL.z0 && z <= TRAIL.z1;
  let h = onTrail ? TRAIL_Y : padded(x, z, ridge(z));
  // The south edge's tree line on a low bank, and a hill east of the map for the rail tunnel
  // (the highway stays level through it).
  if (z > 141) h = Math.max(h, (z - 141) * 0.35);
  if (x > 321 && !(z > 108 && z < 128)) h = Math.max(h, Math.min(10, (x - 321) * 0.8));
  if (x < -2 && !(z > 108 && z < 128) && !(z > TRAIL.z0 - 2 && z < TRAIL.z1 + 2))
    h = Math.max(h, Math.min(6, (-2 - x) * 0.5));
  return h;
}

// The creek, north to south, through the mill pond. North of the dam its water is the pond's.
const CREEK_NORTH = [
  [163, -30],
  [163, -1],
  [161, 14],
  [159, 30],
  [163, 44],
];
const CREEK_SOUTH = [
  [166, 70],
  [166, 104],
  [168, 120],
  [163, 136],
  [161, 151],
  [160, 180],
];
const CREEK = [...CREEK_NORTH, [165, 56], ...CREEK_SOUTH];
const CREEK_HALF = 5;
const POND = { x: 165, z: 56, rx: 25, rz: 13 };
const POND_LEVEL = -0.5;
const CREEK_LEVEL = -2;
const RACE_LEVEL = -0.8;
const DAM_Z = 69.5;
const FORD = { z0: 132, z1: 140, bed: -2.6, approach: 8 };

function distToPolyline(line, x, z) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
/** Where the creek center is at a z (south of the pond). */
function creekX(z) {
  for (let i = 0; i + 1 < CREEK_SOUTH.length; i++) {
    const [ax, az] = CREEK_SOUTH[i];
    const [bx, bz] = CREEK_SOUTH[i + 1];
    if (z >= az && z <= bz) return lerp(ax, bx, (z - az) / (bz - az));
  }
  throw new Error(`no creek at z ${z}`);
}

/** Water deeper than this stops you (DEEP_WATER in the sim). */
const DEEP = 1.2;
/**
 * The steepest a bank gets above the deep line (2026-11-10): walkable, as the sim stops you
 * walking up terrain over 45°, so whoever walks down to the water can walk back out.
 */
const BANK = 0.7;
/**
 * A channel's bed widening into banks that climb back to the ground. With `slope`, one even
 * slope that long (the ford's approaches). Otherwise the bank's top stays where the old 50°
 * bank put it, and from there it falls at BANK to just below the deep line (the water's
 * `level` less DEEP), then steeply to the bed, which narrows to make room (to `minHalf` at
 * least, past which the bank's top moves out instead).
 */
function carve(ground, bed, d, half, slope, level, minHalf = -Infinity) {
  if (slope !== undefined) {
    if (d <= half) return bed;
    if (d >= half + slope) return ground;
    return lerp(bed, ground, (d - half) / slope);
  }
  const outer = half + Math.max(2, (ground - bed) * 0.8);
  const toe = Math.max(bed, Math.min(ground, level - DEEP - 0.3));
  const gentle = (ground - toe) / BANK;
  const steep = (toe - bed) * 0.8;
  const inner = Math.max(minHalf, outer - gentle - steep);
  if (d <= inner) return bed;
  if (d >= inner + steep + gentle) return ground;
  if (d <= inner + steep) return lerp(bed, toe, (d - inner) / steep);
  return lerp(toe, ground, (d - inner - steep) / gentle);
}

function height(x, z) {
  const ground = baseHeight(x, z);
  let h = ground;
  const d = distToPolyline(CREEK, x, z);
  const ford = z >= FORD.z0 && z <= FORD.z1;
  const bed = z < DAM_Z ? -3.5 : ford ? FORD.bed : -4;
  const level = z < DAM_Z ? POND_LEVEL : CREEK_LEVEL;
  h = Math.min(h, carve(ground, bed, d, CREEK_HALF, ford ? FORD.approach : undefined, level, 2));
  const e = Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
  h = Math.min(h, carve(ground, -3.5, (e - 1) * POND.rz, 0, undefined, POND_LEVEL));
  // The mill race: a wadeable ditch from the pond's south-west shore to the saw hall.
  if (x >= 143 && x <= 147 && z >= 60 && z <= 75) h = Math.min(h, -1.3);
  return r2(h);
}

// The mill race tunnel runs under the creek in a strip of holes, x 116..216, z 104..108.
// The engine shed's inspection pit (MT-8) is a strip of holes too, lined in the east script.
const PIT = { x0: 252, x1: 270, z0: 62, z1: 64 };
const TUNNEL = { x0: 116, x1: 216, z0: 104, z1: 108, floor: -6, ceiling: -3.7 };
const holes = [];
for (let j = 0; j < ROWS; j++) {
  for (let i = 0; i < COLS; i++) {
    const x = ORIGIN[0] + i * CELL;
    const z = ORIGIN[1] + j * CELL;
    if (x >= TUNNEL.x0 && x < TUNNEL.x1 && z >= TUNNEL.z0 && z < TUNNEL.z1) holes.push([i, j]);
    else if (x >= PIT.x0 && x < PIT.x1 && z >= PIT.z0 && z < PIT.z1) holes.push([i, j]);
  }
}

const heights = [];
for (let j = 0; j <= ROWS; j++) {
  const row = [];
  for (let i = 0; i <= COLS; i++) row.push(height(ORIGIN[0] + i * CELL, ORIGIN[1] + j * CELL));
  heights.push(row);
}
/** The terrain under a point, as the game interpolates it (two triangles a cell). */
function groundAt(x, z) {
  const fx = (x - ORIGIN[0]) / CELL;
  const fz = (z - ORIGIN[1]) / CELL;
  const i = Math.min(COLS - 1, Math.max(0, Math.floor(fx)));
  const j = Math.min(ROWS - 1, Math.max(0, Math.floor(fz)));
  const u = fx - i;
  const v = fz - j;
  const h00 = heights[j][i];
  const h10 = heights[j][i + 1];
  const h01 = heights[j + 1][i];
  const h11 = heights[j + 1][i + 1];
  return lerp(lerp(h00, h10, u), lerp(h01, h11, u), v);
}
/** Lowest and highest ground under a rectangle. */
function groundRange(x0, z0, x1, z1) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = x0; x <= x1 + 1e-6; x += Math.min(1, x1 - x0 || 1)) {
    for (let z = z0; z <= z1 + 1e-6; z += Math.min(1, z1 - z0 || 1)) {
      const h = groundAt(x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return [lo, hi];
}

// ---------------------------------------------------------------- nodes

const C = {
  concrete: '#9a9890',
  'dark-concrete': '#6f6d68',
  timber: '#8a6a48',
  'timber-dark': '#5e4632',
  siding: '#a8a090',
  'siding-red': '#8a4a3a',
  roof: '#4a4440',
  metal: '#7c8288',
  rust: '#7a4e34',
  road: '#58585a',
  dirt: '#7a6a50',
  ballast: '#6a6560',
  rail: '#4a4542',
  log: '#7a5a3a',
  lumber: '#c49a5e',
  stone: '#8c8a84',
  water: '#3e5a64',
  ladder: '#d8b52e',
  burner: '#5a4c44',
};

/** A box from its x and z extents, bottom and top. */
function box(x0, z0, x1, z1, bottom, top, color, extra = {}) {
  return {
    type: 'box',
    pos: [r2((x0 + x1) / 2), r2(bottom), r2((z0 + z1) / 2)],
    size: [r2(x1 - x0), r2(top - bottom), r2(z1 - z0)],
    color,
    ...extra,
  };
}
const group = (name, nodes, extra = {}) => ({
  type: 'group',
  name,
  pos: [0, 0, 0],
  ...extra,
  nodes,
});
const label = (text, x, z, size, y = groundAt(x, z)) => ({
  type: 'mapLabel',
  pos: [r2(x), r2(y), r2(z)],
  text,
  ...(size ? { size } : {}),
});
const tree = (x, z) => ({
  type: 'prefab',
  prefab: 'pine-tree',
  pos: [r2(x), r2(groundAt(x, z)), r2(z)],
});

// --- west end: scripts/silver-creek-west.mjs (MT-6), built once every helper is defined.
const LOOKOUT = { x: 30, z: 8 };

// --- the middle and the ridge: scripts/silver-creek-middle.mjs (MT-7), built once every
// helper is defined. The crossings' places are kept here for the roads and labels.
const jamCenter = 160.5;
const jamHalf = 12;
const bridgeX = r2(creekX(118));
const fordX = r2(creekX(136));

// --- the sawmill core (MT-5, 2026-11-10)
// Logs come up the jack ladder from the pond into the debarker (north-east), along the log
// conveyor to the headrig's carriage (north-west); boards come back east along the saw line's
// live rolls, through the edger and trimmer to the green chain by the east door, then out to
// the kilns. Bark and offcuts ride the waste conveyor to the teepee burner.
const MILL = { x0: 140, z0: 74, x1: 192, z1: 102, floor: 0.3, tall: 9 };
const F = MILL.floor;
const millW = MILL.x1 - MILL.x0;
const millD = MILL.z1 - MILL.z0;
const wallH = MILL.tall - MILL.floor;
const door = (along, width = 4) => ({ along, width, bottom: 0, top: 3.6 });
Object.assign(C, {
  steel: '#5c6268',
  'steel-dark': '#3e4246',
  machine: '#6b7a5a',
  'machine-dark': '#4c5740',
  belt: '#2e2e2e',
  roller: '#9aa0a4',
  glass: '#9cc4d0',
  'office-siding': '#b8ae98',
  ash: '#4a4644',
  lamp: '#e8d27a',
  dark: '#1e1e1e',
  sawdust: '#c8a874',
});

/** Drawn only: no collision. */
const drawn = (x0, z0, x1, z1, bottom, top, color, extra = {}) =>
  box(x0, z0, x1, z1, bottom, top, color, { collide: false, ...extra });
/** A placed prefab; y defaults to the hall floor. */
const prefab = (name, x, z, extra = {}, y = F) => ({
  type: 'prefab',
  prefab: name,
  pos: [r2(x), r2(y), r2(z)],
  ...extra,
});
/** A wall running along x at z, from x0 to x1; openings measured along +x from its middle. */
const wallX = (id, x0, x1, z, bottom, top, color, openings = [], thick = 0.3) => ({
  type: 'wall',
  id,
  pos: [r2((x0 + x1) / 2), r2(bottom), r2(z)],
  size: [r2(x1 - x0), r2(top - bottom), thick],
  color,
  openings,
});
/** A wall running along z at x; `at` gives openings by their world z. */
const wallZ = (id, x, z0, z1, bottom, top, color, openings = [], thick = 0.3) => ({
  type: 'wall',
  id,
  pos: [r2(x), r2(bottom), r2((z0 + z1) / 2)],
  yaw: 90,
  size: [r2(z1 - z0), r2(top - bottom), thick],
  color,
  // A yaw-90 wall measures `along` along −z.
  openings: openings.map(({ at, ...o }) => ({ ...o, along: r2((z0 + z1) / 2 - at) })),
});
/** A shape tilted along a line from a to b ([x, y, z]); local z runs a → b. */
function along(a, b, w, h, color, extra = {}) {
  const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const flat = Math.hypot(dx, dz);
  return {
    type: 'box',
    pos: [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2 - h / 2), r2((a[2] + b[2]) / 2)],
    size: [w, h, r2(Math.hypot(flat, dy))],
    yaw: r2((Math.atan2(dx, dz) * 180) / Math.PI),
    pitch: r2((-Math.atan2(dy, flat) * 180) / Math.PI),
    color,
    collide: false,
    ...extra,
  };
}

/**
 * Live rolls along x (the saw line): a waist-high bed of rollers. One invisible box keeps
 * the graybox's collision (waist cover, 1.1 m, vaultable); the frame and rollers are drawn.
 */
function liveRolls(id, x0, x1, z0, z1) {
  const parts = [
    // Solid to bodies and shots: the frame's skirts are steel plate.
    box(x0, z0, x1, z1, F, F + 0.85, C['steel-dark'], { id: `${id}-frame` }),
    drawn(x0, z0 - 0.02, x1, z0 + 0.06, F + 0.85, F + 1.1, C.steel),
    drawn(x0, z1 - 0.06, x1, z1 + 0.02, F + 0.85, F + 1.1, C.steel),
  ];
  for (let x = x0 + 0.45; x < x1 - 0.2; x += 0.9) {
    parts.push({
      type: 'cylinder',
      pos: [r2(x), r2(F + 0.95 - (z1 - z0) / 2 + 0.06), r2((z0 + z1) / 2)],
      radius: 0.12,
      height: r2(z1 - z0 - 0.12),
      sides: 6,
      pitch: 90,
      color: C.roller,
      collide: false,
    });
  }
  return group(id, parts);
}

/** A belt conveyor along x, belt top at 1 m, on legs; it collides as one waist-high box. */
function beltConveyor(id, x0, x1, z0, z1, top = F + 1) {
  const parts = [
    box(x0, z0, x1, z1, top - 0.3, top, C.steel, { id: `${id}-bed` }),
    drawn(x0 + 0.05, z0 + 0.1, x1 - 0.05, z1 - 0.1, top, top + 0.03, C.belt),
    drawn(x0, z0 - 0.03, x1, z0 + 0.04, top, top + 0.22, C['steel-dark']),
    drawn(x0, z1 - 0.04, x1, z1 + 0.03, top, top + 0.22, C['steel-dark']),
  ];
  for (let x = x0 + 0.4; x < x1; x += 3) {
    parts.push(box(x - 0.1, z0 + 0.05, x + 0.1, z0 + 0.25, F, top - 0.3, C['steel-dark']));
    parts.push(box(x - 0.1, z1 - 0.25, x + 0.1, z1 - 0.05, F, top - 0.3, C['steel-dark']));
  }
  return group(id, parts);
}

// The headrig: a band mill in a tall frame, its two wheels drawn, and the log carriage on
// its track in front. The frame is full cover from floor to 5.5 m.
const headrig = group('Headrig', [
  box(150.5, 79, 153.5, 85, F, F + 1.2, C['machine-dark'], { id: 'headrig-base' }),
  // The mill's column, full cover to 5.8 m; the band wheels hang on its east face.
  box(150.5, 80.5, 152, 83.5, F + 1.2, F + 5.8, C.machine, { id: 'headrig-column' }),
  ...[F + 2.3, F + 4.6].map((y, k) => ({
    type: 'cylinder',
    pos: [152.15, r2(y - 0.15), 82],
    radius: 1.05,
    height: 0.3,
    sides: 12,
    roll: 90,
    color: C.rust,
    collide: false,
    id: `band-wheel-${k + 1}`,
  })),
  // The band, a thin bright strip joining the wheels' front edges.
  drawn(152.1, 82.98, 152.2, 83.1, F + 2.3, F + 4.6, C.roller),
  drawn(152.1, 80.9, 152.2, 81.02, F + 2.3, F + 4.6, C.roller),
]);
const carriage = group('Log carriage', [
  // Track, drawn: the carriage rides it from the headrig to the creek's far side.
  drawn(144, 81.3, 178, 81.42, F, F + 0.08, C.rail),
  drawn(144, 83.2, 178, 83.32, F, F + 0.08, C.rail),
  box(156, 81.1, 163.5, 83.5, F + 0.15, F + 0.75, C['steel-dark'], { id: 'carriage-deck' }),
  // Knees: the uprights the log is set against, a screen with gaps.
  ...[156.6, 159.6, 162.6].map((x, k) =>
    box(x, 81.1, x + 0.35, 81.6, F + 0.75, F + 2.3, C.machine, { id: `carriage-knee-${k + 1}` }),
  ),
  prefab('log', 159.8, 82.3, {}, F + 0.75),
  drawn(155.8, 82.9, 156.2, 83.4, F + 0.75, F + 1.9, C.machine), // the setter's stand
]);

// The debarker: a long drum on two cradles, its drive beside it; logs come in at the east
// end off the jack ladder and leave west onto the log conveyor.
const debarker = group('Debarker', [
  {
    type: 'cylinder',
    id: 'debarker-drum',
    pos: [186, r2(F + 2.2 - 3.5), 79],
    radius: 1.8,
    height: 7,
    sides: 10,
    roll: 90,
    color: C.rust,
  },
  ...[183.6, 186, 188.4].map((x, k) => ({
    type: 'cylinder',
    pos: [x, r2(F + 2.2 - 0.125), 79],
    radius: 1.9,
    height: 0.25,
    sides: 10,
    roll: 90,
    color: C['steel-dark'],
    collide: false,
    id: `debarker-ring-${k + 1}`,
  })),
  box(183, 77, 184.2, 81, F, F + 1.1, C['steel-dark'], { id: 'debarker-cradle-w' }),
  box(187.8, 77, 189, 81, F, F + 1.1, C['steel-dark'], { id: 'debarker-cradle-e' }),
  box(184, 81.2, 186.8, 82.8, F, F + 1.5, C.machine, { id: 'debarker-drive' }),
  drawn(184.6, 81, 185.4, 81.2, F + 0.8, F + 2.2, C.belt), // the drive chain
  // The infeed chute from the jack ladder's opening in the north wall.
  along([190.2, F + 3.3, 74.3], [189.4, F + 2.6, 78], 1.2, 0.2, C.steel),
]);
const logConveyor = group('Log conveyor', [
  // The kicker that rolls logs off the conveyor onto the infeed deck, and the chipper
  // against the north wall: eye-height cover splitting the north lane (MT-5 sightlines).
  box(162, 78, 163.6, 80.4, F, F + 2.4, C.machine, { id: 'log-kicker' }),
  drawn(161.9, 77.9, 163.7, 80.5, F + 2.4, F + 2.5, C['machine-dark']),
  box(165, 74.6, 168, 77.4, F, F + 2.6, C['machine-dark'], { id: 'chipper' }),
  box(165.6, 75.2, 167.4, 76.8, F + 2.6, F + 3.4, C.machine, { id: 'chipper-hopper' }),
  // Cants waiting at the carriage track's east end, and stock by the west wall.
  prefab('lumber-stack-tall', 180, 82.4, { yaw: 90 }),
  prefab('lumber-stack-tall', 142.5, 80, { yaw: 90 }),
  beltConveyor('log-conveyor-e', 174, 182.8, 78.4, 79.6),
  beltConveyor('log-conveyor-w', 163.8, 172, 78.4, 79.6),
  // The infeed deck: logs waiting for the carriage.
  prefab('log-pile-tall', 160, 76.4),
  prefab('log', 167.5, 79, {}, F + 1.03),
  prefab('log', 178, 79, { yaw: 2 }, F + 1.03),
]);
// The sawyer's booth beside the carriage, windowed on its west side; and the hydraulic
// power unit against the north wall. Both are eye-height cover in the north lane.
const sawyerBooth = group("Sawyer's booth", [
  box(167, 84.2, 169.6, 86.4, F, F + 0.4, C['steel-dark'], { id: 'booth-base' }),
  box(167, 84.2, 169.6, 86.4, F + 0.4, F + 2.6, C['office-siding'], { id: 'booth' }),
  drawn(166.97, 84.5, 167, 86.1, F + 1.2, F + 2.2, C.glass),
  drawn(167.3, 84.17, 169.3, 84.2, F + 1.2, F + 2.2, C.glass),
  drawn(166.9, 84.1, 169.7, 86.5, F + 2.6, F + 2.75, C.roof),
]);
const powerUnit = group('Hydraulic power unit', [
  box(175.6, 74.6, 178.6, 76.6, F, F + 2.1, C.machine, { id: 'power-unit' }),
  drawn(175.9, 76.6, 178.3, 76.62, F + 0.5, F + 1.8, C['machine-dark']),
  drawn(176.2, 76.62, 176.8, 76.66, F + 1.2, F + 1.6, C.lamp),
  prefab('steel-barrel', 174.6, 75.1),
  prefab('steel-barrel', 174.9, 75.8),
]);

// Saw line: the graybox's three runs of live rolls, with the cut-throughs kept.
const sawLine = group('Saw line', [
  liveRolls('saw-line-w', 144, 158, 87.4, 88.6),
  liveRolls('saw-line-mid', 161, 172, 87.4, 88.6),
  liveRolls('saw-line-e', 175, 186, 87.4, 88.6),
  // The resaw's hood over the middle run breaks the line that ran door to door.
  box(164, 86.6, 167, 89.4, F, F + 2.6, C.machine, { id: 'resaw' }),
  drawn(163.9, 86.5, 167.1, 89.5, F + 2.6, F + 2.75, C['machine-dark']),
]);

// South lane: the edger and trimmer, the green chain where boards are pulled, and stock.
const edger = group('Edger', [
  box(165.5, 89.6, 169.5, 93.2, F, F + 1.3, C['machine-dark'], { id: 'edger-base' }),
  box(166, 90, 169, 92.8, F + 1.3, F + 2.4, C.machine, { id: 'edger' }),
  drawn(165.8, 89.9, 169.2, 93, F + 2.4, F + 2.5, C['steel-dark']),
  drawn(169.5, 90.4, 171.5, 92.4, F + 0.85, F + 0.95, C.roller), // outfeed table
  box(169.5, 90.4, 171.5, 92.4, F, F + 0.85, C['steel-dark']),
]);
const trimmer = group('Trimmer', [
  box(176, 89.4, 178.4, 92.4, F, F + 1, C['steel-dark'], { id: 'trimmer-base' }),
  box(176.2, 89.4, 178.2, 92.4, F + 1, F + 2.6, C.machine, { id: 'trimmer-hood' }),
  drawn(176.1, 89.3, 178.3, 92.5, F + 2.6, F + 2.7, C['machine-dark']),
]);
const greenChain = (() => {
  const parts = [
    box(179, 89.4, 183, 93.4, F, F + 0.85, C['steel-dark'], { id: 'green-chain-frame' }),
  ];
  // Five chains running across the table, boards lying on them.
  for (let k = 0; k < 5; k++) {
    const x = 179.4 + k * 0.8;
    parts.push(drawn(x - 0.04, 89.4, x + 0.04, 93.4, F + 0.85, F + 0.92, C.belt));
  }
  for (const [z, w] of [
    [90.1, 3.6],
    [91.3, 3.2],
    [92.6, 3.7],
  ])
    parts.push(drawn(181 - w / 2, z - 0.15, 181 + w / 2, z + 0.15, F + 0.92, F + 0.98, C.lumber));
  return group('Green chain', parts);
})();
const hallStock = group('Hall stock', [
  prefab('lumber-stack-tall', 146.6, 95.6),
  prefab('lumber-stack-tall', 157, 93.9),
  prefab('lumber-stack-tall', 158.4, 99.1),
  prefab('lumber-stack-tall', 167, 97.2),
  prefab('forklift', 151.5, 98.6, { yaw: 90 }),
  prefab('wood-pallet', 174, 94.3),
  prefab('cardboard-bale', 174, 94.3, {}, F + 0.144),
  prefab('cardboard-bale', 174, 94.3, { yaw: 4 }, F + 0.944),
  // The chip bin against the south wall.
  box(162, 100, 164.5, 101.7, F, F + 2.4, C.rust, { id: 'chip-bin' }),
  drawn(161.9, 99.9, 164.6, 101.7, F + 2.4, F + 2.5, C['steel-dark']),
  prefab('sideways-steel-barrel', 141.2, 76.3),
  prefab('wood-pallet', 172.8, 96.2),
  prefab('cardboard-bale', 172.8, 96.2, {}, F + 0.144),
  // Sawdust heaped against the saw line's west end.
  box(141, 82.5, 143.6, 85.5, F, F + 0.5, C.sawdust, {
    bulge: [0.2, 0.2, 0, 0.35, 0.2, 0.2],
    top: [1, 1.6],
    id: 'sawdust-pile',
  }),
]);

// The mill office (two doors, windows on the floor) with the safe, and stairs up to its roof:
// a perch over the saw floor the AI can follow you onto, 3.2 m above the floor (droppable).
const OFF = { x0: 183, z0: 95, x1: 191.85, z1: 101.7, h: 3 };
const offTop = F + OFF.h;
const office = group('Mill office', [
  wallX(
    'office-wall-n',
    OFF.x0,
    OFF.x1,
    OFF.z0 + 0.1,
    F,
    offTop,
    C['office-siding'],
    [
      { along: -2.4, width: 1.1, bottom: 0, top: 2.1 },
      { along: 0.5, width: 2.2, bottom: 1, top: 2.1, glass: C.glass },
      { along: 3, width: 1.6, bottom: 1, top: 2.1, glass: C.glass },
    ],
    0.2,
  ),
  wallZ(
    'office-wall-w',
    OFF.x0 + 0.1,
    OFF.z0 + 0.2,
    OFF.z1,
    F,
    offTop,
    C['office-siding'],
    [{ at: 97.2, width: 1.1, bottom: 0, top: 2.1 }],
    0.2,
  ),
  {
    type: 'door',
    id: 'office-door-n',
    pos: [r2((OFF.x0 + OFF.x1) / 2 - 2.4), F, r2(OFF.z0 + 0.1)],
    yaw: 0,
    size: [1.1, 2.1],
    color: C['timber-dark'],
  },
  {
    type: 'door',
    id: 'office-door-w',
    pos: [r2(OFF.x0 + 0.1), F, 97.2],
    yaw: 90,
    size: [1.1, 2.1],
    color: C['timber-dark'],
  },
  box(OFF.x0, OFF.z0, OFF.x1, OFF.z1, offTop, offTop + 0.2, C.roof, { id: 'office-roof' }),
  {
    type: 'stairs',
    id: 'office-stairs',
    pos: [r2(OFF.x0 - 3.3), F, r2(OFF.z1 - 1)],
    yaw: 90,
    size: [2, r2(OFF.h + 0.2), 6.6],
    color: C.timber,
  },
  // Inside: the manager's desk by the window, files, and the safe against the back wall.
  prefab('desk', 187.6, 96.4, { yaw: 180 }),
  prefab('office-chair', 187.6, 97.3, { yaw: 180 }),
  prefab('filing-cabinet', 183.6, 100.9, { yaw: 90 }),
  prefab('filing-cabinet', 184.2, 101.3, {}),
  prefab('paper-stacks', 187.2, 96.4, {}, F + 0.76),
  prefab('clipboard', 188.1, 96.3, { yaw: 20 }, F + 0.76),
  prefab('office-safe', 190.9, 100.9, {
    yaw: 180,
    loot: { container: 'office-safe', searched: 'office-safe-open' },
  }),
  prefab('notice-board', 188.4, 101.6, { yaw: 180 }, F),
]);

// The hall's shell, as the graybox's, with a gabled roof drawn over it, trusses and high
// windows; and an opening high in the north wall for the jack ladder.
const sawmill = group('Sawmill', [
  box(MILL.x0, MILL.z0, MILL.x1, MILL.z1, -0.2, MILL.floor, C['dark-concrete'], {
    id: 'mill-floor',
  }),
  {
    type: 'wall',
    id: 'mill-wall-n',
    pos: [(MILL.x0 + MILL.x1) / 2, MILL.floor, MILL.z0 + 0.15],
    size: [millW, wallH, 0.3],
    color: C.timber,
    openings: [door(-16), door(16), { along: 24.2, width: 1.4, bottom: 3, top: 4.4 }],
  },
  {
    type: 'wall',
    id: 'mill-wall-s',
    pos: [(MILL.x0 + MILL.x1) / 2, MILL.floor, MILL.z1 - 0.15],
    size: [millW, wallH, 0.3],
    color: C.timber,
    openings: [door(-18), door(6)],
  },
  {
    type: 'wall',
    id: 'mill-wall-w',
    pos: [MILL.x0 + 0.15, MILL.floor, (MILL.z0 + MILL.z1) / 2],
    yaw: 90,
    size: [millD - 0.6, wallH, 0.3],
    color: C.timber,
    openings: [door(0)],
  },
  {
    type: 'wall',
    id: 'mill-wall-e',
    pos: [MILL.x1 - 0.15, MILL.floor, (MILL.z0 + MILL.z1) / 2],
    yaw: 90,
    size: [millD - 0.6, wallH, 0.3],
    color: C.timber,
    openings: [door(-4)],
  },
  box(
    MILL.x0 - 0.5,
    MILL.z0 - 0.5,
    MILL.x1 + 0.5,
    MILL.z1 + 0.5,
    MILL.tall,
    MILL.tall + 0.3,
    C.roof,
    { id: 'mill-roof' },
  ),
  // The gable: two wedges meeting over the saw line, drawn only.
  {
    type: 'ramp',
    pos: [166, MILL.tall + 0.3, 80.75],
    size: [53, 3.2, 14.5],
    color: C.roof,
    collide: false,
  },
  {
    type: 'ramp',
    pos: [166, MILL.tall + 0.3, 95.25],
    yaw: 180,
    size: [53, 3.2, 14.5],
    color: C.roof,
    collide: false,
  },
  // Trusses under the roof every 8 m, and high windows along both long walls.
  ...[146, 154, 162, 170, 178, 186].map((x) =>
    drawn(
      x - 0.15,
      MILL.z0 + 0.3,
      x + 0.15,
      MILL.z1 - 0.3,
      MILL.tall - 0.5,
      MILL.tall,
      C['timber-dark'],
    ),
  ),
  ...[146, 158, 174, 186].flatMap((x) => [
    drawn(x - 3, MILL.z0 - 0.04, x + 3, MILL.z0, 5.6, 6.8, C['steel-dark']),
    drawn(x - 3, MILL.z1, x + 3, MILL.z1 + 0.04, 5.6, 6.8, C['steel-dark']),
  ]),
  // Lamps hanging over the lanes.
  ...[150, 166, 182].flatMap((x) => [
    drawn(x - 0.3, 80.7, x + 0.3, 81.3, 6.2, 6.35, C.lamp),
    drawn(x - 0.3, 94.7, x + 0.3, 95.3, 6.2, 6.35, C.lamp),
  ]),
  headrig,
  carriage,
  debarker,
  logConveyor,
  sawyerBooth,
  powerUnit,
  sawLine,
  edger,
  trimmer,
  greenChain,
  hallStock,
  office,
]);

/** A log lying from a to b (on a slope along z), drawn only. */
function slopedLog(a, b, radius = 0.25) {
  const len = Math.hypot(b[1] - a[1], b[2] - a[2]);
  const mid = [0, 1, 2].map((i) => (a[i] + b[i]) / 2);
  return {
    type: 'cylinder',
    pos: [r2(mid[0]), r2(mid[1] - len / 2), r2(mid[2])],
    radius,
    height: r2(len),
    sides: 8,
    pitch: r2(90 - (Math.atan2(b[1] - a[1], b[2] - a[2]) * 180) / Math.PI),
    color: C.log,
    collide: false,
  };
}
// The jack ladder: an inclined log chain from the pond up into the debarker, drawn only but
// for its legs.
const jackLadder = group('Jack ladder', [
  along([190.2, -0.9, 59], [190.2, F + 3, 74], 1.4, 0.3, C.steel),
  along([189.45, -0.6, 59], [189.45, F + 3.3, 74], 0.1, 0.35, C['steel-dark']),
  along([190.95, -0.6, 59], [190.95, F + 3.3, 74], 0.1, 0.35, C['steel-dark']),
  slopedLog([190.2, 0.62, 63], [190.2, 2.75, 70.6]),
  box(189.4, 69.8, 189.7, 70.1, -0.3, 2, C['steel-dark'], { id: 'jack-leg-w' }),
  box(190.7, 69.8, 191, 70.1, -0.3, 2, C['steel-dark'], { id: 'jack-leg-e' }),
]);

// The teepee burner: rust bands, an ash door, and the waste conveyor climbing to it from the
// hall's east wall. All of it is the landmark.
const BURN = { x: sx(643), z: sz(238), r: 5.5, rTop: 1.4, h: 16, y: -0.2 };
const burnR = (y) => BURN.r - ((BURN.r - BURN.rTop) * (y - BURN.y)) / BURN.h;
const wasteTo = (() => {
  const y = 12.4;
  const dx = BURN.x - 192.4;
  const dz = BURN.z - 77;
  const d = Math.hypot(dx, dz);
  const r = burnR(y) - 0.2;
  return [r2(BURN.x - (dx / d) * r), y, r2(BURN.z - (dz / d) * r)];
})();
const wasteFrom = [192.4, 6.6, 77];
const wasteMid = [0, 1, 2].map((i) => (wasteFrom[i] + wasteTo[i]) / 2);
const wastePerp = (() => {
  const dx = wasteTo[0] - wasteFrom[0];
  const dz = wasteTo[2] - wasteFrom[2];
  const d = Math.hypot(dx, dz);
  return [-dz / d, dx / d];
})();
const burner = group(
  'Teepee burner',
  [
    {
      type: 'cylinder',
      id: 'burner',
      pos: [BURN.x, BURN.y, BURN.z],
      radius: BURN.r,
      radiusTop: BURN.rTop,
      height: BURN.h,
      sides: 10,
      color: C.burner,
    },
    {
      type: 'cylinder',
      id: 'burner-cap',
      pos: [BURN.x, 15.8, BURN.z],
      radius: 1.8,
      height: 1.6,
      sides: 10,
      color: C.rust,
    },
    ...[3.5, 8, 12.5].map((y) => ({
      type: 'cylinder',
      pos: [BURN.x, y, BURN.z],
      radius: r2(burnR(y) + 0.06),
      radiusTop: r2(burnR(y + 0.4) + 0.06),
      height: 0.4,
      sides: 10,
      color: C.rust,
      collide: false,
    })),
    // The ash door on the south side, leaning with the cone.
    {
      type: 'box',
      pos: [BURN.x, 0, r2(BURN.z + burnR(1.1) + 0.02)],
      size: [1.8, 2.2, 0.12],
      pitch: -14.4,
      color: C.dark,
      collide: false,
    },
    box(BURN.x - 2, BURN.z + 5.4, BURN.x + 1.6, BURN.z + 7.2, -0.2, 0.45, C.ash, {
      bulge: [0.2, 0.2, 0, 0.3, 0.2, 0.2],
      id: 'ash-heap',
    }),
    // The waste conveyor: a covered gallery on one bent.
    along(wasteFrom, wasteTo, 1.2, 0.35, C.steel),
    along(
      [wasteFrom[0], wasteFrom[1] + 1.1, wasteFrom[2]],
      [wasteTo[0], wasteTo[1] + 1.1, wasteTo[2]],
      1.4,
      0.12,
      C.rust,
    ),
    ...[-1, 1].map((s) =>
      box(
        wasteMid[0] + s * 0.55 * wastePerp[0] - 0.15,
        wasteMid[2] + s * 0.55 * wastePerp[1] - 0.15,
        wasteMid[0] + s * 0.55 * wastePerp[0] + 0.15,
        wasteMid[2] + s * 0.55 * wastePerp[1] + 0.15,
        -0.3,
        wasteMid[1] - 0.17,
        C['steel-dark'],
        { id: `waste-bent-${s < 0 ? 'w' : 'e'}` },
      ),
    ),
  ],
  { landmark: true },
);

// --- the drying kilns: six concrete chambers, rails running out of their doors to the
// apron. Each is laid out differently; the fourth is the locked key room (kiln-key).
const KILN = { z0: sz(280), z1: sz(319), w: 5, tall: 4.5 };
const kilns = [];
/** The key room's floor, for its quest marker. */
let keyRoom;
for (let k = 0; k < 6; k++) {
  const x0 = sx(652 + 21 * k);
  const x1 = x0 + KILN.w;
  const cx = x0 + KILN.w / 2;
  const [lo, hi] = groundRange(x0, KILN.z0, x1, KILN.z1 + 5);
  const fl = r2(hi + 0.1);
  const top = fl + KILN.tall;
  const name = k === 3 ? 'kiln-locked' : `kiln-${k + 1}`;
  if (k === 3) keyRoom = { x: cx, z: KILN.z0 + 6.5, y: fl };
  // [north end, south end]: 'open' (the big door gone), 'wicket' (shut with a small door
  // in it), 'locked' (a wicket that needs the kiln key), 'shut'.
  const ends = [
    ['open', 'open'],
    ['wicket', 'open'],
    ['open', 'open'],
    ['shut', 'locked'],
    ['open', 'open'],
    ['shut', 'shut'],
  ][k];
  const end = (side, kind) => {
    const z = side === 'n' ? KILN.z0 + 0.15 : KILN.z1 - 0.15;
    const out = side === 'n' ? -1 : 1;
    const nodes = [];
    const openings =
      kind === 'open'
        ? [{ along: 0, width: 3.4, bottom: 0, top: 3.6 }]
        : kind === 'shut'
          ? []
          : [{ along: 0.6, width: 1.1, bottom: 0, top: 2.1 }];
    nodes.push(wallX(`${name}-end-${side}`, x0 + 0.3, x1 - 0.3, z, fl, top, C.concrete, openings));
    if (kind === 'open') {
      // The door's steel frame round the opening.
      const z0 = Math.min(z + out * 0.15, z + out * 0.2);
      const z1 = Math.max(z + out * 0.15, z + out * 0.2);
      nodes.push(drawn(cx - 1.85, z0, cx - 1.7, z1, fl, fl + 3.75, C.steel));
      nodes.push(drawn(cx + 1.7, z0, cx + 1.85, z1, fl, fl + 3.75, C.steel));
      nodes.push(drawn(cx - 1.85, z0, cx + 1.85, z1, fl + 3.6, fl + 3.75, C.steel));
    } else {
      // The big door, shut: a ribbed steel panel on the outside face.
      const z0 = Math.min(z + out * 0.15, z + out * 0.2);
      const z1 = Math.max(z + out * 0.15, z + out * 0.2);
      for (const dx of [-1.7, -0.6, 1.4])
        nodes.push(drawn(cx + dx - 0.25, z0, cx + dx + 0.25, z1, fl, fl + 3.6, C['steel-dark']));
      nodes.push(drawn(cx - 1.75, z0, cx + 1.75, z1, fl + 3.5, fl + 3.7, C['steel-dark']));
    }
    if (kind === 'wicket' || kind === 'locked')
      nodes.push({
        type: 'door',
        id: `${name}-door-${side}`,
        pos: [r2(cx + 0.6), fl, r2(z)],
        yaw: 0,
        size: [1.1, 2.1],
        thickness: 0.08,
        color: kind === 'locked' ? C['siding-red'] : C.steel,
        ...(kind === 'locked' ? { key: 'kiln-key' } : {}),
      });
    return nodes;
  };
  const shell = [
    box(x0, KILN.z0, x1, KILN.z1, lo - 0.3, fl, C['dark-concrete'], { id: `${name}-floor` }),
    wallZ(`${name}-wall-w`, x0 + 0.15, KILN.z0, KILN.z1, fl, top, C.concrete),
    wallZ(`${name}-wall-e`, x1 - 0.15, KILN.z0, KILN.z1, fl, top, C.concrete),
    ...end('n', ends[0]),
    ...end('s', ends[1]),
    box(x0 - 0.2, KILN.z0 - 0.2, x1 + 0.2, KILN.z1 + 0.2, top, top + 0.3, C.roof, {
      id: `${name}-roof`,
    }),
    // Fan housings on the roof and the controls by the south door.
    drawn(cx - 0.6, KILN.z0 + 3, cx + 0.6, KILN.z0 + 4.2, top + 0.3, top + 1, C.metal),
    drawn(cx - 0.6, KILN.z1 - 4.2, cx + 0.6, KILN.z1 - 3, top + 0.3, top + 1, C.metal),
    drawn(x1, KILN.z1 - 1.5, x1 + 0.2, KILN.z1 - 0.9, fl + 1, fl + 1.9, C.machine),
  ];
  // Rails down the middle and out onto the south apron.
  if (k !== 5)
    for (const s of [-0.72, 0.72])
      shell.push(
        drawn(cx + s - 0.04, KILN.z0 + 0.3, cx + s + 0.04, KILN.z1 + 5, fl, fl + 0.08, C.rail),
      );
  /** A kiln cart with a tall stack of lumber, long along z. */
  const cart = (x, z, extra = {}) => [
    box(x - 0.7, z - 2.45, x + 0.7, z + 2.45, fl, fl + 0.35, C['steel-dark']),
    prefab('lumber-stack-tall', x, z, { yaw: 90, ...extra }, fl + 0.35),
  ];
  const inside = [
    // 1: two carts down the middle, a lane either side.
    [...cart(cx, KILN.z0 + 3.4), ...cart(cx, KILN.z1 - 3.4)],
    // 2: one cart pushed against the west wall at the back; the wicket opens past it.
    [...cart(x0 + 1.05, KILN.z0 + 3.4), prefab('lumber-stack', cx, KILN.z1 - 2.5, { yaw: 90 }, fl)],
    // 3: empty, its cart out on the apron.
    [...cart(cx, KILN.z1 + 2.6)],
    // 4: the key room: shelving down both walls and a workbench at the back.
    [
      prefab('store-shelf', x0 + 0.78, KILN.z0 + 3.5, { yaw: 90 }, fl),
      prefab('store-shelf', x0 + 0.78, KILN.z0 + 7, { yaw: 90 }, fl),
      prefab('store-shelf', x1 - 0.78, KILN.z0 + 5, { yaw: -90 }, fl),
      box(x0 + 0.6, KILN.z0 + 0.4, x1 - 0.6, KILN.z0 + 1.2, fl, fl + 0.9, C.timber, {
        id: 'key-room-bench',
      }),
      prefab('crate', x1 - 0.9, KILN.z1 - 2, {}, fl),
      prefab('crate', x1 - 0.9, KILN.z1 - 2, { yaw: 15 }, fl + 0.8),
    ],
    // 5: carts staggered, west at the back, east at the front: a zigzag.
    [...cart(x0 + 1.05, KILN.z0 + 3.4), ...cart(x1 - 1.05, KILN.z1 - 3.4)],
    // 6: shut both ends.
    [],
  ][k];
  kilns.push(group(name, [...shell, ...inside]));
}

const core = group('Sawmill core', [sawmill, jackLadder, burner, group('Drying kilns', kilns)]);

// --- the mill race tunnel
const T = TUNNEL;
const zc = (T.z0 + T.z1) / 2;
const bankW = 158.5;
const bankE = 173.5;
const hatch = { x0: 178, x1: 179.6 };
const shaftW = { x0: T.x0, x1: 128 };
const shaftE = { x0: 204, x1: T.x1 };
const tunnel = group('Mill race tunnel', [
  box(T.x0, T.z0, T.x1, T.z1, T.floor - 0.4, T.floor, C['dark-concrete'], { id: 'tunnel-floor' }),
  // Side walls: up to the ground at the stair shafts, to the ceiling between them.
  ...[
    ['n', T.z0, T.z0 + 0.5],
    ['s', T.z1 - 0.5, T.z1],
  ].flatMap(([side, z0, z1]) => [
    box(shaftW.x0, z0, shaftW.x1, z1, T.floor, 0, C['dark-concrete'], {
      id: `shaft-w-wall-${side}`,
    }),
    box(shaftW.x1, z0, shaftE.x0, z1, T.floor, T.ceiling, C['dark-concrete'], {
      id: `tunnel-wall-${side}`,
    }),
    box(shaftE.x0, z0, shaftE.x1, z1, T.floor, 0, C['dark-concrete'], {
      id: `shaft-e-wall-${side}`,
    }),
    box(
      shaftW.x0,
      z0 + (side === 'n' ? 0 : 0.3),
      shaftW.x1,
      z1 - (side === 'n' ? 0.3 : 0),
      0,
      1,
      C.metal,
      {
        id: `shaft-w-rail-${side}`,
      },
    ),
    box(
      shaftE.x0,
      z0 + (side === 'n' ? 0 : 0.3),
      shaftE.x1,
      z1 - (side === 'n' ? 0.3 : 0),
      0,
      1,
      C.metal,
      {
        id: `shaft-e-rail-${side}`,
      },
    ),
  ]),
  {
    type: 'stairs',
    id: 'tunnel-stairs-w',
    pos: [(shaftW.x0 + shaftW.x1) / 2, T.floor, zc],
    yaw: -90,
    size: [3, -T.floor, shaftW.x1 - shaftW.x0],
    color: C.concrete,
  },
  {
    type: 'stairs',
    id: 'tunnel-stairs-e',
    pos: [(shaftE.x0 + shaftE.x1) / 2, T.floor, zc],
    yaw: 90,
    size: [3, -T.floor, shaftE.x1 - shaftE.x0],
    color: C.concrete,
  },
  // The roof: ground-level fill on land, the creek bed's slab under the creek.
  box(shaftW.x1, T.z0, bankW, T.z1, T.ceiling, 0, C.dirt, { id: 'tunnel-roof-w' }),
  box(bankW, T.z0, bankE, T.z1, T.ceiling, -3.5, C.dirt, { id: 'tunnel-roof-creek' }),
  box(bankE, T.z0, hatch.x0, T.z1, T.ceiling, 0, C.dirt, { id: 'tunnel-roof-mid' }),
  box(hatch.x1, T.z0, shaftE.x0, T.z1, T.ceiling, 0, C.dirt, { id: 'tunnel-roof-e' }),
  // Over the creek the holes take the water's depth away, so this keeps it uncrossable.
  box(bankW, T.z0, bankE, T.z1, -3.5, 12, C.concrete, { id: 'creek-over-tunnel', invisible: true }),
  {
    type: 'ladder',
    id: 'hatch-ladder',
    pos: [hatch.x0, T.floor, zc],
    yaw: 90,
    height: -T.floor,
    color: C.ladder,
  },
  // Rails across the shafts' deep ends (MT-3: walking off the roof dropped you 4.6 m).
  box(shaftW.x1 - 0.1, T.z0, shaftW.x1, T.z1, 0, 1, C.metal, { id: 'shaft-w-rail-e' }),
  box(shaftE.x0, T.z0, shaftE.x0 + 0.1, T.z1, 0, 1, C.metal, { id: 'shaft-e-rail-w' }),
  // The race's headgate house by the east exit, which was in open ground (MT-3).
  box(213, 98.5, 220, 103.5, -0.3, 3.2, C.concrete, { id: 'headgate-house' }),
  // Its finish (MT-11), all drawn: a roof slab with an overhang, a steel door east, small
  // high windows north and south, and the gate's wheel on the west wall over the race.
  drawn(212.7, 98.2, 220.3, 103.8, 3.2, 3.45, C['dark-concrete'], { id: 'headgate-roof' }),
  drawn(220, 100.4, 220.04, 101.6, 0, 2.1, C.rust, { id: 'headgate-door' }),
  drawn(219.4, 100.4, 220.3, 101.6, 0, 0.12, C['dark-concrete'], { id: 'headgate-step' }),
  ...[214.5, 217.5].flatMap((x, k) => [
    drawn(x, 98.46, x + 1.2, 98.5, 2.1, 2.7, C.glass, { id: `headgate-window-n${k + 1}` }),
    drawn(x, 103.5, x + 1.2, 103.54, 2.1, 2.7, C.glass, { id: `headgate-window-s${k + 1}` }),
  ]),
  {
    type: 'cylinder',
    id: 'headgate-wheel',
    pos: [212.85, 1.0, 101],
    radius: 0.45,
    height: 0.08,
    sides: 8,
    roll: 90,
    color: C.ladder,
    collide: false,
  },
  drawn(212.82, 100.92, 212.98, 101.08, 0.4, 1.45, C.metal, { id: 'headgate-stem' }),
  box(hatch.x0, T.z0, hatch.x1, T.z0 + 0.1, 0, 1, C.metal, { id: 'hatch-rail-n' }),
  box(hatch.x0, T.z1 - 0.1, hatch.x1, T.z1, 0, 1, C.metal, { id: 'hatch-rail-s' }),
  box(hatch.x1 - 0.1, T.z0, hatch.x1, T.z1, 0, 1, C.metal, { id: 'hatch-rail-e' }),
]);

// Inside the tunnel (MT-5): cover staggered north and south every 12-17 m, each 1.6 m of the
// 3 m width and 1.7 m high, so the 76 m run has no straight line along it and a body passes
// each one by 1.4 m. Ribs, lamps and a wet gutter are drawn only.
{
  const fl = T.floor;
  const nIn = T.z0 + 0.5;
  const sIn = T.z1 - 0.5;
  const crates = (x, zs, layers) =>
    layers.flatMap((n, y) =>
      Array.from({ length: n }, (_, i) =>
        prefab(
          'crate',
          x + (i - (n - 1) / 2) * 0.86 + (y % 2) * 0.1,
          zs,
          { yaw: y * 7 },
          fl + y * 0.8,
        ),
      ),
    );
  const cover = [
    // West of the creek, north side: crates two wide, two deep, two high.
    ...crates(140, nIn + 0.43, [2, 2]),
    ...crates(140, nIn + 1.3, [2, 2]),
    // South side: offcuts stacked against the wall.
    box(151, sIn - 1.6, 153.4, sIn, fl, fl + 1.7, C['timber-dark'], { id: 'race-offcuts' }),
    drawn(150.98, sIn - 1.62, 153.42, sIn, fl + 0.55, fl + 0.6, C.timber),
    drawn(150.98, sIn - 1.62, 153.42, sIn, fl + 1.15, fl + 1.2, C.timber),
    // Under the creek, north side: a fall of roof and the slab it came from.
    box(167.8, nIn, 170.2, nIn + 1.6, fl, fl + 1.7, C.stone, {
      id: 'race-roof-fall',
      bulge: [0.15, 0.15, 0, 0.25, 0, 0.2],
      top: [1.6, 1],
    }),
    along([167.4, fl + 0.3, nIn + 1.9], [170.6, fl + 1.5, nIn + 1.2], 1.2, 0.2, C.concrete),
    // North side again past the offcuts: more crates.
    ...crates(155.5, nIn + 0.43, [2, 2]),
    ...crates(155.5, nIn + 1.3, [2, 1]),
    // South side under the east bank: planks.
    box(172.8, sIn - 1.6, 175.2, sIn, fl, fl + 1.7, C.timber, { id: 'race-planks' }),
    // East of the hatch, north side: crates, one fallen.
    ...crates(184, nIn + 0.43, [2, 2]),
    ...crates(184, nIn + 1.3, [2, 1]),
    prefab('crate', 185.6, nIn + 1.9, { yaw: 35 }, fl),
    // South side: an old pump.
    box(189, sIn - 1.6, 191, sIn, fl, fl + 1.7, C.machine, { id: 'race-pump' }),
    drawn(189.4, sIn - 1.9, 190.6, sIn - 1.6, fl + 0.4, fl + 0.8, C['steel-dark']),
    // North side by the east shaft: a spare sluice gate leaned on the wall.
    box(195, nIn, 197.2, nIn + 1.6, fl, fl + 1.8, C['steel-dark'], { id: 'race-sluice-gate' }),
    ...[195.5, 196.1, 196.7].map((x) =>
      drawn(x - 0.06, nIn + 1.6, x + 0.06, nIn + 1.64, fl, fl + 1.8, C.steel),
    ),
  ];
  const trim = [];
  for (let x = 132; x <= 200; x += 8) {
    trim.push(drawn(x - 0.2, nIn, x + 0.2, nIn + 0.08, fl, T.ceiling, C.concrete));
    trim.push(drawn(x - 0.2, sIn - 0.08, x + 0.2, sIn, fl, T.ceiling, C.concrete));
    trim.push(drawn(x - 0.2, nIn, x + 0.2, sIn, T.ceiling - 0.15, T.ceiling, C.concrete));
  }
  for (let x = 136; x <= 196; x += 12)
    trim.push(
      drawn(x - 0.25, zc - 0.12, x + 0.25, zc + 0.12, T.ceiling - 0.25, T.ceiling - 0.15, C.lamp),
    );
  trim.push(drawn(T.x0 + 12, sIn - 0.4, T.x1 - 12, sIn, fl, fl + 0.02, C.water));
  tunnel.nodes.push(group('Tunnel cover', cover), group('Tunnel trim', trim));
}

// --- east end: scripts/silver-creek-east.mjs (MT-8), built once every helper is defined.
// The water tower's place is kept here for its label.
const tower = { x: sx(946), z: sz(262) };

// --- trees
const sketchTrees = [
  // ridge
  [42.9, 56.1],
  [44.8, 66.8],
  [60.4, 51.9],
  [63.9, 67.3],
  [80, 55.6],
  [94.2, 53.5],
  [89.3, 72.3],
  [107.3, 54.1],
  [102, 67.9],
  [119.3, 55.6],
  [123.6, 71.4],
  [136.2, 57.7],
  [140.3, 67.3],
  [147.9, 54.9],
  [153.4, 70.5],
  [167.8, 55.7],
  [169.1, 73.2],
  [177, 56.5],
  [194.1, 54.2],
  [195.7, 67.6],
  [213.4, 52.3],
  [214.3, 67],
  [229.5, 57.3],
  [225.2, 69],
  [238.1, 68.1],
  [256.8, 53.3],
  [254.8, 70.5],
  [271.1, 55.8],
  [274.6, 72],
  [285, 54.3],
  [282.1, 66.9],
  [299.6, 51.8],
  [297.4, 69],
  [312.8, 68.2],
  [327.6, 57.5],
  [330.9, 67],
  [343.9, 57.4],
  [350.1, 70.2],
  [356.7, 55.2],
  [373.9, 54],
  [376.3, 72],
  [393.8, 58.5],
  [393.9, 71.7],
  [404.7, 51.6],
  [403.8, 71.4],
  [424.9, 58.5],
  [418.5, 68],
  [437.1, 57.9],
  [437.4, 72.2],
  [454.7, 57],
  [448.1, 72.1],
  [470.2, 54.3],
  [478, 52.3],
  [492.8, 57.4],
  [494.7, 70.4],
  [515.2, 56.1],
  [529.3, 57.3],
  [524.1, 68.1],
  [540.3, 52.3],
  [540.6, 70.6],
  [559.8, 55],
  [551.7, 69.6],
  [573.7, 52.6],
  [571.5, 68.7],
  [588.6, 52.2],
  [584, 72],
  [603.3, 58],
  [601, 70.1],
  [616.3, 54.8],
  [619.4, 73.2],
  [815, 57.4],
  [810.5, 66.9],
  [827.5, 57],
  [827.9, 71.2],
  [860.1, 54.3],
  [868, 54.5],
  [868.3, 68.7],
  [886.5, 54.6],
  [887.1, 70.1],
  [905.2, 67.2],
  [918.5, 53.3],
  [919.7, 72.3],
  [934.8, 55.5],
  [927, 71.4],
  [949.9, 56],
  [949.2, 66.9],
  [959.6, 55.4],
  [957.7, 70.2],
  [973, 51.8],
  [974.2, 71.9],
  [988.1, 53.9],
  [986.6, 71.7],
  // south edge
  [46.2, 486.9],
  [63.5, 488.1],
  [85, 488.2],
  [103.1, 487.7],
  [119.6, 488.2],
  [140.2, 486.7],
  [153, 485.7],
  [177.2, 486.1],
  [189.3, 488.2],
  [212.5, 486.2],
  [227.1, 486.9],
  [246.5, 486.1],
  [269.3, 487.2],
  [287.2, 486.3],
  [296.5, 486.6],
  [319, 485.9],
  [332.5, 486.2],
  [354.1, 485.4],
  [371.2, 486],
  [391.3, 487.9],
  [410.9, 488.4],
  [425.4, 488.7],
  [447, 487.5],
  [466, 488.4],
  [483.1, 488.1],
  [571.2, 487],
  [591.7, 488.2],
  [610.5, 487.7],
  [622.6, 485.3],
  [641.7, 485.6],
  [661.5, 487.5],
  [680.6, 487],
  [699.7, 487.9],
  [715.3, 487.6],
  [735.1, 486.1],
  [748.9, 487.8],
  [771.2, 488.7],
  [785.9, 486.9],
  [807.4, 487.4],
  [819.2, 485.7],
  [843.2, 486.3],
  [854.6, 485.4],
  [878.5, 487.7],
  [893.1, 487.1],
  [912.7, 485.6],
  [928.3, 488.7],
  [944.7, 486.9],
  [971.2, 486.8],
  [982.4, 488.6],
  // small groups used as cover
  [234.9, 361.4],
  [248.3, 361.2],
  [232.3, 379.3],
  [222.3, 379.5],
  [214.9, 358.1],
  [230.2, 365.2],
  [712.4, 377.6],
  [700.1, 388],
  [704.3, 392.2],
  [732.5, 377],
  [714.1, 394],
  [395, 422.3],
  [383.7, 414.4],
  [392.3, 434.5],
  [391.6, 424.3],
  [395.4, 434.9],
];
const trees = [];
for (const [px, py] of sketchTrees) {
  const x = sx(px);
  const z = sz(py);
  // Not in the creek's ravine, on the trail or on a building.
  if (groundAt(x, z) < baseHeight(x, z) - 0.3) continue;
  if (z > TRAIL.z0 - 1.5 && z < TRAIL.z1 + 1.5) continue;
  if (x > 72 && x < 96 && z > 5 && z < 17) continue;
  if (x > 25 && x < 48 && z > 3 && z < 13) continue;
  trees.push(tree(x, z));
}

// --- water
function creekBodies(line, level, id, clipStart) {
  const out = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    // Overlap the next piece, but not past the dam at the start of the south creek.
    const before = i === 0 && clipStart ? 0 : 2;
    const after = 2;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const mid = (after - before) / 2;
    out.push({
      type: 'water',
      id: `${id}-${i + 1}`,
      pos: [r2((ax + bx) / 2 + ux * mid), level, r2((az + bz) / 2 + uz * mid)],
      yaw: r2((Math.atan2(ux, uz) * 180) / Math.PI),
      size: [16, r2(len + before + after)],
      color: C.water,
    });
  }
  return out;
}
const water = group('Water', [
  ...creekBodies(CREEK_NORTH, POND_LEVEL, 'creek-north', false),
  {
    type: 'water',
    id: 'mill-pond',
    pos: [POND.x, POND_LEVEL, r2((42 + DAM_Z - 1) / 2)],
    size: [2 * POND.rx + 8, r2(DAM_Z - 1 - 42)],
    color: C.water,
  },
  {
    type: 'water',
    id: 'mill-race',
    pos: [145, RACE_LEVEL, r2((DAM_Z - 1 + 74) / 2)],
    size: [4, r2(74 - DAM_Z + 1)],
    color: C.water,
  },
  ...creekBodies(CREEK_SOUTH, CREEK_LEVEL, 'creek', true),
]);

// --- roads
const road = (id, x0, z0, x1, z1, color = C.road) => ({
  id,
  ...box(x0, z0, x1, z1, 0, 0.04, color, { collide: false }),
});
const roads = group('Roads', [
  road('highway-w', -MARGIN, 114.5, bridgeX - 11, 121.5),
  road('highway-e', bridgeX + 11, 114.5, W + MARGIN, 121.5),
  road('lane-houses', 28, 79.5, 96, 83),
  road('lane-yard', 92.5, 79.5, 96, 114.5),
  road('lane-mill', 190, 102, 194, 114.5),
  road('lane-depot', 238, 121.5, 242, 124),
  road('forecourt', 10, 121.5, 46, 134, C.road),
  {
    id: 'ridge-trail',
    ...box(-MARGIN, 18.5, jamCenter - jamHalf, 21.5, TRAIL_Y, TRAIL_Y + 0.04, C.dirt, {
      collide: false,
    }),
  },
  {
    id: 'ridge-trail-e',
    ...box(jamCenter + jamHalf, 18.5, W + MARGIN, 21.5, TRAIL_Y, TRAIL_Y + 0.04, C.dirt, {
      collide: false,
    }),
  },
]);

// --- the map's edges: invisible walls, 10 m over the highest ground along them.
const edge = (id, x0, z0, x1, z1) => {
  const [lo, hi] = groundRange(x0, z0, x1, z1);
  return { id, ...box(x0, z0, x1, z1, lo - 1, hi + 10, '#5a8ab8', { invisible: true }) };
};
const edges = group('Edges', [
  edge('edge-n', -1, -1, W + 1, 0),
  edge('edge-s', -1, D, W + 1, D + 1),
  edge('edge-w', -1, 0, 0, D),
  edge('edge-e', W, 0, W + 1, D),
]);

// --- markers
const spawn = (id, x, z, yaw, noExtracts) => ({
  type: 'playerSpawn',
  id,
  pos: [x, r2(groundAt(x, z)), z],
  yaw,
  noExtracts,
});
const WEST_EXTRACTS = ['highway-west', 'ridge-west'];
const EAST_EXTRACTS = ['highway-east', 'rail-tunnel'];
const markers = group('Spawns', [
  spawn('west-1', 5, 60, -90, WEST_EXTRACTS),
  spawn('west-2', 5, 100, -90, WEST_EXTRACTS),
  spawn('west-3', 5, 135, -90, WEST_EXTRACTS),
  spawn('east-1', 315, 28, 90, EAST_EXTRACTS),
  spawn('east-2', 315, 90, 90, EAST_EXTRACTS),
  spawn('east-3', 315, 132, 90, EAST_EXTRACTS),
]);

// Places go on the map tab in this order and one that would run into a name already placed
// is left out until you zoom in (map-tab.tsx → placeLabels), so landmarks and the quests'
// places come first. Spaced so at phone width only minor ones give way (MT-11).
const labels = group('Map labels', [
  label('Company town', 50, 58, 'area'),
  label('Sawmill', 166, 84, 'area', MILL.floor),
  label('Rail yard', 240, 52, 'area'),
  label('Ridge', 195, 8, 'area'),
  // landmarks and the starter quests' places
  label('Fire lookout', LOOKOUT.x, LOOKOUT.z + 4),
  label('Teepee burner', 201, 64),
  label('Water tower', tower.x, 66),
  label('Pump house', 296.75, 74.5),
  // On the water, y 0 or the trail's height: the bed's height put these on the Tunnel floor.
  label('Log jam', 160, 15, undefined, TRAIL_Y),
  label('Log boom', 166, 58.5, undefined, 0),
  label('Weir ford', fordX, 136, undefined, 0),
  label('Kiln 4', 227.5, 84.5),
  label('Headgate house', 217, 105),
  // the rest
  label('Company office', 24, 37),
  label('Sheds', 57, 44),
  label('Gas station', 28, 127),
  label('Log deck', 112, 44),
  label('Timber yard', 117, 90),
  label('Mill pond', 165, 50, undefined, 0),
  label('Drying kilns', 225, 92),
  label('Mill office', 185, 97, undefined, MILL.floor),
  label('Road bridge', bridgeX, 118, undefined, 0),
  label('Engine shed', 262, 65),
  label('Loading tower', 277.5, 36.5),
  label('Freight dock', 248, 40),
  label('Fuel tanks', 270, 129),
  label('Bunkhouse', 283, 96),
  label('Cookhouse', 278, 108),
  label('Equipment depot', 240, 137),
  label('Hunting cabin', 84, 12),
  label('Campsite', 126, 12),
  label('Clear-cut', 228, 14),
  label('Rollway', 136, 46),
  label('Mill race tunnel', 166, zc - 4, undefined, T.floor),
  // The tunnel's ways out, on its own floor.
  label('West stairs', (shaftW.x0 + shaftW.x1) / 2, zc + 3, undefined, T.floor),
  label('East stairs', (shaftE.x0 + shaftE.x1) / 2, zc + 3, undefined, T.floor),
  label('Ladder hatch', (hatch.x0 + hatch.x1) / 2, zc + 3, undefined, T.floor),
]);

const helpers = { box, drawn, group, prefab, along, label, C, r2, groundAt, groundRange };
const site = { TRAIL, TRAIL_Y, DAM_Z, jamCenter, jamHalf, bridgeX, fordX, sx, sz, CABIN_PAD };

const map = {
  formatVersion: 4,
  id: 'silver-creek',
  name: 'Silver Creek',
  environment: { sky: '#a9b2b6', fogNear: 45, fogFar: 120 },
  terrain: { origin: ORIGIN, cellSize: CELL, heights, holes, color: '#7a7a4c' },
  // The AI (MT-9): design/ai-scavs-pmcs-bosses.md → Silver Creek.
  hearingScale: 0.6,
  pmcs: { count: [2, 4], pmcSpawnsOnly: true },
  nodes: [
    markers,
    buildWestEnd({ box, drawn, group, prefab, along, label, C, r2, groundRange }),
    buildMiddle(helpers, site),
    core,
    tunnel,
    buildEastEnd(helpers, { tower, PIT }),
    buildRidge(helpers, site),
    group('Trees', trees),
    water,
    roads,
    edges,
    labels,
    ...buildAi(helpers),
    buildQuests(helpers, { lookout: LOOKOUT, tunnel: T, keyRoom }),
  ],
  floors: [
    { name: 'Tunnel', y: T.floor },
    { name: 'Ground', y: 0 },
  ],
  zones: [
    {
      id: 'highway-west',
      name: 'Highway west',
      points: [
        [0, 113],
        [6, 113],
        [6, 123],
        [0, 123],
      ],
      extraction: { y: 0, height: 4 },
    },
    {
      id: 'ridge-west',
      name: 'Ridge trail west',
      points: [
        [0, 16],
        [6, 16],
        [6, 24],
        [0, 24],
      ],
      extraction: { y: TRAIL_Y, height: 4 },
    },
    {
      id: 'highway-east',
      name: 'Highway east',
      points: [
        [314, 113],
        [320, 113],
        [320, 123],
        [314, 123],
      ],
      extraction: { y: 0, height: 4 },
    },
    {
      id: 'rail-tunnel',
      name: 'Rail tunnel',
      points: [
        [312, 41],
        [320, 41],
        [320, 54],
        [312, 54],
      ],
      extraction: { y: 0.25, height: 5 },
    },
  ],
};

const raid = {
  formatVersion: 1,
  id: 'silver-creek',
  name: 'Silver Creek',
  map: 'silver-creek',
  duration: 1200,
  order: 1,
  tags: ['starter'],
};

async function write(path, doc) {
  const options = (await prettier.resolveConfig(path)) ?? {};
  await writeFile(path, await prettier.format(layout(doc), { ...options, filepath: path }));
  console.log(`wrote ${path.slice(ROOT.length + 1)}`);
}

if (existsSync(MAP_FILE) && !process.argv.includes('--force')) {
  console.error(
    'content/maps/silver-creek.json exists (maybe reshaped in the editor); --force to overwrite',
  );
  process.exit(1);
}
// Keep anything placed by hand for testing (top-level groups named "… (test placement)").
if (existsSync(MAP_FILE)) {
  const old = JSON.parse(await readFile(MAP_FILE, 'utf8'));
  map.nodes.push(
    ...old.nodes.filter((n) => n.type === 'group' && / \(test placement\)$/.test(n.name ?? '')),
  );
}
await write(MAP_FILE, map);
await write(RAID_FILE, raid);
