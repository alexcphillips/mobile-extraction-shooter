// d2's nightclub (2026-11-15, the user's request: colorful and luxurious, "not a tiny one":
// a long bar, a dance area, a DJ booth, seating, a kitchen, a second floor with a pool table
// and other entertainment, a balcony with a pool, and more good ideas). Built on the user's
// L of floors (`nightclub-floors`, x 71..131, z −227.5..−167.5), written into
// content/maps/d2.json as one group named `nightclub`. Re-runnable: it replaces its own group,
// and on the first run takes out `nightclub-floors`. It leaves the rest of d2 alone.
//
// Plan (docs/design/maps/d2.md → The nightclub has the why):
// - Three blocks of the user's L: the west wing (bar lounge below, games lounge above), the
//   main hall (north-east, double height to 10 m: stage and DJ booth, LED dance floor, a
//   mezzanine round two sides), and the south-east block (lobby, cloakroom, security,
//   restrooms, kitchen, storeroom below; VIP lounge, karaoke rooms, green room, casino and
//   the manager's office above).
// - The L's inner corner is the entrance courtyard; over its north half, the pool balcony
//   off the games lounge and the VIP lounge, with an outdoor stair down to the courtyard.
// - Three ways up (grand stair in the lobby, staff stair in the storeroom, the balcony's
//   outdoor stair), so the two floors make loops; ways in from the courtyard (main doors,
//   the bar's terrace doors, the security door), the kitchen's service door, the hall's and
//   the bar's fire exits.
// - No loot yet (loot comes last). Colorful: baked colors only, so the light is in the
//   colors (LED tiles, neon tubes, the LED wall, lit strips).
//
// Usage: node scripts/build-d2-nightclub.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { along, box, drawn, group, prefab, r2 } from './mapkit/nodes.mjs';
import { roomWalls, union } from './mapkit/rooms.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');

// Levels.
const G = 0.2; // ground floor (slab 0..0.2, as the user's)
const GC = 5.2; // ground ceiling: the upper floor's underside
const U = 5.4; // upper floor
const RC = 10; // under the roof
const ROOF = 10.2;
const T = 0.1;

const C = {
  inside: '#2a1f3d',
  outside: '#1d1b26',
  roof: '#121218',
  gold: '#c8a24b',
  wood: '#3a2418',
  steel: '#8a8e94',
  glass: '#9fd0d8',
  stone: '#e6e0d3',
  paving: '#8d8a84',
  stage: '#1a1a22',
  tile: '#7fd0dc',
  water: '#3fb8c8',
  magenta: '#ff3fa4',
  cyan: '#3fe0ff',
  violet: '#8a4bff',
  yellow: '#ffd23f',
  lime: '#7dff4a',
  orange: '#ff8a3d',
};
const NEON = [C.magenta, C.cyan, C.violet, C.yellow, C.lime, C.orange];

// ---------------------------------------------------------------------------------------
// The rooms: [x0, z0, x1, z1], walls from yb to yt, and the floor's color.

const ground = (r, floor) => ({ r, yb: G, yt: GC, floor });
const upper = (r, floor) => ({ r, yb: U, yt: RC, floor });
const R = {
  // Ground.
  bar: ground([71, -227.5, 101, -197.5], '#3a2418'),
  hall: { r: [101, -227.5, 131, -197.5], yb: G, yt: RC, floor: '#16151c' },
  lobby: ground([101, -197.5, 113, -181], '#d8d2c4'),
  cloak: ground([101, -181, 113, -175], '#3a2a4a'),
  security: ground([101, -175, 113, -167.5], '#4f5254'),
  men: ground([113, -197.5, 122, -189.5], '#cfd6dc'),
  women: ground([122, -197.5, 131, -189.5], '#e6d6dc'),
  service: ground([113, -189.5, 131, -187], '#5a5d5f'),
  kitchen: ground([113, -187, 131, -175], '#a8a49b'),
  store: ground([113, -175, 131, -167.5], '#5a5d5f'),
  // Upper.
  games: upper([71, -227.5, 101, -197.5], '#1f3a4a'),
  cigar: upper([71, -227.5, 79, -219.5], '#3a2418'),
  vip: upper([101, -197.5, 131, -184], '#4a1428'),
  karaoke1: upper([101, -184, 107, -176], '#2a1f3d'),
  karaoke2: upper([107, -184, 113, -176], '#2a1f3d'),
  green: upper([101, -176, 113, -167.5], '#3a2a4a'),
  corridor: upper([113, -184, 131, -181.5], '#3a2418'),
  casino: upper([113, -181.5, 131, -173], '#1f4a2a'),
  office: upper([113, -173, 131, -167.5], '#3a2418'),
};
// The mezzanine stops at the faces of the hall's walls, which run up through it.
const MEZZ = [
  [101 + T, -227.5 + T, 107, -203.5],
  [101 + T, -203.5, 131 - T, -197.5 - T],
];
const BALCONY = [71, -197.5, 101, -184];
const COURTYARD = [71, -197.5, 101, -167.5];
const POOL = [77, -194, 91, -188.5];
const WELL_GRAND = [105, -192.5, 108, -184]; // the lobby's grand stair
const WELL_STAFF = [114, -169.5, 122.5, -167.5]; // the storeroom's staff stair
const BUILDING = [
  [71, -227.5, 131, -197.5],
  [101, -197.5, 131, -167.5],
];

/** A doorway: on the wall along `axis` at line c, centered at, w wide, from floor y up h. */
const op = (axis, c, at, w, y, h, more = {}) => ({ axis, c, at, w, y, h, ...more });
const door = (axis, c, at, y, w = 1.2, more = {}) =>
  op(axis, c, at, w, y, 2.2, { door: {}, ...more });
const OPENINGS = [
  // The hall's west wall: arches from the bar (ground), and the games lounge onto the
  // mezzanine (upper), staggered so they don't overlap along the wall.
  ...[-224, -214.5, -205].map((z) => op('z', 101, z, 4, G, 3.6)),
  ...[-218.5, -209.5, -200.3].map((z) => op('z', 101, z, 3, U, 2.8)),
  // The hall's south wall: the lobby's wide way in; the VIP lounge onto the mezzanine.
  op('x', -197.5, 106, 6, G, 3.6),
  ...[111.5, 117.5, 125.5].map((x) => op('x', -197.5, x, 3, U, 2.8)),
  door('z', 131, -212, G, 1.6), // the hall's fire exit
  // Bar lounge: terrace doors under the balcony, a fire exit west.
  op('x', -197.5, 80, 2.4, G, 2.8),
  op('x', -197.5, 92, 2.4, G, 2.8),
  door('z', 71, -212, G, 1.6),
  // Lobby: main doors on the courtyard, the coat check's window and door, staff door east.
  op('z', 101, -190, 4, G, 3.4),
  op('x', -181, 106, 3, G + 1, 1.3),
  door('x', -181, 102.6, G, 1),
  door('z', 113, -188.25, G, 1.2),
  // Back of house.
  door('x', -175, 110.8, G, 1), // cloakroom → security
  door('z', 101, -170.5, G, 1.2), // security's staff door
  door('x', -189.5, 117, G), // men
  door('x', -189.5, 126, G), // women
  op('x', -187, 129.5, 1.6, G, 2.4), // service corridor → kitchen
  door('z', 131, -181, G, 1.6), // kitchen's service door
  op('x', -175, 129.5, 1.6, G, 2.4), // kitchen → storeroom
  door('z', 131, -171.25, G, 1.4), // storeroom's back door
  // Upper: games lounge onto the balcony; the cigar lounge.
  ...[76, 84, 91].map((x) => op('x', -197.5, x, 3.6, U, 2.8)),
  door('x', -219.5, 75, U),
  // VIP lounge onto the balcony; karaoke rooms; the corridor; casino; office; green room.
  op('z', 101, -190.5, 3, U, 2.8),
  door('x', -184, 104, U),
  door('x', -184, 110.5, U),
  op('x', -184, 116, 2, U, 2.4),
  door('x', -181.5, 122, U, 1.6),
  door('x', -173, 128, U),
  door('z', 113, -171.5, U),
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
const lounge = (x, z, y, couch = '#7a1f3a') => [
  P('floor-rug', x, z, y + 0.005, 0, { rug: '#2a1f3d' }),
  P('couch', x, z - 1.35, y, 0, { fabric: couch }),
  P('couch', x, z + 1.35, y, 180, { fabric: couch }),
  P('lounge-table', x, z, y),
];

/** A tree in a planter on paving (its trunk reaches 0.5 m below its origin). */
const planterTree = (x, z, y) => [
  box(x - 1.5, z - 1.5, x + 1.5, z - 1.25, y, y + 0.6, C.stone),
  box(x - 1.5, z + 1.25, x + 1.5, z + 1.5, y, y + 0.6, C.stone),
  box(x - 1.5, z - 1.25, x - 1.25, z + 1.25, y, y + 0.6, C.stone),
  box(x + 1.25, z - 1.25, x + 1.5, z + 1.25, y, y + 0.6, C.stone),
  drawn(x - 1.25, z - 1.25, x + 1.25, z + 1.25, y, y + 0.5, '#5a4632'),
  prefab('broadleaf-tree', x, z, {}, y + 0.5),
];

/** Neon tubes on a ceiling at y, in a grid over a rect, cycling colors. */
function ceilingNeon([x0, z0, x1, z1], y, step = 5) {
  const nodes = [];
  let k = 0;
  for (let z = z0 + step / 2; z < z1; z += step)
    for (let x = x0 + step / 2; x < x1; x += step)
      nodes.push(P('neon-tube', x, z, y - 0.15, 0, { neon: NEON[k++ % NEON.length] }));
  return nodes;
}

// ---------------------------------------------------------------------------------------
// Shell

const rooms = Object.values(R);
add('slabs', [
  // Floors: each room its own color (the cigar lounge's cut out of the games lounge's).
  // Upper floors beside the hall stop at its walls' faces (they run up through the floor).
  ...Object.entries(R).flatMap(([name, { r, yb, floor }]) =>
    union(
      [
        name === 'games'
          ? [r[0], r[1], 101 - T, r[3]]
          : name === 'vip'
            ? [r[0], -197.5 + T, r[2], r[3]]
            : r,
      ],
      [
        ...(name === 'games' ? [R.cigar.r] : []),
        ...(name === 'vip' ? [WELL_GRAND] : []),
        ...(name === 'office' ? [WELL_STAFF] : []),
      ],
      yb === G ? 0 : GC,
      yb === G ? G : U,
      floor,
    ),
  ),
  ...union(MEZZ, [], GC, U, '#16151c'),
  ...union([BALCONY], [POOL], GC, U, C.stone),
  ...union([COURTYARD], [], 0, G, C.paving),
  ...union(BUILDING, [], RC, ROOF, C.roof),
]);

add('walls', [...roomWalls({ rooms, openings: OPENINGS, inside: C.inside, outside: C.outside })]);

add('stairs and rails', [
  // The grand stair in the lobby, rising north to the VIP lounge.
  {
    type: 'stairs',
    pos: [106.5, G, -188.25],
    yaw: 180,
    size: [3, U - G, 8.5],
    sides: 0.9,
    color: C.stone,
  },
  ...rail(105, -192.5, 105, -184.1, U),
  ...rail(108, -192.5, 108, -184.1, U),
  // The staff stair in the storeroom, rising east to the manager's office.
  { type: 'stairs', pos: [118.25, G, -168.55], yaw: 90, size: [1.8, U - G, 8.5], color: C.steel },
  ...rail(114, -169.5, 122.5, -169.5, U),
  ...rail(114, -169.45, 114, -167.6, U),
  // The balcony's outdoor stair, rising north from the courtyard.
  {
    type: 'stairs',
    pos: [73.5, G, -179.65],
    yaw: 180,
    size: [3, U - G, 8.7],
    sides: 0.9,
    color: C.stone,
  },
  // Solid sloped rails up both its sides (the stairs' own sides are drawn only), so it
  // isn't a 5 m drop off the edge near the top.
  ...[71.9, 75.1].map((x) =>
    along([x, G + 0.55, -175.3], [x, U + 0.55, -184], 0.1, 1.1, C.outside, { collide: true }),
  ),
  // The mezzanine's edge over the hall, and the balcony's.
  ...rail(107, -227.4, 107, -203.5, U),
  ...rail(107.05, -203.5, 130.9, -203.5, U),
  ...rail(71.05, -184, 72, -184, U),
  ...rail(75, -184, 100.9, -184, U),
  ...rail(71, -197.4, 71, -184.05, U),
  // Columns under the balcony's edge.
  ...[78.5, 86.5, 95].map((x) => box(x - 0.3, -184.6, x + 0.3, -184, G, GC, C.stone)),
]);

// The roof's parapet and the neon round it; the blade sign at the lobby's corner.
const parapet = [
  [71, -227.5, 131, -227.5],
  [71, -197.5, 101, -197.5],
  [101, -167.5, 131, -167.5],
  [71, -227.5, 71, -197.5],
  [101, -197.5, 101, -167.5],
  [131, -227.5, 131, -167.5],
];
add('facade', [
  ...parapet.flatMap(([x0, z0, x1, z1], i) =>
    z0 === z1
      ? [
          box(x0 - 0.15, z0 - 0.15, x1 + 0.15, z0 + 0.15, ROOF, ROOF + 0.8, C.outside),
          drawn(
            x0 - 0.15,
            z0 - 0.17,
            x1 + 0.15,
            z0 + 0.17,
            ROOF + 0.3,
            ROOF + 0.45,
            i % 2 ? C.cyan : C.magenta,
          ),
        ]
      : [
          box(x0 - 0.15, z0 + 0.15, x0 + 0.15, z1 - 0.15, ROOF, ROOF + 0.8, C.outside),
          drawn(
            x0 - 0.17,
            z0 + 0.15,
            x0 + 0.17,
            z1 - 0.15,
            ROOF + 0.3,
            ROOF + 0.45,
            i % 2 ? C.magenta : C.cyan,
          ),
        ],
  ),
  // Lit strips round the floors' edges outside, at the upper floor.
  drawn(70.85, -227.65, 131.15, -227.6, GC, GC + 0.15, C.violet),
  drawn(131.1, -227.5, 131.15, -167.5, GC, GC + 0.15, C.violet),
  // The blade sign: a lit panel standing out from the corner, color blocks for its letters.
  drawn(100.3, -182.6, 100.9, -181.4, 5.6, 9.8, C.magenta),
  ...[0, 1, 2, 3].flatMap((k) => [
    drawn(100.28, -182.4, 100.3, -181.6, 6 + k * 1, 6.8 + k * 1, NEON[(k + 1) % 6]),
    drawn(100.9, -182.4, 100.92, -181.6, 6 + k * 1, 6.8 + k * 1, NEON[(k + 1) % 6]),
  ]),
]);

// ---------------------------------------------------------------------------------------
// Ground floor

add('bar lounge', [
  // The long bar: six counters (24.6 m) before six back bars, stools, neon over the shelves.
  ...[75.4, 79.4, 83.4, 87.4, 91.4, 95.4].map((x) => P('back-bar', x, -227.15, G)),
  ...[75.5, 79.6, 83.7, 87.8, 91.9, 96].map((x) => P('bar-counter', x, -224.4, G)),
  ...Array.from({ length: 24 }, (_, i) => P('bar-stool', 74 + i, -222.8, G)),
  ...Array.from({ length: 10 }, (_, i) =>
    P('neon-tube', 74.4 + i * 2.4, -227.3, G + 3.3, 0, { neon: NEON[i % 6] }),
  ),
  drawn(73.5, -223.66, 98, -223.6, G, G + 0.04, C.magenta),
  // Gold columns and a wine wall breaking the room in two.
  ...[-217.5, -207.5].map((z) => box(85.6, z - 0.4, 86.4, z + 0.4, G, GC, C.gold)),
  box(82, -212.75, 90, -212.25, G, G + 2.8, C.wood),
  ...[0.6, 1.3, 2.0].flatMap((y, k) => [
    drawn(82.3, -212.77, 89.7, -212.75, G + y, G + y + 0.35, NEON[k + 2]),
    drawn(82.3, -212.25, 89.7, -212.23, G + y, G + y + 0.35, NEON[k + 3]),
  ]),
  // Lounge seating.
  ...lounge(76, -216, G),
  ...lounge(76, -207.5, G, '#2f6f73'),
  ...lounge(76, -200.8, G),
  ...lounge(95.5, -216, G, '#2f6f73'),
  ...lounge(95.5, -207.5, G),
  ...[
    [71.8, -219.8],
    [100.2, -219.8],
    [71.8, -198.3],
  ].map(([x, z]) => P('potted-plant', x, z, G)),
  ...ceilingNeon([71, -221, 101, -197.5], GC, 6),
]);

const tiles = [];
for (let i = 0; i < 8; i++)
  for (let j = 0; j < 7; j++)
    tiles.push(P('led-tile', 112 + i * 2, -219 + j * 2, G, 0, { led: NEON[(i + j) % 6] }));
add('main hall', [
  // The stage and DJ booth on the north wall, speaker stacks, steps at both ends.
  box(112, -227.4, 126, -222, G, G + 1, C.stage),
  box(110.5, -225.5, 111.25, -223.5, G, G + 0.33, C.stage),
  box(111.25, -225.5, 112, -223.5, G, G + 0.66, C.stage),
  box(126, -225.5, 126.75, -223.5, G, G + 0.66, C.stage),
  box(126.75, -225.5, 127.5, -223.5, G, G + 0.33, C.stage),
  P('dj-booth', 119, -224.2, G + 1),
  P('speaker-stack', 113.2, -225.5, G + 1),
  P('speaker-stack', 124.8, -225.5, G + 1),
  // The LED wall behind it.
  ...Array.from({ length: 24 }, (_, k) => {
    const [i, j] = [k % 6, Math.floor(k / 6)];
    return drawn(
      110 + i * 3,
      -227.4,
      112.9 + i * 3,
      -227.39,
      G + 1.4 + j * 1.8,
      G + 3.1 + j * 1.8,
      NEON[(i + j) % 6],
    );
  }),
  // The LED dance floor, go-go podiums at its corners, the truss and a disco ball over it.
  ...tiles,
  ...[
    [109, -218.5],
    [129, -218.5],
    [109, -207.5],
    [129, -207.5],
  ].flatMap(([x, z], k) => [
    box(x - 0.8, z - 0.8, x + 0.8, z + 0.8, G, G + 1, C.stage),
    drawn(x - 0.8, z - 0.8, x + 0.8, z + 0.8, G + 1, G + 1.01, NEON[k + 1]),
    drawn(x - 0.04, z - 0.04, x + 0.04, z + 0.04, G + 1, G + 4.2, C.steel),
  ]),
  ...[
    [110.2, -221],
    [127.8, -221],
    [110.2, -205],
    [127.8, -205],
  ].map(([x, z]) => box(x - 0.2, z - 0.2, x + 0.2, z + 0.2, G, 8.6, C.stage)),
  drawn(110, -221.2, 128, -220.8, 8.6, 8.8, C.stage),
  drawn(110, -205.2, 128, -204.8, 8.6, 8.8, C.stage),
  drawn(110, -221, 110.4, -205, 8.6, 8.8, C.stage),
  drawn(127.6, -221, 128, -205, 8.6, 8.8, C.stage),
  ...Array.from({ length: 8 }, (_, k) =>
    drawn(
      112 + k * 2,
      k % 2 ? -205.3 : -221.1,
      112.4 + k * 2,
      k % 2 ? -204.9 : -220.7,
      8.3,
      8.6,
      NEON[k % 6],
    ),
  ),
  P('disco-ball', 119, -213, RC),
  P('laser-pillar', 113, -204.3, G),
  P('laser-pillar', 125, -204.3, G),
  // Light bars up the east wall.
  ...Array.from({ length: 9 }, (_, k) => k)
    .filter((k) => k !== 4) // the fire exit
    .map((k) => drawn(130.89, -225 + k * 3, 130.9, -224.7 + k * 3, G + 1, RC - 1, NEON[k % 6])),
  // Booths under the south mezzanine; high tables round the floor's east side.
  ...[116, 119.5, 123, 126.5].flatMap((x) => [
    P('couch', x, -198.05, G, 180, { fabric: '#7a1f3a' }),
    P('lounge-table', x, -199.6, G),
  ]),
  ...[-215.3, -209.4].map((z) => P('cafe-table', 129.6, z, G)),
]);

add('lobby and back of house', [
  // Lobby: a bouncer's podium, the coat check counter, a fish tank, a chandelier.
  box(102.2, -194.3, 102.8, -193.7, G, G + 1.1, C.gold),
  box(104.5, -182, 107.5, -181.1, G, G + 1, C.wood),
  P('aquarium-stand', 110.8, -195.9, G),
  P('aquarium-stand', 110.8, -193.9, G),
  drawn(106, -190, 108, -188, GC - 1.2, GC - 0.05, C.yellow),
  P('potted-plant', 101.8, -196.6, G),
  P('potted-plant', 112.2, -182, G),
  // Cloakroom: rails of coats.
  ...[103.5, 106.5].map((x) => P('clothes-rail', x, -176.4, G)),
  // Security: lockers, a desk, the camera wall.
  P('locker-bank', 112.6, -172.8, G, -90),
  box(103, -170.4, 105.4, -169.6, G, G + 0.75, C.wood),
  P('office-chair', 104.2, -171, G),
  P('cctv-wall', 104.2, -167.75, G + 1.2, 180),
  // Restrooms: stalls and sinks.
  ...[113, 122].flatMap((x0) => [
    ...[1.5, 3, 4.5, 6].map((d) =>
      box(x0 + d - 0.025, -197.4, x0 + d + 0.025, -195.6, G, G + 2, C.steel),
    ),
    ...[0.8, 2.25, 3.75, 5.25].map((d) => P('toilet', x0 + d, -196.9, G)),
    P('sink-counter', x0 + 7.2, -190, G, 180),
  ]),
  // Kitchen: counters, an oven, a prep island, fridges, a sink, the hood.
  box(113.2, -186.9, 121, -186.2, G, G + 0.95, C.steel),
  P('pizza-oven', 124, -186.15, G),
  box(116, -182, 122, -180.8, G, G + 0.95, C.steel),
  ...[-184, -182.4].map((z) => P('fridge-v2', 130.2, z, G, -90)),
  P('sink-counter', 126, -175.4, G, 180),
  drawn(113.2, -186.9, 121, -185.9, G + 2.3, G + 2.6, C.steel),
  // Storeroom: stock (the staff stair runs along its south wall).
  ...[
    [125, -173.5],
    [126.3, -173.5],
    [127.6, -173.5],
    [125, -172.2],
  ].map(([x, z]) => P('stock-crate', x, z, G)),
  P('roll-cage', 129.8, -173.5, G),
  P('roll-cage', 129.8, -172.6, G),
  P('cardboard-bale', 129.6, -170, G),
]);

// ---------------------------------------------------------------------------------------
// Upper floor

add('games lounge', [
  ...[
    [86, -223.5],
    [94, -223.5],
    [86, -215.5],
    [94, -215.5],
  ].map(([x, z]) => P('pool-table', x, z, U)),
  P('poker-table', 80, -209, U),
  P('poker-table', 87, -209, U),
  P('foosball-table', 93.5, -205.5, U),
  P('foosball-table', 97, -205.5, U),
  ...Array.from({ length: 8 }, (_, i) => P('arcade-cabinet', 71.55, -217.5 + i, U, 90)),
  P('dartboard', 79.1, -222, U, 90),
  P('dartboard', 79.1, -225, U, 90),
  P('couch', 80, -201.5, U, 0, { fabric: '#2f6f73' }),
  P('couch', 88, -201.5, U, 0, { fabric: '#2f6f73' }),
  ...ceilingNeon([79, -227.5, 101, -197.5], RC, 6),
  // Cigar lounge: leather couches, books, a lamp.
  ...lounge(75, -223.5, U, '#5a3a2a'),
  P('bookcase-tall', 71.35, -223.5, U, 90),
  P('floor-lamp', 78.3, -226.8, U),
]);

add('mezzanine and vip', [
  // Mezzanine: seats at the rail over the dance floor.
  ...[-224, -214.5, -205.5].flatMap((z) => [
    P('couch', 102, z, U, 90, { fabric: '#7a1f3a' }),
    P('lounge-table', 103.6, z, U),
  ]),
  ...[108.5, 121.5, 129.5].flatMap((x) => [
    P('couch', x, -198.05, U, 180, { fabric: '#7a1f3a' }),
    P('lounge-table', x, -199.6, U),
  ]),
  // VIP lounge: a private bar on the east wall, a fish-tank divider, lounges.
  P('back-bar', 130.65, -193, U, -90),
  P('back-bar', 130.65, -189, U, -90),
  P('bar-counter', 128.3, -193.05, U, -90),
  P('bar-counter', 128.3, -188.95, U, -90),
  ...Array.from({ length: 8 }, (_, i) => P('bar-stool', 126.9, -194.8 + i, U)),
  ...[114.1, 115.9, 117.7, 119.5].map((x) => P('aquarium-stand', x, -190.5, U)),
  ...lounge(116, -194.5, U),
  ...lounge(122, -194.5, U, '#c8a24b'),
  ...lounge(120.5, -187, U),
  ...ceilingNeon([108, -197.5, 126, -184], RC, 6),
  // Karaoke rooms: a screen, couches round a table, a small disco ball.
  ...[104, 110].flatMap((x) => [
    P('tech-wall-display', x, -176.2, U, 180), // its back 7 cm behind its origin
    P('couch', x, -181.6, U, 0, { fabric: '#8a4bff' }),
    P('couch', x - 2.3, -179.2, U, 90, { fabric: '#8a4bff' }),
    P('lounge-table', x, -179.3, U),
    P('disco-ball', x, -179.5, RC),
  ]),
  // Green room: makeup stations, a rail of costumes, a couch.
  ...[103, 105, 107].map((x) => P('salon-station', x, -175.75, U)), // origin at its back
  P('clothes-rail', 110.8, -171.5, U, 90),
  P('couch', 104, -168.05, U, 180, { fabric: '#ff3fa4' }),
  // Casino: poker, roulette, the cashier's cage.
  P('poker-table', 117, -177.5, U),
  P('poker-table', 122.5, -177.5, U),
  box(126, -179.4, 129.5, -178, U, U + 0.85, '#1f4a2a'),
  {
    type: 'cylinder',
    pos: [126.8, U + 0.85, -178.7],
    radius: 0.45,
    height: 0.06,
    sides: 12,
    color: C.gold,
    collide: false,
  },
  box(129.4, -176.5, 130.9, -174.2, U, U + 1.1, C.wood),
  drawn(129.4, -176.5, 129.45, -174.2, U + 1.1, U + 2.4, C.gold),
  // Office: a desk, books, a couch.
  box(125, -170.6, 127.4, -169.8, U, U + 0.75, C.wood),
  P('office-chair', 126.2, -169, U, 180),
  P('bookcase-tall', 119, -172.65, U),
  P('couch', 130.5, -171, U, -90, { fabric: '#5a3a2a' }),
]);

add('balcony', [
  // The pool: a basin hung under the deck (floor at 4.0), steps in the west end, water at 5.2.
  box(POOL[0], POOL[1], POOL[2], POOL[3], 3.9, 4.0, C.tile),
  box(76.8, -194.2, 91.2, -194, 3.9, GC, C.tile),
  box(76.8, -188.5, 91.2, -188.3, 3.9, GC, C.tile),
  box(76.8, -194, 77, -188.5, 3.9, GC, C.tile),
  box(91, -194, 91.2, -188.5, 3.9, GC, C.tile),
  box(77, -194, 79, -192.5, 4, 4.35, C.stone),
  box(77, -192.5, 78.4, -191.3, 4, 4.7, C.stone),
  box(77, -191.3, 77.8, -190.3, 4, 5.05, C.stone),
  { type: 'water', pos: [84, GC, -191.25], size: [14, 5.5], color: C.water, opacity: 0.65 },
  // A hot tub.
  {
    type: 'cylinder',
    pos: [96.5, U, -188.5],
    radius: 1.3,
    height: 0.75,
    sides: 12,
    color: C.stone,
  },
  {
    type: 'cylinder',
    pos: [96.5, U + 0.75, -188.5],
    radius: 1.15,
    height: 0.02,
    sides: 12,
    color: C.cyan,
    collide: false,
  },
  // The outdoor bar on the games lounge's wall.
  P('back-bar', 94.7, -197.15, U),
  P('back-bar', 98.75, -197.15, U),
  P('bar-counter', 94.7, -195.2, U),
  P('bar-counter', 98.75, -195.2, U),
  ...Array.from({ length: 8 }, (_, i) => P('bar-stool', 93 + i, -193.85, U)),
  // Loungers and parasols along the rail.
  ...[79, 81.2, 83.4, 85.6, 87.8, 90].map((x) => P('sun-lounger', x, -186, U, 180)),
  ...[80.1, 84.5, 88.9].map((x, k) =>
    P('parasol', x, -185.3, U, 0, { canopy: [C.orange, C.cyan, C.magenta][k] }),
  ),
  // A cabana of daybeds under a pergola, west of the pool.
  box(71.4, -196.8, 75.4, -194.6, U, U + 0.45, C.stone),
  box(71.4, -193.6, 75.4, -191.4, U, U + 0.45, C.stone),
  drawn(71.5, -196.7, 75.3, -194.7, U + 0.45, U + 0.6, C.cyan),
  drawn(71.5, -193.5, 75.3, -191.5, U + 0.45, U + 0.6, C.magenta),
  ...[
    [71.3, -197.2],
    [75.6, -197.2],
    [71.3, -191.2],
    [75.6, -191.2],
  ].map(([x, z]) => drawn(x - 0.08, z - 0.08, x + 0.08, z + 0.08, U, U + 2.7, C.wood)),
  ...Array.from({ length: 6 }, (_, k) =>
    drawn(71.2, -197.3 + k * 1.2, 75.7, -197.2 + k * 1.2, U + 2.7, U + 2.8, C.wood),
  ),
]);

add('courtyard', [
  // The queue: velvet ropes into the main doors, the bouncer's spot by the door.
  ...[93.8, 96, 98.2].flatMap((x) => [
    P('velvet-rope', x, -192.6, G),
    P('velvet-rope', x, -187.4, G),
  ]),
  box(99.6, -194.3, 100.2, -193.7, G, G + 1.1, C.gold),
  // A terrace under the balcony: tables.
  ...[
    [76, -191],
    [84, -191],
    [88, -187.8],
  ].map(([x, z]) => P('cafe-table', x, z, G)),
  // Trees, planters, the sign pylon and two parked cars.
  ...planterTree(79, -171.5, G),
  ...planterTree(94, -171.5, G),
  box(83, -177.2, 89, -176.4, G, G + 0.9, C.stone),
  drawn(83.1, -177.1, 88.9, -176.5, G + 0.9, G + 1.3, '#4c7d43'),
  box(99.2, -169.6, 99.8, -169, G, G + 4, C.outside),
  drawn(97.6, -169.35, 101.4, -169.25, G + 2.6, G + 3.8, C.magenta),
  P('car', 85, -169.8, G, 90),
  P('car', 90.5, -181, G, 90),
]);

// ---------------------------------------------------------------------------------------
// Into the map

const map = JSON.parse(readFileSync(FILE, 'utf8'));
const replaced = (n) => n.type === 'group' && ['nightclub', 'nightclub-floors'].includes(n.name);
const gone = map.nodes.filter(replaced);
map.nodes = [...map.nodes.filter((n) => !replaced(n)), group('nightclub', out)];

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(
  `nightclub: ${count(out)} nodes in ${out.length} groups; took out ${gone.length} groups`,
);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
