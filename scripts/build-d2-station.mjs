// d2's train station (2026-11-16, the user's request: "add the train station to d2 at the
// train-station-here cube"; the tracks east–west on flat ground, the user's pick). District's
// station brief (district.md → The rail platform and the train extract) on d2's ground: a
// branch terminus whose line runs east off the map. Written into content/maps/d2.json as one
// group named `station`, in its own frame (origin the cube, at the hall's middle; x east, z
// south), so the user can move or turn the group and a re-run keeps it there. Re-runnable:
// it replaces its own group and the cube, nothing else.
//
// Plan (docs/design/maps/d2.md → The train station has the why):
// - The hall (36 × 16 m) over the cube, its doors north onto the forecourt, its south side
//   onto platform 1. Ground (1.0, platform height): the waiting room west, the ticket hall
//   (double height, a switchback up to a gallery), the ticket office and parcels room east.
//   Upper (6.2): staff room and station master's office west, the control room and records
//   east, joined by the gallery.
// - Platform 1 along the hall, track 1, an island platform 2, track 2. 84 m platforms with
//   canopies, ramps down at both ends (the AI's way on and off). A covered footbridge from
//   the gallery over platform 1 and track 1 lands on the island, with a stair down.
// - The stalled evacuation train on track 2: three walk-in coaches and the locomotive,
//   nose east. A boxcar on track 1 and a container flatcar east of the platforms.
// - The goods shed at track 2's west end (its buffer inside), a dock along its north wall;
//   the signal box south of track 2 at the platforms' east end. Track 1 ends at a buffer
//   short of the shed.
// - No loot (loot comes last). No extraction yet: the user places them (the train extract,
//   powered from the substation, is District's idea and still open).
//
// Usage: node scripts/build-d2-station.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { along, box, drawn, group, prefab, keptPlace, swapIn, r2 } from './mapkit/nodes.mjs';
import { roomWalls, union } from './mapkit/rooms.mjs';
import { stairRun } from './mapkit/runs.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');
const HERE = { pos: [265, 0, 225.5] }; // the user's cube

// Levels.
const G = 1.0; // platforms and the hall's ground floor
const U = 6.2; // the hall's upper floor
const TOP = 10.4; // under the hall's roof
const T = 0.1;

const C = {
  brick: '#9a5a44',
  brickDark: '#7d4636',
  inside: '#d8d0bf',
  concrete: '#9a978f',
  platform: '#a8a49a',
  edge: '#e0c23a',
  asphalt: '#4a4b4d',
  roof: '#4d5257',
  canopy: '#5f6e78',
  steel: '#555a5f',
  glass: '#9fc8d0',
  lamp: '#f2ecd0',
  sign: '#2f4a6b',
  white: '#e8e2d2',
  floor: '#8f8a80',
  tile: '#b8b0a0',
  timber: '#6e5a44',
  shed: '#7f8a8f',
};

// Tracks and platforms (z of track centers; a platform edge stands 1.65 m off a track's
// middle, just clear of its 3.2 m bed).
const T1 = 15.7;
const T2 = 27.0;
const P0 = -42; // the platforms' west and east ends
const P1 = 42;
const PLAT1 = [P0, 8.1, P1, T1 - 1.65];
const PLAT2 = [P0, T1 + 1.65, P1, T2 - 1.65];
const ISLAND_Z = (PLAT2[1] + PLAT2[3]) / 2;
const EAST = 133; // the tracks run to the map's east edge (world x 398)

// The hall and its rooms: [x0, z0, x1, z1].
const HALL = [-18, -8, 18, 8];
const R = {
  waiting: { r: [-18, -8, -6, 8], yb: G, yt: U },
  tickets: { r: [-6, -8, 6, 8], yb: G, yt: TOP },
  office: { r: [6, -8, 18, 0], yb: G, yt: U },
  parcels: { r: [6, 0, 18, 8], yb: G, yt: U },
  staff: { r: [-18, -8, -6, 0], yb: U, yt: TOP },
  master: { r: [-18, 0, -6, 8], yb: U, yt: TOP },
  control: { r: [6, -8, 18, 2], yb: U, yt: TOP },
  records: { r: [6, 2, 18, 8], yb: U, yt: TOP },
};
const GALLERY = [-6 + T, 4, 6 - T, 8 - T];
// The ticket hall's switchback: its foot at the gallery's edge, climbing north, turning
// back west onto the gallery.
const STAIR = { x: 5.0, z: 4.0, width: 1.6 };

// The footbridge: from the gallery over platform 1 and track 1 to a landing on the island.
const BRIDGE = [-1.6, 8.1, 1.6, 23.2];
const BRIDGE_TOP = U + 2.7;
// The island's stair: from the bridge's east side down along +x.
const ISTAIR = { width: 2.0, z: ISLAND_Z };

// The goods shed and the signal box.
const SHED = [-96, 20, -68, 34];
const SHED_TOP = 7;
const DOCK = [SHED[0] + T, SHED[1] + T, -71, T2 - 1.65];
const SBOX = [46, 31, 52, 36];
const SB_U = 3.4; // the signal box's upper floor
const SB_TOP = 6.2;

// ---------------------------------------------------------------------------------------
// Helpers

const out = [];
const add = (name, nodes) => out.push(group(name, nodes));
const P = (id, x, z, y, yaw, extra) => prefab(id, x, z, { ...(yaw ? { yaw } : {}), ...extra }, y);
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

/** Track pieces (the 6 m `track` prefab) along x at z from x0 to x1, butted end to end. */
function trackRun(x0, x1, z) {
  const n = Math.ceil((x1 - x0) / 6 - 0.01);
  return Array.from({ length: n }, (_, k) => P('track', Math.min(x0 + k * 6 + 3, x1 - 3), z, 0));
}

/** A square post from y0 to y1. */
const post = (x, z, y0, y1, w = 0.3, color = C.steel) =>
  box(x - w / 2, z - w / 2, x + w / 2, z + w / 2, y0, y1, color);

/** A hanging station sign (drawn): a blue board with white lettering lines, along x. */
const sign = (x, z, y, w = 2.4) => [
  drawn(x - w / 2, z - 0.04, x + w / 2, z + 0.04, y, y + 0.5, C.sign),
  drawn(x - w / 2 + 0.25, z - 0.05, x + w / 2 - 0.25, z + 0.05, y + 0.2, y + 0.3, C.white),
];

// ---------------------------------------------------------------------------------------
// The hall

const rooms = Object.values(R);
const OPENINGS = [
  // North front: the main doorway, windows either side, clerestories over the doors.
  op('x', -8, 0, 3.6, G, 3.2),
  glass('x', -8, -3.8, 1.6, G + 4, 3.6),
  glass('x', -8, 3.8, 1.6, G + 4, 3.6),
  glass('x', -8, -15, 2, G + 0.9, 1.6),
  glass('x', -8, -9.5, 2, G + 0.9, 1.6),
  glass('x', -8, 10, 2, G + 0.9, 1.6),
  glass('x', -8, 15, 2, G + 0.9, 1.6),
  glass('x', -8, -15, 2, U + 0.9, 1.6),
  glass('x', -8, -9.5, 2, U + 0.9, 1.6),
  glass('x', -8, 10, 2, U + 0.9, 1.6),
  glass('x', -8, 15, 2, U + 0.9, 1.6),
  // South, onto platform 1: the ticket hall's way through (west of the bridge's door), the
  // waiting room's door and windows, the parcels room's wide door; the bridge's doorway.
  op('x', 8, -3.6, 3.6, G, 3.2),
  op('x', 8, 0, 2.6, U, 2.4),
  door('x', 8, -12, G, 1.6),
  glass('x', 8, -16, 2, G + 0.9, 1.6),
  glass('x', 8, -8.4, 2, G + 0.9, 1.6),
  op('x', 8, 12, 2.2, G, 2.6),
  glass('x', 8, 16, 1.6, G + 0.9, 1.6),
  glass('x', 8, -14, 2, U + 0.9, 1.6),
  glass('x', 8, -9, 2, U + 0.9, 1.6),
  glass('x', 8, 10, 2, U + 0.9, 1.6),
  glass('x', 8, 15, 2, U + 0.9, 1.6),
  // Ends: a side door west into the waiting room, windows.
  door('z', -18, 3, G, 1.2),
  glass('z', -18, -4, 2, G + 0.9, 1.6),
  glass('z', -18, -4, 2, U + 0.9, 1.6),
  glass('z', -18, 4, 2, U + 0.9, 1.6),
  glass('z', 18, -4, 2, G + 0.9, 1.6),
  glass('z', 18, 4, 2, G + 0.9, 1.6),
  glass('z', 18, -3, 2, U + 0.9, 1.6),
  glass('z', 18, 5, 2, U + 0.9, 1.6),
  // Inside, ground: waiting room ↔ ticket hall, the ticket window, office ↔ parcels.
  op('z', -6, -3, 2.4, G, 2.6),
  glass('z', 6, -5, 2.2, G + 1.0, 1.1),
  door('x', 0, 15, G, 1),
  // Inside, upper: the gallery into the master's office and the records room, through to
  // the staff room and the control room.
  door('z', -6, 6, U, 1.2),
  door('z', 6, 6, U, 1.2),
  door('x', 0, -12, U, 1),
  door('x', 2, 12, U, 1),
];

add('hall shell', [
  // The plinth (the ground floor is at platform height), its finish, the steps up.
  box(HALL[0] - T, HALL[1] - T, HALL[2] + T, HALL[3] + T, 0, G, C.concrete),
  drawn(HALL[0] + T, HALL[1] + T, HALL[2] - T, HALL[3] - T, G, G + 0.01, C.tile),
  { type: 'stairs', pos: [0, 0.04, -9.35], size: [8, G - 0.04, 2.5], steps: 5, color: C.concrete },
  // The west side door's steps.
  {
    type: 'stairs',
    pos: [-19.35, 0, 3],
    yaw: 90,
    size: [1.6, G, 2.5],
    steps: 5,
    color: C.concrete,
  },
  // The upper floor: the wings stop at the ticket hall's walls (they run up through it).
  ...union([[-18, -8, -6 - T, 8]], [], U - 0.2, U, C.floor),
  ...union([[6 + T, -8, 18, 8]], [], U - 0.2, U, C.floor),
  ...union([GALLERY], [], U - 0.2, U, C.floor),
  // The roof, a parapet, and a clock gable over the doors.
  ...union([[HALL[0] - T, HALL[1] - T, HALL[2] + T, HALL[3] + T]], [], TOP, TOP + 0.2, C.roof),
  box(HALL[0] - T, HALL[1] - T, HALL[2] + T, HALL[1] + T, TOP + 0.2, TOP + 1, C.brickDark),
  box(HALL[0] - T, HALL[3] - T, HALL[2] + T, HALL[3] + T, TOP + 0.2, TOP + 1, C.brickDark),
  box(HALL[0] - T, HALL[1] + T, HALL[0] + T, HALL[3] - T, TOP + 0.2, TOP + 1, C.brickDark),
  box(HALL[2] - T, HALL[1] + T, HALL[2] + T, HALL[3] - T, TOP + 0.2, TOP + 1, C.brickDark),
  box(-4, HALL[1] - T, 4, HALL[1] + T, TOP + 1, TOP + 3, C.brickDark),
  drawn(-1, HALL[1] - T - 0.06, 1, HALL[1] - T, TOP + 1.1, TOP + 2.9, C.white),
  drawn(-0.05, HALL[1] - T - 0.08, 0.05, HALL[1] - T - 0.06, TOP + 2, TOP + 2.7, C.sign),
  drawn(-0.05, HALL[1] - T - 0.08, 0.6, HALL[1] - T - 0.06, TOP + 1.95, TOP + 2.05, C.sign),
  // A stone band at the upper floor, a sign over the doors.
  drawn(
    HALL[0] - T - 0.04,
    HALL[1] - T - 0.04,
    HALL[2] + T + 0.04,
    HALL[1] - T,
    U - 0.3,
    U,
    C.white,
  ),
  drawn(
    HALL[0] - T - 0.04,
    HALL[3] + T,
    HALL[2] + T + 0.04,
    HALL[3] + T + 0.04,
    U - 0.3,
    U,
    C.white,
  ),
  drawn(-3.5, HALL[1] - T - 0.08, 3.5, HALL[1] - T - 0.04, G + 3.4, G + 4, C.sign),
  drawn(-3, HALL[1] - T - 0.1, 3, HALL[1] - T - 0.08, G + 3.6, G + 3.8, C.white),
  // Light strips under the ticket hall's roof.
  ...[-4, 0].map((z) => drawn(-4, z - 0.15, 4, z + 0.15, TOP - 0.4, TOP - 0.3, C.lamp)),
]);

add('hall walls', roomWalls({ rooms, openings: OPENINGS, inside: C.inside, outside: C.brick }));

// The ticket hall's switchback up to the gallery, walled on its open side.
const hallStair = stairRun({
  id: 'station-hall-stair',
  x: STAIR.x,
  z: STAIR.z,
  y: G,
  yaw: 180,
  rise: U - G,
  width: STAIR.width,
  turn: 'right',
  base: 0,
  color: C.concrete,
});
const STAIR_W = STAIR.x - STAIR.width / 2 - 0.2 - STAIR.width; // the second flight's west edge
add('ticket hall', [
  hallStair.node,
  box(STAIR_W - 0.1, -1.7, STAIR_W, STAIR.z, G, U + 1.05, C.inside),
  // A wall between the two flights, so the upper one doesn't drop onto the lower.
  box(
    STAIR_W + STAIR.width + 0.05,
    -0.16,
    STAIR_W + STAIR.width + 0.15,
    STAIR.z - 0.05,
    G,
    U + 1.05,
    C.inside,
  ),
  // The gallery's edge rails: west of the stair, and over the first flight's foot.
  ...rail(GALLERY[0], 4, STAIR_W - 0.1, 4, U),
  ...rail(STAIR.x - STAIR.width / 2 - 0.2, 4, GALLERY[2], 4, U),
  // An information kiosk in the middle (it breaks the line from the doors to the platform),
  // ticket machines by the waiting room, benches under the gallery.
  P('kiosk-booth', -1.8, -1.6, G),
  ...[-6.6, -5.4].map((z) => P('ticket-machine', -5.55, z, G, 90)),
  P('ticket-machine', -5.55, 1.2, G, 90),
  P('mall-bench', 1.2, 7.3, G, 180),
  P('potted-plant', 4.8, -7.3, G),
  // The departure board over the way through, a clock.
  drawn(-5.6, 7.75, -1.6, 7.85, G + 3.4, G + 4.6, '#1f2328'),
  ...[0, 1, 2, 3].map((k) =>
    drawn(-5.3, 7.72, -1.9, 7.75, G + 4.35 - k * 0.25, G + 4.43 - k * 0.25, '#e8b23a'),
  ),
  // Gallery benches, a plant.
  P('mall-bench', -3, 7.5, U, 180),
  P('potted-plant', -5.2, 4.7, U),
]);

add('hall rooms', [
  // Waiting room: back-to-back benches, vending machines across the middle, carts.
  ...[-15.5, -12.5].flatMap((x) => [
    P('mall-bench', x, -5.3, G),
    P('mall-bench', x, -4.7, G, 180),
    P('mall-bench', x, 4.7, G),
    P('mall-bench', x, 5.3, G, 180),
  ]),
  P('vending-machine', -12, -0.4, G, 180),
  P('vending-machine', -13.05, -0.4, G, 180),
  P('vending-machine', -12, 0.4, G),
  P('luggage-cart', -8, 5.5, G, 30),
  P('notice-board', -17.88, -1, G + 1.2, 90),
  P('potted-plant', -17.2, 7.2, G),
  // Ticket office: the counter at the window, desks, cabinets.
  P('monitor-desk', 7.3, -5, G, 90),
  P('office-chair', 8.2, -5, G, -90),
  P('desk', 13, -6.8, G, 180),
  P('office-chair', 13, -6, G),
  ...[9.5, 10.1, 10.7].map((x) => P('filing-cabinet', x, -7.55, G)),
  P('water-cooler', 17.6, -1, G),
  // Parcels: shelving, roll cages, carts.
  ...[1.5, 2.8].map((z) => P('metal-shelving', 17.6, z, G, -90)),
  ...[7.6, 8.6].map((x) => P('roll-cage', x, 1.2, G)),
  P('luggage-cart', 11, 4, G, 90),
  P('stock-cartons', 15.5, 6.6, G),
  P('stock-crate', 7.4, 6.8, G),
  // Staff room: a table, lockers, a kitchen.
  P('table-and-chairs', -12, -4, U, 90),
  P('locker-bank', -16, -7.6, U),
  P('kitchen-run', -8, -7.55, U),
  P('fridge-v2', -6.85, -6, U, -90),
  // The station master's office.
  P('desk', -14, 4, U, 180),
  P('office-chair', -14, 4.8, U),
  P('couch', -9, 7.4, U, 180),
  ...[-17.55].flatMap((x) => [2.2, 2.8, 3.4].map((z) => P('filing-cabinet', x, z, U, 90))),
  // Control room: desks under the windows, racks, the CCTV wall.
  P('monitor-desk', 12, -7.3, U, 180),
  P('monitor-desk', 17.4, -3.5, U, -90),
  P('ops-table', 11, -2.5, U),
  ...[7, 7.8].map((x) => P('server-rack', x, 1.4, U, 180)),
  P('cctv-wall', 6.1, -4, U + 1.2, 90),
  // Records: shelving rows.
  ...[3.2, 6.2].map((z) => P('bookcase-tall', 14.5, z, U)),
  P('bookcase-tall', 14.5, 3.75, U, 180),
  ...[7.5, 8.1].map((x) => P('filing-cabinet', x, 7.55, U, 180)),
]);

// ---------------------------------------------------------------------------------------
// Platforms

const canopyPosts1 = [-38, -30, -22, -14, -6, 6, 14, 22, 30, 38];
const canopyPosts2 = [-36, -28, -12, -4, 20, 28, 36];
const ISTAIR_HOLE = [
  1.8,
  ISTAIR.z - ISTAIR.width / 2 - 0.25,
  11.8,
  ISTAIR.z + ISTAIR.width / 2 + 0.25,
];
add('platforms', [
  // The two platforms, their yellow edges, ramps down at both ends.
  box(...PLAT1.slice(0, 2), ...PLAT1.slice(2), 0, G, C.platform),
  box(...PLAT2.slice(0, 2), ...PLAT2.slice(2), 0, G, C.platform),
  drawn(P0, PLAT1[3] - 0.5, P1, PLAT1[3] - 0.3, G, G + 0.01, C.edge),
  drawn(P0, PLAT2[1] + 0.3, P1, PLAT2[1] + 0.5, G, G + 0.01, C.edge),
  drawn(P0, PLAT2[3] - 0.5, P1, PLAT2[3] - 0.3, G, G + 0.01, C.edge),
  ...[PLAT1, PLAT2].flatMap((p) => {
    const w = r2(p[3] - p[1]);
    const z = r2((p[1] + p[3]) / 2);
    return [
      { type: 'ramp', pos: [P0 - 3, 0, z], yaw: 90, size: [w, G, 6], color: C.platform },
      { type: 'ramp', pos: [P1 + 3, 0, z], yaw: -90, size: [w, G, 6], color: C.platform },
    ];
  }),
  // Platform 1's canopy, cantilevered off posts along its south side; holes for the bridge.
  ...union(
    [[P0, 8.12, P1, PLAT1[3] - 0.4]],
    [[-1.8, 8.12, 1.8, PLAT1[3] - 0.4]],
    4.4,
    4.55,
    C.canopy,
    { collide: false },
  ),
  ...canopyPosts1.map((x) => post(x, PLAT1[3] - 1.0, G, 4.4, 0.25)),
  ...canopyPosts1.map((x) => drawn(x - 3, PLAT1[3] - 2.6, x + 3, PLAT1[3] - 2.4, 4.3, 4.4, C.lamp)),
  // The island's canopy, on posts down its middle; holes for the bridge and its stair.
  ...union(
    [[P0, PLAT2[1] + 0.4, P1, PLAT2[3] - 0.4]],
    [[-1.8, PLAT2[1] + 0.4, 1.8, PLAT2[3] - 0.4], ISTAIR_HOLE],
    4.4,
    4.55,
    C.canopy,
    { collide: false },
  ),
  ...canopyPosts2.map((x) => post(x, ISLAND_Z, G, 4.4, 0.25)),
  ...canopyPosts2.map((x) => drawn(x - 3, ISLAND_Z - 0.1, x + 3, ISLAND_Z + 0.1, 4.3, 4.4, C.lamp)),
  // Station signs under the canopies.
  ...[-30, 26].flatMap((x) => sign(x, PLAT1[3] - 1.0, 3.2)),
  ...[-24, 32].flatMap((x) => sign(x, ISLAND_Z, 3.2, 2.0)),
  // Fences along platform 1's north edge outside the hall, a gap at each end.
  ...Array.from({ length: 6 }, (_, k) => P('steel-bar-fence', -19.7 - k * 3.2, 8.3, G)),
  ...Array.from({ length: 6 }, (_, k) => P('steel-bar-fence', 19.7 + k * 3.2, 8.3, G)),
]);

// Platform furniture: tall things against alternate edges, so no line runs a platform's
// length; benches between.
add('platform furniture', [
  // Platform 1.
  P('ad-shelter', -35, 9.6, G),
  P('vending-machine', -26, PLAT1[3] - 1.6, G, 180),
  P('vending-machine', -25, PLAT1[3] - 1.6, G, 180),
  P('mall-bench', -18, PLAT1[3] - 1.7, G),
  P('ticket-machine', -9.5, 9.0, G),
  P('ticket-machine', -8.6, 9.0, G),
  P('luggage-cart', 4.4, PLAT1[3] - 1.7, G, 80),
  P('luggage-cart', 7.8, PLAT1[3] - 1.5, G, 95),
  P('mall-bench', 18, PLAT1[3] - 1.7, G),
  P('vending-machine', 24, 9.0, G),
  P('ad-shelter', 34, PLAT1[3] - 1.8, G, 180),
  P('wheelie-bin', -40.5, 9.2, G),
  P('wheelie-bin', 40.5, 9.2, G),
  // Platform 2.
  P('ad-shelter', -34, PLAT2[3] - 1.6, G, 180),
  P('kiosk-booth', -20, ISLAND_Z, G),
  P('mall-bench', -8, PLAT2[1] + 1.4, G),
  P('vending-machine', -6.5, PLAT2[3] - 1.5, G, 180),
  P('luggage-cart', 16, PLAT2[1] + 1.5, G, 85),
  P('ad-shelter', 26, PLAT2[1] + 1.6, G),
  P('vending-machine', 36, PLAT2[3] - 1.5, G, 180),
  P('vending-machine', 37, PLAT2[3] - 1.5, G, 180),
  P('mall-bench', 31, PLAT2[3] - 1.6, G),
]);

// ---------------------------------------------------------------------------------------
// The footbridge: a covered deck at the upper floor, glazed sides, a landing on the island
// and a stair down its middle eastward.

const islandStair = stairRun({
  id: 'station-island-stair',
  x: BRIDGE[2] + 9.82,
  z: ISTAIR.z,
  y: G,
  yaw: -90,
  rise: U - G,
  width: ISTAIR.width,
  sides: 1,
  base: 0,
  color: C.concrete,
});
/**
 * The island stair's balustrades: stepped invisible boxes 1.05 m over the flights (so
 * nobody steps off its open sides; shots and sight pass), a drawn handrail over them.
 */
function islandBalustrades() {
  const x0 = BRIDGE[2]; // the top
  const x1 = BRIDGE[2] + 9.82; // the foot
  const run = 4.16;
  const h = (x) => {
    const d = x1 - x; // along the climb from the foot
    if (d <= run) return G + (2.6 * d) / run;
    if (d <= run + 1.5) return G + 2.6;
    return G + 2.6 + (2.6 * Math.min(d - run - 1.5, run)) / run;
  };
  const nodes = [];
  for (const zs of [-1, 1]) {
    const z = ISTAIR.z + zs * (ISTAIR.width / 2 + 0.05);
    for (let x = x0; x < x1 - 1e-6; x += 0.98) {
      const xe = Math.min(x + 0.98, x1);
      nodes.push(box(x, z - 0.04, xe, z + 0.04, G, h(x) + 1.05, C.steel, { invisible: true }));
    }
    const pts = [x1, x1 - run, x1 - run - 1.5, x0].map((x) => [x, h(x) + 1.0, z]);
    for (let k = 0; k < 3; k++) nodes.push(along(pts[k], pts[k + 1], 0.06, 0.06, C.steel));
    for (const x of [x1 - 0.1, x1 - run, x1 - run - 1.5, x0 + 0.1])
      nodes.push(drawn(x - 0.03, z - 0.03, x + 0.03, z + 0.03, h(x), h(x) + 1.0, C.steel));
  }
  return nodes;
}

/** A bridge side (a wall along z at x) with glazing between posts and a doorway at `gap`. */
function bridgeSide(x, gap) {
  const len = BRIDGE[3] - BRIDGE[1];
  const mid = (BRIDGE[1] + BRIDGE[3]) / 2;
  const openings = [];
  for (let z = BRIDGE[1] + 1.4; z < BRIDGE[3] - 1; z += 2.4)
    if (!gap || Math.abs(z - gap) > 2.4)
      openings.push({ along: r2(mid - z), width: 2, bottom: 1.1, top: 2.3, glass: C.glass });
  if (gap) openings.push({ along: r2(mid - gap), width: ISTAIR.width + 0.1, bottom: 0, top: 2.3 });
  return {
    type: 'wall',
    pos: [x, U, r2(mid)],
    yaw: 90,
    size: [r2(len), 2.7, 0.2],
    color: C.canopy,
    openings,
  };
}
add('footbridge', [
  box(BRIDGE[0], BRIDGE[1], BRIDGE[2], BRIDGE[3], U - 0.25, U, C.concrete),
  bridgeSide(BRIDGE[0] + T, 0),
  bridgeSide(BRIDGE[2] - T, ISTAIR.z),
  {
    type: 'wall',
    pos: [0, U, BRIDGE[3] - T],
    size: [r2(BRIDGE[2] - BRIDGE[0] - 0.4), 2.7, 0.2],
    color: C.canopy,
    openings: [{ along: 0, width: 2, bottom: 1.1, top: 2.3, glass: C.glass }],
  },
  box(
    BRIDGE[0] - 0.15,
    BRIDGE[1],
    BRIDGE[2] + 0.15,
    BRIDGE[3] + 0.15,
    BRIDGE_TOP,
    BRIDGE_TOP + 0.2,
    C.roof,
  ),
  // Its legs: on platform 1 and the island.
  ...[-1.3, 1.3].flatMap((x) => [
    post(x, 12.6, G, U - 0.25, 0.4),
    post(x, PLAT2[1] + 1.2, G, U - 0.25, 0.4),
  ]),
  drawn(-1.5, 8.12, 1.5, BRIDGE[3], U + 2.5, U + 2.6, C.lamp, { collide: false }),
  islandStair.node,
  ...islandBalustrades(),
]);

// ---------------------------------------------------------------------------------------
// Tracks and trains

const coach = (x, extra) => P('passenger-coach', x, T2, 0, 0, extra);
add('tracks', [
  ...trackRun(-46, EAST, T1),
  ...trackRun(SHED[0] + 4, EAST, T2),
  P('buffer-stop', -43.5, T1, 0, 180),
  P('buffer-stop', SHED[0] + 6.5, T2, 0, 180),
  P('rail-signal', 52, T1 - 2.4, 0, -90),
  P('rail-signal', 52, T2 + 2.4, 0, -90),
  P('rail-signal', SHED[2] + 4, T2 + 2.4, 0, 90),
]);

add('train', [
  // The evacuation train on track 2: three coaches and the loco, nose east, one coach's
  // livery faded.
  coach(-31.5),
  coach(-10.5, { colors: { body: '#4c6f5d', 'body-dark': '#3a5849' } }),
  coach(10.5),
  P('diesel-loco', 31.3, T2, 0),
  // A boxcar left on track 1 (cover across the trackbed), a container flatcar east.
  P('boxcar', -28, T1, 0, 0, { colors: { body: '#5a5f4a', 'body-dark': '#454a39' } }),
  P('flatcar', 64, T1, 0),
  P('shipping-container-sealed', 64, T1, 1.45, 90),
  // A boxcar between the platforms and the shed.
  P('boxcar', -56, T2, 0),
]);

// ---------------------------------------------------------------------------------------
// The goods shed: track 2 runs in through its east portal to the buffer; a dock along the
// north wall, a goods door onto the yard north up a ramp.

add('goods shed', [
  // The dock (platform height), its edge, steps down to the track at its east end.
  box(...DOCK.slice(0, 2), ...DOCK.slice(2), 0, G, C.concrete),
  drawn(DOCK[0], DOCK[3] - 0.4, DOCK[2], DOCK[3] - 0.2, G, G + 0.01, C.edge),
  {
    type: 'stairs',
    pos: [-70, 0, r2((DOCK[1] + DOCK[3]) / 2)],
    yaw: -90,
    size: [r2(DOCK[3] - DOCK[1]), G, 2],
    steps: 4,
    color: C.concrete,
  },
  // The roof, its light strips.
  ...union(
    [[SHED[0] - T, SHED[1] - T, SHED[2] + T, SHED[3] + T]],
    [],
    SHED_TOP,
    SHED_TOP + 0.2,
    C.roof,
  ),
  ...[-89, -75].map((x) =>
    drawn(x - 5, 27 - 0.15, x + 5, 27 + 0.15, SHED_TOP - 0.4, SHED_TOP - 0.3, C.lamp),
  ),
  ...roomWalls({
    rooms: [{ r: SHED, yb: 0, yt: SHED_TOP }],
    openings: [
      op('z', SHED[2], T2, 5, 0, 5.4), // the track's portal
      op('x', SHED[1], -82, 3.6, G, 3.4), // the goods door off the dock
      door('z', SHED[0], 31, 0, 1.2),
      door('x', SHED[3], -80, 0, 1.2),
      glass('x', SHED[1], -91, 2.4, G + 1.4, 1.2),
      glass('x', SHED[1], -73, 2.4, G + 1.4, 1.2),
    ],
    inside: C.inside,
    outside: C.shed,
  }),
  // The goods door's ramp up from the yard, rolled-up shutter.
  { type: 'ramp', pos: [-82, 0, SHED[1] - 0.1 - 3], size: [3.8, G, 6], color: C.concrete },
  drawn(-83.9, SHED[1] - 0.4, -80.1, SHED[1] - 0.1, G + 3.4, G + 3.8, C.steel),
  // On the dock: pallets, crates, cages, a forklift.
  P('wood-pallet-boxes', -93, 22.2, G),
  P('wood-pallet-boxes', -93, 23.6, G),
  P('stock-crate', -88, 22, G),
  P('stock-crate', -86.7, 22, G),
  P('stock-cartons', -87.4, 23.6, G),
  P('forklift', -77, 22.8, G, 90),
  ...[0, 1, 2].map((k) => P('roll-cage', -92.5 + k * 0.95, 24.8, G)),
  P('stock-wrapped', -84, 24.3, G),
  // South of the track: barrels and pallets on the floor.
  P('steel-barrel-pallet-1', -92, 31.5, 0),
  P('wood-pallet-large', -84, 32.2, 0),
  P('stock-crate', -74, 32.5, 0),
  P('stock-crate', -74, 31.2, 0, 90),
]);

// ---------------------------------------------------------------------------------------
// The signal box: a brick base (the relay room) and a glazed cab upstairs, an outside stair
// up its south side. It looks down the platforms.

const SB_STAIR_TOP = SBOX[0] + 1.2;
add('signal box', [
  box(SBOX[0] - T, SBOX[1] - T, SBOX[2] + T, SBOX[3] + T, 0, 0.2, C.concrete),
  box(SBOX[0] + T, SBOX[1] + T, SBOX[2] - T, SBOX[3] - T, SB_U - 0.2, SB_U, C.floor),
  box(SBOX[0] - 0.4, SBOX[1] - 0.4, SBOX[2] + 0.4, SBOX[3] + 0.4, SB_TOP, SB_TOP + 0.2, C.roof),
  ...roomWalls({
    rooms: [
      { r: SBOX, yb: 0.2, yt: SB_U },
      { r: SBOX, yb: SB_U, yt: SB_TOP },
    ],
    openings: [
      door('z', SBOX[0], 33.5, 0.2, 1.1),
      glass('x', SBOX[1], 49, 4.6, SB_U + 0.9, 1.6),
      glass('z', SBOX[0], 33, 2.4, SB_U + 0.9, 1.6),
      glass('z', SBOX[2], 33.5, 3.4, SB_U + 0.9, 1.6),
      door('x', SBOX[3], SBOX[0] + 0.7, SB_U, 0.9),
      glass('x', SBOX[3], 50, 2.6, SB_U + 0.9, 1.6),
    ],
    inside: C.inside,
    outside: C.brick,
  }),
  // The stair, a landing at its top before the cab's door.
  {
    type: 'stairs',
    pos: [r2((SB_STAIR_TOP + SBOX[2] + 0.6) / 2), 0, SBOX[3] + T + 0.6],
    yaw: -90,
    size: [1.2, SB_U, r2(SBOX[2] + 0.6 - SB_STAIR_TOP)],
    sides: 0.9,
    color: C.concrete,
  },
  box(SBOX[0] - 0.1, SBOX[3] + T, SB_STAIR_TOP, SBOX[3] + T + 1.2, 0, SB_U, C.concrete),
  ...rail(SBOX[0] - 0.1, SBOX[3] + T + 1.2, SB_STAIR_TOP, SBOX[3] + T + 1.2, SB_U),
  ...rail(SBOX[0] - 0.1, SBOX[3] + T, SBOX[0] - 0.1, SBOX[3] + T + 1.2, SB_U),
  // The cab: the lever frame along the north windows, a desk, a panel.
  box(SBOX[0] + 0.6, SBOX[1] + 0.5, SBOX[2] - 0.6, SBOX[1] + 1.1, SB_U, SB_U + 0.9, C.timber),
  ...Array.from({ length: 12 }, (_, k) =>
    drawn(
      SBOX[0] + 0.9 + k * 0.38,
      SBOX[1] + 0.75,
      SBOX[0] + 0.95 + k * 0.38,
      SBOX[1] + 0.85,
      SB_U + 0.9,
      SB_U + 1.6,
      k % 3 ? '#b8342c' : '#e8e2d2',
    ),
  ),
  P('desk', 50.6, 34.9, SB_U, 180),
  P('office-chair', 50.6, 34.1, SB_U),
  // The relay room: racks.
  ...[47, 47.8].map((x) => P('server-rack', x, SBOX[1] + 0.55, 0.2)),
  P('electrical-panel', SBOX[2] - T, 33.5, 1.1, -90),
]);

// ---------------------------------------------------------------------------------------
// The forecourt: asphalt before the hall, a military checkpoint at the doors (the
// evacuation), a bus stop, parked cars, lamps.

add('forecourt', [
  box(-34, -38, 34, HALL[1] - T, 0, 0.04, C.asphalt),
  drawn(-30, -27.6, 30, -27.4, 0.04, 0.05, C.white),
  // The checkpoint: sandbags in a chicane before the steps, barrier blocks, a tent.
  P('sandbag-wall', -5, -13, 0.04),
  P('sandbag-wall', 3.5, -15.5, 0.04),
  P('barrier-block', -9.5, -16, 0.04),
  P('barrier-block', 8.5, -12.5, 0.04),
  P('tent-shelter', 15, -15, 0.04, 180),
  P('jersey-barrier', -16, -20, 0.04, 20),
  P('jersey-barrier', 22, -22, 0.04, -15),
  P('boom-barrier', 0, -32, 0.04),
  // The bus stop and parked cars.
  P('ad-shelter', -24, -33.5, 0.04),
  P('car', -26, -16, 0.04, 90, { colors: { paint: '#c9b24a' } }),
  P('car', 25, -30, 0.04, 75),
  P('car', 29, -14, 0.04, 100, { colors: { paint: '#6a7a8a' } }),
  // Lamps.
  ...[-30, -10, 10, 30].map((x) => P('street-lamp', x, -36.5, 0.04)),
  ...[-30, 30].map((x) => P('street-lamp', x, -10, 0.04)),
]);

// ---------------------------------------------------------------------------------------
// Into the map

const map = JSON.parse(readFileSync(FILE, 'utf8'));
const replaced = (n) =>
  (n.type === 'group' && n.name === 'station') ||
  (n.type === 'box' && n.id === 'train-station-here');
const gone = map.nodes.filter(replaced);
const place = { ...HERE, ...keptPlace(map.nodes, 'station') };
map.nodes = swapIn(map.nodes, replaced, group('station', out, place));

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(`station: ${count(out)} nodes in ${out.length} groups; replaced ${gone.length}`);
console.log(
  `hall stair top ${r2(hallStair.top.x)}, ${r2(hallStair.top.z)} @${r2(hallStair.top.y)}; island stair top ${r2(islandStair.top.x)}, ${r2(islandStair.top.z)} @${r2(islandStair.top.y)}`,
);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
