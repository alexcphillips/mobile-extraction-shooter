// d2's hotel (2026-11-15, the user's request: a luxury hotel on their basic floorplan, free
// to reshape; more rooms on the second storey, a VIP suite at the end furthest from the
// stairs, "Tarkov dorms PvP vibes"). Built on the user's `hotel-floorplan` (x −13.5..42,
// z −222..−166), written into content/maps/d2.json as one group named `hotel`. Re-runnable:
// it replaces its own group, and on the first run takes out `hotel-floorplan`. It leaves the
// rest of d2 alone.
//
// Plan (docs/design/maps/d2.md → The hotel has the why):
// - One block x −16..42, z −224..−166, front (the drive) on the south. Ground: restaurant,
//   kitchen, laundry and receiving in the west wing; the lobby (double height, a mezzanine
//   lounge over its back) and the grand ballroom (double height, the military's command post)
//   in the middle; the stair hall, bell room, security, staff quarters, restrooms and the gym
//   in the east wing. Floor to floor 4 m, as the user drew it.
// - Upper: two guest wings of double-loaded corridors (18 rooms, 201–218), each corridor
//   jogged a full width halfway so no line runs its length; the mezzanine joins the wings.
//   The presidential suite fills the west wing's far end, the deepest point from the main
//   stair, behind a keycard door; rooms 209 and 218 are locked too.
// - Ways up: the main stair (stair hall), the kitchen's service stair (lands at the west
//   wing's near end, so the suite is still the long way), the east service stair (gym).
//   Ways down only: a hole in room 208's floor onto rubble in the kitchen, the open shaft of
//   a broken lift from the mezzanine onto its wrecked car, the suite's balcony.
// - Close quarters on the dorm pattern: doors both sides of the corridors (staggered), broken
//   walls between some rooms, interior rooms with no windows, a sandbagged billet watching
//   the lobby. No loot yet (loot comes last); nothing placed carries any.
//
// Usage: node scripts/build-d2-hotel.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { along, box, drawn, group, prefab, r2, keptPlace, swapIn } from './mapkit/nodes.mjs';
import { roomWalls, union } from './mapkit/rooms.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');

// Levels (the user's 4 m floor to floor).
const G = 0.2; // ground floor
const GC = 4; // ground ceiling: the upper floor's underside
const U = 4.2; // upper floor
const RC = 7.4; // under the roof
const ROOF = 7.6;
const T = 0.1;

const C = {
  inside: '#d6ccb8',
  outside: '#cfc6b2',
  trim: '#8a7d68',
  roof: '#6a6660',
  bronze: '#4a3a2a',
  glass: '#9fc8d0',
  marble: '#e6e0d3',
  stone: '#bdb5a5',
  gold: '#c8a24b',
  wood: '#4a3426',
  woodDark: '#2e2018',
  steel: '#8a8e94',
  carpet: '#6a1e26',
  roomCarpet: '#8a7a66',
  tile: '#dcdcd6',
  parquet: '#7a5a3a',
  concrete: '#6f7275',
  kitchen: '#a8a49b',
  paving: '#8d8a84',
  olive: '#4a5038',
  oliveDark: '#3a3f2c',
  sconce: '#ffe3a0',
  linen: '#e8e4da',
};

// ---------------------------------------------------------------------------------------
// The rooms: [x0, z0, x1, z1] (z0 the north side), walls from yb to yt, the floor's color.

const ground = (r, floor) => ({ r, yb: G, yt: GC, floor });
const upper = (r, floor) => ({ r, yb: U, yt: RC, floor });
const tall = (r, floor) => ({ r, yb: G, yt: RC, floor });

const LOBBY = [2, -196, 24, -166];
const BALLROOM = [2, -224, 24, -196];
const SHAFT_A = [18, -196, 21, -192.5]; // closed, its car at the ground
const SHAFT_B = [21, -196, 24, -192.5]; // doors forced on both floors, its car crashed below
const MEZZ = [2 + T, -196 + T, 24 - T, -180]; // the mezzanine stops at the lobby walls' faces
const WELL_MAIN = [36, -182, 39, -175]; // the main stair, rising north
const WELL_KITCHEN = [-3.8, -196, -2, -189]; // the kitchen's service stair, rising south
const WELL_EAST = [33, -223.9, 40, -222]; // the east service stair, rising east
const HOLE = [-15, -201.5, -12.5, -199]; // room 208's broken floor
const BALCONY = [-18.4, -219, -16, -209];
const BUILDING = [-16, -224, 42, -166];

const R = {
  // Ground, west wing.
  restaurant: ground([-16, -186, 2, -166], '#5a3a2a'),
  kitchen: ground([-16, -202, 2, -186], C.kitchen),
  laundry: ground([-16, -214, 2, -202], '#8f9396'),
  receiving: ground([-16, -224, 2, -214], C.concrete),
  // Ground, middle: double height.
  lobby: tall(LOBBY, C.marble),
  shaftALow: { r: SHAFT_A, yb: G, yt: GC, floor: null },
  shaftAHigh: { r: SHAFT_A, yb: U, yt: RC, floor: null },
  shaftBLow: { r: SHAFT_B, yb: G, yt: GC, floor: null },
  shaftBHigh: { r: SHAFT_B, yb: U, yt: RC, floor: null },
  ballroom: tall(BALLROOM, C.parquet),
  // Ground, east wing.
  stairHall: ground([24, -186, 42, -166], C.marble),
  bell: ground([24, -196, 30, -186], C.roomCarpet),
  staffCorridor: ground([30, -210, 33, -186], C.concrete),
  security: ground([33, -198, 42, -186], '#4f5254'),
  staff: ground([33, -210, 42, -198], '#6a6458'),
  restrooms: ground([24, -210, 30, -196], C.tile),
  gym: ground([24, -224, 42, -210], '#3a3d40'),
  // Upper, east: the landing over the stair hall, a corridor jogged at z −205..−208.
  landing: upper([24, -186, 42, -166], C.carpet),
  eastS: upper([32, -205, 35, -186], C.carpet),
  eastJog: upper([29, -208, 35, -205], C.carpet),
  eastN: upper([29, -224, 32, -208], C.carpet),
  stairEast: upper([32, -224, 42, -214], C.concrete),
  // Upper, west: a cross landing off the mezzanine, a corridor jogged at z −189..−186.
  crossWest: upper([-10, -189, 2, -186], C.carpet),
  westS: upper([-7, -186, -4, -166], C.carpet),
  westN: upper([-10, -204, -7, -189], C.carpet),
  linen: upper([-7, -196, 2, -189], C.concrete),
  // The presidential suite.
  vipFoyer: upper([-12, -208, -5, -204], C.marble),
  vipStudy: upper([-16, -208, -12, -204], C.woodDark),
  vipPantry: upper([-5, -208, 2, -204], C.tile),
  vipLiving: upper([-16, -224, -6, -208], '#3a2a3a'),
  vipBed: upper([-6, -224, 2, -214], '#3a2a3a'),
  vipBath: upper([-6, -214, 2, -208], C.marble),
};

// Guest rooms: side 'w' (west of its corridor, whose wall is at x1) or 'e' (at x0); the door
// at the north ('n', z0) or south ('s') end, the bed's headboard on that end's wall and the
// bathroom at the other end beside the corridor. States vary the dressing.
const GUEST = [
  // West wing, front stretch (corridor x −7..−4).
  { n: 201, r: [-16, -172.5, -7, -166], side: 'w', door: 'n' },
  { n: 202, r: [-4, -172.5, 2, -166], side: 'e', door: 's' },
  { n: 203, r: [-16, -179, -7, -172.5], side: 'w', door: 'n', state: 'trashed' },
  { n: 204, r: [-4, -179, 2, -172.5], side: 'e', door: 'n', state: 'billet' },
  { n: 205, r: [-16, -186, -7, -179], side: 'w', door: 's' },
  { n: 206, r: [-4, -186, 2, -179], side: 'e', door: 's' },
  // West wing, back stretch (corridor x −10..−7).
  { n: 207, r: [-16, -196.5, -10, -189], side: 'w', door: 's' },
  { n: 208, r: [-16, -204, -10, -196.5], side: 'w', door: 's', state: 'hole' },
  {
    n: 209,
    r: [-7, -204, 2, -196],
    side: 'e',
    door: 's',
    state: 'suite',
    key: 'hotel-room-209-keycard',
  },
  // East wing, front stretch (corridor x 32..35).
  { n: 210, r: [24, -192.5, 32, -186], side: 'w', door: 's' },
  { n: 211, r: [35, -192.5, 42, -186], side: 'e', door: 'n' },
  { n: 212, r: [24, -199, 32, -192.5], side: 'w', door: 'n', state: 'billet' },
  { n: 213, r: [35, -199, 42, -192.5], side: 'e', door: 's', state: 'trashed' },
  { n: 214, r: [24, -205, 32, -199], side: 'w', door: 's' },
  { n: 215, r: [35, -208, 42, -199], side: 'e', door: 'n', state: 'suite' },
  // East wing, back stretch (corridor x 29..32).
  { n: 216, r: [24, -214.5, 29, -205], side: 'w', door: 'n' },
  { n: 217, r: [24, -224, 29, -214.5], side: 'w', door: 's', state: 'trashed' },
  {
    n: 218,
    r: [32, -214, 42, -208],
    side: 'e',
    door: 'n',
    state: 'suite',
    key: 'hotel-room-218-keycard',
  },
];

/** A doorway: on the wall along `axis` at line c, centered at, w wide, from floor y up h. */
const op = (axis, c, at, w, y, h, more = {}) => ({ axis, c, at, w, y, h, ...more });
const door = (axis, c, at, y, w = 1.2, more = {}) =>
  op(axis, c, at, w, y, 2.2, { door: { color: C.wood, ...(more.door ?? {}) }, ...more });
const glass = (axis, c, at, w, y, h) => op(axis, c, at, w, y, h, { glass: C.glass });

const OPENINGS = [
  // Front (south) facade, ground: the restaurant's windows and terrace door, the lobby's
  // curtain glass either side of its open entrance, the stair hall's side door.
  glass('x', -166, -12, 4, G + 0.8, 2.4),
  door('x', -166, -6.5, G, 1.8),
  glass('x', -166, -1.5, 4, G + 0.8, 2.4),
  glass('x', -166, 6, 5, G + 0.6, 6.2),
  op('x', -166, 13, 5, G, 3.2),
  glass('x', -166, 20, 5, G + 0.6, 6.2),
  door('x', -166, 30, G, 1.6),
  glass('x', -166, 37, 4, G + 1, 2),
  // Front, upper.
  glass('x', -166, -11.5, 2.4, U + 0.9, 1.5),
  glass('x', -166, -5.5, 1.6, U + 0.9, 1.5),
  glass('x', -166, -1, 2.4, U + 0.9, 1.5),
  glass('x', -166, 28, 2.4, U + 0.9, 1.5),
  glass('x', -166, 38, 2.4, U + 0.9, 1.5),
  // West facade, ground: restaurant windows, the kitchen's service door, receiving's dock.
  glass('z', -16, -170, 3, G + 0.8, 2.4),
  glass('z', -16, -179, 3, G + 0.8, 2.4),
  door('z', -16, -194, G, 1.4),
  glass('z', -16, -208, 2, G + 1.4, 1.2),
  op('z', -16, -219, 3, G, 3),
  // West, upper: rooms 201–208, the study, the suite's balcony doors and window.
  glass('z', -16, -169.25, 2.4, U + 0.9, 1.5),
  glass('z', -16, -175.75, 2.4, U + 0.9, 1.5),
  glass('z', -16, -182.5, 2.4, U + 0.9, 1.5),
  glass('z', -16, -192.75, 2.4, U + 0.9, 1.5),
  glass('z', -16, -200.25, 2.4, U + 0.9, 1.5),
  glass('z', -16, -206, 1.6, U + 0.9, 1.5),
  op('z', -16, -211.5, 2, U, 2.4), // balcony doors
  glass('z', -16, -216.5, 3, U + 0.6, 2),
  glass('z', -16, -221.5, 2, U + 0.6, 2),
  // Back (north) facade: the ballroom's fire exit, the gym's back door; upper windows.
  door('x', -224, 22.5, G, 1.6),
  door('x', -224, 27.5, G, 1.4),
  glass('x', -224, -11, 4, U + 0.6, 2),
  glass('x', -224, -2, 3, U + 0.6, 2),
  glass('x', -224, 26.5, 2, U + 0.9, 1.5),
  glass('x', -224, 30.5, 1.6, U + 0.9, 1.5),
  // East facade: security's window, the staff entrance, the gym; upper rooms.
  glass('z', 42, -192, 2, G + 1.2, 1.4),
  door('z', 42, -206, G, 1.2),
  glass('z', 42, -214, 3, G + 1, 2),
  glass('z', 42, -175, 3, G + 1, 2),
  glass('z', 42, -189.25, 2.4, U + 0.9, 1.5),
  glass('z', 42, -195.75, 2.4, U + 0.9, 1.5),
  glass('z', 42, -203.5, 2.4, U + 0.9, 1.5),
  glass('z', 42, -211, 2.4, U + 0.9, 1.5),
  glass('z', 42, -218, 2.4, U + 0.9, 1.5),
  glass('z', 42, -176, 2.4, U + 0.9, 1.5),
  // West wing inside, ground.
  door('x', -186, -11, G, 1.2), // restaurant ↔ kitchen
  glass('x', -186, -5, 2.4, G + 1.1, 0.9), // the pass
  door('x', -202, -8, G, 1.2), // kitchen ↔ laundry
  op('x', -214, -8, 2.4, G, 2.6), // laundry ↔ receiving
  door('z', 2, -199, G, 1.4), // kitchen ↔ ballroom (banquet service)
  op('z', 2, -219, 2.4, G, 2.8), // receiving ↔ ballroom
  // Lobby: the restaurant, the ballroom's doors, the stair hall, the bell room; the
  // mezzanine's doors to the wings and its windows over the ballroom; the lift doors.
  op('z', 2, -170, 3, G, 2.8),
  op('x', -196, 4, 3.6, G, 3), // the ballroom's doors, both behind reception's key wall
  op('x', -196, 10, 3.6, G, 3),
  glass('x', -196, 7, 2, U + 0.9, 1.4), // the mezzanine's looks over the ballroom
  glass('x', -196, 14.5, 3.6, U + 0.9, 1.4),
  op('z', 24, -176, 6, G, 3.2),
  door('z', 24, -189, G, 1.2),
  op('z', 2, -187.5, 2.4, U, 2.6), // mezzanine ↔ the west wing
  op('z', 24, -183, 3, U, 2.6), // mezzanine ↔ the east landing
  glass('z', 24, -170.5, 3, U + 0.8, 1.6), // the landing's look over the atrium
  glass('z', 2, -175.75, 2.4, U + 0.9, 1.5), // room 204's look over the atrium
  op('x', -192.5, 22.5, 1.3, G, 2.3), // lift B forced open, ground
  op('x', -192.5, 22.5, 1.3, U, 2.3), // and on the mezzanine
  // East wing inside, ground.
  door('x', -186, 27, G, 1), // bell room ↔ stair hall
  op('x', -186, 31.5, 2.4, G, 2.6), // stair hall ↔ staff corridor
  door('x', -186, 39, G, 1.2), // security ↔ stair hall
  door('z', 33, -192, G, 1.2), // staff corridor ↔ security
  door('z', 33, -204, G, 1.2), // ↔ staff quarters
  door('z', 30, -203, G, 1.2), // ↔ restrooms
  op('x', -210, 31.5, 2.4, G, 2.6), // ↔ gym
  door('z', 24, -217, G, 1.4), // gym ↔ ballroom
  door('z', 24, -203, G, 1.2), // restrooms ↔ ballroom
  // Upper, east: landing ↔ corridor, the jog, the service stair's door.
  op('x', -186, 33.5, 2.4, U, 2.6),
  op('x', -205, 33.5, 2.8, U, 2.7),
  op('x', -208, 30.5, 2.8, U, 2.7),
  door('z', 32, -215.5, U, 1.2),
  // Upper, west: cross landing ↔ both stretches, the kitchen stair's top, the linen door.
  op('x', -186, -5.5, 2.8, U, 2.7),
  op('x', -189, -8.5, 2.8, U, 2.7),
  op('x', -189, -2.9, 2, U, 2.6),
  door('z', -7, -193, U, 1),
  // The suite: its keycard door, the foyer into the living room, study, pantry, bedroom,
  // the bathroom off the bedroom.
  door('x', -204, -8.5, U, 1.6, {
    door: { key: 'hotel-vip-keycard', name: 'Presidential suite', color: C.woodDark },
  }),
  op('x', -208, -9, 3, U, 2.6),
  door('z', -12, -206, U, 0.9),
  door('z', -5, -206, U, 0.9),
  op('z', -6, -219, 1.6, U, 2.4),
  door('x', -214, 0.8, U, 0.9),
  // Broken walls between rooms (the dorm way round a corridor): 203 ↔ 205, 211 ↔ 213,
  // 216 ↔ 217.
  op('x', -179, -14, 1.4, U, 2),
  op('x', -192.5, 41, 1.2, U, 2),
  op('x', -214.5, 25.2, 1.2, U, 2),
];

// ---------------------------------------------------------------------------------------
// Helpers

const out = [];
const add = (name, nodes) => out.push(group(name, nodes));
const P = (id, x, z, y, yaw, colors) =>
  prefab(id, x, z, { ...(yaw ? { yaw } : {}), ...(colors ? { colors } : {}) }, y);

/** A glass balustrade along a line: solid to movement only, glass and a brass rail drawn. */
function rail(x0, z0, x1, z1, y) {
  const alongX = Math.abs(z1 - z0) < 1e-6;
  const [a0, a1, b0, b1] = alongX ? [x0, x1, z0 - 0.05, z0 + 0.05] : [x0 - 0.05, x0 + 0.05, z0, z1];
  return [
    box(a0, b0, a1, b1, y, y + 1.05, C.glass, { invisible: true }),
    drawn(
      alongX ? x0 : x0 - 0.02,
      alongX ? z0 - 0.02 : z0,
      alongX ? x1 : x0 + 0.02,
      alongX ? z0 + 0.02 : z1,
      y + 0.1,
      y + 0.98,
      C.glass,
    ),
    drawn(
      alongX ? x0 : x0 - 0.04,
      alongX ? z0 - 0.04 : z0,
      alongX ? x1 : x0 + 0.04,
      alongX ? z0 + 0.04 : z1,
      y + 0.98,
      y + 1.05,
      C.gold,
    ),
  ];
}

/** Two couches facing each other over a lounge table, on a rug. */
const lounge = (x, z, y, couch = '#6a1e26', yaw = 0) => {
  const [dx, dz] = yaw ? [1.35, 0] : [0, 1.35];
  return [
    P('floor-rug', x, z, y + 0.005, yaw, { rug: '#3a2a20' }),
    P('couch', x - dx, z - dz, y, yaw ? 90 : 0, { fabric: couch }),
    P('couch', x + dx, z + dz, y, yaw ? -90 : 180, { fabric: couch }),
    P('lounge-table', x, z, y),
  ];
};

/** A stack of olive military cases, 2 high (over eye height), w along x, d along z. */
const cases = (x, z, w = 1.2, d = 1.2, y = G) => [
  box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y, y + 0.95, C.olive),
  box(
    x - w / 2 + 0.05,
    z - d / 2 + 0.05,
    x + w / 2 - 0.05,
    z + d / 2 - 0.05,
    y + 0.95,
    y + 1.85,
    C.oliveDark,
  ),
  drawn(x - w / 2 - 0.01, z - 0.1, x + w / 2 + 0.01, z + 0.1, y + 0.4, y + 0.5, '#c9c3b0'),
];

/** A simple desk (no loot): top and two end panels, along x, sitter on +z (yaw turns it). */
function desk(x, z, y, yaw = 0, w = 1.4) {
  const g = { type: 'group', pos: [r2(x), r2(y), r2(z)], ...(yaw ? { yaw } : {}), nodes: [] };
  g.nodes.push(
    box(-w / 2, -0.35, w / 2, 0.35, 0.72, 0.76, C.wood),
    box(-w / 2, -0.33, -w / 2 + 0.05, 0.33, 0, 0.72, C.woodDark),
    box(w / 2 - 0.05, -0.33, w / 2, 0.33, 0, 0.72, C.woodDark),
  );
  return g;
}

/** A TV on a low stand (no loot), back on a wall, facing +z (yaw turns it). */
function tv(x, z, y, yaw = 0) {
  return {
    type: 'group',
    pos: [r2(x), r2(y), r2(z)],
    ...(yaw ? { yaw } : {}),
    nodes: [
      box(-0.8, -0.22, 0.8, 0.22, 0, 0.5, C.woodDark),
      drawn(-0.6, -0.04, 0.6, 0.0, 0.8, 1.5, '#16181c'),
      drawn(-0.08, -0.06, 0.08, -0.02, 0.5, 0.8, '#16181c'),
    ],
  };
}

/** Wall sconces along a wall line (drawn), every `step` m between a and b. */
function sconces(axis, c, a, b, y, side, step = 4) {
  const nodes = [];
  for (let t = a + step / 2; t < b; t += step) {
    const off = side * 0.13;
    nodes.push(
      axis === 'x'
        ? drawn(t - 0.12, c + off - 0.03, t + 0.12, c + off + 0.03, y + 2.0, y + 2.3, C.sconce)
        : drawn(c + off - 0.03, t - 0.12, c + off + 0.03, t + 0.12, y + 2.0, y + 2.3, C.sconce),
    );
  }
  return nodes;
}

// ---------------------------------------------------------------------------------------
// Guest rooms: their bathrooms are rooms too (walls, a doorway), so they go in before the
// shell is built.

const PODS = [];
const guestNodes = [];
for (const g of GUEST) {
  const [x0, z0, x1, z1] = g.r;
  const cx = g.side === 'w' ? x1 : x0; // the corridor wall
  const s = g.side === 'w' ? -1 : 1; // into the room
  const D = x1 - x0;
  const at = (d) => cx + s * d; // x at depth d from the corridor wall
  const inward = s < 0 ? -90 : 90; // yaw facing into the room from the corridor
  const north = g.door === 'n';
  const head = north ? z0 : z1; // the bed's wall
  const podZ = north ? [z1 - 2.6, z1] : [z0, z0 + 2.6];
  const podFace = north ? z1 - 2.6 : z0 + 2.6;
  const name = `Room ${g.n}`;
  OPENINGS.push(
    door('z', cx, north ? z0 + 1 : z1 - 1, U, 1, {
      door: { name, color: C.wood, ...(g.key ? { key: g.key } : {}) },
    }),
  );
  const nodes = [];
  if (g.state !== 'hole') {
    const pod = [Math.min(cx, at(2.2)), podZ[0], Math.max(cx, at(2.2)), podZ[1]];
    PODS.push(pod);
    OPENINGS.push(op('x', podFace, at(1.3), 0.8, U, 2.1));
    // The bathroom: a tub along the corridor wall, the toilet at its far side.
    const zIn = north ? z1 - 0.95 : z0 + 0.95;
    nodes.push(P('bathtub', at(0.5), zIn, U, north ? 0 : 180));
    nodes.push(P('toilet', at(1.75), north ? z1 - 0.45 : z0 + 0.45, U, north ? 180 : 0));
  }
  const bedX = at(Math.min(Math.max(3.05, D * 0.5), D - 1.95));
  const bedZ = north ? z0 + 1.2 : z1 - 1.2;
  const bedYaw = north ? 0 : 180;
  if (g.state === 'billet') {
    // Soldiers billeted: two bunks, cases, sandbags under the window.
    nodes.push(P('bunk-bed', at(2.6), north ? z0 + 1.15 : z1 - 1.15, U));
    nodes.push(P('bunk-bed', at(3.9), north ? z0 + 1.15 : z1 - 1.15, U));
    nodes.push(...cases(at(D - 0.85), (z0 + z1) / 2 + (north ? 1 : -1), 1.2, 1.2, U));
  } else if (g.state === 'trashed') {
    nodes.push(P('hotel-bed', bedX + s * 0.3, bedZ + (north ? 0.6 : -0.6), U, bedYaw + 18));
    nodes.push(P('couch-fallen', at(D - 1.2), (z0 + z1) / 2, U, inward));
  } else if (g.state === 'hole') {
    // The floor gave way: no bed, just what was left and the rubble round the hole.
    nodes.push(P('mattress-bed', at(1.6), z0 + 1.4, U, 90));
    nodes.push(P('couch-fallen', at(2.2), z1 - 1.2, U, 200));
  } else {
    nodes.push(P('hotel-bed', bedX, bedZ, U, bedYaw));
  }
  if (g.state !== 'hole' && g.state !== 'billet') {
    // TV on the bathroom's end wall, a desk under the window.
    if (D - 2.2 >= 2.2)
      nodes.push(tv(at(2.2 + (D - 2.2) / 2), north ? z1 - 0.32 : z0 + 0.32, U, north ? 180 : 0));
    if (g.side === 'w' ? x0 === -16 : x1 === 42)
      nodes.push(desk(at(D - 0.45), (z0 + z1) / 2 + (north ? 0.6 : -0.6), U, s < 0 ? 90 : -90));
    nodes.push(P('floor-lamp', at(D - 0.45), north ? z1 - 0.45 : z0 + 0.45, U));
  }
  if (g.state === 'suite') {
    // A sitting area by the window.
    nodes.push(...lounge(at(D - 2.6), north ? z1 - 2.1 : z0 + 2.1, U, '#5a4a6a', 90));
  }
  guestNodes.push(group(name.toLowerCase().replace(' ', '-'), nodes));
}

// ---------------------------------------------------------------------------------------
// Shell

const rooms = [
  ...Object.values(R),
  ...GUEST.map((g) => upper(g.r, g.state === 'hole' ? C.concrete : C.roomCarpet)),
  ...PODS.map((p) => upper(p, C.tile)),
];
const talls = rooms.filter((r) => r.yb === G && r.yt === RC).map((r) => r.r);
/** An upper floor's rect, its edges stopped at the faces of the tall walls through it. */
function trim([x0, z0, x1, z1]) {
  const on = (c, a, b, axis) =>
    talls.some(([p0, q0, p1, q1]) =>
      axis === 'z'
        ? (Math.abs(p0 - c) < 1e-6 || Math.abs(p1 - c) < 1e-6) &&
          Math.min(q1, b) - Math.max(q0, a) > 0.01
        : (Math.abs(q0 - c) < 1e-6 || Math.abs(q1 - c) < 1e-6) &&
          Math.min(p1, b) - Math.max(p0, a) > 0.01,
    );
  return [
    on(x0, z0, z1, 'z') ? x0 + T : x0,
    on(z0, x0, x1, 'x') ? z0 + T : z0,
    on(x1, z0, z1, 'z') ? x1 - T : x1,
    on(z1, x0, x1, 'x') ? z1 - T : z1,
  ];
}
const inside = (p, q) =>
  p[0] >= q[0] - 1e-6 && p[1] >= q[1] - 1e-6 && p[2] <= q[2] + 1e-6 && p[3] <= q[3] + 1e-6;
const HOLES_UP = [WELL_MAIN, WELL_KITCHEN, WELL_EAST, HOLE];

add('slabs', [
  // Ground floors.
  ...rooms.filter((r) => r.yb === G && r.floor).flatMap((r) => union([r.r], [], 0, G, r.floor)),
  // Upper floors: each room its own color, the bathrooms cut out of their rooms, the wells.
  ...rooms
    .filter((r) => r.yb === U && r.floor)
    .flatMap((r) => {
      const pods = PODS.filter((p) => p !== r.r && inside(p, r.r));
      const holes = HOLES_UP.filter((h) => inside(h, r.r));
      return union([trim(r.r)], [...pods, ...holes], GC, U, r.floor);
    }),
  ...union([MEZZ], [[SHAFT_A[0] - T, SHAFT_A[1], SHAFT_B[2], SHAFT_A[3] + T]], GC, U, C.carpet),
  ...union([BALCONY], [], GC, U, C.stone),
  ...union([BUILDING], [], RC, ROOF, C.roof),
  // The forecourt and drive, and the service yard behind.
  box(-18, -166, 44, -148, 0, 0.1, C.paving),
  box(-24, -226, -16, -166 - T, 0, 0.1, C.paving),
]);

add('walls', [...roomWalls({ rooms, openings: OPENINGS, inside: C.inside, outside: C.outside })]);

add('stairs and rails', [
  // The main stair in the stair hall, rising north to the landing.
  {
    type: 'stairs',
    pos: [37.5, G, -178.5],
    yaw: 180,
    size: [3, U - G, 7],
    sides: 0.9,
    color: C.marble,
  },
  ...rail(36, -182, 36, -175.1, U),
  ...rail(39, -182, 39, -175.1, U),
  ...rail(36.05, -175, 38.95, -175, U),
  // The kitchen's service stair, rising south to the west cross landing.
  { type: 'stairs', pos: [-2.9, G, -192.5], yaw: 0, size: [1.8, U - G, 7], color: C.steel },
  // Its side rails stop 1.6 m short of the top, where the flight is nearly level with the
  // floor, so the linen room either side is reached from it.
  ...rail(-3.8, -195.9, -3.8, -190.6, U),
  ...rail(-2, -195.9, -2, -190.6, U),
  ...rail(-3.75, -196, -2.05, -196, U),
  // The east service stair along the gym's back wall, rising east.
  { type: 'stairs', pos: [36.5, G, -222.95], yaw: 90, size: [1.8, U - G, 7], color: C.steel },
  ...rail(33, -222, 40, -222, U),
  ...rail(33, -223.85, 33, -222.05, U),
  // The mezzanine's edge over the atrium; columns under it.
  ...rail(2.1, -180, 23.9, -180, U),
  ...[7, 13, 19].map((x) => box(x - 0.35, -180.7, x + 0.35, -180, G, GC, C.marble)),
  // The suite's balcony: a stone balustrade (solid, 1 m, so it can be vaulted: the way out
  // of the suite, a 4 m drop to the yard).
  box(-18.4, -219, -18.2, -209, U, U + 1, C.stone),
  box(-18.2, -219, -16.1, -218.8, U, U + 1, C.stone),
  box(-18.2, -209.2, -16.1, -209, U, U + 1, C.stone),
  drawn(-18.45, -219.05, -18.15, -208.95, U + 1, U + 1.06, C.marble),
  // Lift shafts: the gaps round them between the floors.
  box(18 - T, -192.6, 24 - T, -192.4, GC, U, C.inside),
  box(17.9, -196 + T, 18.1, -192.6, GC, U, C.inside),
  box(20.9, -196 + T, 21.1, -192.6, GC, U, C.inside),
  // Room 208's broken floor: rubble round the hole, the pile under it in the kitchen.
  drawn(HOLE[0] - 0.3, HOLE[1] - 0.2, HOLE[0] + 0.4, HOLE[3] + 0.3, U, U + 0.15, '#8a8278'),
  drawn(HOLE[2] - 0.2, HOLE[1] - 0.3, HOLE[2] + 0.5, HOLE[1] + 1.2, U, U + 0.22, '#7a7268'),
  // The pile under it: two steps of rubble (tops at 0.8 and 1.4), so the 4 m drop lands at
  // 2.8 m and nobody climbs back up (the hole's edge is 2.8 m over the pile's top).
  box(-15.5, -201.8, -11.8, -198.2, G, G + 0.6, '#7a7268'),
  box(-14.7, -201.2, -12.6, -199.2, G + 0.6, G + 1.2, '#8a8278'),
  drawn(-15.2, -200.6, -12.2, -199.9, G + 1.2, G + 1.45, '#6a6660', { pitch: 12, roll: -8 }),
  drawn(-13.4, -198.5, -12.1, -198.3, G + 0.6, G + 2.1, '#5a5650', { pitch: 25 }),
]);

// The roof's parapet, a cornice between the floors, the porte-cochère and the name.
const edges = [
  [-16, -224, 42, -224],
  [-16, -166, 42, -166],
  [-16, -224, -16, -166],
  [42, -224, 42, -166],
];
add('facade', [
  ...edges.flatMap(([x0, z0, x1, z1]) =>
    z0 === z1
      ? [
          box(x0 - 0.15, z0 - 0.15, x1 + 0.15, z0 + 0.15, ROOF, ROOF + 0.9, C.outside),
          drawn(x0 - 0.12, z0 - 0.17, x1 + 0.12, z0 + 0.17, GC - 0.1, U + 0.1, C.trim),
          drawn(x0 - 0.2, z0 - 0.22, x1 + 0.2, z0 + 0.22, ROOF + 0.8, ROOF + 0.95, C.trim),
        ]
      : [
          box(x0 - 0.15, z0 + 0.15, x0 + 0.15, z1 - 0.15, ROOF, ROOF + 0.9, C.outside),
          drawn(x0 - 0.17, z0 + 0.12, x0 + 0.17, z1 - 0.12, GC - 0.1, U + 0.1, C.trim),
          drawn(x0 - 0.22, z0 + 0.2, x0 + 0.22, z1 - 0.2, ROOF + 0.8, ROOF + 0.95, C.trim),
        ],
  ),
  // The porte-cochère over the entrance: a slab on four columns, its fascia in bronze.
  box(4, -165.75, 22, -159, 4.4, 4.75, C.outside),
  drawn(4, -159.05, 22, -158.95, 4.3, 4.85, C.bronze),
  ...[
    [4.6, -159.6],
    [21.4, -159.6],
  ].map(([x, z]) => box(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0.1, 4.4, C.marble)),
  // The hotel's name over the canopy (gold letters as bars) and a bronze frame.
  ...Array.from({ length: 9 }, (_, i) =>
    drawn(8.6 + i * 1.0, -165.9 + 0.12, 9.2 + i * 1.0, -165.9 + 0.16, 5.4, 6.4, C.gold),
  ),
  // Window frames: bronze mullions on the lobby's curtain glass.
  ...[4.7, 6, 7.3, 18.7, 20, 21.3].map((x) =>
    drawn(x - 0.04, -165.86, x + 0.04, -165.8, G + 0.6, G + 6.8, C.bronze),
  ),
]);

// ---------------------------------------------------------------------------------------
// Dressing: the luxury underneath, the evacuation on top. No loot.

add('lobby', [
  // Reception under the mezzanine, its key wall behind: the wall stands in front of both
  // ballroom doors, so the entrance and the stair hall don't look through to the stage.
  P('reception-desk', 9, -186.5, G),
  box(4.8, -192.4, 13.4, -192, G, GC - 0.6, C.woodDark),
  ...Array.from({ length: 6 }, (_, i) =>
    drawn(5.8 + i * 1.1, -191.98, 6.5 + i * 1.1, -191.95, G + 1.6, G + 2.6, C.gold),
  ),
  // The atrium: a round marble table with flowers, lounges, luggage, chandeliers.
  { type: 'cylinder', pos: [13, G, -174.5], radius: 1.3, height: 0.85, sides: 12, color: C.marble },
  P('potted-plant', 13, -174.5, G + 0.85),
  ...lounge(6.5, -175.5, G, '#6a1e26'),
  ...lounge(19.5, -175.5, G, '#6a1e26'),
  P('luggage-cart', 16.5, -186, G, 20),
  P('luggage-cart', 21.5, -181.8, G, -70),
  ...[
    [8, -172],
    [18, -172],
  ].map(([x, z]) => P('chandelier', x, z, RC)),
  P('chandelier', 13, -188, GC),
  ...[3, 23].flatMap((x) => [P('potted-plant', x, -167.2, G), P('potted-plant', x, -179, G)]),
  // Two marble plinths with bronzes either side of the way from the stair hall, so the hall
  // doesn't look across the whole lobby.
  ...[-178.2, -173.8].flatMap((z) => [
    box(20.4, z - 0.6, 21.6, z + 0.6, G, G + 1.9, C.marble),
    drawn(20.7, z - 0.3, 21.3, z + 0.3, G + 1.9, G + 3, C.bronze),
  ]),
  // The checkpoint the military left inside the doors: sandbags staggered across the way in.
  P('sandbag-wall', 9.2, -169.5, G),
  P('sandbag-wall', 16.8, -169.5, G),
  P('sandbag-wall', 13, -171.8, G),
  // The lifts: steel doors, lift A shut, lift B's forced, its car crashed at the bottom.
  drawn(18.2, -192.4, 20.8, -192.36, G, G + 2.4, C.steel),
  drawn(18.2, -192.4, 20.8, -192.36, U, U + 2.4, C.steel),
  drawn(21.1, -192.4, 21.8, -192.36, G, G + 2.4, C.steel),
  drawn(23.2, -192.4, 23.9, -192.36, G, G + 2.4, C.steel),
  drawn(21.1, -192.4, 21.8, -192.36, U, U + 2.4, C.steel),
  drawn(23.2, -192.4, 23.9, -192.36, U, U + 2.4, C.steel),
  box(21.25, -195.75, 23.75, -193.6, G, G + 1.2, '#5a5e64', { pitch: 0 }),
  drawn(21.3, -195.7, 23.7, -193.65, G + 1.2, G + 1.25, '#3d4148'),
  box(18.2, -195.8, 20.8, -192.7, G, G + 0.1, '#5a5e64'),
  // The mezzanine: the lobby bar, lounges, the piano by the rail.
  P('back-bar', 15.6, -195.65, U),
  P('bar-counter', 15.6, -193.6, U),
  ...Array.from({ length: 4 }, (_, i) => P('bar-stool', 14.1 + i, -192.3, U)),
  ...lounge(9, -189, U, '#2a3a4a', 90),
  ...lounge(4.5, -192.5, U, '#2a3a4a'),
  P('grand-piano', 6, -183.5, U, 160),
  P('potted-plant', 2.8, -181, U),
  P('potted-plant', 23.2, -181, U),
]);

add('west wing', [
  // Restaurant: tables, a booth by the west windows, the bar on the lobby wall.
  ...[
    [-12, -170],
    [-12, -176],
    [-7, -172],
    [-7, -178.5],
    [-2, -174],
  ].map(([x, z], i) => P(i % 3 === 2 ? 'dining-set' : 'table-and-chairs', x, z, G, i % 2 ? 90 : 0)),
  P('booth-seat', -14.9, -182.5, G, 90),
  P('back-bar', 1.65, -181.5, G, -90),
  P('bar-counter', -0.3, -181.5, G, -90),
  P('espresso-bar', -14, -184.9, G),
  P('potted-plant', -15, -167.2, G),
  // Kitchen: steel counters, the line under a hood, fridges, the stair up.
  box(-15.6, -192, -13, -188, G, G + 0.9, C.steel),
  box(-11, -194.5, -6, -193.5, G, G + 0.9, C.steel),
  box(-11, -191, -6, -190, G, G + 0.9, C.steel),
  drawn(-11.2, -194.8, -5.8, -193.2, GC - 1, GC - 0.4, C.steel),
  ...[-15.4, -14.5, -13.6].map((x) => P('fridge-v2', x, -186.75, G, 180)),
  P('sink-counter', 0.4, -200, G, -90),
  // Laundry: washers along the west wall, linen shelves, carts.
  ...[-210.5, -209, -207.5, -206, -204.5].flatMap((z) => [
    box(-15.9, z - 0.65, -14.7, z + 0.65, G, G + 1.1, '#e6e4de'),
    {
      type: 'cylinder',
      pos: [-14.68, G + 0.55, z],
      radius: 0.38,
      height: 0.02,
      sides: 10,
      roll: 90,
      color: '#3d4148',
      collide: false,
    },
  ]),
  ...[-13, -2.5].map((x) =>
    P('store-shelf', x, -213.4, G, 0, {
      'goods-a': C.linen,
      'goods-b': '#bdb8aa',
      'goods-c': '#f2f0ea',
    }),
  ),
  P('roll-cage', -10.5, -205, G, 30, { load: C.linen, 'load-dark': '#bdb8aa' }),
  P('roll-cage', -3, -207.5, G, -15, { load: C.linen, 'load-dark': '#bdb8aa' }),
  P('janitor-cart', -4, -203.4, G),
  // Receiving: crates, pallets, bins by the dock.
  ...cases(-12, -222.5),
  ...cases(-10.6, -222.5),
  ...cases(-6, -218.6, 1.2, 2.4),
  P('wood-pallet-boxes', -2.5, -222.5, G),
  P('wood-pallet-boxes', -1, -217, G, 90),
  P('roll-cage', -13.5, -216, G, 10),
  // Outside the dock: a skip, bins, under the suite's balcony.
  P('skip-bin', -20.5, -214, 0.1, 90),
  P('wheelie-bin', -17, -198, 0.1, 90),
  P('wheelie-bin', -17, -196.8, 0.1, 90),
]);

add('ballroom', [
  // The military's command post: a stage with the big map, ops tables, comms racks, cots,
  // stacked cases for cover, sandbags at the doors; the chandeliers still hang.
  box(6, -224 + T, 20, -220, G, G + 0.6, C.woodDark),
  box(6, -220, 20, -219.4, G, G + 0.3, C.woodDark),
  drawn(7, -223.88, 19, -223.85, G + 1.6, G + 5, '#2f4a3a'),
  ...Array.from({ length: 5 }, (_, i) =>
    drawn(
      8 + i * 2.4,
      -223.85,
      9.6 + i * 2.4,
      -223.82,
      G + 2.4,
      G + 4.2,
      i % 2 ? '#c9c3b0' : '#8a9a7a',
    ),
  ),
  P('ops-table', 13, -222, G + 0.6),
  P('ops-table', 10, -209, G),
  P('ops-table', 16.5, -213, G, 90),
  ...[-215.5, -214.8, -214.1, -213.4].map((z) => P('server-rack', 22.8, z, G, -90)),
  ...[-208, -207.3, -206.6].map((z) => P('server-rack', 22.8, z, G, -90)),
  ...[-215, -212.5, -210, -207.5, -205, -202.5].flatMap((z) => [
    P('bunk-bed', 3.3, z, G),
    P('bunk-bed', 5.4, z, G),
  ]),
  ...cases(9.5, -202.5, 2.4, 1.2),
  ...cases(17.5, -205.5),
  ...cases(7.5, -216.5, 1.2, 2.4),
  ...cases(19.5, -218.5, 2.4, 1.2),
  ...cases(13.5, -216.8),
  ...cases(13.2, -211.4, 1.2, 3), // the middle of the room, breaking the door-to-door diagonals
  P('sandbag-wall', 4, -198.6, G),
  P('sandbag-wall', 10, -198.6, G),
  P('barrier-block', 21.5, -200, G),
  P('jersey-barrier', 13, -205, G, 90),
  ...[
    [7, -203],
    [17, -203],
    [7, -215],
    [17, -215],
  ].map(([x, z]) => P('chandelier', x, z, RC)),
  P('flood-light', 3.5, -222.8, G, 150),
]);

add('east wing', [
  // Stair hall: a bench, plants, a luggage cart, a sandbag post under the stair.
  P('mall-bench', 30, -170, G),
  P('potted-plant', 40.8, -167.2, G),
  P('potted-plant', 26, -184.8, G),
  P('luggage-cart', 33, -181, G, 90),
  P('sandbag-wall', 32.5, -175.5, G, 90),
  // Bell room: carts and stored cases.
  P('luggage-cart', 25.5, -192, G, 90),
  P('luggage-cart', 27.8, -194.6, G),
  box(28.9, -195.8, 29.8, -190, G, G + 1.9, C.woodDark),
  // The staff corridor: cages staggered so its length doesn't make one line.
  P('roll-cage', 30.7, -196, G, 90, { load: C.linen, 'load-dark': '#bdb8aa' }),
  P('roll-cage', 32.3, -201.5, G, 90),
  // Security: the camera wall, desks, lockers, the armory's racks for soldiers' kit.
  P('cctv-wall', 37.5, -197.85, G + 1.2),
  desk(37.5, -195.8, G, 0, 2.4),
  P('office-chair', 37, -194.8, G, 180),
  P('locker-bank', 41.6, -188.5, G, -90),
  P('server-rack', 33.6, -188, G, 90),
  P('sandbag-wall', 38.5, -186.9, G),
  // Staff quarters: bunks and lockers.
  ...[-208.8, -206.6].flatMap((z) => [P('bunk-bed', 35, z, G, 90), P('bunk-bed', 39, z, G, 90)]),
  P('locker-bank', 41.6, -201, G, -90),
  P('locker-bank', 37.5, -198.4, G),
  // Restrooms: stalls and a vanity.
  ...[25.6, 27.2, 28.8].flatMap((x) => [
    box(x - 0.8, -209.9, x - 0.75, -207.9, G, G + 2, C.marble),
    P('toilet', x, -209.6, G),
  ]),
  box(29.55, -209.9, 29.6, -207.9, G, G + 2, C.marble),
  P('sink-counter', 25.6, -196.4, G),
  // Gym: treadmills facing the windows, benches, the dumbbells.
  ...[-217, -215.5, -214].map((z) => P('treadmill', 39.5, z, G, 90)),
  P('weight-bench', 29, -214, G),
  P('weight-bench', 34, -213, G, 90),
  P('dumbbell-rack', 24.45, -221.5, G, 90),
  drawn(24.12, -221, 24.15, -211, G + 0.4, G + 2.4, '#bcd0d4'),
]);

add('upper floor', [
  ...guestNodes,
  // Corridor dressing: carts, barricades at the jogs, sconces.
  P('janitor-cart', -4.6, -177.5, U, 90),
  P('luggage-cart', -6.3, -170.5, U, 90),
  P('couch-fallen', -9.2, -201, U, 90),
  P('janitor-cart', 34.4, -197.5, U, 90),
  P('luggage-cart', 29.6, -219, U, 90),
  P('janitor-cart', 29.9, -205.6, U, 90),
  P('janitor-cart', -1.2, -186.6, U),
  ...sconces('z', -7, -186, -166, U, 1),
  ...sconces('z', -4, -186, -166, U, -1),
  ...sconces('z', 32, -205, -186, U, 1),
  ...sconces('z', 35, -205, -186, U, -1),
  ...sconces('z', 29, -224, -208, U, 1),
  ...sconces('z', -10, -204, -189, U, 1),
  // The landing: a console, plants.
  P('potted-plant', 40.8, -167.2, U),
  P('potted-plant', 25.2, -167.2, U),
  P('mall-bench', 30, -167, U),
  // Linen room.
  P('store-shelf', -5.5, -195.4, U, 0, {
    'goods-a': C.linen,
    'goods-b': '#bdb8aa',
    'goods-c': '#f2f0ea',
  }),
  P('roll-cage', 0.8, -194.5, U, 0, { load: C.linen, 'load-dark': '#bdb8aa' }),
]);

add('presidential suite', [
  // Foyer.
  P('floor-rug', -8.5, -206, U + 0.005, 0, { rug: '#6a1e26' }),
  P('chandelier', -8.5, -206, RC),
  P('potted-plant', -11.3, -204.8, U),
  P('potted-plant', -5.7, -204.8, U),
  // Study: the desk, books, the safe.
  desk(-14.2, -207.45, U, 0, 1.8),
  P('office-chair', -14.2, -206.6, U, 180),
  P('bookcase-tall', -15.65, -205.65, U, 90),
  P('office-safe', -12.7, -207.45, U),
  // Pantry: a bar and a fridge.
  P('back-bar', -1.5, -204.35, U, 180),
  P('fridge-v2', 1.3, -207, U, -90),
  // Living room: the piano, lounges, dining, a bar on the bathroom wall, chandeliers.
  P('grand-piano', -13, -221.2, U, 30),
  ...lounge(-11, -213.5, U, '#c8a24b', 90),
  P('dining-set', -8.5, -221.5, U, 90),
  P('tech-wall-display', -14, -208.17, U, 180),
  P('chandelier', -11, -213.5, RC),
  P('chandelier', -9.5, -220.5, RC),
  // Bedroom: the bed facing the windows, a wardrobe, a TV.
  P('hotel-bed', -2, -222.7, U),
  P('wardrobe', 1.6, -216.5, U, -90),
  tv(-2, -214.42, U, 180),
  // Bathroom: a tub in the middle, a vanity, a toilet.
  P('bathtub', -2, -211, U, 90),
  P('sink-counter', -4.5, -208.4, U, 180),
  P('toilet', 1.5, -209, U, -90),
  // Balcony: loungers, a parasol.
  P('sun-lounger', -17.2, -217.3, U, 0),
  P('sun-lounger', -17.2, -214.7, U, 0),
  P('parasol', -17.6, -210.4, U),
]);

add('grounds', [
  // The drive: cars left in the evacuation, the military's line of blocks and wire across
  // it (gaps to walk through), sandbags by the canopy, flood lights.
  P('car', 8, -162, 0.1, 80),
  P('car', 18.5, -161.2, 0.1, 100),
  P('car', -9, -157, 0.1, 15),
  P('car', 33, -158.5, 0.1, -20),
  ...[-12, -7.5, 1, 5.5, 20.5, 25, 34, 38.5].map((x) => P('barrier-block', x, -151.5, 0.1)),
  ...[-9.75, 3.25, 22.75, 36.25].map((x) => P('barbed-wire', x, -151.5, 0.1)),
  P('sandbag-wall', 1.5, -163, 0.1, 90),
  P('sandbag-wall', 24.5, -163, 0.1, 90),
  P('jersey-barrier', -2.5, -160, 0.1, 30),
  P('jersey-barrier', 29, -163.8, 0.1),
  P('flood-light', -14, -165, 0.1, 180),
  P('flood-light', 40, -165, 0.1, 180),
  ...[-14, 0, 26, 40].map((x) => P('street-lamp', x, -149.5, 0.1)),
]);

// ---------------------------------------------------------------------------------------
// Into the map

const map = JSON.parse(readFileSync(FILE, 'utf8'));
const replaced = (n) => n.type === 'group' && ['hotel', 'hotel-floorplan'].includes(n.name);
const gone = map.nodes.filter(replaced);
map.nodes = swapIn(map.nodes, replaced, group('hotel', out, keptPlace(map.nodes, 'hotel')));

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(`hotel: ${count(out)} nodes in ${out.length} groups; took out ${gone.length} groups`);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
