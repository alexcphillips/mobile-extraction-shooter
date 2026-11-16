// d2's bunker (2026-11-15, the user's request: "finish up the bunker area ... darker ... close
// quarters engagements with hallway chokes", primarily military loot with the best things
// in key rooms). Built under the hill on the user's floorplan (their rooms are the anchors),
// written into content/maps/d2.json as one group named `bunker`. Re-runnable: it replaces
// its own group, and on the first run takes out the user's `bunker-floorplan` group. It
// leaves the rest of d2 alone, apart from the terrain over the bunker, which it cuts out
// (holes) and lids at the hill's height.
//
// Plan (docs/design/maps/d2.md → The bunker has the why):
// - One way in, on purpose (the user's call: "this is the main risk of the area"): jammed
//   blast doors in a concrete portal in the cliff east of the hill, a 2 m gap.
// - Two levels, 2.4 m clear below (2.6 above): lower floor 0, upper 2.575, as the user drew.
// - One loop (the user: "a loop is ok"): bay → corridors → barracks → operations → stair up
//   → command → corridor → quarters → generators → fuel store → stair down → storage →
//   corridor → barracks. The key rooms are dead ends off it.
// - Corridors 2–2.5 m wide, bent, 6–9 m between corners, doorways 2 m with a blast-door
//   frame at the two chokes into the rooms.
// - Key rooms: armory, comms, medical (lower), commander's office (upper), each locked with
//   its own bunker keycard. No loot or keys placed yet (the user's call).
// - Dark: baked colors only (no lights in the renderer), so dark concrete and steel with
//   amber caged lamps, red in the corridors.
//
// Usage: node scripts/build-d2-bunker.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { box, drawn, group, prefab, r2 } from './mapkit/nodes.mjs';

const FILE = new URL('../content/maps/d2.json', import.meta.url).pathname;
const DRY = process.argv.includes('--dry-run');

// Levels.
const C0 = 2.375; // lower ceiling: the deck's underside
const F1 = 2.575; // upper floor: the deck's top
const C1 = 5.175; // upper ceiling, and the bay's
const HILL = 10;
const T = 0.1; // half a wall
const FACADE = -226.3; // the portal's inner face

const C = {
  floor: '#3b3d40',
  deck: '#3f4144',
  ceiling: '#2b2d30',
  wall: '#4f5254',
  wallUp: '#55585a',
  bay: '#5a5d5f',
  concrete: '#8a8a84',
  steel: '#5f646a',
  hazard: '#d9a441',
  dark: '#2a2c30',
  red: '#d0342c',
  glass: '#4a5a60',
};

// ---------------------------------------------------------------------------------------
// The plan: rooms as [x0, z0, x1, z1].

const LOWER = {
  bay: [-246, 164, FACADE, 180], // the vehicle bay inside the doors, full height
  guard: [-250, 170, -246, 178],
  cor1: [-241.5, 155, -239, 164], // north from the bay, its end an alcove
  cor2: [-248, 157, -241.5, 159.5], // west to the barracks
  barracks: [-258, 153, -248, 163],
  ops: [-258, 143, -248, 153],
  armory: [-256, 137, -248, 143], // key
  stairTop: [-259, 143, -258, 145], // stair 1's high end, outside ops
  comms: [-264, 145, -258, 151], // key
  cor3: [-264, 156.5, -258, 159],
  storage: [-278, 154, -264, 164],
  medical: [-274, 164, -266, 168], // key
};
const UPPER = {
  command: [-267, 139, -259, 151],
  office: [-271, 140, -267, 148], // key: the commander's office
  records: [-259, 145, -255, 149],
  well1: [-259, 143, -255, 145], // stair 1
  cor4: [-266, 151, -263.5, 161],
  quarters: [-271, 161, -257, 173],
  cor5: [-274, 163, -271, 167.5], // a vestibule: its two doorways offset, no line through
  generators: [-288, 158, -274, 170],
  fuel: [-285, 152, -278, 158],
  well2: [-278, 154, -274, 156], // stair 2
};
const WELLS = [UPPER.well1, UPPER.well2];
const TALL = ['bay'];

const KEY = {
  armory: 'bunker-armory-keycard',
  comms: 'bunker-comms-keycard',
  medical: 'bunker-medical-keycard',
  command: 'bunker-command-keycard',
};

/**
 * Openings by level, on the wall along `axis` ('x': a wall along x at z = c; 'z': along z
 * at x = c). `cut` takes the wall away over [a, b] (rooms joined full height); otherwise a
 * doorway `w` wide centered `at`, up to `top`, with a door if `door` (locked if it names a
 * key), glass if `glass`, a blast-door frame if `blast`.
 */
const OPENINGS = [
  // Lower.
  { lvl: 0, axis: 'x', c: 164, at: -240.25, w: 2.5, top: C0 }, // bay → corridor
  { lvl: 0, axis: 'z', c: -246, at: 176.5, w: 1.2, top: 2.1, door: {} }, // guard room
  { lvl: 0, axis: 'z', c: -246, at: 172.5, w: 2, bottom: 1.1, top: 1.8, glass: true },
  { lvl: 0, axis: 'z', c: -241.5, cut: [157, 159.5] }, // the corridor's bend
  { lvl: 0, axis: 'z', c: -248, at: 158.25, w: 2, top: 2.2, blast: true }, // → barracks
  { lvl: 0, axis: 'x', c: 153, at: -251.5, w: 2, top: 2.2 }, // barracks → operations
  { lvl: 0, axis: 'z', c: -258, cut: [143, 145] }, // operations → stair 1
  { lvl: 0, axis: 'z', c: -259, cut: [143, 145] }, // stair 1's high end
  { lvl: 0, axis: 'x', c: 143, at: -250.5, w: 1.4, top: 2.1, door: { key: KEY.armory } },
  { lvl: 0, axis: 'z', c: -258, at: 149, w: 1.4, top: 2.1, door: { key: KEY.comms } },
  { lvl: 0, axis: 'z', c: -258, at: 157.75, w: 2, top: 2.2 }, // barracks → corridor 3
  { lvl: 0, axis: 'z', c: -264, at: 157.75, w: 2, top: 2.2 }, // corridor 3 → storage
  { lvl: 0, axis: 'x', c: 164, at: -270, w: 1.4, top: 2.1, door: { key: KEY.medical } },
  { lvl: 0, axis: 'z', c: -278, cut: [154, 156] }, // stair 2's high end
  // Upper.
  { lvl: 1, axis: 'z', c: -259, cut: [143, 145] }, // stair 1 → command
  { lvl: 1, axis: 'z', c: -259, at: 147.5, w: 1.2, top: 2.1, door: {} }, // records
  { lvl: 1, axis: 'z', c: -267, at: 146, w: 1.4, top: 2.1, door: { key: KEY.command } },
  { lvl: 1, axis: 'x', c: 151, at: -264.75, w: 2, top: 2.2 }, // command → corridor 4
  { lvl: 1, axis: 'x', c: 161, at: -264.75, w: 2, top: 2.2 }, // corridor 4 → quarters
  { lvl: 1, axis: 'z', c: -271, at: 166.4, w: 1.8, top: 2.2 }, // quarters → corridor 5
  { lvl: 1, axis: 'z', c: -274, at: 164.1, w: 1.8, top: 2.2, blast: true }, // → generators
  { lvl: 1, axis: 'x', c: 158, at: -281.5, w: 2, top: 2.2 }, // generators → fuel
  { lvl: 1, axis: 'z', c: -278, cut: [154, 156] }, // fuel → stair 2
];

// ---------------------------------------------------------------------------------------
// Walls from the rooms' edges: one wall per straight run of edge on a line (two rooms
// sharing an edge share it), less cuts, with doorways as openings. The bay's walls are full
// height and take precedence on the lines they share with lower rooms.

const EPS = 1e-6;

/** Intervals [a, b] merged where they touch or overlap. */
function merge(spans) {
  const out = [];
  for (const s of [...spans].sort((p, q) => p[0] - q[0]))
    if (out.length && s[0] <= out.at(-1)[1] + EPS) out.at(-1)[1] = Math.max(out.at(-1)[1], s[1]);
    else out.push([...s]);
  return out;
}

/** Intervals less [a, b]. */
const minus = (spans, [a, b]) =>
  spans.flatMap(([s, e]) =>
    [
      [s, Math.min(e, a)],
      [Math.max(s, b), e],
    ].filter(([p, q]) => q - p > EPS),
  );

/** The edges of rooms by line: key 'x:z' or 'z:x' → spans. The facade line is left out. */
function edges(rooms) {
  const lines = new Map();
  const put = (axis, c, a, b) => {
    if (axis === 'z' && Math.abs(c - FACADE) < EPS) return;
    const k = `${axis}:${c}`;
    lines.set(k, [...(lines.get(k) ?? []), [a, b]]);
  };
  for (const [x0, z0, x1, z1] of rooms) {
    put('x', z0, x0, x1);
    put('x', z1, x0, x1);
    put('z', x0, z0, z1);
    put('z', x1, z0, z1);
  }
  for (const [k, v] of lines) lines.set(k, merge(v));
  return lines;
}

/** Segments {axis, c, a, b, bottom, top, color} for a level. */
function segments(lvl) {
  const segs = [];
  const cuts = OPENINGS.filter((o) => o.lvl === lvl && o.cut);
  const cutLine = (axis, c, spans) =>
    cuts
      .filter((o) => o.axis === axis && Math.abs(o.c - c) < EPS)
      .reduce((s, o) => minus(s, o.cut), spans);
  if (lvl === 0) {
    const tall = edges(TALL.map((k) => LOWER[k]));
    const low = edges(
      Object.entries(LOWER)
        .filter(([k]) => !TALL.includes(k))
        .map(([, r]) => r),
    );
    for (const [k, spans] of tall) {
      const [axis, c] = [k[0], Number(k.slice(2))];
      for (const [a, b] of cutLine(axis, c, spans))
        segs.push({ axis, c, a, b, bottom: 0, top: C1, color: C.bay });
    }
    for (const [k, spans] of low) {
      const [axis, c] = [k[0], Number(k.slice(2))];
      let rest = cutLine(axis, c, spans);
      for (const t of tall.get(k) ?? []) rest = minus(rest, t);
      for (const [a, b] of rest) segs.push({ axis, c, a, b, bottom: 0, top: C0, color: C.wall });
    }
  } else {
    for (const [k, spans] of edges(Object.values(UPPER))) {
      const [axis, c] = [k[0], Number(k.slice(2))];
      for (const [a, b] of cutLine(axis, c, spans))
        segs.push({ axis, c, a, b, bottom: F1, top: C1, color: C.wallUp });
    }
  }
  return segs;
}

/**
 * Wall nodes, ends fitted so walls never cut into each other: a wall along x runs on over
 * a corner it turns (covering it) and stops at the face of a wall it meets side-on; a wall
 * along z stops short of any wall along x passing its end.
 */
function walls(lvl) {
  const segs = segments(lvl);
  const xs = segs.filter((s) => s.axis === 'x');
  const zs = segs.filter((s) => s.axis === 'z');
  const ops = OPENINGS.filter((o) => o.lvl === lvl && !o.cut);
  const nodes = [];
  for (const s of xs) {
    const end = (x, out) => {
      const z = zs.find((w) => Math.abs(w.c - x) < EPS && s.c >= w.a - EPS && s.c <= w.b + EPS);
      if (!z) return x;
      const inside = s.c > z.a + EPS && s.c < z.b - EPS;
      return inside ? x - out * T : x + out * T;
    };
    const x0 = end(s.a, -1);
    const x1 = end(s.b, 1);
    const mine = ops.filter(
      (o) => o.axis === 'x' && Math.abs(o.c - s.c) < EPS && o.at > s.a && o.at < s.b,
    );
    nodes.push(wall('x', s, x0, x1, mine));
  }
  for (const s of zs) {
    const passes = (z) =>
      xs.some((w) => Math.abs(w.c - z) < EPS && s.c >= w.a - EPS && s.c <= w.b + EPS);
    const z0 = passes(s.a) ? s.a + T : s.a;
    const z1 = passes(s.b) ? s.b - T : s.b;
    const mine = ops.filter(
      (o) => o.axis === 'z' && Math.abs(o.c - s.c) < EPS && o.at > s.a && o.at < s.b,
    );
    nodes.push(wall('z', s, z0, z1, mine));
  }
  return [...nodes, ...ops.flatMap((o) => fittings(o, lvl))];
}

function wall(axis, s, a, b, ops) {
  const mid = (a + b) / 2;
  const openings = ops.map((o) => ({
    along: r2(axis === 'x' ? o.at - mid : mid - o.at),
    width: o.w,
    bottom: o.bottom ?? 0,
    top: o.top,
    ...(o.glass ? { glass: C.glass } : {}),
  }));
  return {
    type: 'wall',
    pos: axis === 'x' ? [r2(mid), r2(s.bottom), r2(s.c)] : [r2(s.c), r2(s.bottom), r2(mid)],
    ...(axis === 'z' ? { yaw: 90 } : {}),
    size: [r2(b - a), r2(s.top - s.bottom), 0.2],
    color: s.color,
    openings,
  };
}

/** A doorway's door or blast-door frame. */
function fittings(o, lvl) {
  const y = lvl === 0 ? 0 : F1;
  const [x, z] = o.axis === 'x' ? [o.at, o.c] : [o.c, o.at];
  const yaw = o.axis === 'x' ? 0 : 90;
  const out = [];
  if (o.door)
    out.push({
      type: 'door',
      pos: [r2(x), r2(y), r2(z)],
      ...(yaw ? { yaw } : {}),
      size: [r2(o.w - 0.04), r2(o.top - 0.02)],
      thickness: o.door.key ? 0.12 : 0.05,
      ...(o.door.key ? { key: o.door.key } : {}),
      color: o.door.key ? C.steel : '#6a6e72',
    });
  if (o.blast) out.push(prefab('blast-door-frame', x, z, yaw ? { yaw } : {}, y));
  return out;
}

// ---------------------------------------------------------------------------------------
// Slabs: a union of rects less holes, as few boxes as a band-by-band merge gives.

function union(rects, holes, bottom, top, color) {
  const xs = [...new Set([...rects, ...holes].flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const zs = [...new Set([...rects, ...holes].flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const inside = (rs, x, z) => rs.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
  const filled = (i, j) => {
    const x = (xs[i] + xs[i + 1]) / 2;
    const z = (zs[j] + zs[j + 1]) / 2;
    return inside(rects, x, z) && !inside(holes, x, z);
  };
  const bands = [];
  for (let j = 0; j < zs.length - 1; j++) {
    const runs = [];
    for (let i = 0; i < xs.length - 1; i++)
      if (filled(i, j))
        if (runs.length && runs.at(-1)[1] === xs[i]) runs.at(-1)[1] = xs[i + 1];
        else runs.push([xs[i], xs[i + 1]]);
    const prev = bands.at(-1);
    if (prev && prev.z1 === zs[j] && JSON.stringify(prev.runs) === JSON.stringify(runs))
      prev.z1 = zs[j + 1];
    else bands.push({ z0: zs[j], z1: zs[j + 1], runs });
  }
  return bands.flatMap(({ z0, z1, runs }) =>
    runs.map(([x0, x1]) => box(x0, z0, x1, z1, bottom, top, color)),
  );
}

const lowRooms = Object.values(LOWER);
const upRooms = Object.values(UPPER);
const bay = LOWER.bay;
const grow = ([x0, z0, x1, z1], d) => [x0 - d, z0 - d, x1 + d, z1 + d];

const out = [];
const add = (name, nodes) => out.push(group(name, nodes));

add('slabs', [
  // The floor runs on under the portal's doorway (the cliff cut leaves no ground there).
  ...union([...lowRooms, [FACADE, 164, -225.7, 180]], [], -0.2, 0, C.floor),
  // The deck: the lower rooms' ceiling and the upper rooms' floor, less the stair wells and
  // a band round the bay (its walls run full height).
  ...union(
    [...lowRooms.filter((r) => r !== bay), ...upRooms.filter((r) => !WELLS.includes(r))],
    [...WELLS, grow(bay, T)],
    C0,
    F1,
    C.deck,
  ),
  ...union([...upRooms, bay], [], C1, C1 + 0.2, C.ceiling),
]);

add('walls', [...walls(0), ...walls(1)]);

add('stairs', [
  // Both rise west, 1.8 m wide between the walls either side.
  { type: 'stairs', pos: [-257, 0, 144], yaw: -90, size: [1.8, F1, 4], color: C.steel },
  { type: 'stairs', pos: [-276, 0, 155], yaw: -90, size: [1.8, F1, 4], color: C.steel },
]);

// The portal in the cliff: a concrete face up past the hill (a 0.6 m parapet), blast doors
// jammed with a 2 m gap, hazard stripes, and cover outside on the low ground.
add('portal', [
  {
    type: 'wall',
    pos: [-226, 0, 172],
    yaw: 90,
    size: [20, HILL + 0.6, 0.6],
    color: C.concrete,
    openings: [{ along: 0, width: 8, bottom: 0, top: 4.5 }],
  },
  box(-226.25, 168, -225.75, 172.6, 0, 4.5, C.steel),
  box(-226.25, 174.6, -225.75, 176, 0, 4.5, C.steel),
  ...[0.4, 1.4, 2.4, 3.4].flatMap((y) => [
    drawn(-225.75, 168.3, -225.74, 172.3, y, y + 0.35, C.hazard),
    drawn(-225.75, 174.9, -225.74, 175.7, y, y + 0.35, C.hazard),
  ]),
  drawn(-225.7, 167.6, -225.69, 176.4, 4.6, 5.0, C.hazard),
  // Rails across the lid's ends over the cliff, where it stands out from the slope.
  box(-228, 163.8, FACADE, 164, HILL, HILL + 1.05, C.dark),
  box(-228, 180, FACADE, 180.2, HILL, HILL + 1.05, C.dark),
  prefab('jersey-barrier', -219, 169, { yaw: 80 }, 0),
  prefab('jersey-barrier', -216.5, 177.5, { yaw: 100 }, 0),
  prefab('sandbag-wall', -221.5, 181.5, { yaw: 20 }, 0),
  prefab('flood-light', -223, 165.5, { yaw: 120 }, 0),
]);

// ---------------------------------------------------------------------------------------
// Dressing: cover and story, no loot. Lamps hang from the ceilings (amber in rooms, red in
// the corridors: the emergency circuit).

const lamp = (x, z, y, red) =>
  prefab('bunker-lamp', x, z, red ? { colors: { lamp: C.red } } : {}, y);
const P = (id, x, z, yaw, y = 0) => prefab(id, x, z, yaw ? { yaw } : {}, y);

add('bay', [
  // A checkpoint across the door's gap, so the way in turns at once.
  ...[172.2, 173.6, 175].map((z) => P('barrier-block', -229.4, z)),
  ...[166.2, 178.2].map((z) => P('barrier-block', -231, z)),
  P('sandbag-wall', -236.5, 167.5, 90),
  P('sandbag-wall', -236.5, 178, 90),
  P('semi-tractor', -235, 171, 90),
  P('shipping-container-sealed', -240.5, 175.5),
  P('sandbag-wall', -240.25, 166.2),
  // Floor markings and lamps.
  drawn(-229, 164.2, -228.6, 179.8, 0, 0.01, C.hazard),
  lamp(-236, 168, C1),
  lamp(-236, 177, C1),
  lamp(-230, 172, C1, true),
]);

add('rooms', [
  // Guard room: lockers, a chair at the window.
  P('locker-bank', -249.6, 172, 90),
  P('locker-bank', -249.6, 175, 90),
  P('office-chair', -246.9, 172.5, 90),
  lamp(-248, 174, C0),
  // Corridors 1 and 2: red lamps; the alcove at the end.
  lamp(-240.25, 161, C0, true),
  lamp(-240.25, 156.2, C0, true),
  lamp(-245, 158.25, C0, true),
  // Barracks: bunks along the north and south walls, a mess table and lockers mid-room.
  ...[-256.5, -253.5].map((x) => P('bunk-bed', x, 153.7, 90)),
  ...[-256.5, -253.5, -250.5].map((x) => P('bunk-bed', x, 162.3, 90)),
  // Lockers back to back across the line through the doorways (corridor 2 → corridor 3).
  P('dining-set', -253, 156, 90),
  P('locker-bank', -253.5, 158, 90),
  P('locker-bank', -252.95, 158, -90),
  lamp(-253, 156, C0),
  lamp(-253, 160.5, C0),
  // Operations: the map table, a server row, a screen.
  P('ops-table', -252.5, 147.5),
  P('server-row', -248.65, 148, -90),
  P('office-screen', -254.8, 150.6),
  lamp(-252.5, 147.5, C0),
  lamp(-255.5, 151.5, C0),
  // Armory (key): lockers and deposit boxes; the racks and loot come later.
  P('locker-bank', -254.6, 137.4),
  P('locker-bank', -252.6, 137.4),
  P('deposit-boxes', -249.8, 137.5),
  lamp(-252, 140, C0),
  // Comms (key): racks and a server row.
  ...[146, 146.75, 147.5].map((z) => P('server-rack', -263.45, z, 90)),
  P('server-row', -261, 150.4),
  lamp(-261, 148, C0),
  // Corridor 3.
  lamp(-261, 157.75, C0, true),
  // Storage: two rows of cages with a cut-through, the stair along the north wall.
  // (The west row is half a cage off the east one, so no seam lines up.)
  ...[156.8, 157.6, 158.4, 159.2, 161.6, 162.4].map((z) => P('roll-cage', -267.5, z)),
  ...[157.2, 158, 158.8, 159.6, 162, 162.8].map((z) => P('roll-cage', -271.5, z)),
  P('stock-crate', -275.5, 160.5),
  P('stock-crate', -275.5, 162.2),
  P('cardboard-bale', -265.3, 162.9),
  lamp(-269.5, 160.5, C0),
  lamp(-275.5, 158, C0),
  // Medical (key): beds and a sink.
  P('exam-bed', -272.5, 166),
  P('exam-bed', -270.8, 166),
  P('sink-counter', -267.6, 167.55, 180),
  lamp(-270, 166, C0),

  // Upper. Command: the map table, a server row, a screen.
  P('ops-table', -263.5, 146, 90, F1),
  // A server row just inside the corridor's doorway, so the corridor turns into the room.
  P('server-row', -264.5, 149.2, 0, F1),
  P('server-row', -263, 139.6, 0, F1),
  lamp(-263, 142.5, C1),
  lamp(-263, 148.5, C1),
  // Commander's office (key) and records.
  P('bookcase-tall', -270.6, 144, 90, F1),
  lamp(-269, 144, C1),
  P('bookcase-tall', -257, 148.6, 0, F1),
  lamp(-257, 147, C1),
  // Corridors 4 and 5.
  lamp(-264.75, 154, C1, true),
  lamp(-264.75, 158.5, C1, true),
  lamp(-272.5, 165.25, C1, true),
  // Quarters: three rows of bunks with a cut-through, and lockers across corridor 4's
  // doorway, so the corridor turns into the room. (Bunks are seen through above and between
  // their decks, so lockers and walls do the blocking.)
  P('locker-bank', -265.65, 162.6, 0, F1),
  P('locker-bank', -263.85, 162.6, 0, F1),
  ...[-268.5, -264.75, -261.5].flatMap((x) => [
    ...(x === -264.75 ? [] : [P('bunk-bed', x, 164, 0, F1)]),
    P('bunk-bed', x, 166.3, 0, F1),
    P('bunk-bed', x, 170.5, 0, F1),
  ]),
  lamp(-266.75, 165, C1),
  lamp(-263.25, 170.5, C1),
  // Generators: two sets, barrels.
  P('bunker-generator', -283, 162, 0, F1),
  P('bunker-generator', -279, 166.5, 0, F1),
  ...[
    [-286.6, 168.4],
    [-285.8, 168.9],
    [-286.7, 169.3],
  ].map(([x, z]) => P('steel-barrel', x, z, 0, F1)),
  lamp(-281, 160.5, C1),
  lamp(-281, 166.5, C1),
  // Fuel store.
  P('steel-barrel-pallet-1', -283, 154.5, 0, F1),
  P('hazard-barrel', -280.6, 152.8, 0, F1),
  P('hazard-barrel-red', -279.8, 153.1, 0, F1),
  lamp(-281.5, 155, C1, true),
]);

// ---------------------------------------------------------------------------------------
// Into the map

const map = JSON.parse(readFileSync(FILE, 'utf8'));
const replaced = (n) => n.type === 'group' && ['bunker', 'bunker-floorplan'].includes(n.name);
const gone = map.nodes.filter(replaced);

// The terrain over the bunker: hill cells (all corners at the hill's height) the bunker's
// rooms or walls reach are cut out, with a lid at the hill's height in the ground's color.
// The user's cliff cut (x −228..−226 over the bay) is kept and lidded back to the portal.
const t = map.terrain;
const [ox, oz] = t.origin;
const cs = t.cellSize;
const holes = new Set(t.holes.map(([i, j]) => `${i},${j}`));
const hill = (i, j) =>
  [t.heights[j][i], t.heights[j][i + 1], t.heights[j + 1][i], t.heights[j + 1][i + 1]].every(
    (h) => h >= HILL - EPS,
  );
let cut = 0;
for (const [x0, z0, x1, z1] of [...lowRooms, ...upRooms].map((r) => grow(r, 0.4)))
  for (let j = Math.floor((z0 - oz) / cs); j < Math.ceil((z1 - oz) / cs); j++)
    for (let i = Math.floor((x0 - ox) / cs); i < Math.ceil((x1 - ox) / cs); i++)
      if (hill(i, j) && !holes.has(`${i},${j}`)) (holes.add(`${i},${j}`), cut++);
t.holes = [...holes]
  .map((k) => k.split(',').map(Number))
  .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const lids = t.holes
  .map(([i, j]) => [ox + i * cs, oz + j * cs, ox + (i + 1) * cs, oz + (j + 1) * cs])
  .filter(([x0, z0, x1, z1]) => x1 <= -226 + EPS && x0 >= -300 && z0 >= 120 && z1 <= 200)
  .map(([x0, z0, x1, z1]) => [x0, z0, Math.min(x1, FACADE), z1]);
add('lid', union(lids, [], HILL - 0.2, HILL, t.color));

map.nodes = [...map.nodes.filter((n) => !replaced(n)), group('bunker', out)];

const count = (ns) => ns.reduce((s, n) => s + (n.type === 'group' ? count(n.nodes) : 1), 0);
console.log(
  `bunker: ${count(out)} nodes in ${out.length} groups; took out ${gone.length} groups; cut ${cut} terrain cells`,
);
if (!DRY) {
  const options = (await prettier.resolveConfig(FILE)) ?? {};
  await writeFile(FILE, await prettier.format(layout(map), { ...options, filepath: FILE }));
}
