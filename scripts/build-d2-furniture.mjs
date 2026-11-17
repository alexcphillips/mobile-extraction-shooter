// d2's flat-pack furniture store (2026-11-16, the user's request: "build the furniture store
// that has [flat-pack] style mazelike showrooms" at their `ikea-placeholder` cube, with "a key
// high loot area in the store, not a locked key room but a high risk high reward area").
// District's flat-pack store (district.md → the nine areas), named Fjordhem (mall.md's
// made-up name). Written into content/maps/d2.json as one group named `furniture-store`, in
// its own frame (origin the cube; x east, z south), so the user can move or turn the group
// and a re-run keeps it there. Re-runnable: it replaces its own group and the cube, nothing
// else.
//
// Plan (docs/design/maps/d2.md → The furniture store has the why):
// - A blue box, 64 × 56 m, two floors (ground 0.2, upper 5.4, roof 10.6), entrance and exit
//   on the south front, onto a car park.
// - Ground: the entrance hall (south-west; the stair up), the market hall (south, the
//   showroom's stair lands in it), the checkouts and exit cafe (south-east), bulky goods
//   pickup (east), back of house (west: office, staff room, restrooms) and, in the middle,
//   the self-serve warehouse: **the depot**, the high-risk, high-reward area (the user's pick
//   of three). The military used it as a supply depot during the evacuation: its crates sit
//   on the open floor between the rack blocks, under a double-height roof, overlooked by
//   windows from the showroom on all four sides, with nine ways in on the ground.
// - Upper: the showroom maze round the depot, drawn below as a 2 m grid (PLAN): a serpentine
//   of small room sets up the west wing, a gallery lane along the north band, the restaurant
//   in the north-east corner, a serpentine of bedrooms down the east wing, and a true maze in
//   the south block that ends at the stair down. Shortcuts as the real thing has them.
// - Ways up: the entrance stair, the showroom's stair down (both ways), and a fire stair
//   outside the west and east walls. The AI walks all four.
// - Loot: only the depot's military crates (weapon, ammo, medical). Every showroom piece is
//   loot-free (the props that carry loose spots are plain boxes here, as in the hotel).
//
// Usage: node scripts/build-d2-furniture.mjs [--dry-run] [--plan <out.png>]

import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { along, box, drawn, group, prefab, keptPlace, swapIn, r2 } from './mapkit/nodes.mjs';
import { roomWalls, union } from './mapkit/rooms.mjs';
import { stairRun } from './mapkit/runs.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');
const PLAN_OUT = process.argv.includes('--plan')
  ? process.argv[process.argv.indexOf('--plan') + 1]
  : '';
const HERE = { pos: [233.5, 0, -186] }; // the user's cube

// Levels.
const G = 0.2; // the ground floor
const U = 5.4; // the upper floor
const TOP = 10.6; // under the roof
const PH = 3.2; // showroom partitions (an invisible cap runs on up to the roof)
const T = 0.1;
const PT = 0.12; // a partition's thickness

const C = {
  facade: '#aaa395',
  accent: '#a4553a',
  parapet: '#4b4f52',
  yellow: '#f0c22e',
  inside: '#e6e2d8',
  partition: '#eeebe4',
  concrete: '#9a978f',
  floorG: '#a9a69e',
  floorU: '#c4bfb4',
  depotFloor: '#8e8c86',
  roof: '#55595e',
  steel: '#5a5f64',
  glass: '#9fc8d0',
  lamp: '#f2ecd0',
  wood: '#b98c5a',
  woodDark: '#7a5a3a',
  white: '#f2efe8',
  black: '#26282b',
  tile: '#d8d4cc',
  asphalt: '#4a4b4d',
  paint: '#e8e2d2',
  red: '#b8433a',
  green: '#4f7a4a',
  military: '#5b6142',
};
// Each room set's painted back wall and floor, in turn.
const ACCENTS = [
  '#c96f4a',
  '#5f7f9a',
  '#8a9a5b',
  '#d4b14a',
  '#7d5a7a',
  '#4f8a86',
  '#b5544f',
  '#6a6f9a',
];
const FLOORS = ['#cdb48f', '#b9b2a6', '#a7876a', '#d9d2c4', '#9c9a92', '#c2a27e'];

// ---------------------------------------------------------------------------------------
// The upper floor's plan: 2 m cells, column i at x −32 + 2i, row j at z −28 + 2j.
//   . , ; ~ =   floor you walk (west and north / south block / east wing / restaurant /
//               kitchen): two different ones side by side get a partition between them
//   :           a doorway cell: joins whatever it touches
//   o           a display island on the lane
//   X           the depot's open void (no upper floor)
//   1 2         stair holes: 1 the entrance stair, 2 the stair down to the market hall
//   any other   a room set: a rectangle with partitions round it, open on one side
// Cols 0–6 the west wing, 7–24 the north band (rows 0–3) and south block (rows 14–27),
// 25–31 the restaurant (rows 0–8) and east wing.
const PLAN = [
  // 0         1         2         3
  // 01234567890123456789012345678901
  'AABBCCCaabbccddeeffgghhii~~~~===', // 0  z −28
  'AABBCCCaabbccddeeffgghhii~~~~===', // 1
  '..........o.......o......~~~:===', // 2
  '.DDEEFF.......o.......o.:~~~~===', // 3
  '.DDEEFFXXXXXXXXXXXXXXXXXX~~~~~~~', // 4  z −20, the depot's north wall
  '.......XXXXXXXXXXXXXXXXXX~~~~~~~', // 5
  'GGHHII.XXXXXXXXXXXXXXXXXX~~~~~~~', // 6
  'GGHHII.XXXXXXXXXXXXXXXXXX~~~~~~~', // 7
  '.......XXXXXXXXXXXXXXXXXX~~~~~~~', // 8
  '.JJKKLLXXXXXXXXXXXXXXXXXX;;;:;;;', // 9
  '.JJKKLLXXXXXXXXXXXXXXXXXXjjjkkk;', // 10
  '.......XXXXXXXXXXXXXXXXXXjjjkkk;', // 11 (the west fire door)
  'MM.NNN.XXXXXXXXXXXXXXXXXXjjjkkk;', // 12
  'MM.NNN.XXXXXXXXXXXXXXXXXX;;;;;;;', // 13
  '.......,,,,,,,o,,,,,o,,,,;lllmmm', // 14 z 0, the depot's south wall
  '.PPQQRR,,,o,,,,,,,o,,,,,,;lllmmm', // 15
  '.PPQQRRuu,vvv,ww,xxx,yy,,;lllmmm', // 16
  '.......uu,vvv,ww,xxx,yy,,;;;;;;;', // 17
  'SSTTUU.,,,,,,,ww,,,,,yy,znnnppp;', // 18
  'SSTTUU.!!22,@@,,,$$,%%,,znnnppp;', // 19
  '.......!!22,@@,&&$$,%%,,znnnppp;', // 20 the arrival lane
  'VV.11..!!22,,,,&&,,,,,**,;;;;;;;', // 21 (the east fire door)
  'VV.11.o,,22^^^,&&,+++,**,;qqqrrr', // 22
  '...11..??22^^^,,,,+++,,,,;qqqrrr', // 23
  'YY.11..??,,,,,,o,,,,,,<<,;qqqrrr', // 24
  'YY.11.:,,,>>,##,99,66,<<,:;;;;;;', // 25
  '.......33,>>,##,99,66,,,,ssstttt', // 26
  'ZZZ.WWW33,,,,,,,,,,,,,,88ssstttt', // 27 z 26..28
];
const CELL = 2;
const X0 = -32;
const Z0 = -28;
const GW = 32;
const GH = 28;
const PATHS = new Set(['.', ',', ';', '~', '=']);
const LINKS = new Set([':', 'o']);
const HOLES = new Set(['1', '2']);
const isPath = (c) => PATHS.has(c) || LINKS.has(c);
const isRoom = (c) => c !== null && c !== 'X' && !isPath(c) && !HOLES.has(c);
const at = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH ? null : PLAN[j][i]);
const cx = (i) => X0 + i * CELL;
const cz = (j) => Z0 + j * CELL;

if (PLAN.length !== GH || PLAN.some((r) => r.length !== GW))
  throw new Error(`PLAN must be ${GW} × ${GH}: ${PLAN.map((r) => r.length).join(' ')}`);

/** Each room set's or hole's cells as a rectangle {i0, j0, i1, j1} (inclusive). */
const rects = new Map();
for (let j = 0; j < GH; j++)
  for (let i = 0; i < GW; i++) {
    const c = at(i, j);
    if (!isRoom(c) && !HOLES.has(c)) continue;
    const r = rects.get(c) ?? { i0: i, j0: j, i1: i, j1: j };
    rects.set(c, {
      i0: Math.min(r.i0, i),
      j0: Math.min(r.j0, j),
      i1: Math.max(r.i1, i),
      j1: Math.max(r.j1, j),
    });
  }
for (const [c, r] of rects)
  for (let j = r.j0; j <= r.j1; j++)
    for (let i = r.i0; i <= r.i1; i++)
      if (at(i, j) !== c) throw new Error(`room ${c} isn't a rectangle (at ${i}, ${j})`);

// Which side each room set opens on: where it has lanes on two sides, the serpentines
// alternate (set here); otherwise the side with the most lane along it.
const OPEN_SET = {
  D: 'n',
  E: 's',
  F: 'n',
  G: 's',
  H: 'n',
  I: 's',
  J: 'n',
  K: 's',
  L: 'n',
  M: 'n',
  N: 's',
  P: 'n',
  Q: 's',
  R: 'n',
  S: 's',
  T: 'n',
  U: 's',
  V: 'e',
  Y: 'e',
  j: 'n',
  k: 's',
  l: 's',
  m: 'n',
  n: 'n',
  p: 's',
  q: 's',
  r: 'n',
};
const SIDES = {
  n: (r) => Array.from({ length: r.i1 - r.i0 + 1 }, (_, k) => [r.i0 + k, r.j0 - 1]),
  s: (r) => Array.from({ length: r.i1 - r.i0 + 1 }, (_, k) => [r.i0 + k, r.j1 + 1]),
  w: (r) => Array.from({ length: r.j1 - r.j0 + 1 }, (_, k) => [r.i0 - 1, r.j0 + k]),
  e: (r) => Array.from({ length: r.j1 - r.j0 + 1 }, (_, k) => [r.i1 + 1, r.j0 + k]),
};
const OPEN = {};
for (const [c, r] of rects) {
  if (HOLES.has(c)) continue;
  if (OPEN_SET[c]) {
    OPEN[c] = OPEN_SET[c];
    continue;
  }
  let best = null;
  for (const side of ['s', 'n', 'e', 'w']) {
    const n = SIDES[side](r).filter(([i, j]) => isPath(at(i, j))).length;
    if (n && (!best || n > best.n)) best = { side, n };
  }
  if (!best) throw new Error(`room ${c} has no lane beside it`);
  OPEN[c] = best.side;
}
for (const [c, side] of Object.entries(OPEN))
  if (!SIDES[side](rects.get(c)).some(([i, j]) => isPath(at(i, j))))
    throw new Error(`room ${c} opens ${side} onto no lane`);

/**
 * What stands on the edge between cell (i, j) and its neighbor (i + di, j + dj): nothing,
 * a partition or a rail. The building's and the depot's walls are left to roomWalls.
 */
function edgeKind(i, j, di, dj) {
  const a = at(i, j);
  const b = at(i + di, j + dj);
  if (a === null || b === null || a === 'X' || b === 'X' || a === b) return null;
  if (HOLES.has(a) || HOLES.has(b)) {
    // Both stairs climb north: a hole's north edge is where the stair arrives.
    if (HOLES.has(b) && dj === 1) return null;
    return isRoom(HOLES.has(a) ? b : a) ? 'wall' : 'rail';
  }
  if (isPath(a) && isPath(b)) return LINKS.has(a) || LINKS.has(b) ? null : 'wall';
  if (isPath(a) !== isPath(b)) {
    const room = isPath(a) ? b : a;
    const side = dj === 1 ? (room === a ? 's' : 'n') : room === a ? 'e' : 'w';
    return OPEN[room] === side ? null : 'wall';
  }
  return 'wall';
}

/** Edges of one kind merged into runs: {axis, c, a, b} (axis 'x' runs along x at z = c). */
function runs(kind) {
  const lines = new Map();
  const put = (axis, c, a) => {
    const k = `${axis}|${c}`;
    if (!lines.has(k)) lines.set(k, { axis, c, spans: [] });
    lines.get(k).spans.push(a);
  };
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      if (edgeKind(i, j, 0, 1) === kind) put('x', cz(j + 1), cx(i));
      if (edgeKind(i, j, 1, 0) === kind) put('z', cx(i + 1), cz(j));
    }
  const out = [];
  for (const { axis, c, spans } of lines.values()) {
    spans.sort((p, q) => p - q);
    let start = spans[0];
    let end = start + CELL;
    for (const s of spans.slice(1)) {
      if (Math.abs(s - end) < 1e-6) end += CELL;
      else {
        out.push({ axis, c, a: start, b: end });
        start = s;
        end = s + CELL;
      }
    }
    out.push({ axis, c, a: start, b: end });
  }
  return out;
}

/** A run's footprint [x0, z0, x1, z1], `th` thick, its ends carried half that on. */
const runRect = ({ axis, c, a, b }, th) =>
  axis === 'x'
    ? [a - th / 2, c - th / 2, b + th / 2, c + th / 2]
    : [c - th / 2, a - th / 2, c + th / 2, b + th / 2];

// ---------------------------------------------------------------------------------------
// Helpers

const out = [];
const add = (name, nodes) => out.push(group(name, nodes));
const P = (id, x, z, y, yaw, extra) =>
  prefab(id, x, z, { ...(yaw ? { yaw: r2(yaw) } : {}), ...extra }, y);
const op = (axis, c, at, w, y, h, more = {}) => ({ axis, c, at, w, y, h, ...more });
const glass = (axis, c, at, w, y, h) => op(axis, c, at, w, y, h, { glass: C.glass });
const door = (axis, c, at, y, w = 1.2, more = {}) =>
  op(axis, c, at, w, y, 2.2, { door: {}, ...more });

/** A steel rail (solid to movement, 1.05 m) along x or z on a floor at y. */
function rail(x0, z0, x1, z1, y, color = C.steel) {
  const alongX = Math.abs(z1 - z0) < 1e-6;
  const [a0, a1, b0, b1] = alongX ? [x0, x1, z0 - 0.04, z0 + 0.04] : [x0 - 0.04, x0 + 0.04, z0, z1];
  return [
    box(a0, b0, a1, b1, y + 0.98, y + 1.05, color),
    drawn(a0, b0, a1, b1, y + 0.45, y + 0.52, color),
    box(a0, b0, a1, b1, y, y + 0.98, color, { invisible: true }),
  ];
}

/** A square post from y0 to y1. */
const post = (x, z, y0, y1, w = 0.4, color = C.concrete) =>
  box(x - w / 2, z - w / 2, x + w / 2, z + w / 2, y0, y1, color);

/**
 * A room set's own frame: origin the middle of its back wall, local z into the room toward
 * its open side; W across the opening, D deep. Boxes take local extents (the turn is a
 * multiple of 90°, so they stay boxes).
 */
function roomFrame(x0, z0, x1, z1, open, y) {
  const [ox, oz, yaw, W, D] = {
    s: [(x0 + x1) / 2, z0, 0, x1 - x0, z1 - z0],
    n: [(x0 + x1) / 2, z1, 180, x1 - x0, z1 - z0],
    e: [x0, (z0 + z1) / 2, 90, z1 - z0, x1 - x0],
    w: [x1, (z0 + z1) / 2, -90, z1 - z0, x1 - x0],
  }[open];
  const c = Math.round(Math.cos((yaw * Math.PI) / 180));
  const s = Math.round(Math.sin((yaw * Math.PI) / 180));
  const toWorld = (u, v) => [ox + u * c + v * s, oz - u * s + v * c];
  const rect = (u0, v0, u1, v1) => {
    const [ax, az] = toWorld(u0, v0);
    const [bx, bz] = toWorld(u1, v1);
    return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
  };
  return {
    W,
    D,
    yaw,
    P: (id, u, v, ly = 0, extra) => {
      const [x, z] = toWorld(u, v);
      let wy = ((((ly + yaw) % 360) + 540) % 360) - 180;
      if (wy === -180) wy = 180;
      return P(id, x, z, y, wy, extra);
    },
    B: (u0, v0, u1, v1, b, t, color, extra) =>
      box(...rect(u0, v0, u1, v1), y + b, y + t, color, extra),
    Dr: (u0, v0, u1, v1, b, t, color, extra) =>
      drawn(...rect(u0, v0, u1, v1), y + b, y + t, color, extra),
  };
}

// ---------------------------------------------------------------------------------------
// Room sets: what each kind holds, in its frame (u across, v from the back wall). Nothing
// here carries loot: desks, TV benches, nightstands and kitchen runs are plain boxes.

const KITS = {
  living(f) {
    const { W, D } = f;
    return [
      f.P('floor-rug', 0, Math.min(1.9, D - 1.05)),
      f.P('couch', 0, 0.55, 180),
      f.B(-0.55, 1.35, 0.55, 1.9, 0, 0.42, C.wood),
      f.P('couch', W / 2 - 0.55, 1.9, 90),
      f.P('bookcase-tall', -W / 2 + 0.3, D - 1.65, 90),
      f.P('floor-lamp', W / 2 - 0.35, 0.35),
      ...(D > 5 ? [f.P('potted-plant', W / 2 - 0.65, D - 0.8)] : []),
    ];
  },
  bedroom(f) {
    const { W, D } = f;
    return [
      f.P('bed-double', 0, 1.2),
      ...[-1, 1].flatMap((k) => [
        f.B(k * 1.1 - 0.22, 0.12, k * 1.1 + 0.22, 0.55, 0, 0.55, C.wood),
        f.Dr(k * 1.1 - 0.08, 0.26, k * 1.1 + 0.08, 0.42, 0.55, 0.85, C.lamp),
      ]),
      f.P('wardrobe', -W / 2 + 0.35, D - 1.15, 90),
      f.P('floor-rug', 0.35, Math.min(D - 1.0, 3.1)),
      f.P('floor-lamp', W / 2 - 0.35, D - 0.5),
      ...(W > 5
        ? [
            f.P('wardrobe', W / 2 - 0.35, D - 1.15, -90),
            f.B(-2.6, 0.12, -1.6, 0.6, 0, 0.8, C.white),
          ]
        : []),
      ...(D > 5 ? [f.P('couch', 0, D - 1.6, 180)] : []),
    ];
  },
  kids(f) {
    const { W, D } = f;
    return [
      f.P('bunk-bed', -W / 2 + 0.6, 1.15),
      f.B(W / 2 - 0.6, 0.15, W / 2 - 0.15, 0.6, 0, 0.45, C.red),
      f.B(W / 2 - 1.15, 0.15, W / 2 - 0.7, 0.6, 0, 0.45, '#4f8a86'),
      f.B(W / 2 - 0.6, 0.7, W / 2 - 0.15, 1.15, 0, 0.45, C.yellow),
      f.B(0.2, 2.0, 1.0, 2.6, 0, 0.5, C.white),
      f.P('wooden-chair', 0.6, 1.65),
      f.P('wooden-chair', 0.6, 2.95, 180),
      f.Dr(-0.6, D - 1.6, 1.4, D - 0.4, 0, 0.012, '#7fb0d0'),
    ];
  },
  dining(f) {
    const { W, D } = f;
    return [
      f.P('dining-set', 0, D / 2 + 0.2),
      f.B(-0.9, 0.12, 0.9, 0.57, 0, 0.8, C.wood),
      f.Dr(-0.3, D / 2 - 0.1, 0.3, D / 2 + 0.5, 2.6, 2.75, C.lamp),
      f.P('floor-lamp', W / 2 - 0.35, 0.35),
      ...(W > 5 ? [f.P('bookcase-tall', -W / 2 + 0.3, D / 2 + 0.2, 90)] : []),
    ];
  },
  kitchen(f) {
    const { W, D } = f;
    const run0 = -W / 2 + 2.65;
    const run1 = W / 2 - 0.95;
    return [
      f.P('sink-counter', -W / 2 + 1.4, 0.4),
      ...(run1 - run0 > 0.3
        ? [
            f.B(run0, 0.12, run1, 0.72, 0, 0.88, C.white),
            f.Dr(run0, 0.12, run1, 0.74, 0.88, 0.92, C.woodDark),
            f.Dr(run0, 0.12, run1, 0.47, 1.5, 2.2, C.white),
          ]
        : []),
      f.B(W / 2 - 0.9, 0.12, W / 2 - 0.15, 0.82, 0, 1.95, '#d9dcdf'),
      f.B(-0.9, 1.9, 0.9, 2.8, 0, 0.88, C.white),
      f.Dr(-0.95, 1.85, 0.95, 2.85, 0.88, 0.92, C.woodDark),
      ...(D >= 3.8 ? [f.P('bar-stool', -0.5, 3.2), f.P('bar-stool', 0.5, 3.2)] : []),
    ];
  },
  office(f) {
    const { W, D } = f;
    return [
      f.B(-0.75, 0.15, 0.75, 0.85, 0.71, 0.75, C.white),
      f.B(-0.75, 0.17, -0.69, 0.83, 0, 0.71, C.steel),
      f.B(0.69, 0.17, 0.75, 0.83, 0, 0.71, C.steel),
      f.Dr(-0.3, 0.3, 0.3, 0.36, 0.75, 1.15, C.black),
      f.P('office-chair', 0, 1.25, 180),
      f.P('bookcase-tall', W / 2 - 0.3, D / 2 + 0.3, -90),
      f.P('floor-lamp', -W / 2 + 0.35, 0.35),
      f.P('potted-plant', -W / 2 + 0.65, D - 0.75),
    ];
  },
  bath(f) {
    const { W } = f;
    return [
      f.Dr(-W / 2 + 0.07, 0.07, W / 2 - 0.07, f.D - 0.07, 0, 0.012, C.tile),
      f.P('bathtub', -W / 2 + 0.5, 1.0),
      f.P('toilet', W / 2 - 0.6, 0.5),
      f.B(-0.4, 0.12, 0.5, 0.6, 0, 0.85, C.white),
      f.Dr(-0.35, 0.07, 0.45, 0.1, 1.2, 2.0, C.glass),
    ];
  },
  storage(f) {
    const { W, D } = f;
    return [
      f.P('wardrobe', -0.95, 0.42),
      f.P('wardrobe', 0.95, 0.42),
      f.P('bookcase-tall', -W / 2 + 0.3, D - 1.65, 90),
      f.B(W / 2 - 0.7, D - 1.6, W / 2 - 0.15, D - 1.05, 0, 0.4, C.wood),
      f.B(W / 2 - 0.7, D - 0.95, W / 2 - 0.15, D - 0.4, 0, 0.4, C.white),
    ];
  },
  hall(f) {
    const { W, D } = f;
    return [
      f.P('shoe-bench', 0, 0.38),
      f.P('mirror-stand', -W / 2 + 0.3, 1.6, 90),
      ...[-0.6, 0, 0.6].map((u) => f.Dr(u - 0.04, 0.07, u + 0.04, 0.16, 1.6, 1.7, C.steel)),
      f.P('floor-rug', 0, Math.min(2.3, D - 1.05)),
      f.P('floor-lamp', W / 2 - 0.35, D - 0.5),
    ];
  },
  // A shallow display along a wall: a bookcase and a wardrobe.
  shelf(f) {
    const { W } = f;
    return W > 5
      ? [f.P('bookcase-tall', -1.3, 0.35), f.P('wardrobe', 1.6, 0.4)]
      : [f.P('bookcase-tall', 0, 0.35)];
  },
};

// The rooms' kinds: west wing living rooms and storage, the north band workrooms, the east
// wing bedrooms and children's rooms, the south block kitchens, dining and bathrooms.
const KIND = {
  A: 'storage',
  B: 'living',
  C: 'dining',
  D: 'living',
  E: 'hall',
  F: 'living',
  G: 'storage',
  H: 'living',
  I: 'office',
  J: 'dining',
  K: 'living',
  L: 'storage',
  M: 'living',
  N: 'dining',
  P: 'hall',
  Q: 'living',
  R: 'office',
  S: 'storage',
  T: 'living',
  U: 'kids',
  V: 'hall',
  Y: 'living',
  Z: 'shelf',
  W: 'shelf',
  a: 'office',
  b: 'storage',
  c: 'office',
  d: 'hall',
  e: 'living',
  f: 'office',
  g: 'storage',
  h: 'dining',
  i: 'office',
  j: 'bedroom',
  k: 'kids',
  l: 'bedroom',
  m: 'bedroom',
  n: 'kids',
  p: 'bedroom',
  q: 'bedroom',
  r: 'kids',
  s: 'bedroom',
  t: 'bedroom',
  u: 'bath',
  v: 'kitchen',
  w: 'dining',
  x: 'kitchen',
  y: 'bath',
  z: 'shelf',
  '!': 'kitchen',
  '@': 'bath',
  $: 'dining',
  '%': 'bath',
  '&': 'office',
  '*': 'dining',
  '^': 'kitchen',
  '+': 'dining',
  '?': 'bath',
  '>': 'kitchen',
  '#': 'storage',
  9: 'bath',
  6: 'dining',
  '<': 'kitchen',
  3: 'hall',
  8: 'hall',
};
for (const c of rects.keys())
  if (!HOLES.has(c) && !KIND[c]) throw new Error(`room ${c} has no kind`);

// ---------------------------------------------------------------------------------------
// The plan as a picture (--plan): lanes, room sets by kind, partitions, rails, windows.

function writePng(file, w, h, px) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function drawPlan(file, windows) {
  const S = 12; // pixels per meter
  const w = 64 * S;
  const h = 56 * S;
  const px = Buffer.alloc(w * h * 3, 40);
  const hex = (s) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16));
  const fill = (x0, z0, x1, z1, color) => {
    const [r, g, b] = hex(color);
    for (
      let y = Math.max(0, Math.round((z0 + 28) * S));
      y < Math.min(h, Math.round((z1 + 28) * S));
      y++
    )
      for (
        let x = Math.max(0, Math.round((x0 + 32) * S));
        x < Math.min(w, Math.round((x1 + 32) * S));
        x++
      )
        px.set([r, g, b], (y * w + x) * 3);
  };
  const KC = {
    living: '#e0b089',
    bedroom: '#b9a3d6',
    kids: '#f0d27a',
    dining: '#d79a7a',
    kitchen: '#9fc7a0',
    office: '#9bb4d0',
    bath: '#a9dcdc',
    storage: '#c9b9a0',
    hall: '#d6d0c4',
    shelf: '#bdbdbd',
  };
  const PC = {
    '.': '#f4f1ea',
    ',': '#ece6d8',
    ';': '#e8edf2',
    '~': '#f2e3c4',
    '=': '#d9d4cc',
    ':': '#8fd18f',
    o: '#8a6a4a',
    X: '#5a5a5a',
    1: '#e8c840',
    2: '#e8c840',
  };
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      const c = at(i, j);
      fill(cx(i), cz(j), cx(i) + CELL, cz(j) + CELL, isRoom(c) ? KC[KIND[c]] : PC[c]);
    }
  for (const r of runs('wall')) fill(...runRect(r, 0.25), '#202020');
  for (const r of runs('rail')) fill(...runRect(r, 0.25), '#e07020');
  for (const [x0, z0, x1, z1] of windows) fill(x0, z0, x1, z1, '#3f8fe0');
  writePng(file, w, h, px);
}

// ---------------------------------------------------------------------------------------
// The shell: ground rooms, the upper floor round the depot's void, roof.

const FOOT = [-32, -28, 32, 28];
const VOID = [-18, -20, 18, 0];
const HOLE1 = (() => {
  const r = rects.get('1');
  return [cx(r.i0), cz(r.j0), cx(r.i1 + 1), cz(r.j1 + 1)];
})();
const HOLE2 = (() => {
  const r = rects.get('2');
  return [cx(r.i0), cz(r.j0), cx(r.i1 + 1), cz(r.j1 + 1)];
})();

const GROUND = {
  entrance: { r: [-32, 8, -18, 28], yb: G, yt: U },
  office: { r: [-32, -28, -18, -18], yb: G, yt: U },
  corridor: { r: [-22, -18, -18, 8], yb: G, yt: U },
  staff: { r: [-32, -18, -22, -6], yb: G, yt: U },
  restrooms: { r: [-32, -6, -22, 8], yb: G, yt: U },
  depot: { r: [-18, -28, 18, 0], yb: G, yt: U },
  market: { r: [-18, 0, 18, 28], yb: G, yt: U },
  bulky: { r: [18, -28, 32, 6], yb: G, yt: U },
  checkouts: { r: [18, 6, 32, 28], yb: G, yt: U },
};

const GROUND_OPENINGS = [
  // South front: the entrance (glass beside it), the exit.
  op('x', 28, -29, 4, G, 3.2),
  glass('x', 28, -23.5, 6, G + 0.3, 2.8),
  op('x', 28, 27, 4, G, 3.2),
  glass('x', 28, 21.5, 5, G + 0.3, 2.8),
  // North: two open dock doors (the third is a shutter drawn on the wall).
  op('x', -28, -11, 4, G, 4.4),
  op('x', -28, 1, 4, G, 4.4),
  // West: the staff door. East: bulky goods pickup.
  door('z', -32, -12, G),
  op('z', 32, -12, 4, G, 4.2),
  // Entrance hall → market hall (the shortcut), → the staff corridor.
  op('z', -18, 12, 3, G, 2.8),
  door('x', 8, -20, G, 1.2),
  // Back of house.
  op('z', -18, -10, 2.4, G, 2.8),
  door('z', -18, -23, G, 1.2),
  door('x', -18, -20, G, 1.2),
  door('z', -22, -12, G),
  door('z', -22, 2, G),
  // Market hall → the depot.
  op('x', 0, -12, 4, G, 3.4),
  op('x', 0, 2, 4, G, 3.4),
  op('x', 0, 13, 4, G, 3.4),
  // The depot → bulky goods (the floor and the receiving strip); bulky → checkouts.
  op('z', 18, -8, 6, G, 4),
  op('z', 18, -24, 4, G, 4),
  op('x', 6, 25, 6, G, 3),
];

// The depot's windows from the showroom: on every other lane cell along the void, and every
// restaurant cell; none in a room set's back wall.
function voidWindows() {
  const list = [];
  const pick = (cells, axis, c, alongOf) => {
    let k = 0;
    for (const [i, j] of cells) {
      const ch = at(i, j);
      if (!isPath(ch)) {
        k = 0;
        continue;
      }
      if (ch === '~' || k % 2 === 0) list.push({ axis, c, at: alongOf(i, j) });
      k++;
    }
  };
  const north = Array.from({ length: 18 }, (_, k) => [7 + k, 3]);
  const south = Array.from({ length: 18 }, (_, k) => [7 + k, 14]);
  const west = Array.from({ length: 10 }, (_, k) => [6, 4 + k]);
  const east = Array.from({ length: 10 }, (_, k) => [25, 4 + k]);
  pick(north, 'x', VOID[1], (i) => cx(i) + 1);
  pick(south, 'x', VOID[3], (i) => cx(i) + 1);
  pick(west, 'z', VOID[0], (_, j) => cz(j) + 1);
  pick(east, 'z', VOID[2], (_, j) => cz(j) + 1);
  return list;
}
const WINDOWS = voidWindows();

const UPPER_OPENINGS = [
  // The fire doors onto the outside stairs.
  door('z', -32, -5, U),
  door('z', 32, 15, U),
  // The restaurant's outside windows.
  glass('z', 32, -17, 2.4, U + 0.9, 1.8),
  glass('z', 32, -12.5, 2.4, U + 0.9, 1.8),
  glass('x', -28, 20, 2.4, U + 0.9, 1.8),
  glass('x', -28, 23.5, 2.4, U + 0.9, 1.8),
  // Into the depot.
  ...WINDOWS.map((w) => glass(w.axis, w.c, w.at, 1.6, U + 0.9, 1.7)),
];

if (PLAN_OUT) {
  drawPlan(
    PLAN_OUT,
    WINDOWS.map((w) =>
      w.axis === 'x'
        ? [w.at - 0.8, w.c - 0.3, w.at + 0.8, w.c + 0.3]
        : [w.c - 0.3, w.at - 0.8, w.c + 0.3, w.at + 0.8],
    ),
  );
  console.log(`plan → ${PLAN_OUT}`);
}

add('shell', [
  // The slab under the ground floor, the floors.
  box(FOOT[0] - T, FOOT[1] - T, FOOT[2] + T, FOOT[3] + T, 0, G, C.concrete),
  drawn(-18 + T, -28 + T, 18 - T, -T, G, G + 0.01, C.depotFloor),
  // The upper floor, less the void and the two stair holes.
  ...union([FOOT], [VOID, HOLE1, HOLE2], U - 0.2, U, C.floorU),
  // A beam and columns under the north band's edge, over the depot's receiving strip.
  box(-18 + T, -20.4, 18 - T, -20, U - 0.8, U - 0.2, C.concrete),
  ...[-12, -6, 0, 6, 12].map((x) => post(x, -20.2, G, U - 0.8, 0.5)),
  // The roof, its parapet.
  ...union([[FOOT[0] - T, FOOT[1] - T, FOOT[2] + T, FOOT[3] + T]], [], TOP, TOP + 0.25, C.roof),
  box(FOOT[0] - T, FOOT[1] - T, FOOT[2] + T, FOOT[1] + T, TOP + 0.25, TOP + 1, C.parapet),
  box(FOOT[0] - T, FOOT[3] - T, FOOT[2] + T, FOOT[3] + T, TOP + 0.25, TOP + 1, C.parapet),
  box(FOOT[0] - T, FOOT[1] + T, FOOT[0] + T, FOOT[3] - T, TOP + 0.25, TOP + 1, C.parapet),
  box(FOOT[2] - T, FOOT[1] + T, FOOT[2] + T, FOOT[3] - T, TOP + 0.25, TOP + 1, C.parapet),
  // The yellow band round the top, the signs (south front and west end), the canopy over
  // the entrance (drawn: no perch).
  ...[
    [FOOT[0] - T - 0.03, FOOT[1] - T - 0.03, FOOT[2] + T + 0.03, FOOT[1] - T],
    [FOOT[0] - T - 0.03, FOOT[3] + T, FOOT[2] + T + 0.03, FOOT[3] + T + 0.03],
    [FOOT[0] - T - 0.03, FOOT[1] - T, FOOT[0] - T, FOOT[3] + T],
    [FOOT[2] + T, FOOT[1] - T, FOOT[2] + T + 0.03, FOOT[3] + T],
  ].map((r) => drawn(...r, TOP - 1.1, TOP - 0.2, C.accent)),
  drawn(-13, 28.13, 13, 28.25, 6.0, 9.2, C.accent),
  ...Array.from({ length: 8 }, (_, k) =>
    drawn(-11 + k * 2.9, 28.25, -9.2 + k * 2.9, 28.3, 6.6, 8.6, C.white),
  ),
  drawn(-32.25, -10, -32.13, 10, 6.0, 9.2, C.accent),
  ...Array.from({ length: 6 }, (_, k) =>
    drawn(-32.3, -8.3 + k * 2.9, -32.25, -6.5 + k * 2.9, 6.6, 8.6, C.white),
  ),
  drawn(-32.2, 28.15, -24.8, 31.5, 4.0, 4.3, C.accent),
  ...[-31.8, -25.2].map((x) => drawn(x - 0.1, 31.2, x + 0.1, 31.4, 0, 4.0, C.steel)),
  // Light strips under the ceilings.
  ...[-14, -7, 0, 7, 14].map((x) =>
    drawn(x - 0.15, -19, x + 0.15, -1, TOP - 0.45, TOP - 0.35, C.lamp),
  ),
  ...[4, 12, 20].map((z) => drawn(-16, z - 0.15, 16, z + 0.15, U - 0.35, U - 0.25, C.lamp)),
  ...[-24, -12, 0, 12, 24]
    .map((x) => drawn(x - 0.15, -27, x + 0.15, 27, TOP - 0.45, TOP - 0.35, C.lamp, {}))
    .filter((n) => n.pos[0] < -18 || n.pos[0] > 18),
  // The north wall's third dock door: shut, a shutter drawn on it.
  drawn(9, -28.16, 13, -28.1, G, G + 4.4, '#7d8288'),
]);

add(
  'ground walls',
  roomWalls({
    rooms: Object.values(GROUND),
    openings: GROUND_OPENINGS,
    inside: C.inside,
    outside: C.facade,
  }),
);
const upperWalls = roomWalls({
  rooms: [
    { r: FOOT, yb: U, yt: TOP },
    { r: VOID, yb: U, yt: TOP },
  ],
  openings: UPPER_OPENINGS,
  inside: C.inside,
  outside: C.facade,
});
add('upper walls', upperWalls);

// ---------------------------------------------------------------------------------------
// The showroom: partitions and rails from the plan, room set floors, back walls and kits.

const partitions = runs('wall').flatMap((r) => {
  const [x0, z0, x1, z1] = runRect(r, PT);
  return [
    box(x0, z0, x1, z1, U, U + PH, C.partition),
    box(x0, z0, x1, z1, U + PH, TOP, C.partition, { invisible: true }),
  ];
});
const rails = runs('rail').flatMap((r) =>
  r.axis === 'x' ? rail(r.a, r.c, r.b, r.c, U) : rail(r.c, r.a, r.c, r.b, U),
);
add('showroom partitions', [...partitions, ...rails]);

const sets = [];
let n = 0;
for (const [c, r] of rects) {
  if (HOLES.has(c)) continue;
  const x0 = cx(r.i0);
  const z0 = cz(r.j0);
  const x1 = cx(r.i1 + 1);
  const z1 = cz(r.j1 + 1);
  const f = roomFrame(x0, z0, x1, z1, OPEN[c], U);
  const accent = ACCENTS[n % ACCENTS.length];
  const floor = FLOORS[(n * 5) % FLOORS.length];
  n++;
  sets.push(
    group(`set ${c} ${KIND[c]}`, [
      f.Dr(-f.W / 2 + PT / 2, PT / 2, f.W / 2 - PT / 2, f.D, 0, 0.01, floor),
      // The back wall's paint, off the partition (a building or depot wall at its back too).
      f.Dr(-f.W / 2 + 0.12, 0.07, f.W / 2 - 0.12, 0.1, 0.01, PH - 0.2, accent),
      ...KITS[KIND[c]](f),
    ]),
  );
}
add('showroom sets', sets);

// Display islands on the lanes; a price stand by each.
const islands = [];
for (let j = 0; j < GH; j++)
  for (let i = 0; i < GW; i++)
    if (at(i, j) === 'o')
      islands.push(P('promo-tower', cx(i) + 1, cz(j) + 1, U, (i + j) % 2 ? 45 : 0));
add('showroom islands', islands);

// The two stairs from the ground: both climb north and arrive at their hole's north edge.
const stair1 = stairRun({
  id: 'furniture-entrance-stair',
  x: (HOLE1[0] + HOLE1[2]) / 2,
  z: HOLE1[1] + 9.82,
  y: G,
  yaw: 180,
  rise: U - G,
  width: 3.0,
  sides: 1,
  base: 0,
  color: C.concrete,
});
const stair2 = stairRun({
  id: 'furniture-market-stair',
  x: (HOLE2[0] + HOLE2[2]) / 2,
  z: HOLE2[1] + 9.82,
  y: G,
  yaw: 180,
  rise: U - G,
  width: 3.0,
  sides: 1,
  base: 0,
  color: C.concrete,
});
add('stairs', [stair1.node, stair2.node]);

// ---------------------------------------------------------------------------------------
// The restaurant (upper, north-east): the serving line along the kitchen's wall, tables by
// the depot's windows and the outside ones; the kitchen behind.

add('restaurant', [
  drawn(18 + T, -28 + T, 32 - T, -10 + 0.06, U, U + 0.01, '#d9c9a8'),
  P('espresso-bar', 28.0, -19.4, U),
  box(30.1, -19.85, 31.8, -18.95, U, U + 0.95, C.white),
  drawn(26.3, -19.0, 31.8, -18.9, U + 0.95, U + 1.0, C.steel),
  ...[
    [20.2, -26.0],
    [20.2, -22.6],
    [23.0, -26.2],
    [20.6, -17.4],
    [20.6, -13.4],
    [23.9, -17.0],
    [27.4, -16.4],
    [30.6, -16.0],
    [28.2, -12.8],
    [31.0, -12.6],
  ].map(([x, z], k) => P('food-court-table', x, z, U, k % 2 ? 0 : 90)),
  P('potted-plant', 24.9, -27.2, U),
  P('potted-plant', 19.0, -10.9, U),
  // The kitchen: the sink run on the north wall, the oven, a prep island, fridges.
  P('sink-counter', 28.3, -27.5, U),
  P('pizza-oven', 31.1, -24.4, U, -90),
  box(27.2, -24.6, 29.4, -23.4, U, U + 0.92, '#c9ccd0'),
  box(26.3, -21.0, 27.1, -20.2, U, U + 1.95, '#d9dcdf'),
  box(27.3, -21.0, 28.1, -20.2, U, U + 1.95, '#d9dcdf'),
]);

// ---------------------------------------------------------------------------------------
// The depot (the self-serve warehouse; ground, x −18..18, z −28..0, double height south of
// the receiving strip). Rack blocks west and east, set differently (west rows run north–
// south, east rows east–west), each row missing a bay at its own place so the cross aisles
// zigzag; the open floor between them holds the military's cache, in sight of the windows
// on all four sides.

const RACKS = [
  'warehouse-rack-stocked-1',
  'warehouse-rack-stocked-2',
  'warehouse-rack-stocked-3',
  'warehouse-rack-stocked-5',
  'warehouse-rack-stocked-6',
  'warehouse-rack-stocked-7',
];
const rack = (k) => RACKS[k % RACKS.length];
const WBAYS = [-18.0, -15.2, -12.4, -9.6, -6.8, -4.0]; // along z
const EBAYS = [7.8, 10.6, 13.4, 16.2]; // along x
const westRow = (x, yaw, skip, k0) =>
  WBAYS.filter((_, k) => k !== skip).map((z, k) => P(rack(k0 + k), x, z, G, yaw));
const eastRow = (z, yaw, skip, k0) =>
  EBAYS.filter((_, k) => !skip.includes(k)).map((x, k) => P(rack(k0 + k), x, z, G, yaw));

add('depot racks', [
  ...westRow(-17.3, 90, 3, 0), // against the wall; the gap at the corridor's door
  ...westRow(-13.2, -90, 1, 1),
  ...westRow(-12.1, 90, 1, 2),
  ...westRow(-8.0, -90, 4, 3),
  ...westRow(-6.9, 90, 4, 4),
  ...eastRow(-18.85, 0, [0], 0),
  ...eastRow(-14.75, 180, [1], 1),
  ...eastRow(-13.65, 0, [1], 2),
  ...eastRow(-9.55, 180, [3], 3), // the gap at bulky goods' opening
  ...eastRow(-8.45, 0, [3], 4),
  ...eastRow(-4.35, 180, [2], 5),
  // Flat-pack stacked at the aisles' mouths.
  P('flat-pack-stack', -15.2, -1.3, G),
  P('flat-pack-stack', -10.0, -1.4, G, 90),
  P('flat-pack-stack', 9.0, -1.6, G),
  P('flat-pack-stack', 15.8, -1.4, G, 90),
]);

// The cache: a sandbag horseshoe round an ops table, open to the south-east; crates inside
// (the only loot in the store), more stock and the military's kit outside it. All waist
// cover but two barrier blocks, so the windows above see in.
add('depot cache', [
  P('sandbag-wall', -2.3, -14.6, G),
  P('sandbag-wall', 2.3, -14.6, G),
  P('sandbag-wall', -4.6, -10.0, G, 90),
  P('sandbag-wall', -2.3, -5.4, G),
  P('barrier-block', 4.8, -12.6, G),
  P('barrier-block', -5.2, -4.2, G),
  P('ops-table', 1.0, -10.0, G),
  P('weapon-crate', -3.2, -10.2, G),
  P('weapon-crate', -1.8, -10.2, G),
  P('weapon-crate', 3.3, -10.2, G),
  P('ammo-crate', -2.5, -13.2, G),
  P('ammo-crate', -1.1, -13.2, G),
  P('ammo-crate', 1.0, -7.0, G),
  P('ammo-crate', 1.0, -8.0, G),
  P('medical-crate-pallet', 3.0, -7.2, G),
  P('medical-crate-pallet', -3.0, -7.2, G),
  P('small-crate-marked', 2.2, -13.3, G),
  P('small-crate', 3.0, -13.3, G, 20),
  // Outside the ring: the military's stock and kit.
  P('stock-wrapped', -4.8, -17.6, G),
  P('stock-wrapped', -3.4, -17.6, G),
  P('stock-crate', 1.5, -17.8, G),
  P('stock-wrapped', 4.6, -16.9, G, 90),
  P('tent-shelter', 4.2, -2.4, G, 180),
  P('folding-table', -1.2, -2.2, G),
  P('flood-light', -5.6, -15.8, G, 45),
  P('flood-light', 5.6, -6.0, G, -135),
  P('forklift', -0.5, -23.6, G, 90),
]);

// The receiving strip, under the north band, behind the dock doors.
add('receiving', [
  P('wood-pallet-boxes', -16.2, -26.8, G),
  P('wood-pallet-boxes', -14.8, -26.8, G),
  P('cardboard-bale', -16.2, -24.9, G),
  ...[0, 1, 2].map((k) => P('roll-cage', -7.0 + k * 1.0, -27.3, G)),
  P('stock-wrapped', 5.4, -26.9, G),
  P('stock-crate', 6.8, -26.9, G),
  P('stock-cartons', 8.2, -26.9, G),
  P('wood-pallet-large', 14.8, -25.5, G),
  P('flat-pack-stack', 14.8, -25.5, G + 0.15),
  P('cardboard-bale', 16.6, -22.0, G, 90),
  // Loads stacked two high, staggered, so no line runs the strip's 36 m.
  P('stock-wrapped', -9.0, -22.6, G),
  P('stock-wrapped', -9.0, -22.6, G + 1.26),
  P('stock-wrapped', 9.5, -24.5, G, 90),
  P('stock-wrapped', 9.5, -24.5, G + 1.26, 90),
]);

// ---------------------------------------------------------------------------------------
// The market hall (ground, south): tall gondolas in staggered bands and display towers in
// the lanes between them, so no line runs its 36 m; the showroom's stair lands at its west.

const gondola = (x, z, yaw = 0) => P('retail-gondola-tall', x, z, G, yaw);
add('market hall', [
  gondola(-6, 4.5),
  gondola(5, 4.5),
  gondola(14, 4.5),
  gondola(-3, 9.5),
  gondola(9, 9.5),
  gondola(-6, 14.5),
  gondola(3, 14.5),
  gondola(13, 14.5),
  gondola(0, 19.5),
  gondola(9, 19.5),
  gondola(-6, 24.5),
  gondola(5, 24.5),
  gondola(14, 24.5),
  P('promo-tower', 12.5, 7.1, G),
  P('promo-tower', -8.5, 12.0, G),
  P('promo-tower', 6.5, 12.0, G, 45),
  P('promo-tower', -3.0, 17.0, G),
  P('promo-tower', 14.5, 17.0, G, 45),
  P('promo-tower', 2.5, 22.0, G),
  ...[
    [-12, 3],
    [-14.6, 6.5],
    [0.5, 7],
    [16.3, 11.5],
    [-6.5, 21.5],
    [16, 21.5],
    [-15.5, 25.5],
    [9.5, 26.5],
  ].map(([x, z]) => P('market-bin', x, z, G)),
  P('carton-display', -16.4, 9.5, G, 90),
  P('carton-display', -16.4, 15.5, G, 90),
  P('potted-plant', -1.0, 26.8, G),
  P('potted-plant', 16.9, 1.3, G),
  ...[0, 1, 2, 3].map((k) => P('shopping-trolley', -9.5, 26.6 - k * 0.35, G, 180)),
]);

// ---------------------------------------------------------------------------------------
// The entrance hall (ground, south-west): the stair up, the information desk, the play
// area, the trolleys and a shortcut east into the market hall.

add('entrance hall', [
  drawn(-32 + T, 8 + T, -18 - T, 28 - T, G, G + 0.01, '#bdb8ad'),
  P('reception-desk', -29.6, 13.5, G, 90),
  // The play area: a low fenced pit of colored blocks.
  box(-31.7, 19.0, -28.0, 19.15, G, G + 0.9, C.accent),
  box(-28.15, 19.0, -28.0, 23.5, G, G + 0.9, C.accent),
  box(-31.7, 23.35, -28.0, 23.5, G, G + 0.9, C.accent),
  drawn(-31.7, 19.15, -28.15, 23.35, G, G + 0.35, '#4f8a86'),
  ...[0, 1, 2, 3, 4, 5].map((k) => P('shopping-trolley', -20.0, 18.0 + k * 0.4, G)),
  P('promo-tower', -19.6, 25.4, G),
  P('potted-plant', -31.3, 27.1, G),
  P('potted-plant', -26.9, 27.1, G),
  P('wall-poster', -18.12, 22, G + 1.2, -90),
]);

// ---------------------------------------------------------------------------------------
// The checkouts and exit cafe (ground, south-east): five lanes walked south toward the
// exit; bulky goods' opening feeds the queue from the north.

add('checkouts', [
  ...[20.0, 23.4, 26.8, 30.2].map((x) => P('checkout-lane', x, 13.5, G)),
  // The exit cafe along the east wall, its tables, the trolley return.
  P('espresso-bar', 30.9, 23.0, G, -90),
  P('cafe-table', 27.5, 21.0, G),
  P('cafe-table', 24.6, 22.5, G, 90),
  P('cafe-table', 27.0, 24.5, G),
  P('potted-plant', 19.0, 27.0, G),
  ...[0, 1, 2, 3].map((k) => P('shopping-trolley', 19.1, 20.0 + k * 0.4, G)),
]);

// ---------------------------------------------------------------------------------------
// Bulky goods (ground, east): racks of flat-pack, the pickup counter by the east door.

const bulkyRow = (x, yaw, zs) => zs.map((z, k) => P(rack(k + (yaw > 0 ? 2 : 4)), x, z, G, yaw));
add('bulky goods', [
  ...bulkyRow(22.4, -90, [-25.2, -22.4, -19.6, -16.8]),
  ...bulkyRow(23.5, 90, [-25.2, -22.4, -19.6, -16.8]),
  ...bulkyRow(28.0, -90, [-25.2, -22.4, -19.6]),
  ...bulkyRow(29.1, 90, [-25.2, -22.4, -19.6]),
  P('reception-desk', 28.0, -6.0, G),
  P('flat-pack-stack', 21.0, -4.0, G),
  P('flat-pack-stack', 21.0, -2.4, G),
  P('flat-pack-stack', 24.5, 1.5, G, 90),
  P('forklift', 26.0, -12.5, G, 90),
  P('stock-wrapped', 30.8, 3.6, G),
  P('stock-crate', 30.8, 1.9, G),
]);

// ---------------------------------------------------------------------------------------
// Back of house (ground, west): the office, staff room, restrooms off a corridor.

add('back of house', [
  // Office: desks (plain), chairs, shelves.
  ...[-29.5, -25.0].flatMap((x) => [
    box(x - 0.8, -26.4, x + 0.8, -25.7, G + 0.71, G + 0.75, C.white),
    box(x - 0.8, -26.35, x - 0.74, -25.75, G, G + 0.71, C.steel),
    box(x + 0.74, -26.35, x + 0.8, -25.75, G, G + 0.71, C.steel),
    P('office-chair', x, -25.0, G, 180),
  ]),
  P('bookcase-tall', -27.2, -18.6, G, 180),
  P('water-cooler', -31.4, -19.0, G),
  // Staff room: a table, couch, lockers, vending.
  P('table-and-chairs', -27.5, -12.0, G, 90),
  P('couch', -27.0, -17.4, G),
  P('locker-bank', -30.0, -6.6, G, 180),
  P('vending-machine', -23.0, -16.9, G),
  // Restrooms: toilets in stalls, basins.
  ...[-31.0, -29.4, -27.8].flatMap((x) => [
    P('toilet', x + 0.4, -5.4, G),
    box(x + 1.15, -5.9, x + 1.2, -3.9, G, G + 2.0, '#9aa3a8'),
  ]),
  box(-31.85, 2.0, -31.25, 6.0, G, G + 0.85, C.white),
  drawn(-31.89, 2.2, -31.86, 5.8, G + 1.2, G + 2.0, C.glass),
  // Corridor: cages and a cart, staggered.
  P('roll-cage', -21.2, -14.0, G),
  P('janitor-cart', -18.9, -3.0, G, 90),
  P('roll-cage', -21.2, 4.5, G),
]);

// ---------------------------------------------------------------------------------------
// The fire stairs: outside the west and east walls, one open steel flight each (32°, open
// underneath) from the ground up to a landing at the showroom's fire door, a handrail down
// the open side. The rail collides in short invisible pieces that follow the slope.

const FLIGHT = U * 1.6; // the flight's run
const FW = 1.4; // its width
const FIRE = [
  // x0..x1 the flight (its inner edge off the wall's face), the landing z0..z1 at the door.
  { name: 'west', x0: -33.6, x1: -32.2, outer: -33.6, side: -1, z0: -6, z1: -4 },
  { name: 'east', x0: 32.2, x1: 33.6, outer: 33.6, side: 1, z0: 14, z1: 16 },
];

/** The fire stair's open side: handrail, mid-rail and posts drawn; invisible pieces collide. */
function fireRail(x, zFoot, zTop) {
  const h = (z) => (U * (zFoot - z)) / FLIGHT; // the steps' line over the ground at z
  const nodes = [
    along([x, 1.0, zFoot], [x, U + 1.0, zTop], 0.06, 0.06, C.steel),
    along([x, 0.5, zFoot], [x, U + 0.5, zTop], 0.04, 0.04, C.steel),
  ];
  for (let z = zFoot - 0.05; z > zTop; z -= 1.44)
    nodes.push(drawn(x - 0.03, z - 0.03, x + 0.03, z + 0.03, h(z), h(z) + 1.0, C.steel));
  const o = Math.sign(x) * 0.04; // just outside the flight's edge
  for (let z = zFoot; z > zTop + 1e-6; z -= 0.5) {
    const z1 = Math.max(z - 0.5, zTop);
    nodes.push(
      box(
        Math.min(x, x + 2 * o),
        z1,
        Math.max(x, x + 2 * o),
        z,
        Math.max(0, h(z) - 0.3),
        h(z1) + 1.05,
        C.steel,
        { invisible: true },
      ),
    );
  }
  return nodes;
}

add('fire stairs', [
  ...FIRE.flatMap((f) => {
    const zFoot = f.z1 + FLIGHT;
    const lx0 = f.side < 0 ? f.outer : 32.1;
    const lx1 = f.side < 0 ? -32.1 : f.outer;
    return [
      {
        type: 'stairs',
        id: `furniture-fire-stair-${f.name}`,
        pos: [r2((f.x0 + f.x1) / 2), 0, r2((f.z1 + zFoot) / 2)],
        yaw: 180,
        size: [FW, U, r2(FLIGHT)],
        steps: 30,
        thickness: 0.2,
        color: C.steel,
      },
      // The landing at the door, on two posts.
      box(lx0, f.z0, lx1, f.z1, U - 0.15, U, C.steel),
      ...[f.z0 + 0.1, f.z1 - 0.1].map((z) =>
        drawn(
          f.outer - 0.05 * f.side - 0.05,
          z - 0.05,
          f.outer - 0.05 * f.side + 0.05,
          z + 0.05,
          0,
          U - 0.15,
          C.steel,
        ),
      ),
      // Rails round the landing's open sides, the flight's down the slope.
      ...rail(f.outer + f.side * 0.04, f.z0, f.outer + f.side * 0.04, f.z1, U),
      ...rail(lx0, f.z0 - 0.04, lx1, f.z0 - 0.04, U),
      ...fireRail(f.outer + f.side * 0.04, zFoot, f.z1),
    ];
  }),
]);

// ---------------------------------------------------------------------------------------
// Outside: the car park south of the front, the dock yard north.

add('car park', [
  box(-40, 28 + T, 40, 60, 0, 0.04, C.asphalt),
  box(-30, -50, 30, -28 - T, 0, 0.04, C.asphalt),
  ...Array.from({ length: 13 }, (_, k) =>
    drawn(-30 + k * 5, 40, -29.85 + k * 5, 45, 0.04, 0.05, C.paint),
  ),
  ...Array.from({ length: 13 }, (_, k) =>
    drawn(-30 + k * 5, 50, -29.85 + k * 5, 55, 0.04, 0.05, C.paint),
  ),
  P('car', -22.5, 42.6, 0.04, 0, { colors: { paint: '#c9b24a' } }),
  P('car', -7.5, 42.4, 0.04, 180),
  P('car', 12.6, 52.3, 0.04, 0, { colors: { paint: '#6a7a8a' } }),
  P('car', 22.4, 42.7, 0.04, 175),
  P('car', -12.4, 52.6, 0.04, 8, { colors: { paint: '#8a3a32' } }),
  P('car', 2.0, 36.0, 0.04, 75),
  // A trolley shelter, abandoned trolleys, lamps.
  box(-2.6, 47.2, 2.6, 47.3, 0.04, 2.4, C.steel),
  drawn(-2.7, 46.4, 2.7, 47.4, 2.4, 2.5, C.accent),
  ...[0, 1, 2, 3, 4].map((k) => P('shopping-trolley', -1.6 + k * 0.7, 46.7, 0.04, 90)),
  P('shopping-trolley', 7.5, 38.0, 0.04, 30),
  P('shopping-trolley', -17.0, 48.5, 0.04, 200),
  ...[-28, -10, 10, 28].map((x) => P('street-lamp', x, 47.5, 0.04)),
  // The evacuation: barrier blocks across the front, a sandbag post by the exit.
  P('barrier-block', -14, 33.5, 0.04),
  P('barrier-block', 16, 32.5, 0.04),
  P('sandbag-wall', 25, 33.0, 0.04, 10),
  // The dock yard: a box truck backed to the open door, pallets, a skip.
  P('openable-truck', 1.0, -35.4, 0.45),
  P('skip-bin', -22.0, -31.0, 0.04),
  P('wood-pallet-boxes', -14.0, -30.0, 0.04),
  P('wood-pallet-boxes', -14.0, -31.4, 0.04),
  P('stock-wrapped', 18.0, -30.2, 0.04),
  ...[-20, 20].map((x) => P('street-lamp', x, -46, 0.04)),
]);

// ---------------------------------------------------------------------------------------
// Into the map

const map = JSON.parse(readFileSync(FILE, 'utf8'));
const replaced = (n) =>
  (n.type === 'group' && n.name === 'furniture-store') ||
  (n.type === 'box' && n.id === 'ikea-placeholder');
const gone = map.nodes.filter(replaced);
const place = { ...HERE, ...keptPlace(map.nodes, 'furniture-store') };
map.nodes = swapIn(map.nodes, replaced, group('furniture-store', out, place));

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(
  `furniture-store: ${count(out)} nodes in ${out.length} groups; replaced ${gone.length}`,
);
console.log(
  `stair tops: entrance ${r2(stair1.top.x)}, ${r2(stair1.top.z)} @${r2(stair1.top.y)}; market ${r2(stair2.top.x)}, ${r2(stair2.top.z)} @${r2(stair2.top.y)}`,
);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
