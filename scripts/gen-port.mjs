// Generates the Port's bones: content/maps/port.json and its dev-only raid. Terrain, the sea
// and its quays, the dry dock's basin, roads and the rail spur, every place as massing
// boxes at its real footprint and height, the ship boardable (holds, gangways, stern ramp),
// the 13 player spawns and rough extraction zones. Detail comes place by place after the
// user walks the bones (docs/design/maps/port.md).
//
// Re-runs keep what the user made or changed by hand (MK-2, scripts/mapkit/generated.mjs).
//
//   node scripts/gen-port.mjs [--dry-run] [--reclaim <key>,… | all] [--dump <file>]
//
// The play area is x 0..520 (west to east), z 0..360 (north to south). Land is y 0; the
// sea's bed −6 under water at −1.5, so the quays stand 1.5 m over it. The sea lies north-east,
// east and south; the west is land (the hills rise off the map).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGenerated, writeOnce } from './mapkit/generated.mjs';
import { frame } from './mapkit/frame.mjs';
import { along, box, drawn, group, label, prefab, r2 } from './mapkit/nodes.mjs';
import { terrainGrid } from './mapkit/terrain.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = resolve(ROOT, 'content/maps/port.json');
const RAID_FILE = resolve(ROOT, 'content/raids/port.json');
const argv = process.argv.slice(2);

const W = 520;
const D = 360;
const MARGIN = 30;
const CELL = 2;
const ORIGIN = [-MARGIN, -MARGIN];
const COLS = (W + 2 * MARGIN) / CELL;
const ROWS = (D + 2 * MARGIN) / CELL;

const BED = -6;
const SEA = -1.5;

const C = {
  concrete: '#8c8a84',
  'quay-face': '#5d5b57',
  asphalt: '#4f5052',
  service: '#5c5c5e',
  ballast: '#6b6258',
  water: '#2f5566',
  customs: '#9a9488',
  'customs-hall': '#7f8c8f',
  tank: '#c9c6bd',
  bund: '#77746d',
  dorm: '#a88a6a',
  warehouse: '#8a9499',
  'cold-store': '#c3ccd0',
  workshop: '#6f7f86',
  hull: '#7a2e2a',
  'hull-new': '#8a8f93',
  deck: '#5f6a4f',
  superstructure: '#e2ded4',
  crane: '#e0a526',
  'crane-dark': '#c98f1c',
  guard: '#c8c3b5',
  'guard-red': '#b33a2e',
  tower: '#d8d3c6',
  lockup: '#9c9fa3',
  'lockup-door': '#4f6d8a',
  tent: '#6e7356',
  canteen: '#a9765a',
  truckstop: '#b8a582',
  scrap: '#6a5a4a',
  trawler: '#2f5a74',
  fence: '#5a5d60',
  rock: '#6d6a62',
  container: ['#7a3b2e', '#2f5f8a', '#3f6b45', '#8a6d2f', '#6b6f73', '#8a4f2f', '#3d4f6b'],
};

// ---------------------------------------------------------------- the layout
// Every place: [x0, z0, x1, z1] in the map (or in its frame, where it's turned), and why it's
// there. Tiers: major (the big draws), secondary, mini (docs/design/maps/port.md → Places).

/** The sea, as rectangles on even meters (the terrain's corners), so each shore is one cell. */
const SEAS = [
  { id: 'north-east', r: [380, -30, 550, 10] },
  { id: 'east', r: [472, 10, 550, 240] },
  { id: 'south-east', r: [480, 316, 550, 390] },
  { id: 'harbor', r: [160, 338, 480, 390] },
  { id: 'cove', r: [40, 330, 100, 390] },
  { id: 'south-west', r: [-30, 350, 40, 390] },
];
/** A shingle beach running down into the harbor's west end (the beached trawler's). */
const BEACH = { x0: 100, x1: 160, z0: 326, z1: 390 };
/** The dry dock's basin: a hole in the terrain, floored at −8, the gate on the sea. */
const DOCK = { x0: 384, z0: 210, x1: 472, z1: 238, floor: -8 };
/** The coast guard's knoll in the south-west. */
const KNOLL = { x: 100, z: 300, r: 34, top: 3.5, flat: 24 };

const inRect = ([x0, z0, x1, z1], x, z) => x > x0 && x < x1 && z > z0 && z < z1;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

function height(x, z) {
  // The beach: from the land's edge down past the deep line at a walkable 1 in 8.
  if (x > BEACH.x0 && x < BEACH.x1 && z > BEACH.z0) return Math.max(BED, -(z - BEACH.z0) / 8);
  if (SEAS.some((s) => inRect(s.r, x, z))) return BED;
  let h = 0;
  // The hills rise off the map to the west and north-west.
  if (x < 0) h = Math.max(h, Math.min(8, -x * 0.4));
  if (z < 0 && x < 380) h = Math.max(h, Math.min(6, -z * 0.3));
  // The knoll: a level top for the station, easing down to the plain at a walkable slope.
  const d = Math.hypot(x - KNOLL.x, z - KNOLL.z);
  if (d < KNOLL.r)
    h = Math.max(
      h,
      d < KNOLL.flat ? KNOLL.top : KNOLL.top * smooth((KNOLL.r - d) / (KNOLL.r - KNOLL.flat)),
    );
  return h;
}

const ground = terrainGrid({ origin: ORIGIN, cellSize: CELL, cols: COLS, rows: ROWS, height });
const { groundAt } = ground;

const holes = [];
for (let j = 0; j < ROWS; j++)
  for (let i = 0; i < COLS; i++) {
    const x = ORIGIN[0] + (i + 0.5) * CELL;
    const z = ORIGIN[1] + (j + 0.5) * CELL;
    if (inRect([DOCK.x0, DOCK.z0, DOCK.x1, DOCK.z1], x, z)) holes.push([i, j]);
  }

// ---------------------------------------------------------------- helpers

/** A massing block: a building's footprint and height, standing on the ground (or y). */
const mass = (id, x0, z0, x1, z1, h, color, y = 0, extra = {}) => ({
  id,
  ...box(x0, z0, x1, z1, y - 0.3, y + h, color, extra),
});
/** A thin wall (fences and bund walls in the bones), solid. */
function wallRun(id, a, b, h, thick, color, y = 0) {
  const [x0, z0] = a;
  const [x1, z1] = b;
  const len = Math.hypot(x1 - x0, z1 - z0);
  return {
    type: 'box',
    id,
    pos: [r2((x0 + x1) / 2), y, r2((z0 + z1) / 2)],
    size: [r2(len), h, thick],
    yaw: r2((Math.atan2(z1 - z0, x1 - x0) * -180) / Math.PI),
    color,
  };
}
/** A closed fence round a rectangle with gaps: each side's gaps as [from, to] along it. */
function fenceRect(id, [x0, z0, x1, z1], gaps, h = 2.4, color = C.fence) {
  const out = [];
  const sides = {
    n: [
      [x0, z0],
      [x1, z0],
    ],
    s: [
      [x0, z1],
      [x1, z1],
    ],
    w: [
      [x0, z0],
      [x0, z1],
    ],
    e: [
      [x1, z0],
      [x1, z1],
    ],
  };
  for (const [k, [a, b]] of Object.entries(sides)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cuts = (gaps[k] ?? []).slice().sort((p, q) => p[0] - q[0]);
    let t = 0;
    let n = 0;
    const piece = (t0, t1) => {
      if (t1 - t0 < 0.5) return;
      const p = (t) => [lerp(a[0], b[0], t / len), lerp(a[1], b[1], t / len)];
      out.push(wallRun(`${id}-${k}-${++n}`, p(t0), p(t1), h, 0.2, color));
    };
    for (const [g0, g1] of cuts) {
      piece(t, g0);
      t = g1;
    }
    piece(t, len);
  }
  return out;
}
/** A container (8 × 2.8 × 3, long along x) as a box: bones only, the prefab comes later. */
const can = (id, x, z, level, color, yaw = 0) => ({
  type: 'box',
  id,
  pos: [r2(x), r2(level * 2.8), r2(z)],
  size: [8, 2.8, 3],
  ...(yaw ? { yaw } : {}),
  color,
});

// Deterministic picks, so a re-run makes the same map.
let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

// ---------------------------------------------------------------- quays and shores

/**
 * The shores: a quay gets a face (a concrete wall over the cell the terrain falls in, so its
 * top is the quay's edge); deep water then stops anyone stepping off it (movement.ts
 * keepOutOfDeepWater), and gangways and piers cross it freely. A rocky shore has no face, so
 * its slope would let you wade in where you couldn't climb back out: it gets an invisible
 * wall on its water side instead, open where a slip goes down to the water. The beach is
 * open: you walk down it into the water and back.
 */
const QUAYS = [
  // [id, x0, z0, x1, z1, kind, gaps]: the strip the terrain falls across
  ['ne-north', 380, 8, 472, 10, 'quay'], // the dock quay's north end
  ['ne-west', 378, -30, 380, 10, 'quay'],
  ['dock-quay', 472, 10, 474, 210, 'quay'], // the ship's berth
  ['dock-quay-s', 472, 238, 474, 240, 'quay'],
  ['east-strip-n', 474, 240, 550, 242, 'quay'],
  ['east-strip-s', 480, 314, 550, 316, 'quay'],
  ['east-strip-w', 478, 316, 480, 338, 'quay'],
  ['harbor-quay', 160, 336, 478, 338, 'quay'],
  ['cove-e', 100, 330, 102, 336, 'rock', [-1, 0.6, 'w']],
  ['cove-n', 40, 328, 100, 330, 'rock', [0, 0.6, 's'], [[56, 84]]],
  ['cove-w', 38, 330, 40, 350, 'rock', [0, 0.6, 'e']],
  ['south-west', -30, 348, 40, 350, 'rock', [0, 0.6, 's']],
];
const quays = [];
for (const [id, x0, z0, x1, z1, kind, , gaps = []] of QUAYS) {
  if (kind === 'quay') {
    quays.push({ id: `${id}-face`, ...box(x0, z0, x1, z1, BED, 0, C['quay-face']) });
    continue;
  }
  // The invisible wall just past the strip on the water's side, in runs between the gaps.
  const side = QUAYS.find((q) => q[0] === id)[6][2];
  const alongX = side === 's' || side === 'n';
  const [a0, a1] = alongX ? [x0, x1] : [z0, z1];
  let t = a0;
  let k = 0;
  for (const [g0, g1] of [...gaps, [a1, a1]]) {
    if (g0 - t > 0.3) {
      const r = {
        s: [t, z1, g0, z1 + 0.6],
        n: [t, z0 - 0.6, g0, z0],
        e: [x1, t, x1 + 0.6, g0],
        w: [x0 - 0.6, t, x0, g0],
      }[side];
      quays.push({ id: `${id}-edge-${++k}`, ...box(...r, -1, 10, '#5a8ab8', { invisible: true }) });
    }
    t = g1;
  }
}

// ---------------------------------------------------------------- the ship (major)
// A cargo ship on the dock quay's berth, bow north. Deck at 6, holds floored at −1 (a 7 m fall
// from the deck, so the hatches have 1.4 m coamings: going in over one is a choice). Three
// ways aboard: two gangways from the quay, the stern ramp from the pier.
const SHIP = { x0: 476, x1: 500, z0: 20, z1: 120, deck: 6 };
const HOLDS = [
  { id: 'hold-1', z0: 30, z1: 55, hatch: [481, 34, 495, 51] },
  { id: 'hold-2', z0: 62, z1: 87, hatch: [481, 66, 495, 83] },
];
const GANGWAYS = [
  { id: 'gangway-fore', z: 55 },
  { id: 'gangway-aft', z: 93 },
];
/** A rail along a slope (stairs, ramps), 1.1 m over the line, short of each end; solid. */
function slopeRail(id, [ax, ay, az], [bx, by, bz], color = C.crane) {
  const t = 0.4 / Math.hypot(bx - ax, by - ay, bz - az);
  const a = [ax + (bx - ax) * t, ay + (by - ay) * t + 0.75, az + (bz - az) * t];
  const b = [bx - (bx - ax) * t, by - (by - ay) * t + 0.75, bz - (bz - az) * t];
  return { id, ...along(a, b, 0.1, 1.1, color, { collide: true }) };
}
function shipNodes() {
  const { x0, x1, z0, z1, deck } = SHIP;
  const n = [];
  const ix0 = x0 + 0.6;
  const ix1 = x1 - 0.6;
  const bul = deck + 1.1;
  // Sides, with gaps for the gangways; ends.
  let z = z0;
  for (const g of GANGWAYS) {
    n.push({ id: `ship-side-w-${g.id}`, ...box(x0, z, ix0, g.z, BED, bul, C.hull) });
    z = g.z + 2.5;
  }
  n.push({ id: 'ship-side-w-aft', ...box(x0, z, ix0, z1, BED, bul, C.hull) });
  n.push({ id: 'ship-side-e', ...box(ix1, z0, x1, z1, BED, bul, C.hull) });
  n.push({ id: 'ship-bow', ...box(ix0, z0, ix1, z0 + 0.6, BED, bul + 2, C.hull) });
  n.push({ id: 'ship-stern-w', ...box(ix0, z1 - 0.6, 482, z1, BED, bul, C.hull) });
  n.push({ id: 'ship-stern-e', ...box(494, z1 - 0.6, ix1, z1, BED, bul, C.hull) });
  n.push({ id: 'ship-stern-sill', ...box(482, z1 - 0.6, 494, z1, BED, deck, C.hull) });
  // Solid between and round the holds, decked at `deck`.
  const solids = [
    ['ship-fore', z0 + 0.6, HOLDS[0].z0],
    ['ship-mid', HOLDS[0].z1, HOLDS[1].z0],
    ['ship-aft', HOLDS[1].z1, z1 - 0.6],
  ];
  for (const [id, a, b] of solids) n.push({ id, ...box(ix0, a, ix1, b, BED, deck, C.deck) });
  // The forecastle, a step up at the bow.
  n.push({ id: 'ship-forecastle', ...box(ix0, z0 + 0.6, ix1, 27, deck, deck + 2.2, C.hull) });
  n.push({
    type: 'stairs',
    color: C.concrete,
    id: 'ship-forecastle-stairs',
    pos: [486, deck, 28.5],
    yaw: 180,
    size: [3, 2.2, 3],
  });
  for (const h of HOLDS) {
    const [hx0, hz0, hx1, hz1] = h.hatch;
    // The hold's floor, and the deck over it with the hatch open.
    n.push({ id: `${h.id}-floor`, ...box(ix0, h.z0, ix1, h.z1, BED, -1, C.deck) });
    const strips = [
      [ix0, h.z0, ix1, hz0],
      [ix0, hz1, ix1, h.z1],
      [ix0, hz0, hx0, hz1],
      [hx1, hz0, ix1, hz1],
    ];
    strips.forEach(([a, b, c, d], k) =>
      n.push({ id: `${h.id}-deck-${k + 1}`, ...box(a, b, c, d, deck - 0.3, deck, C.deck) }),
    );
    // Coamings round the hatch, open where the hold's stairs come up at its south end.
    n.push({ id: `${h.id}-coaming-n`, ...box(hx0, hz0 - 0.4, hx1, hz0, deck, deck + 1.4, C.hull) });
    n.push({ id: `${h.id}-coaming-w`, ...box(hx0 - 0.4, hz0, hx0, hz1, deck, deck + 1.4, C.hull) });
    n.push({ id: `${h.id}-coaming-e`, ...box(hx1, hz0, hx1 + 0.4, hz1, deck, deck + 1.4, C.hull) });
    n.push({
      id: `${h.id}-coaming-s`,
      ...box(hx0 + 3, hz1, hx1, hz1 + 0.4, deck, deck + 1.4, C.hull),
    });
    // Stairs from the hold's floor up to the deck at the hatch's south-west corner.
    n.push({
      type: 'stairs',
      color: C.concrete,
      id: `${h.id}-stairs`,
      pos: [hx0 + 1.5, -1, hz1 - 5],
      size: [2.6, deck + 1, 9.6],
    });
    n.push(
      slopeRail(
        `${h.id}-stairs-rail-e`,
        [hx0 + 2.86, -1, hz1 - 9.8],
        [hx0 + 2.86, deck, hz1 - 0.2],
      ),
    );
    n.push(
      slopeRail(
        `${h.id}-stairs-rail-w`,
        [hx0 + 0.14, -1, hz1 - 9.8],
        [hx0 + 0.14, deck, hz1 - 0.2],
      ),
    );
  }
  // The superstructure aft (bones: a block; rooms and the bridge come with its own session).
  n.push({
    id: 'ship-house',
    ...box(478, 98, 498, 115, deck, deck + 12, C.superstructure, { landmark: true }),
  });
  n.push({
    type: 'cylinder',
    id: 'ship-funnel',
    pos: [488, deck + 12, 110],
    radius: 2.2,
    height: 6,
    color: '#2b2b2b',
  });
  // Gangways: stairs up the quay to a bridge over the gap onto the deck.
  for (const g of GANGWAYS) {
    n.push({
      type: 'stairs',
      color: C.concrete,
      id: `${g.id}-stairs`,
      pos: [469.5, 0, g.z - 4.8],
      size: [2.5, deck, 9.6],
      sides: 1,
    });
    n.push({
      id: `${g.id}-bridge`,
      ...box(468.25, g.z, ix0, g.z + 2.5, deck - 0.3, deck, C.fence),
    });
    n.push(slopeRail(`${g.id}-rail-w`, [468.19, 0, g.z - 9.6], [468.19, deck, g.z], C.fence));
    n.push(slopeRail(`${g.id}-rail-e`, [470.81, 0, g.z - 9.6], [470.81, deck, g.z], C.fence));
    n.push({
      id: `${g.id}-bridge-rail-n`,
      ...box(470.81, g.z - 0.1, x0, g.z, deck, deck + 1.1, C.fence),
    });
    n.push({
      id: `${g.id}-bridge-rail-s`,
      ...box(468.25, g.z + 2.5, x0, g.z + 2.6, deck, deck + 1.1, C.fence),
    });
    n.push({
      id: `${g.id}-bridge-rail-w`,
      ...box(468.15, g.z, 468.25, g.z + 2.6, deck, deck + 1.1, C.fence),
    });
  }
  // The stern pier and the ramp from it up onto the stern deck.
  n.push({ id: 'stern-pier', ...box(474, 124, 508, 146, BED, 0, C.concrete) });
  n.push({ id: 'stern-gap', ...box(474, 120, 508, 124, BED, 0, C.concrete) });
  n.push({
    type: 'ramp',
    id: 'stern-ramp',
    pos: [488, 0, 128],
    yaw: 180,
    size: [12, deck, 16],
    color: C.deck,
  });
  n.push(slopeRail('stern-ramp-rail-w', [481.94, 0, 136], [481.94, deck, 120], C.fence));
  n.push(slopeRail('stern-ramp-rail-e', [494.06, 0, 136], [494.06, deck, 120], C.fence));
  return n;
}

// Ship-to-shore cranes on the dock quay: legs that collide, the boom out of reach.
function stsCrane(id, z) {
  const legs = [
    [452, z],
    [469, z],
    [452, z + 14],
    [469, z + 14],
  ].map(([x, zz], k) => ({
    id: `${id}-leg-${k + 1}`,
    ...box(x - 0.6, zz - 0.6, x + 0.6, zz + 0.6, 0, 18, C.crane),
  }));
  return [
    ...legs,
    { id: `${id}-portal-n`, ...drawn(451.4, z - 0.6, 469.6, z + 0.6, 16, 18, C['crane-dark']) },
    { id: `${id}-portal-s`, ...drawn(451.4, z + 13.4, 469.6, z + 14.6, 16, 18, C['crane-dark']) },
    {
      id: `${id}-boom`,
      ...drawn(430, z + 5.5, 512, z + 8.5, 28, 30, C.crane, { landmark: true }),
    },
    { id: `${id}-cab`, ...drawn(470, z + 5.5, 474, z + 8.5, 24, 27, C.guard) },
    { id: `${id}-machinery`, ...drawn(440, z + 4, 452, z + 10, 30, 34, C['crane-dark']) },
  ];
}

// ---------------------------------------------------------------- places

// Customs (major, north-west): the office block, the truck inspection hall, a fenced compound.
const CUSTOMS = { yard: [18, 22, 116, 96] };
const customs = group('Customs', [
  mass('customs-office', 28, 30, 88, 54, 12, C.customs),
  mass('customs-wing', 28, 54, 44, 70, 8, C.customs),
  mass('customs-hall', 54, 64, 108, 88, 8, C['customs-hall']),
  mass('customs-booth', 92, 34, 98, 40, 3, C.guard),
  ...fenceRect('customs-fence', CUSTOMS.yard, {
    n: [[80, 92]],
    e: [
      [20, 32],
      [52, 60],
    ],
    s: [
      [8, 16],
      [60, 70],
    ],
    w: [[80, 88]],
  }),
]);

// Fuel depot (secondary): four tanks in two walled bunds, a pump house, a tanker stand.
const TANKS = [
  [162, 42],
  [190, 42],
  [162, 72],
  [190, 72],
];
const fuel = group('Fuel depot', [
  ...TANKS.map(([x, z], k) => ({
    type: 'cylinder',
    id: `tank-${k + 1}`,
    pos: [x, 0, z],
    radius: 8,
    height: 12,
    sides: 16,
    color: C.tank,
    ...(k === 1 ? { landmark: true } : {}),
  })),
  ...fenceRect('bund-north', [150, 30, 202, 56], { s: [[22, 30]], w: [[10, 16]] }, 1.4, C.bund),
  ...fenceRect('bund-south', [150, 60, 202, 86], { n: [[22, 30]], e: [[10, 16]] }, 1.4, C.bund),
  mass('pump-house', 206, 64, 216, 74, 4, C.customs),
  mass('tanker-stand', 206, 34, 216, 54, 6, C.fence),
]);

// Quarantine tents (mini): a medical camp in the gap between customs and the tanks.
const tents = group('Quarantine tents', [
  mass('qt-tent-1', 124, 64, 134, 72, 3, C.tent),
  mass('qt-tent-2', 124, 78, 134, 86, 3, C.tent),
  mass('qt-tent-3', 136, 92, 146, 100, 3, C.tent),
  mass('qt-trailer', 136, 66, 140, 80, 3, C.guard),
]);

// North checkpoint (mini): the road in from the north, a booth and barriers.
const checkpoint = group('North checkpoint', [
  prefab('guard-booth', 229, 20, { id: 'cp-booth', yaw: 90 }, 0.05),
  prefab('jersey-barrier', 214, 20, { id: 'cp-barrier-1' }),
  prefab('jersey-barrier', 222, 24, { id: 'cp-barrier-2' }),
  prefab('jersey-barrier', 216, 30, { id: 'cp-barrier-3', yaw: 20 }),
  mass('cp-sandbags', 209, 12, 212, 16, 1.2, C.tent),
]);

// The container yard (secondary), on its own grid turned 12°: fenced, four gates, rows of
// stacks one to three high with cut-throughs, a yard crane over the east rows.
const YARD = frame({ x: 306, z: 60, yaw: -12 });
function yardNodes() {
  const n = [];
  const hw = 42;
  const hd = 38;
  n.push(
    ...fenceRect(
      'yard-fence',
      [-hw, -hd, hw, hd],
      {
        n: [[30, 40]],
        s: [[44, 56]],
        w: [[30, 42]],
        e: [
          [18, 28],
          [52, 60],
        ],
      },
      2.6,
    ),
  );
  // Rows along x at these z, blocks of containers side by side along z, gaps between blocks.
  const rows = [-30, -17, -4, 9, 22];
  let k = 0;
  rows.forEach((rz, r) => {
    let x = -38 + (r % 2) * 5;
    while (x < 34) {
      const across = 2 + Math.floor(rand() * 2); // 2 or 3 containers side by side
      const len = 8;
      for (let a = 0; a < across; a++) {
        const levels = 1 + Math.floor(rand() * 3);
        const color = pick(C.container);
        const cx = x + len / 2;
        const cz = rz + a * 3 + 1.5;
        if (Math.abs(cx - 30) < 13 && Math.abs(cz) < 10) continue;
        for (let l = 0; l < levels; l++)
          n.push(can(`yc-${++k}`, cx, cz, l, l ? pick(C.container) : color));
      }
      x += len + 4 + Math.floor(rand() * 3) * 2; // 4 to 8 m cut-throughs
    }
  });
  // The yard crane straddling the east end (the cab is a perch: mini POI).
  n.push(prefab('gantry-crane', 30, 0, { id: 'yard-crane', yaw: 90 }));
  return n;
}
const yard = YARD.group('Container yard', yardNodes());

// The docks (the ship's quay): a transit shed, the cranes, the ship.
const docks = group('Docks', [
  mass('transit-shed', 392, 60, 440, 108, 9, C.warehouse),
  mass('dock-office', 392, 20, 410, 34, 6, C.customs),
  ...stsCrane('sts-1', 28),
  ...stsCrane('sts-2', 68),
  ...shipNodes(),
]);

// Dorms (secondary, west): three blocks round a courtyard, bridged upstairs.
const dorms = group('Dorms', [
  mass('dorm-a', 26, 136, 40, 194, 10, C.dorm),
  mass('dorm-b', 54, 134, 110, 148, 10, C.dorm),
  mass('dorm-c', 54, 180, 110, 194, 10, C.dorm),
  { id: 'dorm-bridge-ab', ...box(40, 140, 54, 143, 6.6, 7, C.concrete) },
  { id: 'dorm-bridge-bc', ...box(96, 148, 99, 180, 6.6, 7, C.concrete) },
]);

// Seamen's canteen (mini) between the dorms and the warehouse.
const canteen = group("Seamen's canteen", [mass('canteen', 148, 160, 166, 176, 4.5, C.canteen)]);

// The warehouse (major, center): rack half west, cold store east.
const warehouse = group('Warehouse', [
  mass('warehouse-dry', 206, 150, 254, 214, 11, C.warehouse),
  mass('warehouse-cold', 254, 150, 296, 214, 9, C['cold-store']),
  mass('warehouse-dock', 296, 160, 304, 204, 1.2, C.concrete),
  {
    type: 'ramp',
    id: 'warehouse-dock-ramp',
    pos: [300, 0, 156],
    size: [8, 1.2, 8],
    color: C.concrete,
  },
]);

// Rail siding (mini) on the spur west of the warehouse: boxcars to hide behind.
const siding = group('Rail siding', [
  prefab('boxcar', 190, 175, { id: 'siding-boxcar-1', yaw: 90 }),
  prefab('boxcar-open', 190, 191, { id: 'siding-boxcar-2', yaw: 90 }),
  prefab('flatcar', 194.5, 160, { id: 'siding-flatcar', yaw: 90 }),
  prefab('boxcar', 124, 229.5, { id: 'spur-boxcar-west' }),
]);

// The dry dock (major, east): the basin, the hull on its blocks, the workshop along the north.
function dryDockNodes() {
  const { x0, z0, x1, z1, floor } = DOCK;
  const n = [];
  n.push({ id: 'basin-floor', ...box(x0, z0, x1, z1, floor - 0.5, floor, C.concrete) });
  n.push({ id: 'basin-wall-n', ...box(x0, z0, x1 - 2, z0 + 1, floor, 0, C['quay-face']) });
  n.push({ id: 'basin-wall-s', ...box(x0, z1 - 1, x1 - 2, z1, floor, 0, C['quay-face']) });
  n.push({ id: 'basin-wall-w', ...box(x0, z0 + 1, x0 + 1, z1 - 1, floor, 0, C['quay-face']) });
  // The gate (caisson) holding back the sea: walk across its top.
  n.push({ id: 'basin-gate', ...box(x1 - 2, z0, x1, z1, floor, 0.4, C.hull) });
  // Ways down: stairs against the north and south walls, and a ramp at the head (the AI's).
  n.push({
    type: 'stairs',
    color: C.concrete,
    id: 'basin-stairs-n',
    pos: [440, floor, z0 + 2.5],
    yaw: -90,
    size: [3, -floor, 12],
    sides: 1,
  });
  n.push({
    type: 'stairs',
    color: C.concrete,
    id: 'basin-stairs-s',
    pos: [410, floor, z1 - 2.5],
    yaw: 90,
    size: [3, -floor, 12],
    sides: 1,
  });
  n.push({
    type: 'ramp',
    id: 'basin-ramp',
    pos: [x0 + 9, floor, 224],
    yaw: -90,
    size: [5, -floor, 16],
    color: C.concrete,
  });
  // Landings at the stairs' tops, level with the quay.
  n.push({ id: 'basin-landing-n', ...box(430, z0 + 1, 434, z0 + 4, floor, 0, C.concrete) });
  n.push({ id: 'basin-landing-s', ...box(416, z1 - 4, 420, z1 - 1, floor, 0, C.concrete) });
  // Railings round the basin (an 8 m fall), open at the stairs, the ramp and the bridges.
  const rail = (id, a0, a1, at, alongX, gaps) => {
    let t = a0;
    let k = 0;
    for (const [g0, g1] of [...gaps, [a1, a1]]) {
      if (g0 - t > 0.3)
        n.push({
          id: `${id}-${++k}`,
          ...(alongX
            ? box(t, at - 0.05, g0, at + 0.05, 0, 1.1, C.crane)
            : box(at - 0.05, t, at + 0.05, g0, 0, 1.1, C.crane)),
        });
      t = g1;
    }
  };
  rail('basin-rail-n', x0, x1 - 2, z0 + 0.95, true, [
    [424, 427],
    [430, 434],
  ]);
  rail('basin-rail-s', x0, x1 - 2, z1 - 0.95, true, [
    [416, 420],
    [436, 439],
  ]);
  rail('basin-rail-w', z0 + 1, z1 - 1, x0 + 0.95, false, [[221, 227]]);
  rail('basin-rail-gate', z0 + 1, z1 - 1, x1 - 1.95, false, []);
  // the landings' open sides
  rail('landing-n-rail-w', z0 + 1, z0 + 4, 430.05, false, []);
  rail('landing-n-rail-s', 430, 434, z0 + 3.95, true, []);
  rail('landing-s-rail-e', z1 - 4, z1 - 1, 419.95, false, []);
  rail('landing-s-rail-n', 416, 420, z1 - 3.95, true, []);
  // Sloped rails on the open sides of the stairs and the ramp, short of each end.
  n.push(slopeRail('stairs-n-rail', [446, floor, 214.06], [434, 0, 214.06]));
  n.push(slopeRail('stairs-s-rail', [404, floor, 233.94], [416, 0, 233.94]));
  n.push(slopeRail('ramp-rail-n', [401, floor, 221.44], [385, 0, 221.44]));
  n.push(slopeRail('ramp-rail-s', [401, floor, 226.56], [385, 0, 226.56]));
  // The hull under construction on keel blocks: walk under it between the blocks.
  for (let k = 0; k < 6; k++) {
    const bx = 406 + k * 9;
    n.push({ id: `keel-block-${k + 1}`, ...box(bx, 222, bx + 2, 226, floor, floor + 2.2, C.bund) });
  }
  n.push({ id: 'new-hull', ...box(404, 216, 458, 232, floor + 2.2, 0.4, C['hull-new']) });
  n.push({ id: 'hull-bridge-n', ...box(424, z0 + 1, 427, 216, -0.1, 0.4, C.fence) });
  n.push({ id: 'hull-bridge-s', ...box(436, 232, 439, z1 - 1, -0.1, 0.4, C.fence) });
  // Rails on the bridges' sides and round the hull's deck (open at the bridges), on top of it.
  const hullRail = (id, a, b, at, alongX, gaps) => {
    let t = a;
    let k = 0;
    for (const [g0, g1] of [...gaps, [b, b]]) {
      if (g0 - t > 0.3)
        n.push({
          id: `${id}-${++k}`,
          ...(alongX
            ? box(t, at - 0.05, g0, at + 0.05, 0.4, 1.5, C.crane)
            : box(at - 0.05, t, at + 0.05, g0, 0.4, 1.5, C.crane)),
        });
      t = g1;
    }
  };
  hullRail('bridge-n-rail-w', z0 + 1, 216, 424.05, false, []);
  hullRail('bridge-n-rail-e', z0 + 1, 216, 426.95, false, []);
  hullRail('bridge-s-rail-w', 232, z1 - 1, 436.05, false, []);
  hullRail('bridge-s-rail-e', 232, z1 - 1, 438.95, false, []);
  hullRail('hull-rail-n', 404, 458, 216.05, true, [[424, 427]]);
  hullRail('hull-rail-s', 404, 458, 231.95, true, [[436, 439]]);
  hullRail('hull-rail-w', 216.1, 231.9, 404.05, false, []);
  hullRail('hull-rail-e', 216.1, 231.9, 457.95, false, []);
  // The workshop and its yard.
  n.push(mass('dd-workshop', 386, 180, 456, 204, 13, C.workshop, 0, { landmark: true }));
  n.push(mass('dd-store', 458, 186, 470, 204, 5, C.customs));
  return n;
}
const dryDock = group('Dry dock', dryDockNodes());

// Ship-breaker's scrapyard (mini): heaps and a cut-up hull section, east of the lockups.
const scrapyard = group('Scrapyard', [
  mass('scrap-heap-1', 434, 252, 446, 262, 3.5, C.scrap),
  mass('scrap-heap-2', 452, 266, 464, 276, 2.5, C.scrap),
  mass('scrap-hull', 430, 280, 458, 290, 6, C.hull),
  mass('scrap-shed', 462, 284, 472, 300, 4, C.workshop),
]);

// The control tower (major, south): the office block and the tower over it, on the harbor quay.
const tower = group('Control tower', [
  mass('ct-offices', 204, 290, 250, 312, 8, C.tower),
  mass('ct-tower', 238, 312, 250, 324, 30, C.tower, 0, { landmark: true }),
  mass('ct-garage', 210, 318, 226, 330, 4, C.customs),
  // The south pier: the extract out on the water.
  { id: 'south-pier', ...box(256, 338, 268, 376, BED, 0, C.concrete) },
]);

// The coast guard station (secondary, south-west) on its knoll, the boathouse on the cove.
const coast = group('Coast guard', [
  mass('cg-station', 82, 286, 122, 304, 7, C.guard, KNOLL.top),
  mass('cg-armory', 108, 304, 122, 312, 4, C['guard-red'], KNOLL.top),
  {
    type: 'cylinder',
    id: 'cg-radar-mast',
    pos: [90, KNOLL.top, 312],
    radius: 0.6,
    height: 22,
    color: C.guard,
    landmark: true,
  },
  { id: 'cg-slip', ...box(58, 322, 82, 346, BED, -0.4, C.concrete) },
  { id: 'cg-boathouse-w', ...box(56, 318, 56.3, 346, BED, 5, C.guard) },
  { id: 'cg-boathouse-e', ...box(83.7, 318, 84, 346, BED, 5, C.guard) },
  { id: 'cg-boathouse-n-1', ...box(56.3, 318, 67, 318.3, -0.4, 5, C.guard) },
  { id: 'cg-boathouse-n-2', ...box(70, 318, 83.7, 318.3, -0.4, 5, C.guard) },
  { id: 'cg-boathouse-lintel', ...box(67, 318, 70, 318.3, 2.4, 5, C.guard) },
  { id: 'cg-boathouse-roof', ...box(55.6, 317.6, 84.4, 346.4, 5, 5.3, C['guard-red']) },
]);

// Self-storage lockups (secondary, south-east), turned on their own grid: rows of units.
const LOCK = frame({ x: 380, z: 296, yaw: 8 });
function lockupNodes() {
  const n = [];
  const rows = [-26, -12, 2, 16];
  rows.forEach((rz, r) => {
    // a row of units back to back, broken in the middle by a cut-through
    const gapAt = -10 + r * 7;
    n.push({ id: `lk-row-${r + 1}-w`, ...box(-36, rz, gapAt - 2, rz + 7, -0.3, 3, C.lockup) });
    n.push({ id: `lk-row-${r + 1}-e`, ...box(gapAt + 2, rz, 36, rz + 7, -0.3, 3, C.lockup) });
  });
  n.push(
    ...fenceRect('lk-fence', [-40, -32, 40, 30], {
      n: [[34, 46]],
      w: [[22, 32]],
      e: [[40, 50]],
      s: [
        [10, 18],
        [56, 64],
      ],
    }),
  );
  n.push({ id: 'lk-office', ...box(-46, -26, -42, -16, -0.3, 3.2, C.customs) });
  return n;
}
const lockups = LOCK.group('Lockups', lockupNodes());

// Truck stop and weighbridge (mini) on the west road.
const truckstop = group('Truck stop', [
  mass('ts-diner', 14, 258, 34, 270, 4, C.truckstop),
  mass('ts-weighbridge-hut', 46, 256, 52, 262, 3, C.guard),
  { id: 'ts-weighbridge', ...box(54, 252, 72, 256, 0, 0.25, C.fence) },
  prefab('semi-tractor', 62, 264, { id: 'ts-semi', yaw: 90 }),
]);

// Cash van wreck (mini) on the south road between the warehouse and the tower.
const cashVan = group('Cash van', [
  prefab('openable-truck', 300, 262, { id: 'cv-truck', yaw: 70 }, 0.45),
  prefab('car', 288, 256, { id: 'cv-escort', yaw: -30 }),
]);

// The beached trawler (mini) on the shingle below the tower's west quay.
const trawler = group('Trawler', [
  {
    id: 'trawler-hull',
    ...box(132, 344, 140, 366, -3.6, 1.6, C.trawler, { roll: 8 }),
  },
  { id: 'trawler-wheelhouse', ...box(133, 356, 139, 362, 2.3, 5, C.guard) },
]);

// ---------------------------------------------------------------- roads and rail
// Map roads, graded at compile. Bent every 60–90 m so no straight runs the map; two grids
// meet where the yard's and the lockups' turned roads join the straight ones.
const ROADS = [
  {
    id: 'north-avenue',
    name: 'North avenue',
    width: 9,
    points: [
      [-30, 108],
      [44, 110],
      [118, 104],
      [212, 112],
      [270, 118],
      [344, 124],
      [380, 140],
      [440, 168],
      [472, 172],
    ],
  },
  {
    id: 'south-avenue',
    name: 'South avenue',
    width: 9,
    points: [
      [-30, 246],
      [70, 248],
      [150, 256],
      [230, 250],
      [304, 262],
      [376, 254],
      [430, 244],
      [550, 266],
    ],
  },
  {
    id: 'checkpoint-road',
    name: 'Checkpoint road',
    width: 8,
    points: [
      [218, -30],
      [218, 22],
      [214, 62],
      [212, 112],
    ],
  },
  {
    id: 'customs-lane',
    width: 7,
    points: [
      [118, 104],
      [120, 60],
      [116, 16],
      [140, 12],
      [218, 14],
    ],
  },
  {
    id: 'yard-road',
    width: 7,
    points: [
      [270, 118],
      [258, 70],
      [262, 14],
      [218, 14],
    ],
  },
  {
    id: 'quay-road',
    width: 8,
    points: [
      [344, 124],
      [366, 80],
      [376, 16],
    ],
  },
  {
    id: 'dorm-lane',
    width: 7,
    points: [
      [118, 104],
      [124, 150],
      [134, 200],
      [150, 256],
    ],
  },
  {
    id: 'warehouse-ring',
    width: 7,
    points: [
      [212, 112],
      [200, 140],
      [198, 224],
      [244, 230],
      [310, 226],
      [330, 190],
      [344, 124],
    ],
  },
  {
    id: 'tower-road',
    width: 7,
    points: [
      [230, 250],
      [228, 282],
      [190, 286],
      [168, 324],
    ],
  },
  {
    id: 'coast-road',
    width: 6,
    points: [
      [70, 248],
      [74, 272],
      [86, 282],
    ],
  },
  {
    id: 'lockups-road',
    width: 7,
    points: [
      [376, 254],
      [384, 268],
    ],
  },
  {
    id: 'drydock-road',
    width: 7,
    points: [
      [380, 140],
      [376, 176],
      [372, 206],
      [374, 248],
    ],
  },
  {
    id: 'west-lane',
    width: 6,
    points: [
      [44, 110],
      [48, 128],
      [46, 214],
      [70, 248],
    ],
  },
];
const RAIL = {
  id: 'rail-spur',
  name: 'Rail spur',
  width: 4,
  color: C.ballast,
  points: [
    [-30, 232],
    [120, 228],
    [172, 220],
    [188, 196],
    [190, 150],
    [204, 128],
    [250, 122],
    [300, 112],
  ],
};

// ---------------------------------------------------------------- spawns and extracts
// Fifteen spawn points round the edge, none within 70 m of a major place and none round the
// ship's corner. A raid with six parties picks six of them at least 140 m apart (that picking
// is PvP's, not built); PvE picks one. Each faces inward.
const SPAWNS = [
  ['n-tanks', 178, 4, 180],
  ['n-checkpoint', 262, 4, 180],
  ['n-yard', 350, 4, 200],
  ['w-dorms', 4, 160, 90],
  ['w-truckstop', 4, 252, 90],
  ['sw-rocks', 6, 336, 45],
  ['s-beach', 120, 324, -20],
  ['s-lockups', 330, 334, 0],
  ['se-quay', 424, 334, -20],
  ['e-road', 516, 300, -90],
  ['n-mid', 220, 4, 180],
  ['n-east', 306, 4, 190],
  ['w-lane', 4, 206, 90],
  ['w-coast', 4, 296, 80],
  ['se-strip', 470, 312, -45],
];
const MAJORS = {
  customs: [28, 30, 108, 88],
  ship: [SHIP.x0, SHIP.z0, SHIP.x1, SHIP.z1],
  warehouse: [206, 150, 296, 214],
  'dry dock': [386, 180, 472, 238],
  'control tower': [204, 290, 250, 324],
};
/** Rough extraction zones (test): each spawn gets those 150 m or more away. */
const EXTRACTS = [
  { id: 'north-road', name: 'North road (test)', r: [212, 0, 224, 6] },
  { id: 'west-road', name: 'West road (test)', r: [0, 242, 6, 252] },
  { id: 'east-road', name: 'East road (test)', r: [514, 260, 520, 272] },
  { id: 'south-pier', name: 'South pier (test)', r: [256, 352, 268, 360] },
  { id: 'cove-boat', name: 'Coast guard boat (test)', r: [62, 330, 78, 342], y: -0.4 },
];
const center = ([x0, z0, x1, z1]) => [(x0 + x1) / 2, (z0 + z1) / 2];
const spawnNodes = SPAWNS.map(([id, x, z, yaw]) => ({
  type: 'playerSpawn',
  id,
  pos: [x, r2(groundAt(x, z)), z],
  yaw,
  noExtracts: EXTRACTS.filter((e) => {
    const [ex, ez] = center(e.r);
    return Math.hypot(ex - x, ez - z) < 150;
  }).map((e) => e.id),
}));

// ---------------------------------------------------------------- water and edges

function waterRects() {
  // The sea minus the ship's hull and the dry dock's basin; the beach's water too.
  const out = [];
  const cut = (id, [x0, z0, x1, z1]) =>
    out.push({
      type: 'water',
      id,
      pos: [r2((x0 + x1) / 2), SEA, r2((z0 + z1) / 2)],
      size: [r2(x1 - x0), r2(z1 - z0)],
      color: C.water,
    });
  cut('sea-north-east', [380, -30, 550, 10]);
  cut('sea-berth', [472, 10, SHIP.x0, 240]);
  cut('sea-bow', [SHIP.x0, 10, SHIP.x1, SHIP.z0]);
  cut('sea-stern', [SHIP.x0, SHIP.z1, SHIP.x1, 240]);
  cut('sea-east', [SHIP.x1, 10, 550, 240]);
  cut('sea-south-east', [480, 316, 550, 390]);
  cut('sea-harbor', [160, 338, 480, 390]);
  cut('sea-beach', [BEACH.x0, 336, BEACH.x1, 390]);
  cut('sea-cove', [40, 330, 100, 390]);
  cut('sea-south-west', [-30, 350, 40, 390]);
  return out;
}

const edge = (id, x0, z0, x1, z1) => {
  const [lo, hi] = ground.groundRange(x0, z0, x1, z1);
  return { id, ...box(x0, z0, x1, z1, lo - 1, hi + 10, '#5a8ab8', { invisible: true }) };
};
const edges = group('Edges', [
  edge('edge-n', -1, -1, W + 1, 0),
  edge('edge-s', -1, D, W + 1, D + 1),
  edge('edge-w', -1, 0, 0, D),
  edge('edge-e', W, 0, W + 1, D),
]);

// The report's areas, one per place (map-report.mjs → areas), and the minis as names.
const labels = group('Map labels', [
  label('Ship', 488, 58, 'area', SHIP.deck),
  label('Customs', 50, 60, 'area'),
  label('Warehouse', 250, 220, 'area'),
  label('Dry dock', 420, 207, 'area'),
  label('Control tower', 226, 284, 'area'),
  label('Container yard', 304.5, 66.8, 'area'),
  label('Docks', 420, 115, 'area'),
  label('Dorms', 75, 165, 'area'),
  label('Fuel depot', 176, 58, 'area'),
  label('Coast guard', 100, 280, 'area', KNOLL.top),
  label('Lockups', 379.8, 294.5, 'area'),
  label('North checkpoint', 218, 18),
  label('Quarantine tents', 130, 80),
  label("Seamen's canteen", 157, 168),
  label('Rail siding', 190, 184),
  label('Truck stop', 30, 264),
  label('Cash van', 300, 262),
  label('Scrapyard', 450, 270),
  label('Trawler', 136, 352),
  label('Yard crane', 336, 52),
]);

const map = {
  formatVersion: 4,
  id: 'port',
  name: 'Port',
  environment: { sky: '#9fb0b8', fogNear: 60, fogFar: 160 },
  terrain: ground.node('#6f7059', holes),
  hearingScale: 0.6,
  roads: [...ROADS.map((r) => ({ ...r, color: r.width >= 8 ? undefined : C.service })), RAIL].map(
    (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)),
  ),
  nodes: [
    group('Spawns', spawnNodes),
    customs,
    fuel,
    tents,
    checkpoint,
    yard,
    docks,
    dorms,
    canteen,
    warehouse,
    siding,
    dryDock,
    scrapyard,
    tower,
    coast,
    lockups,
    truckstop,
    cashVan,
    trawler,
    group('Quays', quays),
    group('Water', waterRects()),
    edges,
    labels,
  ],
  zones: EXTRACTS.map((e) => {
    const [x0, z0, x1, z1] = e.r;
    return {
      id: e.id,
      name: e.name,
      points: [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ],
      extraction: { y: e.y ?? r2(groundAt(...center(e.r))), height: 4 },
    };
  }),
};

const raid = {
  formatVersion: 1,
  id: 'port',
  name: 'Port',
  map: 'port',
  duration: 1800,
  order: 4,
  tags: ['test'],
  dev: true,
};

// ---------------------------------------------------------------- checks printed each run

function spawnReport() {
  const pts = SPAWNS.map(([id, x, z]) => ({ id, x, z }));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const rectDist = ([x0, z0, x1, z1], x, z) =>
    Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  const rows = pts.map((p) => {
    const near = Math.min(...pts.filter((q) => q !== p).map((q) => dist(p, q)));
    const [major, md] = Object.entries(MAJORS)
      .map(([k, r]) => [k, rectDist(r, p.x, p.z)])
      .sort((a, b) => a[1] - b[1])[0];
    return `${p.id.padEnd(13)} nearest spawn ${Math.round(near)} m, nearest major ${major} ${Math.round(md)} m`;
  });
  // Six-party picks: sets of six all at least 150 m apart.
  let sets = 0;
  let best = 0;
  const n = pts.length;
  const rec = (start, chosen) => {
    if (chosen.length === 6) {
      sets++;
      best = Math.max(
        best,
        Math.min(...chosen.flatMap((a, i) => chosen.slice(i + 1).map((b) => dist(a, b)))),
      );
      return;
    }
    for (let i = start; i < n; i++)
      if (chosen.every((c) => dist(c, pts[i]) >= 140)) rec(i + 1, [...chosen, pts[i]]);
  };
  rec(0, []);
  console.log(rows.join('\n'));
  console.log(
    `six-party picks with every pair 140 m+ apart: ${sets} (best closest pair ${Math.round(best)} m)`,
  );
}

await writeGenerated({ file: MAP_FILE, map, by: fileURLToPath(import.meta.url), root: ROOT, argv });
await writeOnce({ file: RAID_FILE, doc: raid, root: ROOT, argv });
spawnReport();
