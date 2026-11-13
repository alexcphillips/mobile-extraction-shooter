// Silver Creek's west end (roadmap MT-6, 2026-11-10), used by gen-silver-creek.mjs: the fire
// lookout, the company office, the sheds, six company houses each laid out differently, and
// the gas station and store, with cover across the open ground round them.
//
// Buildings are built in their own frame (front on +z, origin on the ground under the middle)
// and placed as a group turned by yaw. They follow admin-building's rules (design overview):
// outer walls 0.2 m, partitions 0.15 m, doorways 1.2 × 2.1 m, windows 0.9 to 2.0 m glazed
// (vaultable once broken), rooms about 1.25× real. The valley floor here is flat at y 0.

import { buildingKit, DOOR_H, WIN } from './mapkit/building.mjs';
import { fenceRun } from './mapkit/fence.mjs';

export function buildWestEnd(h) {
  const { box, drawn, group, prefab, along, label, C, r2, groundRange } = h;
  Object.assign(C, {
    trim: '#e0dccf',
    plaster: '#cfc6b0',
    floorboards: '#7a6450',
    'roof-red': '#5a3a30',
    'siding-sage': '#7d8a78',
    'siding-cream': '#c2b48e',
    'siding-blue': '#6f7f8c',
    boards: '#8a7458',
    rubble: '#8a8276',
    'store-red': '#a8322c',
    canopy: '#d8d4ca',
  });

  const { wX, wZ, door, win, doorX, doorZ, roof, shell, slabWithHoles, porch } = buildingKit(h);
  const at = (name, x, z, y, extra = {}) => prefab(name, x, z, extra, y);

  // ---------------------------------------------------------------- fire lookout
  // The tower from the graybox, now with rails on the landing's north and south sides (its
  // west edge is left open to drop off, 2.5 m to the slope; the stairs come up the east),
  // cross bracing, and the flights on up to the cab, whose lowest
  // one starts 3.3 m above the landing (it has fallen away): out of reach even from the
  // rail's top, so the 17 m cab stays out of bounds.
  const LOOKOUT = { x: 30, z: 8, half: 2.5, cab: 17, landing: 3.3 };
  const ly = groundRange(LOOKOUT.x - 2.5, LOOKOUT.z - 2.5, LOOKOUT.x + 2.5, LOOKOUT.z + 2.5)[0];
  const lookout = (() => {
    const { x, z, half, cab, landing } = LOOKOUT;
    const y = ly;
    const legs = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].map(([sxn, szn], k) => {
      const lx = x + sxn * (half - 0.2);
      const lz = z + szn * (half - 0.2);
      return box(lx - 0.2, lz - 0.2, lx + 0.2, lz + 0.2, y - 0.6, y + cab, C.timber, {
        id: `lookout-leg-${k + 1}`,
      });
    });
    const run = landing * 2;
    const L = y + landing;
    // X bracing on each face between levels, drawn only.
    const levels = [y, L, y + 7.5, y + 12, y + cab];
    const bracing = [];
    for (let i = 0; i + 1 < levels.length; i++) {
      const [a, b] = [levels[i], levels[i + 1]];
      const e = half - 0.2;
      for (const [p, q] of [
        [
          [x - e, a, z - e],
          [x + e, b, z - e],
        ],
        [
          [x + e, a, z - e],
          [x - e, b, z - e],
        ],
        [
          [x - e, a, z + e],
          [x + e, b, z + e],
        ],
        [
          [x + e, a, z + e],
          [x - e, b, z + e],
        ],
        [
          [x - e, a, z - e],
          [x - e, b, z + e],
        ],
        [
          [x - e, a, z + e],
          [x - e, b, z - e],
        ],
        [
          [x + e, a, z - e],
          [x + e, b, z + e],
        ],
        [
          [x + e, a, z + e],
          [x + e, b, z - e],
        ],
      ])
        bracing.push(
          along(p, q, 0.1, 0.12, C['timber-dark'], { id: `lookout-brace-${bracing.length + 1}` }),
        );
    }
    // Rails round the landing on the north, south and west: 1.0 m, vaultable.
    const rail = (id, x0, z0, x1, z1) => box(x0, z0, x1, z1, L, L + 1.0, C.timber, { id });
    // Flights from 6.6 m up to the cab, switching back across the tower.
    const flights = [];
    const fRise = (cab - landing * 2) / 4;
    for (let k = 0; k < 4; k++) {
      const fy = L + landing + k * fRise;
      const north = k % 2 === 0;
      flights.push({
        type: 'stairs',
        id: `lookout-flight-${k + 1}`,
        pos: [r2(x), r2(fy), r2(north ? z - 1.4 : z + 1.4)],
        yaw: north ? 90 : -90,
        size: [1.0, r2(fRise), 3.8],
        color: C.timber,
      });
    }
    return group(
      'Fire lookout',
      [
        ...legs,
        box(x - half, z - half, x + half, z + half, L - 0.2, L, C.timber, {
          id: 'lookout-landing',
        }),
        {
          type: 'stairs',
          id: 'lookout-stairs',
          pos: [r2(x + half + run / 2), r2(y), z],
          yaw: -90,
          size: [2, landing, run],
          color: C.timber,
        },
        rail('lookout-rail-n', x - half, z - half, x + half, z - half + 0.1),
        rail('lookout-rail-s', x - half, z + half - 0.1, x + half, z + half),
        ...flights,
        // the broken stub of the missing flight, hanging from the one above
        along(
          [x - 1.9, L + 3.3, z - 1.4],
          [x - 1.2, L + 2.5, z - 1.4],
          1.0,
          0.1,
          C['timber-dark'],
          { id: 'lookout-stub' },
        ),
        // the cab: catwalk, glazed band and rail round it
        box(x - 3, z - 3, x + 3, z + 3, y + cab - 0.15, y + cab, C['timber-dark'], {
          id: 'lookout-catwalk',
        }),
        box(x - 2.2, z - 2.2, x + 2.2, z + 2.2, y + cab, y + cab + 2.6, C['timber-dark'], {
          id: 'lookout-cab',
        }),
        drawn(x - 2.23, z - 2.23, x + 2.23, z + 2.23, y + cab + 1.1, y + cab + 2.2, C.glass, {
          id: 'lookout-glazing',
        }),
        drawn(x - 3, z - 3, x + 3, z + 3, y + cab + 0.95, y + cab + 1.02, C.timber, {
          id: 'lookout-cab-rail',
        }),
        {
          type: 'cylinder',
          id: 'lookout-roof',
          pos: [x, r2(y + cab + 2.6), z],
          radius: 3.4,
          radiusTop: 0,
          height: 2,
          sides: 4,
          yaw: 45,
          color: C.roof,
        },
        drawn(x - 0.05, z - 0.05, x + 0.05, z + 0.05, y + cab + 4.5, y + cab + 6, C.steel, {
          id: 'lookout-mast',
        }),
      ],
      { landmark: true },
    );
  })();

  // ---------------------------------------------------------------- company office
  // Two storeys, 14 × 10 m at (27, 38), front door south to the town, back door north to the
  // ridge, a side door east to the sheds. Ground: a hall through the middle with the stairs
  // up its east side, the pay office (a vaultable pay window onto the hall) and records west,
  // the manager's office and a store east. Upstairs is the drafting office, glazed all round:
  // a perch over the west spawns that the AI follows you up to, by the stairs or the fire
  // escape on the west wall (whose landing's open west edge drops you 3.3 m, unhurt).
  const office = (() => {
    const [cx, cz] = [27, 38];
    const fl = 0.3;
    const up = 3.3; // upper floor
    const top = 5.9; // upper ceiling
    const col = C.siding;
    const n = [];
    // floor, ground walls, upper slab (with the stair hole), upper walls, ceiling, roof
    n.push(box(-7, -5, 7, 5, -0.3, fl, C['dark-concrete'], { id: 'co-floor' }));
    n.push(drawn(-6.8, -4.8, 6.8, 4.8, fl, fl + 0.01, C.floorboards, { id: 'co-boards' }));
    const g = {
      front: [door(0), win(-4.5, 1.6), win(-2.2, 1.0), win(4.5, 1.6)],
      back: [door(0), win(-4.5), win(3.2, 1.0)],
      west: [win(2.2), win(-2.5)],
      east: [win(3.0), door(-2.0)],
    };
    const u = {
      front: [win(-4.5), win(-1.5), win(1.5), win(4.5)],
      back: [win(-4.5, 1.2), win(-1.5, 1.2), win(3.2, 1.2), win(5.6, 0.9)],
      west: [door(2.5, 1.0), win(-2.8, 1.2)],
      east: [win(2.5), win(-2.5)],
    };
    const ring = (lvl, b, t, ops) => [
      wX(`co-${lvl}-front`, -7, 7, 4.9, b, t, col, ops.front),
      wX(`co-${lvl}-back`, -7, 7, -4.9, b, t, col, ops.back),
      wZ(`co-${lvl}-west`, -6.9, -4.8, 4.8, b, t, col, ops.west),
      wZ(`co-${lvl}-east`, 6.9, -4.8, 4.8, b, t, col, ops.east),
    ];
    n.push(...ring('g', fl, up, g));
    n.push(
      ...slabWithHoles('co-upper', -6.8, -4.8, 6.8, 4.8, up - 0.2, up, C.floorboards, [
        [0.4, -2.5, 1.5, 2.1],
      ]),
    );
    n.push(...ring('u', up, top + 0.2, u));
    n.push(box(-6.8, -4.8, 6.8, 4.8, top, top + 0.2, C.plaster, { id: 'co-ceiling' }));
    const rf = roof('co-roof', -7, 7, -5, 5, top + 0.2, 25, { roof: C.roof, gable: col });
    n.push(...rf.nodes);
    // a band of trim between the storeys, and a sign board over the front door
    n.push(drawn(-7.03, 4.97, 7.03, 5.03, up - 0.25, up - 0.05, C.trim, { id: 'co-band-s' }));
    n.push(drawn(-7.03, -5.03, 7.03, -4.97, up - 0.25, up - 0.05, C.trim, { id: 'co-band-n' }));
    n.push(drawn(-2.2, 5.0, 2.2, 5.08, 2.35, 2.95, C['timber-dark'], { id: 'co-sign' }));
    n.push(drawn(-2.0, 5.08, 2.0, 5.1, 2.5, 2.8, C.trim, { id: 'co-sign-face' }));
    // ground partitions: the hall's walls at x ±1.5, and the cross walls of the side rooms
    const pc = C.plaster;
    n.push(
      wZ(
        'co-hall-w',
        -1.5,
        -4.8,
        4.8,
        fl,
        up - 0.2,
        pc,
        [door(-2.0), { at: 2.4, width: 1.4, bottom: 1.0, top: 2.0 }],
        0.15,
      ),
      wZ('co-hall-e', 1.5, -4.8, 4.8, fl, up - 0.2, pc, [door(3.2), door(-3.6)], 0.15),
      wX('co-pay-records', -6.8, -1.575, 0, fl, up - 0.2, pc, [door(-4.5)], 0.15),
      wX('co-manager-store', 1.575, 6.8, 0.5, fl, up - 0.2, pc, [], 0.15),
    );
    // doors (front and back stand open; the rest shut)
    n.push(
      doorX('co-door-s', 0, 4.9, fl, 1.2, { open: true, yaw: 180 }),
      doorX('co-door-n', 0, -4.9, fl),
      doorZ('co-door-e', 6.9, -2.0, fl),
      doorZ('co-door-records', -1.5, -2.0, fl),
      doorZ('co-door-manager', 1.5, 3.2, fl),
      doorZ('co-door-store', 1.5, -3.6, fl),
      doorZ('co-door-fire', -6.9, 2.5, up, 1.0),
    );
    // the stairs up the hall's east side, rising north, and the rails round their hole
    n.push({
      type: 'stairs',
      id: 'co-stairs',
      pos: [0.9, fl, -0.2],
      yaw: 180,
      size: [1.05, r2(up - fl), 4.6],
      color: C.timber,
    });
    n.push(
      box(0.33, -2.4, 0.4, 2.1, up, up + 1.0, C['timber-dark'], { id: 'co-stair-rail-w' }),
      box(0.4, 2.1, 1.5, 2.17, up, up + 1.0, C['timber-dark'], { id: 'co-stair-rail-s' }),
      box(1.5, -2.4, 1.57, 2.17, up, up + 1.0, C['timber-dark'], { id: 'co-stair-rail-e' }),
    );
    // ground furniture
    n.push(
      // pay office: the clerk's desk at the pay window, cabinets, the strongbox
      at('desk', -2.4, 2.4, fl, { yaw: -90 }),
      at('office-chair', -3.2, 2.4, fl, { yaw: 90 }),
      at('paper-stacks', -2.4, 2.2, fl + 0.76, { yaw: 90 }),
      at('filing-cabinet', -6.45, 1.0, fl, { yaw: 90 }),
      at('filing-cabinet', -6.45, 1.55, fl, { yaw: 90 }),
      at('office-safe', -6.3, 4.2, fl, { yaw: 90 }),
      // records: shelves of ledgers and cabinets in rows
      at('bookcase-tall', -4.2, -4.57, fl),
      at('filing-cabinet', -6.45, -3.4, fl, { yaw: 90 }),
      at('filing-cabinet', -6.45, -2.85, fl, { yaw: 90 }),
      at('filing-cabinet', -6.45, -2.3, fl, { yaw: 90 }),
      at('table-and-chairs', -4.3, -2.6, fl, { yaw: 8 }),
      // hall: a bench and the notice board
      at('notice-board', -1.42, 0.5, fl, { yaw: 90 }),
      // manager's office: the big desk facing the door
      at('executive-desk', 4.6, 2.9, fl, { yaw: -90 }),
      at('office-chair', 5.7, 2.9, fl, { yaw: -90 }),
      at('bookcase-tall', 4.2, 0.81, fl),
      at('potted-plant', 6.2, 1.2, fl),
      // store: lockers, water, crates of tools
      at('locker-bank', 3.2, -4.5, fl),
      at('water-cooler', 6.4, 0.0, fl),
      at('crate', 6.2, -4.2, fl),
      at('crate', 6.2, -4.2, fl + 0.8, { yaw: 20 }),
      at('crate', 5.3, -4.3, fl, { yaw: 10 }),
    );
    // upstairs: the drafting office, desks in two islands, the chief's room back west
    n.push(
      wX('co-chief-s', -6.8, -1.5, -1.0, up, top, pc, [door(-3.0)], 0.15),
      wZ('co-chief-e', -1.5, -4.8, -1.075, up, top, pc, [], 0.15),
      doorX('co-door-chief', -3.0, -1.0, up),
      at('desk', -4.3, 2.2, up),
      at('desk', -2.6, 2.2, up),
      at('desk', -4.3, 3.6, up, { yaw: 180 }),
      at('wooden-chair', -4.3, 2.8, up, { yaw: 180 }),
      at('wooden-chair', -2.6, 1.55, up),
      at('desk', 3.5, 2.6, up, { yaw: 90 }),
      at('desk', 3.5, 0.6, up, { yaw: 90 }),
      at('wooden-chair', 2.8, 2.6, up, { yaw: 90 }),
      at('filing-cabinet', 6.45, -3.0, up, { yaw: -90 }),
      at('filing-cabinet', 6.45, -2.45, up, { yaw: -90 }),
      at('paper-stacks', 3.5, 0.6, up + 0.76),
      at('clipboard', -4.0, 2.3, up + 0.76, { yaw: 25 }),
      at('notice-board', 4.0, -4.82, up),
      at('desk', -5.2, -2.9, up, { yaw: 90 }),
      at('office-chair', -4.6, -2.9, up, { yaw: -90 }),
      at('bookcase-tall', -1.805, -2.9, up, { yaw: -90 }),
    );
    // fire escape on the west wall: a flight rising north to a landing at the upper door
    n.push(
      {
        type: 'stairs',
        id: 'co-fire-stairs',
        pos: [-7.75, 0, 5.65],
        yaw: 180,
        size: [1.2, up, 4.5],
        color: C.steel,
      },
      box(-8.5, 1.4, -7.0, 3.4, up - 0.15, up, C.steel, { id: 'co-fire-landing' }),
      box(-8.5, 1.33, -7.0, 1.4, up, up + 1.0, C['steel-dark'], { id: 'co-fire-rail-n' }),
      along([-8.42, 0.5, 7.9], [-8.42, up + 0.5, 3.4], 0.07, 1.0, C['steel-dark'], {
        id: 'co-fire-rail',
        collide: true,
      }),
      drawn(-8.48, 1.42, -8.38, 1.52, 0, up - 0.15, C['steel-dark'], { id: 'co-fire-post-1' }),
      drawn(-8.48, 3.28, -8.38, 3.38, 0, up - 0.15, C['steel-dark'], { id: 'co-fire-post-2' }),
    );
    return group('Company office', n, { pos: [cx, 0, cz] });
  })();

  // ---------------------------------------------------------------- sheds
  // The MT-4 sheds replace the graybox blocks: a red one and a gray one facing the town, two
  // small ones turned to make lanes between them, and the woodshed's 1 m deep hide facing the
  // houses. Each has its own setback, so the lanes zigzag.
  const sheds = [
    prefab(
      'shed',
      47.5,
      36.5,
      { id: 'shed-1', colors: { siding: C['siding-red'], 'siding-dark': '#6e3a2e' } },
      0,
    ),
    prefab('shed', 59.5, 35.2, { id: 'shed-2', yaw: 4 }, 0),
    prefab(
      'shed-small',
      53.2,
      44.6,
      { id: 'shed-3', yaw: 90, colors: { siding: C['timber-dark'], 'siding-dark': '#4a3828' } },
      0,
    ),
    prefab('shed-small', 44.8, 44.2, { id: 'shed-4', yaw: 180 }, 0),
    prefab('woodshed', 61.5, 43.2, { id: 'woodshed' }, 0),
    prefab('log-pile', 67.5, 39.5, { yaw: 80 }, 0),
    prefab('steel-barrel', 51.2, 39.9, {}, 0),
    prefab('sideways-steel-barrel', 52.3, 40.4, { yaw: 30 }, 0),
    prefab('wood-pallet', 56.9, 40.3, { yaw: 12 }, 0),
    prefab('crate', 56.9, 40.3, {}, 0.144),
  ];

  // ---------------------------------------------------------------- the six houses
  // Each is 11 × 9 m (frame x ±5.5, z ±4.5, front +z), placed facing the lane. No two share
  // a plan; each has at least two doors, and windows on every side.
  const FL = 0.35;
  const houseSpecs = [];

  // House 1: a hall straight through, front door to back door; the living room west, the
  // kitchen and a bedroom east.
  houseSpecs.push({
    name: 'House 1 (hall)',
    pos: [41.5, 72.5],
    yaw: 0,
    color: C.siding,
    roofColor: C.roof,
    ops: {
      front: [door(0), win(-3.3, 1.6), win(3.3)],
      back: [door(0), win(-3.3, 1.6), win(3.6, 1.0)],
      west: [win(1.5), win(-2.0)],
      east: [win(2.6, 1.2), win(-2.6, 1.2)],
    },
    inside: (id) => [
      wZ(`${id}-p1`, -1.0, -4.3, 4.3, FL, FL + 3, C.plaster, [door(1.8)], 0.15),
      wZ(`${id}-p2`, 1.0, -4.3, 4.3, FL, FL + 3, C.plaster, [door(2.4), door(-2.4)], 0.15),
      wX(`${id}-p3`, 1.075, 5.3, 0, FL, FL + 3, C.plaster, [], 0.15),
      doorX(`${id}-door-front`, 0, 4.4, FL),
      doorX(`${id}-door-back`, 0, -4.4, FL, 1.2, { open: true }),
      doorZ(`${id}-door-bed`, 1.0, -2.4, FL),
      at('tv-unit', -5.07, 0, FL, { yaw: 90 }),
      at('couch', -2.0, 0, FL, { yaw: 90 }),
      at('coffee-table', -3.5, 0, FL, { yaw: 90 }),
      at('floor-lamp', -4.9, 3.8, FL),
      at('bookcase-tall', -1.305, -2.6, FL, { yaw: -90 }),
      at('kitchen-run', 3.2, 0.4, FL),
      at('dining-set', 3.4, 2.6, FL, { yaw: 3 }),
      at('bed-double', 4.2, -2.2, FL, { yaw: -90 }),
      at('wardrobe', 2.4, -3.97, FL),
      at('nightstand', 5.0, -3.6, FL),
      ...porch(id, 0, 4.5, FL),
    ],
    yard: (id) => [
      // back yard: fence with a gate, the clothes line, a woodshed
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [2]),
      ...fenceLine(`${id}-fence-w`, -7, -4.5, -7, -11.5, []),
      at('clothes-line', -2.5, -8.2, 0, { yaw: 6 }),
      at('woodshed', 4.0, -8.6, 0, { yaw: 180 }),
      at('mailbox', 2.2, 6.9, 0, { yaw: 180 }),
    ],
  });

  // House 2: open plan across the front (kitchen, dining, sitting room) with a side door
  // east; two bedrooms and a bathroom along the back.
  houseSpecs.push({
    name: 'House 2 (open plan)',
    pos: [59.5, 72.5],
    yaw: 0,
    color: C['siding-sage'],
    roofColor: C['roof-red'],
    ops: {
      front: [door(-2.0), win(-4.4), win(1.0, 1.6), win(4.6, 0.9)],
      back: [win(-3.4), { at: 0.2, width: 0.8, bottom: 1.4, top: 2.0, glass: C.glass }, win(3.5)],
      west: [win(3.4, 1.2), win(-2.7, 1.2)],
      east: [door(2.4), win(-2.7, 1.2)],
    },
    inside: (id) => [
      wX(
        `${id}-p1`,
        -5.3,
        5.3,
        -1.0,
        FL,
        FL + 3,
        C.plaster,
        [door(-3.6), { ...door(0.4), width: 0.9 }, door(3.5)],
        0.15,
      ),
      wZ(`${id}-p2`, -1.3, -4.3, -1.075, FL, FL + 3, C.plaster, [], 0.15),
      wZ(`${id}-p3`, 1.7, -4.3, -1.075, FL, FL + 3, C.plaster, [], 0.15),
      doorX(`${id}-door-front`, -2.0, 4.4, FL),
      doorZ(`${id}-door-side`, 5.4, 2.4, FL),
      doorX(`${id}-door-bath`, 0.4, -1.0, FL, 0.9),
      at('kitchen-run', -5.0, 1.4, FL, { yaw: 90 }),
      box(-3.8, 0.1, -3.2, 2.4, FL, FL + 0.95, C.timber, { id: `${id}-breakfast-bar` }),
      at('dining-set', -0.6, 2.0, FL, { yaw: -4 }),
      at('couch', 3.2, 1.2, FL, { yaw: 180 }),
      at('coffee-table', 3.2, 2.5, FL),
      at('tv-unit', 3.2, 4.07, FL, { yaw: 180 }),
      at('bed-double', -4.2, -2.9, FL, { yaw: 90 }),
      at('wardrobe', -1.69, -3.3, FL, { yaw: -90 }),
      at('toilet', -0.6, -3.93, FL),
      at('sink-counter', 1.35, -2.8, FL, { yaw: -90 }),
      at('bed-double', 4.2, -2.9, FL, { yaw: -90 }),
      at('floor-lamp', 2.2, -3.9, FL),
      box(-2.6, 4.5, -1.4, 5.6, -0.2, FL - 0.02, C['dark-concrete'], { id: `${id}-step` }),
    ],
    yard: (id) => [
      // back yard: an outhouse-sized shed, the vegetable patch, fence broken in two places
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [0, 3]),
      ...fenceLine(`${id}-fence-e`, 7, -4.5, 7, -11.5, [1]),
      at('shed-small', -4.6, -9.3, 0, { yaw: 90 }),
      drawn(0, -10.6, 5.5, -6.2, 0, 0.04, C.dirt, { id: `${id}-garden` }),
      ...[0.8, 2.0, 3.2, 4.4].map((x, k) =>
        drawn(x, -10.3, x + 0.5, -6.5, 0.04, 0.12, '#5a7a44', { id: `${id}-row-${k + 1}` }),
      ),
      at('mailbox', -0.8, 6.9, 0, { yaw: 180 }),
    ],
  });

  // House 3: a side door west into the kitchen; the back east bedroom has caved in, its roof
  // and back wall broken open, so the rubble is a third way in.
  houseSpecs.push({
    name: 'House 3 (caved in)',
    pos: [77.5, 72.5],
    yaw: 0,
    color: C['siding-cream'],
    roofColor: C.roof,
    roofGaps: [[1.5, 4.8]],
    ceilingHoles: [[1.5, -3.8, 4.8, -1.0]],
    ops: {
      front: [door(3.6), win(-3.0, 1.6), win(1.4, 1.2)],
      back: [win(-3.0), { at: 4.0, width: 1.8, bottom: 0, top: 2.3 }],
      west: [door(2.6), win(-2.2)],
      east: [win(3.7, 1.0), win(-2.0, 1.2)],
    },
    inside: (id) => [
      wX(`${id}-p1`, -5.3, 5.3, 0, FL, FL + 3, C.plaster, [door(-1.5), door(2.6)], 0.15),
      wZ(
        `${id}-p2`,
        0.5,
        0.075,
        4.3,
        FL,
        FL + 3,
        C.plaster,
        [{ at: 2.2, width: 2.0, bottom: 0, top: 2.4 }],
        0.15,
      ),
      wZ(`${id}-p3`, -0.5, -4.3, -0.075, FL, FL + 3, C.plaster, [], 0.15),
      doorX(`${id}-door-front`, 3.6, 4.4, FL),
      doorZ(`${id}-door-side`, -5.4, 2.6, FL, 1.2, { open: true }),
      doorX(`${id}-door-bed`, -1.5, 0, FL),
      at('kitchen-run', -3.6, 0.4, FL),
      at('dining-set', -2.6, 2.6, FL, { yaw: 87 }),
      at('tv-unit', 5.07, 2.2, FL, { yaw: -90 }),
      at('couch', 3.0, 2.2, FL, { yaw: -90 }),
      at('floor-lamp', 1.0, 3.9, FL),
      at('bed-double', -4.22, -2.6, FL, { yaw: 90 }),
      at('wardrobe', -0.89, -2.6, FL, { yaw: -90 }),
      // the caved-in room: rubble (vault the high part), a sagging slab hanging from the hole
      box(1.2, -3.0, 3.6, -1.2, FL, FL + 0.5, C.rubble, { id: `${id}-rubble-1`, yaw: 6 }),
      box(1.8, -2.6, 3.0, -1.6, FL + 0.5, FL + 0.8, C.plaster, { id: `${id}-rubble-2`, yaw: -12 }),
      along([3.2, FL + 3.1, -1.0], [2.6, FL + 1.7, -2.2], 2.4, 0.12, C.plaster, {
        id: `${id}-sag`,
      }),
      box(3.2, -6.0, 4.9, -4.5, -0.1, 0.3, C.rubble, { id: `${id}-rubble-out`, yaw: 10 }),
      at('couch-fallen', 0.4, -3.4, FL, { yaw: 90 }),
    ],
    yard: (id) => [
      // back yard: the fence is mostly down; a skip for the rubble, a log pile
      ...fenceLine(`${id}-fence-w`, -7, -4.5, -7, -11.5, [0]),
      ...fenceLine(`${id}-fence-back`, -7, -11.5, -1, -11.5, []),
      at('skip-bin', 4.4, -8.6, 0, { yaw: 8 }),
      at('log-pile', -3.4, -8.8, 0, { yaw: -4 }),
      at('mailbox', 5.4, 6.9, 0, { yaw: 180, colors: { box: '#4a5a3a' } }),
    ],
  });

  // House 4 (south row, facing north): three rooms in a line with their doorways lined up, a
  // bathroom closet off the bedroom; front door into the living room, back door from the
  // kitchen at the far end.
  houseSpecs.push({
    name: 'House 4 (rooms in a line)',
    pos: [45.5, 89.5],
    yaw: 180,
    color: C['siding-red'],
    roofColor: C.roof,
    ops: {
      front: [door(-3.6), win(1.0, 1.0), win(3.6)],
      back: [win(-3.6, 1.2), win(0, 1.2), door(4.0)],
      west: [win(2.6)],
      east: [win(3.2, 1.0)],
    },
    inside: (id) => [
      wZ(`${id}-p1`, -1.8, -4.3, 4.3, FL, FL + 3, C.plaster, [door(-1.3)], 0.15),
      wZ(`${id}-p2`, 1.8, -4.3, 4.3, FL, FL + 3, C.plaster, [door(-1.3)], 0.15),
      wX(
        `${id}-bath-s`,
        -1.725,
        0.2,
        1.4,
        FL,
        FL + 3,
        C.plaster,
        [{ ...door(-0.7), width: 0.9 }],
        0.15,
      ),
      wZ(`${id}-bath-e`, 0.2, 1.475, 4.3, FL, FL + 3, C.plaster, [], 0.15),
      doorX(`${id}-door-front`, -3.6, 4.4, FL),
      doorX(`${id}-door-back`, 4.0, -4.4, FL),
      doorZ(`${id}-door-kitchen`, 1.8, -1.3, FL, 1.2, { open: true }),
      at('tv-unit', -5.07, -2.6, FL, { yaw: 90 }),
      at('couch', -3.6, -2.6, FL, { yaw: 90 }),
      at('bookcase-tall', -2.105, 2.4, FL, { yaw: -90 }),
      at('floor-lamp', -2.3, -3.9, FL),
      at('bed-double', 0, -3.19, FL),
      at('nightstand', 1.25, -3.95, FL),
      at('toilet', -1.2, 3.95, FL, { yaw: 180 }),
      at('kitchen-run', 5.0, 0.8, FL, { yaw: -90 }),
      at('dining-set', 3.4, 2.4, FL, { yaw: 2 }),
      ...porch(id, -3.6, 4.5, FL, 2.6, 1.4),
    ],
    yard: (id) => [
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [4]),
      ...fenceLine(`${id}-fence-w`, -7, -4.5, -7, -11.5, [1]),
      at('shed-small', -4.2, -9.4, 0, { colors: { siding: C['siding-cream'] } }),
      at('lumber-stack', 3.2, -8.5, 0, { yaw: 85 }),
      at('mailbox', -1.6, 6.9, 0, { yaw: 180 }),
    ],
  });

  // House 5 (the foreman's, two storeys): stairs up the west wall from the front room;
  // upstairs a landing and two bedrooms, windows over the lane and the highway. The AI
  // follows you up. The upper floor is 3.3 m up (a broken window is the way out; not checked).
  houseSpecs.push({
    name: 'House 5 (two storeys)',
    pos: [63.5, 89.5],
    yaw: 180,
    color: C['siding-blue'],
    roofColor: C['roof-red'],
    twoStorey: true,
  });

  // House 6 (squatted): its front door and windows boarded over, so it's entered by the back
  // door, a side door, or a broken back window; inside, partitions half torn down and a camp.
  houseSpecs.push({
    name: 'House 6 (boarded up)',
    pos: [81.5, 89.5],
    yaw: 180,
    color: C.siding,
    roofColor: C.roof,
    ops: {
      front: [],
      back: [door(-2.5), { at: 3.6, width: 1.4, ...WIN }],
      west: [],
      east: [door(-1.0), win(2.4, 1.2)],
    },
    inside: (id) => [
      wX(`${id}-p1`, -5.3, -1.5, 0.5, FL, FL + 3, C.plaster, [], 0.15),
      wZ(`${id}-p2`, 1.5, -4.3, -1.2, FL, FL + 3, C.plaster, [], 0.15),
      box(1.425, -1.2, 1.575, -0.6, FL, FL + 1.1, C.plaster, { id: `${id}-p2-stub` }),
      doorX(`${id}-door-back`, -2.5, -4.4, FL, 1.2, { open: true }),
      doorZ(`${id}-door-side`, 5.4, -1.0, FL),
      // boards over the front door and windows, outside
      ...boarded(`${id}-boards-front`, [-3.6, 0, 3.4], 4.5, FL),
      // the camp
      at('mattress-bed', -3.8, -2.8, FL, { yaw: 90 }),
      at('mattress-bed', -3.6, 2.4, FL, { yaw: 15 }),
      at('burn-barrel', -0.6, -1.4, FL),
      at('couch-fallen', -0.4, 3.6, FL, { yaw: 180 }),
      at('wardrobe', 4.4, 3.95, FL, { yaw: 180 }),
      at('crate', 1.6, 3.7, FL),
      at('crate', 2.45, 3.75, FL, { yaw: 20 }),
      at('crate', 2.0, 3.7, FL + 0.8, { yaw: 8 }),
      at('table-and-chairs', 3.4, -1.6, FL, { yaw: 30 }),
      at('kitchen-run', 1.9, -2.8, FL, { yaw: 90 }),
    ],
    yard: (id) => [
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [1, 2]),
      ...fenceLine(`${id}-fence-e`, 7, -4.5, 7, -11.5, []),
      at('tent-shelter', -3.6, -8.6, 0, { yaw: 20 }),
      at('burn-barrel', -1.2, -7.4, 0),
      at('sideways-steel-barrel', 3.5, -7.2, 0, { yaw: 70 }),
      at('wood-pallet', 4.6, -9.8, 0, { yaw: 40 }),
    ],
  });

  /** Planks nailed over openings in the front wall (its outer face at hd), drawn only. */
  function boarded(id, xs, hd, fl) {
    const out = [];
    xs.forEach((x, k) => {
      const tall = k === 0;
      const [b, t, w] = tall ? [fl, fl + DOOR_H, 1.3] : [fl + 0.85, fl + 2.05, 1.5];
      out.push(
        drawn(x - w / 2, hd, x + w / 2, hd + 0.03, b, t, '#3a3430', { id: `${id}-${k + 1}-dark` }),
      );
      const n = tall ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const y = b + ((i + 0.5) * (t - b)) / n;
        out.push(
          drawn(
            x - w / 2 - 0.1,
            hd + 0.03,
            x + w / 2 + 0.1,
            hd + 0.06,
            y - 0.09,
            y + 0.09,
            C.boards,
            {
              id: `${id}-${k + 1}-plank-${i + 1}`,
              roll: (i % 2 ? 1 : -1) * (4 + i * 2),
            },
          ),
        );
      }
    });
    return out;
  }

  /**
   * A picket fence from (x0, z0) to (x1, z1) in 3 m bays; bays listed in `gaps` are broken
   * through (walkable). Ends short of a whole bay are left open.
   */
  const fenceLine = (id, x0, z0, x1, z1, gaps) => fenceRun(id, [x0, z0], [x1, z1], { gaps });

  /** House 5's plan, two storeys. */
  function twoStorey(id, color) {
    const fl = 0.3;
    const up = 3.3;
    const top = 5.9;
    const n = [
      box(-5.5, -4.5, 5.5, 4.5, -0.3, fl, C['dark-concrete'], { id: `${id}-floor` }),
      drawn(-5.3, -4.3, 5.3, 4.3, fl, fl + 0.01, C.floorboards, { id: `${id}-boards` }),
    ];
    const g = {
      front: [door(-1.8), win(0.6, 1.0), win(3.8, 1.2)],
      back: [win(1.2), door(3.6)],
      west: [],
      east: [win(2.2), win(-2.2)],
    };
    const u = {
      front: [win(-2.0), win(3.0)],
      back: [win(-2.0), win(3.0)],
      west: [win(-3.0, 1.0)],
      east: [win(2.2, 1.2), win(-2.2, 1.2)],
    };
    const ring = (lvl, b, t, ops) => [
      wX(`${id}-${lvl}-front`, -5.5, 5.5, 4.4, b, t, color, ops.front),
      wX(`${id}-${lvl}-back`, -5.5, 5.5, -4.4, b, t, color, ops.back),
      wZ(`${id}-${lvl}-west`, -5.4, -4.3, 4.3, b, t, color, ops.west),
      wZ(`${id}-${lvl}-east`, 5.4, -4.3, 4.3, b, t, color, ops.east),
    ];
    n.push(...ring('g', fl, up, g));
    // the stair hole: x −5.3..−4.15 over the flight, z −1.5..3.0
    n.push(
      ...slabWithHoles(`${id}-upper`, -5.3, -4.3, 5.3, 4.3, up - 0.2, up, C.floorboards, [
        [-5.3, -1.5, -4.15, 3.0],
      ]),
    );
    n.push(...ring('u', up, top + 0.2, u));
    n.push(box(-5.3, -4.3, 5.3, 4.3, top, top + 0.2, C.plaster, { id: `${id}-ceiling` }));
    n.push(drawn(-5.53, 4.47, 5.53, 4.53, up - 0.25, up - 0.05, C.trim, { id: `${id}-band` }));
    // the stairs rise north (−z) up the west wall
    n.push({
      type: 'stairs',
      id: `${id}-stairs`,
      pos: [-4.75, fl, 0.75],
      yaw: 180,
      size: [1.1, r2(up - fl), 4.5],
      color: C.timber,
    });
    n.push(
      along([-4.12, fl + 0.5, 3.0], [-4.12, up + 0.5, -1.5], 0.08, 1.0, C['timber-dark'], {
        id: `${id}-stair-rail`,
        collide: true,
      }),
      box(-4.16, -1.5, -4.08, 3.0, up, up + 1.0, C['timber-dark'], { id: `${id}-hole-rail-e` }),
      box(-5.3, 3.0, -4.08, 3.08, up, up + 1.0, C['timber-dark'], { id: `${id}-hole-rail-s` }),
    );
    // ground: front room and back kitchen
    n.push(
      wX(`${id}-gp`, -4.0, 5.3, -0.2, fl, up - 0.2, C.plaster, [door(1.5)], 0.15),
      doorX(`${id}-door-front`, -1.8, 4.4, fl),
      doorX(`${id}-door-back`, 3.6, -4.4, fl, 1.2, { open: true }),
      at('tv-unit', 2.15, 4.07, fl, { yaw: 180 }),
      at('couch', 2.15, 1.2, fl, { yaw: 180 }),
      at('coffee-table', 2.15, 2.6, fl),
      at('floor-lamp', 4.8, 0.4, fl),
      at('kitchen-run', -1.5, -3.98, fl),
      at('dining-set', 1.6, -2.2, fl, { yaw: 88 }),
      at('wooden-chair', 4.6, -3.6, fl, { yaw: -60 }),
    );
    // upstairs: a landing west, two bedrooms east
    n.push(
      wZ(`${id}-up-p`, 0.6, -4.3, 4.3, up, top, C.plaster, [door(2.2), door(-2.2)], 0.15),
      wX(`${id}-up-q`, 0.675, 5.3, 0, up, top, C.plaster, [], 0.15),
      doorZ(`${id}-door-bed-1`, 0.6, 2.2, up),
      doorZ(`${id}-door-bed-2`, 0.6, -2.2, up, 1.2, { open: true }),
      at('bookcase-tall', -1.6, -4.07, up),
      at('couch', -1.8, 2.2, up, { yaw: -90 }),
      at('bed-double', 4.2, 2.2, up, { yaw: -90 }),
      at('nightstand', 5.0, 3.8, up),
      at('wardrobe', 3.0, -3.97, up),
      at('mattress-bed', 4.3, -1.6, up, { yaw: 90 }),
    );
    const rf = roof(`${id}-roof`, -5.5, 5.5, -4.5, 4.5, top + 0.2, 30, {
      roof: C['roof-red'],
      gable: color,
    });
    n.push(...rf.nodes);
    n.push(box(2.6, -1.0, 3.4, -0.2, top + 0.2, rf.ridge + 1.0, C.stone, { id: `${id}-chimney` }));
    n.push(...porch(id, -1.8, 4.5, fl, 2.6, 1.4));
    n.push(box(2.3, 4.5, 4.7, 9.5, -0.1, 0.05, C.road, { id: `${id}-drive`, collide: false }));
    return n;
  }

  const houses = houseSpecs.map((s, k) => {
    const id = `house-${k + 1}`;
    let nodes;
    if (s.twoStorey) {
      nodes = twoStorey(id, s.color);
      nodes.push(
        ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [2]),
        at('car', 3.5, -8.5, 0, { yaw: 8, colors: { paint: '#5a6a4a' } }),
        at('clothes-line', -3.5, -8.0, 0, { yaw: -4 }),
        at('mailbox', 1.6, 6.9, 0, { yaw: 180 }),
      );
    } else {
      const sh = shell(id, {
        fl: FL,
        color: s.color,
        ops: s.ops,
        ceilingHoles: s.ceilingHoles ?? [],
      });
      const rf = roof(
        `${id}-roof`,
        -5.5,
        5.5,
        -4.5,
        4.5,
        sh.top,
        30,
        { roof: s.roofColor, gable: s.color },
        s.roofGaps ?? [],
      );
      nodes = [...sh.nodes, ...rf.nodes, ...s.inside(id), ...s.yard(id)];
      if (k === 0 || k === 3)
        nodes.push(
          box(-4.2, -2.2, -3.4, -1.4, sh.top, rf.ridge + 0.8, C.stone, { id: `${id}-chimney` }),
        );
    }
    return group(s.name, nodes, { pos: [s.pos[0], 0, s.pos[1]], yaw: s.yaw });
  });

  // ---------------------------------------------------------------- gas station and store
  // The canopy over two pump islands, and the store beside it facing the highway: glass
  // front, a side door onto the forecourt, a back door from the stockroom. The shop floor
  // has a counter by the door, one tall and one low shelf row, and coolers along the back.
  const store = (() => {
    const fl = 0.3;
    const wallTop = 3.9;
    const col = C['siding-cream'];
    const ops = {
      front: [
        door(0, 1.4),
        { at: -4.2, width: 4.0, bottom: 0.5, top: 2.6, glass: C.glass },
        { at: 4.0, width: 3.2, bottom: 0.5, top: 2.6, glass: C.glass },
      ],
      back: [door(4.5), win(-4.4, 1.0, { bottom: 1.4 })],
      west: [win(3.0, 1.6)],
      east: [door(2.5), win(-1.0)],
    };
    const n = [
      box(-7, -5.5, 7, 5.5, -0.3, fl, C['dark-concrete'], { id: 'store-floor' }),
      drawn(-6.8, -5.3, 6.8, 5.3, fl, fl + 0.01, '#b7b0a2', { id: 'store-tiles' }),
      wX('store-wall-front', -7, 7, 5.4, fl, wallTop + 0.6, col, ops.front),
      wX('store-wall-back', -7, 7, -5.4, fl, wallTop + 0.6, col, ops.back),
      wZ('store-wall-west', -6.9, -5.3, 5.3, fl, wallTop + 0.6, col, ops.west),
      wZ('store-wall-east', 6.9, -5.3, 5.3, fl, wallTop + 0.6, col, ops.east),
      box(-6.8, -5.3, 6.8, 5.3, wallTop, wallTop + 0.2, C.roof, { id: 'store-roof' }),
      // the fascia sign along the front
      drawn(-7.05, 5.5, 7.05, 5.62, wallTop - 0.3, wallTop + 0.6, C['store-red'], {
        id: 'store-fascia',
      }),
      drawn(-3.5, 5.62, 3.5, 5.65, wallTop - 0.1, wallTop + 0.4, C.trim, {
        id: 'store-fascia-name',
      }),
      // partitions: the stockroom across the back, the office and toilet in its west end
      wX('store-p1', -6.8, 6.8, -1.5, fl, wallTop, C.plaster, [door(2.0)], 0.15),
      wZ(
        'store-p2',
        -2.0,
        -5.3,
        -1.575,
        fl,
        wallTop,
        C.plaster,
        [door(-2.6, 1.0), { ...door(-4.6), width: 0.9 }],
        0.15,
      ),
      wX('store-p3', -6.8, -2.075, -3.8, fl, wallTop, C.plaster, [], 0.15),
      doorX('store-door-front', 0, 5.4, fl, 1.4, { open: true, yaw: 180 }),
      doorX('store-door-back', 4.5, -5.4, fl),
      doorZ('store-door-side', 6.9, 2.5, fl),
      doorZ('store-door-office', -2.0, -2.6, fl, 1.0),
      // the shop floor
      at('shop-counter', -3.8, 2.0, fl),
      at('store-shelf-low', 1.8, 2.2, fl, { yaw: 90 }),
      at('store-shelf', 4.3, 2.0, fl, { yaw: 90 }),
      at('vending-machine', 3.5, -1.0, fl),
      at('vending-machine', 4.55, -1.0, fl),
      at('vending-machine', 5.6, -1.0, fl),
      at('retail-wall-shelf', -4.5, -1.2, fl),
      at('market-bin', -0.5, 3.6, fl, { yaw: 14 }),
      at('wall-poster', -6.82, 0.5, fl, { yaw: 90 }),
      // stockroom, office, toilet
      at('store-shelf', 2.0, -4.84, fl),
      at('stock-cartons', 6.0, -3.0, fl, { yaw: 90 }),
      at('cardboard-bale', 0.2, -3.2, fl, { yaw: 5 }),
      at('cardboard-bale', 0.2, -3.2, fl + 0.86, { yaw: -8 }),
      at('desk', -4.4, -2.0, fl, { yaw: 180 }),
      at('office-chair', -4.4, -2.9, fl),
      at('filing-cabinet', -6.5, -2.4, fl, { yaw: 90 }),
      at('toilet', -5.5, -4.95, fl),
    ];
    return group('Store', n, { pos: [38, 0, 127.5], yaw: 180 });
  })();

  const gas = group('Gas station', [
    box(12, 122, 28, 131, 4.2, 4.6, C.canopy, { id: 'canopy' }),
    drawn(11.95, 121.95, 28.05, 131.05, 4.25, 4.55, C['store-red'], { id: 'canopy-band' }),
    drawn(12.2, 122.2, 27.8, 130.8, 4.17, 4.2, C.lamp, { id: 'canopy-lights' }),
    ...[
      [12.5, 122.5],
      [27.5, 122.5],
      [12.5, 130.5],
      [27.5, 130.5],
    ].map(([x, z], k) =>
      box(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0, 4.2, C.metal, { id: `canopy-post-${k + 1}` }),
    ),
    // pump islands: a kerb a step up, two pumps each, bollards at the ends
    ...[16.8, 23.2].flatMap((x, k) => [
      box(x - 0.6, 124, x + 0.6, 129, 0, 0.15, C.concrete, { id: `pump-island-${k + 1}` }),
      prefab('fuel-pump', x, 125.4, { id: `pump-${k * 2 + 1}`, yaw: 90 }, 0.15),
      prefab('fuel-pump', x, 127.6, { id: `pump-${k * 2 + 2}`, yaw: 90 }, 0.15),
      {
        type: 'cylinder',
        id: `bollard-${k * 2 + 1}`,
        pos: [x, 0.15, 123.75],
        radius: 0.13,
        height: 0.9,
        sides: 8,
        color: C.ladder,
      },
      {
        type: 'cylinder',
        id: `bollard-${k * 2 + 2}`,
        pos: [x, 0.15, 129.25],
        radius: 0.13,
        height: 0.9,
        sides: 8,
        color: C.ladder,
      },
    ]),
    prefab('car', 20, 126.8, { yaw: 2, colors: { paint: '#8a3a2e' } }, 0),
    // the price sign by the highway
    {
      type: 'cylinder',
      id: 'price-sign-pole',
      pos: [9.5, 0, 122.8],
      radius: 0.15,
      height: 6.2,
      sides: 8,
      color: C.metal,
    },
    drawn(8.2, 122.6, 10.8, 123.0, 4.4, 6.4, C['store-red'], { id: 'price-sign' }),
    drawn(8.4, 122.55, 10.6, 123.05, 4.6, 5.6, C.trim, { id: 'price-sign-face' }),
    store,
    // outside the store: an ice chest by the door, the gas cage on the side wall
    box(40.6, 121.3, 42.0, 122.0, 0, 0.95, C.trim, { id: 'ice-chest' }),
    drawn(45.3, 130.4, 46.6, 132.6, 1.75, 1.8, C.steel, { id: 'gas-cage-top' }),
    box(45.25, 130.4, 45.35, 132.6, 0, 1.8, C['steel-dark'], { id: 'gas-cage-back' }),
    ...[130.9, 131.4, 131.9].map((z, k) => ({
      type: 'cylinder',
      id: `gas-bottle-${k + 1}`,
      pos: [46.0, 0, z],
      radius: 0.17,
      height: 1.0,
      sides: 8,
      color: '#d8d4ca',
    })),
    // the back lot: a skip, pallets, tires, a car up on blocks
    prefab('skip-bin', 40.5, 137.5, { yaw: 8 }, 0),
    prefab('wood-pallet', 34.5, 136.2, { yaw: 20 }, 0),
    prefab('wood-pallet', 34.5, 136.2, { yaw: 14 }, 0.144),
    prefab('wood-pallet', 34.5, 136.2, { yaw: 25 }, 0.288),
    prefab('truck-tire-1', 31.5, 135.4, { yaw: 40 }, 0),
    prefab('car', 25.5, 140, { yaw: 72, colors: { paint: '#6a5a4a' } }, 0.2),
  ]);

  // ---------------------------------------------------------------- cover in the open
  // Cars along the houses' lane (staggered, so the 68 m lane has no clear line), and hard
  // cover over the open ground round the west spawns and south of the highway.
  const cover = group('West end cover', [
    prefab('car', 50.5, 80.4, { yaw: 91, colors: { paint: '#4a5a6a' } }, 0),
    prefab('car', 70.5, 82.3, { yaw: -88, colors: { paint: '#7a6a3a' } }, 0),
    prefab('rock-large', 72, 50.5, { yaw: 30 }, 0),
    prefab('log-pile', 82, 46, { yaw: 8 }, 0),
    prefab('lumber-stack', 38, 52.5, { yaw: 76 }, 0),
    prefab('rock', 40.5, 60.5, { yaw: 140 }, 0),
    prefab('bush-tall', 88, 56, {}, 0),
    prefab('car', 24, 104, { yaw: 25, colors: { paint: '#5a4a3a' } }, 0),
    prefab('rock-large', 33, 95, { yaw: -20 }, 0),
    prefab('bush-tall', 14, 92, {}, 0),
    prefab('rock', 16, 94, { yaw: 60 }, 0),
    prefab('lumber-stack-tall', 15.5, 109, { yaw: 10 }, 0),
    prefab('bush', 36, 108.5, {}, 0),
    prefab('rock-large', 58, 138, { yaw: 70 }, 0),
    prefab('bush-tall', 69, 141, {}, 0),
    prefab('rock', 84, 137, { yaw: 15 }, 0),
    prefab('bush', 92, 140.5, {}, 0),
    prefab('rock', 12, 139, { yaw: -35 }, 0),
    prefab('bush-tall', 9.5, 141.5, {}, 0),
    // In the field east of the west-1 spawn, where the MT-4 showcase stood until MT-11 (it
    // was cover there): tall stacks at an angle, alternating, a pile, a rock and a shed.
    prefab('lumber-stack-tall', 20, 52, { yaw: 32 }, 0),
    prefab('shed-small', 32, 50, { yaw: 4 }, 0),
    prefab('log-pile-tall', 28, 63, { yaw: -22 }, 0),
    prefab('bush-tall', 13, 67, {}, 0),
    prefab('lumber-stack-tall', 18, 74, { yaw: -35 }, 0),
    prefab('rock-large', 31, 76, { yaw: 15 }, 0),
  ]);

  return group('West end', [
    office,
    lookout,
    group('Sheds', sheds),
    group('Company houses', houses),
    gas,
    cover,
    label('Company houses', 62, 81),
    // The store and its pumps are one place on the map tab: "Gas station" (MT-11).
  ]);
}
