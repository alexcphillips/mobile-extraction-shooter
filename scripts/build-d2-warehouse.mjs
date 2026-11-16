// d2's warehouse (2026-11-15, the user's request: "add the warehouse to d2", District's
// mall warehouse and loading docks, with its container stacks). Placed by Claude, the user's
// pick of the options: 30 m east of the user's substation footprint (x −22..8, z 93..123),
// docks facing it, so the two make a service quarter. Written into content/maps/d2.json as
// one group named `warehouse`. Re-runnable: it replaces its own group, nothing else.
//
// Plan (docs/design/maps/d2.md → The warehouse has the why):
// - The shed: 48 × 38 m (x 40..88, z 90..128), District's size, its floor at dock height
//   (1.2 m) on a concrete slab, walls to 10 m, a flat roof out of reach.
// - The loading dock along the west wall: an apron at floor height with four bays (three
//   open, one shuttered), a box truck backed up to bay 1 (walk-in, its rear doors open onto
//   the dock) and a container truck at bay 3, steps up at both ends of the apron.
// - Inside: the dock office and a break room in the south-west corner under a storage
//   mezzanine (4.6 m), reached by one stair; the staging floor inside the dock doors; six
//   back-to-back rack rows across the rest, each with one bay left out, alternating, so the
//   cross aisles zigzag and no aisle runs the shed's length unbroken (a forklift and stock
//   in the aisles break the 30 m east–west lines).
// - Ways in: the three open bays, the office's door onto the apron, the east staff door,
//   the north forklift ramp and roll-up, a north door and the south fire exit (all with steps
//   the AI follows).
// - The cans: container stacks north of the shed (some two high, one open walk-in).
// - No loot yet (loot comes last). The freight elevator (roadmap DS-17) isn't built.
//
// Usage: node scripts/build-d2-warehouse.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { box, drawn, group, prefab } from './mapkit/nodes.mjs';
import { roomWalls, union } from './mapkit/rooms.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');

// Levels.
const F = 1.2; // the shed's floor and the dock apron (dock height)
const OC = 4.4; // the office's ceiling: the mezzanine's underside
const M = 4.6; // the mezzanine
const TOP = 10; // the walls' top, under the roof
const ROOF = 10.2;
const T = 0.1;

const C = {
  outside: '#7f8a8f', // corrugated steel
  inside: '#b9b6ad',
  roof: '#5d6468',
  concrete: '#9a978f',
  floor: '#8f8c84',
  asphalt: '#4a4b4d',
  steel: '#6a6e72',
  yellow: '#e0b23a',
  black: '#2b2b2b',
  shutter: '#8c9599',
  office: '#c9c3b5',
  lamp: '#f2ecd0',
  glass: '#9fc8d0',
};

// The shed and its rooms: [x0, z0, x1, z1].
const SHED = [40, 90, 88, 128];
const OFFICE = [40, 90, 48, 102];
const BREAK = [48, 90, 54, 102];
const MEZZ = [40 + T, 90 + T, 57.4, 106];
const APRON = [36, 90, 40, 128];
const BAYS = [108.5, 114, 119.5, 125]; // the dock doors' centers along the west wall (z)
const SHUT = 125; // bay 4's shutter is down

const rooms = [
  { r: SHED, yb: F, yt: TOP },
  { r: OFFICE, yb: F, yt: OC },
  { r: BREAK, yb: F, yt: OC },
];

/** A doorway: on the wall along `axis` at line c, centered at, w wide, from floor y up h. */
const op = (axis, c, at, w, y, h, more = {}) => ({ axis, c, at, w, y, h, ...more });
const door = (axis, c, at, y, w = 1.2, more = {}) =>
  op(axis, c, at, w, y, 2.2, { door: {}, ...more });
const glass = (axis, c, at, w, y, h) => op(axis, c, at, w, y, h, { glass: C.glass });
const OPENINGS = [
  // The dock doors (bay 4's shutter is drawn down outside it).
  ...BAYS.map((z) => op('z', 40, z, 3.2, F, 3.6)),
  // The dock office: a window onto the apron, its door out, a window over the floor.
  glass('z', 40, 94, 2.4, F + 0.9, 1.2),
  door('z', 40, 99, F, 1),
  door('x', 102, 44, F, 1),
  glass('x', 102, 46.4, 2, F + 0.9, 1.2),
  door('z', 48, 94.5, F, 1), // office ↔ break room
  door('x', 102, 51.5, F, 1), // the break room's door
  // The rest of the shell.
  door('z', 88, 112, F, 1.2), // the east staff door
  op('x', 128, 62, 4, F, 4), // the north roll-up, onto the forklift ramp
  door('x', 128, 72, F, 1.2), // the north door
  door('x', 90, 76, F, 1.4), // the south fire exit
];

// ---------------------------------------------------------------------------------------
// Helpers

const out = [];
const add = (name, nodes) => out.push(group(name, nodes));
const P = (id, x, z, y, yaw, colors) =>
  prefab(id, x, z, { ...(yaw ? { yaw } : {}), ...(colors ? { colors } : {}) }, y);

/** A steel rail (solid to movement, 1.05 m) along a line on a floor at y. */
function rail(x0, z0, x1, z1, y) {
  const alongX = Math.abs(z1 - z0) < 1e-6;
  const [a0, a1, b0, b1] = alongX ? [x0, x1, z0 - 0.04, z0 + 0.04] : [x0 - 0.04, x0 + 0.04, z0, z1];
  return [
    box(a0, b0, a1, b1, y + 0.98, y + 1.05, C.yellow),
    box(a0, b0, a1, b1, y + 0.45, y + 0.52, C.yellow, { collide: false }),
    box(a0, b0, a1, b1, y, y + 0.98, C.yellow, { invisible: true }),
  ];
}

/** Steps up to a floor at F: `dir` is the way they climb ('n' | 's' | 'e' | 'w'). */
function steps(x, z, w, dir, color = C.concrete) {
  const yaw = { n: 0, s: 180, e: 90, w: -90 }[dir];
  return { type: 'stairs', pos: [x, 0, z], yaw, size: [w, F, 2.4], steps: 4, color };
}

// ---------------------------------------------------------------------------------------
// The shell

add('shell', [
  // The slab under the shed and the apron, and the truck court before the docks.
  ...union([[36, 89.8, 88.2, 128.2]], [], 0, F, C.concrete),
  box(14, 86, 36, 134, 0, 0.05, C.asphalt),
  // The floor's finish.
  drawn(40.1, 90.1, 87.9, 127.9, F, F + 0.01, C.floor),
  // The roof and its parapet.
  box(39.9, 89.9, 88.1, 128.1, TOP, ROOF, C.roof),
  box(39.9, 89.9, 88.1, 90.1, ROOF, ROOF + 0.8, C.outside),
  box(39.9, 127.9, 88.1, 128.1, ROOF, ROOF + 0.8, C.outside),
  box(39.9, 90.1, 40.1, 127.9, ROOF, ROOF + 0.8, C.outside),
  box(87.9, 90.1, 88.1, 127.9, ROOF, ROOF + 0.8, C.outside),
  // The mezzanine over the office and break room, on posts.
  box(MEZZ[0], MEZZ[1], MEZZ[2], MEZZ[3], OC, M, C.steel),
  ...[
    [57.25, 105.85],
    [57.25, 98],
    [48, 105.85],
  ].map(([x, z]) => box(x - 0.15, z - 0.15, x + 0.15, z + 0.15, F, OC, C.yellow)),
  // Light strips under the roof.
  ...[96, 104, 112, 120].flatMap((z) =>
    [52, 70].map((x) => drawn(x - 7, z - 0.15, x + 7, z + 0.15, TOP - 0.4, TOP - 0.3, C.lamp)),
  ),
]);

add('walls', [
  ...roomWalls({ rooms, openings: OPENINGS, inside: C.inside, outside: C.outside }),
]);

add('dock', [
  // The apron's yellow edge, a bumper and a leveler at each bay, the shutters.
  drawn(36, 90, 36.3, 128, F, F + 0.01, C.yellow),
  ...BAYS.flatMap((z) => [
    drawn(35.85, z - 1.5, 36, z - 1.1, 0.4, 1.1, C.black),
    drawn(35.85, z + 1.1, 36, z + 1.5, 0.4, 1.1, C.black),
    ...(z === SHUT ? [] : [drawn(36.3, z - 1.2, 38.3, z + 1.2, F, F + 0.02, C.steel)]),
    // Rolled up over the open bays; down over bay 4.
    z === SHUT
      ? box(39.8, z - 1.6, 39.9, z + 1.6, F, F + 3.6, C.shutter)
      : drawn(39.6, z - 1.65, 39.9, z + 1.65, F + 3.6, F + 4, C.shutter),
  ]),
  // Steps up at both ends of the apron.
  steps(38, 88.6, 3.6, 'n'),
  steps(38, 129.4, 3.6, 's'),
  // The trucks: a box truck backed up to bay 1 (its rear doors onto the dock), a container
  // truck at bay 3.
  P('openable-truck', 29.6, BAYS[0], 0.45, 90),
  P('container-truck', 31.7, BAYS[2], 0, -90),
  P('shipping-container-closed-doors', 31.7, BAYS[2], 1.26, 90),
  // Wheel chocks at the empty bay, flood lights at the apron's corners.
  drawn(33.2, BAYS[1] - 1.3, 33.6, BAYS[1] - 1, 0.05, 0.3, C.yellow),
  drawn(33.2, BAYS[1] + 1, 33.6, BAYS[1] + 1.3, 0.05, 0.3, C.yellow),
  P('flood-light', 34.8, 89, 0, 135),
  P('flood-light', 34.8, 130, 0, 45),
  // Cover in the truck court.
  P('jersey-barrier', 24, 101, 0.05, 90),
  P('jersey-barrier', 21.5, 122, 0.05, 20),
  P('steel-barrel-pallet-1', 33.5, 96, 0.05),
  P('wood-pallet-boxes', 33.5, 131.5, 0.05),
]);

add('outside', [
  // The east staff door, the north door and the south fire exit, each with steps.
  steps(89.4, 112, 1.6, 'w'),
  steps(72, 129.4, 1.6, 's'),
  steps(76, 88.6, 1.8, 'n'),
  // The forklift ramp up to the north roll-up.
  { type: 'ramp', pos: [62, 0, 133], yaw: 180, size: [4.4, F, 9.6], color: C.concrete },
  drawn(59.8, 128.2, 60, 137.8, 0, F + 0.05, C.yellow),
  drawn(64, 128.2, 64.2, 137.8, 0, F + 0.05, C.yellow),
  // A skip and bins by the east door, barrels by the fire exit.
  P('skip-bin', 91.5, 104, 0, 90),
  P('wheelie-bin', 90, 117, 0, -90),
  P('wheelie-bin', 90, 118.1, 0, -90),
  P('hazard-barrel', 80.5, 88.4, 0),
  P('hazard-barrel-red', 81.3, 88.2, 0),
  P('steel-barrel', 80.8, 87.5, 0),
]);

// ---------------------------------------------------------------------------------------
// Inside

// Six back-to-back rows of racks along x, nine bays each (x 60.5..86.6), one bay left out
// of each row, staggered unevenly, so the cross aisles zigzag. The stocked racks leave a gap
// between their first two levels (1.3..2.0 m) right at eye height, which saw corner to
// corner across the shed (56 m), so each pair has a mesh backing down its spine, solid to
// sight and shots, broken only where its bay is left out.
const RACK_X0 = 61.95;
const ROWS = [94.1, 99.5, 104.9, 110.3, 115.7, 121.1];
const gapOf = (r) => [6, 2, 5, 1, 7, 3][r]; // uneven, so no three gaps line up
const racks = ROWS.flatMap((zc, r) =>
  Array.from({ length: 9 }, (_, i) => i)
    .filter((i) => i !== gapOf(r))
    .flatMap((i) => {
      const x = RACK_X0 + i * 2.9;
      const v = (k) => `warehouse-rack-stocked-${1 + ((r * 9 + i * 3 + k) % 7)}`;
      return [P(v(0), x, zc - 0.6, F), P(v(4), x, zc + 0.6, F, 180)];
    }),
);
const spineX = (i) => RACK_X0 + i * 2.9;
const spines = ROWS.flatMap((zc, r) =>
  [
    [0, gapOf(r) - 1],
    [gapOf(r) + 1, 8],
  ].map(([a, b]) =>
    box(spineX(a) - 1.4, zc - 0.02, spineX(b) + 1.4, zc + 0.02, F, F + 5, '#55595c'),
  ),
);

add('racks', [
  ...racks,
  ...spines,
  // Two-high pallet stacks in the aisles' west mouths, against alternate sides, so lines
  // from the dock wall can't slip down an aisle and out through a gap (they ran 48–52 m).
  ...[96.8, 102.2, 107.6, 113, 118.4].flatMap((z, k) => {
    const zs = z + (k % 2 ? 0.75 : -0.75);
    return [P('stock-wrapped', 59.5, zs, F), P('stock-wrapped', 59.5, zs, F + 1.3, 90)];
  }),
  // Waist cover in the aisles.
  P('forklift', 75, 102.2, F, 90),
  P('stock-wrapped', 82.2, 96.8, F),
  P('stock-cartons', 66, 113, F),
  P('roll-cage', 79.5, 118.4, F, 90),
  P('stock-crate', 70.5, 107.6, F),
  // Pallets along the north wall's lane.
  P('pallet-variation-1', 78, 126.6, F),
  P('pallet-variation-2', 80.4, 126.6, F),
  P('concrete-bag-pallet-1', 85.5, 126.6, F),
  // Floor markings: the walkway along the racks' west end.
  drawn(58.6, 106.2, 58.8, 127.9, F + 0.01, F + 0.02, C.yellow),
]);

add('staging', [
  // Pallets between the dock doors' lanes.
  ...[111.25, 116.75, 122.25].flatMap((z) => [
    P('stock-wrapped', 45.8, z, F),
    P('stock-wrapped', 47.1, z, F),
  ]),
  P('stock-cartons', 52.5, 113.5, F),
  P('stock-crate', 53.8, 113.5, F),
  ...[0, 1, 2].map((k) => P('roll-cage', 52 + k * 0.95, 119.3, F)),
  P('forklift', 51, 125, F),
  // Behind the shut bay.
  P('steel-barrel-pallet-1', 42.2, 125.4, F),
  P('concrete-bag-pallet-1', 44.4, 125.4, F),
  P('wood-pallet-large', 42.2, 108, F),
]);

add('office', [
  // The dock office: a desk at the window over the floor, cabinets, the board.
  P('monitor-desk', 45.5, 101, F, 180),
  P('office-chair', 45.5, 100, F),
  ...[41, 41.6, 42.2].map((x) => P('filing-cabinet', x, 90.45, F)),
  P('water-cooler', 47.5, 90.5, F),
  P('desk', 42.5, 96.5, F, 90),
  P('office-chair', 43.4, 96.5, F, -90),
  // The break room: a table, lockers, a vending machine.
  P('table-and-chairs', 51, 96, F),
  P('locker-bank', 51, 90.4, F),
  P('vending-machine', 53.4, 99.5, F, -90),
]);

add('mezzanine', [
  // The stair up from the floor along the mezzanine's east posts, rising south.
  { type: 'stairs', pos: [56.7, F, 108], yaw: 180, size: [1.4, M - F, 4], sides: 0.9, color: C.steel },
  // Rails round its open edges (the stair's top left open).
  ...rail(40.1, 106, 56, 106, M),
  ...rail(57.4, 90.1, 57.4, 106, M),
  // Storage: crates and cartons as cover, lockers, a desk.
  P('stock-crate', 43, 104, M),
  P('stock-crate', 44.3, 104, M),
  P('stock-cartons', 43.6, 102.6, M),
  P('stock-wrapped', 50, 94, M),
  P('stock-wrapped', 51.3, 94, M),
  P('stock-cartons', 50.6, 95.4, M),
  P('locker-bank', 41.5, 90.4, M),
  P('desk', 54.5, 100, M, 90),
  P('office-chair', 55.4, 100, M, -90),
  P('roll-cage', 46, 92, M),
]);

// The cans: container stacks north of the shed.
const can = (x, z, yaw, y = 0, id = 'shipping-container-closed-doors') => P(id, x, z, y, yaw);
add('cans', [
  can(50, 142, 90),
  can(50, 142, 90, 2.8, 'shipping-container-closed-end'),
  can(60, 147, 15),
  can(70, 141, 90),
  can(70, 146, 90),
  can(70, 146, 90, 2.8, 'shipping-container-closed-end'),
  can(82, 150, -10),
  can(54, 156, 90, 0, 'shipping-container-open-no-doors'),
  can(70, 158, 90),
  P('forklift', 77, 140, 0, 90),
  P('hazard-barrel', 62.5, 157, 0),
  P('steel-barrel', 63.3, 157.4, 0),
]);

// ---------------------------------------------------------------------------------------
// Into the map

const map = JSON.parse(readFileSync(FILE, 'utf8'));
const replaced = (n) => n.type === 'group' && n.name === 'warehouse';
const gone = map.nodes.filter(replaced);
map.nodes = [...map.nodes.filter((n) => !replaced(n)), group('warehouse', out)];

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(`warehouse: ${count(out)} nodes in ${out.length} groups; replaced ${gone.length}`);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
