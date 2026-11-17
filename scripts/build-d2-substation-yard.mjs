// d2's substation yard, redone (2026-11-16, the user's brief: tactical play, a quest area,
// verticality such as a ramp; the user picked a catwalk with a ramp, an HV cage opened by a
// switch, and keeping the compound wall, gates and ways in). Builds only the yard's own
// groups inside the `substation` group (local frame: x east, z south, the pad's middle at
// 0, 0); the house, alley, exterior, wall, gates and ground are the user's and untouched.
//
// - The transformer row: three in oil bunds, 6 m firewalls between them.
// - The catwalk: a steel deck at 3.2 m along the row's north side, up a 10 m concrete ramp
//   the AI climbs at its west end, down an open steel stair at its east end. Mesh rails
//   (seen and shot through), two gaps in the north rail to drop (3.2 m) into the north lane.
//   High ground over the whole yard, seen from all of it: nothing solid up there.
// - The north lane: a spare transformer on a low-loader, a container, drums, pallets.
// - The switchyard: breakers and gantries; solid cable kiosks and an oil tank break its lines.
// - The HV cage (the quest area): a palisade cage round the main transformer, breakers and
//   control cubicles, quest-marker spots inside. Its gate (a roller grille with a status
//   lamp) opens only from the switch in the relay kiosk east of it: hold it 4 s, the lamp
//   flashes 10 s, then a buzzer at the gate as it rolls up. Local noise only (the user: no
//   long global alarms). Nothing that's a step stands near the cage's fence.
// - The south strip: a site cabin, a generator, drums and barriers behind the cage, where the
//   south-east hole comes in.
//
// Usage: node scripts/build-d2-substation-yard.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { box, drawn, group, prefab } from './mapkit/nodes.mjs';
import { roomWalls } from './mapkit/rooms.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');
const GR = 0.05; // the yard's gravel
const DECK = 3.2; // the catwalk's top

const C = {
  concrete: '#a8a49b',
  bund: '#77736a',
  steel: '#6a6e72',
  grating: '#7d8489',
  gratingDark: '#5d6468',
  yellow: '#e0b23a',
  block: '#bdb6a8',
  roof: '#5d6468',
  glass: '#9fc8d0',
  tank: '#8b9297',
  trailer: '#3d4148',
  kiosk: '#9aa1a6',
};

const out = [];
const add = (name, nodes) => out.push(group(name, nodes));
const P = (id, x, z, y = GR, yaw = 0, extra = {}) =>
  prefab(id, x, z, { ...(yaw ? { yaw } : {}), ...extra }, y);

/** A rail (solid to movement, 1.05 m; seen and shot through) along a line on a floor at y. */
function rail(x0, z0, x1, z1, y, color = C.yellow) {
  const alongX = Math.abs(z1 - z0) < 1e-6;
  const [a0, a1, b0, b1] = alongX ? [x0, x1, z0 - 0.03, z0 + 0.03] : [x0 - 0.03, x0 + 0.03, z0, z1];
  const posts = [];
  const len = alongX ? x1 - x0 : z1 - z0;
  for (let k = 0; k <= Math.floor(len / 1.5); k++) {
    const t = Math.min(len, k * 1.5);
    posts.push(
      alongX
        ? drawn(x0 + t - 0.025, z0 - 0.025, x0 + t + 0.025, z0 + 0.025, y, y + 1.05, color)
        : drawn(x0 - 0.025, z0 + t - 0.025, x0 + 0.025, z0 + t + 0.025, y, y + 1.05, color),
    );
  }
  return [
    box(a0, b0, a1, b1, y + 0.98, y + 1.05, color),
    box(a0, b0, a1, b1, y + 0.48, y + 0.53, color, { collide: false }),
    box(a0, b0, a1, b1, y, y + 0.98, color, { invisible: true }),
    ...posts,
  ];
}

/** A bund: a 0.35 m curb (a step) round dark gravel. */
const bund = (x, z, hx, hz) => [
  drawn(x - hx + 0.2, z - hz + 0.2, x + hx - 0.2, z + hz - 0.2, GR, GR + 0.04, C.bund),
  box(x - hx, z - hz, x + hx, z - hz + 0.2, GR, GR + 0.35, C.concrete),
  box(x - hx, z + hz - 0.2, x + hx, z + hz, GR, GR + 0.35, C.concrete),
  box(x - hx, z - hz + 0.2, x - hx + 0.2, z + hz - 0.2, GR, GR + 0.35, C.concrete),
  box(x + hx - 0.2, z - hz + 0.2, x + hx, z + hz - 0.2, GR, GR + 0.35, C.concrete),
];

// ---------------------------------------------------------------------------------------
// The transformer row

const TX = [6, 20, 34];
const TZ = -11;
add('yard transformers', [
  ...TX.flatMap((x) => [...bund(x, TZ, 4.3, 3.1), P('power-transformer', x, TZ, GR + 0.04)]),
  ...[13, 27].flatMap((x) => [
    box(x - 0.18, -15.3, x + 0.18, -6.5, GR, 6, C.concrete),
    P('high-voltage-sign', x + 0.19, -9, 2.2, 90),
    P('high-voltage-sign', x - 0.19, -9, 2.2, -90),
  ]),
]);

// ---------------------------------------------------------------------------------------
// The catwalk: deck z −17.6..−16.0, x 6.5..41, at 3.2 m.

const [CZ0, CZ1] = [-17.6, -16.0];
const [CX0, CX1] = [6.5, 41];
const STAIR_X = [39.4, 41]; // the stair down off the deck's south edge at its east end
const posts = [];
for (let x = CX0 + 0.3; x < CX1; x += 4.3)
  for (const z of [CZ0 + 0.1, CZ1 - 0.1])
    posts.push(box(x - 0.08, z - 0.08, x + 0.08, z + 0.08, GR, DECK - 0.2, C.steel));
add('yard catwalk', [
  // The deck: a steel grating, its edge beams and cross bracing under it.
  box(CX0, CZ0, CX1, CZ1, DECK - 0.2, DECK, C.grating),
  ...Array.from({ length: Math.floor((CX1 - CX0) / 0.5) }, (_, i) =>
    drawn(
      CX0 + 0.25 + i * 0.5 - 0.01,
      CZ0 + 0.05,
      CX0 + 0.25 + i * 0.5 + 0.01,
      CZ1 - 0.05,
      DECK,
      DECK + 0.01,
      C.gratingDark,
    ),
  ),
  drawn(CX0, CZ0 - 0.05, CX1, CZ0, DECK - 0.35, DECK, C.yellow),
  drawn(CX0, CZ1, CX1, CZ1 + 0.05, DECK - 0.35, DECK, C.yellow),
  ...posts,
  // Rails: the north side with two gaps to drop into the north lane, the south side up to
  // the stair, the east end.
  ...rail(CX0 + 0.5, CZ0, 15, CZ0, DECK),
  ...rail(16.6, CZ0, 31, CZ0, DECK),
  ...rail(32.6, CZ0, CX1, CZ0, DECK),
  ...rail(CX0 + 0.5, CZ1, STAIR_X[0], CZ1, DECK),
  ...rail(CX1, CZ0, CX1, CZ1, DECK),
  // The ramp up at the west end: concrete, 10 m, rising east, a yellow line at its foot.
  {
    type: 'ramp',
    pos: [CX0 - 5, GR, (CZ0 + CZ1) / 2],
    yaw: 90,
    size: [CZ1 - CZ0, DECK - GR, 10],
    color: C.concrete,
  },
  drawn(CX0 - 10, CZ0 + 0.05, CX0 - 9.7, CZ1 - 0.05, GR, GR + 0.01, C.yellow),
  // The stair down at the east end: open underneath, rising north to the deck.
  {
    type: 'stairs',
    pos: [(STAIR_X[0] + STAIR_X[1]) / 2, GR, CZ1 + 2.65],
    yaw: 180,
    size: [STAIR_X[1] - STAIR_X[0], DECK - GR, 5.3],
    steps: 14,
    thickness: 0.3,
    sides: 0.9,
    color: C.steel,
  },
  // A junction box half way along, the one thing up there to crouch behind (waist high).
  box(23.2, CZ0 + 0.05, 24.4, CZ0 + 0.55, DECK, DECK + 0.9, C.kiosk),
]);

// ---------------------------------------------------------------------------------------
// The north lane (z −29.8..−18)

add('yard north lane', [
  // A spare transformer on a low-loader: a long solid block in the lane's middle.
  box(19.5, -24.8, 28.5, -21.2, GR + 0.4, GR + 1.1, C.trailer),
  ...[20.5, 21.6, 26.4, 27.5].flatMap((x) =>
    [-24.95, -21.05].map((z) =>
      drawn(x - 0.42, z - 0.15, x + 0.42, z + 0.15, GR, GR + 0.84, '#2b2b2b'),
    ),
  ),
  drawn(17.6, -23.2, 19.5, -22.8, GR + 0.6, GR + 0.75, C.trailer),
  P('power-transformer', 24, -23, GR + 1.1),
  // A container, drums, pallets, staggered across the lane.
  P('shipping-container-closed-doors', 4, -25.5, GR, 90),
  P('cable-drum', 12.5, -21, GR),
  P('cable-drum', 34.5, -26.6, GR, 15),
  P('cable-drum', 36.4, -25.9, GR, -10),
  P('wood-pallet-boxes', 40.6, -21.2),
  P('wood-pallet-boxes', 41.9, -21.3),
  P('stock-crate', 15.6, -27.8),
  P('jersey-barrier', -2.5, -22, GR, 90),
]);

// ---------------------------------------------------------------------------------------
// The switchyard (z −6..8)

const oilTank = (x, z) => [
  box(x - 2.1, z - 0.8, x + 2.1, z + 0.8, GR + 0.25, GR + 1.85, C.tank, { invisible: true }),
  {
    type: 'cylinder',
    pos: [x, GR + 1.05 - 2, z],
    radius: 0.8,
    height: 4,
    color: C.tank,
    sides: 12,
    roll: 90,
    collide: false,
  },
  ...[-1.3, 1.3].map((dx) =>
    box(x + dx - 0.15, z - 0.7, x + dx + 0.15, z + 0.7, GR, GR + 0.4, C.concrete),
  ),
  drawn(x - 0.2, z - 0.15, x + 0.2, z + 0.15, GR + 1.85, GR + 2.05, C.steel),
];
add('yard switchyard', [
  ...TX.flatMap((x) => [
    P('circuit-breaker', x, -4),
    P('substation-gantry', x, 1),
    // Leads from each transformer's bushings to its breaker.
    ...[-1.05, 0, 1.05].map((dx) =>
      drawn(x + dx - 0.02, TZ + 0.6, x + dx + 0.02, -4, GR + 4.5, GR + 4.54, C.steel),
    ),
  ]),
  // Cable marshalling kiosks: solid, 2.1 m (eye cover nothing climbs), staggered.
  ...[
    [13.2, -2.2],
    [27.2, 4.2],
    [41.5, 0.5],
  ].map(([x, z]) => box(x - 0.6, z - 0.45, x + 0.6, z + 0.45, GR, GR + 2.1, C.kiosk)),
  ...oilTank(3, 5.5),
  P('high-voltage-sign', 13.2, -2.66, 1.8, 180),
]);

// ---------------------------------------------------------------------------------------
// The HV cage: x 10..31, z 9..21, the gate in its north side.

const [KX0, KZ0, KX1, KZ1] = [10, 9, 31, 21];
const GATE_X = 20.5;
const fence = [];
for (let x = KX0 + 1.5; x < KX1; x += 3) {
  if (Math.abs(x - GATE_X) > 0.1) fence.push(P('palisade-fence', x, KZ0, 0));
  fence.push(P('palisade-fence', x, KZ1, 0, 180));
}
for (let z = KZ0 + 1.5; z < KZ1; z += 3) {
  fence.push(P('palisade-fence', KX0, z, 0, -90));
  fence.push(P('palisade-fence', KX1, z, 0, 90));
}
add('yard hv cage', [
  ...fence,
  {
    type: 'door',
    id: 'substation-hv-gate',
    name: 'HV cage gate',
    pos: [GATE_X, GR, KZ0],
    yaw: 180,
    size: [3, 2.5],
    thickness: 0.1,
    look: 'roller-grille',
    rollUp: true,
    color: C.steel,
    lamp: { pos: [1.7, 2.6, 0.15], size: [0.3, 0.2, 0.1] },
  },
  ...[14.5, 26.5].map((x) => P('high-voltage-sign', x, KZ0 - 0.03, 1.8, 180)),
  P('high-voltage-sign', KX1 + 0.03, 15, 1.8, 90),
  // Inside: the main transformer on its bund, two breakers, the control cubicles.
  ...bund(16.5, 15.5, 4.3, 3.1),
  P('power-transformer', 16.5, 15.5, GR + 0.04, 180),
  P('circuit-breaker', 25, 12.6, GR, 90),
  P('circuit-breaker', 25, 17.6, GR, 90),
  P('switchgear-cabinet', 28.6, 20.3, GR, 180),
  P('switchgear-cabinet', 26.1, 20.3, GR, 180),
  drawn(11, 10, 30, 20, GR, GR + 0.01, '#77736a'),
  // Quest spots: the main transformer's cabinet, the breakers, the cubicles.
  { type: 'questMarker', id: 'substation-hv-transformer', pos: [16.5, GR, 12.7] },
  { type: 'questMarker', id: 'substation-hv-breakers', pos: [23.6, 0, 15.1] }, // the user's height
  { type: 'questMarker', id: 'substation-hv-cubicles', pos: [27.3, GR, 19.3] },
]);

// ---------------------------------------------------------------------------------------
// The relay kiosk: a walk-in block hut east of the cage, its door facing the cage, the
// cage's switch inside.

const KIOSK = [33.6, 10.6, 38.4, 14.9]; // wall center lines
add('yard relay kiosk', [
  box(KIOSK[0] - 0.1, KIOSK[1] - 0.1, KIOSK[2] + 0.1, KIOSK[3] + 0.1, 0, 0.2, C.concrete),
  ...roomWalls({
    rooms: [{ r: KIOSK, yb: 0.2, yt: 3.0 }],
    openings: [
      { axis: 'z', c: KIOSK[0], at: 12.75, w: 1.1, y: 0.2, h: 2.2 },
      { axis: 'x', c: KIOSK[1], at: 36.6, w: 1.4, y: 1.2, h: 0.9, glass: C.glass },
    ],
    inside: '#d6d2c8',
    outside: C.block,
  }),
  box(KIOSK[0] - 0.25, KIOSK[1] - 0.25, KIOSK[2] + 0.25, KIOSK[3] + 0.25, 3.0, 3.15, C.roof),
  P('wall-light', KIOSK[0] - 0.1, 12.75 + 0.9, 2.8, -90),
  P('high-voltage-sign', KIOSK[0] - 0.11, 11.3, 2.0, -90),
  // Inside: the cage's switch on the east wall, a desk, a cable rack.
  P('elevator-power-switch', 38.19, 12.75, 0.2, -90, {
    colors: { paint: '#5f7b8c', 'paint-dark': '#4e6878', label: '#e0b23a' },
    switch: {
      name: 'HV cage interlock',
      useTime: 4,
      rows: [{ opens: 'substation-hv-gate', timer: 10, openNoise: 'door-buzzer' }],
    },
  }),
  P('metal-desk', 36.2, 14.25, 0.2, 180),
  P('office-chair', 36.0, 13.4, 0.2),
  P('server-rack', 34.15, 14.35, 0.2, 180),
  { type: 'questMarker', id: 'substation-relay-switch', pos: [37.4, 0.2, 12.75] },
]);

// ---------------------------------------------------------------------------------------
// The south strip (z 21..29.8) and the yard's west edge

add('yard south strip', [
  P('portacabin', 3.5, 26.2, GR, 180, { colors: { trim: '#4f6a7d' } }),
  P('bunker-generator', -1.5, 17.5, GR, 90),
  P('steel-barrel', 0.6, 19.1),
  P('hazard-barrel', 0.6, 18.3),
  P('cable-drum', 36.5, 24.8, GR, 30),
  P('cable-drum-small', 38.4, 26.6, GR),
  P('jersey-barrier', 21, 26.5, GR),
  P('jersey-barrier', 12.5, 24.8, GR, 15),
  P('wood-pallet-boxes', 41.5, 13.5),
  P('shipping-container-sealed', 42.5, 21, GR, 0),
]);

// ---------------------------------------------------------------------------------------
// The house's sides (2026-11-16, the user: "the sides of the building are empty"). Kept
// clear: the alley's mouths, the west gate's way in. Nothing tall stands close enough to a
// roof, the truck or the container to be a step onto it.

const tank = (x, z) => [
  ...bund(x, z, 2.6, 1.15),
  box(x - 2.1, z - 0.8, x + 2.1, z + 0.8, GR + 0.25, GR + 1.85, C.tank, { invisible: true }),
  {
    type: 'cylinder',
    pos: [x, GR + 1.05 - 2, z],
    radius: 0.8,
    height: 4,
    color: '#c9c3b5',
    sides: 12,
    roll: 90,
    collide: false,
  },
  ...[-1.3, 1.3].map((dx) =>
    box(x + dx - 0.15, z - 0.7, x + dx + 0.15, z + 0.7, GR, GR + 0.4, C.concrete),
  ),
  drawn(x + 1.5, z - 0.1, x + 1.7, z + 0.1, GR + 1.85, GR + 2.2, C.steel),
  P('high-voltage-sign', x, z - 0.81, 1.6, 180),
];
add('yard house sides', [
  // North: a box truck along the side, its back by the alley's mouth (walk in); a bunded
  // diesel tank against the wall; a skip by the gate; pallets along the compound wall.
  P('openable-truck', -37.2, -24, GR + 0.45, 90),
  ...tank(-34, -19.4),
  P('skip-bin', -31, -28.3),
  P('wood-pallet-boxes', -41.2, -28.6),
  P('wood-pallet-boxes', -42.5, -28.7, GR, 8),
  P('cable-drum-small', -44.3, -28.4),
  // South: an open container in line with the west gate (through it or round it), a
  // forklift, a skip and bins along the wall, a staff table, drums and pallets by the drive.
  P('shipping-container-open-no-doors', -36, 18.5, GR, 90),
  P('forklift', -25.6, 16.6, GR, 30),
  P('skip-bin', -30, 14.6),
  P('wheelie-bin', -42.5, 13.1),
  P('wheelie-bin', -41.7, 13.15, GR, 6),
  P('table-and-chairs', -36.5, 26.6),
  P('parasol', -36.5, 26.6),
  P('cable-drum', -22.6, 27.4, GR, 15),
  P('wood-pallet-boxes', -26.8, 28.2),
  P('wood-pallet-boxes', -25.5, 28.3, GR, -6),
  P('jersey-barrier', -45.2, 26.4, GR, 90),
]);

// ---------------------------------------------------------------------------------------
// Into the map: only these groups, and the old yard groups they replace.

const OLD = ['transformers', 'switchyard', 'north lane'];
const map = JSON.parse(readFileSync(FILE, 'utf8'));
const sub = map.nodes.find((n) => n.type === 'group' && n.name === 'substation');
const mine = new Set([...OLD, ...out.map((g) => g.name)]);
const gone = sub.nodes.filter((n) => n.type === 'group' && mine.has(n.name));
const at = sub.nodes.findIndex((n) => n.type === 'group' && mine.has(n.name));
sub.nodes = sub.nodes.filter((n) => !(n.type === 'group' && mine.has(n.name)));
sub.nodes.splice(at < 0 ? sub.nodes.length : at, 0, ...out);

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(
  `substation yard: ${count(out)} nodes in ${out.length} groups; replaced ${gone.length}`,
);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
