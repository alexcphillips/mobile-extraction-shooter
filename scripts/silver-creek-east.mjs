// Silver Creek's east end (roadmap MT-8, 2026-11-10), used by gen-silver-creek.mjs: the rail
// yard with its freight dock and chip loading tower, the leads into the engine shed (its pit,
// a switcher and a tool room), the water tower and pump house, the bunkhouse and cookhouse,
// the equipment depot (its crane bridge, parts cage, yard office and tire shop), the
// equipment yard, the fuel tanks in their bund, a jackknifed
// tanker on the highway (truck-3), roadworks by the east extract, and cover across the slope
// and the yard.
//
// Claude's calls, easy to change; the reasons are in docs/design/maps/silver-creek.md
// (the east end). World coordinates throughout: x east, z south, y up. The valley floor
// here is flat at y 0; the ridge slope rises north of z 36.

import { buildingKit } from './mapkit/building.mjs';
import { fenceRun } from './mapkit/fence.mjs';

// Grid electrics roll the substation's table, not office/computer electrical (looting.md).
const GRID_MIX = { tables: { substation: 0.8, industrial: 0.2 }, empty: 0.15 };

/**
 * h: the generator's helpers (box, drawn, group, prefab, along, label, C, r2, groundAt,
 * groundRange). s: the site (tower {x, z}, PIT {x0, x1, z0, z1}).
 */
export function buildEastEnd(h, s) {
  const { box, drawn, group, prefab, along, C, r2, groundAt, groundRange } = h;
  const { tower, PIT } = s;
  Object.assign(C, {
    'shed-brick': '#7e4436',
    'shed-brick-dark': '#6a382c',
    depot: '#8a9096',
    'depot-dark': '#5e6468',
    chips: '#c8a874',
    'chip-car': '#6e5a40',
    tanker: '#c8c8c0',
    hazard: '#d8b52e',
    culvert: '#a6a29a',
    'tie-stack': '#4f4033',
    'bunk-frame': '#5a4a3a',
    mattress: '#8a8a78',
    'siding-green': '#6f7a5e',
    'siding-tan': '#b09a74',
  });
  const { wX, wZ, door, win, doorX, doorZ, roof, shell, porch, slabWithHoles } = buildingKit(h);
  /** A prefab at y (default the valley floor). */
  const at = (name, x, z, y = 0, extra = {}) => prefab(name, x, z, extra, y);
  /** A prefab standing on the terrain (its middle's ground). */
  const on = (name, x, z, extra = {}) => prefab(name, x, z, extra, r2(groundAt(x, z)));
  /** A prefab on the lowest ground under a footprint (a pile on a slope beds in uphill). */
  const bedded = (name, x, z, hw, hd, extra = {}) =>
    prefab(name, x, z, extra, r2(groundRange(x - hw, z - hd, x + hw, z + hd)[0]));
  /** A cylinder from a to b ([x, y, z]), lying along that line. */
  const pipe = (a, b, radius, color, extra = {}) => {
    const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(dx, dy, dz);
    return {
      type: 'cylinder',
      pos: [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2 - len / 2), r2((a[2] + b[2]) / 2)],
      radius,
      height: r2(len),
      sides: 8,
      yaw: r2((Math.atan2(dx, dz) * 180) / Math.PI),
      pitch: r2((Math.acos(dy / len) * 180) / Math.PI),
      color,
      ...extra,
    };
  };
  /** A loose item's spot (raids-and-maps.md → Loose loot). */
  const spot = (id, x, y, z, lootTable, chance) => ({
    type: 'lootSpawn',
    id,
    pos: [r2(x), r2(y), r2(z)],
    lootTable,
    chance,
  });
  /** A lamp over a doorway on a wall face (drawn). */
  const lampX = (id, x, z, y = 2.45) =>
    drawn(x - 0.18, z - 0.12, x + 0.18, z + 0.12, y, y + 0.16, C.lamp, { id });
  const lampZ = (id, x, z, y = 2.45) =>
    drawn(x - 0.12, z - 0.18, x + 0.12, z + 0.18, y, y + 0.16, C.lamp, { id });
  const copse = (name, parts) =>
    group(
      name,
      parts.map(([p, x, z, yaw = 0]) => on(p, x, z, yaw ? { yaw } : {})),
    );

  /** Track pieces (6 m, the MT-4 prefab) from (x0, z0) to (x1, z1), butted end to end. */
  const trackRun = (id, x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(len / 6 - 0.01);
    const [ux, uz] = [(x1 - x0) / len, (z1 - z0) / len];
    const yaw = r2((-Math.atan2(z1 - z0, x1 - x0) * 180) / Math.PI);
    const out = [];
    for (let k = 0; k < n; k++) {
      const d = Math.min(k * 6 + 3, len - 3);
      out.push(
        at('track', x0 + ux * d, z0 + uz * d, 0, { id: `${id}-${k + 1}`, ...(yaw ? { yaw } : {}) }),
      );
    }
    return out;
  };
  /** Rails laid in a concrete floor, drawn only (inside the engine shed). */
  const floorRails = (id, x0, x1, z, y = 0) =>
    [-1, 1].map((sd) =>
      drawn(x0, z + sd * 0.72 - 0.04, x1, z + sd * 0.72 + 0.04, y, y + 0.08, C.rail, {
        id: `${id}-${sd < 0 ? 'n' : 's'}`,
      }),
    );
  /** A buffer stop at the end of a track: a waist-high timber block and its beam. */
  const bufferStop = (id, x, z) => [
    box(x - 0.5, z - 1, x + 0.5, z + 1, 0.2, 1.1, C['timber-dark'], { id }),
    drawn(x - 0.6, z - 1.1, x + 0.6, z + 1.1, 1.1, 1.2, C['paint-red'], {
      id: `${id}-beam`,
    }),
  ];
  /** A stack of railway ties, 2.6 × 1.8 m and 1.9 m high: eye-height cover. */
  const tieStack = (id, x, z, rot = false) => {
    const [hx, hz] = rot ? [0.9, 1.3] : [1.3, 0.9];
    return [
      box(x - hx, z - hz, x + hx, z + hz, 0, 1.9, C['tie-stack'], { id }),
      ...[0.62, 1.26].map((y, k) =>
        drawn(x - hx - 0.02, z - hz - 0.02, x + hx + 0.02, z + hz + 0.02, y, y + 0.03, C.dark, {
          id: `${id}-seam-${k + 1}`,
        }),
      ),
    ];
  };

  // ------------------------------------------------------------------ rail yard
  // Two through tracks (z 44 and 51) into the tunnel, the cars spread out, tie stacks along
  // the lane between the tracks set alternately against its north and south edges (each
  // leaving 1.7 m past), a freight dock north of track 1, and stores on both sides.
  const T1 = 44;
  const T2 = 51;
  const yard = [];
  for (const [k, z] of [
    [1, T1],
    [2, T2],
  ]) {
    yard.push(
      ...trackRun(`track-${k}`, 196, z, 322, z),
      ...bufferStop(`track-${k}-buffer`, 195.9, z),
    );
  }
  const car = (name, x, z, id, extra = {}) => at(name, x, z, 0, { id, ...extra });
  yard.push(
    car('boxcar', 210.5, T1, 'boxcar-1'),
    // Boxcar 2 (2026-11-17) stands open at the freight dock's face, a plate across from the
    // dock: a room with two ways in (the plate, the AI's too; the lane side, a climb).
    car('boxcar-open', 254.5, T1, 'boxcar-2', {
      colors: { body: '#6e4a32', 'body-dark': '#553826' },
    }),
    car('boxcar', 292.5, T1, 'boxcar-3', { colors: { body: '#5a5f4a', 'body-dark': '#454a39' } }),
    car('flatcar-logs', 238.5, T2, 'flatcar-1'),
    car('flatcar', 262.5, T2, 'flatcar-2'),
    car('flatcar', 306.5, T2, 'flatcar-3'),
  );
  // Flatcar 2 is loaded with lumber, flatcar 3 half unloaded (a stack fallen off south).
  for (const [x, z, k] of [
    [259.8, T2 - 0.65, 1],
    [259.8, T2 + 0.65, 2],
    [265.2, T2 - 0.65, 3],
    [265.2, T2 + 0.65, 4],
  ])
    yard.push(at('lumber-stack', x, z, 1.45, { id: `flatcar-2-lumber-${k}` }));
  yard.push(
    at('lumber-stack', 303.8, T2, 1.45, { id: 'flatcar-3-lumber' }),
    at('lumber-stack', 309.5, 54.3, 0, { id: 'flatcar-3-fallen', yaw: 12 }),
  );
  // The chip car under the loading tower's chute: an open-top car heaped with chips. Solid,
  // its top flush with the tower's lower deck (3.3 m), so the deck's apron and the car make
  // one landing over 6 m deep under the upper deck's open edge (a sprint carries you 5 m in
  // a 3.3 m fall). Its sides drop you 3.3 m to the ground.
  const CC = { x: 277, x0: 270.5, x1: 283.5 };
  yard.push(
    group('Chip car', [
      box(CC.x0 + 0.1, T1 - 1.5, CC.x1 - 0.1, T1 + 1.5, 1.0, 3.3, C['chip-car'], {
        id: 'chip-car',
      }),
      drawn(CC.x0 + 0.3, T1 - 1.4, CC.x1 - 0.3, T1 + 1.4, 3.3, 3.55, C.chips, {
        id: 'chip-car-heap',
        top: [r2(CC.x1 - CC.x0 - 2.6), 1.4],
      }),
      ...[-1, 1].flatMap((sd) =>
        [0, 1, 2, 3, 4, 5, 6].map((k) =>
          drawn(
            CC.x0 + 0.4 + k * 2.03,
            T1 + sd * 1.5 - 0.06,
            CC.x0 + 0.55 + k * 2.03,
            T1 + sd * 1.5 + 0.06,
            1.0,
            3.75,
            C.dark,
            { id: `chip-car-rib-${sd < 0 ? 'n' : 's'}${k + 1}` },
          ),
        ),
      ),
      ...[CC.x0 + 2, CC.x1 - 2].flatMap((x, k) =>
        [-1, 1].map((sd) =>
          box(x - 1.3, T1 + sd * 0.88 - 0.06, x + 1.3, T1 + sd * 0.88 + 0.06, 0.55, 0.95, C.dark, {
            id: `chip-car-bogie-${k + 1}${sd < 0 ? 'n' : 's'}`,
          }),
        ),
      ),
      // stops a prone body crawling under the car; sight and shots still pass
      box(CC.x0 + 0.4, T1 - 1.3, CC.x1 - 0.4, T1 + 1.3, 0.25, 1.0, '#5a8ab8', {
        id: 'chip-car-blocker',
        invisible: true,
      }),
    ]),
  );
  // Tie stacks along the lane between the tracks (it ran 124 m clear in the graybox).
  const LANE_N = T1 + 1.6 + 0.9 + 0.1; // a stack against the lane's north edge
  const LANE_S = T2 - 1.6 - 0.9 - 0.1;
  yard.push(
    ...tieStack('tie-stack-1', 216, LANE_N),
    ...tieStack('tie-stack-2', 240, LANE_S),
    ...tieStack('tie-stack-3', 249.0, LANE_N),
    ...tieStack('tie-stack-4', 280, LANE_S),
    ...tieStack('tie-stack-5', 300, LANE_N),
    ...tieStack('tie-stack-7', 207, LANE_S),
  );
  // A caboose against track 2's buffer, short of the first switch (x 208).
  const CB = { x0: 196.6, x1: 205.6, z: T2 };
  /** A long side of the caboose, its two windows real openings (2.2–3.0 m). */
  const cbWall = (id, z) =>
    wX(
      id,
      CB.x0 + 1.3,
      CB.x1 - 1.3,
      z,
      1.1,
      3.9,
      C['siding-red'],
      [win(199.1, 1.0, { bottom: 1.1, top: 1.9 }), win(203.3, 1.0, { bottom: 1.1, top: 1.9 })],
      0.1,
    );
  yard.push(
    group('Caboose', [
      // A room since 2026-11-17 (it was a solid block): walls 0.1 thick, open doorways
      // from both end platforms (1.3 m deep: a door's leaf there cut the AI's way in),
      // windows each side. Inside the conductor's desk with the waybills
      // (`documents`), the stove, a bunk and a footlocker. Steps up each platform's corners
      // (the AI's way in); the end rails are solid. The cupola stays windows over a roof.
      cbWall('caboose-wall-n', CB.z - 1.4),
      cbWall('caboose-wall-s', CB.z + 1.4),
      ...[CB.x0 + 1.35, CB.x1 - 1.35].map((x, k) =>
        wZ(
          `caboose-end-${k + 1}`,
          x,
          CB.z - 1.35,
          CB.z + 1.35,
          1.1,
          3.9,
          C['siding-red'],
          [door(CB.z, 1.0)],
          0.1,
        ),
      ),
      box(198.05, CB.z - 1.35, 199.65, CB.z - 0.7, 1.1, 1.85, C.timber, { id: 'caboose-desk' }),
      spot('caboose-waybills', 198.85, 1.85, CB.z - 1.0, 'documents', 0.45),
      box(200.7, CB.z + 0.9, 201.3, CB.z + 1.3, 1.1, 1.9, C.dark, { id: 'caboose-stove' }),
      drawn(200.95, CB.z + 1.05, 201.05, CB.z + 1.15, 1.9, 4.6, C.dark, { id: 'caboose-flue' }),
      box(202.3, CB.z + 0.6, 204.2, CB.z + 1.3, 1.1, 1.55, C.mattress, { id: 'caboose-bunk' }),
      spot('caboose-bunk-spot', 203.2, 1.55, CB.z + 0.95, 'household', 0.25),
      at('footlocker', 203.4, CB.z - 1.05, 1.1, { id: 'caboose-footlocker' }),
      drawn(200.0, CB.z - 0.1, 200.2, CB.z + 0.1, 3.3, 3.55, C.lamp, { id: 'caboose-lantern' }),
      // a short flight up to each platform from either side, off the ballast (it starts
      // 1.6 m out from the track's middle)
      ...[-1, 1].flatMap((sd) =>
        [CB.x0 + 0.68, CB.x1 - 0.68].map((x, k) => ({
          type: 'stairs',
          id: `caboose-steps-${sd < 0 ? 'n' : 's'}${k + 1}`,
          pos: [r2(x), 0, r2(CB.z + sd * 2.31)],
          yaw: sd < 0 ? 0 : 180,
          size: [1.1, 1.1, 1.4],
          color: C.dark,
        })),
      ),
      box(CB.x0 + 0.7, CB.z - 1.6, CB.x1 - 0.7, CB.z + 1.6, 3.9, 4.05, C.roof, {
        id: 'caboose-roof',
      }),
      box(200.3, CB.z - 1.2, 202.2, CB.z + 1.2, 4.05, 5.0, C['siding-red'], {
        id: 'caboose-cupola',
      }),
      drawn(200.2, CB.z - 1.3, 202.3, CB.z + 1.3, 5.0, 5.1, C.roof, { id: 'caboose-cupola-roof' }),
      box(CB.x0, CB.z - 1.5, CB.x1, CB.z + 1.5, 0.95, 1.1, C.dark, { id: 'caboose-deck' }),
      ...[-1, 1].flatMap((sd) => [
        drawn(200.6, CB.z + sd * 1.21 - 0.02, 201.9, CB.z + sd * 1.21 + 0.02, 4.3, 4.8, C.glass, {
          id: `caboose-cupola-window-${sd < 0 ? 'n' : 's'}`,
        }),
      ]),
      ...[CB.x0 + 0.05, CB.x1 - 0.1].map((x, k) =>
        box(x, CB.z - 1.5, x + 0.05, CB.z + 1.5, 1.1, 2.1, C.trim, {
          id: `caboose-end-rail-${k + 1}`,
        }),
      ),
      ...[CB.x0 + 2, CB.x1 - 2].flatMap((x, k) =>
        [-1, 1].map((sd) =>
          box(
            x - 1.1,
            CB.z + sd * 0.88 - 0.06,
            x + 1.1,
            CB.z + sd * 0.88 + 0.06,
            0.55,
            0.95,
            C.dark,
            {
              id: `caboose-bogie-${k + 1}${sd < 0 ? 'n' : 's'}`,
            },
          ),
        ),
      ),
      box(CB.x0 + 0.3, CB.z - 1.3, CB.x1 - 0.3, CB.z + 1.3, 0.25, 0.95, '#5a8ab8', {
        id: 'caboose-blocker',
        invisible: true,
      }),
    ]),
  );

  // The freight dock north of track 1: 1.2 m high, a ramp at the west end and steps at the
  // east (the AI uses both), tall lumber stacks on it set against alternate edges, and a
  // canopy over its east half.
  const DK = { x0: 234, x1: 262, z0: 38.4, z1: 41.8, y: 1.2 };
  const dock = [
    box(DK.x0, DK.z0, DK.x1, DK.z1, -0.3, DK.y, C.concrete, { id: 'dock' }),
    drawn(DK.x0, DK.z1 - 0.12, DK.x1, DK.z1, DK.y, DK.y + 0.02, C.hazard, { id: 'dock-edge' }),
    {
      type: 'ramp',
      id: 'dock-ramp',
      pos: [DK.x0 - 3, 0, r2((DK.z0 + DK.z1) / 2)],
      yaw: 90,
      size: [r2(DK.z1 - DK.z0), DK.y, 6],
      color: C.concrete,
    },
    {
      type: 'stairs',
      id: 'dock-steps',
      pos: [DK.x1 + 0.8, 0, r2((DK.z0 + DK.z1) / 2)],
      yaw: -90,
      size: [2.0, DK.y, 1.6],
      color: C.concrete,
    },
    at('lumber-stack-tall', 239, DK.z0 + 0.7, DK.y, { id: 'dock-stack-1' }),
    at('lumber-stack-tall', 246.5, DK.z1 - 0.7, DK.y, { id: 'dock-stack-2' }),
    at('lumber-stack', 252, DK.z0 + 0.7, DK.y, { id: 'dock-stack-3' }),
    at('lumber-stack-tall', 257.5, DK.z0 + 0.7, DK.y, { id: 'dock-stack-4' }),
    at('wood-pallet', 243, 40.6, DK.y, { id: 'dock-pallet-1', yaw: 8 }),
    at('wood-pallet-boxes', 251.6, 41.0, DK.y, { id: 'dock-pallet-2' }),
    // canopy over the east half on posts along the dock's north edge, out of reach (4.6 m)
    box(248, 37.6, 262.4, 42.2, 4.6, 4.75, C.roof, { id: 'dock-canopy' }),
    ...[248.3, 255.2, 262.1].map((x, k) =>
      box(x - 0.12, 37.75, x + 0.12, 37.99, -0.3, 4.6, C['timber-dark'], {
        id: `dock-canopy-post-${k + 1}`,
      }),
    ),
    at('forklift', 227, 37.3, 0, { id: 'dock-forklift', yaw: 100 }),
    // Dressed 2026-11-17: freight crates under the canopy (`freight-crate`, `rail-cargo`),
    // the plate across to the open boxcar, and in the car two crates and a loose spot.
    at('freight-crate', 260.6, 40.8, DK.y, { id: 'dock-crate-1', yaw: 90 }),
    at('freight-crate', 249.0, 39.2, DK.y, { id: 'dock-crate-2', yaw: 4 }),
    box(253.7, DK.z1 - 0.05, 255.3, T1 - 1.55, DK.y, DK.y + 0.1, C.steel, { id: 'dock-plate' }),
    drawn(253.7, DK.z1 - 0.05, 255.3, T1 - 1.55, DK.y + 0.1, DK.y + 0.11, C.hazard, {
      id: 'dock-plate-edge',
    }),
    at('freight-crate', 249.8, T1 + 0.4, 1.3, { id: 'boxcar-crate-1', yaw: 90 }),
    at('freight-crate', 258.8, T1 - 0.7, 1.3, { id: 'boxcar-crate-2' }),
    spot('boxcar-loose', 251.4, 1.3, T1 - 0.9, 'rail-cargo', 0.4),
  ];
  yard.push(group('Freight dock', dock));

  const SHB = { x0: 211, x1: 217, z0: 36.4, z1: 40.8, fl: 0.15, top: 2.9 };
  const shRoof = roof('sh-roof', SHB.x0, SHB.x1, SHB.z0, SHB.z1, SHB.top, 25, {
    roof: C.roof,
    gable: C['siding-tan'],
  });
  const sectionHouse = [
    box(SHB.x0, SHB.z0, SHB.x1, SHB.z1, -0.3, SHB.fl, C['dark-concrete'], { id: 'sh-floor' }),
    wX('sh-wall-n', SHB.x0, SHB.x1, SHB.z0 + 0.1, SHB.fl, SHB.top, C['siding-tan'], [win(214.6)]),
    wX('sh-wall-s', SHB.x0, SHB.x1, SHB.z1 - 0.1, SHB.fl, SHB.top, C['siding-tan'], [
      door(213),
      win(215.4, 1.0),
    ]),
    wZ('sh-wall-w', SHB.x0 + 0.1, SHB.z0 + 0.2, SHB.z1 - 0.2, SHB.fl, SHB.top, C['siding-tan'], [
      win(38.6, 1.0),
    ]),
    wZ('sh-wall-e', SHB.x1 - 0.1, SHB.z0 + 0.2, SHB.z1 - 0.2, SHB.fl, SHB.top, C['siding-tan'], [
      door(38.0),
    ]),
    doorX('sh-door-s', 213, SHB.z1 - 0.1, SHB.fl),
    doorZ('sh-door-e', SHB.x1 - 0.1, 38.0, SHB.fl),
    ...shRoof.nodes,
    lampX('sh-lamp-s', 213, SHB.z1 + 0.12),
    box(211.2, 36.6, 214.0, 37.3, SHB.fl, SHB.fl + 0.95, C.timber, { id: 'sh-bench' }),
    at('toolbox', 212.0, 36.95, SHB.fl + 0.95, { id: 'sh-toolbox', yaw: 180 }),
    spot('sh-bench-loose', 213.3, SHB.fl + 0.95, 36.95, 'sawmill-tools', 0.3),
    // the tool rack on the west wall: a board, picks and shovels hung on it (drawn)
    drawn(SHB.x0 + 0.2, 39.4, SHB.x0 + 0.24, 40.5, SHB.fl + 0.9, SHB.fl + 2.0, C.timber, {
      id: 'sh-tool-rack',
    }),
    ...[39.6, 39.95, 40.3].map((z, k) =>
      drawn(
        SHB.x0 + 0.24,
        z - 0.03,
        SHB.x0 + 0.3,
        z + 0.03,
        SHB.fl + 0.3,
        SHB.fl + 1.9,
        k === 1 ? C.metal : C.timber,
        { id: `sh-tool-${k + 1}` },
      ),
    ),
    at('steel-barrel', 211.75, 37.95, SHB.fl, { id: 'sh-spike-keg' }),
    box(216.0, 39.8, 216.6, 40.4, SHB.fl, SHB.fl + 0.85, C.dark, { id: 'sh-stove' }),
    drawn(216.25, 40.05, 216.35, 40.15, SHB.fl + 0.85, shRoof.ridge - 0.3, C.dark, {
      id: 'sh-flue',
    }),
  ];
  const SP = { x0: 298.6, x1: 303.4, z0: 34.5, z1: 38.6, fl: 0.1, top: 3.0 };
  const spCol = C['siding-red'];
  const speederShed = [
    box(SP.x0, SP.z0, SP.x1, SP.z1, -0.3, SP.fl, C.concrete, { id: 'sp-floor' }),
    wX('sp-wall-n', SP.x0, SP.x1, SP.z0 + 0.075, SP.fl, SP.top, spCol, [], 0.15),
    wZ(
      'sp-wall-w',
      SP.x0 + 0.075,
      SP.z0 + 0.15,
      SP.z1,
      SP.fl,
      SP.top,
      spCol,
      [win(36.4, 1.0)],
      0.15,
    ),
    wZ('sp-wall-e', SP.x1 - 0.075, SP.z0 + 0.15, SP.z1, SP.fl, SP.top, spCol, [], 0.15),
    box(SP.x0 - 0.2, SP.z0 - 0.2, SP.x1 + 0.2, SP.z1 + 0.3, SP.top, SP.top + 0.15, C.roof, {
      id: 'sp-roof',
    }),
    drawn(SP.x0 - 0.2, SP.z1 + 0.2, SP.x1 + 0.2, SP.z1 + 0.3, SP.top - 0.25, SP.top, '#6e3a2e', {
      id: 'sp-fascia',
    }),
    // the set-off rails from the shed out to track 1 (drawn), the speeder on them
    ...[300.28, 301.72].map((x, k) =>
      drawn(x - 0.04, 35.0, x + 0.04, T1 - 1.7, SP.fl, SP.fl + 0.1, C.rail, {
        id: `sp-rail-${k + 1}`,
      }),
    ),
    box(300.3, 35.6, 301.7, 37.8, SP.fl + 0.25, SP.fl + 0.8, C.hazard, { id: 'speeder-body' }),
    box(300.4, 35.6, 301.6, 36.4, SP.fl + 0.8, SP.fl + 1.2, C.hazard, { id: 'speeder-hood' }),
    box(300.4, 36.7, 301.6, 37.6, SP.fl + 0.8, SP.fl + 1.15, C['timber-dark'], {
      id: 'speeder-seat',
    }),
    drawn(300.4, 37.5, 301.6, 37.6, SP.fl + 1.15, SP.fl + 1.5, C['timber-dark'], {
      id: 'speeder-seat-back',
    }),
    drawn(300.35, 36.4, 301.65, 36.45, SP.fl + 1.2, SP.fl + 1.7, C.glass, { id: 'speeder-screen' }),
    ...[35.95, 37.45].flatMap((z) =>
      [300.28, 301.72].map((x, k) => ({
        type: 'cylinder',
        id: `speeder-wheel-${z < 36.5 ? 'f' : 'r'}${k + 1}`,
        pos: [x, r2(SP.fl + 0.25 - 0.03), z],
        radius: 0.25,
        height: 0.06,
        roll: 90,
        sides: 8,
        color: C.dark,
        collide: false,
      })),
    ),
    at('steel-barrel', 302.7, 35.2, SP.fl, { id: 'sp-fuel-drum' }),
  ];
  // Stores along the yard: a section house (the track crew's shed) and a rack of rails north
  // of track 1 at the west, a speeder shed and old ties at the east; wheel sets, stacks and
  // piles staggered along the strip between track 2 and the engine shed.
  const wheelSet = (id, x, z) => [
    pipe([x, 0.46, z - 0.8], [x, 0.46, z + 0.8], 0.08, C.steel, {
      id: `${id}-axle`,
      collide: false,
    }),
    ...[-1, 1].map((sd) => ({
      type: 'cylinder',
      id: `${id}-wheel-${sd < 0 ? 'n' : 's'}`,
      pos: [x, 0.46, r2(z + sd * 0.72 - 0.06)],
      radius: 0.46,
      height: 0.12,
      pitch: 90,
      sides: 10,
      color: C.dark,
    })),
  ];
  yard.push(
    // The section house (a room since 2026-11-17, it was the solid shed): the track crew's
    // bench with a toolbox and a loose spot (`sawmill-tools`), the tool rack, a keg of
    // spikes, a stove. Doors south (to the yard) and east, windows north and west.
    ...sectionHouse,
    box(220.5, 39.2, 226.5, 40.4, 0, 0.75, C['timber-dark'], { id: 'rail-rack' }),
    ...[0, 1, 2, 3].map((k) =>
      drawn(220.6, 39.3 + k * 0.28, 226.4, 39.38 + k * 0.28, 0.75, 0.9, C.rail, {
        id: `rail-rack-rail-${k + 1}`,
      }),
    ),
    // The speeder shed (2026-11-17, it was the solid small shed): open to the south, the
    // track crew's speeder on its set-off rails inside (waist cover), its roof out of reach.
    ...speederShed,
    box(287, 38.6, 291.5, 40.6, 0, 0.8, C['tie-stack'], { id: 'old-ties' }),
    ...wheelSet('wheel-set-1', 229, 55.2),
    ...wheelSet('wheel-set-2', 230.6, 55.6),
    ...tieStack('tie-stack-6', 272, 55.2),
    at('lumber-stack-tall', 201.5, 54.8, 0, { id: 'strip-stack-2', yaw: 15 }),
    bedded('log-pile-tall', 290, 55.6, 3, 1, { id: 'strip-pile-1', yaw: -24 }),
    on('rock-large', 305.5, 57.2, { id: 'strip-rock-1', yaw: 15 }),
    at('steel-barrel', 260.2, 56.4, 0, { id: 'strip-barrel-1' }),
    at('steel-barrel', 260.9, 56.9, 0, { id: 'strip-barrel-2' }),
  );

  // ------------------------------------------------------------------ leads to the shed
  // Lead A leaves track 2 for road 1 (the pit road, z 63), lead B for road 2 (z 68), which
  // runs through the shed and out of its east end to the water tower.
  const R1 = 63;
  const R2 = 68;
  const leads = [
    ...trackRun('lead-a', 208, T2, 236, R1),
    ...trackRun('lead-a-straight', 236, R1, 248, R1),
    ...trackRun('lead-b', 220, T2, 240, R2),
    ...trackRun('lead-b-straight', 240, R2, 248, R2),
    ...trackRun('road-2-east', 276, R2, 306, R2),
    ...bufferStop('road-2-buffer', 306.6, R2),
    // switch stands by the two switches, drawn
    ...[
      [208, T2 + 2],
      [220, T2 + 2],
    ].flatMap(([x, z], k) => [
      drawn(x - 0.08, z - 0.08, x + 0.08, z + 0.08, 0, 1.1, C.steel, {
        id: `switch-stand-${k + 1}`,
      }),
      drawn(x - 0.25, z - 0.03, x + 0.25, z + 0.03, 1.0, 1.25, C['paint-red'], {
        id: `switch-target-${k + 1}`,
      }),
    ]),
  ];

  // ------------------------------------------------------------------ engine shed
  // Reworked 2026-11-17 (docs: silver-creek.md → Engine shed). A brick shed with two roads
  // in at the west: road 1 behind shut doors with a wicket door, the pit under it (1.4 m deep,
  // steps at both ends, a jack stand across it); road 2 open both ends, the switcher on it,
  // running out east past the fuel and sand stand to the water tower. Inside, a balcony along
  // the south wall at 3.3 with a gangway onto the switcher's hood. The loco shop leans on the
  // south wall: two floors, the machine shop and battery room below, the crew room and the
  // shed foreman's office above, an outside stair up its west end. The oil house stands north.
  const ES = { x0: 248, x1: 276, z0: 58, z1: 72, top: 6 };
  /** The loco shop: x0..x1, z0 (the shed's south wall)..z1, its upper floor, its walls' top. */
  const SB = { x0: 253, x1: 272, z0: 72, z1: 80, up: 3.3, top: 5.45 };
  const UP = SB.up;
  const esCol = C['shed-brick'];
  const esDark = C['shed-brick-dark'];
  const bigDoor = (atZ) => ({ at: atZ, width: 4.2, bottom: 0, top: 5 });
  const hi = (atX, width = 1.4) => win(atX, width, { bottom: 1.2, top: 2.6 });
  /** Openings on the shop's upper floor: a door, a window. */
  const sbDoor = (a) => ({ at: a, width: 1.0, bottom: UP, top: UP + 2.1 });
  const sbWin = (a, w = 1.4) => win(a, w, { bottom: UP + 0.9, top: UP + 2.0 });
  const esRoof = roof('es-roof', ES.x0, ES.x1, ES.z0, ES.z1, ES.top, 22, {
    roof: C.roof,
    gable: esCol,
  });
  const ridge = esRoof.ridge;
  /** The roof's underside height over z (for things standing on it). */
  const roofAt = (z) => ES.top + (7 - Math.abs(z - 65)) * Math.tan((22 * Math.PI) / 180);
  /** A brick pilaster on a wall face along x (side −1 north face, +1 south face), drawn. */
  const pilX = (id, x, zFace, side) =>
    drawn(
      x - 0.25,
      Math.min(zFace, zFace + side * 0.16),
      x + 0.25,
      Math.max(zFace, zFace + side * 0.16),
      0,
      ES.top,
      esDark,
      { id },
    );
  const pilZ = (id, xFace, z, side) =>
    drawn(
      Math.min(xFace, xFace + side * 0.16),
      z - 0.25,
      Math.max(xFace, xFace + side * 0.16),
      z + 0.25,
      0,
      ES.top,
      esDark,
      { id },
    );
  /** A concrete lintel over a window on the north face. */
  const lintelN = (id, x, w = 1.4) =>
    drawn(x - w / 2 - 0.15, ES.z0 - 0.06, x + w / 2 + 0.15, ES.z0, 2.6, 2.78, C.concrete, { id });
  const shedNodes = [
    // floor, drawn round the pit
    drawn(ES.x0 + 0.3, ES.z0 + 0.3, ES.x1 - 0.3, PIT.z0, 0, 0.02, C['dark-concrete'], {
      id: 'es-floor-n',
    }),
    drawn(ES.x0 + 0.3, PIT.z1, ES.x1 - 0.3, ES.z1 - 0.3, 0, 0.02, C['dark-concrete'], {
      id: 'es-floor-s',
    }),
    drawn(ES.x0 + 0.3, PIT.z0, PIT.x0, PIT.z1, 0, 0.02, C['dark-concrete'], { id: 'es-floor-w' }),
    drawn(PIT.x1, PIT.z0, ES.x1 - 0.3, PIT.z1, 0, 0.02, C['dark-concrete'], { id: 'es-floor-e' }),
    wZ('es-wall-w', ES.x0 + 0.15, ES.z0, ES.z1, 0, ES.top, esCol, [bigDoor(63), bigDoor(68)], 0.3),
    wZ(
      'es-wall-e',
      ES.x1 - 0.15,
      ES.z0,
      ES.z1,
      0,
      ES.top,
      esCol,
      [bigDoor(68), door(59.6), hi(64.6)],
      0.3,
    ),
    wX(
      'es-wall-n',
      ES.x0 + 0.3,
      ES.x1 - 0.3,
      ES.z0 + 0.15,
      0,
      ES.top,
      esCol,
      [hi(251), hi(255), door(262), hi(258.5), hi(269.6, 1.0), hi(273.6, 1.0)],
      0.3,
    ),
    // The south wall: the shop's door and two windows into it below; above, a door from the
    // crew room and one from the foreman's office onto the balcony, and the office's window
    // over the shed floor.
    wX(
      'es-wall-s',
      ES.x0 + 0.3,
      ES.x1 - 0.3,
      ES.z1 - 0.15,
      0,
      ES.top,
      esCol,
      [
        hi(251),
        door(257),
        hi(260.5),
        sbDoor(262.4),
        { at: 266.5, width: 1.6, bottom: UP + 0.9, top: UP + 1.9, glass: C.glass },
        hi(268.5),
        sbDoor(270.3),
        hi(273),
      ],
      0.3,
    ),
    doorX('es-door-n', 262, ES.z0 + 0.15, 0),
    doorX('es-door-s', 257, ES.z1 - 0.15, 0),
    doorZ('es-door-e', ES.x1 - 0.15, 59.6, 0),
    doorX('es-door-balcony-w', 262.4, ES.z1 - 0.15, UP, 1.0),
    doorX('es-door-balcony-e', 270.3, ES.z1 - 0.15, UP, 1.0),
    ...esRoof.nodes,
    // a glazed monitor along the ridge, two smoke jacks over the roads
    drawn(251, 63.9, 273, 66.1, ridge - 0.3, ridge + 0.85, C.roof, { id: 'es-monitor' }),
    drawn(251.2, 63.86, 272.8, 66.14, ridge + 0.15, ridge + 0.6, C.glass, {
      id: 'es-monitor-glass',
    }),
    drawn(250.7, 63.5, 273.3, 66.5, ridge + 0.85, ridge + 1.0, C.roof, { id: 'es-monitor-cap' }),
    drawn(257.4, 62.4, 258.6, 63.6, roofAt(63) - 0.4, ridge + 0.6, C.dark, { id: 'es-jack-1' }),
    drawn(257.2, 62.2, 258.8, 63.8, ridge + 0.6, ridge + 0.75, C.dark, { id: 'es-jack-1-cap' }),
    drawn(265.4, 67.4, 266.6, 68.6, roofAt(68) - 0.4, ridge + 0.4, C.dark, { id: 'es-jack-2' }),
    drawn(265.2, 67.2, 266.8, 68.8, ridge + 0.4, ridge + 0.55, C.dark, { id: 'es-jack-2-cap' }),
    // trusses: tie beams across the hall and a king post to the ridge, lamps on every other
    ...[252, 256, 260, 264, 268, 272].flatMap((x, k) => [
      drawn(x - 0.12, ES.z0 + 0.3, x + 0.12, ES.z1 - 0.3, 5.7, 5.9, C['timber-dark'], {
        id: `es-truss-${k + 1}`,
      }),
      drawn(x - 0.08, 64.92, x + 0.08, 65.08, 5.9, ridge - 0.2, C['timber-dark'], {
        id: `es-truss-${k + 1}-post`,
      }),
      ...(k % 2 === 0
        ? [63, 68].flatMap((z, j) => [
            drawn(x - 0.01, z - 0.01, x + 0.01, z + 0.01, 5.1, 5.7, C.dark, {
              id: `es-lamp-${k + 1}-${j + 1}-cord`,
            }),
            drawn(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 4.95, 5.1, C.lamp, {
              id: `es-lamp-${k + 1}-${j + 1}`,
            }),
          ])
        : []),
    ]),
    // The outside: pilasters, a concrete plinth, lintels, the board over the doors, lamps.
    ...[ES.x0 + 0.25, 253, 256.8, 260.4, 264, 267.5, 271.6, ES.x1 - 0.25].map((x, k) =>
      pilX(`es-pilaster-n-${k + 1}`, x, ES.z0, -1),
    ),
    ...[ES.x0 + 0.25, ES.x1 - 0.25].map((x, k) => pilX(`es-pilaster-s-${k + 1}`, x, ES.z1, 1)),
    pilZ('es-pilaster-w-1', ES.x0, 65.5, -1),
    pilZ('es-pilaster-e-1', ES.x1, 62.4, 1),
    drawn(ES.x0 - 0.08, ES.z0 - 0.08, ES.x1 + 0.08, ES.z0, 0, 0.5, C.concrete, {
      id: 'es-plinth-n',
    }),
    drawn(ES.x0 - 0.08, ES.z1, SB.x0, ES.z1 + 0.08, 0, 0.5, C.concrete, { id: 'es-plinth-s-1' }),
    drawn(SB.x1, ES.z1, ES.x1 + 0.08, ES.z1 + 0.08, 0, 0.5, C.concrete, { id: 'es-plinth-s-2' }),
    ...[251, 255, 258.5].map((x, k) => lintelN(`es-lintel-n-${k + 1}`, x)),
    ...[269.6, 273.6].map((x, k) => lintelN(`es-lintel-n-${k + 4}`, x, 1.0)),
    drawn(ES.x0 - 0.1, 61.6, ES.x0 - 0.04, 69.4, 5.12, 5.88, C['paint-white'], { id: 'es-sign' }),
    drawn(ES.x0 - 0.12, 61.8, ES.x0 - 0.1, 69.2, 5.2, 5.3, C['paint-red'], {
      id: 'es-sign-stripe',
    }),
    drawn(ES.x0 - 0.12, 62.4, ES.x0 - 0.1, 68.6, 5.42, 5.72, C.dark, { id: 'es-sign-text' }),
    lampX('es-lamp-n', 262, ES.z0 - 0.12),
    lampZ('es-lamp-e', ES.x1 + 0.12, 59.6),
    lampZ('es-lamp-wicket', ES.x0 - 0.12, 62.2),
    // Road 1's big doors shut, a wicket door in the north leaf; road 2's leaves swung out
    // square to the wall at both ends (they stand as thin cover either side of the opening).
    box(ES.x0, 60.9, ES.x0 + 0.14, 61.7, 0, 5, C['timber-dark'], { id: 'es-r1-leaf-1' }),
    box(ES.x0, 61.7, ES.x0 + 0.14, 62.7, 2.1, 5, C['timber-dark'], { id: 'es-r1-leaf-1-top' }),
    box(ES.x0, 62.7, ES.x0 + 0.14, 65.1, 0, 5, C['timber-dark'], { id: 'es-r1-leaf-2' }),
    drawn(ES.x0 - 0.04, 60.9, ES.x0, 65.1, 2.3, 2.45, C.timber, { id: 'es-r1-rail' }),
    drawn(ES.x0 - 0.04, 62.95, ES.x0, 63.05, 0, 5, C.dark, { id: 'es-r1-meet' }),
    doorZ('es-door-wicket', ES.x0 + 0.07, 62.2, 0, 1.0),
    ...[
      ['w-n', ES.x0 - 2.1, ES.x0, 65.82, 65.95],
      ['w-s', ES.x0 - 2.1, ES.x0, 70.05, 70.18],
      ['e-n', ES.x1, ES.x1 + 2.1, 65.82, 65.95],
      ['e-s', ES.x1, ES.x1 + 2.1, 70.05, 70.18],
    ].map(([k, xa, xb, za, zb]) =>
      box(xa, za, xb, zb, 0, 5, C['timber-dark'], { id: `es-r2-leaf-${k}` }),
    ),
    // the two roads' rails in the floor; road 1's run along the pit's edges
    ...floorRails('es-road-1-rail', ES.x0, 275, R1),
    ...floorRails('es-road-2-rail', ES.x0, ES.x1, R2),
    ...bufferStop('es-road-1-buffer', 274.9, R1),
    // the pit: walls, floor, steps at both ends, lamps in its walls, a jack stand across it
    // (a vault for a player; the AI walks round by the steps), a toolbox and a dropped tray
    box(PIT.x0, PIT.z0, PIT.x1, PIT.z0 + 0.4, -1.7, 0, C.concrete, { id: 'es-pit-wall-n' }),
    box(PIT.x0, PIT.z1 - 0.4, PIT.x1, PIT.z1, -1.7, 0, C.concrete, { id: 'es-pit-wall-s' }),
    box(PIT.x0, PIT.z0 + 0.4, PIT.x1, PIT.z1 - 0.4, -1.8, -1.4, C['dark-concrete'], {
      id: 'es-pit-floor',
    }),
    {
      type: 'stairs',
      id: 'es-pit-steps-w',
      pos: [PIT.x0 + 0.85, -1.4, R1],
      yaw: -90,
      size: [1.2, 1.4, 1.7],
      color: C.concrete,
    },
    {
      type: 'stairs',
      id: 'es-pit-steps-e',
      pos: [PIT.x1 - 0.85, -1.4, R1],
      yaw: 90,
      size: [1.2, 1.4, 1.7],
      color: C.concrete,
    },
    ...[256.5, 261, 265.5].map((x, k) =>
      drawn(x - 0.2, PIT.z0 + 0.39, x + 0.2, PIT.z0 + 0.42, -0.7, -0.5, C.lamp, {
        id: `es-pit-lamp-${k + 1}`,
      }),
    ),
    drawn(258, PIT.z0 + 0.45, 263, PIT.z1 - 0.45, -1.4, -1.39, C.dark, { id: 'es-pit-oil' }),
    box(264.2, PIT.z0 + 0.4, 265.0, PIT.z1 - 0.4, -1.4, -0.5, C.hazard, { id: 'es-pit-jack' }),
    drawn(264.45, 62.7, 264.75, 63.3, -0.5, -0.2, C['steel-dark'], { id: 'es-pit-jack-head' }),
    at('toolbox', 266.6, 62.62, -1.4, { id: 'es-pit-toolbox' }),
    spot('es-pit-tray', 255.5, -1.4, 63.0, 'millwright', 0.3),
    // the switcher on road 2, its wheels on the floor's rails; the driver's grip in the cab
    at('switcher-loco', 260, R2, -0.25, { id: 'es-switcher' }),
    spot('es-cab-grip', 255.6, 1.05, 67.6, 'rail-cargo', 0.35),
    // tool room in the north-east corner: a door from the floor and one out of the east wall
    wX('es-tool-wall-s', 271.5, ES.x1 - 0.3, 61.0, 0, 3.0, C.plaster, [door(273.6)], 0.15),
    wZ('es-tool-wall-w', 271.5, ES.z0 + 0.3, 61.0, 0, 3.0, C.plaster, [win(59.7, 1.0)], 0.15),
    box(271.4, ES.z0 + 0.3, ES.x1 - 0.3, 61.08, 3.0, 3.15, C.plaster, { id: 'es-tool-ceiling' }),
    doorX('es-door-tool', 273.6, 61.0, 0),
    at('desk', 271.95, 59.5, 0, { id: 'es-tool-desk', yaw: 90 }),
    at('tool-chest', 274.75, 58.6, 0, { id: 'es-tool-cabinet', yaw: 180 }),
    // workbench, tool cabinet and parts rack along the north wall, a tool board over the
    // bench; a compressor on the walkway between the roads; drums and a sand bin by the
    // south wall
    box(249.2, ES.z0 + 0.3, 255.2, 59.1, 0, 0.95, C.timber, { id: 'es-bench' }),
    drawn(250.2, 58.5, 250.6, 58.9, 0.95, 1.2, C.steel, { id: 'es-vice' }),
    drawn(250, ES.z0 + 0.3, 254.4, ES.z0 + 0.34, 1.3, 2.3, C.plaster, { id: 'es-tool-board' }),
    ...[250.5, 251.3, 252.4, 253.1, 253.9].map((x, k) =>
      drawn(
        x - 0.06,
        ES.z0 + 0.34,
        x + 0.06,
        ES.z0 + 0.38,
        1.5 + (k % 2) * 0.25,
        2.0 + (k % 3) * 0.08,
        C.dark,
        {
          id: `es-tool-board-${k + 1}`,
        },
      ),
    ),
    box(256.2, ES.z0 + 0.3, 257.2, 58.8, 0, 1.8, C['paint-red'], { id: 'es-tool-cabinet-tall' }),
    at('warehouse-rack', 267, 58.9, 0, { id: 'es-parts-rack' }),
    box(261.4, 64.25, 262.6, 65.15, 0, 1.7, C.steel, { id: 'es-compressor' }),
    at('steel-barrel', 249.2, 70.9, 0, { id: 'es-drum-1' }),
    at('steel-barrel', 249.9, 71.2, 0, { id: 'es-drum-2' }),
    at('hazard-barrel', 249.4, 70.2, 0, { id: 'es-drum-3' }),
    box(268.5, 70.4, 270, 71.55, 0, 1.1, C['timber-dark'], { id: 'es-sand-bin' }),

    // ---- the balcony at 3.3 along the south wall (the AI follows, from the shop's stair):
    // doors from the crew room and the office, both ends open (3.3 m drops), a rail on its
    // floor side with a gap at the gangway, which lies across onto the switcher's hood top
    // (3.3 too). From the hood: down either side, or (a player) up onto the cab roof.
    box(261.6, 69.7, 271.6, ES.z1 - 0.3, UP - 0.2, UP, C.steel, { id: 'es-balcony' }),
    ...[262.4, 266.2, 270.8].map((x, k) =>
      drawn(x - 0.06, 70.9, x + 0.06, ES.z1 - 0.3, UP - 1.1, UP - 0.2, C['steel-dark'], {
        id: `es-balcony-bracket-${k + 1}`,
        top: [0.12, 0.08],
      }),
    ),
    box(261.6, 69.7, 263.5, 69.78, UP, UP + 1.0, C.hazard, { id: 'es-balcony-rail-1' }),
    box(264.9, 69.7, 271.6, 69.78, UP, UP + 1.0, C.hazard, { id: 'es-balcony-rail-2' }),
    box(263.6, 68.8, 264.8, 69.7, UP - 0.06, UP, C['steel-dark'], { id: 'es-gangway' }),
  ];

  // ---- the loco shop, leaning on the shed's south wall. Below: the machine shop (the shed's
  // south door, a door west under the landing, a roller door south), the battery room
  // (from the shop and outside east) and the stair room (the same). Above, reached by the
  // inside stair (the AI follows), the outside stair (the same) or from the balcony: the
  // crew room and the shed foreman's office, the richest room, on the way between all three.
  const sbOps = {
    w: [door(72.9), sbDoor(74.4), sbWin(77.5)],
    s: [
      win(255.2, 1.2),
      { at: 259.5, width: 3.2, bottom: 0, top: 2.9 },
      win(263.4, 1.2),
      sbWin(256.85, 1.0),
      sbWin(261.9, 1.0),
      sbWin(265.2, 1.2),
      sbWin(268.6, 1.2),
    ],
    e: [door(74.0), door(77.2), sbWin(75.6)],
  };
  const shop = [
    drawn(SB.x0 + 0.2, SB.z0, SB.x1 - 0.2, SB.z1 - 0.2, 0, 0.02, C['dark-concrete'], {
      id: 'sb-floor',
    }),
    wZ('sb-wall-w', SB.x0 + 0.1, SB.z0, SB.z1 - 0.2, 0, SB.top, esCol, sbOps.w),
    wZ('sb-wall-e', SB.x1 - 0.1, SB.z0, SB.z1 - 0.2, 0, SB.top, esCol, sbOps.e),
    wX('sb-wall-s', SB.x0, SB.x1, SB.z1 - 0.1, 0, SB.top, esCol, sbOps.s),
    // the upper floor, its hole over the stair; the flat roof with a coping
    ...slabWithHoles(
      'sb-upper',
      SB.x0 + 0.2,
      SB.z0,
      SB.x1 - 0.2,
      SB.z1 - 0.2,
      UP - 0.2,
      UP,
      C.timber,
      [[265.9, 78.55, SB.x1 - 0.2, SB.z1 - 0.2]],
    ),
    drawn(SB.x0 + 0.2, SB.z0, 265.9, SB.z1 - 0.2, UP, UP + 0.01, C.floorboards, {
      id: 'sb-boards-1',
    }),
    drawn(265.9, SB.z0, SB.x1 - 0.2, 78.55, UP, UP + 0.01, C.floorboards, { id: 'sb-boards-2' }),
    box(SB.x0 - 0.1, SB.z0, SB.x1 + 0.1, SB.z1 + 0.1, SB.top, SB.top + 0.15, C.roof, {
      id: 'sb-roof',
    }),
    ...[
      [SB.x0 - 0.15, SB.z1 - 0.05, SB.x1 + 0.15, SB.z1 + 0.15],
      [SB.x0 - 0.15, SB.z0, SB.x0 + 0.05, SB.z1 + 0.15],
      [SB.x1 - 0.05, SB.z0, SB.x1 + 0.15, SB.z1 + 0.15],
    ].map(([a, b, c, d], k) =>
      drawn(a, b, c, d, SB.top + 0.15, SB.top + 0.4, C.concrete, { id: `sb-coping-${k + 1}` }),
    ),
    // a band of darker brick at the upper floor, the shop's board over the roller door
    drawn(SB.x0 - 0.04, SB.z1, SB.x1 + 0.04, SB.z1 + 0.04, UP - 0.25, UP, esDark, {
      id: 'sb-band-s',
    }),
    drawn(257.3, SB.z1 + 0.04, 261.7, SB.z1 + 0.08, 2.95, UP - 0.3, C['paint-white'], {
      id: 'sb-sign',
    }),
    drawn(257.6, SB.z1 + 0.08, 261.4, SB.z1 + 0.1, 3.05, 3.15, C.dark, { id: 'sb-sign-text' }),
    drawn(257.9, SB.z1 + 0.1, 261.1, SB.z1 + 0.3, 2.6, 2.95, C['depot-dark'], {
      id: 'sb-roller',
    }),
    lampX('sb-lamp-roller', 259.5, SB.z1 + 0.32, 3.2),
    lampZ('sb-lamp-e1', SB.x1 + 0.12, 74.0),
    lampZ('sb-lamp-e2', SB.x1 + 0.12, 77.2),
    doorZ('sb-door-w', SB.x0 + 0.1, 72.9, 0),
    doorZ('sb-door-up-w', SB.x0 + 0.1, 74.4, UP, 1.0),
    doorZ('sb-door-e1', SB.x1 - 0.1, 74.0, 0),
    doorZ('sb-door-e2', SB.x1 - 0.1, 77.2, 0),

    // ---- below: partitions
    wZ(
      'sb-part-shop',
      265.5,
      SB.z0,
      SB.z1 - 0.2,
      0,
      UP - 0.2,
      C.plaster,
      [door(74.0), door(77.2)],
      0.15,
    ),
    wX('sb-part-stair', 265.58, SB.x1 - 0.2, 75.85, 0, UP - 0.2, C.plaster, [], 0.15),
    doorZ('sb-door-battery', 265.5, 74.0, 0),
    doorZ('sb-door-stair', 265.5, 77.2, 0),
    // The machine shop: a wheel lathe with a wheel set in it (eye-height headstocks, a waist
    // bed) across the middle; the forge and anvil west; the drill press in the south-west
    // corner; the bench under the south windows; a tool chest by the battery room door.
    box(257.8, 73.9, 258.6, 75.3, 0, 1.8, C.machine, { id: 'sb-lathe-head' }),
    box(262.0, 73.9, 262.8, 75.3, 0, 1.8, C.machine, { id: 'sb-lathe-tail' }),
    box(258.6, 74.1, 262.0, 75.1, 0, 0.95, C['steel-dark'], { id: 'sb-lathe-bed' }),
    pipe([258.6, 1.41, 74.6], [262.0, 1.41, 74.6], 0.08, C.steel, {
      id: 'sb-lathe-axle',
      collide: false,
    }),
    ...[259.6, 261.04].map((x, k) => ({
      type: 'cylinder',
      id: `sb-lathe-wheel-${k + 1}`,
      pos: [x, r2(1.41 - 0.06), 74.6],
      radius: 0.46,
      height: 0.12,
      roll: 90,
      sides: 10,
      color: C.dark,
    })),
    spot('sb-lathe-spot', 258.95, 0.95, 74.6, 'millwright', 0.4),
    box(253.4, 75.3, 254.6, 76.7, 0, 0.85, esDark, { id: 'sb-forge' }),
    drawn(253.6, 75.5, 254.4, 76.5, 0.85, 0.88, C.rust, { id: 'sb-forge-coals' }),
    drawn(253.3, 75.2, 254.7, 76.8, 1.9, 2.3, C.dark, { id: 'sb-forge-hood', top: [0.5, 0.5] }),
    drawn(253.8, 75.8, 254.2, 76.2, 2.3, UP - 0.2, C.dark, { id: 'sb-forge-flue' }),
    box(255.4, 75.75, 255.95, 76.25, 0, 0.75, C.dark, { id: 'sb-anvil' }),
    box(253.6, 77.9, 254.3, 78.6, 0, 1.75, C.machine, { id: 'sb-drill-press' }),
    box(261.6, 79.0, 265.2, SB.z1 - 0.2, 0, 0.95, C.timber, { id: 'sb-bench' }),
    at('toolbox', 262.2, 79.4, 0.95, { id: 'sb-bench-toolbox', yaw: 180 }),
    at('tool-chest', 264.8, 72.45, 0, { id: 'sb-tool-chest' }),
    // The battery room: the switcher's batteries on the charging rack, the charger's
    // cabinet, a spare set on a cart. The east end's own electrical spot, and where MT-13's
    // train gets its power.
    at('battery-rack', 268.6, 72.45, 0, { id: 'sb-battery-rack' }),
    at('electrical-cabinet', 270.9, 72.3, 0, {
      id: 'sb-charger',
      loot: { container: 'electrical-cabinet', mix: GRID_MIX },
    }),
    box(266.3, 74.95, 267.7, 75.6, 0, 0.8, C['steel-dark'], { id: 'sb-battery-cart' }),
    drawn(266.45, 75.05, 267.55, 75.5, 0.8, 1.15, C.dark, { id: 'sb-battery-cart-load' }),
    spot('sb-charger-rack', 268.6, 1.3, 72.45, 'substation', 0.4),
    // The stair room: the stair up the south wall to the office.
    {
      type: 'stairs',
      id: 'sb-stairs',
      pos: [268.5, 0, 79.2],
      yaw: -90,
      size: [1.1, UP, 5.0],
      color: C.steel,
    },
    box(266.0, 78.47, SB.x1 - 0.2, 78.55, UP, UP + 1.0, C.hazard, { id: 'sb-stair-rail' }),

    // ---- above: the crew room (west) and the foreman's office (east)
    wZ('sb-part-up', 263.2, SB.z0, SB.z1 - 0.2, UP, SB.top, C.plaster, [door(76.0, 1.0)], 0.15),
    doorZ('sb-door-office', 263.2, 76.0, UP, 1.0),
    // The crew room: lockers, the mess table, a stove, the fridge.
    at('locker-bank', 256.5, 72.3, UP, { id: 'sb-lockers' }),
    at('table-and-chairs', 258.5, 76.0, UP, { id: 'sb-mess-table' }),
    spot('sb-mess-spot', 258.5, UP + 0.75, 76.0, 'household', 0.35),
    box(253.4, 78.9, 254.2, 79.6, UP, UP + 0.9, C.dark, { id: 'sb-stove' }),
    drawn(253.7, 79.1, 253.9, 79.3, UP + 0.9, SB.top, C.dark, { id: 'sb-stove-flue' }),
    at('fridge-v2', 259.6, 79.0, UP, {
      id: 'sb-fridge',
      yaw: 180,
      loot: {
        container: 'fridge',
        mix: { tables: { 'fridge-home': 0.8, 'fridge-parts': 0.2 }, empty: 0.4 },
      },
    }),
    // The foreman's office: the desk under the east window with the dispatcher's log, the
    // foreman's metal cabinet in the corner, the dispatch board on the partition, a filing cabinet. It
    // sees the shed floor through its window and is seen from it.
    at('desk', 271.2, 74.5, UP, { id: 'sb-office-desk', yaw: -90 }),
    at('office-chair', 270.4, 74.5, UP, { id: 'sb-office-chair', yaw: 90 }),
    spot('sb-office-log', 271.2, UP + 0.75, 74.55, 'documents', 0.5),
    at('office-computer', 271.32, 74.08, UP + 0.76, { id: 'sb-office-computer', yaw: -90 }),
    at('metal-cabinet', 264.3, 72.32, UP, { id: 'sb-office-cabinet-metal' }),
    // an ornament on top of it (2026-11-17: regular craftwork in an office, rare)
    spot('sb-office-craft', 264.3, UP + 1.5, 72.32, 'craftwork', 0.1),
    at('filing-cabinet', 268.0, 72.4, UP, { id: 'sb-office-cabinet' }),
    at('notice-board', 263.32, 74.6, UP + 0.9, { id: 'sb-dispatch-board', yaw: 90 }),

    // ---- the outside stair up the west end to a railed landing over the shop's west door:
    // an open perch over the leads and the west approach, seen from both.
    {
      type: 'stairs',
      id: 'sb-out-stairs',
      pos: [252.35, 0, 77.6],
      yaw: 180,
      size: [1.1, UP, 5.0],
      color: C.steel,
      sides: 1.0,
    },
    box(251.5, SB.z0 + 0.05, SB.x0, 75.1, UP - 0.2, UP, C.steel, { id: 'sb-landing' }),
    // the west rail has a gap: vaulting a rail up here is a 4.9 m fall (it hurts), stepping
    // off the gap a 3.3 m one (it doesn't)
    box(251.5, SB.z0 + 0.05, 251.58, 72.9, UP, UP + 1.0, C.hazard, { id: 'sb-landing-rail-w1' }),
    box(251.5, 74.1, 251.58, 75.1, UP, UP + 1.0, C.hazard, { id: 'sb-landing-rail-w2' }),
    box(251.58, 75.02, 251.8, 75.1, UP, UP + 1.0, C.hazard, { id: 'sb-landing-rail-s' }),
    box(251.5, 74.9, 251.7, 75.1, 0, UP - 0.2, C['steel-dark'], { id: 'sb-landing-post' }),
    lampZ('sb-lamp-w', SB.x0 - 0.12, 74.4, UP + 2.4),
  ];

  // ---- the oil house: a brick store on the strip north of the shed, doors east and west,
  // oil drums and shelving inside; the strip's cover where a lumber stack stood.
  const OH = { x0: 250.5, x1: 254.5, z0: 53.6, z1: 56.4, top: 3.0 };
  const oilHouse = [
    drawn(OH.x0 + 0.2, OH.z0 + 0.2, OH.x1 - 0.2, OH.z1 - 0.2, 0, 0.02, C['dark-concrete'], {
      id: 'oh-floor',
    }),
    wX('oh-wall-n', OH.x0, OH.x1, OH.z0 + 0.1, 0, OH.top, esCol),
    wX('oh-wall-s', OH.x0, OH.x1, OH.z1 - 0.1, 0, OH.top, esCol, [win(252.5, 1.0)]),
    wZ('oh-wall-w', OH.x0 + 0.1, OH.z0 + 0.2, OH.z1 - 0.2, 0, OH.top, esCol, [door(55.3)]),
    wZ('oh-wall-e', OH.x1 - 0.1, OH.z0 + 0.2, OH.z1 - 0.2, 0, OH.top, esCol, [door(55.3)]),
    doorZ('oh-door-w', OH.x0 + 0.1, 55.3, 0),
    doorZ('oh-door-e', OH.x1 - 0.1, 55.3, 0),
    box(OH.x0 - 0.15, OH.z0 - 0.15, OH.x1 + 0.15, OH.z1 + 0.15, OH.top, OH.top + 0.2, C.roof, {
      id: 'oh-roof',
    }),
    lampZ('oh-lamp-e', OH.x1 + 0.12, 55.3),
    at('metal-shelving', 252.5, 54.05, 0, { id: 'oh-shelving' }),
    at('steel-barrel', 252.15, 55.85, 0, { id: 'oh-drum-1' }),
    at('steel-barrel', 252.85, 55.85, 0, { id: 'oh-drum-2' }),
    spot('oh-shelf', 252.5, 0, 54.6, 'hydraulics', 0.35),
  ];

  // ---- the fuel and sand stand on road 2 east, between the shed and the water tower: a
  // fuel tank on its saddles and a fuel column by the track; the sand tower over the track
  // on four legs (no way up) with its sand bin; cover across the run from the shed's east
  // doors to the tower. The track itself stays clear for the switcher (MT-13).
  const stand = [
    pipe([279.2, 1.75, 73.0], [285.2, 1.75, 73.0], 1.15, C['paint-white'], {
      id: 'fs-tank',
      collide: false,
    }),
    box(279.2, 71.85, 285.2, 74.15, 0.9, 2.9, C['paint-white'], {
      id: 'fs-tank-solid',
      invisible: true,
      stopsShots: true,
    }),
    ...[279.9, 284.5].map((x, k) =>
      box(x - 0.3, 71.95, x + 0.3, 74.05, 0, 0.9, C.concrete, { id: `fs-saddle-${k + 1}` }),
    ),
    drawn(281.6, 72.95, 282.8, 73.05, 2.85, 3.0, C.hazard, { id: 'fs-tank-band' }),
    box(281.9, 69.95, 282.1, 70.15, 0, 3.2, C.steel, { id: 'fs-column' }),
    drawn(281.95, 68.2, 282.05, 70.1, 3.0, 3.12, C.steel, { id: 'fs-column-arm' }),
    drawn(281.97, 68.2, 282.03, 68.26, 1.6, 3.0, C.dark, { id: 'fs-column-hose' }),
    ...[
      [287.3, 71.8],
      [289.7, 71.8],
      [287.3, 74.2],
      [289.7, 74.2],
    ].map(([x, z], k) =>
      box(x - 0.13, z - 0.13, x + 0.13, z + 0.13, 0, 5.0, C.metal, { id: `fs-sand-leg-${k + 1}` }),
    ),
    ...[1.2, 3.4].flatMap((y, j) => [
      drawn(287.2, 71.75, 289.8, 71.85, y, y + 0.12, C.metal, { id: `fs-sand-girt-n-${j + 1}` }),
      drawn(287.2, 74.15, 289.8, 74.25, y, y + 0.12, C.metal, { id: `fs-sand-girt-s-${j + 1}` }),
    ]),
    drawn(287.3, 71.9, 289.7, 74.1, 5.0, 7.4, C.rust, { id: 'fs-sand-bin', top: [3.2, 3.2] }),
    drawn(287.0, 71.6, 290.0, 74.4, 7.4, 7.6, C.roof, { id: 'fs-sand-lid' }),
    along([287.8, 5.0, 72.2], [287.8, 4.7, 69.0], 0.18, 0.18, C.metal, {
      id: 'fs-sand-spout',
      collide: false,
    }),
    box(286.6, 75.0, 290.4, 76.6, 0, 1.3, C.concrete, { id: 'fs-sand-pile-bin' }),
    drawn(286.75, 75.15, 290.25, 76.45, 1.3, 1.45, C.chips, { id: 'fs-sand', top: [3.0, 0.8] }),
  ];

  // ---- the yards either side: on the north strip, a freight crate and the wheel set that
  // was inside; south of the shop, an apron, a skip and the log pile moved off the field.
  const shedYard = [
    at('freight-crate', 257.5, 55.4, 0, { id: 'es-freight-crate', yaw: 6 }),
    ...wheelSet('es-wheel-set', 264.5, 55.6),
    drawn(SB.x0, SB.z1 + 0.1, SB.x1, 82.4, 0, 0.03, C.concrete, { id: 'sb-apron' }),
    at('skip-bin', 268.5, 82.6, 0, { id: 'sb-skip' }),
  ];

  // ------------------------------------------------------------------ water tower
  // The graybox tower, perch and pump house (MT-3), dressed: rails on the platform's north,
  // east and south (a gap at the ladder; the west edge stays open over the pump house),
  // bracing, bands and a catwalk on the tank, a water column by road 2, and the pump house
  // made a room you can go in (its roof is still the step down from the platform).
  // Prettied up 2026-11-17 (silver-creek.md → Water tower): concrete footings, a coned
  // bottom and a painted band on the tank, a railed catwalk and a roof ladder (drawn, out
  // of reach), a warning lamp; the pump house's board-formed concrete, a lamp and a plate
  // over its door, and inside the pump on its plinth with its motor, valves and gauge, the
  // starter panel, a bench and the pumpman's tool chest. The details are their own group,
  // off the landmark, so the silhouette past the fog doesn't carry them.
  const TW = { legs: 20, platform: 6.6, pump: 3.3 };
  const towerY = groundAt(tower.x, tower.z);
  const tx = tower.x;
  const tz = tower.z;
  const legPts = [
    [-2.6, -2.6],
    [2.6, -2.6],
    [2.6, 2.6],
    [-2.6, 2.6],
  ];
  const bracing = [];
  for (const [y0, y1] of [
    [0.4, TW.platform - 0.2],
    [TW.platform, 13.3],
    [13.3, TW.legs],
  ])
    for (let k = 0; k < 4; k++) {
      const [ax, az] = legPts[k];
      const [bx, bz] = legPts[(k + 1) % 4];
      const flip = (k + (y0 > 1 ? 1 : 0)) % 2 === 0;
      bracing.push(
        along(
          [tx + ax, flip ? y0 : y1, tz + az],
          [tx + bx, flip ? y1 : y0, tz + bz],
          0.08,
          0.12,
          C.metal,
          { id: `tower-brace-${bracing.length + 1}` },
        ),
      );
    }
  const pr = (id, x0, z0, x1, z1) =>
    box(x0, z0, x1, z1, TW.platform, TW.platform + 1.0, C.metal, { id });
  const PH = { x0: tx - 7.5, x1: tx - 3, z0: tz - 2.5, z1: tz + 2.5 };
  const waterTower = group(
    'Water tower',
    [
      ...legPts.map(([dx, dz], k) =>
        box(
          tx + dx - 0.22,
          tz + dz - 0.22,
          tx + dx + 0.22,
          tz + dz + 0.22,
          dz > 0 ? towerY + 0.35 : towerY - 0.3,
          TW.legs,
          C.metal,
          {
            id: `tower-leg-${k + 1}`,
          },
        ),
      ),
      ...bracing,
      // The riser in two, below and above the platform it passes through.
      {
        type: 'cylinder',
        id: 'tower-riser',
        pos: [tx, r2(towerY - 0.3), tz],
        radius: 0.6,
        height: r2(TW.platform - 0.2 - towerY + 0.3),
        sides: 8,
        color: C.metal,
      },
      {
        type: 'cylinder',
        id: 'tower-riser-top',
        pos: [tx, TW.platform, tz],
        radius: 0.6,
        height: r2(TW.legs - TW.platform),
        sides: 8,
        color: C.metal,
      },
      box(tx - 3, tz - 3, tx + 3, tz + 3, TW.platform - 0.2, TW.platform, C.metal, {
        id: 'tower-platform',
      }),
      pr('tower-rail-n', tx - 3, tz - 3, tx + 3, tz - 2.9),
      pr('tower-rail-e', tx + 2.9, tz - 2.9, tx + 3, tz + 3),
      pr('tower-rail-s1', tx - 3, tz + 2.9, tx - 0.6, tz + 3),
      pr('tower-rail-s2', tx + 0.6, tz + 2.9, tx + 2.9, tz + 3),
      {
        type: 'cylinder',
        id: 'tower-catwalk',
        pos: [tx, TW.legs - 0.15, tz],
        radius: 4.3,
        height: 0.12,
        sides: 12,
        color: C.metal,
        collide: false,
      },
      {
        type: 'cylinder',
        id: 'tower-tank',
        pos: [tx, TW.legs, tz],
        radius: 3.6,
        height: 5,
        sides: 12,
        color: C.rust,
      },
      ...[1.2, 3.8].map((y, k) => ({
        type: 'cylinder',
        id: `tower-band-${k + 1}`,
        pos: [tx, TW.legs + y, tz],
        radius: 3.66,
        height: 0.14,
        sides: 12,
        color: C['timber-dark'],
        collide: false,
      })),
      {
        type: 'cylinder',
        id: 'tower-roof',
        pos: [tx, TW.legs + 5, tz],
        radius: 3.8,
        radiusTop: 0,
        height: 2,
        sides: 12,
        color: C.roof,
      },
      {
        type: 'cylinder',
        id: 'tower-finial',
        pos: [tx, TW.legs + 6.9, tz],
        radius: 0.12,
        height: 0.7,
        sides: 6,
        color: C.metal,
        collide: false,
      },
      {
        type: 'ladder',
        id: 'tower-ladder',
        pos: [tx, r2(towerY), tz + 3],
        yaw: 0,
        height: r2(TW.platform - towerY),
        color: C.ladder,
      },
    ],
    { landmark: true },
  );
  // The tower's details, off the landmark: footings, the tank's coned bottom and painted
  // band, the catwalk's rail, a ladder from the catwalk to the roof hatch, the warning lamp,
  // the riser's valve, and the water column by road 2. All drawn but the footings.
  const tankR = 3.6;
  const walkR = 4.2;
  const ring = (n, r, f) =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      return f(k, tx + Math.cos(a) * r, tz + Math.sin(a) * r, a);
    });
  const towerDetails = group('Water tower details', [
    // footings under the south legs (the north ones stand in road 2's ballast)
    ...legPts
      .filter(([, dz]) => dz > 0)
      .map(([dx, dz], k) =>
        box(
          tx + dx - 0.35,
          tz + dz - 0.35,
          tx + dx + 0.35,
          tz + dz + 0.35,
          towerY - 0.3,
          towerY + 0.35,
          C.concrete,
          { id: `tower-footing-${k + 1}` },
        ),
      ),
    {
      type: 'cylinder',
      id: 'tower-tank-cone',
      pos: [tx, TW.legs - 1.3, tz],
      radius: 1.0,
      radiusTop: tankR - 0.05,
      height: 1.3,
      sides: 12,
      color: C.rust,
      collide: false,
    },
    {
      type: 'cylinder',
      id: 'tower-band-paint',
      pos: [tx, TW.legs + 1.9, tz],
      radius: tankR + 0.03,
      height: 1.2,
      sides: 12,
      color: C['paint-white'],
      collide: false,
    },
    // the catwalk's rail: twelve posts and a top rail between them
    ...ring(12, walkR, (k, x, z) =>
      drawn(x - 0.03, z - 0.03, x + 0.03, z + 0.03, TW.legs - 0.03, TW.legs + 1.0, C.metal, {
        id: `tower-catwalk-post-${k + 1}`,
      }),
    ),
    ...ring(12, walkR, (k, x, z, a) => {
      const b = a + (Math.PI * 2) / 12;
      return along(
        [x, TW.legs + 0.95, z],
        [tx + Math.cos(b) * walkR, TW.legs + 0.95, tz + Math.sin(b) * walkR],
        0.05,
        0.05,
        C.metal,
        { id: `tower-catwalk-rail-${k + 1}`, collide: false },
      );
    }),
    // a ladder up the tank's west side to the roof, and the hatch it reaches
    ...[-0.24, 0.24].map((dz, k) =>
      drawn(
        tx - tankR - 0.18,
        tz + dz - 0.03,
        tx - tankR - 0.12,
        tz + dz + 0.03,
        TW.legs,
        TW.legs + 5.2,
        C.metal,
        {
          id: `tower-roof-ladder-stile-${k + 1}`,
        },
      ),
    ),
    ...Array.from({ length: 12 }, (_, k) =>
      drawn(
        tx - tankR - 0.18,
        tz - 0.21,
        tx - tankR - 0.12,
        tz + 0.21,
        TW.legs + 0.3 + k * 0.4,
        TW.legs + 0.34 + k * 0.4,
        C.metal,
        {
          id: `tower-roof-ladder-rung-${k + 1}`,
        },
      ),
    ),
    drawn(tx - 1.9, tz - 0.3, tx - 1.3, tz + 0.3, TW.legs + 5.75, TW.legs + 6.3, C.metal, {
      id: 'tower-roof-hatch',
    }),
    drawn(
      tx - 0.12,
      tz - 0.12,
      tx + 0.12,
      tz + 0.12,
      TW.legs + 7.6,
      TW.legs + 7.85,
      C['paint-red'],
      {
        id: 'tower-warning-lamp',
      },
    ),
    // the riser's valve wheel above the platform, facing west
    {
      type: 'cylinder',
      id: 'tower-riser-valve',
      pos: [tx - 0.68, 7.5, tz],
      radius: 0.3,
      height: 0.05,
      roll: 90,
      sides: 8,
      color: C['paint-red'],
      collide: false,
    },
    // the water column by road 2: a standpipe and its arm swung over the track
    {
      type: 'cylinder',
      id: 'water-column',
      pos: [tx - 10.8, 0, tz - 2],
      radius: 0.25,
      height: 3.6,
      sides: 8,
      color: C.metal,
    },
    along([tx - 10.8, 3.4, tz - 2], [tx - 10.8, 3.3, R2 - 0.2], 0.22, 0.22, C.metal, {
      id: 'water-column-arm',
    }),
    drawn(tx - 10.95, R2 - 0.35, tx - 10.65, R2 - 0.05, 2.3, 3.2, C['steel-dark'], {
      id: 'water-column-spout',
    }),
  ]);

  // The pump house: board-formed concrete (drawn lift lines), corner piers, a roof lip
  // (drawn, so the step down from the platform is as it was), a lamp and a plate over the
  // door, a downpipe. Inside: the pump and its motor on a plinth, the suction from the
  // well, the delivery pipe up and out to the riser with its valve and gauge, the starter
  // panel, a bench, a shelf and the pumpman's tool chest (`tool-cabinet`). The quest spot
  // in the middle of the floor stays clear.
  const lift = (y, k) => [
    drawn(PH.x0 - 0.02, PH.z0 - 0.02, PH.x1 + 0.02, PH.z0, y, y + 0.04, C['dark-concrete'], {
      id: `pump-house-lift-${k}-n`,
    }),
    drawn(PH.x0 - 0.02, PH.z1, PH.x1 + 0.02, PH.z1 + 0.02, y, y + 0.04, C['dark-concrete'], {
      id: `pump-house-lift-${k}-s`,
    }),
    // the west face's either side of the door
    drawn(PH.x0 - 0.02, PH.z0, PH.x0, tz - 0.6, y, y + 0.04, C['dark-concrete'], {
      id: `pump-house-lift-${k}-w1`,
    }),
    drawn(PH.x0 - 0.02, tz + 0.6, PH.x0, PH.z1, y, y + 0.04, C['dark-concrete'], {
      id: `pump-house-lift-${k}-w2`,
    }),
  ];
  const pumpHouse = group('Pump house', [
    drawn(PH.x0 + 0.2, PH.z0 + 0.2, PH.x1 - 0.2, PH.z1 - 0.2, 0, 0.02, C['dark-concrete'], {
      id: 'pump-house-floor',
    }),
    wZ('pump-house-wall-w', PH.x0 + 0.1, PH.z0, PH.z1, 0, 3.1, C.concrete, [door(tz)]),
    wZ('pump-house-wall-e', PH.x1 - 0.1, PH.z0, PH.z1, 0, 3.1, C.concrete),
    wX('pump-house-wall-n', PH.x0 + 0.2, PH.x1 - 0.2, PH.z0 + 0.1, 0, 3.1, C.concrete, [
      win(tx - 5.6, 1.0),
    ]),
    wX('pump-house-wall-s', PH.x0 + 0.2, PH.x1 - 0.2, PH.z1 - 0.1, 0, 3.1, C.concrete, [
      win(tx - 4.8, 1.0),
    ]),
    box(PH.x0 - 0.1, PH.z0 - 0.1, PH.x1 + 0.1, PH.z1 + 0.1, 3.1, TW.pump, C.concrete, {
      id: 'pump-house',
    }),
    doorZ('pump-house-door', PH.x0 + 0.1, tz, 0),
    // outside
    ...lift(1.05, 1),
    ...lift(2.1, 2),
    ...[
      [PH.x0, PH.z0],
      [PH.x1, PH.z0],
      [PH.x0, PH.z1],
      [PH.x1, PH.z1],
    ].map(([x, z], k) =>
      drawn(x - 0.17, z - 0.17, x + 0.17, z + 0.17, 0, TW.pump + 0.05, C.stone, {
        id: `pump-house-pier-${k + 1}`,
      }),
    ),
    drawn(
      PH.x0 - 0.12,
      PH.z0 - 0.12,
      PH.x1 + 0.12,
      PH.z0 - 0.02,
      TW.pump,
      TW.pump + 0.12,
      C['dark-concrete'],
      {
        id: 'pump-house-lip-n',
      },
    ),
    drawn(
      PH.x0 - 0.12,
      PH.z1 + 0.02,
      PH.x1 + 0.12,
      PH.z1 + 0.12,
      TW.pump,
      TW.pump + 0.12,
      C['dark-concrete'],
      {
        id: 'pump-house-lip-s',
      },
    ),
    drawn(
      PH.x0 - 0.12,
      PH.z0 - 0.02,
      PH.x0 - 0.02,
      PH.z1 + 0.02,
      TW.pump,
      TW.pump + 0.12,
      C['dark-concrete'],
      {
        id: 'pump-house-lip-w',
      },
    ),
    lampZ('pump-house-lamp', PH.x0 - 0.12, tz),
    drawn(PH.x0 - 0.05, tz + 0.75, PH.x0 - 0.01, tz + 1.45, 1.5, 1.85, C['paint-white'], {
      id: 'pump-house-plate',
    }),
    drawn(PH.x0 - 0.07, tz + 0.85, PH.x0 - 0.05, tz + 1.35, 1.62, 1.73, C.dark, {
      id: 'pump-house-plate-text',
    }),
    drawn(PH.x0 - 0.14, PH.z1 - 0.45, PH.x0 - 0.04, PH.z1 - 0.35, 0, TW.pump, C.metal, {
      id: 'pump-house-downpipe',
    }),
    drawn(PH.x0 - 1.2, tz - 0.9, PH.x0 - 0.1, tz + 0.9, 0, 0.04, C.concrete, {
      id: 'pump-house-step',
    }),
    // the pump: a plinth (a step up), the volute and the motor, the coupling between
    box(297.1, 70.1, 298.75, 71.7, 0, 0.3, C.concrete, { id: 'pump-house-plinth' }),
    box(297.25, 70.3, 297.95, 71.5, 0.3, 1.1, C.machine, { id: 'pump-house-pump' }),
    box(298.05, 70.45, 298.7, 71.35, 0.3, 1.0, C['siding-green'], { id: 'pump-house-motor' }),
    drawn(297.95, 70.75, 298.05, 71.05, 0.55, 0.8, C.dark, { id: 'pump-house-coupling' }),
    // suction down into the well, delivery up and out through the east wall to the riser
    drawn(296.75, 70.75, 297.25, 71.05, 0.5, 0.8, C.metal, { id: 'pump-house-suction' }),
    drawn(296.75, 70.75, 297.05, 71.05, 0.02, 0.5, C.metal, { id: 'pump-house-suction-down' }),
    box(297.45, 70.75, 297.75, 71.05, 1.1, 1.9, C.metal, { id: 'pump-house-delivery-up' }),
    drawn(297.45, 70.75, tx - 0.6, 71.05, 1.6, 1.9, C.metal, { id: 'pump-house-pipe' }),
    {
      type: 'cylinder',
      id: 'pump-house-valve',
      pos: [297.6, 1.475, 71.13],
      radius: 0.22,
      height: 0.05,
      pitch: 90,
      sides: 8,
      color: C['paint-red'],
      collide: false,
    },
    drawn(297.5, 71.05, 297.7, 71.08, 1.95, 2.15, C['paint-white'], { id: 'pump-house-gauge' }),
    // the starter panel and its conduit, a lamp
    drawn(295.0, PH.z0 + 0.2, 295.7, PH.z0 + 0.38, 1.1, 2.0, C['steel-dark'], {
      id: 'pump-house-starter',
    }),
    drawn(295.55, PH.z0 + 0.38, 295.62, PH.z0 + 0.44, 1.4, 1.7, C.dark, {
      id: 'pump-house-starter-handle',
    }),
    drawn(295.3, PH.z0 + 0.2, 295.4, PH.z0 + 0.3, 2.0, 3.1, C['steel-dark'], {
      id: 'pump-house-conduit',
    }),
    drawn(296.79, 72.09, 296.81, 72.11, 3.0, 3.1, C.dark, { id: 'pump-house-lamp-cord' }),
    drawn(296.6, 71.9, 297.0, 72.3, 2.88, 3.0, C.lamp, { id: 'pump-house-ceiling-lamp' }),
    // the bench along the east wall, a shelf on the west wall, the pumpman's tool chest
    box(298.1, 72.7, PH.x1 - 0.2, PH.z1 - 0.2, 0, 0.9, C.timber, { id: 'pump-house-bench' }),
    drawn(298.3, 73.0, 298.6, 73.3, 0.9, 1.1, C.steel, { id: 'pump-house-vice' }),
    ...[1.6, 2.1].map((y, k) =>
      drawn(PH.x0 + 0.2, 73.0, PH.x0 + 0.5, PH.z1 - 0.2, y, y + 0.04, C.timber, {
        id: `pump-house-shelf-${k + 1}`,
      }),
    ),
    ...[73.25, 73.6, 74.0].map((z, k) =>
      drawn(
        PH.x0 + 0.25,
        z - 0.1,
        PH.x0 + 0.45,
        z + 0.1,
        1.64,
        1.88,
        k === 1 ? C['paint-red'] : C.hazard,
        {
          id: `pump-house-can-${k + 1}`,
        },
      ),
    ),
    at('tool-chest', 295.6, 73.95, 0, { id: 'pump-house-tool-chest', yaw: 180 }),
  ]);

  // ------------------------------------------------------------------ loading tower
  // A timber chip-loading tower north of track 1 over the chip car: a deck at 3.3 m (stairs
  // up its west side) and one at 6.6 m (stairs up its east side) under the chip bin, the
  // chute out over the car. The AI follows you up both flights. The upper deck's south edge
  // drops 3.3 m onto the lower deck's apron, which runs south to the chip car (flush with
  // it); the lower deck's west edge and the car's sides drop 3.3 m to the ground. The other
  // edges are railed.
  const LT = { x0: 274, x1: 281, z0: 33, z1: 42.2, d1: 3.3, d2: 6.6, binTop: 11 };
  const ltPosts = [];
  for (const [x, z, top] of [
    [LT.x0, LT.z0, LT.binTop],
    [LT.x1 - 0.3, LT.z0, LT.binTop],
    [LT.x0, 35.7, LT.binTop],
    [279.0, 35.7, LT.binTop],
    [LT.x0, 38.7, LT.d2],
    [LT.x1 - 0.3, 38.7, LT.d2],
    [LT.x0, LT.z1 - 0.3, LT.d1],
    [LT.x1 - 0.3, LT.z1 - 0.3, LT.d1],
  ])
    ltPosts.push(
      box(x, z, x + 0.3, z + 0.3, -0.5, top, C.timber, { id: `lt-post-${ltPosts.length + 1}` }),
    );
  const ltRail = (id, x0, z0, x1, z1, y) => box(x0, z0, x1, z1, y, y + 1.0, C.timber, { id });
  /** The chute's middle line's height over z, from the bin (10.8 at z 36.3) to its mouth. */
  const chuteY = (z) => r2(10.8 + ((6.6 - 10.8) * (z - 36.3)) / (T1 - 0.4 - 36.3));
  /**
   * A diagonal brace drawn from a to b, made solid by small hidden boxes stacked along it
   * (an invisible box can't tilt), within a few cm of the drawn one: it stops shots and
   * bodies as it looks (no fake cover, 2026-11-17).
   */
  const brace = (id, a, b, w = 0.08, th = 0.12, color = C['timber-dark']) => {
    const n = 6;
    const out = [along(a, b, w, th, color, { id })];
    for (let k = 0; k < n; k++) {
      const p = a.map((v, i) => v + ((b[i] - v) * k) / n);
      const q = a.map((v, i) => v + ((b[i] - v) * (k + 1)) / n);
      const lo = p.map((v, i) => Math.min(v, q[i]));
      const hi = p.map((v, i) => Math.max(v, q[i]));
      const pad = [Math.max(0.05, w / 2), 0, Math.max(0.05, w / 2)];
      out.push(
        box(
          r2(lo[0] - pad[0]),
          r2(lo[2] - pad[2]),
          r2(hi[0] + pad[0]),
          r2(hi[2] + pad[2]),
          r2(lo[1]),
          r2(hi[1]),
          C['timber-dark'],
          {
            id: `${id}-solid-${k + 1}`,
            invisible: true,
            stopsShots: true,
          },
        ),
      );
    }
    return out;
  };
  const F1 = { x0: 274.35, x1: 275.55, zTop: 34.4, zFoot: 38.8 };
  const F2 = { x0: 279.45, x1: 280.65, zFoot: 33.4, zTop: 37.8 };
  const loadingTower = group('Loading tower', [
    ...ltPosts,
    // deck 1, with the hole over flight 1
    box(LT.x0, LT.z0, F1.x0 - 0.05, LT.z1, LT.d1 - 0.2, LT.d1, C.timber, { id: 'lt-deck-1-w' }),
    box(F1.x0 - 0.05, LT.z0, F1.x1 + 0.05, F1.zTop, LT.d1 - 0.2, LT.d1, C.timber, {
      id: 'lt-deck-1-nw',
    }),
    box(F1.x0 - 0.05, F1.zFoot + 0.1, F1.x1 + 0.05, LT.z1, LT.d1 - 0.2, LT.d1, C.timber, {
      id: 'lt-deck-1-sw',
    }),
    box(F1.x1 + 0.05, LT.z0, LT.x1, LT.z1, LT.d1 - 0.2, LT.d1, C.timber, { id: 'lt-deck-1' }),
    {
      type: 'stairs',
      id: 'lt-flight-1',
      pos: [r2((F1.x0 + F1.x1) / 2), 0, r2((F1.zTop + F1.zFoot) / 2)],
      yaw: 180,
      size: [r2(F1.x1 - F1.x0), LT.d1, r2(F1.zFoot - F1.zTop)],
      color: C.timber,
    },
    ltRail('lt-rail-1-hole', F1.x1 + 0.05, F1.zTop, F1.x1 + 0.15, F1.zFoot + 0.1, LT.d1),
    ltRail('lt-rail-1-n', LT.x0, LT.z0, LT.x1, LT.z0 + 0.1, LT.d1),
    ltRail('lt-rail-1-e', LT.x1 - 0.1, LT.z0, LT.x1, 40.2, LT.d1),
    {
      type: 'stairs',
      id: 'lt-flight-2',
      pos: [r2((F2.x0 + F2.x1) / 2), LT.d1, r2((F2.zTop + F2.zFoot) / 2)],
      yaw: 0,
      size: [r2(F2.x1 - F2.x0), LT.d2 - LT.d1, r2(F2.zTop - F2.zFoot)],
      color: C.timber,
    },
    // deck 2 (z 36–39), with the hole over flight 2's top
    box(LT.x0, 36, F2.x0 - 0.05, 39, LT.d2 - 0.2, LT.d2, C.timber, { id: 'lt-deck-2' }),
    box(F2.x0 - 0.05, F2.zTop, LT.x1, 39, LT.d2 - 0.2, LT.d2, C.timber, { id: 'lt-deck-2-e' }),
    ltRail('lt-rail-2-hole', F2.x0 - 0.15, 36, F2.x0 - 0.05, F2.zTop, LT.d2),
    ltRail('lt-rail-2-w', LT.x0, 36, LT.x0 + 0.1, 39, LT.d2),
    ltRail('lt-rail-2-e', LT.x1 - 0.1, F2.zTop, LT.x1, 39, LT.d2),
    // the chip bin over the north half, roofed, and its chute out over the chip car
    box(LT.x0, LT.z0, 279.3, 36, LT.d2 - 0.2, LT.binTop, C['timber-dark'], { id: 'lt-bin' }),
    box(LT.x0 - 0.2, LT.z0 - 0.2, 279.5, 36.2, LT.binTop, LT.binTop + 0.3, C.roof, {
      id: 'lt-bin-roof',
    }),
    ...[7.8, 9.4].map((y, k) =>
      drawn(LT.x0 - 0.02, LT.z0 - 0.02, 279.32, 36.02, y, y + 0.08, C.timber, {
        id: `lt-bin-band-${k + 1}`,
      }),
    ),
    // The chute, solid since 2026-11-17 (no fake cover) and raised to stay out of reach: over
    // deck 2's south edge its underside is 2.3 m up (head room) and its top 2.9 m (past a
    // jump and vault); its mouth is 3.3 m over the chip car. In two pieces, split at deck 2's edge, so neither's bounds take in the deck.
    along([277, 10.8, 36.3], [277, chuteY(39.15), 39.15], 0.8, 0.5, C.metal, {
      id: 'lt-chute',
      collide: true,
    }),
    along([277, chuteY(39.15), 39.15], [277, 6.6, T1 - 0.4], 0.8, 0.5, C.metal, {
      id: 'lt-chute-mouth',
      collide: true,
    }),
    along([277, 11.0, 35.6], [277, 6.6, T1 - 0.6], 0.04, 0.04, C.dark, { id: 'lt-chute-cable' }),
    // a lookout's cache on the upper deck: the yard's most exposed perch
    spot('lt-deck-cache', 275.2, LT.d2, 37.0, 'lookout-cache', 0.5),
    // bracing on the ground storey, solid (2026-11-17)
    ...brace('lt-brace-w', [LT.x0 + 0.15, 0.2, LT.z0 + 0.2], [LT.x0 + 0.15, LT.d1 - 0.3, 38.7]),
    ...brace('lt-brace-e', [LT.x1 - 0.15, 0.2, 38.7], [LT.x1 - 0.15, LT.d1 - 0.3, LT.z0 + 0.2]),
    ...brace(
      'lt-brace-n',
      [LT.x0 + 0.2, 0.2, LT.z0 + 0.15],
      [LT.x1 - 0.2, LT.d1 - 0.3, LT.z0 + 0.15],
    ),
  ]);

  // ------------------------------------------------------------------ bunkhouse
  // One storey, its front (porch) facing north to the yard, its back to the cookhouse. Two
  // dorms laid out differently either side of a common room that goes front to back; the
  // east wing has the washroom. Built in its own frame, front on +z, turned 180°: local
  // west (−x) is world east. Doors: each gable, front and back of the common room, and
  // between the rooms, so every room has two ways in.
  const FL = 0.35;
  /** Blanket colors, taken in turn so neighbouring bunks differ. */
  const BLANKETS = ['#6e3a32', '#4f5a6e', '#5f6b4a', '#7a6a50', '#3e4a52'];
  let bunkCount = 0;
  const bunk = (id, x, z, alongX) => {
    bunkCount += 2;
    // 2.0 × 0.95 m, two-high: the mattresses and end boards collide, the gap between the
    // bunks is a body-only blocker (no crawling in), sight and shots pass it
    const [hx, hz] = alongX ? [1.0, 0.475] : [0.475, 1.0];
    const ends = alongX
      ? [
          [x - hx, z - hz, x - hx + 0.06, z + hz],
          [x + hx - 0.06, z - hz, x + hx, z + hz],
        ]
      : [
          [x - hx, z - hz, x + hx, z - hz + 0.06],
          [x - hx, z + hz - 0.06, x + hx, z + hz],
        ];
    return [
      box(x - hx, z - hz, x + hx, z + hz, FL + 0.25, FL + 0.5, C.mattress, { id: `${id}-lower` }),
      box(x - hx, z - hz, x + hx, z + hz, FL + 1.35, FL + 1.6, C.mattress, { id: `${id}-upper` }),
      box(
        x - hx + 0.06,
        z - hz + 0.06,
        x + hx - 0.06,
        z + hz - 0.06,
        FL + 0.5,
        FL + 1.35,
        '#5a8ab8',
        {
          id: `${id}-gap`,
          invisible: true,
        },
      ),
      ...ends.map(([a, b, c, d], k) =>
        box(a, b, c, d, FL, FL + 1.75, C['bunk-frame'], { id: `${id}-end-${k + 1}` }),
      ),
      // a blanket over the foot two-thirds and a pillow at the head of each mattress
      // (drawn); the head is the end nearer the wall, x− for bunks along x
      ...[FL + 0.5, FL + 1.6].flatMap((y, k) => {
        const head = alongX ? -1 : Math.sign(z) || 1;
        // [blanket, pillow] as [x0, z0, x1, z1]
        const [bl, pl] = alongX
          ? [
              [x - hx + 0.75, z - hz + 0.03, x + hx - 0.06, z + hz - 0.03],
              [x - hx + 0.1, z - hz + 0.15, x - hx + 0.55, z + hz - 0.15],
            ]
          : head > 0
            ? [
                [x - hx + 0.03, z - hz + 0.06, x + hx - 0.03, z + hz - 0.75],
                [x - hx + 0.15, z + hz - 0.55, x + hx - 0.15, z + hz - 0.1],
              ]
            : [
                [x - hx + 0.03, z - hz + 0.75, x + hx - 0.03, z + hz - 0.06],
                [x - hx + 0.15, z - hz + 0.1, x + hx - 0.15, z - hz + 0.55],
              ];
        const color = BLANKETS[(bunkCount + k) % BLANKETS.length];
        return [
          drawn(...bl, y, y + 0.05, color, { id: `${id}-blanket-${k + 1}` }),
          drawn(...pl, y, y + 0.1, C['paint-white'], { id: `${id}-pillow-${k + 1}` }),
        ];
      }),
    ];
  };
  const bunkhouse = (() => {
    const id = 'bh';
    const hw = 11;
    const hd = 4.5;
    const col = C['siding-green'];
    const sh = shell(id, {
      hw,
      hd,
      fl: FL,
      color: col,
      ops: {
        front: [win(-9), win(-5.5), door(0), win(2.2), win(5.5), win(9)],
        back: [win(-9), win(-5.5), door(-1.8), win(1.8), win(5.5), win(9.6, 0.8, { bottom: 1.5 })],
        west: [door(1.5), win(-2.2)],
        east: [door(2.5), win(-2.5, 0.8, { bottom: 1.5 })],
      },
    });
    const rf = roof(`${id}-roof`, -hw, hw, -hd, hd, sh.top, 25, { roof: C.roof, gable: col });
    const p = (k, x0, x1, z0, z1, ops) =>
      x0 === x1
        ? wZ(`${id}-p${k}`, x0, z0, z1, FL, FL + 3, C.plaster, ops, 0.15)
        : wX(`${id}-p${k}`, x0, x1, z0, FL, FL + 3, C.plaster, ops, 0.15);
    const n = [
      ...sh.nodes,
      ...rf.nodes,
      ...porch(id, 0, hd, FL, 3.2),
      p(1, -3.6, -3.6, -4.3, 4.3, [door(-1.2)]),
      p(2, 3.6, 3.6, -4.3, 4.3, [door(1.8)]),
      p(3, 7.8, 10.8, -0.6, -0.6, [{ ...door(9.3), width: 0.9 }]),
      p(4, 7.8, 7.8, -4.3, -0.675, []),
      doorX(`${id}-door-front`, 0, hd - 0.1, FL),
      doorX(`${id}-door-back`, -1.8, -hd + 0.1, FL),
      doorZ(`${id}-door-west`, -hw + 0.1, 1.5, FL),
      doorZ(`${id}-door-east`, hw - 0.1, 2.5, FL),
      doorZ(`${id}-door-dorm-w`, -3.6, -1.2, FL),
      doorZ(`${id}-door-dorm-e`, 3.6, 1.8, FL),
      doorX(`${id}-door-wash`, 9.3, -0.6, FL, 0.9),
      // west dorm: bunks heads to the back wall and two along the front, lockers back to
      // back down the middle
      ...bunk(`${id}-bunk-1`, -10.0, -3.3, false),
      ...bunk(`${id}-bunk-2`, -7.6, -3.3, false),
      ...bunk(`${id}-bunk-3`, -5.2, -3.3, false),
      ...bunk(`${id}-bunk-4`, -7.6, 3.3, false),
      ...bunk(`${id}-bunk-5`, -5.2, 3.3, false),
      at('locker-bank', -7.0, -0.05, FL, { id: `${id}-lockers-1` }),
      at('locker-bank', -7.0, 0.5, FL, { id: `${id}-lockers-2`, yaw: 180 }),
      // common room: a table, the stove and its flue, a couch, the notice board
      at('table-and-chairs', -1.6, 1.0, FL, { id: `${id}-table` }),
      // the men's odds and ends on the tables (2026-11-17, household)
      spot(`${id}-table-spot`, -1.6, FL + 0.75, 1.0, 'household', 0.3),
      box(1.9, -0.4, 2.6, 0.3, FL, FL + 1.0, C.dark, { id: `${id}-stove` }),
      drawn(2.15, -0.15, 2.35, 0.05, FL + 1.0, sh.top, C.dark, { id: `${id}-flue` }),
      box(2.0, -0.35, 2.5, 0.25, sh.top, rf.ridge + 0.4, C.stone, { id: `${id}-chimney` }),
      at('couch', 1.4, -3.75, FL, { id: `${id}-couch` }),
      at('ems-bag', -2.2, -2.6, FL, { id: `${id}-ems-bag` }),
      at('notice-board', -3.5, 2.6, FL, { id: `${id}-notice`, yaw: 90 }),
      // east dorm: bunks along the front wall, two heads to the back, a table between
      ...bunk(`${id}-bunk-6`, 5.0, 3.8, true),
      ...bunk(`${id}-bunk-7`, 8.4, 3.8, true),
      ...bunk(`${id}-bunk-8`, 4.5, -3.3, false),
      ...bunk(`${id}-bunk-9`, 6.6, -3.3, false),
      at('table-and-chairs', 6.2, 0.6, FL, { id: `${id}-table-e`, yaw: 90 }),
      spot(`${id}-table-e-spot`, 6.2, FL + 0.75, 0.6, 'household', 0.25),
      at('wardrobe', 10.45, 0.3, FL, { id: `${id}-wardrobe`, yaw: -90 }),
      // washroom
      at('sink-counter', 9.3, -4.0, FL, { id: `${id}-sinks` }),
      at('toilet', 10.4, -1.3, FL, { id: `${id}-toilet`, yaw: -90 }),
      // medicine cabinet on the washroom's west partition
      at('medicine-cabinet', 7.875, -2.4, FL, { id: `${id}-meds`, yaw: 90 }),
      // Dressed 2026-11-17: a footlocker at the foot of three bunks (the men's own things,
      // `footlocker`), rugs in the dorms and the common room, a dartboard by the stove,
      // wall lamps; outside, a skirting board, sills, shutters and flower boxes under the
      // front and back windows, a porch rail and bench, the company's board over the
      // porch, lamps over the doors, stoops at the gable doors.
      at('footlocker', -10.0, -1.95, FL, { id: `${id}-footlocker-1` }),
      at('footlocker', -7.6, 1.95, FL, { id: `${id}-footlocker-2`, yaw: 180 }),
      at('footlocker', 4.5, -1.95, FL, { id: `${id}-footlocker-3` }),
      // rugs, a dartboard by the stove and wall lamps, all drawn (merged, no draw calls)
      ...[
        ['w', -9.6, 0.4, -7.6, 2.4, '#7a4a3a'],
        ['common', -1.5, -2.6, 1.5, -0.6, '#5a4a6a'],
        ['e', 4.4, -2.2, 6.4, -0.2, '#4a5a4a'],
      ].map(([k, x0, z0, x1, z1, c]) =>
        drawn(x0, z0, x1, z1, FL, FL + 0.015, c, { id: `${id}-rug-${k}` }),
      ),
      drawn(3.48, -2.95, 3.52, -2.25, FL + 1.35, FL + 2.05, C.dark, { id: `${id}-dartboard` }),
      drawn(3.46, -2.75, 3.48, -2.45, FL + 1.55, FL + 1.85, C['paint-red'], {
        id: `${id}-dartboard-bull`,
      }),
      ...[-7.3, 0, 6.0].map((x, k) =>
        drawn(x - 0.12, -hd + 0.2, x + 0.12, -hd + 0.3, FL + 2.3, FL + 2.5, C.lamp, {
          id: `${id}-wall-light-${k + 1}`,
        }),
      ),
      drawn(-hw - 0.04, -hd - 0.04, hw + 0.04, hd + 0.04, -0.05, FL - 0.03, C['timber-dark'], {
        id: `${id}-skirting`,
      }),
      ...[
        [-9, 1],
        [-5.5, 1],
        [2.2, 1],
        [5.5, 1],
        [9, 1],
        [-9, -1],
        [-5.5, -1],
        [1.8, -1],
        [5.5, -1],
      ].flatMap(([x, side], k) => {
        const f = side * hd;
        const o = (a, b) => [
          Math.min(f + side * a, f + side * b),
          Math.max(f + side * a, f + side * b),
        ];
        const [s0, s1] = o(0, 0.1);
        const [b0, b1] = o(0, 0.28);
        const [h0, h1] = o(0, 0.05);
        return [
          drawn(x - 0.8, s0, x + 0.8, s1, FL + 0.82, FL + 0.9, C['paint-white'], {
            id: `${id}-sill-${k + 1}`,
          }),
          drawn(x - 0.6, b0, x + 0.6, b1, FL + 0.52, FL + 0.8, C['timber-dark'], {
            id: `${id}-box-${k + 1}`,
          }),
          drawn(x - 0.55, b0, x + 0.55, b1, FL + 0.8, FL + 0.92, '#5f7a3e', {
            id: `${id}-box-${k + 1}-plants`,
          }),
          drawn(x - 1.15, h0, x - 0.75, h1, FL + 0.85, FL + 2.05, '#3e5034', {
            id: `${id}-shutter-${k + 1}a`,
          }),
          drawn(x + 0.75, h0, x + 1.15, h1, FL + 0.85, FL + 2.05, '#3e5034', {
            id: `${id}-shutter-${k + 1}b`,
          }),
        ];
      }),
      // the porch: rails on both sides (vaultable), a bench against the wall, the board
      ...[-1, 1].map((sd) =>
        box(sd * 1.6 - 0.05, hd, sd * 1.6 + 0.05, hd + 1.45, FL - 0.02, FL + 0.9, C.timber, {
          id: `${id}-porch-rail-${sd < 0 ? 'w' : 'e'}`,
        }),
      ),
      box(0.75, hd + 0.05, 1.45, hd + 0.45, FL - 0.02, FL + 0.45, C['timber-dark'], {
        id: `${id}-porch-bench`,
      }),
      drawn(-1.5, hd, 1.5, hd + 0.06, 2.95, 3.35, C['paint-white'], { id: `${id}-board` }),
      drawn(-1.3, hd + 0.06, 1.3, hd + 0.08, 3.08, 3.22, C.dark, { id: `${id}-board-text` }),
      lampX(`${id}-lamp-back`, -1.8, -hd - 0.12, FL + 2.3),
      lampZ(`${id}-lamp-west`, -hw - 0.12, 1.5, FL + 2.3),
      lampZ(`${id}-lamp-east`, hw + 0.12, 2.5, FL + 2.3),
      ...[
        [-hw - 0.9, -hw, 1.5],
        [hw, hw + 0.9, 2.5],
      ].map(([a, b, z], k) =>
        drawn(a, z - 0.7, b, z + 0.7, 0, 0.18, C.timber, { id: `${id}-stoop-${k + 1}` }),
      ),
    ];
    return group('Bunkhouse', n, { pos: [283, 0, 96.5], yaw: 180 });
  })();

  // ------------------------------------------------------------------ cookhouse
  // The mess hall west, the kitchen east behind a serving hatch you can vault, doors on
  // every side but the east; front (south) to the highway, back to the bunkhouse.
  const cookhouse = (() => {
    const id = 'ck';
    const hw = 6.5;
    const hd = 4;
    const col = C['siding-tan'];
    const sh = shell(id, {
      hw,
      hd,
      fl: FL,
      color: col,
      ops: {
        front: [win(-5.2, 1.2), door(-2.5), win(0, 1.2), win(4.0)],
        back: [door(-5.0), win(-2.0), door(4.5)],
        west: [win(-2.2, 1.2), door(0.5), win(2.6, 1.0)],
        east: [win(0)],
      },
    });
    const rf = roof(`${id}-roof`, -hw, hw, -hd, hd, sh.top, 25, {
      roof: C['roof-red'],
      gable: col,
    });
    const table = (k, x) => [
      box(x - 0.4, -2.6, x + 0.4, 2.2, FL + 0.72, FL + 0.78, C.timber, { id: `${id}-table-${k}` }),
      box(x - 0.3, -2.4, x + 0.3, 2.0, FL, FL + 0.72, C['timber-dark'], {
        id: `${id}-table-${k}-legs`,
        collide: false,
      }),
      ...[-1, 1].map((sd) =>
        box(
          x + sd * 0.65 - 0.17,
          -2.5,
          x + sd * 0.65 + 0.17,
          2.1,
          FL,
          FL + 0.45,
          C['timber-dark'],
          {
            id: `${id}-bench-${k}${sd < 0 ? 'w' : 'e'}`,
          },
        ),
      ),
    ];
    const n = [
      ...sh.nodes,
      ...rf.nodes,
      wZ(
        `${id}-p1`,
        1.0,
        -3.8,
        3.8,
        FL,
        FL + 3,
        C.plaster,
        [door(-2.4), { at: 1.2, width: 2.0, bottom: 0.95, top: 2.0 }],
        0.15,
      ),
      doorX(`${id}-door-front`, -2.5, hd - 0.1, FL),
      doorX(`${id}-door-back`, -5.0, -hd + 0.1, FL),
      doorX(`${id}-door-kitchen`, 4.5, -hd + 0.1, FL),
      doorZ(`${id}-door-west`, -hw + 0.1, 0.5, FL),
      doorZ(`${id}-door-hall`, 1.0, -2.4, FL),
      ...table(1, -4.2),
      ...table(2, -1.4),
      // the serving counter under the hatch, kitchen side
      box(1.08, 0.2, 1.65, 2.2, FL, FL + 0.95, C.steel, { id: `${id}-counter` }),
      // kitchen: the run of units, the range and its hood, the cold store, a prep table
      at('kitchen-run', 5.95, -2.4, FL, { id: `${id}-kitchen-run`, yaw: -90 }),
      box(5.5, 1.2, 6.3, 2.4, FL, FL + 0.9, C.steel, { id: `${id}-range` }),
      drawn(5.4, 1.1, 6.3, 2.5, FL + 2.0, FL + 2.5, C.steel, { id: `${id}-hood` }),
      box(5.7, 1.6, 6.1, 2.0, sh.top, rf.ridge + 0.3, C.stone, { id: `${id}-chimney` }),
      box(5.5, 3.0, 6.3, 3.8, FL, FL + 1.95, C['paint-white'], { id: `${id}-cold-store` }),
      box(3.0, -0.8, 4.2, 0.4, FL, FL + 0.9, C.steel, { id: `${id}-prep-table` }),
      // Dressed 2026-11-17: the kitchen's fridge (`fridge`), a loose spot on the prep table
      // and one on the mess tables, pans over the range, a shelf of tins, plates and mugs
      // on the tables, hanging lamps, a clock; outside, white trim, drawn awnings over the
      // front and kitchen doors (drawn, so no perch), the dinner bell on its post, a menu
      // board, bins and crates of empties by the kitchen door.
      at('fridge-v2', 2.9, -hd + 0.85, FL, {
        id: `${id}-fridge`,
        loot: {
          container: 'fridge',
          mix: { tables: { 'fridge-home': 0.8, 'fridge-parts': 0.2 }, empty: 0.4 },
        },
      }),
      spot(`${id}-prep-spot`, 3.6, FL + 0.9, -0.2, 'fridge-food', 0.35),
      spot(`${id}-mess-spot`, -1.4, FL + 0.78, -1.2, 'household', 0.25),
      ...[5.6, 5.9, 6.2].map((x, k) =>
        drawn(x - 0.1, 1.55, x + 0.1, 1.75, FL + 1.55 - k * 0.08, FL + 1.75, C.dark, {
          id: `${id}-pan-${k + 1}`,
        }),
      ),
      drawn(5.4, 1.5, 6.4, 1.56, FL + 1.75, FL + 1.8, C.steel, { id: `${id}-pan-rail` }),
      ...[1.4, 1.9].map((y, k) =>
        drawn(1.15, -3.8, 1.45, -3.0, FL + y, FL + y + 0.04, C.timber, {
          id: `${id}-shelf-${k + 1}`,
        }),
      ),
      ...[-3.65, -3.4, -3.15].map((z, k) =>
        drawn(
          1.2,
          z - 0.08,
          1.38,
          z + 0.08,
          FL + 1.44,
          FL + 1.62,
          k === 1 ? C['paint-red'] : C.hazard,
          {
            id: `${id}-tin-${k + 1}`,
          },
        ),
      ),
      ...[-4.2, -1.4].flatMap((x, t) =>
        [-1.8, -0.4, 1.0].map((z, k) =>
          drawn(x - 0.12, z - 0.12, x + 0.12, z + 0.12, FL + 0.78, FL + 0.8, C['paint-white'], {
            id: `${id}-plate-${t + 1}-${k + 1}`,
          }),
        ),
      ),
      ...[-4.2, -2.8, -1.4, 3.6].map((x, k) =>
        drawn(x - 0.2, -0.2, x + 0.2, 0.2, sh.top - 0.6, sh.top - 0.48, C.lamp, {
          id: `${id}-lamp-${k + 1}`,
        }),
      ),
      drawn(-6.3, 1.5, -6.28, 1.9, FL + 2.1, FL + 2.5, C['paint-white'], { id: `${id}-clock` }),
      // outside
      ...[
        [-hw, -hd],
        [hw, -hd],
        [-hw, hd],
        [hw, hd],
      ].map(([x, z], k) =>
        drawn(x - 0.08, z - 0.08, x + 0.08, z + 0.08, 0, sh.top + 0.05, C['paint-white'], {
          id: `${id}-corner-${k + 1}`,
        }),
      ),
      drawn(-3.6, hd, -1.4, hd + 1.2, FL + 2.45, FL + 2.55, C['roof-red'], {
        id: `${id}-awning-front`,
        collide: false,
      }),
      drawn(3.4, -hd - 1.2, 5.6, -hd, FL + 2.45, FL + 2.55, C['roof-red'], {
        id: `${id}-awning-kitchen`,
        collide: false,
      }),
      box(-0.9, hd + 1.4, -0.75, hd + 1.55, 0, 2.6, C['timber-dark'], { id: `${id}-bell-post` }),
      drawn(-0.95, hd + 1.35, -0.55, hd + 1.6, 2.6, 2.68, C['timber-dark'], {
        id: `${id}-bell-arm`,
      }),
      drawn(-0.75, hd + 1.4, -0.55, hd + 1.55, 2.3, 2.6, C.hazard, {
        id: `${id}-bell`,
        top: [0.08, 0.06],
      }),
      drawn(-1.1, hd + 0.02, -0.4, hd + 0.06, 1.2, 1.9, C.dark, { id: `${id}-menu-board` }),
      lampX(`${id}-lamp-out-front`, -2.5, hd + 0.12, FL + 2.3),
      lampX(`${id}-lamp-out-kitchen`, 4.5, -hd - 0.12, FL + 2.3),
      at('wheelie-bin', 6.0, -hd - 0.75, 0, { id: `${id}-bin-1`, yaw: 180 }),
      at('wheelie-bin', 2.9, -hd - 0.75, 0, { id: `${id}-bin-2`, yaw: 170 }),
      box(5.85, -hd - 2.2, 6.55, -hd - 1.6, 0, 0.8, C.timber, { id: `${id}-empties` }),
      drawn(5.9, -hd - 2.15, 6.5, -hd - 1.65, 0.8, 0.95, C['paint-white'], {
        id: `${id}-empties-bottles`,
      }),
    ];
    return group('Cookhouse', n, { pos: [278.5, 0, 108], yaw: 0 });
  })();
  const camp = [
    at('woodshed', 289.5, 106.2, 0, { id: 'camp-woodshed' }),
    at('clothes-line', 291, 110.6, 0, { id: 'camp-clothes-line', yaw: 6 }),
    at('burn-barrel', 287.2, 102.6, 0, { id: 'camp-burn-barrel' }),
    at('table-and-chairs', 299, 104, 0, { id: 'bh-yard-table', yaw: 20 }),
    // between the bunkhouse and the water tower: a pile and a rock
    bedded('log-pile-tall', 299.5, 86.5, 3, 1, { id: 'camp-pile-1', yaw: 28 }),
    on('rock-large', 288.5, 84.5, { id: 'camp-rock-1', yaw: -20 }),
  ];

  // ------------------------------------------------------------------ equipment depot
  // Reworked 2026-11-17 (docs: silver-creek.md → Equipment depot). A steel shed with two bays
  // onto a concrete apron (bay A open, bay B's shutter jammed 1.3 m up: a crouch-only way in),
  // doors in every wall, and three levels of risk inside:
  // - the floor: the skidder in bay A, the engine and forklift in bay B, the bench;
  // - the parts cage under the mezzanine: bars on two sides (see-through, partly shot-proof),
  //   a gate from the floor and the east door, the best loot in the shed;
  // - the high route at 3.3 m: the mezzanine with the yard office (stairs, the AI follows), a
  //   walkway along the north wall with windows over the highway, and the overhead crane's
  //   bridge across the whole hall, unrailed, seen from every door. Player-only up a crate
  //   stack too. Every edge of it drops 3.3 m onto the floor.
  // The tire shop leans on the west wall (its roof a ladder perch over the west approach and
  // the highway); the fuel tanks stand east; the equipment yard beyond them.
  const DP = { x0: 232, x1: 262, z0: 124, z1: 140, top: 6.5, mz: 255.5, my: 3.3 };
  const dCol = C.depot;
  const dpRoof = roof('dp-roof', DP.x0, DP.x1, DP.z0, DP.z1, DP.top, 8, {
    roof: C.roof,
    gable: dCol,
  });
  const bollard = (id, x, z) => ({
    type: 'cylinder',
    id,
    pos: [r2(x), 0, r2(z)],
    radius: 0.12,
    height: 1.0,
    sides: 8,
    color: C.hazard,
  });
  const highWin = (a, w = 1.6) => win(a, w, { bottom: 1.5, top: 2.5 });
  const upWin = (a, w = 1.4) => win(a, w, { bottom: 4.2, top: 5.3 });
  const OF = { x0: 257.5, z0: 132.5 };
  /** The walkway along the north wall and the crane bridge, both at the mezzanine's height. */
  const WK = { x0: 244.4, z1: 125.6 };
  const BR = { x0: 244.4, x1: 245.6 };
  const U = DP.my;
  const rail = (id, x0, z0, x1, z1) => box(x0, z0, x1, z1, U, U + 1.0, C.hazard, { id });
  const shed = [
    drawn(DP.x0 + 0.2, DP.z0 + 0.2, DP.x1 - 0.2, DP.z1 - 0.2, 0, 0.02, C['dark-concrete'], {
      id: 'dp-floor',
    }),
    // a painted line between the bays
    drawn(247.0, DP.z0 + 0.3, 247.15, DP.z1 - 0.3, 0.02, 0.03, C.hazard, { id: 'dp-bay-line' }),
    wX('dp-wall-n', DP.x0, DP.x1, DP.z0 + 0.1, 0, DP.top, dCol, [
      highWin(235),
      { at: 240, width: 5, bottom: 0, top: 4.6 },
      upWin(244, 1.0),
      door(246.5),
      upWin(249.5, 1.2),
      { at: 254, width: 5, bottom: 0, top: 4.6 },
      highWin(259.5, 1.2),
    ]),
    wX('dp-wall-s', DP.x0, DP.x1, DP.z1 - 0.1, 0, DP.top, dCol, [
      door(236),
      highWin(242),
      highWin(248),
      highWin(252.5, 1.2),
      door(258.5),
    ]),
    wZ('dp-wall-w', DP.x0 + 0.1, DP.z0 + 0.2, DP.z1 - 0.2, 0, DP.top, dCol, [
      highWin(127),
      door(132),
      highWin(137),
    ]),
    wZ('dp-wall-e', DP.x1 - 0.1, DP.z0 + 0.2, DP.z1 - 0.2, 0, DP.top, dCol, [
      door(127.5),
      upWin(134.5),
      upWin(137.8),
    ]),
    ...dpRoof.nodes,
    doorX('dp-door-n', 246.5, DP.z0 + 0.1, 0),
    doorX('dp-door-s1', 236, DP.z1 - 0.1, 0),
    doorX('dp-door-s2', 258.5, DP.z1 - 0.1, 0),
    doorZ('dp-door-w', DP.x0 + 0.1, 132, 0),
    doorZ('dp-door-e', DP.x1 - 0.1, 127.5, 0),
    // bay A's shutter rolled up; bay B's jammed 1.3 m off the floor
    drawn(237.4, DP.z0 - 0.15, 242.6, DP.z0 + 0.3, 4.6, 5.1, C['depot-dark'], {
      id: 'dp-shutter-a',
    }),
    box(251.5, DP.z0, 256.5, DP.z0 + 0.12, 1.3, 4.6, C['depot-dark'], { id: 'dp-shutter-b' }),
    drawn(251.5, DP.z0 - 0.02, 256.5, DP.z0 + 0.14, 1.25, 1.35, C.hazard, {
      id: 'dp-shutter-b-edge',
    }),
    // outside: the company's board over the door, a lamp over every door, bollards at the bays
    drawn(242.8, DP.z0 - 0.08, 250.8, DP.z0 - 0.02, 4.9, 6.0, C['paint-white'], {
      id: 'dp-sign',
    }),
    drawn(243.1, DP.z0 - 0.1, 250.5, DP.z0 - 0.08, 5.15, 5.4, C['paint-red'], {
      id: 'dp-sign-stripe',
    }),
    drawn(243.1, DP.z0 - 0.1, 248.0, DP.z0 - 0.08, 5.55, 5.75, C.dark, { id: 'dp-sign-text' }),
    lampX('dp-lamp-n', 246.5, DP.z0 - 0.12),
    lampX('dp-lamp-s1', 236, DP.z1 + 0.12),
    lampX('dp-lamp-s2', 258.5, DP.z1 + 0.12),
    lampZ('dp-lamp-e', DP.x1 + 0.12, 127.5),
    ...[237.1, 242.9, 251.1, 256.9].map((x, k) => bollard(`dp-bollard-${k + 1}`, x, 123.3)),

    // ---- the high route
    // the mezzanine and its posts, stairs along the south wall, rails with a gap over the
    // cage's gate
    box(DP.mz, DP.z0 + 0.2, DP.x1 - 0.2, DP.z1 - 0.2, U - 0.2, U, C.steel, { id: 'dp-mezz' }),
    ...[128, 132, 136].map((z, k) =>
      box(DP.mz + 0.05, z - 0.1, DP.mz + 0.25, z + 0.1, 0, U - 0.2, C['steel-dark'], {
        id: `dp-mezz-post-${k + 1}`,
      }),
    ),
    {
      type: 'stairs',
      id: 'dp-stairs',
      pos: [DP.mz - 2.5, 0, 138.75],
      yaw: 90,
      size: [1.1, U, 5.0],
      color: C.steel,
      sides: 1.0,
    },
    box(DP.mz, WK.z1, DP.mz + 0.08, 127.6, U, U + 1.0, C.hazard, { id: 'dp-mezz-rail-1' }),
    box(DP.mz, 129.2, DP.mz + 0.08, 138.1, U, U + 1.0, C.hazard, { id: 'dp-mezz-rail-2' }),
    // the walkway along the north wall, from the mezzanine to the crane bridge: a rail on
    // its floor side with a gap to drop through, two posts down to the floor
    box(WK.x0, DP.z0 + 0.2, DP.mz, WK.z1, U - 0.2, U, C.steel, { id: 'dp-walkway' }),
    rail('dp-walkway-rail-1', BR.x1, WK.z1 - 0.08, 249.0, WK.z1),
    rail('dp-walkway-rail-2', 250.4, WK.z1 - 0.08, DP.mz, WK.z1),
    ...[247.8, 251.0].map((x, k) =>
      box(x - 0.1, WK.z1 - 0.3, x + 0.1, WK.z1 - 0.1, 0, U - 0.2, C['steel-dark'], {
        id: `dp-walkway-post-${k + 1}`,
      }),
    ),
    // the overhead crane, parked mid-hall: its bridge girder spans the hall north to south,
    // walkable along its top, no rails. The runway beam along the south wall and the end
    // trucks are drawn; the trolley and hook hang under the bridge over bay A.
    box(BR.x0, WK.z1, BR.x1, DP.z1 - 0.2, U - 0.3, U, C.hazard, { id: 'dp-crane-bridge' }),
    drawn(BR.x0 + 0.1, WK.z1, BR.x0 + 0.3, DP.z1 - 0.2, U - 0.75, U - 0.3, C.hazard, {
      id: 'dp-crane-girder-w',
    }),
    drawn(BR.x1 - 0.3, WK.z1, BR.x1 - 0.1, DP.z1 - 0.2, U - 0.75, U - 0.3, C.hazard, {
      id: 'dp-crane-girder-e',
    }),
    drawn(233, DP.z1 - 0.5, 250.5, DP.z1 - 0.2, U - 0.6, U - 0.3, C['steel-dark'], {
      id: 'dp-crane-runway',
    }),
    drawn(BR.x0 - 0.5, DP.z1 - 0.8, BR.x1 + 0.5, DP.z1 - 0.2, U - 0.75, U - 0.3, C.dark, {
      id: 'dp-crane-truck-s',
    }),
    drawn(BR.x0 + 0.15, 131.4, BR.x1 - 0.15, 133.0, U - 1.1, U - 0.75, C['steel-dark'], {
      id: 'dp-crane-trolley',
    }),
    drawn(244.97, 132.15, 245.03, 132.25, 1.9, U - 1.1, C.dark, { id: 'dp-crane-chain' }),
    drawn(244.8, 132.0, 245.2, 132.4, 1.6, 1.9, C.hazard, { id: 'dp-crane-hook' }),
    // the operator's pendant box hung on the bridge's rail end
    drawn(BR.x1 + 0.02, 126.4, BR.x1 + 0.14, 126.7, 1.5, 1.8, C.hazard, {
      id: 'dp-crane-pendant',
    }),
    drawn(BR.x1 + 0.07, 126.53, BR.x1 + 0.09, 126.57, 1.8, U - 0.3, C.dark, {
      id: 'dp-crane-pendant-cable',
    }),
    // What was being lifted when work stopped: the depot's showpiece, on the open bridge.
    spot('dp-crane-showpiece', 245, U, 133.4, 'mill-showpiece', 0.12),
    // the yard office on the mezzanine: windows over the floor, a door at the stair head
    // and one north onto the mezzanine
    wZ(
      'dp-office-wall-w',
      OF.x0,
      OF.z0,
      DP.z1 - 0.2,
      U,
      5.8,
      C['office-siding'],
      [{ at: 134.6, width: 1.6, bottom: 0.9, top: 2.0, glass: C.glass }, door(138.2, 1.0)],
      0.15,
    ),
    wX(
      'dp-office-wall-n',
      OF.x0,
      DP.x1 - 0.2,
      OF.z0,
      U,
      5.8,
      C['office-siding'],
      [door(260.2, 1.0)],
      0.15,
    ),
    { ...doorZ('dp-door-office-w', OF.x0, 138.2, U, 1.0) },
    { ...doorX('dp-door-office-n', 260.2, OF.z0, U, 1.0) },
    at('desk', 260.6, 136.3, U, { id: 'dp-office-desk', yaw: -90 }),
    at('office-chair', 259.9, 136.3, U, { id: 'dp-office-chair', yaw: 90 }),
    at('filing-cabinet', 261.4, 139.3, U, { id: 'dp-office-cabinet', yaw: -90 }),
    // the yard ledger and waybills on the desk
    spot('dp-office-desk-papers', 260.6, U + 0.75, 136.35, 'documents', 0.5),
    at('office-computer', 260.72, 135.88, U + 0.76, { id: 'dp-office-computer', yaw: -90 }),

    // ---- the parts cage under the mezzanine: bars west and south, a gate under the rail's
    // gap, the east door its other way in
    at('steel-bar-fence', 255.35, 125.85, 0, { id: 'dp-cage-bars-1', yaw: 90 }),
    at('steel-bar-fence', 255.35, 131.1, 0, { id: 'dp-cage-bars-2', yaw: 90 }),
    at('steel-bar-fence', 256.95, 133.25, 0, { id: 'dp-cage-bars-3' }),
    at('steel-bar-fence', 260.05, 133.25, 0, { id: 'dp-cage-bars-4' }),
    box(260.9, 128.8, DP.x1 - 0.2, 133.0, 0, 2.2, C['steel-dark'], { id: 'dp-shelving' }),
    at('tool-chest', 259.6, DP.z0 + 0.45, 0, { id: 'dp-cage-chest' }),
    at('metal-cabinet', 257.5, 132.85, 0, { id: 'dp-cage-cabinet', yaw: 180 }),
    at('steel-barrel', 256.3, 124.7, 0, { id: 'dp-drum-1' }),
    at('steel-barrel', 257.0, 125.1, 0, { id: 'dp-drum-2' }),
    spot('dp-cage-shelf', 260.4, 0, 130.6, 'depot-mechanic', 0.45),
    // the company's guns, locked in the cage: contested from both ends of the map
    at('weapon-crate', 258.2, 128.6, 0, { id: 'dp-cage-weapons' }),
    // a place within a place (the user's rule for top-tier loose loot)
    spot('dp-cage-legendary', 257.5, 1.5, 132.85, 'legendary-industrial', 0.05),

    // ---- the floor. Bay A: the skidder in for repair; bay B: the forklift and an engine on
    // its stand under the chain hoist (clear of the drop under the mezzanine's rail gap).
    at('skidder', 239.5, 130.4, 0, { id: 'dp-skidder', yaw: 180 }),
    at('forklift', 250.2, 133.4, 0, { id: 'dp-forklift', yaw: 80 }),
    box(251.6, 129.7, 253.4, 131.1, 0, 1.3, C.machine, { id: 'dp-engine' }),
    drawn(251.4, 129.5, 253.6, 131.3, 0, 0.5, C['steel-dark'], { id: 'dp-engine-stand' }),
    along([249, 0, 130.4], [252.5, 4.2, 130.4], 0.12, 0.12, C.hazard, { id: 'dp-hoist-leg-1' }),
    along([256, 0, 130.4], [252.5, 4.2, 130.4], 0.12, 0.12, C.hazard, { id: 'dp-hoist-leg-2' }),
    drawn(252.45, 130.35, 252.55, 130.45, 1.3, 4.2, C.dark, { id: 'dp-hoist-chain' }),
    // the bench along the south wall, its toolbox and whatever was left on it
    box(238, 139.1, 244, DP.z1 - 0.2, 0, 0.95, C.timber, { id: 'dp-bench' }),
    at('toolbox', 239.2, 139.45, 0.95, { id: 'dp-bench-toolbox', yaw: 180 }),
    spot('dp-bench-loose', 242.3, 0.95, 139.45, 'depot-mechanic', 0.4),
    // A crate stack by the bridge: a player's way up (floor, 1.2, 2.4, the bridge at 3.3).
    at('stock-crate', 246.2, 136.6, 0, { id: 'dp-crate-1' }),
    at('stock-crate', 246.2, 136.6, 1.2, { id: 'dp-crate-2' }),
    at('stock-crate', 247.5, 137.1, 0, { id: 'dp-crate-3', yaw: 10 }),
  ];

  // The tire shop: a lean-to on the shed's west wall, through the shed's west door. A wide
  // opening west (the tire bay), doors north and south. Its flat roof at 3.3 is a perch over
  // the west approach and the highway, up a ladder only (player-only), seen from both.
  const TS = { x0: 226, x1: DP.x0, z0: 126, z1: 138, top: 3.1 };
  const tireShop = [
    drawn(TS.x0 + 0.2, TS.z0 + 0.2, TS.x1, TS.z1 - 0.2, 0, 0.02, C['dark-concrete'], {
      id: 'ts-floor',
    }),
    wX('ts-wall-n', TS.x0, TS.x1, TS.z0 + 0.1, 0, TS.top, dCol, [door(229), win(230.9, 1.2)]),
    wX('ts-wall-s', TS.x0, TS.x1, TS.z1 - 0.1, 0, TS.top, dCol, [door(228), win(230.6, 1.2)]),
    wZ('ts-wall-w', TS.x0 + 0.1, TS.z0 + 0.2, TS.z1 - 0.2, 0, TS.top, dCol, [
      { at: 130, width: 3.0, bottom: 0, top: 2.7 },
      win(135.5, 1.2),
    ]),
    doorX('ts-door-n', 229, TS.z0 + 0.1, 0),
    doorX('ts-door-s', 228, TS.z1 - 0.1, 0),
    box(TS.x0, TS.z0, TS.x1, TS.z1, TS.top, 3.3, C.roof, { id: 'ts-roof' }),
    drawn(TS.x0 - 0.02, TS.z0 - 0.02, TS.x1, TS.z0 + 0.06, 3.3, 3.42, C['depot-dark'], {
      id: 'ts-roof-lip-n',
    }),
    drawn(TS.x0 - 0.02, TS.z0 - 0.02, TS.x0 + 0.06, TS.z1 + 0.02, 3.3, 3.42, C['depot-dark'], {
      id: 'ts-roof-lip-w',
    }),
    drawn(TS.x0 - 0.02, TS.z1 - 0.06, TS.x1, TS.z1 + 0.02, 3.3, 3.42, C['depot-dark'], {
      id: 'ts-roof-lip-s',
    }),
    {
      type: 'ladder',
      id: 'ts-ladder',
      pos: [226.9, 0, TS.z1],
      yaw: 0,
      height: 3.3,
      color: C.ladder,
    },
    drawn(TS.x0 - 0.3, 128.4, TS.x0, 131.6, 2.7, 3.05, C['depot-dark'], { id: 'ts-roll-up' }),
    lampX('ts-lamp-n', 229, TS.z0 - 0.12),
    lampZ('ts-lamp-w', TS.x0 - 0.12, 130, 2.85),
    // the tire changer, tires stood against the west wall, lube drums, the bench
    box(227, 127, 228, 128, 0, 1.0, C.machine, { id: 'ts-tire-changer' }),
    drawn(227.35, 127.35, 227.65, 127.65, 1.0, 1.6, C['steel-dark'], { id: 'ts-changer-post' }),
    // Standing on their treads (the prefab's origin is 0.4 m above the tread).
    at('truck-tire-1', 226.65, 133.4, 0.4, { id: 'dp-tire-1' }),
    at('truck-tire-1', 227.55, 133.4, 0.4, { id: 'dp-tire-2' }),
    at('truck-tire-1', 226.65, 136.8, 0.4, { id: 'dp-tire-3' }),
    at('steel-barrel', 231.3, 133.6, 0, { id: 'ts-drum-1' }),
    at('steel-barrel', 231.3, 134.4, 0, { id: 'ts-drum-2' }),
    at('steel-barrel', 230.6, 134.0, 0, { id: 'ts-drum-3' }),
    box(230.0, TS.z0 + 0.2, 231.8, 126.9, 0, 0.95, C.timber, { id: 'ts-bench' }),
    at('toolbox', 230.5, 126.55, 0.95, { id: 'ts-toolbox', yaw: 180 }),
    spot('ts-bench-loose', 231.35, 0.95, 126.55, 'depot-mechanic', 0.3),
    // someone's rounds on the roof perch, away from the ladder
    at('ammo-crate', 230.5, 128.0, 3.3, { id: 'ts-roof-ammo' }),
  ];
  const depot = group('Equipment depot', [...shed, group('Tire shop', tireShop)]);

  // ------------------------------------------------------------------ equipment yard
  // East of the fuel tanks, between the highway and the south bank: a palisade fence
  // (see-through) with a gate north off the highway, one east toward the east spawns and a
  // gap south onto the bank; open west to the tanks. Inside, staggered so no line runs the
  // yard: a second skidder, cable drums, an open-ended container (a tunnel with the yard's
  // tool chest in it), a sealed container, a lowboy with an excavator on it behind its
  // tractor, a skip and a flood light. Nothing in it is a step up onto a container or the
  // excavator, so the yard has no perch over the east spawn.
  const YD = { x0: 274, x1: 301.95, z0: 124.6, z1: 141.2 };
  const pal = (id, a, b, gaps, bay = 3.1) =>
    fenceRun(id, a, b, { panel: 'palisade-fence', broken: null, bay, gaps, y: groundAt });
  const LB = { x0: 276, x1: 285.2, z0: 136.6, z1: 139.1 };
  const yardNodes = [
    ...pal('yd-fence-n', [YD.x0, YD.z0], [YD.x1, YD.z0], [5, 6]),
    ...pal('yd-fence-e', [YD.x1, YD.z0], [YD.x1, YD.z1], [2], 3.32),
    ...pal('yd-fence-s', [YD.x0, YD.z1], [YD.x1, YD.z1], [1]),
    at('skidder', 279, 127, 0, {
      id: 'yd-skidder',
      yaw: 90,
      colors: { paint: '#7a8a3e', 'paint-dark': '#56622c' },
    }),
    at('cable-drum', 287, 126.8, 0, { id: 'yd-drum-1' }),
    at('cable-drum', 289.4, 128.6, 0, { id: 'yd-drum-2', yaw: 30 }),
    at('cable-drum', 294, 135.2, 0, { id: 'yd-drum-3', yaw: 90 }),
    at('steel-barrel-pallet-1', 276.8, 129.8, 0, { id: 'yd-drum-pallet' }),
    at('stock-crate', 276.6, 132.4, 0, { id: 'yd-crate', yaw: 15 }),
    // the parts container, open at both ends: a tunnel across the yard with the chest in it
    at('shipping-container-open-no-doors', 284.5, 132.5, 0, {
      id: 'yd-container-open',
      yaw: 90,
      colors: {
        'shipping-container-red-dark': '#2f5e7a',
        'shipping-container-red-shade': '#24485e',
      },
    }),
    at('tool-chest', 283.8, 131.47, 0.2, { id: 'yd-container-chest' }),
    spot('yd-container-loose', 286.5, 0.2, 133.2, 'depot-mechanic', 0.4),
    at('shipping-container-sealed', 298, 129.5, 0, { id: 'yd-container-sealed' }),
    // the lowboy: a waist-high deck with the excavator on it, too tall to climb from the deck
    box(LB.x0, LB.z0, LB.x1, LB.z1, 0, 1.0, C['steel-dark'], { id: 'yd-lowboy' }),
    box(LB.x1, LB.z0 + 0.2, LB.x1 + 1.4, LB.z1 - 0.2, 0, 1.6, C['steel-dark'], {
      id: 'yd-lowboy-neck',
    }),
    box(277.0, LB.z0 + 0.05, 281.6, LB.z1 - 0.05, 1.0, 1.7, C.dark, { id: 'yd-excavator-tracks' }),
    box(277.0, LB.z0 + 0.05, 281.6, LB.z1 - 0.05, 1.7, 2.9, C.hazard, { id: 'yd-excavator' }),
    box(280.2, LB.z0 + 0.05, 281.6, 137.85, 2.9, 3.7, C.hazard, { id: 'yd-excavator-cab' }),
    drawn(281.6, LB.z0 + 0.15, 281.64, 137.75, 3.0, 3.6, C.glass, { id: 'yd-excavator-glass' }),
    along([281.0, 2.9, 138.5], [284.6, 4.4, 138.5], 0.45, 0.5, C.hazard, {
      id: 'yd-excavator-boom',
    }),
    // the stick, nearly upright: drawn, made solid by hidden boxes stacked along it
    ...brace('yd-excavator-stick', [284.6, 4.4, 138.5], [284.0, 1.8, 138.5], 0.35, 0.4, C.hazard),
    box(283.3, LB.z0 + 0.3, 284.7, LB.z1 - 0.3, 1.0, 1.8, C['steel-dark'], {
      id: 'yd-excavator-bucket',
    }),
    prefab('semi-tractor', 289.4, 137.85, { id: 'yd-tractor', yaw: 90 }, 0),
    at('skip-bin', 299.4, 138.2, 0, { id: 'yd-skip' }),
    at('flood-light', 275.0, 135.2, 0, { id: 'yd-flood-light' }),
  ];
  const equipYard = group('Equipment yard', yardNodes);

  // ------------------------------------------------------------------ fuel tanks
  // The two graybox tanks, now in a 0.9 m bund (gaps east and west so the AI can go
  // through between them), with ladders drawn up their sides, a pump at the depot side.
  const FT = { x: 268, zs: [128, 135], r: 2.2, h: 4 };
  const BU = { x0: 264.6, x1: 271.4, z0: 124.8, z1: 138.2, gz: 131.5 };
  const bund = (id, x0, z0, x1, z1) => box(x0, z0, x1, z1, -0.2, 0.9, C.concrete, { id });
  const fuel = group('Fuel tanks', [
    ...FT.zs.flatMap((z, k) => [
      {
        type: 'cylinder',
        id: `fuel-tank-${k + 1}`,
        pos: [FT.x, 0, z],
        radius: FT.r,
        height: FT.h,
        sides: 10,
        color: C.rust,
      },
      {
        type: 'cylinder',
        id: `fuel-tank-${k + 1}-top`,
        pos: [FT.x, FT.h, z],
        radius: FT.r,
        radiusTop: 0.4,
        height: 0.5,
        sides: 10,
        color: C.roof,
        collide: false,
      },
      drawn(FT.x + FT.r - 0.02, z - 0.25, FT.x + FT.r + 0.08, z + 0.25, 0.3, FT.h, C.metal, {
        id: `fuel-tank-${k + 1}-ladder`,
      }),
      drawn(FT.x - 0.6, z - FT.r - 0.03, FT.x + 0.6, z - FT.r + 0.02, 2.0, 2.6, C.hazard, {
        id: `fuel-tank-${k + 1}-sign`,
      }),
    ]),
    bund('fuel-bund-n', BU.x0, BU.z0, BU.x1, BU.z0 + 0.25),
    bund('fuel-bund-s', BU.x0, BU.z1 - 0.25, BU.x1, BU.z1),
    bund('fuel-bund-w1', BU.x0, BU.z0, BU.x0 + 0.25, BU.gz - 0.7),
    bund('fuel-bund-w2', BU.x0, BU.gz + 0.7, BU.x0 + 0.25, BU.z1),
    bund('fuel-bund-e1', BU.x1 - 0.25, BU.z0, BU.x1, BU.gz - 0.7),
    bund('fuel-bund-e2', BU.x1 - 0.25, BU.gz + 0.7, BU.x1, BU.z1),
    pipe([FT.x - FT.r, 0.5, 129.4], [263.6, 0.5, 129.4], 0.08, C.metal, {
      id: 'fuel-pipe-1',
      collide: false,
    }),
    pipe([FT.x - FT.r, 0.5, 133.6], [263.6, 0.5, 133.6], 0.08, C.metal, {
      id: 'fuel-pipe-2',
      collide: false,
    }),
    at('fuel-pump', 263.5, 135.8, 0, { id: 'fuel-pump', yaw: 90 }),
  ]);

  // ------------------------------------------------------------------ highway
  // Truck-3 is now a jackknifed fuel tanker: the trailer along the south lane, the tractor
  // swung across the center line. Roadworks by the east extract: a site office and culvert
  // pipes on the verges (eye-height cover), jersey barriers in a chicane, cones.
  const TK = { x0: 244.2, x1: 256.2, z: 119.8 };
  const tanker = group('Tanker', [
    box(TK.x0, TK.z - 1.0, TK.x1, TK.z + 1.0, 0.9, 1.15, C['steel-dark'], { id: 'tanker-frame' }),
    pipe([TK.x0 + 0.3, 2.3, TK.z], [TK.x1 - 0.5, 2.3, TK.z], 1.15, C.tanker, {
      id: 'tanker-tank',
      sides: 12,
    }),
    ...[0, 1].map((k) =>
      pipe(
        [TK.x0 + 3 + k * 5, 3.47, TK.z - 0.3],
        [TK.x0 + 3 + k * 5, 3.47, TK.z + 0.3],
        0.35,
        C.tanker,
        {
          id: `tanker-hatch-${k + 1}`,
          collide: false,
        },
      ),
    ),
    drawn(TK.x0 + 0.4, TK.z - 1.17, TK.x1 - 0.7, TK.z - 1.13, 2.1, 2.5, C.hazard, {
      id: 'tanker-stripe',
    }),
    box(TK.x0 + 0.2, TK.z - 0.95, TK.x1 - 3.0, TK.z + 0.95, 0, 0.9, '#5a8ab8', {
      id: 'tanker-blocker',
      invisible: true,
      // stops shots too since 2026-11-17: the wheels are drawn (as solids they cut into the
      // frame), so the underside as a whole is the cover they'd give; it stops short of the
      // tractor unit jackknifed under the trailer's front
      stopsShots: true,
    }),
    ...[TK.x0 + 1.0, TK.x0 + 2.3].flatMap((x, k) =>
      [-1, 1].map((sd) => ({
        type: 'cylinder',
        id: `tanker-wheel-${k + 1}${sd < 0 ? 'n' : 's'}`,
        pos: [r2(x), 0.5, r2(TK.z + sd * 0.95 - 0.25)],
        radius: 0.5,
        height: 0.5,
        sides: 10,
        pitch: 90,
        color: C.dark,
        collide: false,
      })),
    ),
    drawn(TK.x1 - 2.3, TK.z - 0.8, TK.x1 - 2.1, TK.z + 0.8, 0, 0.9, C['steel-dark'], {
      id: 'tanker-legs',
    }),
    prefab(
      'semi-tractor',
      257.3,
      119.3,
      { id: 'truck-3', yaw: 135, colors: { cab: '#d8d6d0', 'cab-dark': '#a8a6a0' } },
      0,
    ),
    drawn(246, 119.5, 256, 123.6, 0.04, 0.05, '#2a2a2a', { id: 'tanker-spill' }),
  ]);
  const culverts = (id, x, z) => {
    // five pipes lying across the verge (along z), three below and two above: 2.75 m
    const out = [];
    const R = 0.72;
    [
      [-1.5, 0],
      [0, 0],
      [1.5, 0],
      [-0.75, 1],
      [0.75, 1],
    ].forEach(([dx, row], k) => {
      const y = R + row * R * 1.75;
      // The top row nests between the bottom's pipes, so it's drawn, and one box over the
      // bottom row's tops collides for it (lying pipes collide as their bounds).
      out.push(
        pipe([x + dx, y, z - 1.2], [x + dx, y, z + 1.2], R, C.culvert, {
          id: `${id}-${k + 1}`,
          sides: 10,
          ...(row ? { collide: false } : {}),
        }),
      );
    });
    out.push(
      box(x - 1.5, z - 1.2, x + 1.5, z + 1.2, 2 * R, r2(R + R * 1.75 + R), C.culvert, {
        id: `${id}-top`,
        invisible: true,
      }),
    );
    return out;
  };
  // A road roller left in the closed north lane, a works van across the center line, and an
  // arrow board on its trailer in the chicane: each blocks a standing eye.
  const roller = (id, x, z) => [
    box(x - 1.0, z - 1.0, x + 2.2, z + 1.0, 0.5, 1.9, C.hazard, { id }),
    pipe([x - 1.8, 0.75, z - 1.0], [x - 1.8, 0.75, z + 1.0], 0.75, C.steel, {
      id: `${id}-drum`,
      sides: 10,
    }),
    pipe([x + 1.6, 0.6, z - 1.05], [x + 1.6, 0.6, z + 1.05], 0.6, C.dark, {
      id: `${id}-wheels`,
      sides: 10,
      collide: false,
    }),
    ...[
      [x + 0.1, z - 0.9],
      [x + 0.1, z + 0.85],
      [x + 2.0, z - 0.9],
      [x + 2.0, z + 0.85],
    ].map(([px, pz], k) =>
      drawn(px, pz, px + 0.05, pz + 0.05, 1.9, 2.8, C.dark, { id: `${id}-post-${k + 1}` }),
    ),
    box(x - 0.1, z - 1.05, x + 2.25, z + 1.05, 2.8, 2.9, C.hazard, { id: `${id}-canopy` }),
  ];
  const van = (id, x, z, yaw) =>
    group(
      'Works van',
      [
        box(-2.5, -1.0, 2.5, 1.0, 0.45, 2.45, C['paint-white'], { id }),
        drawn(1.6, -1.02, 2.52, 1.02, 1.4, 2.1, C.glass, { id: `${id}-windscreen` }),
        drawn(-2.52, -1.02, 2.52, 1.02, 1.1, 1.3, C.hazard, { id: `${id}-stripe` }),
        ...[-1.6, 1.6].flatMap((wx, k) =>
          [-1, 1].map((sd) => ({
            type: 'cylinder',
            id: `${id}-wheel-${k + 1}${sd < 0 ? 'n' : 's'}`,
            pos: [wx, 0.36, r2(sd * 0.95 - (sd > 0 ? 0.22 : 0))],
            radius: 0.36,
            height: 0.22,
            sides: 10,
            pitch: 90,
            color: C.dark,
            collide: false,
          })),
        ),
        drawn(-0.8, -0.7, 0.8, 0.7, 2.45, 2.55, C.metal, { id: `${id}-rack` }),
      ],
      { pos: [x, 0, z], yaw },
    );
  const AB = { x: 296.8, z: 118 };
  const arrowBoard = [
    box(AB.x - 0.9, AB.z - 0.7, AB.x + 0.9, AB.z + 0.7, 0.3, 0.75, C.hazard, {
      id: 'rw-arrow-trailer',
    }),
    box(AB.x - 0.08, AB.z - 1.2, AB.x + 0.08, AB.z + 1.2, 0.9, 2.6, C.dark, {
      id: 'rw-arrow-board',
    }),
    drawn(AB.x + 0.08, AB.z - 0.9, AB.x + 0.1, AB.z + 0.9, 1.4, 2.1, C.lamp, {
      id: 'rw-arrow-lamps',
    }),
  ];
  const roadworks = group('Roadworks', [
    ...roller('rw-roller', 270, 115.3),
    van('rw-van', 228.5, 117.9, 6),
    ...arrowBoard,
    at('portacabin', 216, 113.6, 0, { id: 'rw-site-office' }),
    // the crew's EMS bag on the ground at the site office's east end
    at('ems-bag', 220.0, 114.0, 0, { id: 'rw-ems-bag' }),
    ...culverts('rw-culverts-1', 297.5, 112.8),
    ...culverts('rw-culverts-2', 276, 121.9),
    at('jersey-barrier', 291, 116.1, 0, { id: 'rw-barrier-1', yaw: 90 }),
    at('jersey-barrier', 291.6, 118.9, 0, { id: 'rw-barrier-2', yaw: 70 }),
    at('jersey-barrier', 303, 119.8, 0, { id: 'rw-barrier-3', yaw: 90 }),
    at('jersey-barrier', 302.4, 117.0, 0, { id: 'rw-barrier-4', yaw: 110 }),
    ...[
      [286, 115.4],
      [287.5, 116.6],
      [289, 117.6],
      [306, 120.8],
      [307.5, 119.6],
    ].map(([x, z], k) => at('traffic-cone', x, z, 0, { id: `rw-cone-${k + 1}` })),
    at('car', 214.5, 123.2, 0, { id: 'rw-car', yaw: 84, colors: { paint: '#6a5a4a' } }),
  ]);

  // ------------------------------------------------------------------ the slope and fields
  // Tall piles set across the slope between the ridge trail and the yard at alternating
  // angles, copses each with something solid in it, and a fallen tree.
  const slope = group('East slope cover', [
    bedded('log-pile-tall', 220, 28.5, 3, 1.4, { id: 'slope-pile-1', yaw: 28 }),
    bedded('log-pile-tall', 249.5, 27.5, 3, 1.4, { id: 'slope-pile-2', yaw: -24 }),
    bedded('log-pile-tall', 268.5, 30.5, 3, 1.4, { id: 'slope-pile-3', yaw: 20 }),
    bedded('log-pile-tall', 288, 27.5, 3, 1.4, { id: 'slope-pile-4', yaw: -30 }),
    bedded('lumber-stack-tall', 307, 33.5, 2.6, 1.6, { id: 'slope-stack-1', yaw: 32 }),
    bedded('lumber-stack-tall', 232.5, 35.0, 2.6, 1.6, { id: 'slope-stack-2', yaw: -30 }),
    copse('Copse on the east slope (west)', [
      ['pine-tree', 212.5, 32.8],
      ['bush-tall', 214.6, 34.2],
      ['rock-large', 215.2, 31.8, 30],
    ]),
    copse('Copse on the east slope (middle)', [
      ['broadleaf-tree', 257.5, 29.3],
      ['pine-tree', 260.2, 31.2],
      ['bush-tall', 255.8, 31.4],
      ['tree-stump', 259.4, 28.2, 40],
      ['rock', 261.5, 29.6, -15],
    ]),
    copse('Copse on the east slope (east)', [
      ['broadleaf-tree', 296.4, 31.6],
      ['bush-tall', 298.6, 30.4],
      ['rock-large', 293.6, 29.4, -40],
    ]),
    pipe(
      [239, groundAt(239, 31) + 0.3, 31.2],
      [228.5, groundAt(228.5, 29.4) + 0.3, 29.4],
      0.3,
      C.log,
      {
        id: 'slope-fallen-tree',
        collide: true,
      },
    ),
  ]);
  // The field between the engine shed, the kilns and the bunkhouse.
  const field = group('East field cover', [
    on('rock-large', 247.5, 80.5, { id: 'field-rock-1', yaw: 20 }),
    bedded('log-pile-tall', 258.5, 85.6, 3, 1, { id: 'field-pile-1', yaw: -16 }),
    at('lumber-stack-tall', 278, 80, 0, { id: 'field-stack-1', yaw: 30 }),
    copse('Copse by the bunkhouse', [
      ['pine-tree', 266.5, 96.5],
      ['bush-tall', 268.2, 98.3],
      ['rock', 267.8, 95.2, 10],
    ]),
    bedded('log-pile-tall', 312.5, 66, 3, 1, { id: 'field-pile-2', yaw: 22 }),
    on('rock-large', 309.5, 101.5, { id: 'field-rock-2', yaw: -10 }),
  ]);

  return group('East end', [
    group('Rail yard', [...yard, loadingTower]),
    group('Engine shed leads', leads),
    group('Rail tunnel', [
      box(316, 38.5, 324, 40.5, -0.3, 8, C.concrete, { id: 'portal-n' }),
      box(316, 54.5, 324, 56.5, -0.3, 8, C.concrete, { id: 'portal-s' }),
      box(316, 40.5, 324, 54.5, 6.5, 8, C.concrete, { id: 'portal-top' }),
      box(323, 40.5, 324, 54.5, -0.3, 6.5, '#1e1e1e', { id: 'portal-dark' }),
      // Dressed 2026-11-17: stone facing on the portal's face with courses, a keystone and
      // the date stone, a lamp; the signal north of track 1 and the line-side phone by it
      // (a quest spot).
      drawn(315.85, 38.4, 316, 40.6, -0.3, 8.1, C.stone, { id: 'portal-face-n' }),
      drawn(315.85, 54.4, 316, 56.6, -0.3, 8.1, C.stone, { id: 'portal-face-s' }),
      drawn(315.85, 40.6, 316, 54.4, 6.1, 8.1, C.stone, { id: 'portal-face-top' }),
      ...[2.0, 4.0, 6.0].flatMap((y, k) => [
        drawn(315.82, 38.4, 315.85, 40.6, y, y + 0.05, C['dark-concrete'], {
          id: `portal-course-n${k + 1}`,
        }),
        drawn(315.82, 54.4, 315.85, 56.6, y, y + 0.05, C['dark-concrete'], {
          id: `portal-course-s${k + 1}`,
        }),
      ]),
      drawn(315.8, 46.9, 315.85, 48.1, 5.9, 7.0, C.concrete, { id: 'portal-keystone' }),
      drawn(315.8, 45.5, 315.84, 49.5, 7.25, 7.8, C.concrete, { id: 'portal-date-stone' }),
      lampZ('portal-lamp', 315.72, 41.2, 5.6),
      box(313.32, 39.42, 313.48, 39.58, 0, 4.5, C.steel, { id: 'signal-mast' }),
      drawn(313.0, 39.1, 313.8, 39.9, 0, 0.25, C.concrete, { id: 'signal-base' }),
      drawn(313.1, 39.3, 313.28, 39.7, 3.5, 4.4, C.dark, { id: 'signal-head' }),
      drawn(313.07, 39.42, 313.1, 39.58, 4.05, 4.25, C['paint-red'], { id: 'signal-lamp-r' }),
      drawn(313.07, 39.42, 313.1, 39.58, 3.65, 3.85, '#3e8a4a', { id: 'signal-lamp-g' }),
      box(311.4, 39.6, 311.5, 39.7, 0, 1.05, C.steel, { id: 'phone-post' }),
      box(311.2, 39.45, 311.7, 39.85, 1.05, 1.75, C['siding-green'], { id: 'phone-box' }),
      drawn(311.25, 39.85, 311.65, 39.88, 1.4, 1.6, C.dark, { id: 'phone-box-handset' }),
    ]),
    group('Engine shed', [
      ...shedNodes,
      group('Loco shop', shop),
      group('Oil house', oilHouse),
      group('Fuel and sand stand', stand),
      group('Shed yard', shedYard),
    ]),
    group('Water tower and pump house', [waterTower, towerDetails, pumpHouse]),
    bunkhouse,
    cookhouse,
    group('Camp yard', camp),
    depot,
    fuel,
    equipYard,
    tanker,
    roadworks,
    slope,
    field,
  ]);
}
