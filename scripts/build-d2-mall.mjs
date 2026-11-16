// d2's mall (2026-11-14, the user's request: "do something cool with the mall layout"):
// the shell and connections as a graybox, written into content/maps/d2.json as one group
// named `mall`. Re-runnable: it replaces its own group, and on the first run takes out the
// user's placeholder mall nodes (the `mall-floor-footprint` and `Room` groups and the three
// upper slabs at y 10.2), which the user said to replace. Everything else in d2 is left as
// it is, apart from the ground under the mall's footprints, which is leveled to 5 m.
//
// Plan (docs/design/maps/d2.md has the why):
// - Cinema x −226..−190, z −148..−112; main block x −226..−166, z −112..−16; department
//   store x −226..−186, z −16..40. Ground floor walks at 5.2, upper at 10.4, roof at 15.6.
// - The ground floor's front is east (the 5 m terrace); the hill (10 m) walks straight
//   onto the deck on the west, so the mall is a route through and over, not a wall.
// - The main block's roof is the deck: an open-air roof-top promenade (the user's call,
//   2026-11-15) with small separate shops, a sky bar, a stage and lawn, an arcade, a
//   street-food market, a fountain and trees, fronted by the cinema and the department
//   store. An off-center court (x −206..−182, z −84..−54) opens from it to the ground floor.
// - The concourse bends round the court: north stretch x −210..−194, south x −202..−188.
// - A service corridor along the buried west wall, with a staff stair up to the cinema's
//   upper foyer; a stair from the deck to a roof terrace on the cinema.
// - The cinema's two auditoriums have seating rising from the ground floor to a rear aisle
//   at the upper level, which opens onto the hill: a dark route between floors.
//
// Usage: node scripts/build-d2-mall.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { box, drawn, group, prefab, r2 } from './mapkit/nodes.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');

// Levels.
const G = 5.2; // ground floor walks here (slab 5.0..5.2)
const U = 10.4; // upper floor (slab 10.2..10.4)
const R = 15.6; // roof (slab 15.4..15.6)
const RISE = U - G;

const C = {
  outer: '#a9a397',
  inner: '#d8d2c4',
  service: '#9a968e',
  floor: '#cfc8b9',
  serviceFloor: '#a8a49b',
  roof: '#8d8a84',
  stone: '#e6e0d3',
  dark: '#3d4148',
  brass: '#c8a24b',
  glass: '#9fd0d8',
  screen: '#2a2c30',
  seats: '#5a3a3a',
  deck: '#d9d2c3',
  shopWall: '#efe9dc',
  timber: '#7a5a3c',
  stage: '#5b4636',
  lawn: '#5f9a4e',
  soil: '#5a4632',
  water: '#5fa8c8',
  neon: '#e0507a',
  accent1: '#c0583c',
  accent2: '#2f6f73',
  accent3: '#d9a441',
  accent4: '#7a4f8a',
};

const out = [];
const add = (name, nodes) => out.push(group(name, nodes));

// ---------------------------------------------------------------------------------------
// Pieces

/**
 * Openings can't overlap along a wall, even at different heights (the compiler refuses
 * them), so a later one that would (an upper window over a door) is dropped.
 */
function clear(ops) {
  const kept = [];
  for (const o of ops)
    if (!kept.some((k) => Math.abs(k.at - o.at) < (k.width + o.width) / 2 + 0.3)) kept.push(o);
  return kept;
}

/**
 * A wall along x at z from x0 to x1, bottom to top; openings by their middle `at` (x),
 * width, and bottom/top above the wall's bottom.
 */
function wallX(x0, x1, z, bottom, top, color, ops = [], thick = 0.2) {
  return {
    type: 'wall',
    pos: [r2((x0 + x1) / 2), r2(bottom), r2(z)],
    size: [r2(x1 - x0), r2(top - bottom), thick],
    color,
    openings: clear(ops).map(({ at, ...o }) => ({ ...o, along: r2(at - (x0 + x1) / 2) })),
  };
}

/** A wall along z at x; openings by their middle `at` (z). A yaw-90 wall measures along −z. */
function wallZ(x, z0, z1, bottom, top, color, ops = [], thick = 0.2) {
  return {
    type: 'wall',
    pos: [r2(x), r2(bottom), r2((z0 + z1) / 2)],
    yaw: 90,
    size: [r2(z1 - z0), r2(top - bottom), thick],
    color,
    openings: clear(ops).map(({ at, ...o }) => ({ ...o, along: r2((z0 + z1) / 2 - at) })),
  };
}

const T = 0.1; // half a wall's thickness: interior walls stop at the faces they meet
const door = (at, width = 1.2, top = 2.2) => ({ at, width, bottom: 0, top });
const front = (at, width = 5) => ({ at, width, bottom: 0, top: 3.2 });
const win = (at, width = 3, bottom = 1, top = 3.2) => ({ at, width, bottom, top, glass: C.glass });
/** A door through an upper storey of a full-height wall standing on the ground floor. */
const upDoor = (at, width = 1.6, top = 2.4) => ({ at, width, bottom: RISE, top: RISE + top });
const upWin = (at, width = 3) => win(at, width, RISE + 1, RISE + 3.2);

/** Windows every `step` meters between a and b, away from `skip` ranges. */
function windows(a, b, step, make, skip = []) {
  const ops = [];
  for (let at = a + step / 2; at < b; at += step)
    if (!skip.some(([s0, s1]) => at > s0 - 2.5 && at < s1 + 2.5)) ops.push(make(r2(at)));
  return ops;
}

/**
 * A slab over a rect less holes, as few boxes as a band-by-band merge gives.
 * rect and holes are [x0, z0, x1, z1].
 */
function slab(rect, holes, bottom, top, color) {
  const xs = [...new Set([rect[0], rect[2], ...holes.flatMap((h) => [h[0], h[2]])])]
    .filter((x) => x >= rect[0] && x <= rect[2])
    .sort((a, b) => a - b);
  const zs = [...new Set([rect[1], rect[3], ...holes.flatMap((h) => [h[1], h[3]])])]
    .filter((z) => z >= rect[1] && z <= rect[3])
    .sort((a, b) => a - b);
  const inHole = (x, z) => holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
  // Runs along x per band, then bands with the same runs merged along z.
  const bands = [];
  for (let j = 0; j < zs.length - 1; j++) {
    const zm = (zs[j] + zs[j + 1]) / 2;
    const runs = [];
    let start = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const solid = !inHole((xs[i] + xs[i + 1]) / 2, zm);
      if (solid && start === null) start = xs[i];
      if (!solid && start !== null) (runs.push([start, xs[i]]), (start = null));
    }
    if (start !== null) runs.push([start, xs.at(-1)]);
    const key = JSON.stringify(runs);
    const last = bands.at(-1);
    if (last && last.key === key) last.z1 = zs[j + 1];
    else bands.push({ key, runs, z0: zs[j], z1: zs[j + 1] });
  }
  return bands.flatMap((b) =>
    b.runs.map(([x0, x1]) => box(x0, b.z0, x1, b.z1, bottom, top, color)),
  );
}

/**
 * A single flight between floors, `w` wide, centered on x (along z) or z (along x), from
 * `foot` to `head` along its axis, rising RISE from G. With solid stepped rails both sides
 * (props.md → Mall finishes: dark, top 1.0 m over the steps; brass caps drawn only).
 */
function flight({ along, at, foot, head, w, bottom = G, rise = RISE, steps, rails = true }) {
  const len = Math.abs(head - foot);
  const mid = (foot + head) / 2;
  const up = head > foot ? 1 : -1;
  const nodes = [];
  if (along === 'z') {
    nodes.push({
      type: 'stairs',
      pos: [r2(at), r2(bottom), r2(mid)],
      ...(up < 0 ? { yaw: 180 } : {}),
      size: [w, r2(rise), r2(len)],
      color: C.stone,
      ...(steps ? { steps } : {}),
    });
  } else {
    nodes.push({
      type: 'stairs',
      pos: [r2(mid), r2(bottom), r2(at)],
      yaw: up > 0 ? 90 : -90,
      size: [w, r2(rise), r2(len)],
      color: C.stone,
      ...(steps ? { steps } : {}),
    });
  }
  if (!rails) return nodes;
  // Stepped rail pieces, 1.05 m long, beside the flight (not on it, so nothing overlaps).
  const pieces = Math.ceil(len / 1.05);
  const seg = len / pieces;
  for (const side of [-1, 1]) {
    const c = at + side * (w / 2 + 0.125);
    for (let k = 0; k < pieces; k++) {
      const a = foot + up * k * seg;
      const b = foot + up * (k + 1) * seg;
      const yLow = bottom + (rise * k) / pieces;
      const yHigh = bottom + (rise * (k + 1)) / pieces;
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      const [x0, z0, x1, z1] =
        along === 'z' ? [c - 0.125, lo, c + 0.125, hi] : [lo, c - 0.125, hi, c + 0.125];
      nodes.push(box(x0, z0, x1, z1, Math.max(bottom, yLow - 0.3), yHigh + 1.0, C.dark));
    }
  }
  return nodes;
}

/** A flat edge rail on a deck at y: glass panes 1.0 m high between dark posts, brass cap. */
function edgeRail(a, b, y, axis, at) {
  const nodes = [];
  const len = Math.abs(b - a);
  const n = Math.max(1, Math.round(len / 3.75));
  const seg = len / n;
  const lo = Math.min(a, b);
  for (let k = 0; k <= n; k++) {
    const p = lo + k * seg;
    const q0 = Math.max(lo, p - 0.125);
    const q1 = Math.min(lo + len, p + 0.125);
    nodes.push(
      axis === 'x'
        ? box(q0, at - 0.125, q1, at + 0.125, y, y + 1.05, C.dark)
        : box(at - 0.125, q0, at + 0.125, q1, y, y + 1.05, C.dark),
    );
  }
  for (let k = 0; k < n; k++) {
    const p0 = lo + k * seg + 0.125;
    const p1 = lo + (k + 1) * seg - 0.125;
    const m = (p0 + p1) / 2;
    nodes.push({
      type: 'glass',
      pos: axis === 'x' ? [r2(m), r2(y), r2(at)] : [r2(at), r2(y), r2(m)],
      ...(axis === 'z' ? { yaw: 90 } : {}),
      size: [r2(p1 - p0), 1.0],
      color: C.glass,
    });
  }
  nodes.push(
    axis === 'x'
      ? drawn(lo, at - 0.16, lo + len, at + 0.16, y + 1.05, y + 1.11, C.brass)
      : drawn(at - 0.16, lo, at + 0.16, lo + len, y + 1.05, y + 1.11, C.brass),
  );
  return nodes;
}

/**
 * Rails round a hole's edges on the deck at y, inset 0.125 m onto the deck, leaving `gaps`
 * ([edge, from, to]: edge 'n' | 's' | 'w' | 'e', from/to along it) for stair heads and bridges.
 */
function holeRails([x0, z0, x1, z1], y, gaps = []) {
  const nodes = [];
  const edges = [
    ['n', 'x', x0 - 0.25, x1 + 0.25, z0 - 0.125],
    ['s', 'x', x0 - 0.25, x1 + 0.25, z1 + 0.125],
    ['w', 'z', z0, z1, x0 - 0.125],
    ['e', 'z', z0, z1, x1 + 0.125],
  ];
  for (const [edge, axis, a, b, at] of edges) {
    const cuts = gaps
      .filter((g) => g[0] === edge)
      .map((g) => [g[1], g[2]])
      .sort((p, q) => p[0] - q[0]);
    let s = a;
    for (const [g0, g1] of cuts) {
      if (g0 - s > 0.5) nodes.push(...edgeRail(s, g0, y, axis, at));
      s = g1;
    }
    if (b - s > 0.5) nodes.push(...edgeRail(s, b, y, axis, at));
  }
  return nodes;
}

/** The service corridor's staggered stock, on the floor at y. */
function corridorStock(y) {
  const west = [-226 + T, -224.7];
  const east = [-224.8, -223.5 - T];
  return [
    [west, -84],
    [east, -72],
    [west, -50],
    [east, -35],
  ].map(([[x0, x1], z]) => box(x0, z, x1, z + 1.5, y, y + 1.8, C.service));
}

// ---------------------------------------------------------------------------------------
// Footprints and holes

const CINEMA = [-226, -148, -190, -112];
const MAIN = [-226, -112, -166, -16];
const DEPT = [-226, -16, -186, 40];
const COURT = [-206, -84, -182, -54];
const DEPT_WELL = [-212, 6, -200, 20];
const STAFF_STAIR = [-226, -112, -223.5, -103.6]; // ground corridor up to the cinema foyer
const AUDITORIUM = [-226, -145, -190, -124]; // double height, under no upper slab

// Floors. The cinema's and department store's upper slabs stop 0.1 inside their outer
// walls' faces (those walls run full height); the main block's deck covers its walls'
// tops, which stop at the ground floor.
add('floors', [
  ...[CINEMA, MAIN, DEPT].flatMap((r) => slab(r, [], G - 0.2, G, C.floor)),
  ...slab([-226 + T, -148 + T, -190 - T, -112], [AUDITORIUM], U - 0.2, U, C.floor),
  ...slab([-226 + T, -16, -186 - T, 40 - T], [DEPT_WELL], U - 0.2, U, C.floor),
  // The deck: the main block's roof, open to the sky.
  ...slab([-226 - T, -112, -166 + T, -16], [COURT, STAFF_STAIR], U - 0.2, U, C.deck),
  box(-190 + T, -112 - T, -166 + T, -112, U - 0.2, U, C.deck),
  box(-186 + T, -16, -166 + T, -16 + T, U - 0.2, U, C.deck),
  // The service corridor's floors read darker.
  ...slab([-226 + T, -103.6, -223.5, -16], [], G, G + 0.01, C.serviceFloor).map((n) => ({
    ...n,
    collide: false,
  })),
]);

// Roofs: only the cinema (a roof terrace, by the stair from the deck) and the department
// store (out of reach).
add('roof', [...slab(CINEMA, [], R - 0.2, R, C.roof), ...slab(DEPT, [], R - 0.2, R, C.roof)]);

// ---------------------------------------------------------------------------------------
// Outer walls: the cinema and department store full height (G..R−0.2, both storeys'
// openings in one wall); the main block's only to the deck.

const H = R - 0.2; // walls' top
const GT = U - 0.2; // the ground storey's walls' top
add('outer walls', [
  // West: buried below the hill on the ground floor; the deck and the department store's
  // upper floor open onto the hill.
  wallZ(-226, -148 - T, -112, G, H, C.outer),
  wallZ(-226, -112, -16, G, GT, C.outer),
  wallZ(-226, -16, 40 + T, G, H, C.outer, [
    { at: 0, width: 4, bottom: RISE, top: RISE + 3 }, // department store, hill doors
    upDoor(30),
  ]),
  // Cinema: north into the hill; the rear aisle's doors at the upper level.
  wallX(-226 + T, -190 - T, -148, G, H, C.outer, [upDoor(-217, 2), upDoor(-199, 2)]),
  wallZ(-190, -148, -112, G, H, C.outer, [
    door(-127, 1.6), // auditorium B's front, fire exit
    { at: -118, width: 4, bottom: 0, top: 3.2 }, // lobby doors
  ]),
  // Main block, north (east of the cinema): the loading roll-up.
  wallX(-190 + T, -166 + T, -112, G, GT, C.outer, [{ at: -173, width: 5, bottom: 0, top: 4 }]),
  // Main block, east: storefronts and the main doors.
  wallZ(-166, -112 + T, -16 - T, G, GT, C.outer, [
    door(-90, 1.6), // loading area
    door(-78, 1.6),
    { at: -69, width: 6, bottom: 0, top: 3.6 }, // main doors, into the vestibule
    door(-60, 1.6),
    door(-44, 1.6),
    door(-25, 1.6),
  ]),
  wallX(-186 - T, -166 + T, -16, G, GT, C.outer),
  // Department store, east and south.
  wallZ(-186, -16 + T, 40 - T, G, H, C.outer, [
    door(0, 1.6),
    { at: 20, width: 6, bottom: 0, top: 3.6 }, // main doors
    ...windows(-16, 40, 8, (at) => upWin(at)),
  ]),
  wallX(-226 + T, -186 - T, 40, G, H, C.outer, [
    door(-215, 1.6),
    { at: -196, width: 4, bottom: 0, top: 3.6 }, // receiving
    ...windows(-226, -186, 8, (at) => upWin(at)),
  ]),
]);

// ---------------------------------------------------------------------------------------
// Ground floor (G..U−0.2)

add('ground floor', [
  // Cinema / main: the lobby opens onto the north concourse.
  wallX(-226 + T, -190 - T, -112, G, GT, C.inner, [{ at: -202, width: 16, bottom: 0, top: 4.2 }]),
  // Main / department store: the store's wide mall entrance, the corridor's door.
  wallX(-226 + T, -186 - T, -16, G, GT, C.inner, [
    door(-224.75, 1.2),
    { at: -195, width: 10, bottom: 0, top: 4.2 },
  ]),

  // The service corridor's wall, with each west store's back door.
  // Back doors set off their stores' fronts, so no line runs corridor to street.
  wallZ(-223.5, -103.6, -16 + T, G, GT, C.service, [
    door(-95),
    door(-80.5),
    door(-57.5),
    door(-48),
    door(-20),
  ]),
  // Beside the staff stair (its rail side): solid.
  wallZ(-223.5, -112 + T, -103.6, G, GT, C.service),

  // West stores: north pair, court pair, south pair.
  wallZ(-210, -112 + T, -84, G, GT, C.inner, [front(-105), front(-91)]),
  wallX(-223.5 + T, -206 + T, -84, G, GT, C.inner),
  wallZ(-206, -84 + T, -54 - T, G, GT, C.inner, [front(-76.5, 6), front(-61.5, 4)]),
  wallX(-223.5 + T, -206 - T, -69, G, GT, C.inner),
  wallX(-223.5 + T, -202 + T, -54, G, GT, C.inner),
  wallZ(-202, -54 + T, -16 - T, G, GT, C.inner, [front(-44), front(-25)]),
  wallX(-223.5 + T, -202 - T, -34, G, GT, C.inner),
  // The back door of the north-west store (z −112..−98) is from the corridor beside the
  // stair's foot, so its partition gets a door into its neighbor instead.
  wallX(-223.5 + T, -210 - T, -98, G, GT, C.inner, [door(-216)]),

  // East: the north-east store, the loading area behind it.
  wallZ(-194, -112 + T, -84 - T, G, GT, C.inner, [front(-98, 6)]),
  wallZ(-180, -112 + T, -84 - T, G, GT, C.service, [door(-98, 2)]),
  wallX(-194 - T, -166 - T, -84, G, GT, C.inner),
  // Court's east side: two stores either side of the vestibule from the main doors.
  wallZ(-182, -84 + T, -54 - T, G, GT, C.inner, [
    front(-78),
    { at: -69, width: 6, bottom: 0, top: 3.6 },
    front(-60),
  ]),
  wallX(-182 + T, -166 - T, -72, G, GT, C.inner),
  wallX(-182 + T, -166 - T, -66, G, GT, C.inner),
  wallX(-188 - T, -166 - T, -54, G, GT, C.inner),
  // South-east pair.
  wallZ(-188, -54 + T, -16 - T, G, GT, C.inner, [front(-44), front(-25)]),
  wallX(-188 + T, -166 - T, -35, G, GT, C.inner),

  // The court: a planted island under the bridge, which also breaks the line between the
  // concourse's two stretches (they overlap from x −202 to −194).
  // An information kiosk (2.8 m, over eye height) between two planters.
  box(-202, -71, -194, -67, G, G + 2.8, C.dark),
  ...[-73, -67].flatMap((z) => [
    box(-202, z, -194, z + 2, G, G + 0.6, C.dark),
    drawn(-201.7, z + 0.3, -194.3, z + 1.7, G + 0.6, G + 0.7, '#5a4632'),
  ]),
  ...[
    [-200, -72],
    [-196, -72],
    [-198, -66],
  ].flatMap(([x, z]) => [
    box(x - 0.2, z - 0.2, x + 0.2, z + 0.2, G + 0.7, G + 3.0, '#6b4f35'),
    drawn(x - 1.4, z - 1.4, x + 1.4, z + 1.4, G + 3.0, G + 4.8, '#4f9558'),
  ]),
  // Stock stacked in the service corridor (1.8 m), staggered side to side: it breaks the
  // corridor's 90 m line and leaves 1.1 m to pass.
  ...corridorStock(G),

  // Concourse kiosks (2.4 m): one mid-way down the north stretch, and a staggered pair
  // down the south one, from either side, so its lines are broken without closing it.
  box(-205, -100, -199, -96, G, G + 2.4, C.dark),
  box(-202 + T, -40, -194, -37, G, G + 2.4, C.dark),
  box(-196, -32, -188 - T, -29, G, G + 2.4, C.dark),

  // Court escalators (stone stairs): the east flight climbs north to the gallery's north
  // edge, the west flight south to its south edge, so they cross the court diagonally.
  ...flight({ along: 'z', at: -188, foot: -75.6, head: -84, w: 3.6 }),
  ...flight({ along: 'z', at: -202, foot: -62.4, head: -54, w: 3.6 }),

  // Staff stair, ground corridor up to the cinema's upper foyer (through the main/cinema
  // wall's upper storey). Against the outer wall on its west, rails only on its east.
  ...flight({ along: 'z', at: -224.75, foot: -103.6, head: -112, w: 2.3, rails: false }),

  // Department store: partial walls for cover (2.4 m), a stockroom along the back, and
  // the well's flight.
  box(-226 + T, -0.1, -214, 0.1, G, G + 2.4, C.inner),
  box(-198, 27.9, -190, 28.1, G, G + 2.4, C.inner),
  box(-201, -0.1, -189, 0.1, G, G + 2.4, C.inner),
  box(-220.1, 22, -219.9, 30, G, G + 2.4, C.inner),
  wallX(-226 + T, -186 - T, 32, G, GT, C.service, [door(-213, 2), door(-190, 3)]),
  ...flight({ along: 'z', at: -208, foot: 14.4, head: 6, w: 3.6 }),

  // Cinema: screen wall with a door into each auditorium's front, the divider, seating.
  wallX(-226 + T, -190 - T, -124, G, GT, C.inner, [door(-223, 1.6), door(-193, 1.6)]),
  drawn(-224, -124.5, -210, -124.11, G + 1.2, G + 4.6, C.screen),
  drawn(-206, -124.5, -192, -124.11, G + 1.2, G + 4.6, C.screen),
  wallZ(-208, -145, -124 - T, G, H, C.inner),
  // Seating: 14 tiers each side, 1.21 m deep, from the front (z −128) up to the rear aisle.
  ...flight({ along: 'z', at: -217.05, foot: -128, head: -145, w: 17.7, steps: 14, rails: false }),
  ...flight({ along: 'z', at: -198.95, foot: -128, head: -145, w: 17.7, steps: 14, rails: false }),
]);

// ---------------------------------------------------------------------------------------
// The deck (U): a roof-top promenade (the user's call, 2026-11-15: "a wonderful and open
// outdoor mall", an extension of the promenade, not a second floor with a hole in it).
// Small separate shops with their own roofs, a sky bar on the street edge, a stage and
// lawn, an open arcade, a street-food market under a pergola, a fountain and trees; the
// hill walks straight on from the west, a glass balustrade runs along the street edges,
// and the cinema and department store front onto it with glass.

/**
 * A small shop on the deck: its own walls and colored roof, glass either side of its door
 * on the `face` side ('n' | 's' | 'e' | 'w'), a back door opposite (no single-entry shops),
 * and a canopy over the front.
 */
function shop([x0, z0, x1, z1], face, roof, h = 3.8) {
  const top = U + h;
  const front = (a, b) => {
    const mid = (a + b) / 2;
    const span = (b - a - 2.4) / 2 - 0.8;
    return [
      { at: mid, width: 2, bottom: 0, top: 2.6 },
      win(mid - 1.4 - span / 2, span, 0.5, 2.8),
      win(mid + 1.4 + span / 2, span, 0.5, 2.8),
    ];
  };
  const back = (a, b) => [door((a + b) / 2, 1.2)];
  const ops = (side, a, b) =>
    side === face ? front(a, b) : side === opposite[face] ? back(a, b) : [];
  const nodes = [
    wallX(x0 - T, x1 + T, z0, U, top, C.shopWall, ops('n', x0, x1)),
    wallX(x0 - T, x1 + T, z1, U, top, C.shopWall, ops('s', x0, x1)),
    wallZ(x0, z0 + T, z1 - T, U, top, C.shopWall, ops('w', z0, z1)),
    wallZ(x1, z0 + T, z1 - T, U, top, C.shopWall, ops('e', z0, z1)),
    box(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, top, top + 0.3, roof),
  ];
  // The canopy, drawn only, 1.6 m out over the front.
  const [cx0, cz0, cx1, cz1] = {
    n: [x0, z0 - 1.9, x1, z0 - 0.3],
    s: [x0, z1 + 0.3, x1, z1 + 1.9],
    w: [x0 - 1.9, z0, x0 - 0.3, z1],
    e: [x1 + 0.3, z0, x1 + 1.9, z1],
  }[face];
  nodes.push(drawn(cx0, cz0, cx1, cz1, U + 2.9, U + 3.0, roof));
  return nodes;
}
const opposite = { n: 's', s: 'n', e: 'w', w: 'e' };

/** A pergola: posts round the edge, slats drawn across it (sky shows through). */
function pergola([x0, z0, x1, z1], h, slatsAlong, step = 1.25, color = C.timber) {
  const nodes = [];
  const xs = [x0, (x0 + x1) / 2, x1];
  const zs = [z0, (z0 + z1) / 2, z1];
  for (const x of xs)
    for (const z of zs)
      if (x !== xs[1] || z !== zs[1])
        nodes.push(box(x - 0.15, z - 0.15, x + 0.15, z + 0.15, U, U + h, color));
  if (slatsAlong === 'x') {
    for (let z = z0; z <= z1 + 1e-6; z += step)
      nodes.push(drawn(x0 - 0.3, z - 0.06, x1 + 0.3, z + 0.06, U + h, U + h + 0.15, color));
    for (const x of [x0, x1])
      nodes.push(drawn(x - 0.1, z0 - 0.3, x + 0.1, z1 + 0.3, U + h - 0.2, U + h, color));
  } else {
    for (let x = x0; x <= x1 + 1e-6; x += step)
      nodes.push(drawn(x - 0.06, z0 - 0.3, x + 0.06, z1 + 0.3, U + h, U + h + 0.15, color));
    for (const z of [z0, z1])
      nodes.push(drawn(x0 - 0.3, z - 0.1, x1 + 0.3, z + 0.1, U + h - 0.2, U + h, color));
  }
  return nodes;
}

/** A tree in a planter: a low ring (0.5 m) round soil, its trunk on the deck inside. */
const tree = (x, z) => [
  box(x - 1.5, z - 1.5, x + 1.5, z - 1.25, U, U + 0.5, C.dark),
  box(x - 1.5, z + 1.25, x + 1.5, z + 1.5, U, U + 0.5, C.dark),
  box(x - 1.5, z - 1.25, x - 1.25, z + 1.25, U, U + 0.5, C.dark),
  box(x + 1.25, z - 1.25, x + 1.5, z + 1.25, U, U + 0.5, C.dark),
  drawn(x - 1.25, z - 1.25, x + 1.25, z + 1.25, U, U + 0.4, C.soil),
  // The prefab's trunk reaches 0.5 m below its origin (it's made to stand in terrain).
  prefab('broadleaf-tree', x, z, {}, U + 0.5),
];
/**
 * Street furniture as cover (2026-11-15, the user: hedge screens can be shot through, so
 * they aren't the promenade's cover). All prefabs (props.md → Street furniture), solid tops
 * over 1.7 m, a jump's reach, so none of them is a step onto a kiosk's roof.
 */
const place = (id, x, z, colors, yaw) =>
  prefab(id, x, z, { ...(yaw ? { yaw } : {}), ...(colors ? { colors } : {}) }, U);
const adColumn = (x, z, poster) => [place('ad-column', x, z, { poster })];
/** A digital billboard along x from x0 to x1: the 2.4 m or the 3.4 m one. */
function billboard(x0, x1, z, screen) {
  const w = r2(x1 - x0);
  const id = { 2.4: 'digital-billboard', 3.4: 'digital-billboard-wide' }[w];
  if (!id) throw new Error(`no ${w} m billboard`);
  return [place(id, (x0 + x1) / 2, z, { screen })];
}
/** Vending machines side by side along x from x0, backs north. */
const vending = (x0, n, z) =>
  Array.from({ length: n }, (_, i) => prefab('vending-machine', x0 + 0.5 + i, z, {}, U));

add('deck', [
  // The cinema's front: glazed, its doors, the staff stair's head (from the ground floor's
  // service corridor), and solid behind the roof terrace's stair.
  wallX(-226 + T, -190 - T, -112, U, H, C.inner, [
    { at: -224.75, width: 2.3, bottom: 0, top: 2.6 },
    win(-219.5, 4, 0.6, 3.6),
    win(-214, 5, 0.6, 3.6),
    { at: -202, width: 10, bottom: 0, top: 3.6 },
  ]),
  // The foyer / auditoriums: solid, with a projection slit each side.
  wallX(-226 + T, -190 - T, -124, U, H, C.inner, [win(-217, 4, 1.4, 2.2), win(-199, 4, 1.4, 2.2)]),
  // The staff stair's housing on the deck (its well, closed over).
  wallZ(-223.5, -112 + T, -103.6, U, U + 3, C.service),
  wallX(-226 + T, -223.4, -103.5, U, U + 3, C.service),
  box(-226 - T, -112, -226 + T, -103.4, U - 0.2, U + 3, C.service),
  box(-226 - T, -111.9, -223.4, -103.4, U + 3, U + 3.2, C.roof),
  // The department store's front: glazed either side of its 10 m entrance.
  wallX(-226 + T, -186 - T, -16, U, H, C.inner, [
    win(-219, 8, 0.6, 3.6),
    win(-207, 8, 0.6, 3.6),
    { at: -195, width: 10, bottom: 0, top: 3.6 },
  ]),

  // Glass balustrades along the street edges (north, east, south); the west is open to the
  // hill.
  ...edgeRail(-112, -16, U, 'z', -166.125),
  ...edgeRail(-189.9, -166.25, U, 'x', -111.875),
  ...edgeRail(-185.9, -166.25, U, 'x', -16.125),

  // The cinema's ticket booth, out in front of its doors (2.6 m): you go round it, and the
  // doors don't look straight down the deck.
  box(-206.5, -106, -196.4, -103.4, U, U + 2.6, C.accent1),
  drawn(-206.8, -106.3, -196.1, -103.1, U + 2.6, U + 2.8, C.dark),
  // The department store's directory, between planters, 6 m out from its doors.
  box(-198, -24, -192, -23.4, U, U + 2.4, C.dark),
  // Digital billboards (2.6 m; hedges were shot through) either side of it, and down the deck's three long lanes (west of
  // the court, east of it, along the street edge), staggered so the deck stays open but no
  // lane runs its whole 96 m.
  ...[
    [-199.5, -21.8],
    [-190.5, -21.8],
    [-207.2, -96],
    [-211, -55],
    [-208.5, -29.6],
    [-188, -96],
    [-185.5, -34],
    [-167.6, -50],
    [-169.4, -86],
  ].flatMap(([x, z], i) =>
    billboard(x - 1.2, x + 1.2, z, [C.accent2, C.accent3, C.accent1][i % 3]),
  ),
  box(-201, -24.5, -198, -22.5, U, U + 0.6, C.dark),
  box(-192, -24.5, -189, -22.5, U, U + 0.6, C.dark),
  drawn(-200.8, -24.3, -198.2, -22.7, U + 0.6, U + 1.3, C.lawn),
  drawn(-191.8, -24.3, -189.2, -22.7, U + 0.6, U + 1.3, C.lawn),

  // Stairs up to the cinema's roof terrace, beside its doors.
  ...flight({ along: 'z', at: -192.5, foot: -103.6, head: -111.9, w: 3, bottom: U }),

  // The arcade: an open pavilion (posts and a roof), a solid back to the hill, machines
  // along it and two laser pillars.
  box(-222, -100, -221.8, -90, U, U + 3.4, C.shopWall),
  ...[
    [-212.2, -99.8],
    [-212.2, -90.2],
  ].map(([x, z]) => box(x - 0.2, z - 0.2, x + 0.2, z + 0.2, U, U + 3.4, C.dark)),
  box(-222.3, -100.3, -211.7, -89.7, U + 3.4, U + 3.65, C.accent1),
  ...[-98, -96.6, -95.2, -93.8, -92.4].map((z) =>
    prefab('arcade-cabinet', -221.2, z, { yaw: 90 }, U),
  ),
  prefab('laser-pillar', -215.5, -97.5, {}, U),
  prefab('laser-pillar', -215.5, -92.5, {}, U),

  // The stage, north-east, facing south over a lawn: a 0.9 m platform with steps (the AI
  // walks them), a backdrop, a truss and speakers.
  box(-180, -111.6, -168, -104.6, U, U + 0.9, C.stage),
  box(-180, -111.75, -168, -111.6, U + 0.9, U + 5, C.screen),
  box(-180.4, -111.75, -180, -111.35, U, U + 5.6, C.dark),
  box(-168, -111.75, -167.6, -111.35, U, U + 5.6, C.dark),
  drawn(-180.4, -111.75, -167.6, -111.35, U + 5.6, U + 5.9, C.dark),
  box(-183, -109, -181.5, -106, U, U + 0.3, C.stage),
  box(-181.5, -109, -180, -106, U, U + 0.6, C.stage),
  box(-176, -103.2, -172, -101.8, U, U + 0.3, C.stage),
  box(-176, -104.6, -172, -103.2, U, U + 0.6, C.stage),
  box(-179.6, -105.6, -178.8, -104.8, U + 0.9, U + 2.5, C.dark),
  box(-169.2, -105.6, -168.4, -104.8, U + 0.9, U + 2.5, C.dark),
  drawn(-185, -101, -168, -89, U, U + 0.02, C.lawn),
  ...[-97, -93].flatMap((z) =>
    [-181.5, -177, -172.5].map((x) => prefab('mall-bench', x, z, { yaw: 180 }, U + 0.02)),
  ),

  // The sky bar on the street edge, east of the court: a pergola over back bars and
  // counters, tables along the balustrade over the street.
  ...pergola([-179.5, -80, -167.4, -58], 3.6, 'x'),
  ...[-76, -72, -68].map((z) => prefab('back-bar', -179, z, { yaw: 90 }, U)),
  ...[-76, -71.9, -67.8].map((z) => prefab('bar-counter', -176.2, z, { yaw: 90 }, U)),
  ...[-78, -74, -64, -60].map((z) => prefab('cafe-table', -168.4, z, {}, U)),
  ...[-77, -72, -62].map((z) => prefab('table-and-chairs', -171.5, z, {}, U)),
  drawn(-179.62, -75, -179.5, -69, U + 2.4, U + 3.1, C.neon),

  // Two shops on the hill side of the court, staggered, with a tree between.
  ...shop([-224, -88, -214, -80], 'e', C.accent2),
  ...shop([-222, -66, -212, -58], 'e', C.accent3),
  ...tree(-219, -73),

  // The fountain south of the court: a low stone basin (0.55 m) round a water wall (3 m),
  // which also breaks the line from the cinema's doors to the department store's.
  box(-197, -52, -189, -51.7, U, U + 0.55, C.stone),
  box(-197, -44.3, -189, -44, U, U + 0.55, C.stone),
  box(-197, -51.7, -196.7, -44.3, U, U + 0.55, C.stone),
  box(-189.3, -51.7, -189, -44.3, U, U + 0.55, C.stone),
  drawn(-196.7, -51.7, -189.3, -44.3, U, U + 0.35, C.water),
  box(-196.2, -48.3, -189.8, -47.7, U, U + 3, C.dark),
  drawn(-196.2, -48.45, -189.8, -48.3, U + 0.35, U + 2.9, C.water),
  drawn(-196.2, -47.7, -189.8, -47.55, U + 0.35, U + 2.9, C.water),

  // The street-food market: stalls along the hill side facing east (their back doors onto
  // the hill), tables under a pergola.
  ...[-48.5, -44, -39.5].map((z) => prefab('food-stall', -222.5, z, { yaw: 90 }, U)),
  ...pergola([-218, -51, -204, -31], 3.2, 'x'),
  ...[-215, -207].flatMap((x) =>
    [-48, -43.5, -38.5, -34].map((z) => prefab('food-court-table', x, z, {}, U)),
  ),

  // Two more shops toward the department store, and trees.
  ...shop([-182, -46, -170, -38], 'w', C.accent4),
  ...shop([-180, -30, -174, -25], 'n', C.accent1, 3.2),
  ...tree(-172, -52),
  ...tree(-204, -94),
  ...tree(-212, -24),
  ...tree(-186, -24),

  // The bridge across the court, east-west at its middle.
  box(-206, -70, -182, -67, U - 0.2, U, C.stone),
  drawn(-206, -70.15, -182, -66.85, U - 0.5, U - 0.2, C.dark),
  ...edgeRail(-205.75, -182.25, U, 'x', -69.875),
  ...edgeRail(-205.75, -182.25, U, 'x', -67.125),
  // Rails round the court, open at the two flights' heads and the bridge's ends.
  ...holeRails(COURT, U, [
    ['n', -190, -186],
    ['s', -204, -200],
    ['w', -70, -67],
    ['e', -70, -67],
  ]),

  // Department store: rails round the well (open at the flight's head), partial walls.
  ...holeRails(DEPT_WELL, U, [['n', -210, -206]]),
  box(-224, 13.9, -216, 14.1, U, U + 2.4, C.inner),
  box(-200, 21.9, -190, 22.1, U, U + 2.4, C.inner),
  box(-206, -6.1, -198, -5.9, U, U + 2.4, C.inner),
]);

// ---------------------------------------------------------------------------------------
// The cinema's roof terrace (District's roof terrace): parapets, open at the stair's
// head, an outdoor screen on the north edge and benches facing it. The AI can follow.

const P = R + 1.1;
add('roof terrace', [
  box(-226 - T, -148 - T, -190 + T, -148 + T, R, P, C.outer),
  box(-190 - T, -148 + T, -190 + T, -112 - T, R, P, C.outer),
  box(-226 - T, -148 + T, -226 + T, -112 - T, R, P, C.outer),
  box(-226 - T, -112.2, -194.25, -112, R, P, C.outer),
  box(-190.75, -112.2, -190 + T, -112, R, P, C.outer),
  box(-220, -147.6, -196, -147.4, R + 1.2, R + 6, C.screen),
  box(-220.4, -147.6, -220, -147.2, R, R + 6, C.dark),
  box(-196, -147.6, -195.6, -147.2, R, R + 6, C.dark),
  ...[-136, -130, -124].flatMap((z) =>
    [-215, -208, -201].map((x) => prefab('mall-bench', x, z, { yaw: 180 }, R)),
  ),
]);

add('hill ledge', [
  // One stone ledge at the upper floor's level along the west and north walls, over the
  // 2 m sloped cell between the hill and the wall (the terrain can't be both 10 m outside
  // the wall and 5 m inside it on one corner), so the hill walks straight to every door.
  box(-228.2, -150.2, -226 - T, 40, U - 0.2, U, C.stone),
  box(-226 - T, -150.2, -190, -148 - T, U - 0.2, U, C.stone),
  // Rails across its two ends, over the sloped cell's 3.5 m drop.
  box(-228.2, 39.75, -226 - T, 40, U, U + 1.05, C.dark),
  box(-190.25, -150.2, -190, -148 - T, U, U + 1.05, C.dark),
]);

// ---------------------------------------------------------------------------------------
// The promenade (2026-11-15, the user's request: "the promenade and its stores, and the
// connection to the mall's open second floor"): District's plaza on the hill, west of the
// mall. The user placed the strip (x −246..−226, z −116..−26) and thirteen store
// footprints facing it; this builds them and takes out the placeholders.
// - Paved at the deck's level (U), so the promenade runs flush over the ledge onto the
//   deck: the deck is the promenade's other half. Its outer edges step 0.4 m down to the
//   hill (under the 0.45 m step). It runs south to the department store's hill doors.
// - The stores keep the user's footprints: one row, glass fronts east onto the promenade,
//   party walls shared, back doors off the line of the front onto a paved service lane
//   behind; four 3 m alleys through the row join the two. Three are kitchens (District's
//   restaurant court), with the jeweler, bank branch and phone repair District named.
// - The 120 m north-south lanes are broken by blockers alternating between the west and
//   east halves (kiosks, ad columns, billboards, vending machines, art, a clock tower;
//   solid street furniture, not hedges, which shots pass), so no
//   straight line down either half runs much over 35 m.
// - A crashed military helicopter lies across the middle (District's helicopter crash),
//   22 m south of the clock tower.
// - Three gateways on the ledge mark the ways onto the deck (north by the cinema, the
//   court's bridge axis, south by the department store); the clock tower stands on the
//   bridge axis, so the line from the deck's sky bar ends there, not at a shop window.

const PROM = [-264, -118, -228.2, 4]; // paving, store side to the ledge
/** The user's footprints [x0, z0, x1, z1], north to south, with what each became. */
const STORES = [
  { at: [-256.625, -115, -248.625, -109], what: 'cafe', sign: C.accent3 },
  { at: [-256.625, -109, -250.625, -101], what: 'deli', sign: C.accent1 },
  { at: [-258, -101, -252, -93], what: 'phone repair', sign: C.accent2 },
  { at: [-258, -93, -250, -83], what: 'pizzeria', sign: C.accent1 },
  { at: [-258, -80, -252, -72], what: 'jeweler', sign: C.brass },
  { at: [-256, -72, -252, -64], what: 'newsagent', sign: C.accent4 },
  { at: [-259, -64, -249, -58], what: 'bank', sign: C.accent2 },
  { at: [-259, -55, -249, -47], what: 'sushi bar', sign: C.neon },
  { at: [-259, -47, -249, -35], what: 'diner', sign: C.accent3 },
  { at: [-259, -32, -251, -24], what: 'salon', sign: C.accent4 },
  { at: [-257, -24, -249, -18], what: 'boutique', sign: C.neon },
  { at: [-259, -15, -251, -9], what: 'game store', sign: C.accent2 },
  { at: [-261, -9, -251, -3], what: 'sports', sign: C.accent1 },
];
const SH = 4.4; // the row's walls
const PC = { paving: '#cbbfa8', floor: '#d6cfc0' };

/**
 * The row's shells: walls along x merged per line (two neighbors share one), a glass front
 * with a door in the middle on the east, a back door near the north corner on the west, a
 * roof per store, a sign band and a canopy.
 */
function storeRow(stores) {
  const nodes = [];
  const lines = new Map();
  for (const { at } of stores)
    for (const z of [at[1], at[3]]) lines.set(z, [...(lines.get(z) ?? []), [at[0], at[2]]]);
  for (const [z, spans] of lines) {
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const s of spans)
      if (merged.length && s[0] <= merged.at(-1)[1])
        merged.at(-1)[1] = Math.max(merged.at(-1)[1], s[1]);
      else merged.push([...s]);
    for (const [a, b] of merged) nodes.push(wallX(a - T, b + T, z, U, U + SH, C.shopWall));
  }
  for (const { at, sign } of stores) {
    const [x0, z0, x1, z1] = at;
    const mid = (z0 + z1) / 2;
    const span = (z1 - z0 - 2.4) / 2 - 0.6;
    nodes.push(
      wallZ(x1, z0 + T, z1 - T, U, U + SH, C.shopWall, [
        { at: mid, width: 2, bottom: 0, top: 2.6 },
        win(mid - 1.2 - span / 2 - 0.1, span, 0.5, 3),
        win(mid + 1.2 + span / 2 + 0.1, span, 0.5, 3),
      ]),
      wallZ(x0, z0 + T, z1 - T, U, U + SH, C.shopWall, [door(z0 + 1.3, 1.2)]),
      box(x0 - T, z0, x1 + T, z1, U + SH, U + SH + 0.3, C.roof),
      box(x0, z0, x1, z1, 9.9, U, PC.floor),
      drawn(x1 + T, z0 + 0.3, x1 + 0.25, z1 - 0.3, U + 3.3, U + 4.1, sign),
      drawn(x1 + 0.3, z0 + 0.2, x1 + 1.9, z1 - 0.2, U + 2.9, U + 3.0, sign),
    );
  }
  return nodes;
}

/**
 * A store's things in its own frame: u meters in from the front (east) wall, v meters
 * south of its north wall; yaw as placed.
 */
function inStore({ at }, items) {
  const [, z0, x1] = at;
  return items.map(([name, u, v, yaw = 0]) => prefab(name, x1 - u, z0 + v, yaw ? { yaw } : {}, U));
}

const DRESS = {
  cafe: [
    ['espresso-bar', 6, 3.3, 90],
    ['cafe-table', 2, 1.4],
    ['cafe-table', 2.2, 4.6],
    ['potted-plant', 7.3, 5.2],
  ],
  deli: [
    ['shop-counter', 4.5, 4.4, 90],
    ['display-case', 2, 1.6, 90],
    ['display-case', 2, 6.4, 90],
    ['refrigerator', 5.4, 7.2],
  ],
  'phone repair': [
    ['shop-counter', 4.3, 5.2, 90],
    ['tech-display-table', 2, 3, 90],
    ['tech-wall-display', 3, 0.35],
  ],
  pizzeria: [
    ['pizza-oven', 6.7, 2],
    ['kitchen-run', 7.6, 7.6, 90],
    ['dining-set', 2, 2.4],
    ['dining-set', 2, 7.6],
    ['booth-seat', 4.6, 8.7, 90],
  ],
  jeweler: [
    ['display-case', 1.8, 2, 90],
    ['display-case', 1.8, 6, 90],
    ['shop-counter', 4.3, 4.6, 90],
    ['office-safe', 5.3, 7.3],
  ],
  newsagent: [
    ['retail-wall-shelf', 3.6, 5.4, 90],
    ['carton-display', 1.4, 1.6],
    ['carton-display', 1.4, 6.4],
  ],
  bank: [
    ['shop-counter', 5, 1.9, 90],
    ['deposit-boxes', 9.5, 3.6, 90],
    ['office-safe', 7.5, 0.8],
    ['desk', 2.2, 5.2],
    ['office-chair', 2.2, 4.5],
  ],
  'sushi bar': [
    ['sushi-belt', 5.2, 4.5],
    ['kitchen-run', 9.6, 5.6, 90],
    ['sink-counter', 7.6, 7.6],
  ],
  diner: [
    ['booth-seat', 2.2, 1.3, 90],
    ['booth-seat', 4.6, 1.3, 90],
    ['booth-seat', 2.2, 10.7, 90],
    ['dining-set', 4, 6],
    ['kitchen-run', 9.6, 5, 90],
    ['kitchen-run', 9.6, 8, 90],
    ['refrigerator', 9, 11.2],
  ],
  salon: [
    ['salon-station', 2.4, 0.6],
    ['salon-station', 4.2, 0.6],
    ['salon-station', 6, 0.6],
    ['shop-counter', 2.6, 6.2, 90],
  ],
  boutique: [
    ['clothes-rail', 2.4, 1, 90],
    ['clothes-rail', 2.4, 5, 90],
    ['round-rack', 4.8, 3.6],
    ['fitting-rooms', 7.1, 4.1, 90],
    ['mannequin', 0.8, 1.2],
  ],
  'game store': [
    ['tech-display-table', 3, 3, 90],
    ['gpu-case', 1.2, 0.9],
    ['gpu-case', 1.2, 5.1],
    ['shop-counter', 5.8, 3.6, 90],
  ],
  sports: [
    ['treadmill', 2.2, 1.4],
    ['treadmill', 3.6, 1.4],
    ['dumbbell-rack', 9.6, 3.8, 90],
    ['retail-wall-shelf', 6.2, 5.6],
  ],
};

/** A closed 4 x 4 m kiosk, its shutter south. */
const kiosk = (x, z, roof) => [place('kiosk-booth', x, z, { roof })];

/** A gateway on the ledge: two stone pylons, a beam and a sign band between them. */
const gateway = (za, zb, sign, m = Math.min(1.5, (zb - za) / 4)) => [
  box(-227.6, za - 0.4, -226.8, za + 0.4, U, U + 5.2, C.stone),
  box(-227.6, zb - 0.4, -226.8, zb + 0.4, U, U + 5.2, C.stone),
  drawn(-227.5, za + 0.4, -226.9, zb - 0.4, U + 4.5, U + 5.0, C.stone),
  drawn(-227.65, za + m, -227.5, zb - m, U + 4.55, U + 4.95, sign),
  drawn(-226.9, za + m, -226.75, zb - m, U + 4.55, U + 4.95, sign),
];

const terrace = (x, zs) => zs.map((z) => prefab('table-and-chairs', x, z, {}, U));

add('promenade', [
  // The paving, less the stores' footprints (each store has its own floor).
  ...slab(
    PROM,
    STORES.map((s) => s.at),
    9.9,
    U,
    PC.paving,
  ),
  ...storeRow(STORES),
  ...STORES.flatMap((s) => inStore(s, DRESS[s.what])),

  // Out from the fronts, so the line hugging the shop windows breaks too.
  ...vending(-251.6, 2, -94.6),
  place('photo-booth', -248.4, -94.6),
  ...adColumn(-250, -72.6, C.accent1),
  ...billboard(-249.35, -246.95, -72.6, C.accent2),
  // West-half blockers (store side), north to south.
  ...kiosk(-244, -101, C.accent2), // newsagent's kiosk
  place('ad-shelter', -239.6, -101, { poster: C.accent3 }),
  ...terrace(-246.5, [-91, -86]), // the pizzeria's terrace
  ...adColumn(-243.6, -88.5, C.accent4),
  // The clock tower, on the court's bridge axis: a landmark seen from the deck.
  place('clock-tower', -241, -68.5),
  // Its stone wing walls (a memorial facing north, a district map facing south).
  place('memorial-wall', -245.8, -68.5, null, 180),
  place('memorial-wall', -243.4, -68.5, null, 180),
  place('memorial-wall', -238.6, -68.5, { plaque: C.accent2 }),
  prefab('mall-bench', -241, -71.5, {}, U),
  prefab('mall-bench', -241, -65.5, { yaw: 180 }, U),
  // The sushi bar's and diner's terrace: a timber service hutch and a column on its edge.
  ...terrace(-246, [-53, -49, -44, -40, -37]),
  place('service-hutch', -243.2, -50.8, null, 90),
  ...adColumn(-243.2, -41.8, C.accent3),
  ...kiosk(-246.6, -29, C.accent3), // a coffee kiosk
  ...vending(-244.6, 3, -29),
  ...adColumn(-240.95, -29, C.accent2),
  ...billboard(-240.3, -237.9, -29, C.accent1),

  // East-half blockers (deck side).
  // Rusted steel slabs (public art), overlapping end-on, then a column and a billboard.
  place('art-slabs', -235.4, -86),
  ...adColumn(-232.2, -86, C.neon),
  ...billboard(-231.55, -228.15, -86, C.accent3),
  prefab('mall-bench', -236, -87.5, { yaw: 180 }, U),
  ...tree(-233, -91),
  // The helicopter crash (District's, the user's pick): laid across the promenade's
  // middle, turned 25° off square, 22 m south of the clock tower so the two landmarks
  // stand apart. Its nose points at the deck, its tail boom climbs to 9 m over the
  // terrace. Its cabin is open on both sides (walk in), and its cargo lies by the doorways.
  prefab('crashed-helicopter', -235.5, -47, { yaw: 115 }, U),
  prefab('weapon-crate', -240.7, -49.2, { yaw: 25 }, U),
  prefab('ammo-crate', -234.7, -51.8, { yaw: -10 }, U),
  prefab('medical-crate', -236.1, -42.3, { yaw: 40 }, U),
  // The crash site's cordon: barrier blocks across the lane past its nose.
  ...[-230.7, -229.3, -227.9].map((x) => place('barrier-block', x, -53)),
  // An ice-cream kiosk, vending machines, a column and a billboard.
  ...kiosk(-236, -14, C.accent4),
  ...vending(-234, 2, -14),
  ...adColumn(-231.35, -14, C.accent1),
  ...billboard(-230.7, -228.3, -14, C.accent2),
  ...tree(-234, -9),

  // Trees and benches at the ends; lamps down the deck side.
  ...tree(-240, -112),
  prefab('mall-bench', -235, -112, { yaw: 90 }, U),
  ...tree(-241, 0),
  ...[-108, -94, -78, -61, -42, -24, -4].map((z) => place('street-lamp', -229.6, z)),

  // The service lane behind the row: bins by the back doors.
  prefab('skip-bin', -261.5, -105, { yaw: 90 }, U),
  prefab('wheelie-bin', -259, -90.5, {}, U),
  prefab('skip-bin', -261.5, -51, { yaw: 90 }, U),
  prefab('wheelie-bin', -260.2, -28, {}, U),
  prefab('wheelie-bin', -262.8, -12, {}, U),

  // The ways onto the deck.
  ...gateway(-103.2, -100, C.accent2), // the slot between the staff stair and the arcade
  ...gateway(-79.4, -66.2, C.accent3),
  ...gateway(-35, -17.5, C.accent1),
]);

// ---------------------------------------------------------------------------------------
// Into the map

const map = JSON.parse(readFileSync(FILE, 'utf8'));
const replaced = (n) =>
  (n.type === 'group' && ['mall', 'mall-floor-footprint', 'Room'].includes(n.name)) ||
  // The user's promenade placeholders (built as the promenade group).
  n.id === 'promenade-floorplan-tbd' ||
  n.id?.startsWith('promendate-facing-store-floorplan-') ||
  (n.type === 'box' &&
    n.pos[1] === 10.2 &&
    n.size[1] === 0.2 &&
    n.size[0] >= 36 &&
    n.size[2] >= 36);
const gone = map.nodes.filter(replaced);
map.nodes = [...map.nodes.filter((n) => !replaced(n)), group('mall', out)];

// The ground under the footprints, leveled to the ground floor slab's underside.
const t = map.terrain;
const [ox, oz] = t.origin;
let leveled = 0;
for (const [x0, z0, x1, z1] of [CINEMA, MAIN, DEPT])
  for (let j = Math.ceil((z0 - oz) / t.cellSize); j <= Math.floor((z1 - oz) / t.cellSize); j++)
    for (let i = Math.ceil((x0 - ox) / t.cellSize); i <= Math.floor((x1 - ox) / t.cellSize); i++)
      if (t.heights[j][i] !== G - 0.2) ((t.heights[j][i] = G - 0.2), leveled++);

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(
  `mall: ${count(out)} nodes in ${out.length} groups; took out ${gone.length} placeholder nodes; leveled ${leveled} ground corners`,
);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
