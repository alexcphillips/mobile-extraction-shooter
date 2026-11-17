// Generates the Silver Creek graybox (roadmap MT-2): content/maps/silver-creek.json and
// content/raids/silver-creek.json, from the whiteboard sketch (docs/design/maps/silver-creek.md).
// Re-runs keep what the user made or changed by hand (MK-2, scripts/mapkit/generated.mjs):
// groups still as the script last wrote them are replaced, edited ones kept and listed. The
// raid file is only written when it doesn't exist.
//
//   node scripts/gen-silver-creek.mjs [--dry-run] [--reclaim <key>,… | all]
//
// The play area is x 0..320 (west to east), z 0..150 (north to south); the sketch's pixels
// are 3 to the meter from (40, 46). The valley floor is y 0, the ridge rises to the north.
import { buildAi } from './silver-creek-ai.mjs';
import { buildEastEnd } from './silver-creek-east.mjs';
import { buildMiddle, buildRidge } from './silver-creek-middle.mjs';
import { buildQuests } from './silver-creek-quests.mjs';
import { buildMillLoft, LOFT, LOFT_DOOR } from './silver-creek-mill.mjs';
import { buildPowerhouse } from './silver-creek-powerhouse.mjs';
import { buildSubstation } from './silver-creek-substation.mjs';
import { buildWestEnd } from './silver-creek-west.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGenerated, writeOnce } from './mapkit/generated.mjs';
import { along, box, drawn, group, prefab as placed, r2 } from './mapkit/nodes.mjs';
import { terrainGrid } from './mapkit/terrain.mjs';

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
  // Inside the rail tunnel's portal (z 38.5..56.5) it starts behind the portal's back.
  const hill = z > 38.5 && z < 56.5 ? 325 : 321;
  if (x > hill && !(z > 108 && z < 128)) h = Math.max(h, Math.min(10, (x - hill) * 0.8));
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
 * How deep the creek and pond are (2026-11-16, the user's call, over 2–3 m that stopped you
 * like a wall and made buggy banks): waist height, so you wade them anywhere, at 70% speed.
 */
const WADE = 1;
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
  // Across the mill race tunnel the creek keeps one profile, its z 106 one, so the roof under
  // it (2 m ramps from vertex to vertex) meets the ground on both sides exactly.
  if (z > TUNNEL.z0 - 1e-6 && z < TUNNEL.z1 + 1e-6 && x > CREEK_ROOF.x0 && x < CREEK_ROOF.x1)
    z = (TUNNEL.z0 + TUNNEL.z1) / 2;
  const ground = baseHeight(x, z);
  let h = ground;
  const d = distToPolyline(CREEK, x, z);
  const ford = z >= FORD.z0 && z <= FORD.z1;
  const bed = z < DAM_Z ? POND_LEVEL - WADE : ford ? FORD.bed : CREEK_LEVEL - WADE;
  const level = z < DAM_Z ? POND_LEVEL : CREEK_LEVEL;
  h = Math.min(h, carve(ground, bed, d, CREEK_HALF, ford ? FORD.approach : undefined, level, 2));
  const e = Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
  h = Math.min(h, carve(ground, POND_LEVEL - WADE, (e - 1) * POND.rz, 0, undefined, POND_LEVEL));
  // The mill race: a wadeable ditch from the pond's south-west shore to the saw hall.
  if (x >= 143 && x <= 147 && z >= 60 && z <= 75) h = Math.min(h, -1.3);
  return r2(h);
}

// The mill race tunnel runs under the creek in a strip of holes, x 116..216, z 104..108.
// The engine shed's inspection pit (MT-8) is a strip of holes too, lined in the east script.
const PIT = { x0: 252, x1: 270, z0: 62, z1: 64 };
const TUNNEL = { x0: 116, x1: 216, z0: 104, z1: 108, floor: -6, ceiling: -3.7 };
/** Where the tunnel's roof follows the creek's banks and bed, on the grid's 2 m vertices. */
const CREEK_ROOF = { x0: 158, x1: 174 };
const holes = [];
for (let j = 0; j < ROWS; j++) {
  for (let i = 0; i < COLS; i++) {
    const x = ORIGIN[0] + i * CELL;
    const z = ORIGIN[1] + j * CELL;
    if (x >= TUNNEL.x0 && x < TUNNEL.x1 && z >= TUNNEL.z0 && z < TUNNEL.z1) holes.push([i, j]);
    else if (x >= PIT.x0 && x < PIT.x1 && z >= PIT.z0 && z < PIT.z1) holes.push([i, j]);
  }
}

const { heights, groundAt, groundRange } = terrainGrid({
  origin: ORIGIN,
  cellSize: CELL,
  cols: COLS,
  rows: ROWS,
  height,
});

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
/** A window in the hall's walls at standing height (2026-11-16: the hall had none). */
const pane = (along, width = 1.6) => ({ along, width, bottom: 0.9, top: 2.0, glass: C.glass });
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
  // used by the saw hall before the west and east scripts add them
  trim: '#e0dccf',
  floorboards: '#7a6450',
  hazard: '#d8b52e',
});

/** A placed prefab; y defaults to the hall floor. */
const prefab = (name, x, z, extra = {}, y = F) => placed(name, x, z, extra, y);
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
/** A loose item's spot on the hall floor, from the mill's own tables (2026-11-16). */
const millSpot = (id, x, y, z, lootTable, chance) => ({
  type: 'lootSpawn',
  id,
  pos: [x, r2(y), z],
  lootTable,
  chance,
});

const headrig = group('Headrig', [
  prefab('toolbox', 152, 84.3, { id: 'headrig-toolbox' }, F + 1.2),
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
  // the setter's stand (solid since 2026-11-17: no fake cover)
  box(155.8, 82.9, 156.2, 83.4, F + 0.75, F + 1.9, C.machine, { id: 'carriage-setter' }),
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
  // Solid up to the drum's bottom; the cradles' arms round it are drawn.
  box(183, 77, 184.2, 81, F, F + 0.4, C['steel-dark'], { id: 'debarker-cradle-w' }),
  box(187.8, 77, 189, 81, F, F + 0.4, C['steel-dark'], { id: 'debarker-cradle-e' }),
  drawn(183, 77, 184.2, 81, F + 0.4, F + 1.1, C['steel-dark']),
  drawn(187.8, 77, 189, 81, F + 0.4, F + 1.1, C['steel-dark']),
  box(184, 81.2, 186.8, 82.8, F, F + 1.5, C.machine, { id: 'debarker-drive' }),
  millSpot('debarker-loose', 185.4, F + 1.5, 82, 'millwright', 0.4),
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
  // the millwright's tool chest by the north doorway, and a part he dropped at the unit
  prefab('tool-chest', 179.4, 74.77, { id: 'power-unit-chest' }),
  millSpot('power-unit-loose', 177.1, F, 77.2, 'hydraulics', 0.4),
]);

// Saw line: the graybox's three runs of live rolls, with the cut-throughs kept.
const sawLine = group('Saw line', [
  liveRolls('saw-line-w', 144, 158, 87.4, 88.6),
  liveRolls('saw-line-mid', 161, 164, 87.4, 88.6),
  liveRolls('saw-line-mid-2', 167, 172, 87.4, 88.6),
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
  parts.push(millSpot('green-chain-loose', 180.2, F + 0.92, 91, 'lumber-yard', 0.35));
  return group('Green chain', parts);
})();
const hallStock = group('Hall stock', [
  prefab('lumber-stack-tall', 146.6, 95.6),
  prefab('lumber-stack-tall', 157, 93.9),
  prefab('lumber-stack-tall', 158.4, 99.1),
  prefab('lumber-stack-tall', 167, 97.2),
  // Cants in the open west half of the floor, between the west door and the saw line's cut.
  prefab('lumber-stack-tall', 153.5, 91.3),
  prefab('forklift', 151.5, 98.6, { yaw: 90 }),
  prefab('wood-pallet', 174, 94.3),
  prefab('cardboard-bale', 174, 94.3, {}, F + 0.144),
  prefab('cardboard-bale', 174, 94.3, { yaw: 4 }, F + 1.044),
  // The chip bin against the south wall.
  box(162, 100, 164.5, 101.7, F, F + 2.4, C.rust, { id: 'chip-bin' }),
  drawn(161.9, 99.9, 164.6, 101.7, F + 2.4, F + 2.5, C['steel-dark']),
  prefab('sideways-steel-barrel', 141.4, 81),
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
  prefab('filing-cabinet', 183.6, 100.33, { yaw: 90 }), // the user's placement, 2026-11-17
  prefab('paper-stacks', 187.2, 96.4, {}, F + 0.76),
  prefab('clipboard', 188.1, 96.3, { yaw: 20 }, F + 0.76),
  // the foreman's file nobody was meant to see, very rarely (mythic intel: loose only)
  millSpot('mill-office-mythic-intel', 186.4, F + 0.76, 96.5, 'mythic-intel', 0.02),
  // the user's placement, 2026-11-17
  prefab('office-safe', 189, 101.18, {
    yaw: 180,
    // the payroll, and now and then something fine the foreman kept (2026-11-17: fine
    // craftwork in safes and rich rooms only)
    loot: {
      container: 'office-safe',
      searched: 'office-safe-open',
      mix: {
        tables: { 'cash-room-safe': 1, 'craftwork-fine': 0.35, 'high-value': 0.15 },
        each: true,
      },
    },
  }),
  prefab('notice-board', 188.4, 101.6, { yaw: 180 }, F),
]);

// The motor control room (2026-11-16, the user's ask: electrical loot in the middle of the
// map): the saw motors' switchgear in the hall's north-west corner, clear of the north
// doorway (x 148–152). Two doors, east (from that doorway) and south (from the saw floor),
// a window on the south; its roof at 3.5 m is out of reach (the headrig's base tops out at
// 1.5). No loot placed: room for the user's electrical cabinets along the west and east.
const MCC = { x0: MILL.x0 + 0.3, z0: MILL.z0 + 0.3, x1: 147.5, z1: 79.9, h: 3 };
const mccTop = F + MCC.h;
const motorRoom = group('Motor room', [
  wallX(
    'mcc-wall-s',
    MCC.x0,
    MCC.x1,
    MCC.z1 - 0.1,
    F,
    mccTop,
    C['office-siding'],
    [
      { along: r2(142.2 - (MCC.x0 + MCC.x1) / 2), width: 1.1, bottom: 0, top: 2.1 },
      { along: r2(145.6 - (MCC.x0 + MCC.x1) / 2), width: 1.4, bottom: 1, top: 2.1, glass: C.glass },
    ],
    0.2,
  ),
  wallZ(
    'mcc-wall-e',
    MCC.x1 - 0.1,
    MCC.z0,
    MCC.z1 - 0.2,
    F,
    mccTop,
    C['office-siding'],
    [{ at: 77.2, width: 1.1, bottom: 0, top: 2.1 }],
    0.2,
  ),
  {
    type: 'door',
    id: 'mcc-door-s',
    pos: [142.2, F, r2(MCC.z1 - 0.1)],
    yaw: 0,
    size: [1.1, 2.1],
    color: C['steel-dark'],
  },
  {
    type: 'door',
    id: 'mcc-door-e',
    pos: [r2(MCC.x1 - 0.1), F, 77.2],
    yaw: 90,
    size: [1.1, 2.1],
    color: C['steel-dark'],
  },
  box(MCC.x0, MCC.z0, MCC.x1, MCC.z1, mccTop, mccTop + 0.2, C.roof, { id: 'mcc-roof' }),
  prefab('high-voltage-sign', 143.2, r2(MCC.z1 + 0.01), {}, F + 2.4),
  // Switchgear along the north wall, batteries on the west, the control panel by the east door.
  prefab('switchgear-cabinet', 142, r2(MCC.z0 + 0.4), { id: 'mcc-switchgear-1' }, F),
  prefab('switchgear-cabinet', 144.6, r2(MCC.z0 + 0.4), { id: 'mcc-switchgear-2' }, F),
  prefab('battery-rack', r2(MCC.x0 + 0.4), 78, { id: 'mcc-batteries', yaw: 90 }, F),
  prefab('substation-control-panel', r2(MCC.x1 - 0.2), 75.4, { yaw: -90 }, F),
  prefab('electrical-panel', 144.6, r2(MCC.z1 - 0.2), { yaw: 180 }, F),
  prefab('electrical-cabinet', 143.5, r2(MCC.z1 - 0.45), { id: 'mcc-cabinet', yaw: 180 }, F),
  millSpot('mcc-rack-loose', 140.7, F + 1.3, 77.4, 'switch-room', 0.5),
  millSpot('mcc-rack-legendary', 140.7, F + 1.3, 78.6, 'legendary-industrial', 0.06), // on the battery rack
]);

// The hall's outside dress (2026-11-16): white corner boards, the big doors' sliding
// leaves pushed open beside them on their tracks, lamps over the doors, a roof monitor
// along the ridge, and a dust duct along the north wall inside. All drawn.
function millDressing() {
  const M = MILL;
  const o = 0.06; // out from the wall's face
  const trim = C.trim;
  const parts = [
    ...[
      [M.x0 - o, M.z0 - o],
      [M.x1 - 0.3, M.z0 - o],
      [M.x0 - o, M.z1 - 0.3],
      [M.x1 - 0.3, M.z1 - 0.3],
    ].map(([x, z], k) =>
      drawn(x, z, x + 0.36, z + 0.36, 0, M.tall, trim, { id: `mill-corner-${k + 1}` }),
    ),
    drawn(M.x0 - o, M.z0 - o, M.x1 + o, M.z0, 3.9, 4.05, trim, { id: 'mill-band-n' }),
    drawn(M.x0 - o, M.z1, M.x1 + o, M.z1 + o, 3.9, 4.05, trim, { id: 'mill-band-s' }),
  ];
  // [door's first x or z, its last, the wall's outer face, along x?, which side the leaf
  // slides to (+1 / -1), outward (+1 / -1)]
  const doors = [
    [148, 152, M.z0, true, 1, -1],
    [180, 184, M.z0, true, 1, -1],
    [146, 150, M.z1, true, 1, 1],
    [170, 174, M.z1, true, 1, 1],
    [86, 90, M.x0, false, 1, -1],
    [90, 94, M.x1, false, 1, 1],
  ];
  doors.forEach(([a, b, face, alongX, side, out], k) => {
    const w = b - a + 0.2;
    const [l0, l1] = side > 0 ? [b + 0.1, b + 0.1 + w] : [a - 0.1 - w, a - 0.1];
    const f0 = out > 0 ? face + 0.02 : face - 0.12;
    const f1 = f0 + 0.1;
    const leaf = alongX
      ? drawn(l0, f0, l1, f1, F, F + 3.8, C['timber-dark'], { id: `mill-leaf-${k + 1}` })
      : drawn(f0, l0, f1, l1, F, F + 3.8, C['timber-dark'], { id: `mill-leaf-${k + 1}` });
    const t0 = a - 0.2;
    const t1 = l1 + 0.1;
    const track = alongX
      ? drawn(Math.min(t0, l0), f0, Math.max(t1, b), f1, F + 3.85, F + 4.0, C['steel-dark'])
      : drawn(f0, Math.min(t0, l0), f1, Math.max(t1, b), F + 3.85, F + 4.0, C['steel-dark']);
    const mid = (a + b) / 2;
    const lamp = alongX
      ? prefab(
          'wall-light',
          mid,
          out > 0 ? face + 0.01 : face - 0.01,
          { yaw: out > 0 ? 0 : 180 },
          F + 4.2,
        )
      : prefab(
          'wall-light',
          out > 0 ? face + 0.01 : face - 0.01,
          mid,
          { yaw: out > 0 ? 90 : -90 },
          F + 4.2,
        );
    parts.push(leaf, track, lamp);
  });
  // the roof monitor: a raised strip of glass along the ridge
  parts.push(
    drawn(146, 86.4, 186, 89.6, 12.2, 13.4, C['siding-red'], { id: 'mill-monitor' }),
    drawn(146, 86.34, 186, 86.4, 12.6, 13.2, C.glass, { id: 'mill-monitor-glass-n' }),
    drawn(146, 89.6, 186, 89.66, 12.6, 13.2, C.glass, { id: 'mill-monitor-glass-s' }),
    drawn(145.7, 86.1, 186.3, 89.9, 13.4, 13.6, C.roof, { id: 'mill-monitor-roof' }),
    // the dust duct along the north wall, inside, over the machines
    drawn(141, M.z0 + 0.4, 191, M.z0 + 1.0, 6.6, 7.2, C.steel, { id: 'mill-duct' }),
  );
  return parts;
}

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
    color: C['siding-red'],
    openings: [
      door(-16),
      door(16),
      { along: 24.2, width: 1.4, bottom: 3, top: 4.4 },
      pane(-8),
      pane(6),
    ],
  },
  {
    type: 'wall',
    id: 'mill-wall-s',
    pos: [(MILL.x0 + MILL.x1) / 2, MILL.floor, MILL.z1 - 0.15],
    size: [millW, wallH, 0.3],
    color: C['siding-red'],
    openings: [
      door(-18),
      door(6),
      pane(-23),
      pane(-11),
      pane(1.5),
      pane(20),
      // the filing loft's door out onto the lumber shed's roof
      {
        along: r2(LOFT_DOOR.x - 166),
        width: LOFT_DOOR.width,
        bottom: r2(LOFT.y - MILL.floor),
        top: r2(LOFT.y - MILL.floor + 2.1),
      },
    ],
  },
  {
    type: 'wall',
    id: 'mill-wall-w',
    pos: [MILL.x0 + 0.15, MILL.floor, (MILL.z0 + MILL.z1) / 2],
    yaw: 90,
    size: [millD - 0.6, wallH, 0.3],
    color: C['siding-red'],
    openings: [door(0), pane(7), pane(-10)],
  },
  {
    type: 'wall',
    id: 'mill-wall-e',
    pos: [MILL.x1 - 0.15, MILL.floor, (MILL.z0 + MILL.z1) / 2],
    yaw: 90,
    size: [millD - 0.6, wallH, 0.3],
    color: C['siding-red'],
    openings: [door(-4), pane(4), pane(-11)],
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
  ...millDressing(),
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
// The jack ladder: an inclined log chain from the pond up into the debarker. Solid since
// 2026-11-17 (the user's call: structural parts that don't collide are fake cover): the
// trough is a sloped slab you can walk up from the bank (the AI too), its side members low
// curbs, the logs on the chain bedded into it so they're a step, not a wall. The head drive
// is a solid block closing the top and the hole into the hall, so it's a dead-end ramp
// perch about 3 m up over the pond, dropped off either side unhurt. The guide boom's logs
// in the water are solid too.
/** The trough's top surface over z (its center line is 0.15 below). */
const jackY = (z) => r2(-0.9 + (z - 59) * ((F + 3 + 0.9) / 15) + 0.15);
/** Where the solid trough ends under the head drive. */
const JACK_HEAD = 72.6;
const jackLadder = group('Jack ladder', [
  along([190.2, -0.9, 59], [190.2, jackY(JACK_HEAD) - 0.15, JACK_HEAD], 1.4, 0.3, C.steel, {
    id: 'jack-trough',
    collide: true,
  }),
  along([190.2, jackY(JACK_HEAD) - 0.15, JACK_HEAD], [190.2, F + 3, 74], 1.4, 0.3, C.steel, {
    id: 'jack-trough-head',
  }),
  ...[189.45, 190.95].map((x, k) =>
    // curbs 0.1 over the trough (an along's line is its middle), so stepping on is easy
    along(
      [x, jackY(59) - 0.075, 59],
      [x, jackY(JACK_HEAD) - 0.075, JACK_HEAD],
      0.1,
      0.35,
      C['steel-dark'],
      {
        id: `jack-side-${k ? 'e' : 'w'}`,
        collide: true,
      },
    ),
  ),
  // the logs on the chain, slim (0.4 m) and resting on the trough, so they're a 0.4 m step
  {
    ...slopedLog([190.2, jackY(63.2) + 0.2, 63.2], [190.2, jackY(70.4) + 0.2, 70.4], 0.2),
    id: 'jack-log-1',
    collide: true,
  },
  {
    ...slopedLog([190.2, jackY(59.6) + 0.2, 59.6], [190.2, jackY(62.4) + 0.2, 62.4], 0.2),
    id: 'jack-log-2',
    collide: true,
  },
  // a timber step on the east bank by the foot: the way onto the ramp (the AI's too)
  box(191.0, 61.6, 192.2, 63.0, -0.6, 0.12, C.timber, { id: 'jack-step' }),
  box(189.4, 69.8, 189.7, 70.1, -0.3, 2, C['steel-dark'], { id: 'jack-leg-w' }),
  box(190.7, 69.8, 191, 70.1, -0.3, 2, C['steel-dark'], { id: 'jack-leg-e' }),
  box(189.4, 64.9, 189.7, 65.2, -0.3, 0.6, C['steel-dark'], { id: 'jack-leg-w-2' }),
  box(190.7, 64.9, 191, 65.2, -0.3, 0.6, C['steel-dark'], { id: 'jack-leg-e-2' }),
  // the chain's dogs along the trough (drawn: 0.12 m, not cover)
  ...Array.from({ length: 10 }, (_, k) => {
    const z = 60 + k * 1.3;
    return drawn(189.9, r2(z - 0.06), 190.5, r2(z + 0.06), jackY(z), r2(jackY(z) + 0.12), C.dark, {
      id: `jack-dog-${k + 1}`,
    });
  }),
  // The head drive: a solid housing over the top of the trough and the hole into the hall,
  // its top 1.8 m over the ramp's end (past a jump and vault), the motor on its east side.
  box(189.1, JACK_HEAD, 192.0, 73.84, 2.0, F + 4.5, C.machine, { id: 'jack-head-drive' }),
  drawn(191.3, 72.55, 192.0, 73.3, F + 3.3, F + 3.9, C['steel-dark'], { id: 'jack-head-motor' }),
  drawn(189.6, 72.55, 190.8, 72.6, F + 3.5, F + 4.1, C.hazard, { id: 'jack-head-guard' }),
  // the guide boom in the water funnelling logs to the foot, two loose logs in it
  ...[
    // north of the log boom (its logs reach z 56.85)
    [
      [183.0, 57.5],
      [189.0, 58.5],
    ],
    [
      [183.0, 61.4],
      [188.6, 59.9],
    ],
    [
      [184.6, 58.7],
      [187.4, 59.5],
    ],
    [
      [184.2, 60.5],
      [186.4, 59.0],
    ],
  ].map(([a, b], k) => {
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(dx, dz);
    return {
      type: 'cylinder',
      id: `jack-boom-log-${k + 1}`,
      // a shape's pos is its base's middle; pitch turns it about its center
      pos: [r2((a[0] + b[0]) / 2), r2(-0.55 - len / 2), r2((a[1] + b[1]) / 2)],
      radius: 0.26,
      height: r2(len),
      sides: 8,
      yaw: r2((Math.atan2(dx, dz) * 180) / Math.PI),
      pitch: 90,
      color: C.log,
    };
  }),
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
/** Where the conveyor's line meets a square 1 m outside the cone's bounds (its solid end). */
const wasteCut = (() => {
  const ts = [];
  const lo = [BURN.x - BURN.r - 1, BURN.z - BURN.r - 1];
  const hi = [BURN.x + BURN.r + 1, BURN.z + BURN.r + 1];
  for (const [i, j] of [
    [0, 0],
    [2, 1],
  ])
    for (const edge of [lo[j], hi[j]]) {
      const t = (edge - wasteFrom[i]) / (wasteTo[i] - wasteFrom[i]);
      if (t > 0 && t < 1) ts.push(t);
    }
  const t = Math.min(...ts);
  return [0, 1, 2].map((i) => r2(wasteFrom[i] + (wasteTo[i] - wasteFrom[i]) * t));
})();
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
    box(BURN.x - 2, BURN.z + 5.6, BURN.x + 1.6, BURN.z + 7.4, -0.2, 0.45, C.ash, {
      bulge: [0.2, 0.2, 0, 0.3, 0.2, 0.2],
      id: 'ash-heap',
    }),
    // The waste conveyor: a covered gallery on one bent. Solid since 2026-11-17 (it was
    // drawn: overhead fake cover), 6.6 m up and more, so nobody reaches it. Solid as far as
    // the cone's bounding square (a tilted solid counts by its bounds, and so does the
    // cone), drawn for the last few meters into the cone, 10 m and more up.
    along(wasteFrom, wasteCut, 1.2, 0.35, C.steel, { id: 'waste-conveyor', collide: true }),
    along(wasteCut, wasteTo, 1.2, 0.35, C.steel, { id: 'waste-conveyor-end' }),
    along(
      [wasteFrom[0], wasteFrom[1] + 1.1, wasteFrom[2]],
      [wasteCut[0], wasteCut[1] + 1.1, wasteCut[2]],
      1.4,
      0.12,
      C.rust,
      { id: 'waste-conveyor-roof', collide: true },
    ),
    along(
      [wasteCut[0], wasteCut[1] + 1.1, wasteCut[2]],
      [wasteTo[0], wasteTo[1] + 1.1, wasteTo[2]],
      1.4,
      0.12,
      C.rust,
      { id: 'waste-conveyor-roof-end' },
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
// The burner's details (2026-11-17), off the landmark so the silhouette is unchanged, all
// drawn and hugging the cone (the field round it stays open, the user's call): seams up the
// cone, the spark arrestor's mesh dome over the cap, a concrete footing ring, the ash door's
// frame, hinges and the glow under it, two air ports and the forced-air fan's housing and
// duct on the east side, a warning plate, an ash rake leaning by the door, the waste
// conveyor's chain, rails and the hood where it enters the cone.
const burnAt = (a, y, out = 0.03) => [
  r2(BURN.x + Math.sin(a) * (burnR(y) + out)),
  y,
  r2(BURN.z + Math.cos(a) * (burnR(y) + out)),
];
const ashZ = r2(BURN.z + burnR(1.1) + 0.02);
const burnerDetails = group('Teepee burner details', [
  ...[0.3, 0.93, 1.56, 2.19, 2.82, 3.46, 4.09, 4.72, 5.35, 5.98].map((a, k) =>
    along(burnAt(a, 0.2), burnAt(a, 15.6), 0.1, 0.05, C['steel-dark'], {
      id: `burner-seam-${k + 1}`,
    }),
  ),
  {
    type: 'cylinder',
    id: 'burner-dome',
    pos: [BURN.x, 17.4, BURN.z],
    radius: 1.75,
    radiusTop: 0.5,
    height: 1.1,
    sides: 10,
    color: C.dark,
    collide: false,
  },
  {
    type: 'cylinder',
    id: 'burner-footing',
    pos: [BURN.x, -0.2, BURN.z],
    radius: r2(BURN.r + 0.3),
    radiusTop: r2(BURN.r + 0.15),
    height: 0.55,
    sides: 10,
    color: C.concrete,
    collide: false,
  },
  {
    type: 'box',
    id: 'burner-ash-door-frame',
    pos: [BURN.x, -0.05, r2(ashZ - 0.03)],
    size: [2.2, 2.55, 0.1],
    pitch: -14.4,
    color: C.rust,
    collide: false,
  },
  {
    type: 'box',
    id: 'burner-ash-glow',
    pos: [BURN.x, 0.02, r2(ashZ + 0.05)],
    size: [1.5, 0.12, 0.08],
    pitch: -14.4,
    color: '#d0642a',
    collide: false,
  },
  ...[-0.75, 0.75].flatMap((dx, k) =>
    [0.5, 1.7].map((y, j) =>
      drawn(
        BURN.x + dx - 0.12,
        ashZ + 0.06 - y * 0.26,
        BURN.x + dx + 0.12,
        ashZ + 0.12 - y * 0.26,
        y,
        y + 0.18,
        C['steel-dark'],
        {
          id: `burner-hinge-${k + 1}-${j + 1}`,
        },
      ),
    ),
  ),
  ...[1.2, 4.3].map((a, k) => {
    const [x, , z] = burnAt(a, 0.9, 0.04);
    return drawn(x - 0.35, z - 0.35, x + 0.35, z + 0.35, 0.6, 1.2, C.dark, {
      id: `burner-air-port-${k + 1}`,
    });
  }),
  // the forced-air fan: solid (no fake cover), just outside the cone's bounding square
  // (the overlap check counts the cone by its bounds), its duct drawn across to the cone
  box(
    BURN.x + BURN.r + 0.05,
    BURN.z - 0.6,
    BURN.x + BURN.r + 1.05,
    BURN.z + 0.6,
    0.0,
    1.3,
    C.machine,
    {
      id: 'burner-fan',
    },
  ),
  (() => {
    const [x, , z] = burnAt(Math.PI / 2, 1.0, 0.05);
    return drawn(x - 0.3, z - 0.25, x + 0.45, z + 0.25, 0.8, 1.3, C['steel-dark'], {
      id: 'burner-fan-duct',
    });
  })(),
  drawn(BURN.x + 1.3, ashZ - 0.25, BURN.x + 1.9, ashZ - 0.2, 1.6, 2.0, C.hazard, {
    id: 'burner-plate',
  }),
  along([BURN.x - 1.5, 0, ashZ + 0.6], [BURN.x - 1.4, 1.5, ashZ - 0.1], 0.04, 0.04, C.timber, {
    id: 'burner-rake',
  }),
  drawn(BURN.x - 1.62, ashZ + 0.5, BURN.x - 1.2, ashZ + 0.62, 0, 0.12, C['steel-dark'], {
    id: 'burner-rake-head',
  }),
  // the conveyor's chain down the trough, its rails, the hood at the cone
  along(
    [wasteFrom[0], wasteFrom[1] + 0.18, wasteFrom[2]],
    [wasteTo[0], wasteTo[1] + 0.18, wasteTo[2]],
    0.3,
    0.04,
    C.dark,
    {
      id: 'waste-chain',
    },
  ),
  ...[-1, 1].map((sd) =>
    along(
      [
        wasteFrom[0] + sd * 0.62 * wastePerp[0],
        wasteFrom[1] + 0.6,
        wasteFrom[2] + sd * 0.62 * wastePerp[1],
      ],
      [
        wasteTo[0] + sd * 0.62 * wastePerp[0],
        wasteTo[1] + 0.6,
        wasteTo[2] + sd * 0.62 * wastePerp[1],
      ],
      0.06,
      0.06,
      C['steel-dark'],
      { id: `waste-rail-${sd < 0 ? 'w' : 'e'}` },
    ),
  ),
  drawn(
    wasteTo[0] - 1.0,
    wasteTo[2] - 1.0,
    wasteTo[0] + 1.0,
    wasteTo[2] + 1.0,
    wasteTo[1] - 0.3,
    wasteTo[1] + 1.6,
    C.rust,
    {
      id: 'waste-hood',
    },
  ),
]);

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
  // Loose stock left behind (2026-11-17, `lumber-yard`): beside a cart in 1, 2 and 5, and
  // in the middle of empty 3, seen through both its open ends. Kiln 4 has its own stash.
  const stock = [
    [x0 + 1.0, KILN.z0 + 4.0, 0.3],
    [x1 - 1.2, KILN.z0 + 3.0, 0.3],
    [cx, KILN.z0 + 6.0, 0.25],
    null,
    [x1 - 1.4, KILN.z0 + 4.0, 0.3],
    null,
  ][k];
  if (stock)
    inside.push(millSpot(`${name}-stock`, r2(stock[0]), fl, r2(stock[1]), 'lumber-yard', stock[2]));
  // The key room's loot (2026-11-17, the user's list): the foreman's lockup. On the bench a
  // briefcase (his books: documents and intel), something fine now and then, salvage and
  // the jewelry case (a loose roll inside, taken once its door is open); his footlocker and
  // the mill's tool chest, a luxury and a part on the floor, salvage by the shelves.
  if (k === 3) {
    const loose = (id, x, y, z, extra) => ({
      type: 'lootSpawn',
      id,
      pos: [r2(x), r2(y), r2(z)],
      ...extra,
    });
    const top = fl + 0.9;
    inside.push(
      prefab('briefcase', 226.2, 78.8, { id: 'kiln-locked-briefcase', yaw: 8 }, top),
      loose('kiln-locked-fine', 227.1, top, 78.8, {
        // fine craftwork, now and then a prize (loose only)
        mix: { tables: { 'craftwork-fine': 3, 'craftwork-prize': 1 } },
        chance: 0.12,
      }),
      loose('kiln-locked-salvage-1', 227.9, top, 78.8, { lootTable: 'kiln-salvage', chance: 0.7 }),
      prefab('jewelry-case', 228.8, 78.75, { id: 'kiln-locked-jewelry' }, top),
      // what he skimmed and kept (2026-11-17, the user's call: containers and loose items
      // that make sense, not one stash): his footlocker of luxuries and regular jewelry, the
      // mill's own tool chest holding its best parts, a bottle and a part left out
      prefab(
        'footlocker',
        229.2,
        87.2,
        {
          id: 'kiln-locked-footlocker',
          yaw: -90,
          loot: {
            container: 'footlocker',
            mix: { tables: { 'foreman-luxuries': 1, 'foreman-jewelry': 0.4 }, each: true },
          },
        },
        fl,
      ),
      prefab(
        'tool-chest',
        226.2,
        88.6,
        {
          id: 'kiln-locked-tool-chest',
          yaw: 90,
          loot: {
            container: 'tool-cabinet',
            mix: { tables: { 'mill-best-parts': 1 }, empty: 0.15 },
          },
        },
        fl,
      ),
      loose('kiln-locked-luxury', 226.6, fl, 82.0, { lootTable: 'foreman-luxuries', chance: 0.5 }),
      loose('kiln-locked-part', 228.4, fl, 85.6, { lootTable: 'mill-best-parts', chance: 0.4 }),
      loose('kiln-locked-salvage-2', 226.6, fl, 87.0, { lootTable: 'kiln-salvage', chance: 0.6 }),
    );
  }
  kilns.push(group(name, [...shell, ...inside]));
}

const core = group('Sawmill core', [
  sawmill,
  buildMillLoft({ box, drawn, group, prefab, C }, { F }),
  motorRoom,
  jackLadder,
  burner,
  burnerDetails,
  group('Drying kilns', kilns),
]);

// --- the mill race tunnel
const T = TUNNEL;
const zc = (T.z0 + T.z1) / 2;
const bankW = CREEK_ROOF.x0;
const bankE = CREEK_ROOF.x1;
const hatch = { x0: 178, x1: 179.6 };
const shaftW = { x0: T.x0, x1: 128 };
const shaftE = { x0: 204, x1: T.x1 };
/**
 * The roof under the creek, one 2 m terrain cell at a time: a box up to the cell's lower side
 * and a ramp from there to its higher side, so its top is the ground's own slope, seamless
 * with the terrain beside the holes (2026-11-16: 0.5 m steps left gaps at the banks).
 */
function creekRoof() {
  const out = [];
  for (let x = bankW, i = 1; x < bankE - 1e-6; x += CELL, i++) {
    const hw = r2(Math.min(0, height(x, zc)));
    const he = r2(Math.min(0, height(x + CELL, zc)));
    const lo = Math.min(hw, he);
    const mid = r2(x + CELL / 2);
    out.push(box(x, T.z0, x + CELL, T.z1, T.ceiling, lo, C.dirt, { id: `tunnel-roof-creek-${i}` }));
    if (hw !== he)
      out.push({
        type: 'ramp',
        id: `tunnel-roof-creek-${i}-slope`,
        pos: [mid, lo, zc],
        yaw: he > hw ? 90 : -90,
        size: [T.z1 - T.z0, r2(Math.abs(he - hw)), CELL],
        color: C.dirt,
      });
  }
  return out;
}
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
  // The roof: ground-level fill on land; under the creek, 0.5 m strips following the banks
  // down to the bed (2026-11-16: the creek is waded now, so it's walked over).
  box(shaftW.x1, T.z0, bankW, T.z1, T.ceiling, 0, C.dirt, { id: 'tunnel-roof-w' }),
  ...creekRoof(),
  box(bankE, T.z0, hatch.x0, T.z1, T.ceiling, 0, C.dirt, { id: 'tunnel-roof-mid' }),
  box(hatch.x1, T.z0, shaftE.x0, T.z1, T.ceiling, 0, C.dirt, { id: 'tunnel-roof-e' }),
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
  // Made a room 2026-11-17 (silver-creek.md → Headgate house): doors east and north,
  // windows high in the north and south walls, the gate's gearbox inside on the west wall
  // under its stem, the gatekeeper's bench and toolbox, a level gauge, a lamp. The roof
  // slab is as before (out of reach).
  box(213, 98.5, 220, 103.5, -0.3, 0.1, C['dark-concrete'], { id: 'headgate-floor' }),
  wallX(
    'headgate-wall-n',
    213,
    220,
    98.6,
    0.1,
    3.2,
    C.concrete,
    [
      { along: -1.4, width: 1.2, bottom: 1.9, top: 2.5, glass: C.glass },
      { along: 1.9, width: 1.2, bottom: 0, top: 2.1 },
    ],
    0.2,
  ),
  wallX(
    'headgate-wall-s',
    213,
    220,
    103.4,
    0.1,
    3.2,
    C.concrete,
    [
      { along: -1.4, width: 1.2, bottom: 1.9, top: 2.5, glass: C.glass },
      { along: 1.6, width: 1.2, bottom: 1.9, top: 2.5, glass: C.glass },
    ],
    0.2,
  ),
  wallZ('headgate-wall-w', 213.1, 98.7, 103.3, 0.1, 3.2, C.concrete, [], 0.2),
  wallZ(
    'headgate-wall-e',
    219.9,
    98.7,
    103.3,
    0.1,
    3.2,
    C.concrete,
    [{ at: 101, width: 1.2, bottom: 0, top: 2.1 }],
    0.2,
  ),
  {
    type: 'door',
    id: 'headgate-door-e',
    pos: [219.9, 0.1, 101],
    yaw: 90,
    size: [1.2, 2.1],
    color: C.rust,
  },
  {
    type: 'door',
    id: 'headgate-door-n',
    pos: [218.4, 0.1, 98.6],
    yaw: 0,
    size: [1.2, 2.1],
    color: C.rust,
  },
  drawn(212.7, 98.2, 220.3, 103.8, 3.2, 3.45, C['dark-concrete'], { id: 'headgate-roof' }),
  drawn(220.0, 100.4, 220.6, 101.6, 0, 0.12, C['dark-concrete'], { id: 'headgate-step' }),
  box(213.2, 100.4, 214.1, 101.6, 0.1, 1.2, C.machine, { id: 'headgate-gearbox' }),
  drawn(213.55, 100.9, 213.75, 101.1, 1.2, 3.2, C.metal, { id: 'headgate-stem-in' }),
  {
    type: 'cylinder',
    id: 'headgate-handwheel',
    pos: [213.65, 1.2, 101],
    radius: 0.3,
    height: 0.05,
    sides: 8,
    color: C.ladder,
    collide: false,
  },
  box(215.8, 102.6, 218.6, 103.3, 0.1, 1.0, C.timber, { id: 'headgate-bench' }),
  prefab('toolbox', 217.0, 102.95, { id: 'headgate-toolbox', yaw: 180 }, 1.0),
  drawn(214.6, 98.7, 214.66, 99.0, 0.6, 2.4, '#d8d6d0', { id: 'headgate-gauge' }),
  ...[0.9, 1.3, 1.7, 2.1].map((y, k) =>
    drawn(214.66, 98.72, 214.68, 98.98, y, y + 0.03, C.dark, {
      id: `headgate-gauge-mark-${k + 1}`,
    }),
  ),
  drawn(216.4, 100.8, 216.8, 101.2, 2.95, 3.1, C.lamp, { id: 'headgate-lamp' }),
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
  // the depot's concrete apron, the shed's front to the tire shop's door
  road('lane-depot', 226, 121.5, 262, 124, C.concrete),
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
// Eight spawn points round the edge (2026-11-17, the user's call, with a PvP mode in mind:
// four parties a raid, picked from these with a distance check; PvE picks one at random).
// Each starts behind hard cover with a way along the edge and a way in toward the mill, at
// least 29 m from every extract and 30 m from every enemy spawn; the sim keeps what starts
// 60 m from the spawns actually used (sim/waves.ts). Neighbors can't see each other (the
// sight-line blockers below). Extracts are the far end's: west of the creek, the east two.
const markers = group('Spawns', [
  spawn('west-office', 6, 58, -90, WEST_EXTRACTS),
  spawn('west-lot', 24, 147.5, -20, WEST_EXTRACTS),
  spawn('north-lookout', 41.5, 7.5, -135, WEST_EXTRACTS),
  spawn('south-bank', 146, 148, 0, WEST_EXTRACTS),
  spawn('north-jam', 180, 9, 135, EAST_EXTRACTS),
  spawn('east-ridge', 300, 12, 135, EAST_EXTRACTS),
  spawn('east-tower', 315, 84, 90, EAST_EXTRACTS),
  spawn('east-yard', 290, 148, 30, EAST_EXTRACTS),
]);
/** A prefab on the lowest ground under its footprint (beds in on a slope). */
const beddedAt = (name, x, z, hw, hd, extra = {}) =>
  prefab(name, x, z, extra, r2(groundRange(x - hw, z - hd, x + hw, z + hd)[0]));
/** A prefab with a base slab on the highest ground under it (no ground up through it). */
const onTop = (name, x, z, hw, hd, extra = {}) =>
  prefab(name, x, z, extra, r2(groundRange(x - hw, z - hd, x + hw, z + hd)[1]));
// Each spawn's hard cover, and pieces that break the sight lines between neighbors down
// the west and east edge strips.
const spawnCover = group('Spawn cover', [
  prefab(
    'shed-small',
    11,
    58,
    { id: 'spc-west-office', yaw: 90, colors: { siding: C['siding-red'] } },
    0,
  ),
  onTop('log-pile-tall', 24, 144.2, 3, 1, { id: 'spc-west-lot', yaw: 4 }),
  beddedAt('rock-large', 44.5, 10.8, 2, 1, { id: 'spc-north-lookout', yaw: 30 }),
  beddedAt('rock-large', 148.6, 145.3, 2, 1, { id: 'spc-south-bank', yaw: 20 }),
  beddedAt('rock-large', 177.6, 11.4, 2, 1, { id: 'spc-north-jam-1', yaw: -15 }),
  onTop('log-pile-tall', 183.5, 12.4, 3, 1, { id: 'spc-north-jam-2', yaw: -20 }),
  beddedAt('rock-large', 302.4, 15, 2, 1, { id: 'spc-east-ridge-1', yaw: 10 }),
  beddedAt('rock-large', 296.8, 14.2, 2, 1, { id: 'spc-east-ridge-2', yaw: 25 }),
  // the lineside signal hut north of the water tower's field: east-tower's cover from the
  // north and the block on the east edge strip between it and east-ridge
  prefab(
    'shed-small',
    312.5,
    76.5,
    { id: 'spc-signal-hut', yaw: 90, colors: { siding: C['siding-red'] } },
    0,
  ),
  beddedAt('log-pile-tall', 310, 88, 3, 1, { id: 'spc-east-tower', yaw: 80 }),
  onTop('log-pile-tall', 290, 145.3, 3, 1, { id: 'spc-east-yard', yaw: -4 }),
  // down the west edge strip: west-office to west-lot, and west-lot to north-lookout
  beddedAt('lumber-stack-tall', 9.4, 75, 2.5, 1.5, { id: 'spc-west-strip-1', yaw: 75 }),
  beddedAt('log-pile-tall', 29.8, 101, 3, 1, { id: 'spc-west-strip-2', yaw: 75 }),
]);
// The open-ground pass on the middle and the east (2026-11-17, from the map report's runs
// over 40 m): the highway's north lane west of the bridge (the log truck holds the south
// lane), the south bank east of the bridge, and the diagonal through the east field
// between the kilns and the bunkhouse. The burner's field stays open (the user's call).
const openGround = group('Open-ground cover', [
  prefab('car', 110, 115.6, { id: 'og-highway-car', yaw: 12, colors: { paint: '#4a4a3a' } }, 0),
  onTop('log-pile-tall', 191, 141.5, 3, 1, { id: 'og-south-bank-1', yaw: 18 }),
  beddedAt('rock-large', 204, 142.6, 2, 1, { id: 'og-south-bank-2', yaw: -25 }),
  onTop('log-pile-tall', 258, 102, 3, 1, { id: 'og-east-field-1', yaw: 40 }),
  onTop('lumber-stack-tall', 249, 114.5, 2.5, 1.5, { id: 'og-east-field-2', yaw: 35 }),
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
  label('Motor room', 144, 77, undefined, MILL.floor),
  label('Filing room', 148.5, 99.3, undefined, LOFT.y),
  label('Lumber shed', 149, 105),
  label('Substation', 230, 103),
  label('Road bridge', bridgeX, 118, undefined, 0),
  label('Engine shed', 262, 65),
  label('Loco shop', 262.5, 76),
  label('Oil house', 252.5, 55),
  label('Sand tower', 288.5, 73),
  label('Loading tower', 277.5, 36.5),
  label('Freight dock', 248, 40),
  label('Fuel tanks', 270, 129),
  label('Bunkhouse', 283, 96),
  label('Cookhouse', 278, 108),
  label('Equipment depot', 240, 137),
  label('Equipment yard', 290, 131),
  label('Tire shop', 229, 132),
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
  scavPerSlot: 3,
  pmcs: { count: [3, 5], squads: 3, pmcSpawnsOnly: true },
  nodes: [
    markers,
    spawnCover,
    openGround,
    buildWestEnd({ box, drawn, group, prefab, along, label, C, r2, groundAt, groundRange }),
    buildMiddle(helpers, site),
    core,
    tunnel,
    buildEastEnd(helpers, { tower, PIT }),
    buildSubstation(helpers),
    buildPowerhouse(helpers),
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

const argv = process.argv.slice(2);
await writeGenerated({ file: MAP_FILE, map, by: fileURLToPath(import.meta.url), root: ROOT, argv });
await writeOnce({ file: RAID_FILE, doc: raid, root: ROOT, argv });
