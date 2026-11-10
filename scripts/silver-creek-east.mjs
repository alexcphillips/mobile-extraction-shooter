// Silver Creek's east end (roadmap MT-8, 2026-11-10), used by gen-silver-creek.mjs: the rail
// yard with its freight dock and chip loading tower, the leads into the engine shed (its pit,
// a switcher and a tool room), the water tower and pump house, the bunkhouse and cookhouse,
// the equipment depot with its mezzanine office, the fuel tanks in their bund, a jackknifed
// tanker on the highway (truck-3), roadworks by the east extract, and cover across the slope
// and the yard.
//
// Claude's calls, easy to change; the reasons are in docs/design/raids-and-maps.md → Silver
// Creek (the east end). World coordinates throughout: x east, z south, y up. The valley floor
// here is flat at y 0; the ridge slope rises north of z 36.

import { buildingKit } from './silver-creek-kit.mjs';

/**
 * h: the generator's helpers (box, drawn, group, prefab, along, label, C, r2, groundAt,
 * groundRange). s: the site (tower {x, z}, PIT {x0, x1, z0, z1}).
 */
export function buildEastEnd(h, s) {
  const { box, drawn, group, prefab, along, C, r2, groundAt, groundRange } = h;
  const { tower, PIT } = s;
  Object.assign(C, {
    'shed-brick': '#7e4436',
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
  const { wX, wZ, door, win, doorX, doorZ, roof, shell, porch } = buildingKit(h);
  /** A prefab at y (default the valley floor). */
  const at = (name, x, z, y = 0, extra = {}) => prefab(name, x, z, extra, y);
  /** A prefab standing on the terrain (its middle's ground). */
  const on = (name, x, z, extra = {}) => prefab(name, x, z, extra, r2(groundAt(x, z)));
  /** A prefab on the lowest ground under a footprint (a pile on a slope beds in uphill). */
  const bedded = (name, x, z, hw, hd, extra = {}) =>
    prefab(name, x, z, extra, r2(groundRange(x - hw, z - hd, x + hw, z + hd)[0]));
  /** A cylinder from a to b ([x, y, z]), lying along that line. */
  const pipe = (a, b, radius, colour, extra = {}) => {
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
      colour,
      ...extra,
    };
  };
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
    car('boxcar', 226.5, T1, 'boxcar-2', { colours: { body: '#6e4a32', 'body-dark': '#553826' } }),
    car('boxcar', 292.5, T1, 'boxcar-3', { colours: { body: '#5a5f4a', 'body-dark': '#454a39' } }),
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
  // Tie stacks along the lane between the tracks (it ran 124 m clear in the greybox).
  const LANE_N = T1 + 1.6 + 0.9 + 0.1; // a stack against the lane's north edge
  const LANE_S = T2 - 1.6 - 0.9 - 0.1;
  yard.push(
    ...tieStack('tie-stack-1', 216, LANE_N),
    ...tieStack('tie-stack-2', 240, LANE_S),
    ...tieStack('tie-stack-3', 253.5, LANE_N),
    ...tieStack('tie-stack-4', 280, LANE_S),
    ...tieStack('tie-stack-5', 300, LANE_N),
    ...tieStack('tie-stack-7', 207, LANE_S),
  );
  // A caboose against track 2's buffer, short of the first switch (x 208).
  const CB = { x0: 196.6, x1: 205.6, z: T2 };
  yard.push(
    group('Caboose', [
      box(CB.x0 + 0.9, CB.z - 1.45, CB.x1 - 0.9, CB.z + 1.45, 1.1, 3.9, C['siding-red'], {
        id: 'caboose',
      }),
      box(CB.x0 + 0.7, CB.z - 1.6, CB.x1 - 0.7, CB.z + 1.6, 3.9, 4.05, C.roof, {
        id: 'caboose-roof',
      }),
      box(200.3, CB.z - 1.2, 202.2, CB.z + 1.2, 4.05, 5.0, C['siding-red'], {
        id: 'caboose-cupola',
      }),
      drawn(200.2, CB.z - 1.3, 202.3, CB.z + 1.3, 5.0, 5.1, C.roof, { id: 'caboose-cupola-roof' }),
      box(CB.x0, CB.z - 1.5, CB.x1, CB.z + 1.5, 0.95, 1.1, C.dark, { id: 'caboose-deck' }),
      ...[-1, 1].flatMap((sd) => [
        drawn(198.6, CB.z + sd * 1.46 - 0.02, 199.6, CB.z + sd * 1.46 + 0.02, 2.2, 3.0, C.glass, {
          id: `caboose-window-${sd < 0 ? 'n' : 's'}1`,
        }),
        drawn(202.8, CB.z + sd * 1.46 - 0.02, 203.8, CB.z + sd * 1.46 + 0.02, 2.2, 3.0, C.glass, {
          id: `caboose-window-${sd < 0 ? 'n' : 's'}2`,
        }),
        drawn(200.6, CB.z + sd * 1.21 - 0.02, 201.9, CB.z + sd * 1.21 + 0.02, 4.3, 4.8, C.glass, {
          id: `caboose-cupola-window-${sd < 0 ? 'n' : 's'}`,
        }),
      ]),
      ...[CB.x0 + 0.05, CB.x1 - 0.1].map((x, k) =>
        drawn(x, CB.z - 1.5, x + 0.05, CB.z + 1.5, 1.1, 2.1, C.trim, {
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
      colour: C.concrete,
    },
    {
      type: 'stairs',
      id: 'dock-steps',
      pos: [DK.x1 + 0.8, 0, r2((DK.z0 + DK.z1) / 2)],
      yaw: -90,
      size: [2.0, DK.y, 1.6],
      colour: C.concrete,
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
  ];
  yard.push(group('Freight dock', dock));

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
      colour: C.dark,
    })),
  ];
  yard.push(
    at('shed', 214, 38.6, 0, { id: 'section-house', colours: { siding: C['siding-tan'] } }),
    box(220.5, 39.2, 226.5, 40.4, 0, 0.75, C['timber-dark'], { id: 'rail-rack' }),
    ...[0, 1, 2, 3].map((k) =>
      drawn(220.6, 39.3 + k * 0.28, 226.4, 39.38 + k * 0.28, 0.75, 0.9, C.rail, {
        id: `rail-rack-rail-${k + 1}`,
      }),
    ),
    at('shed-small', 301, 36.6, 0, {
      id: 'speeder-shed',
      colours: { siding: C['siding-red'], 'siding-dark': '#6e3a2e' },
    }),
    box(287, 38.6, 291.5, 40.6, 0, 0.8, C['tie-stack'], { id: 'old-ties' }),
    ...wheelSet('wheel-set-1', 229, 55.2),
    ...wheelSet('wheel-set-2', 230.6, 55.6),
    at('lumber-stack-tall', 249, 55.4, 0, { id: 'strip-stack-1', yaw: 28 }),
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
  // A brick shed with two roads in through big doorways at the west; road 2 runs on out of
  // the east end. Road 1 has the inspection pit (1.4 m deep, steps at both ends, so the AI
  // walks it; a player can climb out anywhere), road 2 the switcher. A tool room in the
  // north-east corner; doors in all four walls.
  const ES = { x0: 248, x1: 276, z0: 58, z1: 72, top: 6 };
  const esCol = C['shed-brick'];
  const bigDoor = (atZ) => ({ at: atZ, width: 4.2, bottom: 0, top: 5 });
  const hi = (atX, width = 1.4) => win(atX, width, { bottom: 1.2, top: 2.6 });
  const esRoof = roof('es-roof', ES.x0, ES.x1, ES.z0, ES.z1, ES.top, 22, {
    roof: C.roof,
    gable: esCol,
  });
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
    wZ('es-wall-w', ES.x0 + 0.15, ES.z0, ES.z1, 0, ES.top, esCol, [bigDoor(R1), bigDoor(R2)], 0.3),
    wZ(
      'es-wall-e',
      ES.x1 - 0.15,
      ES.z0,
      ES.z1,
      0,
      ES.top,
      esCol,
      [bigDoor(R2), door(59.6), hi(64.6)],
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
    wX(
      'es-wall-s',
      ES.x0 + 0.3,
      ES.x1 - 0.3,
      ES.z1 - 0.15,
      0,
      ES.top,
      esCol,
      [hi(251), door(257), hi(261), hi(265), hi(269), hi(273)],
      0.3,
    ),
    doorX('es-door-n', 262, ES.z0 + 0.15, 0),
    doorX('es-door-s', 257, ES.z1 - 0.15, 0),
    doorZ('es-door-e', ES.x1 - 0.15, 59.6, 0),
    ...esRoof.nodes,
    drawn(250, 64.6, 274, 65.4, esRoof.ridge - 0.1, esRoof.ridge + 0.5, C.roof, {
      id: 'es-ridge-vent',
    }),
    // the two roads' rails in the floor; road 1's run along the pit's edges
    ...floorRails('es-road-1-rail', ES.x0, 275, R1),
    ...floorRails('es-road-2-rail', ES.x0, ES.x1, R2),
    ...bufferStop('es-road-1-buffer', 274.9, R1),
    // the pit: walls, floor, steps at both ends, lamps in its walls
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
      colour: C.concrete,
    },
    {
      type: 'stairs',
      id: 'es-pit-steps-e',
      pos: [PIT.x1 - 0.85, -1.4, R1],
      yaw: 90,
      size: [1.2, 1.4, 1.7],
      colour: C.concrete,
    },
    ...[256.5, 261, 265.5].map((x, k) =>
      drawn(x - 0.2, PIT.z0 + 0.39, x + 0.2, PIT.z0 + 0.42, -0.7, -0.5, C.lamp, {
        id: `es-pit-lamp-${k + 1}`,
      }),
    ),
    drawn(258, PIT.z0 + 0.45, 263, PIT.z1 - 0.45, -1.4, -1.39, C.dark, { id: 'es-pit-oil' }),
    // the switcher on road 2, its wheels on the floor's rails; a wheel set beyond it
    at('switcher-loco', 260, R2, -0.25, { id: 'es-switcher' }),
    ...wheelSet('es-wheel-set', 271, R2),
    // tool room in the north-east corner: a door from the floor and one out of the east wall
    wX('es-tool-wall-s', 271.5, ES.x1 - 0.3, 61.0, 0, 3.0, C.plaster, [door(273.6)], 0.15),
    wZ('es-tool-wall-w', 271.5, ES.z0 + 0.3, 61.0, 0, 3.0, C.plaster, [win(59.7, 1.0)], 0.15),
    box(271.4, ES.z0 + 0.3, ES.x1 - 0.3, 61.08, 3.0, 3.15, C.plaster, { id: 'es-tool-ceiling' }),
    doorX('es-door-tool', 273.6, 61.0, 0),
    at('desk', 271.95, 59.5, 0, { id: 'es-tool-desk', yaw: 90 }),
    at('filing-cabinet', 274.75, 58.6, 0, { id: 'es-tool-cabinet', yaw: 180 }),
    // workbench, tool cabinet and parts rack along the north wall; a compressor on the
    // walkway between the roads; drums and a sand bin by the south wall
    box(249.2, ES.z0 + 0.3, 255.2, 59.1, 0, 0.95, C.timber, { id: 'es-bench' }),
    drawn(250.2, 58.5, 250.6, 58.9, 0.95, 1.2, C.steel, { id: 'es-vice' }),
    box(256.2, ES.z0 + 0.3, 257.2, 58.8, 0, 1.8, C['paint-red'], { id: 'es-tool-cabinet-tall' }),
    at('warehouse-rack', 267, 58.9, 0, { id: 'es-parts-rack' }),
    box(261.4, 64.25, 262.6, 65.15, 0, 1.7, C.steel, { id: 'es-compressor' }),
    at('steel-barrel', 249.2, 70.9, 0, { id: 'es-drum-1' }),
    at('steel-barrel', 249.9, 71.2, 0, { id: 'es-drum-2' }),
    at('hazard-barrel', 249.4, 70.2, 0, { id: 'es-drum-3' }),
    box(268.5, 70.4, 270, 71.55, 0, 1.1, C['timber-dark'], { id: 'es-sand-bin' }),
  ];

  // ------------------------------------------------------------------ water tower
  // The greybox tower, perch and pump house (MT-3), dressed: rails on the platform's north,
  // east and south (a gap at the ladder; the west edge stays open over the pump house),
  // bracing, bands and a catwalk on the tank, a water column by road 2, and the pump house
  // made a room you can go in (its roof is still the step down from the platform).
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
          tx + dx - 0.25,
          tz + dz - 0.25,
          tx + dx + 0.25,
          tz + dz + 0.25,
          towerY - 0.3,
          TW.legs,
          C.metal,
          {
            id: `tower-leg-${k + 1}`,
          },
        ),
      ),
      ...bracing,
      {
        type: 'cylinder',
        id: 'tower-riser',
        pos: [tx, r2(towerY - 0.3), tz],
        radius: 0.6,
        height: r2(TW.legs - towerY + 0.3),
        sides: 8,
        colour: C.metal,
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
        colour: C.metal,
        collide: false,
      },
      {
        type: 'cylinder',
        id: 'tower-tank',
        pos: [tx, TW.legs, tz],
        radius: 3.6,
        height: 5,
        sides: 12,
        colour: C.rust,
      },
      ...[1.2, 2.5, 3.8].map((y, k) => ({
        type: 'cylinder',
        id: `tower-band-${k + 1}`,
        pos: [tx, TW.legs + y, tz],
        radius: 3.66,
        height: 0.14,
        sides: 12,
        colour: C['timber-dark'],
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
        colour: C.roof,
      },
      {
        type: 'cylinder',
        id: 'tower-finial',
        pos: [tx, TW.legs + 6.9, tz],
        radius: 0.12,
        height: 0.7,
        sides: 6,
        colour: C.metal,
        collide: false,
      },
      {
        type: 'ladder',
        id: 'tower-ladder',
        pos: [tx, r2(towerY), tz + 3],
        yaw: 0,
        height: r2(TW.platform - towerY),
        colour: C.ladder,
      },
      // pump house: a door west, windows north and south, the pump and its pipe to the riser
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
      box(tx - 4.6, tz - 1.6, tx - 3.3, tz - 0.6, 0, 1.0, C.machine, { id: 'pump-house-pump' }),
      drawn(tx - 3.3, tz - 1.25, tx - 0.6, tz - 0.95, 0.6, 0.9, C.metal, { id: 'pump-house-pipe' }),
      // the water column by road 2: a standpipe and its arm swung over the track
      {
        type: 'cylinder',
        id: 'water-column',
        pos: [tx - 10.8, 0, tz - 2],
        radius: 0.25,
        height: 3.6,
        sides: 8,
        colour: C.metal,
      },
      along([tx - 10.8, 3.4, tz - 2], [tx - 10.8, 3.3, R2 - 0.2], 0.22, 0.22, C.metal, {
        id: 'water-column-arm',
      }),
      drawn(tx - 10.95, R2 - 0.35, tx - 10.65, R2 - 0.05, 2.3, 3.2, C['steel-dark'], {
        id: 'water-column-spout',
      }),
    ],
    { landmark: true },
  );

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
      colour: C.timber,
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
      colour: C.timber,
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
    along([277, 8.6, 36.1], [277, 5.4, T1 - 0.4], 0.8, 0.5, C.metal, { id: 'lt-chute' }),
    along([277, 10.2, 35.6], [277, 6.0, T1 - 0.6], 0.04, 0.04, C.dark, { id: 'lt-chute-cable' }),
    // bracing on the ground storey, drawn
    along(
      [LT.x0 + 0.15, 0.2, LT.z0 + 0.2],
      [LT.x0 + 0.15, LT.d1 - 0.3, 38.7],
      0.08,
      0.12,
      C['timber-dark'],
      {
        id: 'lt-brace-w',
      },
    ),
    along(
      [LT.x1 - 0.15, 0.2, 38.7],
      [LT.x1 - 0.15, LT.d1 - 0.3, LT.z0 + 0.2],
      0.08,
      0.12,
      C['timber-dark'],
      {
        id: 'lt-brace-e',
      },
    ),
    along(
      [LT.x0 + 0.2, 0.2, LT.z0 + 0.15],
      [LT.x1 - 0.2, LT.d1 - 0.3, LT.z0 + 0.15],
      0.08,
      0.12,
      C['timber-dark'],
      {
        id: 'lt-brace-n',
      },
    ),
  ]);

  // ------------------------------------------------------------------ bunkhouse
  // One storey, its front (porch) facing north to the yard, its back to the cookhouse. Two
  // dorms laid out differently either side of a common room that goes front to back; the
  // east wing has the washroom. Built in its own frame, front on +z, turned 180°: local
  // west (−x) is world east. Doors: each gable, front and back of the common room, and
  // between the rooms, so every room has two ways in.
  const FL = 0.35;
  const bunk = (id, x, z, alongX) => {
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
      colour: col,
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
      box(1.9, -0.4, 2.6, 0.3, FL, FL + 1.0, C.dark, { id: `${id}-stove` }),
      drawn(2.15, -0.15, 2.35, 0.05, FL + 1.0, sh.top, C.dark, { id: `${id}-flue` }),
      box(2.0, -0.35, 2.5, 0.25, sh.top, rf.ridge + 0.4, C.stone, { id: `${id}-chimney` }),
      at('couch', 1.4, -3.75, FL, { id: `${id}-couch` }),
      at('notice-board', -3.5, 2.6, FL, { id: `${id}-notice`, yaw: 90 }),
      // east dorm: bunks along the front wall, two heads to the back, a table between
      ...bunk(`${id}-bunk-6`, 5.0, 3.8, true),
      ...bunk(`${id}-bunk-7`, 8.4, 3.8, true),
      ...bunk(`${id}-bunk-8`, 4.5, -3.3, false),
      ...bunk(`${id}-bunk-9`, 6.6, -3.3, false),
      at('table-and-chairs', 6.2, 0.6, FL, { id: `${id}-table-e`, yaw: 90 }),
      at('wardrobe', 10.45, 0.3, FL, { id: `${id}-wardrobe`, yaw: -90 }),
      // washroom
      at('sink-counter', 9.3, -4.0, FL, { id: `${id}-sinks` }),
      at('toilet', 10.4, -1.3, FL, { id: `${id}-toilet`, yaw: -90 }),
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
      colour: col,
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
  // A steel shed with two bays onto the depot lane (bay A open, bay B's shutter jammed
  // 1.3 m up: a crouch-only way in), doors in every wall, and a mezzanine at 3.3 m along
  // the east end with the yard office on it: stairs up from the floor (the AI follows), a
  // gap in its rail to drop through, and windows over the floor and out to the fuel tanks.
  const DP = { x0: 232, x1: 262, z0: 124, z1: 140, top: 6.5, mz: 255.5, my: 3.3 };
  const dCol = C.depot;
  const dpRoof = roof('dp-roof', DP.x0, DP.x1, DP.z0, DP.z1, DP.top, 8, {
    roof: C.roof,
    gable: dCol,
  });
  const highWin = (a, w = 1.6) => win(a, w, { bottom: 1.5, top: 2.5 });
  const upWin = (a, w = 1.4) => win(a, w, { bottom: 4.2, top: 5.3 });
  const OF = { x0: 257.5, z0: 132.5 };
  const depot = group('Equipment depot', [
    drawn(DP.x0 + 0.2, DP.z0 + 0.2, DP.x1 - 0.2, DP.z1 - 0.2, 0, 0.02, C['dark-concrete'], {
      id: 'dp-floor',
    }),
    wX('dp-wall-n', DP.x0, DP.x1, DP.z0 + 0.1, 0, DP.top, dCol, [
      highWin(235),
      { at: 240, width: 5, bottom: 0, top: 4.6 },
      door(246.5),
      highWin(249.5, 1.2),
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
    // the mezzanine and its posts, stairs along the south wall, rails with a gap
    box(DP.mz, DP.z0 + 0.2, DP.x1 - 0.2, DP.z1 - 0.2, DP.my - 0.2, DP.my, C.steel, {
      id: 'dp-mezz',
    }),
    ...[128, 132, 136].map((z, k) =>
      box(DP.mz + 0.05, z - 0.1, DP.mz + 0.25, z + 0.1, 0, DP.my - 0.2, C['steel-dark'], {
        id: `dp-mezz-post-${k + 1}`,
      }),
    ),
    {
      type: 'stairs',
      id: 'dp-stairs',
      pos: [DP.mz - 2.5, 0, 138.75],
      yaw: 90,
      size: [1.1, DP.my, 5.0],
      colour: C.steel,
      sides: 1.0,
    },
    box(DP.mz, DP.z0 + 0.2, DP.mz + 0.08, 129, DP.my, DP.my + 1.0, C.hazard, {
      id: 'dp-mezz-rail-1',
    }),
    box(DP.mz, 130.6, DP.mz + 0.08, 138.1, DP.my, DP.my + 1.0, C.hazard, { id: 'dp-mezz-rail-2' }),
    // the yard office on the mezzanine: windows over the floor, a door at the stair head
    // and one north onto the mezzanine
    wZ(
      'dp-office-wall-w',
      OF.x0,
      OF.z0,
      DP.z1 - 0.2,
      DP.my,
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
      DP.my,
      5.8,
      C['office-siding'],
      [door(260.2, 1.0)],
      0.15,
    ),
    { ...doorZ('dp-door-office-w', OF.x0, 138.2, DP.my, 1.0) },
    { ...doorX('dp-door-office-n', 260.2, OF.z0, DP.my, 1.0) },
    at('desk', 260.6, 136.3, DP.my, { id: 'dp-office-desk', yaw: -90 }),
    at('office-chair', 259.9, 136.3, DP.my, { id: 'dp-office-chair', yaw: 90 }),
    at('filing-cabinet', 261.4, 139.3, DP.my, { id: 'dp-office-cabinet', yaw: -90 }),
    at('filing-cabinet', 258.2, 133.0, DP.my, { id: 'dp-office-cabinet-2' }),
    // bay A: the skidder in for repair; bay B: a forklift and an engine on a stand
    at('skidder', 239.5, 130.4, 0, { id: 'dp-skidder', yaw: 180 }),
    at('forklift', 250.2, 133.2, 0, { id: 'dp-forklift', yaw: 80 }),
    box(251.6, 127.6, 253.4, 129.0, 0, 1.3, C.machine, { id: 'dp-engine' }),
    drawn(251.4, 127.4, 253.6, 129.2, 0, 0.5, C['steel-dark'], { id: 'dp-engine-stand' }),
    // chain hoist over bay B, drawn
    along([249, 0, 128.3], [252.5, 4.2, 128.3], 0.12, 0.12, C.hazard, { id: 'dp-hoist-leg-1' }),
    along([256, 0, 128.3], [252.5, 4.2, 128.3], 0.12, 0.12, C.hazard, { id: 'dp-hoist-leg-2' }),
    drawn(252.45, 128.25, 252.55, 128.35, 1.3, 4.2, C.dark, { id: 'dp-hoist-chain' }),
    // along the walls: workbench, parts shelving under the mezzanine, tyres, crates
    box(238, 139.1, 244, DP.z1 - 0.2, 0, 0.95, C.timber, { id: 'dp-bench' }),
    box(260.9, 128.8, DP.x1 - 0.2, 133.0, 0, 2.2, C['steel-dark'], { id: 'dp-shelving' }),
    at('truck-tire-1', 233.4, 138.4, 0, { id: 'dp-tyre-1' }),
    at('truck-tire-1', 233.4, 138.4, 0.8, { id: 'dp-tyre-2' }),
    at('truck-tire-1', 233.6, 136.7, 0, { id: 'dp-tyre-3' }),
    at('stock-crate', 246.2, 136.6, 0, { id: 'dp-crate-1' }),
    at('stock-crate', 246.2, 136.6, 1.2, { id: 'dp-crate-2' }),
    at('stock-crate', 247.5, 137.1, 0, { id: 'dp-crate-3', yaw: 10 }),
    at('steel-barrel', 257.0, 125.0, 0, { id: 'dp-drum-1' }),
    at('steel-barrel', 257.7, 125.4, 0, { id: 'dp-drum-2' }),
  ]);

  // ------------------------------------------------------------------ fuel tanks
  // The two greybox tanks, now in a 0.9 m bund (gaps east and west so the AI can go
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
        colour: C.rust,
      },
      {
        type: 'cylinder',
        id: `fuel-tank-${k + 1}-top`,
        pos: [FT.x, FT.h, z],
        radius: FT.r,
        radiusTop: 0.4,
        height: 0.5,
        sides: 10,
        colour: C.roof,
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
  // swung across the centre line. Roadworks by the east extract: a site office and culvert
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
    box(TK.x0 + 0.2, TK.z - 0.95, TK.x1 - 0.4, TK.z + 0.95, 0, 0.9, '#5a8ab8', {
      id: 'tanker-blocker',
      invisible: true,
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
        colour: C.dark,
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
      { id: 'truck-3', yaw: 135, colours: { cab: '#d8d6d0', 'cab-dark': '#a8a6a0' } },
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
      out.push(
        pipe([x + dx, y, z - 1.2], [x + dx, y, z + 1.2], R, C.culvert, {
          id: `${id}-${k + 1}`,
          sides: 10,
        }),
      );
    });
    return out;
  };
  // A road roller left in the closed north lane, a works van across the centre line, and an
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
            colour: C.dark,
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
    at('car', 214.5, 123.2, 0, { id: 'rw-car', yaw: 84, colours: { paint: '#6a5a4a' } }),
  ]);

  // ------------------------------------------------------------------ the slope and fields
  // Tall piles set across the slope between the ridge trail and the yard at alternating
  // angles, copses each with something solid in it, and a fallen tree.
  const slope = group('East slope cover', [
    bedded('log-pile-tall', 220, 28.5, 3, 1.4, { id: 'slope-pile-1', yaw: 28 }),
    bedded('log-pile-tall', 245, 26.5, 3, 1.4, { id: 'slope-pile-2', yaw: -24 }),
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
      ['rock-large', 294.6, 30.2, -40],
    ]),
    pipe(
      [239, groundAt(239, 31) + 0.3, 31.2],
      [228.5, groundAt(228.5, 29.4) + 0.3, 29.4],
      0.3,
      C.log,
      {
        id: 'slope-fallen-tree',
        collide: false,
      },
    ),
  ]);
  // The field between the engine shed, the kilns and the bunkhouse.
  const field = group('East field cover', [
    on('rock-large', 247.5, 80.5, { id: 'field-rock-1', yaw: 20 }),
    bedded('log-pile-tall', 262, 84, 3, 1, { id: 'field-pile-1', yaw: -26 }),
    at('lumber-stack-tall', 278, 80, 0, { id: 'field-stack-1', yaw: 30 }),
    copse('Copse by the bunkhouse', [
      ['pine-tree', 266.5, 96.5],
      ['bush-tall', 268.2, 98.3],
      ['rock', 267.8, 95.2, 10],
    ]),
    bedded('log-pile-tall', 309, 66, 3, 1, { id: 'field-pile-2', yaw: 22 }),
    on('rock-large', 309.5, 101.5, { id: 'field-rock-2', yaw: -10 }),
  ]);

  return group('East end', [
    group('Rail yard', [...yard, loadingTower]),
    group('Engine shed leads', leads),
    group('Rail tunnel', [
      box(316, 38.5, 324, 40.5, -0.3, 8, C.concrete, { id: 'portal-n' }),
      box(316, 54.5, 324, 56.5, -0.3, 8, C.concrete, { id: 'portal-s' }),
      box(316, 38.5, 324, 56.5, 6.5, 8, C.concrete, { id: 'portal-top' }),
      box(323, 40.5, 324, 54.5, -0.3, 6.5, '#1e1e1e', { id: 'portal-dark' }),
    ]),
    group('Engine shed', shedNodes),
    waterTower,
    bunkhouse,
    cookhouse,
    group('Camp yard', camp),
    depot,
    fuel,
    tanker,
    roadworks,
    slope,
    field,
  ]);
}
