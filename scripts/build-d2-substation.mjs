// d2's substation (2026-11-15, the user's brief; Claude's layout): a mini point of interest
// on the user's pad (`substation-area-floorplan`, 90 × 60 m), which this replaces. Built in
// the group's own frame, its origin at the pad's middle (north is −z), so the user can move
// or turn the whole group in the editor and a re-run keeps it there.
//
// - The control house (the user's v2 bones, 2026-11-16, from `substation-building-v2`, which
//   this replaces). Ground: the desks room (folding tables, laptops), the lobby by the
//   entrance under the canopy (lockers, a lab coat), the 4 m stair up the east wall, the
//   server hall, and the annex east of it (switch room, its door north). Upper (the north
//   20 m): the desk floor at the stair's top with the lootable server, the key room behind
//   a `substation-keycard` door (two lootable servers, counters, two lab coats) and a
//   sealed room. The south half and the annex are one storey.
// - The canopy over the north half of the east face: a steel roof, not a balcony. The desk
//   floor's broken window opens onto it (a vault out), so a player can get out or come round
//   behind; its edges drop 3.1 m to the apron. No way back up from the ground (the user removed
//   it). The AI can't follow.
// - The yard: three transformers in oil bunds with firewalls between, breakers and gantries
//   in front, a relay kiosk, drums, a site cabin and a generator, so the yard's lanes are
//   broken. A palisade fence round the pad (seen and shot through) with four ways in: the
//   half-open main gate north, a pedestrian gate west, a breach east where a car went
//   through, and a cut panel south-east.
// - Containers (the user asked): three `loot-server`s and three `lab-coat`s. Their tables
//   are placeholders. The keycard is an item only; nothing spawns it yet.
//
// **Behind the map since 2026-11-16:** the user now edits the building by hand in the editor
// (stair, openings, doors, props). Don't re-run this without first diffing it against the
// map and folding their edits in (see design/maps/d2.md → The substation).
//
// Usage: node scripts/build-d2-substation.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { box, drawn, group, keptPlace, prefab, swapIn } from './mapkit/nodes.mjs';
import { roomWalls, union } from './mapkit/rooms.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');
const PAD = { pos: [0.5, 0, 243.5] }; // the user's pad's middle, where the group starts

// Levels (the house stands on a 0.2 m slab; the user's v2 bones, 2026-11-16).
const G = 0.2; // ground floor
const C0 = 3.4; // ground ceiling: the upper slab's underside, and the lower roofs
const U = 3.6; // upper floor
const C1 = 6.8; // upper ceiling: the roof's underside
const ROOF = 7.0;
const CAN = 3.3; // the canopy's top: 1.05 under the broken window's sill (a vault), 3.1 over the apron
const SILL = U + 0.9; // the upper windows' sill (the user's)
const LOW_SILL = U + 0.75; // the broken window's, so it's a vault from the canopy too
const KEY = 'substation-keycard';
const GR = 0.05; // the pad's asphalt and gravel, which everything outside stands on

const C = {
  outside: '#bdb6a8', // the house's block walls
  inside: '#d6d2c8',
  band: '#8f8a7e',
  roof: '#5d6468',
  slab: '#a19d94',
  floor: '#8f8c84',
  carpet: '#6f7680',
  vinyl: '#d3d7d2',
  asphalt: '#4a4b4d',
  gravel: '#8c877c',
  bund: '#77736a',
  concrete: '#a8a49b',
  steel: '#6a6e72',
  canopy: '#7d8489',
  yellow: '#e0b23a',
  black: '#2b2b2b',
  door: '#4f6a7d',
  keyDoor: '#6b4a3a',
  glass: '#9fc8d0',
  lamp: '#f2ecd0',
  tray: '#55595c',
  red: '#b8352b',
};

// Outer faces: [x0, z0, x1, z1]. The house is two storeys north of z 2.5 and one south of
// it; the annex east of the hall is one storey.
const MAIN = [-44.25, -17.5, -28.25, 12.5];
const UPPER = [-44.25, -17.5, -28.25, 2.5];
// The annex as the user reshaped it (2026-11-16): its walls' outer faces, its slab, and the
// aprons. The canopy still covers only the north part of the long apron.
const ANNEX = [-28.25, 4.3, -20.245, 12.5];
const ANNEX_SLAB = [-28.245, 2.3, -20.245, 12.3];
const APRON = [-28.25, -17.5, -24.95, 0.3];
const CANOPY = [-28.25, -17.5, -24.95, -3.5];
const YARD_APRON = [-28.245, 0.3, -20.245, 2.3]; // before the annex, open to the sky
const HOLE = [-32.45, -10.5, -28.45, -2.96]; // the stair's opening upstairs
const STAIR = { x0: -32.45, x1: -28.45, foot: -3.5, top: -10.5 }; // 4 m wide, rising north

// Rooms on wall center lines.
const rooms = [
  { r: [-44.15, -17.4, -37.11, -2.42], yb: G, yt: C0 }, // the desks room
  { r: [-37.11, -17.4, -28.35, -2.42], yb: G, yt: C0 }, // the lobby and the stair
  { r: [-44.15, -2.42, -28.35, 12.4], yb: G, yt: C0 }, // the server hall
  { r: [-44.15, -17.4, -28.35, -2.8], yb: U, yt: C1 }, // the desk floor
  { r: [-44.15, -2.8, -34.07, 2.4], yb: U, yt: C1 }, // the key room
  { r: [-34.07, -2.8, -28.35, 2.4], yb: U, yt: C1 }, // sealed (the user: no way in)
];

/** A doorway: on the wall along `axis` at line c, centered at, w wide, from floor y up h. */
const op = (axis, c, at, w, y, h, more = {}) => ({ axis, c, at, w, y, h, ...more });
const glass = (axis, c, at, w, y, h) => op(axis, c, at, w, y, h, { glass: C.glass });
const BROKEN_Z = -14.5; // the desk floor's broken window, onto the canopy
const OPENINGS = [
  // Ground: the user's wide entrance under the canopy, the desks room's two doorways, the
  // lobby open onto the hall, the hall open onto the annex, the annex's door north.
  op('z', -28.35, -14.58, 3.44, G, 2.6),
  op('x', -2.42, -40.03, 2.04, G, 2.4),
  op('z', -37.11, -8.41, 2.78, G, 2.4),
  op('x', -2.42, -32.73, 8.56, G, C0 - G),
  op('z', -28.35, 8.3, 8, G, 2.8), // the user's: the annex's whole west side (2026-11-16)
  glass('z', -44.15, 7.44, 3, G + 0.9, 1.6),
  // Upper: three windows west; east over the canopy, the user's 4 m window as a broken pane
  // (the way out) and a glazed one; the key room's door.
  glass('z', -44.15, -15.7, 1.5, SILL, 1.6),
  glass('z', -44.15, -9.7, 2, SILL, 1.6),
  glass('z', -44.15, -6.7, 2, SILL, 1.6),
  op('z', -28.35, BROKEN_Z, 1.4, LOW_SILL, 1.75),
  glass('z', -28.35, -12.4, 2.4, SILL, 1.6),
  op('x', -2.8, -35.5, 1.2, U, 2.2, {
    door: { key: KEY, color: C.keyDoor, name: 'Substation key room' },
  }),
];

// ---------------------------------------------------------------------------------------
// Helpers

const out = [];
const add = (name, nodes) => out.push(group(name, nodes));
const P = (id, x, z, y = 0, yaw = 0, colors) =>
  prefab(id, x, z, { ...(yaw ? { yaw } : {}), ...(colors ? { colors } : {}) }, y);
const slab = ([x0, z0, x1, z1], b, t, color, extra) => box(x0, z0, x1, z1, b, t, color, extra);
const lamps = (x0, x1, zs, y) =>
  zs.map((z) => drawn(x0, z - 0.3, x1, z + 0.3, y - 0.03, y - 0.01, C.lamp));

/**
 * Wall panels (3 m) from a to b along x or z on line c, turned `yaw` (their wire leans to
 * local +z: the outside), leaving out the panels whose middle is in `skip`.
 */
function wall(axis, c, a, b, yaw, skip = []) {
  const nodes = [];
  for (let m = a + 1.5; m < b; m += 3) {
    if (skip.some(([s, e]) => m > s && m < e)) continue;
    nodes.push(
      axis === 'x'
        ? P('concrete-wall-panel', m, c, 0, yaw)
        : P('concrete-wall-panel', c, m, 0, yaw),
    );
  }
  return nodes;
}

// ---------------------------------------------------------------------------------------
// The control house

const [mx0, mz0, mx1, mz1] = MAIN;
const [ux0, uz0, ux1, uz1] = UPPER;
add('house shell', [
  // Slabs: the house, the annex and both aprons, all at the ground floor's height.
  ...[MAIN, ANNEX_SLAB, APRON, YARD_APRON].map((r) => slab(r, 0, G, C.slab)),
  // Floor finishes.
  drawn(-44.05, -17.3, -37.21, -2.52, G, G + 0.01, C.vinyl),
  drawn(-37.01, -17.3, -28.45, -2.52, G, G + 0.01, C.floor),
  drawn(-44.05, -2.32, -28.45, 12.3, G, G + 0.01, C.floor),
  drawn(-28.245, 4.3, -20.245, 12.3, G, G + 0.01, C.floor),
  drawn(-44.05, -17.3, -28.45, -2.9, U, U + 0.01, C.carpet),
  drawn(-44.05, -2.7, -34.17, 2.3, U, U + 0.01, C.vinyl),
  // The upper floor and the lower roofs, open over the stair.
  ...union([MAIN, ANNEX], [HOLE], C0, U, C.slab),
  // A band where the floors meet.
  drawn(mx0 - 0.02, mz0 - 0.02, mx1 + 0.02, mz0, C0 - 0.1, U + 0.1, C.band),
  drawn(mx0 - 0.02, mz0, mx0, mz1, C0 - 0.1, U + 0.1, C.band),
  // The lower roofs' parapets (drawn: nobody reaches them).
  drawn(mx0, uz1, mx0 + 0.2, mz1, U, U + 0.4, C.outside),
  drawn(mx0, mz1 - 0.2, mx1, mz1, U, U + 0.4, C.outside),
  drawn(ANNEX[2] - 0.2, ANNEX[1], ANNEX[2], ANNEX[3], U, U + 0.4, C.outside),
  drawn(ANNEX[0], ANNEX[3] - 0.2, ANNEX[2] - 0.2, ANNEX[3], U, U + 0.4, C.outside),
  drawn(ANNEX[0], ANNEX[1], ANNEX[2] - 0.2, ANNEX[1] + 0.2, U, U + 0.4, C.outside),
  // The roof and its parapet, a plant unit and an antenna.
  slab(UPPER, C1, ROOF, C.roof),
  box(ux0, uz0, ux1, uz0 + 0.2, ROOF, ROOF + 0.6, C.outside),
  box(ux0, uz1 - 0.2, ux1, uz1, ROOF, ROOF + 0.6, C.outside),
  box(ux0, uz0 + 0.2, ux0 + 0.2, uz1 - 0.2, ROOF, ROOF + 0.6, C.outside),
  box(ux1 - 0.2, uz0 + 0.2, ux1, uz1 - 0.2, ROOF, ROOF + 0.6, C.outside),
  drawn(-40, -12, -36, -9, ROOF, ROOF + 1.2, C.steel),
  drawn(-39.6, -8.95, -36.4, -8.9, ROOF + 0.2, ROOF + 1.0, C.tray),
  drawn(-31.1, -1.1, -30.9, -0.9, ROOF, ROOF + 4.5, C.steel),
  // The stair: 4 m wide up the east wall, rising north, walled on its west side below and
  // with the user's solid half wall (1.1 m) beside the opening above.
  {
    type: 'stairs',
    pos: [(STAIR.x0 + STAIR.x1) / 2, G, (STAIR.foot + STAIR.top) / 2],
    yaw: 180,
    size: [STAIR.x1 - STAIR.x0, U - G, STAIR.foot - STAIR.top],
    steps: 14,
    color: C.concrete,
  },
  box(-32.65, -11.36, -32.45, -4.36, G, C0, C.inside),
  box(-32.55, -10.9, -32.45, -2.9, U, U + 1.1, C.inside),
  drawn(-32.6, -10.9, -32.4, -2.9, U + 1.1, U + 1.14, C.steel),
  // Light panels.
  ...lamps(-42.5, -38.8, [-14.5, -9.5, -5], C0),
  ...lamps(-36.4, -33.4, [-15, -6], C0),
  ...lamps(-42, -31, [1, 5.5, 10], C0),
  ...lamps(-26, -21, [3, 8], C0),
  ...lamps(-42, -34.5, [-15, -11, -6.5], C1),
  ...lamps(-42, -36.5, [-0.2], C1),
]);

add('house walls', [
  ...roomWalls({ rooms, openings: OPENINGS, inside: C.inside, outside: C.outside }),
  // The broken window: shards left in its frame, so it reads as the way out.
  drawn(-28.41, BROKEN_Z - 0.7, -28.29, BROKEN_Z - 0.5, LOW_SILL, LOW_SILL + 0.35, C.glass),
  drawn(-28.41, BROKEN_Z + 0.45, -28.29, BROKEN_Z + 0.7, SILL + 1.0, SILL + 1.6, C.glass),
  drawn(-28.41, BROKEN_Z - 0.25, -28.29, BROKEN_Z + 0.3, SILL + 1.45, SILL + 1.6, C.glass),
  // The annex's walls as the user drew them (2026-11-16), and its rolled-up shutter.
  {
    type: 'wall',
    pos: [-24.45, G, 4.4],
    size: [8, 3.2, 0.2],
    color: C.outside,
    openings: [{ along: -0.5, width: 2.8, bottom: 0, top: 2.8 }],
  },
  { type: 'wall', pos: [-24.25, GR, 12.4], size: [8, 3.2, 0.2], color: C.outside, openings: [] },
  {
    type: 'wall',
    pos: [-20.345, G, 8.3],
    yaw: 90,
    size: [8, 3.2, 0.2],
    color: C.outside,
    openings: [],
  },
  drawn(-24.35, 4.43, -21.35, 4.57, 3, 3.35, C.steel),
]);

// The canopy over the user's apron, on posts at its outer edge.
const CX = APRON[2];
add('canopy', [
  box(CANOPY[0], CANOPY[1] - 0.1, CX, CANOPY[3], CAN - 0.2, CAN, C.canopy),
  drawn(CX, CANOPY[1] - 0.1, CX + 0.08, CANOPY[3], CAN - 0.3, CAN + 0.08, C.steel), // fascia
  ...[-17.35, -12, -8, -3.65].map((z) =>
    box(CX - 0.3, z - 0.08, CX - 0.14, z + 0.08, G, CAN - 0.2, C.steel),
  ),
  // Hazard stripes on the aprons' outer edges; a lamp over the entrance.
  drawn(CX - 0.2, CANOPY[1], CX, CANOPY[3], G, G + 0.01, C.yellow),
  drawn(-20.445, 0.3, -20.245, 4.3, G, G + 0.01, C.yellow),
  drawn(-28.25, -15, -28.05, -14.2, 2.95, 3.05, C.lamp),
]);

// ---------------------------------------------------------------------------------------
// Inside

// The rooms below as the user arranged them (2026-11-16), with their todo boxes made: a
// desk with a lamp, the transformer enclosure, a short server row, metal shelving, and the
// entrance broken in.
add('desks room', [
  P('notice-board', -37.225, -13.729, -0.007, -90),
  P('notice-board', -44.03, -9.085, -0.323, 90),
  P('stock-crate', -43.35, -4.4, G, 180),
  P('stock-cartons', -43.4, -3.2, G, 90),
  P('water-cooler', -37.55, -2.8, G),
  // Folding tables back to back in two pairs of rows (the user is dressing them).
  ...[-15.2, -14.4, -11.5, -10.7].flatMap((z, i) =>
    [-42.5, -40.65].map((x) => P('folding-table', x, z, 0.21)),
  ),
  P('couch', -37.7, -11.65, 0.21, 90),
  P('couch', -37.7, -5.85, G, 90),
  P('couch', -37.7, -4.3, G, 90),
  P('locker-bank', -43.8, -6.95, 0.21, 90),
  P('lab-coat', -43.4, -7.4, 1.5, -90),
  P('desk-with-lamp', -40.68, -6.16, G),
  P('office-chair', -40.68, -5.35, G, 180),
]);

add('lobby', [
  P('locker-bank', -35.9, -17.04, G),
  P('locker-bank', -34.1, -17.04, G),
  P('wall-hook', -32.4, -17.3, G + 1.55),
  P('lab-coat', -32.4, -17.3, G + 1.55),
  P('electrical-panel', -41, 12.3, G + 0.9, 180),
  drawn(-44.05, -1.7, -43.9, -1.3, G + 0.9, G + 1.6, C.red), // fire extinguisher cabinet
  P('metal-shelving', -32.92, -6.9, G, -90),
  // The entrance, broken in: ragged brick round the user's 3.4 m opening.
  P('wall-breach', -28.35, -14.58, G, 90),
]);

add('server hall', [
  ...[
    [-29.95, 1],
    [-42.55, 1.27],
    [-29.95, 4.07],
    [-42.55, 5],
  ].map(([x, z]) => P('server-row-short', x, z, 0.21, 180)),
  P('transformer-enclosure', -36, 7.5, 0.21),
  // From the user's todo boxes: a UPS, a lootable metal cabinet, and the control panel a
  // quest will use, on the east wall.
  P('ups-cabinet', -36.5, 1.5, G, 180),
  P('metal-cabinet', -28.75, -1.067, G, -90),
  P('substation-control-panel', -28.45, 2.5, G, -90),
  P('switchgear-cabinet', -43.62, 11.025, G, 90),
  P('folding-table', -36.589, -3.608, 0.21, 90),
]);

add('switch room', [
  P('electrical-panel', -27.5, 4.57, G + 0.9),
  P('electrical-panel', -22, 4.57, G + 0.9),
  // The user's todo ("do something with this area"): a battery room, the station's standby
  // supply. Racks down the east wall and along the south, the doorways left clear.
  P('battery-rack', -20.87, 6.6, G, -90),
  P('battery-rack', -20.87, 9.4, G, -90),
  P('battery-rack', -24, 11.88, G, 180),
  P('high-voltage-sign', -20.445, 8, G + 2.3, -90),
]);

add('desk floor', [
  // The lootable server against the north wall, in sight from the stair's top.
  P('loot-server', -37, -16.83, U),
  // Two clusters of desks by the west windows, a screen between them and the stair's lane
  // to the window, a monitor desk on the north wall.
  ...[-13, -6.8].flatMap((zc) =>
    [-41.6, -40].flatMap((x) => [
      P('desk', x, zc - 0.4, U, 180),
      P('office-chair', x, zc - 1.2, U),
      P('desk', x, zc + 0.4, U),
      P('office-chair', x, zc + 1.2, U, 180),
    ]),
  ),
  P('office-screen', -35.2, -12.6, U, 90),
  P('monitor-desk', -31.5, -16.9, U, 180),
  P('office-chair', -31.5, -16, U),
  P('filing-cabinet', -43.8, -16.9, U, 90),
  P('filing-cabinet', -43.8, -16.4, U, 90),
  P('water-cooler', -33, -3.3, U),
  P('potted-plant', -43.6, -3.4, U),
]);

add('key room', [
  // Two lootable servers on the south wall, two lab coats on hooks inside the door; the
  // user is dressing the rest.
  P('loot-server', -42.3, 1.82, U, 180),
  P('loot-server', -39.3, 1.82, U, 180),
  ...[-37.4, -36.8].flatMap((x) => [
    P('wall-hook', x, -2.7, U + 1.55),
    P('lab-coat', x, -2.695, U + 1.55),
  ]),
]);

// ---------------------------------------------------------------------------------------
// The pad

// Transformers: three in a row facing the switchyard (+z), each in a bund, firewalls between.
const TX = [4, 18, 32];
const TZ = -10;
add('transformers', [
  ...TX.flatMap((x) => [
    // The bund: a 0.35 m curb (a step) round dark gravel.
    drawn(x - 4.1, TZ - 2.9, x + 4.1, TZ + 2.9, GR, GR + 0.04, C.bund),
    box(x - 4.3, TZ - 3.1, x + 4.3, TZ - 2.9, GR, GR + 0.35, C.concrete),
    box(x - 4.3, TZ + 2.9, x + 4.3, TZ + 3.1, GR, GR + 0.35, C.concrete),
    box(x - 4.3, TZ - 2.9, x - 4.1, TZ + 2.9, GR, GR + 0.35, C.concrete),
    box(x + 4.1, TZ - 2.9, x + 4.3, TZ + 2.9, GR, GR + 0.35, C.concrete),
    P('power-transformer', x, TZ, GR + 0.04),
    // Its leads to the breaker in front.
    ...[-1.05, 0, 1.05].map((dx) =>
      drawn(x + dx - 0.02, TZ + 0.6, x + dx + 0.02, -1, GR + 4.5, GR + 4.54, C.steel),
    ),
  ]),
  // Firewalls between them, a bay's length, too tall for anything.
  ...[11, 25].map((x) => box(x - 0.18, TZ - 5, x + 0.18, TZ + 5, GR, 6, C.concrete)),
  ...[11, 25].flatMap((x) => [
    P('high-voltage-sign', x + 0.19, TZ + 2, 2.2, 90),
    P('high-voltage-sign', x - 0.19, TZ + 2, 2.2, -90),
  ]),
]);

add('switchyard', [
  ...TX.flatMap((x) => [P('circuit-breaker', x, -1, GR), P('substation-gantry', x, 4, GR)]),
  // The relay kiosk: a block hut, door drawn on its north face.
  box(14, 13, 19.5, 17, GR, 3, C.outside),
  box(13.85, 12.85, 19.65, 17.15, 3, 3.15, C.roof),
  drawn(15.9, 12.95, 17.1, 13, GR, 2.1, C.door),
  P('high-voltage-sign', 18.6, 12.99, 1.8, 180),
  // A diesel generator by the house's yard, the site cabin by the south fence.
  P('bunker-generator', 0, 25, GR, 90),
  P('steel-barrel', 2.3, 26.6, GR),
  P('hazard-barrel', 2.3, 25.8, GR),
  // A spares container across the switchyard's diagonals (nothing beside it to climb from).
  P('shipping-container-sealed', 8, 18, GR, 100),
  P('portacabin', 34, 25.3, GR, 180, { trim: '#4f6a7d' }),
  // Drums: big ones are eye-height cover, nothing to climb from.
  P('cable-drum', 27.5, 17.5, GR, 20),
  P('cable-drum', 29.2, 16.2, GR, 75),
  P('cable-drum', 40.5, 9.5, GR, 90),
  P('cable-drum-small', 40.5, 20.5, GR, 30),
  P('switchgear-cabinet', -1.5, 13.2, GR, 90),
]);

add('north lane', [
  // Spares between the transformers and the north fence, staggered along it.
  P('cable-drum', 9, -20.5, GR, 0),
  P('cable-drum', 31, -23.5, GR, 10),
  P('cable-drum', 33, -22.6, GR, -5),
  // Two spares containers, staggered, so the lane's full-width lines stop.
  P('shipping-container-closed-doors', 0, -27, GR, 90),
  P('shipping-container-sealed', 21, -19.5, GR, -90),
  P('wood-pallet-boxes', 38, -27.5, GR),
  P('wood-pallet-boxes', 39.3, -27.6, GR),
  P('stock-crate', 40.5, -19, GR),
  P('jersey-barrier', -3, -22, GR, 90),
]);

// The drive from the gate along the house's front, and the gravel yard.
add('ground', [
  // Asphalt on the drive and the north strip, gravel elsewhere, round the house's slabs:
  // the user's boxes (2026-11-16), patched round the annex they reshaped.
  ...[
    [-25.4, -23.65, 38.8, 12.3, C.asphalt],
    [-15.3, -10.5, 18.6, 14, C.asphalt],
    [-13.12, 3.57, 14.25, 14.14, C.asphalt],
    [-22.42, -1.57, 4.35, 4, C.asphalt],
    [-15.3, 20.22, 18.6, 19.16, C.asphalt],
    [19.4, -23.65, 50.8, 12.3, C.gravel],
    [-44.52, -10.5, 0.55, 14, C.gravel],
    [-24.77, -8.6, 0.35, 17.8, C.gravel],
    [19.4, -10.5, 50.8, 14, C.gravel],
    [-44.52, 3.57, 0.55, 14.14, C.gravel],
    [19.4, 3.57, 50.8, 14.14, C.gravel],
    [-44.52, 11.57, 0.55, 1.86, C.gravel],
    [-26.42, 11.57, 3.65, 1.86, C.gravel],
    [19.4, 11.57, 50.8, 1.86, C.gravel],
    [-34.7, 21.15, 20.2, 17.3, C.gravel],
    [19.4, 21.15, 50.8, 17.3, C.gravel],
  ].map(([x, z, w, d, color]) => ({ type: 'box', pos: [x, 0, z], size: [w, GR, d], color })),
  // Where the user left them (2026-11-16): a car and a drum on the drive, a container.
  P('car', -7, -19.5, GR, 160, { paint: '#9a9a96' }),
  P('cable-drum', -2.5, 5.5, GR, 90),
  P('shipping-container-closed-doors', -4.5, -9.5, GR),
  ...[-23.6, -21.6].map((x) => box(x - 0.1, -19.9, x + 0.1, -19.7, GR, 1, C.yellow)),
]);

// The compound wall (2026-11-16, the user's call, replacing the palisade): precast panels,
// solid to sight and shots, wire on top that nobody climbs. Four ways in: the north gate
// (a guard booth between two lanes, both barriers down, a walk-past gap each side of the
// booth), the west gate (a booth, a barrier down, a walk-past gap), the breach east where a
// car went through, and a panel broken through south-east.
const NORTH_GATE = [-27, -12];
const WEST_GATE = [15, 21];
add('compound wall', [
  ...wall('x', -30, -45, 45, 180, [NORTH_GATE]),
  ...wall('x', 30, -45, 45, 0, [[30, 33]]),
  P('concrete-wall-panel-holed', 31.5, 30, 0, 0),
  ...wall('z', -45, -30, 30, -90, [WEST_GATE]),
  ...wall('z', 45, -30, 30, 90, [[-3, 3]]),
  // The breach: one panel flat outside, broken pieces inside, the car through the gap.
  box(45.4, -3.4, 47.7, -0.65, 0, 0.18, '#b3ada2'), // the panel, flat (a prefab with an invisible box can't tilt)
  drawn(45.4, -3.4, 47.7, -3.32, 0.18, 0.2, '#9a958b'),
  drawn(46.2, -2.6, 46.5, -1.4, 0.18, 0.19, '#9a958b'),
  P('car', 45.6, 1.2, GR, -70, { paint: '#7a3b32' }),
  ...[
    [43.6, -1.5, 0.5, 20],
    [43.2, -0.4, 0.35, 70],
    [44.1, 2.6, 0.4, 35],
  ].map(([x, z, sz, yaw]) => prefab('concrete-bag', x, z, { yaw }, GR)),
  // Signs on the wall's outer faces.
  ...[-34.5, -7.5, 7.5, 22.5, 37.5].map((x) => P('high-voltage-sign', x, -30.1, 1.9, 180)),
  ...[-19.5, 10.5, 22.5].map((z) => P('high-voltage-sign', 45.1, z, 1.9, 90)),
  // A name board outside the north gate.
  box(-34.2, -32.2, -34, -32, 0, 2.2, C.steel),
  box(-30.2, -32.2, -30, -32, 0, 2.2, C.steel),
  drawn(-34.2, -32.18, -30, -32.12, 1.2, 2.2, C.lamp),
  drawn(-33.8, -32.2, -30.4, -32.18, 1.85, 2.0, C.door),
  drawn(-33.8, -32.2, -31.6, -32.18, 1.5, 1.6, C.black),
  // Flood lights in the corners, aimed in.
  P('flood-light', 43.4, -28.4, GR, 135),
  P('flood-light', 43.4, 28.4, GR, 45),
  P('flood-light', -43.4, 28.4, GR, -45),
  P('flood-light', -43.4, -28.4, GR, -135),
]);

add('gates', [
  // North: the booth on the island, windows out; the barriers never open.
  P('guard-booth', -19.5, -30, GR, 180),
  P('boom-barrier', -21.8, -30, GR, 180),
  P('boom-barrier', -17.2, -30, GR),
  ...[-24.4, -14.6].flatMap((x) => [
    drawn(x - 2.2, -31.3, x + 2.2, -31.1, 0, 0.02, C.lamp),
    drawn(x - 2.2, -28.9, x + 2.2, -28.7, GR, GR + 0.01, C.lamp),
  ]),
  P('jersey-barrier', -29, -33.5, 0, 20),
  P('jersey-barrier', -9.5, -33.5, 0, -20),
  // West: a smaller post, the barrier across the gate, a walk-past gap at its south end.
  P('guard-booth', -42.6, 23.4, GR, 180),
  P('boom-barrier', -44.3, 21.3, GR, 90),
]);

// ---------------------------------------------------------------------------------------
// Into the map

const map = JSON.parse(readFileSync(FILE, 'utf8'));
const replaced = (n) =>
  (n.type === 'group' && n.name === 'substation') ||
  (n.type === 'box' && n.id === 'substation-area-floorplan') ||
  (n.type === 'group' && n.name === 'substation-building-v2') ||
  (n.type === 'box' && n.id === 'todo-create-a-metal-storage-rack-shelving-here');
const gone = map.nodes.filter(replaced);
const place = { ...PAD, ...keptPlace(map.nodes, 'substation') };
map.nodes = swapIn(map.nodes, replaced, group('substation', out, place));

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(`substation: ${count(out)} nodes in ${out.length} groups; replaced ${gone.length}`);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
