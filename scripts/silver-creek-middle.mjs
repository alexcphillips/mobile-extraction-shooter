// Silver Creek's middle and ridge (roadmap MT-7, 2026-11-10), used by gen-silver-creek.mjs:
// the log deck and loader crane, the timber yard maze, the log jam, log boom, road bridge and
// weir ford; the hunting cabin, campsite, deer stands and clear-cut on the ridge; and small
// groups of trees, each with something solid in it, as cover over the open ground.
//
// Claude's calls, easy to change; the reasons are in docs/design/maps/silver-creek.md
// (the middle and the ridge). World coordinates throughout: x east, z south, y up.

import { buildingKit } from './mapkit/building.mjs';

/**
 * h: the generator's helpers (box, drawn, group, prefab, along, label, C, r2, groundAt,
 * groundRange). s: the site (TRAIL, TRAIL_Y, DAM_Z, jamCenter, jamHalf, bridgeX, fordX, sx, sz).
 */
function kit(h, s) {
  const { prefab, r2, groundAt, groundRange, C } = h;
  Object.assign(C, {
    cabin: '#6b5036',
    'log-end': '#c9a46e',
    canvas: '#5f6b4a',
    tarp: '#3f5f7a',
    guard: '#a9adb0',
    'paint-white': '#d8d6d0',
    'paint-red': '#a8322c',
    'paint-green': '#3e5a3e',
  });
  /** A prefab standing on the terrain (its middle's ground). */
  const on = (name, x, z, extra = {}) => prefab(name, x, z, extra, r2(groundAt(x, z)));
  /** A prefab on the lowest ground under a footprint (a pile on a slope beds in uphill). */
  const bedded = (name, x, z, hw, hd, extra = {}) =>
    prefab(name, x, z, extra, r2(groundRange(x - hw, z - hd, x + hw, z + hd)[0]));
  /** A cylinder from a to b ([x, y, z]), as a log lying along that line. */
  const logLine = (a, b, radius, color, extra = {}) => {
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
  /**
   * A small group of trees used as cover: trees and bushes (concealment only, the leaves are
   * foliage) round something solid, a rock or a stump, so it stops shots too.
   */
  const copse = (name, parts) =>
    h.group(
      name,
      parts.map(([p, x, z, yaw = 0]) => on(p, x, z, yaw ? { yaw } : {})),
    );
  /**
   * A tall log pile set across the ridge trail's bench (z 17–23) at 20° from its north ('n')
   * or south ('s') edge: it blocks every line along the trail at eye height and leaves a 2 m
   * way past on the other side. Alternate them.
   */
  const trailPile = (x, side) =>
    prefab('log-pile-tall', x, side === 'n' ? 19 : 21, { yaw: side === 'n' ? 20 : -20 }, s.TRAIL_Y);
  return { on, bedded, logLine, copse, trailPile };
}

// ---------------------------------------------------------------------------- the middle

export function buildMiddle(h, s) {
  const { box, drawn, group, prefab, along, C, r2, groundAt } = h;
  const { on, bedded, logLine, copse, trailPile } = kit(h, s);
  const { jamCenter, jamHalf, bridgeX, fordX, TRAIL_Y } = s;

  // ------------------------------------------------------------- log deck
  // The graybox's five rows 4.5 m apart (2.7 m lanes) as log piles end to end: waist piles
  // (1.49 m) in rows 1, 3 and 5, eye-height piles (1.92 m) in rows 2 and 4. Each row its own:
  // row 2's cut-through is at the west, row 4's at the east, row 3 stops short with loose
  // logs, and row 5 has one tall pile mid-row to break the line along the deck's south face.
  const ROWS = [
    // Piles 6.6 m apart end to end (2026-11-16: 6.1 m put each one's logs into the next).
    { z: 33, piles: [105.5, 112.1, 118.7], tall: [], loose: [[125.2, 32.4, 16]] },
    { z: 37.5, piles: [107.5, 116.5, 123.1], tall: [0, 1, 2] }, // cut-through x 110.5–113.5
    {
      z: 42,
      piles: [105.5, 112.1],
      tall: [],
      loose: [
        [118.7, 41.5, 4],
        [119.3, 42.6, -7],
      ],
    },
    { z: 46.5, piles: [105.5, 112.1, 121.5], tall: [0, 1, 2] }, // cut-through x 115.1–118.5
    { z: 51, piles: [105.5, 112.1, 118.7], tall: [1] },
  ];
  const deck = [];
  ROWS.forEach((row, k) => {
    row.piles.forEach((x, i) => {
      const tall = row.tall.includes(i);
      deck.push(
        prefab(
          tall ? 'log-pile-tall' : 'log-pile',
          x,
          row.z,
          {
            id: `log-pile-${k + 1}-${i + 1}`,
            yaw: [0, 1.5, -1, 2, -2][(k + i) % 5],
          },
          0,
        ),
      );
    });
    for (const [x, z, yaw] of row.loose ?? []) deck.push(prefab('log', x, z, { yaw }, 0));
  });

  // The loader crane: the graybox's collision (cab perch at 6.6 m by ladder, player-only; the
  // engine house a 3.3 m drop beside it) dressed with cab windows, a counterweight and an
  // exhaust, and its boom swung out over the deck with a log in the grapple (drawn only).
  // Rebuilt 2026-11-17 (silver-creek.md → Log deck): the cab and tower keep their solids;
  // added a slewing ring, a roof lip, a lattice jib, outriggers on the west corners, and the
  // engine house made a room (doors north and south, the engine, a bench with a toolbox; its
  // roof is still the 3.3 m step down from the cab), a fuel tank beside it, and the
  // operator's bag left on the cab roof (`fire-watch`), the prize for climbing up.
  const tip = [117.5, 5.6, 44];
  const ck = buildingKit(h);
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const jibTop = [130, 6.5, 37];
  const jibLow = [130, 5.3, 37];
  const tipLow = [tip[0], tip[1] - 0.5, tip[2]];
  const CH = { x0: 131.5, x1: 136, z0: 35, z1: 39, fl: 0.1, top: 3.1 };
  const crane = group('Loader crane', [
    box(127.5, 34.5, 131.5, 39.5, -0.3, 1, C['dark-concrete'], { id: 'crane-base' }),
    box(129, 36, 131, 38, 1, 4.6, C.metal, { id: 'crane-tower' }),
    box(128.5, 35.5, 131.5, 38.5, 4.6, 6.6, C.ladder, { id: 'crane-cab' }),
    {
      type: 'ladder',
      id: 'crane-ladder',
      pos: [130, 1, 38],
      yaw: 0,
      height: 5.6,
      color: C.ladder,
    },
    drawn(128.45, 35.8, 131.55, 38.2, 5.0, 6.1, C.glass, { id: 'crane-windows-ns' }),
    drawn(128.8, 35.45, 131.2, 38.55, 5.0, 6.1, C.glass, { id: 'crane-windows-ew' }),
    drawn(128.35, 35.35, 131.65, 38.65, 6.45, 6.58, C['steel-dark'], { id: 'crane-cab-lip' }),
    drawn(128.4, 35.4, 131.6, 38.6, 4.6, 4.75, C['steel-dark'], { id: 'crane-cab-sill' }),
    {
      type: 'cylinder',
      id: 'crane-slew-ring',
      pos: [130, 4.3, 37],
      radius: 1.6,
      height: 0.3,
      sides: 12,
      color: C.dark,
      collide: false,
    },
    drawn(127.3, 36.2, 128.5, 37.8, 4.7, 5.7, C['steel-dark'], { id: 'crane-counterweight' }),
    drawn(127.25, 36.15, 127.3, 37.85, 5.0, 5.4, C.hazard, { id: 'crane-counterweight-stripe' }),
    // the jib: the old top chord, a lower chord and lacing between them
    along(jibTop, tip, 0.55, 0.6, C.ladder, { id: 'crane-jib' }),
    along(jibLow, tipLow, 0.18, 0.18, C.ladder, { id: 'crane-jib-low', collide: false }),
    ...[0, 1, 2, 3, 4, 5].map((k) =>
      along(lerp(jibLow, tipLow, k / 6), lerp(jibTop, tip, (k + 1) / 6), 0.08, 0.08, C.ladder, {
        id: `crane-jib-lacing-${k + 1}`,
        collide: false,
      }),
    ),
    drawn(tip[0] - 0.03, tip[2] - 0.03, tip[0] + 0.03, tip[2] + 0.03, 3.5, tip[1], C.dark, {
      id: 'crane-cable',
    }),
    drawn(tip[0] - 0.5, tip[2] - 0.3, tip[0] + 0.5, tip[2] + 0.3, 3.1, 3.5, C['steel-dark'], {
      id: 'crane-grapple',
    }),
    logLine([tip[0] - 3, 2.85, tip[2]], [tip[0] + 3, 2.85, tip[2] + 0.4], 0.27, C.log, {
      id: 'crane-log',
      collide: false,
    }),
    // outriggers on the west corners, their pads on the ground
    ...[
      [127.6, 34.6, 126.0, 33.2],
      [127.6, 39.4, 126.0, 40.8],
    ].flatMap(([x0, z0, x1, z1], k) => [
      along([x0, 0.7, z0], [x1, 0.25, z1], 0.25, 0.25, C.ladder, {
        id: `crane-outrigger-${k + 1}`,
        collide: true,
      }),
      drawn(x1 - 0.45, z1 - 0.45, x1 + 0.45, z1 + 0.45, 0, 0.15, C['steel-dark'], {
        id: `crane-outrigger-pad-${k + 1}`,
      }),
    ]),
    // The engine house: walls, the roof at 3.3 (the step down), doors north and south.
    box(CH.x0, CH.z0, CH.x1, CH.z1, -0.3, CH.fl, C['dark-concrete'], { id: 'crane-house-floor' }),
    ck.wX('crane-house-n', CH.x0, CH.x1, CH.z0 + 0.1, CH.fl, CH.top, C.metal, [
      ck.win(132.7, 1.0),
      ck.door(134.8),
    ]),
    ck.wX('crane-house-s', CH.x0, CH.x1, CH.z1 - 0.1, CH.fl, CH.top, C.metal, [ck.door(133.0)]),
    ck.wZ('crane-house-w', CH.x0 + 0.1, CH.z0 + 0.2, CH.z1 - 0.2, CH.fl, CH.top, C.metal),
    ck.wZ('crane-house-e', CH.x1 - 0.1, CH.z0 + 0.2, CH.z1 - 0.2, CH.fl, CH.top, C.metal),
    box(CH.x0 - 0.05, CH.z0 - 0.05, CH.x1 + 0.05, CH.z1 + 0.05, CH.top, 3.3, C.metal, {
      id: 'crane-house',
    }),
    ck.doorX('crane-house-door-n', 134.8, CH.z0 + 0.1, CH.fl),
    ck.doorX('crane-house-door-s', 133.0, CH.z1 - 0.1, CH.fl),
    {
      type: 'cylinder',
      id: 'crane-exhaust',
      pos: [135.2, 3.3, 36],
      radius: 0.1,
      height: 1.6,
      sides: 6,
      color: C['steel-dark'],
      collide: false,
    },
    drawn(136, 35.6, 136.03, 38.4, 0.6, 2.4, C['steel-dark'], { id: 'crane-louvres' }),
    // inside: the engine along the north wall, its radiator, a bench with the toolbox, a lamp
    box(131.9, 35.5, 133.9, 36.8, CH.fl, 1.5, C.machine, { id: 'crane-engine' }),
    drawn(133.9, 35.6, 134.0, 36.7, CH.fl + 0.2, 1.4, C.dark, { id: 'crane-radiator' }),
    drawn(132.6, 35.9, 133.2, 36.4, 1.5, 1.9, C['steel-dark'], { id: 'crane-engine-filter' }),
    box(135.1, 36.9, CH.x1 - 0.2, CH.z1 - 0.2, CH.fl, 1.0, C.timber, { id: 'crane-bench' }),
    prefab('toolbox', 135.45, 37.7, { id: 'crane-toolbox', yaw: 90 }, 1.0),
    drawn(133.6, 36.9, 134.0, 37.3, 2.95, 3.08, C.lamp, { id: 'crane-house-lamp' }),
    // the fuel tank on its saddles east of the house: waist cover
    logLine([136.6, 1.0, 36.3], [139.0, 1.0, 36.3], 0.55, C['paint-red'], {
      id: 'crane-fuel-tank',
      collide: false,
    }),
    box(136.6, 35.75, 139.0, 36.85, 0.45, 1.55, C['paint-red'], {
      id: 'crane-fuel-tank-solid',
      invisible: true,
      stopsShots: true,
    }),
    ...[136.9, 138.7].map((x, k) =>
      box(x - 0.15, 35.8, x + 0.15, 36.8, 0, 0.45, C['steel-dark'], {
        id: `crane-fuel-saddle-${k + 1}`,
      }),
    ),
    {
      type: 'lootSpawn',
      id: 'crane-cab-bag',
      pos: [129.2, 6.6, 36.0],
      lootTable: 'fire-watch',
      chance: 0.4,
    },
  ]);
  // The rollway: logs pushed off the deck's east end into the pond, and a pile left on the
  // bank. Cover where the boom's west end meets the shore. Rebuilt 2026-11-17: four timber
  // skids down the bank into the water (drawn), a log held at the top by the stop log
  // chained to two posts (both waist-high and solid: low cover facing the boom's west end,
  // too low to stand on as a perch), one mid-roll and one afloat (drawn), and a rack of cant
  // hooks by the deck.
  const gy = (x, z) => r2(Math.max(groundAt(x, z), -1.4));
  const RZ = [46.6, 48.4, 50.2, 52.0];
  const rollway = group('Rollway', [
    prefab('log-pile', 134.2, 47.6, { yaw: 84 }, 0),
    ...RZ.flatMap((z, k) => [
      along(
        [135.8, gy(135.8, z) + 0.1, z],
        [139.0, gy(139.0, z) + 0.1, z],
        0.22,
        0.16,
        C['timber-dark'],
        {
          id: `rollway-skid-${k + 1}a`,
          collide: false,
        },
      ),
      along(
        [139.0, gy(139.0, z) + 0.1, z],
        [143.2, gy(143.2, z) + 0.1, z],
        0.22,
        0.16,
        C['timber-dark'],
        {
          id: `rollway-skid-${k + 1}b`,
          collide: false,
        },
      ),
    ]),
    // the waiting log and the stop log in front of it, both solid; the stop posts and chains
    logLine([136.6, 0.36, 46.1], [136.6, 0.36, 52.6], 0.3, C.log, { id: 'rollway-log-top' }),
    logLine([137.4, 0.28, 46.3], [137.4, 0.28, 52.4], 0.22, C['log-end'], {
      id: 'rollway-stop-log',
    }),
    ...[45.8, 52.8].flatMap((z, k) => [
      box(137.75, z - 0.12, 137.99, z + 0.12, 0, 1.0, C['timber-dark'], {
        id: `rollway-post-${k + 1}`,
      }),
      along([137.87, 0.9, z], [137.4, 0.4, z + (k ? -0.5 : 0.5)], 0.04, 0.04, C.dark, {
        id: `rollway-chain-${k + 1}`,
        collide: false,
      }),
    ]),
    logLine(
      [140.4, gy(140.4, 49.4) + 0.38, 46.4],
      [140.6, gy(140.6, 49.4) + 0.38, 52.4],
      0.28,
      C.log,
      {
        id: 'rollway-log-rolling',
      },
    ),
    logLine([146.2, -0.62, 46.8], [145.0, -0.62, 52.8], 0.3, C.log, {
      id: 'rollway-log-afloat',
    }),
    // the cant hook rack: two posts, a bar, three hooks leaning on it
    ...[133.0, 134.6].map((x, k) =>
      drawn(x - 0.05, 53.75, x + 0.05, 53.85, 0, 1.1, C['timber-dark'], {
        id: `rollway-rack-post-${k + 1}`,
      }),
    ),
    drawn(132.9, 53.76, 134.7, 53.84, 1.0, 1.08, C['timber-dark'], { id: 'rollway-rack-bar' }),
    ...[133.3, 133.8, 134.3].map((x, k) =>
      along([x, 0, 54.35], [x + 0.08, 1.15, 53.85], 0.05, 0.05, C.timber, {
        id: `rollway-cant-hook-${k + 1}`,
        collide: false,
      }),
    ),
    on('rock-large', 129.5, 52.6, { yaw: 25 }),
  ]);

  // ------------------------------------------------------------- timber yard
  // The graybox's ten blocks filled with lumber stacks (4.8 × 1.2 m, 1.2 m or two high at
  // 2.4 m), rows 0.1 m apart so no one fits between them. Each block has its own pattern:
  // T tall, L low, - a stack missing. A low stack beside a tall one is a way up (jump and
  // vault 1.2 m at a time): the tall tops are a player-only layer over the maze, seen from
  // everywhere in it and dropped off unhurt (2.4 m).
  const BLOCKS = [
    [101, 73, 110, 77, ['TT', 'TT', 'T-']], // its last stack toppled: below
    [113, 73, 117, 83, ['LL', 'LL', 'L-']],
    [121, 73, 132, 77, ['TT', 'TT', 'TT']],
    [101, 80, 105, 90, ['LT', 'TT', 'TT']],
    [108, 86, 120, 90, ['LL', 'LT', 'LL']],
    [124, 81, 128, 93, ['TT', 'TT', 'T-']],
    [101, 95, 111, 99, ['TT', 'TT', 'LT']],
    [114, 93, 118, 103, ['TT', 'T-', 'TT']],
    [121, 98, 132, 102, ['LL', 'LL', 'LL']],
    [108, 101, 112, 105, ['T', 'T', 'L']],
  ];
  const LEN = 4.8;
  const DEEP = 1.2;
  const yard = [];
  BLOCKS.forEach(([x0, z0, x1, z1, rows], b) => {
    const alongX = x1 - x0 >= z1 - z0;
    const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
    const n = rows[0].length;
    rows.forEach((row, r) => {
      const across = (r - (rows.length - 1) / 2) * (DEEP + 0.1);
      [...row].forEach((c, i) => {
        if (c === '-') return;
        const at = (i - (n - 1) / 2) * (LEN + 0.15);
        const [x, z] = alongX ? [cx + at, cz + across] : [cx + across, cz + at];
        const name = c === 'T' ? 'lumber-stack-tall' : 'lumber-stack';
        const extra = { id: `lumber-${b + 1}-${r + 1}-${i + 1}` };
        if (!alongX) extra.yaw = 90;
        yard.push(prefab(name, r2(x), r2(z), extra, 0));
      });
    });
  });
  yard.push(
    prefab('forklift', 120.2, 82.4, { yaw: 32 }, 0),
    prefab('wood-pallet', 111.5, 79.2, { yaw: 8 }, 0),
    prefab('wood-pallet', 111.7, 80.6, { yaw: -5 }, 0),
    prefab('steel-barrel', 133.2, 79.2, {}, 0),
    // The tally shack at the yard's gate, off the lane from the highway.
    prefab(
      'shed-small',
      97.8,
      76,
      { id: 'tally-shack', yaw: 90, colors: { siding: C['siding-red'] } },
      0,
    ),
    prefab('flood-light', 99.8, 79.4, { yaw: 120 }, 0),
  );

  // The toppled stack (2026-11-17, the user's pick): block 1's last tall stack lost its top
  // half into the gate lane. The bottom half stands where it was, slid 0.15 m; the top half
  // leans on its south face as a low ramp (a way up for players, not the AI), its straps
  // snapped, and boards spilled across the lane as drawn clutter.
  {
    const [x, z] = [107.98, 76.45];
    const LOW = { lumber: '#c49a5e', 'lumber-dark': '#a57d48' };
    yard.push(prefab('lumber-stack', x, z, { id: 'toppled-base' }, 0));
    // the slab, 0.3 m thick: its top edge propped 0.6 m up the base's south face (its end's
    // bottom corner on the face), its far end on the ground. 0.6 m to the base's top is a
    // jump for a player and past the AI's 0.45 m step, so the stack tops stay player-only.
    const h = 0.3;
    const zb = z + 2.5;
    let th = 0.4;
    let za = z + 0.6;
    let topB = 0.02 + h;
    for (let i = 0; i < 4; i++) {
      za = z + 0.6 + h * Math.sin(th);
      topB = 0.02 + h * Math.cos(th);
      th = Math.atan2(0.6 - topB, zb - za);
    }
    const [ny, nz] = [Math.cos(th) * (h / 2), Math.sin(th) * (h / 2)];
    yard.push(
      along([x + 0.4, 0.6 - ny, za - nz], [x + 0.4, topB - ny, zb - nz], 4.4, h, LOW.lumber, {
        id: 'toppled-half',
        collide: true,
      }),
      along(
        [x + 0.4, 0.6 + 0.005, za + 0.05],
        [x + 0.4, topB + 0.005, zb - 0.05],
        4.2,
        0.01,
        LOW['lumber-dark'],
        { id: 'toppled-half-grain' },
      ),
    );
    // board joints across its top and its two straps down the slope, drawn, so it reads as
    // a slid stack, not a ramp
    const topAt = (t) => [0.6 + (topB - 0.6) * t, za + (zb - za) * t];
    for (let k = 1; k < 7; k++) {
      const [ty, tz] = topAt(k / 7);
      yard.push(
        drawn(
          x + 0.4 - 2.2,
          tz - 0.02,
          x + 0.4 + 2.2,
          tz + 0.02,
          ty,
          ty + 0.012,
          LOW['lumber-dark'],
          {
            id: `toppled-joint-${k}`,
            pitch: r2((th * 180) / Math.PI),
          },
        ),
      );
    }
    for (const [k, dx] of [-1.4, 1.4].entries()) {
      const [y0, z0] = topAt(0.02);
      const [y1, z1] = topAt(0.98);
      yard.push(
        along(
          [x + 0.4 + dx, y0 + 0.015, z0],
          [x + 0.4 + dx, y1 + 0.015, z1],
          0.05,
          0.01,
          '#6e7378',
          {
            id: `toppled-half-strap-${k + 1}`,
          },
        ),
      );
    }
    // snapped straps hanging off the base, drawn
    for (const [k, dx] of [-1.4, 1.4].entries())
      yard.push(
        along([x + dx, 1.2, z + 0.62], [x + dx + 0.2, 0.35, z + 0.75], 0.05, 0.01, C.steel, {
          id: `toppled-strap-${k + 1}`,
        }),
      );
    // boards spilled across the lane: [x, z, yaw°], each 3.6 × 0.15 × 0.04, drawn
    const boards = [
      [104.6, 79.6, 12],
      [106.2, 80.3, -8],
      [109.4, 79.9, 24],
      [110.6, 80.9, -16],
      [107.6, 81.1, 4],
      [105.1, 81.3, -28],
    ];
    boards.forEach(([bx, bz, yaw], k) =>
      yard.push(
        drawn(
          bx - 1.8,
          bz - 0.075,
          bx + 1.8,
          bz + 0.075,
          0.01 + (k % 2) * 0.04,
          0.05 + (k % 2) * 0.04,
          k % 2 ? LOW['lumber-dark'] : LOW.lumber,
          {
            id: `spilled-board-${k + 1}`,
            yaw,
          },
        ),
      ),
    );
  }

  // The grading shed (2026-11-17, the user's pick): open-sided, roofed, between the yard's
  // east blocks and the saw hall's west way in, where boards were graded before stacking. A
  // long grading table down the middle (waist cover, 0.95 m) splits it into two aisles of
  // 2.2 m; the roof (3.3 to 3.7 m, out of reach from any stack top: the nearest is 3 m off)
  // is overhead cover from the stack-top perches. The grader's things on the table are a
  // loose spot (`lumber-yard`); a tally board at the south end, a pallet of sticker bundles,
  // a hose reel and a water barrel for fires.
  {
    const [x0, x1, z0, z1] = [131.5, 137.0, 83.5, 92.5];
    const xm = (x0 + x1) / 2;
    const n = [];
    // posts: corners and the middle of each long side
    const posts = [
      [x0, z0],
      [x1, z0],
      [x0, (z0 + z1) / 2],
      [x1, (z0 + z1) / 2],
      [x0, z1],
      [x1, z1],
    ];
    posts.forEach(([px, pz], k) =>
      n.push(
        box(px - 0.1, pz - 0.1, px + 0.1, pz + 0.1, 0, px === x0 ? 3.62 : 3.22, C.timber, {
          id: `grading-post-${k + 1}`,
        }),
      ),
    );
    // the roof: a mono-pitch slab falling east, with corrugation ribs drawn on it
    const [ry0, ry1] = [3.75, 3.35];
    n.push(
      along(
        [x0 - 0.4, ry0, (z0 + z1) / 2],
        [x1 + 0.4, ry1, (z0 + z1) / 2],
        z1 - z0 + 0.8,
        0.12,
        C.roof,
        {
          id: 'grading-roof',
          collide: true,
        },
      ),
    );
    for (let k = 0; k < 9; k++) {
      const rz = z0 - 0.2 + k * ((z1 - z0 + 0.4) / 8);
      n.push(
        along(
          [x0 - 0.4, ry0 + 0.07, rz],
          [x1 + 0.4, ry1 + 0.07, rz],
          0.06,
          0.03,
          C['timber-dark'],
          {
            id: `grading-rib-${k + 1}`,
          },
        ),
      );
    }
    // beams under the roof along each long side, drawn
    n.push(
      drawn(x0 - 0.1, z0, x0 + 0.1, z1, 3.4, 3.62, C['timber-dark'], { id: 'grading-beam-w' }),
      drawn(x1 - 0.1, z0, x1 + 0.1, z1, 3.0, 3.22, C['timber-dark'], { id: 'grading-beam-e' }),
    );
    // the grading table: a solid bed, rollers and boards on it drawn
    const [tz0, tz1] = [z0 + 1.0, z1 - 1.0];
    n.push(box(xm - 0.5, tz0, xm + 0.5, tz1, 0, 0.9, C['timber-dark'], { id: 'grading-table' }));
    for (let z = tz0 + 0.3; z < tz1; z += 0.7)
      n.push(
        drawn(xm - 0.48, z - 0.04, xm + 0.48, z + 0.04, 0.9, 0.95, C.steel, {
          id: `grading-roller-${Math.round((z - tz0) * 10)}`,
        }),
      );
    n.push(
      drawn(xm - 0.3, tz0 + 0.6, xm + 0.3, tz0 + 4.2, 0.96, 1.0, C.lumber, {
        id: 'grading-boards-1',
        yaw: 3,
      }),
      drawn(xm - 0.25, tz0 + 0.8, xm + 0.25, tz0 + 4.0, 1.0, 1.03, '#a57d48', {
        id: 'grading-boards-2',
        yaw: -2,
      }),
      // the grader's stamp box and crayon tin, at the south end
      box(xm - 0.25, tz1 - 1.0, xm + 0.15, tz1 - 0.7, 0.9, 1.08, C.timber, {
        id: 'grading-stamp-box',
      }),
      drawn(xm + 0.22, tz1 - 0.95, xm + 0.34, tz1 - 0.83, 0.9, 0.98, C['paint-red'], {
        id: 'grading-tin',
      }),
      {
        type: 'lootSpawn',
        id: 'grading-loose',
        pos: [r2(xm + 0.1), 0.95, r2(tz0 + 5.0)],
        lootTable: 'lumber-yard',
        chance: 0.4,
      },
    );
    // tally board facing into the shed, hung on two crossbars between the south corner posts
    n.push(
      drawn(x0 + 0.1, z1 - 0.01, x1 - 0.1, z1 + 0.05, 1.2, 1.3, C['timber-dark'], {
        id: 'tally-rail-low',
      }),
      drawn(x0 + 0.1, z1 - 0.01, x1 - 0.1, z1 + 0.05, 1.9, 2.0, C['timber-dark'], {
        id: 'tally-rail-high',
      }),
      drawn(xm - 1.3, z1 - 0.05, xm + 1.3, z1 - 0.01, 1.1, 2.1, C['paint-green'], {
        id: 'tally-board',
      }),
    );
    for (let k = 0; k < 4; k++)
      n.push(
        drawn(
          xm - 1.1 + k * 0.6,
          z1 - 0.07,
          xm - 0.7 + k * 0.6,
          z1 - 0.05,
          1.5 + (k % 2) * 0.2,
          1.53 + (k % 2) * 0.2,
          C['paint-white'],
          {
            id: `tally-mark-${k + 1}`,
          },
        ),
      );
    // stool at the table, sticker bundles on a pallet, hose reel, water barrel
    n.push(
      prefab('wooden-chair', xm - 0.95, tz0 + 2.0, { id: 'grading-stool', yaw: 90 }, 0),
      prefab('wood-pallet', x1 - 0.85, z0 + 0.95, { id: 'sticker-pallet', yaw: 90 }, 0),
      drawn(x1 - 1.3, z0 + 0.5, x1 - 0.4, z0 + 1.4, 0.15, 0.45, C['timber-dark'], {
        id: 'sticker-bundle-1',
      }),
      drawn(x1 - 1.25, z0 + 0.55, x1 - 0.45, z0 + 1.35, 0.45, 0.7, '#6e5238', {
        id: 'sticker-bundle-2',
        yaw: 6,
      }),
      {
        type: 'cylinder',
        id: 'hose-reel',
        pos: [r2(x1 + 0.12), 1.0, r2((z0 + z1) / 2 + 0.6)],
        radius: 0.35,
        height: 0.18,
        roll: 90,
        sides: 10,
        color: C['paint-red'],
        collide: false,
      },
      prefab('hazard-barrel-red', x1 + 0.7, z1 + 0.4, { id: 'fire-barrel' }, 0),
    );
    yard.push(group('Grading shed', n));
  }

  // ------------------------------------------------------------- open ground
  // Copses and piles that break the field between the deck and the yard, the pond's north
  // shore (both sides of the creek) and the strip between the mill and the highway.
  const fields = group('Middle cover', [
    copse('Copse by the deck', [
      ['broadleaf-tree', 120, 61],
      ['pine-tree', 123.6, 63.6],
      ['pine-tree', 120.8, 65],
      ['bush-tall', 124.3, 61.2],
      ['rock', 122.3, 62.7, 30],
    ]),
    prefab('log-pile-tall', 101.5, 57.5, { yaw: 30 }, 0),
    prefab('log-pile-tall', 134, 58, { yaw: -30 }, 0),
    bedded('log-pile-tall', 118, 29.5, 3, 1, { yaw: 5 }),
    bedded('log-pile-tall', 86, 30, 3, 1, { yaw: -8 }),
    prefab('lumber-stack-tall', 131, 67.5, { yaw: 12 }, 0),
    copse('Copse north-west of the pond', [
      ['pine-tree', 142, 30],
      ['pine-tree', 145.5, 32.6],
      ['broadleaf-tree', 140.2, 33.6],
      ['bush', 144, 34.6],
      ['tree-stump', 143.1, 33.4, 40],
      ['rock', 141.6, 31.6, -20],
    ]),
    // The log dump on the north shore: a pile and logs rolled into the water.
    bedded('log-pile-tall', 176, 38, 1, 3, { yaw: 84 }),
    logLine([178.6, 0.2, 40.5], [181.8, -0.9, 45.8], 0.26, C.log, {
      id: 'dump-log-1',
    }),
    logLine([180, 0.2, 39], [184.6, -0.8, 43.6], 0.26, C.log, { id: 'dump-log-2' }),
    copse('Copse north-east of the pond', [
      ['pine-tree', 186, 31],
      ['pine-tree', 189.5, 33.5],
      ['broadleaf-tree', 191.2, 30],
      ['bush-tall', 187.5, 34.2],
      ['rock', 189, 35.6, 50],
    ]),
    prefab('log-pile-tall', 147, 40, { yaw: 75 }, 0),
    prefab('log-pile-tall', 196, 36.5, { yaw: 80 }, 0),
    on('rock-large', 199.5, 35.5, { yaw: -30 }),
    // Between the mill and the highway (the race tunnel runs under z 104–108: kept clear).
    // Solid 2.4 m lumber stacks set across the strip at 35°, so they cut lines along it at eye
    // height (a log pile blocks a standing eye only along its top log).
    prefab('lumber-stack-tall', 110, 111, { yaw: -35 }, 0),
    prefab('lumber-stack-tall', 132, 111, { yaw: 35 }, 0),
    prefab('lumber-stack-tall', 150, 111, { yaw: -35 }, 0),
    prefab('lumber-stack-tall', 183, 111, { yaw: -35 }, 0),
    prefab('skip-bin', 198, 110.8, { yaw: 4 }, 0),
    prefab('lumber-stack-tall', 207, 111, { yaw: 35 }, 0),
    prefab('lumber-stack-tall', 227, 112, { yaw: -35 }, 0),
    // The south bank, both sides of the ford.
    prefab('lumber-stack-tall', 108, 137, { yaw: -35 }, 0),
    prefab('lumber-stack-tall', 196, 127, { yaw: -35 }, 0),
    prefab('lumber-stack-tall', 205, 136, { yaw: 35 }, 0),
    prefab('lumber-stack-tall', 150, 124.5, { yaw: 20 }, 0),
    prefab('lumber-stack-tall', 178.5, 124.5, { yaw: -20 }, 0),
    prefab('lumber-stack-tall', 222, 137, { yaw: -30 }, 0),
    // The ridge's foot, north of the deck and the pond.
    bedded('log-pile-tall', 144, 26, 3, 1, { yaw: 15 }),
    bedded('log-pile-tall', 178, 27.5, 3, 1, { yaw: -10 }),
    prefab('lumber-stack-tall', 208, 29, { yaw: 30 }, 0),
    on('bush-tall', 130, 26.5),
    on('rock', 131.4, 27.2, { yaw: 10 }),
    // The field between the deck and the yard.
    prefab('lumber-stack-tall', 112, 55.5, { yaw: 30 }, 0),
    prefab('lumber-stack-tall', 125, 70.5, { yaw: -30 }, 0),
    copse('Copse on the south bank east', [
      ['pine-tree', 212, 128],
      ['broadleaf-tree', 215.5, 130],
      ['pine-tree', 213.5, 132.2],
      ['bush-tall', 216.6, 127.6],
      ['rock', 214.2, 129.8, 35],
    ]),
  ]);

  // ------------------------------------------------------------- log jam
  // The graybox's logs across the ravine at trail height, with the jam's tangle piled against
  // their upstream face (drawn only: no climbing out of the water onto it), and hard cover on
  // the trail either side, staggered across it so the trail has no clear line to the jam.
  const logJam = group('Log jam', [
    ...[18.4, 19.2, 20, 20.8, 21.6].map((z, k) =>
      box(
        jamCenter - jamHalf + (k % 2),
        z - 0.4,
        jamCenter + jamHalf - ((k + 1) % 2),
        z + 0.4,
        TRAIL_Y - 0.8,
        TRAIL_Y,
        C.log,
        { id: `jam-log-${k + 1}` },
      ),
    ),
    ...[
      [156, 16, 30],
      [164, 21.5, -25],
      [160, 15.5, 70],
    ].map(([x, z, yaw], k) => ({
      type: 'box',
      id: `jam-loose-${k + 1}`,
      pos: [x, TRAIL_Y - 2.2, z],
      size: [0.7, 0.7, 9],
      yaw,
      pitch: 12,
      color: C.log,
      collide: false,
    })),
    ...[
      [
        [153, -0.6, 12.5],
        [156.5, 2.2, 17.6],
      ],
      [
        [158.2, -0.7, 12],
        [157.4, 2.3, 17.7],
      ],
      [
        [161, -0.5, 13.2],
        [163.8, 2.1, 17.6],
      ],
      [
        [165.5, -0.7, 12.8],
        [162.4, 2.2, 17.7],
      ],
      [
        [150.5, 0.6, 15.6],
        [168.5, 1.3, 16.4],
      ],
    ].map(([a, b], k) => logLine(a, b, 0.3, C.log, { id: `jam-tangle-${k + 1}`, collide: false })),
    // Dressed 2026-11-17: a pack snagged on the jam's upstream edge (`duffle-bag`), searched
    // standing on the crossing in sight of both banks; a broken pike pole on the logs; on
    // the west bank a winch on a skid, anchored to a stump, its cable run out to the tangle
    // (someone tried to pull it clear).
    prefab('duffle-bag', 157.6, 18.55, { id: 'jam-snagged-pack', yaw: 80 }, TRAIL_Y),
    along([162.5, TRAIL_Y + 0.05, 19.0], [164.3, TRAIL_Y + 0.07, 19.8], 0.06, 0.06, C.timber, {
      id: 'jam-pike-pole',
      collide: false,
    }),
    along([164.6, TRAIL_Y + 0.05, 19.9], [165.5, TRAIL_Y + 0.12, 20.6], 0.06, 0.06, C.timber, {
      id: 'jam-pike-pole-end',
      collide: false,
    }),
    box(145.2, 18.3, 146.8, 19.1, TRAIL_Y, TRAIL_Y + 0.35, C['steel-dark'], {
      id: 'jam-winch-skid',
    }),
    {
      type: 'cylinder',
      id: 'jam-winch-drum',
      pos: [146.0, TRAIL_Y + 0.75 - 0.6, 18.7],
      radius: 0.4,
      height: 1.2,
      roll: 90,
      sides: 8,
      color: C['paint-red'],
      collide: false,
    },
    prefab('tree-stump', 143.6, 18.7, { id: 'jam-winch-anchor' }, TRAIL_Y),
    along([143.8, TRAIL_Y + 0.4, 18.7], [145.3, TRAIL_Y + 0.6, 18.7], 0.03, 0.03, C.dark, {
      id: 'jam-winch-strop',
      collide: false,
    }),
    along([146.6, TRAIL_Y + 0.75, 18.6], [153.5, 1.4, 16.0], 0.03, 0.03, C.dark, {
      id: 'jam-winch-cable',
      collide: false,
    }),
    // On the trail: tall piles set across it, alternately from its north and south edges
    // (trailPile), and a rock and a bush by the jam's west end.
    trailPile(140, 'n'),
    prefab('rock-large', 144.8, 21.8, { yaw: 5 }, TRAIL_Y),
    on('bush-tall', 146.6, 22.4),
    trailPile(179, 's'),
    trailPile(190, 'n'),
  ]);

  // ------------------------------------------------------------- log boom
  // Ten logs bank to bank, chained (drawn), and mid-pond the raft with the boom man's shack,
  // now a hut you can go into: doors west and east at opposite ends, so the line along the
  // boom stays broken (MT-3), and windows north and south onto the pond.
  const boom = [];
  for (let k = 0; k < 10; k++) {
    const x0 = 131 + k * ((199 - 131 - 7.2) / 9);
    const z = 56 + (k % 2 ? 0.25 : -0.25);
    boom.push(box(x0, z - 0.6, x0 + 7.2, z + 0.6, -0.5, 0.05, C.log, { id: `boom-log-${k + 1}` }));
    // a painted float mid-log on every other one, to mark the boom (drawn)
    if (k % 2 === 0)
      boom.push(
        drawn(x0 + 3.4, z - 0.22, x0 + 3.8, z + 0.22, 0.05, 0.22, C['paint-red'], {
          id: `boom-float-${k / 2 + 1}`,
        }),
      );
    if (k > 0)
      boom.push(
        drawn(x0 - 0.35, 55.9, x0 + 0.35, 56.1, 0.05, 0.1, C.dark, { id: `boom-chain-${k}` }),
      );
  }
  const { wX, wZ, doorZ, win } = buildingKit(h);
  const SY = 0.05;
  const shackTop = SY + 2.4;
  boom.push(
    box(160, 51.5, 170, 60.5, -0.5, SY, C.timber, { id: 'boom-raft' }),
    wX('boom-shack-n', 163.5, 166.5, 54.4, SY, shackTop, C['timber-dark'], [win(165)]),
    wX('boom-shack-s', 163.5, 166.5, 57.6, SY, shackTop, C['timber-dark'], [win(165)]),
    wZ('boom-shack-w', 163.6, 54.5, 57.5, SY, shackTop, C['timber-dark'], [
      { at: 55.3, width: 1.2, bottom: 0, top: 2.1 },
    ]),
    wZ('boom-shack-e', 166.4, 54.5, 57.5, SY, shackTop, C['timber-dark'], [
      { at: 56.7, width: 1.2, bottom: 0, top: 2.1 },
    ]),
    doorZ('boom-shack-door-w', 163.6, 55.3, SY),
    doorZ('boom-shack-door-e', 166.4, 56.7, SY),
    box(163.3, 54.1, 166.7, 57.9, shackTop, shackTop + 0.15, C.roof, { id: 'boom-shack-roof' }),
    drawn(164, 57, 164.9, 57.4, SY, SY + 0.75, C['steel-dark'], { id: 'boom-shack-stove' }),
    // Dressed 2026-11-17: the boom man's footlocker against the north wall (`footlocker`),
    // his chair moved to the stove, a lantern, his oilskin on a peg, a bench on the raft.
    // The quest spot mid-floor stays clear.
    prefab('wooden-chair', 164.9, 56.4, { yaw: 200 }, SY),
    prefab('footlocker', 165.65, 54.85, { id: 'boom-shack-footlocker' }, SY),
    // the boom man's odds and ends by the stove (household)
    {
      type: 'lootSpawn',
      id: 'boom-shack-spot',
      pos: [164.5, SY, 56.75],
      lootTable: 'household',
      chance: 0.25,
    },
    drawn(164.38, 57.13, 164.52, 57.27, SY + 0.75, shackTop, C.dark, { id: 'boom-shack-flue' }),
    drawn(164.98, 55.98, 165.02, 56.02, SY + 1.95, shackTop, C.dark, {
      id: 'boom-shack-lantern-cord',
    }),
    drawn(164.88, 55.88, 165.12, 56.12, SY + 1.7, SY + 1.95, C.lamp, { id: 'boom-shack-lantern' }),
    drawn(166.22, 55.2, 166.3, 55.9, SY + 0.9, SY + 1.8, C.hazard, { id: 'boom-shack-oilskin' }),
    box(160.4, 56.6, 161.0, 58.6, SY, SY + 0.45, C['timber-dark'], { id: 'boom-raft-bench' }),
    // pike poles on the raft, a drum and a coil of chain
    along([160.6, 0.1, 52.2], [162.2, 0.25, 59.8], 0.06, 0.06, C.timber, { id: 'pike-pole-1' }),
    along([168.4, 0.1, 52], [169.2, 0.2, 59.4], 0.06, 0.06, C.timber, { id: 'pike-pole-2' }),
    prefab('steel-barrel', 168.2, 58.9, {}, SY),
    {
      type: 'cylinder',
      id: 'boom-coil',
      pos: [161.6, SY, 53],
      radius: 0.4,
      height: 0.18,
      sides: 8,
      color: C.dark,
      collide: false,
    },
  );

  // ------------------------------------------------------------- road bridge
  const bx0 = bridgeX - 11;
  const bx1 = bridgeX + 11;
  const posts = [];
  for (let k = 0; k <= 6; k++) {
    const x = bx0 + 0.3 + k * ((bx1 - bx0 - 0.6) / 6);
    for (const [z, side] of [
      [114.62, 'n'],
      [121.38, 's'],
    ])
      posts.push(
        drawn(x - 0.17, z - 0.17, x + 0.17, z + 0.17, 0.3, 1.42, C['dark-concrete'], {
          id: `bridge-post-${side}-${k + 1}`,
        }),
      );
  }
  /** Steel guard rail on the approach: waist high, solid (vault it). */
  const guard = (id, x0, x1, z) => box(x0, z - 0.1, x1, z + 0.1, 0, 0.8, C.guard, { id });
  const lamp = (id, x, z) =>
    group(`Lamp ${id}`, [
      {
        type: 'cylinder',
        id: `lamp-${id}-pole`,
        pos: [x, 0.3, z],
        radius: 0.09,
        height: 6.2,
        sides: 6,
        color: C['steel-dark'],
      },
      along([x, 6.4, z], [x, 6.4, z + (z < 118 ? 1.6 : -1.6)], 0.12, 0.12, C['steel-dark'], {
        id: `lamp-${id}-arm`,
      }),
      drawn(
        x - 0.25,
        z + (z < 118 ? 1.3 : -1.9),
        x + 0.25,
        z + (z < 118 ? 1.9 : -1.3),
        6.15,
        6.35,
        C.lamp,
        {
          id: `lamp-${id}-head`,
        },
      ),
    ]);
  const bridge = group('Road bridge', [
    box(bx0, 114.5, bx1, 121.5, -0.3, 0.3, C.concrete, { id: 'bridge-deck' }),
    box(bx0, 114.5, bx1, 114.75, 0.3, 1.3, C.concrete, { id: 'bridge-rail-n' }),
    box(bx0, 121.25, bx1, 121.5, 0.3, 1.3, C.concrete, { id: 'bridge-rail-s' }),
    box(bridgeX - 1, 115, bridgeX + 1, 121, -4.3, -0.3, C['dark-concrete'], { id: 'bridge-pier' }),
    box(bridgeX - 8.6, 114.3, bridgeX - 7.6, 121.7, -4.3, -0.3, C['dark-concrete'], {
      id: 'bridge-abutment-w',
    }),
    box(bridgeX + 7.6, 114.3, bridgeX + 8.6, 121.7, -4.3, -0.3, C['dark-concrete'], {
      id: 'bridge-abutment-e',
    }),
    drawn(bx0, 114.47, bx1, 114.5, -0.25, 0.25, C['paint-green'], { id: 'bridge-fascia-n' }),
    drawn(bx0, 121.5, bx1, 121.53, -0.25, 0.25, C['paint-green'], { id: 'bridge-fascia-s' }),
    ...posts,
    guard('guard-nw', bx0 - 7, bx0, 114.4),
    guard('guard-ne', bx1, bx1 + 6, 114.4),
    guard('guard-se', bx1, bx1 + 7, 121.6),
    lamp('w', bx0 - 0.6, 113.9),
    lamp('e', bx1 + 0.6, 122.1),
  ]);

  // Abandoned trucks on the highway (MT-3): each straddles the center line from its own lane,
  // so no line runs the length of the road (truck-3, the tanker, is in the east script). The
  // two at the bridge are dressed: a loaded log truck west of it (eastbound, south lane) and
  // a tractor unit east of it (westbound).
  const LT = { x0: 136, x1: 146.3, z: 119.45 };
  const logLoad = [];
  [
    [-0.66, 0],
    [0, 0],
    [0.66, 0],
    [-0.33, 1],
    [0.33, 1],
    [0, 2],
  ].forEach(([dz, row], k) => {
    const y = 1.45 + 0.31 + row * 0.55;
    logLoad.push(
      logLine(
        [LT.x0 + 0.2 + (k % 2) * 0.3, y, LT.z + dz],
        [LT.x1 - 0.4 + (k % 3) * 0.2, y, LT.z + dz],
        0.31,
        C.log,
        {
          id: `log-truck-log-${k + 1}`,
        },
      ),
    );
  });
  const logTruck = group('Log truck', [
    prefab(
      'semi-tractor',
      147.6,
      LT.z,
      { id: 'log-truck-tractor', yaw: 90, colors: { cab: '#7a2e24', 'cab-dark': '#5a2018' } },
      0,
    ),
    box(LT.x0, LT.z - 1.15, LT.x1, LT.z + 1.15, 0.95, 1.3, C['steel-dark'], {
      id: 'log-truck-frame',
    }),
    // Stops a prone body crawling under the trailer; sight and shots still pass under it.
    box(LT.x0 + 0.2, LT.z - 1.1, LT.x1 - 0.2, LT.z + 1.1, 0, 0.95, '#5a8ab8', {
      id: 'log-truck-blocker',
      invisible: true,
    }),
    ...[137.4, 141.2, 145].flatMap((x, k) => [
      drawn(x - 0.12, LT.z - 1.3, x + 0.12, LT.z + 1.3, 1.3, 1.5, C['steel-dark'], {
        id: `log-truck-bunk-${k + 1}`,
      }),
      drawn(x - 0.07, LT.z - 1.3, x + 0.07, LT.z - 1.16, 1.5, 3.1, C['steel-dark'], {
        id: `log-truck-stake-n${k + 1}`,
      }),
      drawn(x - 0.07, LT.z + 1.16, x + 0.07, LT.z + 1.3, 1.5, 3.1, C['steel-dark'], {
        id: `log-truck-stake-s${k + 1}`,
      }),
    ]),
    ...[137.2, 138.5].flatMap((x, k) =>
      [-1, 1].map((side) => ({
        type: 'cylinder',
        id: `log-truck-wheel-${k + 1}${side < 0 ? 'n' : 's'}`,
        pos: [x, 0.25, LT.z + side * 0.9],
        radius: 0.5,
        height: 0.5,
        sides: 10,
        pitch: 90,
        color: C.dark,
        collide: false,
      })),
    ),
    ...logLoad,
  ]);
  // Truck-1 (MT-11, was a plain block): an abandoned box truck, cab east, standing 12° across
  // the north lane and the center line where the block stood, so it shades as much of the
  // road as the 3.5 m block did. The box and cab collide; a body-only blocker under the box
  // stops a prone crawl beneath; the wheels collide (2026-11-17: no fake cover, a prone
  // body behind one is covered); trim is drawn. In its own frame, along x.
  const truck1 = group(
    'Box truck',
    [
      box(-3.5, -1.25, 1.4, 1.25, 0.9, 3.4, C['paint-white'], { id: 'truck-1' }),
      box(-3.5, -1.25, 1.4, 1.25, 0, 0.9, C.dark, { id: 'truck-1-blocker', invisible: true }),
      box(1.5, -1.15, 3.5, 1.15, 0.6, 2.6, '#5a6e7a', { id: 'truck-1-cab' }),
      drawn(2.9, -1.17, 3.52, 1.17, 1.7, 2.4, C.glass, { id: 'truck-1-windscreen' }),
      drawn(-3.52, -1.27, 1.42, 1.27, 1.05, 1.3, C.rust, { id: 'truck-1-stripe' }),
      drawn(-3.54, -0.05, -3.5, 0.05, 0.95, 3.35, C.metal, { id: 'truck-1-seam' }),
      drawn(-3.5, -0.5, 3.5, 0.5, 0.45, 0.9, C.dark, { id: 'truck-1-chassis' }),
      ...[-2.5, 0.1, 2.5].flatMap((x, k) =>
        [-1, 1].map((sd) => ({
          type: 'cylinder',
          id: `truck-1-wheel-${k + 1}${sd < 0 ? 'n' : 's'}`,
          pos: [x, 0.3, sd * 1.0],
          radius: 0.45,
          height: 0.3,
          sides: 10,
          pitch: 90,
          color: C.dark,
        })),
      ),
    ],
    { pos: [73.5, 0, 116.55], yaw: 12 },
  );
  const trucks = group('Highway trucks', [
    truck1,
    logTruck,
    prefab('semi-tractor', 185.4, 116.55, { id: 'truck-2', yaw: -90 }, 0),
  ]);

  // ------------------------------------------------------------- weir ford
  // The weir and its stepping stones, two boulders in the ford (waist cover above the water
  // for someone wading), a gauge post, a fallen tree downstream, and copses on both banks.
  const ford = group('Weir ford', [
    box(fordX - 6, 139.4, fordX + 6, 140.2, -2.6, -1.9, C.concrete, { id: 'weir' }),
    ...[
      [-1.7, 134.5],
      [1.5, 133.6],
      [3.5, 137.2],
      [-1, 138],
    ].map(([dx, z], k) =>
      box(fordX + dx - 0.6, z - 0.5, fordX + dx + 0.6, z + 0.5, -2.7, -1.6, C.stone, {
        id: `ford-rock-${k + 1}`,
      }),
    ),
    prefab('rock-large', fordX - 5, 135.6, { id: 'ford-boulder-1', yaw: 25 }, -2.6),
    prefab('rock-large', fordX + 4.8, 134.4, { id: 'ford-boulder-2', yaw: -60 }, -2.6),
    drawn(fordX + 6.2, 139.6, fordX + 6.4, 139.8, -2.6, 0.8, C['paint-white'], {
      id: 'ford-gauge',
    }),
    ...[-1.6, -0.6, 0.4].map((y, k) =>
      drawn(fordX + 6.18, 139.58, fordX + 6.42, 139.82, y, y + 0.12, C['paint-red'], {
        id: `ford-gauge-mark-${k + 1}`,
      }),
    ),
    logLine([fordX - 7, -1.3, 144], [fordX + 0.5, -1.55, 146.2], 0.32, C.log, {
      id: 'ford-fallen-tree',
      collide: true,
    }),
    // Most of it gave way to the powerhouse (2026-11-16); what's left stands by its east wall.
    copse('Copse on the ford west bank', [
      ['bush-tall', 148.2, 134.2],
      ['tree-stump', 147.8, 127.4, 70],
      ['rock-large', 148.6, 131.2, -15],
    ]),
    on('log', 150.5, 138.6, { yaw: 68 }),
    copse('Copse on the ford east bank', [
      ['broadleaf-tree', 182.5, 129.4],
      ['pine-tree', 185.8, 132],
      ['pine-tree', 183, 134.3],
      ['bush', 181, 132.4],
      ['rock', 185.2, 129.6, 10],
    ]),
    on('rock-large', 177.6, 136.2, { yaw: 40 }),
  ]);

  const dam = group('Mill dam', [
    box(156, s.DAM_Z - 1, 176, s.DAM_Z + 1, -4, 2.2, C.concrete, { id: 'dam' }),
  ]);

  // ---- dressed 2026-11-17 (silver-creek.md → Log deck, Mill pond): the scaler's shack at
  // the deck's south-east corner, paint marks on the row ends, a skiff pulled up on the
  // north-west shore and loose logs afloat by the rollway.
  /** The scaler's shack: one room, doors west and east, a window north over the deck. */
  const SC = { x0: 121, x1: 124, z0: 55, z1: 58, fl: 0.1, top: 2.6 };
  const scaler = group('Scaler shack', [
    box(SC.x0, SC.z0, SC.x1, SC.z1, -0.3, SC.fl, C['dark-concrete'], { id: 'scaler-floor' }),
    ck.wX(
      'scaler-wall-n',
      SC.x0,
      SC.x1,
      SC.z0 + 0.075,
      SC.fl,
      SC.top,
      C.cabin,
      [ck.win(122.5, 1.2)],
      0.15,
    ),
    ck.wX(
      'scaler-wall-s',
      SC.x0,
      SC.x1,
      SC.z1 - 0.075,
      SC.fl,
      SC.top,
      C.cabin,
      [ck.win(122.5, 0.8)],
      0.15,
    ),
    ck.wZ(
      'scaler-wall-w',
      SC.x0 + 0.075,
      SC.z0 + 0.15,
      SC.z1 - 0.15,
      SC.fl,
      SC.top,
      C.cabin,
      [ck.door(57.0)],
      0.15,
    ),
    ck.wZ(
      'scaler-wall-e',
      SC.x1 - 0.075,
      SC.z0 + 0.15,
      SC.z1 - 0.15,
      SC.fl,
      SC.top,
      C.cabin,
      [ck.door(57.0)],
      0.15,
    ),
    ck.doorZ('scaler-door-w', SC.x0 + 0.075, 57.0, SC.fl),
    ck.doorZ('scaler-door-e', SC.x1 - 0.075, 57.0, SC.fl),
    box(SC.x0 - 0.3, SC.z0 - 0.3, SC.x1 + 0.3, SC.z1 + 0.3, SC.top, SC.top + 0.15, C.roof, {
      id: 'scaler-roof',
    }),
    prefab('desk', 122.5, 55.55, { id: 'scaler-desk' }, SC.fl),
    prefab('wooden-chair', 122.5, 56.15, { id: 'scaler-chair', yaw: 180 }, SC.fl),
    {
      type: 'lootSpawn',
      id: 'scaler-book',
      pos: [122.5, SC.fl + 0.75, 55.55],
      lootTable: 'documents',
      chance: 0.45,
    },
    // the tally board on the south wall, the scale stick leaning in the corner, a stove
    drawn(121.4, SC.z1 - 0.17, 122.1, SC.z1 - 0.15, SC.fl + 1.2, SC.fl + 1.8, C['paint-white'], {
      id: 'scaler-tally',
    }),
    along([123.7, SC.fl, 57.75], [123.78, SC.fl + 1.3, 57.8], 0.04, 0.03, C['log-end'], {
      id: 'scaler-stick',
      collide: false,
    }),
    box(123.3, 55.3, 123.8, 55.8, SC.fl, SC.fl + 0.7, C.dark, { id: 'scaler-stove' }),
    drawn(123.5, 55.5, 123.6, 55.6, SC.fl + 0.7, SC.top + 0.5, C.dark, { id: 'scaler-flue' }),
    drawn(121.3, SC.z0 - 0.02, 123.7, SC.z0, 2.15, 2.4, C['paint-white'], { id: 'scaler-sign' }),
  ]);
  /**
   * Paint on one log end at each row's east end (the scaler's marks: whose logs, and
   * checked), drawn. [pile x, row z, pile yaw, the log's offset across the pile, color]: the
   * bottom log at +z 0.5 (log-pile) or +0.25 (log-pile-tall), its end 3.05 m out.
   */
  const marks = [
    [118.7, 33, -1, 0.5, '#3e5a8a'],
    [123.1, 37.5, 2, 0.25, C['paint-red']],
    [112.1, 42, 2, 0.5, '#3e5a8a'],
    [121.5, 46.5, 0, 0.25, C['paint-red']],
    [118.7, 51, 1.5, 0.5, '#3e5a8a'],
  ].map(([px, pz, yaw, lz, c], k) => {
    const t = (yaw * Math.PI) / 180;
    const x = px + 3.05 * Math.cos(t) + lz * Math.sin(t);
    const z = pz - 3.05 * Math.sin(t) + lz * Math.cos(t);
    return drawn(x, z - 0.13, x + 0.03, z + 0.13, 0.24, 0.5, c, { id: `deck-mark-${k + 1}` });
  });
  /** The skiff pulled up on the north-west shore, its bow in the water, oars in it. */
  const skiff = [
    box(142.6, 43.05, 146.4, 44.35, -0.1, 0.55, C['paint-green'], { id: 'skiff-hull' }),
    drawn(142.7, 43.15, 146.3, 44.25, 0.55, 0.57, C['timber-dark'], { id: 'skiff-inside' }),
    drawn(146.4, 43.25, 147.0, 44.15, 0.0, 0.55, C['paint-green'], {
      id: 'skiff-bow',
      top: [0.2, 0.5],
    }),
    drawn(142.58, 43.03, 146.42, 44.37, 0.5, 0.6, C['paint-white'], { id: 'skiff-gunwale' }),
    drawn(144.3, 43.1, 144.5, 44.3, 0.55, 0.62, C.timber, { id: 'skiff-thwart' }),
    ...[43.4, 44.0].map((z, k) =>
      along([143.0, 0.62, z], [146.0, 0.66, z + 0.05], 0.05, 0.05, C.timber, {
        id: `skiff-oar-${k + 1}`,
        collide: false,
      }),
    ),
  ];
  const afloat = [
    [
      [148.5, -0.62, 48.0],
      [150.0, -0.62, 53.2],
    ],
    [
      [152.0, -0.62, 45.6],
      [155.6, -0.62, 49.0],
    ],
  ].map(([a, b], k) => logLine(a, b, 0.28, C.log, { id: `pond-log-${k + 1}` }));

  return group('Middle', [
    group('Log deck', [...deck, ...marks, crane, rollway, scaler]),
    group('Pond shore', [...skiff, ...afloat]),
    group('Timber yard', [
      ...yard,
      // the scavs' rounds at their post in the maze
      prefab('ammo-crate', 112.2, 96.0, { id: 'yard-ammo', yaw: 90 }, 0),
    ]),
    logJam,
    group('Log boom', boom),
    dam,
    bridge,
    trucks,
    ford,
    fields,
    // The rollway's label is in the generator's list, last, so the log deck's wins (MT-11).
  ]);
}

// ---------------------------------------------------------------------------- the ridge

export function buildRidge(h, s) {
  const { box, drawn, group, prefab, along, C, r2, groundAt } = h;
  const { on, bedded, logLine, copse, trailPile } = kit(h, s);
  const { wX, wZ, doorZ, win, door, roof } = buildingKit(h);
  const { TRAIL, TRAIL_Y, sx, sz, CABIN_PAD } = s;

  // ------------------------------------------------------------- hunting cabin
  // A one-room log cabin with a bunk room, on a terrace cut into the slope (CABIN_PAD) above
  // the trail, looking south over the log deck. Doors east (onto the porch) and west (by the
  // woodshed), windows south onto the valley and a small one north; the hillside is walkable
  // all round, so the AI comes up from the trail anywhere.
  const PY = CABIN_PAD.y;
  const FL = r2(PY + 0.35);
  const TOP = r2(FL + 2.5);
  const [X0, X1, Z0, Z1] = [79.5, 88.5, 8, 14];
  const doorOp = (at, width = 1.2) => ({ at, width, bottom: 0, top: 2.1 });
  const rf = roof('cabin-roof', X0, X1, Z0, Z1, TOP + 0.2, 28, { roof: C.roof, gable: C.cabin });
  const cabin = group('Hunting cabin', [
    box(X0, Z0, X1, Z1, PY - 0.6, FL, C['timber-dark'], { id: 'cabin-floor' }),
    drawn(X0 + 0.2, Z0 + 0.2, X1 - 0.2, Z1 - 0.2, FL, FL + 0.01, C.floorboards, {
      id: 'cabin-boards',
    }),
    wX('cabin-wall-s', X0, X1, Z1 - 0.1, FL, TOP + 0.2, C.cabin, [win(81.3, 1.2), win(86.4, 1.2)]),
    wX('cabin-wall-n', X0, X1, Z0 + 0.1, FL, TOP + 0.2, C.cabin, [win(85, 0.9, { bottom: 1.2 })]),
    wZ('cabin-wall-w', X0 + 0.1, Z0 + 0.2, Z1 - 0.2, FL, TOP + 0.2, C.cabin, [
      doorOp(10),
      win(12.4, 0.8, { bottom: 1.2 }),
    ]),
    wZ('cabin-wall-e', X1 - 0.1, Z0 + 0.2, Z1 - 0.2, FL, TOP + 0.2, C.cabin, [
      doorOp(10.6),
      win(12.8, 1.0),
    ]),
    wZ('cabin-partition', 82.6, Z0 + 0.2, Z1 - 0.2, FL, TOP, C.cabin, [door(9.2, 1.0)], 0.15),
    doorZ('cabin-door-w', X0 + 0.1, 10, FL),
    doorZ('cabin-door-e', X1 - 0.1, 10.6, FL),
    box(X0 + 0.2, Z0 + 0.2, X1 - 0.2, Z1 - 0.2, TOP, TOP + 0.2, C.boards, { id: 'cabin-ceiling' }),
    ...rf.nodes,
    // log courses and corner ends, drawn
    ...[0.7, 1.45, 2.2].flatMap((y, k) => [
      drawn(X0, Z1 - 0.01, X1, Z1 + 0.03, FL + y, FL + y + 0.06, C['timber-dark'], {
        id: `cabin-course-s${k + 1}`,
      }),
      drawn(X0, Z0 - 0.03, X1, Z0 + 0.01, FL + y, FL + y + 0.06, C['timber-dark'], {
        id: `cabin-course-n${k + 1}`,
      }),
    ]),
    ...[
      [X0, Z0],
      [X1, Z0],
      [X0, Z1],
      [X1, Z1],
    ].map(([x, z], k) =>
      drawn(x - 0.16, z - 0.16, x + 0.16, z + 0.16, FL - 0.1, TOP + 0.2, C['log-end'], {
        id: `cabin-corner-${k + 1}`,
      }),
    ),
    // main room: stove and pipe, table, a shelf, antlers over the front door
    box(87.3, 12.7, 88.1, 13.6, FL, FL + 0.8, C['steel-dark'], { id: 'cabin-stove' }),
    {
      type: 'cylinder',
      id: 'cabin-stovepipe',
      pos: [87.7, FL + 0.8, 13.15],
      radius: 0.1,
      height: r2(rf.ridge - FL + 0.4),
      sides: 6,
      color: C['steel-dark'],
      collide: false,
    },
    prefab('table-and-chairs', 85.6, 11.4, { yaw: 90 }, FL),
    // the hunter's rounds under the shelf
    prefab('ammo-crate', 84.7, 8.7, { id: 'cabin-ammo' }, FL),
    drawn(83, Z0 + 0.2, 86.2, Z0 + 0.5, FL + 1.5, FL + 1.55, C.timber, { id: 'cabin-shelf' }),
    ...[83.4, 83.8, 84.5, 85.6].map((x, k) =>
      drawn(
        x - 0.1,
        Z0 + 0.25,
        x + 0.1,
        Z0 + 0.45,
        FL + 1.55,
        FL + 1.75 + (k % 2) * 0.08,
        ['#8a3a2a', '#c8b060', '#6a7a8a', '#8a3a2a'][k],
        {
          id: `cabin-can-${k + 1}`,
        },
      ),
    ),
    drawn(X1 - 0.18, 10.4, X1 - 0.12, 10.8, FL + 2.15, FL + 2.4, C.timber, {
      id: 'cabin-antler-plaque',
    }),
    along([X1 - 0.2, FL + 2.3, 10.6], [X1 - 0.3, FL + 2.5, 10.05], 0.04, 0.04, C['log-end'], {
      id: 'cabin-antler-1',
    }),
    along([X1 - 0.2, FL + 2.3, 10.6], [X1 - 0.3, FL + 2.5, 11.15], 0.04, 0.04, C['log-end'], {
      id: 'cabin-antler-2',
    }),
    // bunk room: a bunk along the south wall, a footlocker clear of the back door's swing
    box(80.0, 12.7, 82.3, 13.75, FL, FL + 0.35, C.timber, { id: 'cabin-bunk' }),
    prefab('mattress-bed', 81.15, 13.22, { yaw: 90 }, FL + 0.35),
    // the hunter's footlocker (a real one since 2026-11-17: the drawn box looked searchable
    // and wasn't), and his cache on the table (`lookout-cache`: rounds, food, binoculars)
    prefab('footlocker', 80.2, 12.27, { id: 'cabin-footlocker' }, FL),
    {
      type: 'lootSpawn',
      id: 'cabin-table-cache',
      pos: [85.6, r2(FL + 0.75), 11.1],
      lootTable: 'lookout-cache',
      chance: 0.4,
    },
    // the porch (east): a deck a step up, its roof out of reach on two posts
    box(X1, 8.6, 91.2, 13.4, PY - 0.4, FL - 0.02, C.timber, { id: 'cabin-porch' }),
    box(X1, 8.4, 91.4, 13.6, FL + 2.75, FL + 2.87, C.roof, { id: 'cabin-porch-roof' }),
    ...[8.75, 13.25].map((z, k) =>
      drawn(91.0, z - 0.08, 91.16, z + 0.08, FL, FL + 2.75, C.timber, {
        id: `cabin-porch-post-${k + 1}`,
      }),
    ),
    drawn(X1 + 0.1, 12, X1 + 0.5, 13.2, FL, FL + 0.45, C.timber, { id: 'cabin-porch-bench' }),
    // the woodshed by the back door, an outhouse and a game pole on the terrace
    prefab('woodshed', 76.1, 10, { yaw: 90 }, PY),
    box(92.6, 6.9, 93.8, 8.1, PY - 0.2, PY + 2.3, C.cabin, { id: 'outhouse' }),
    along([93.2, PY + 2.45, 6.75], [93.2, PY + 2.25, 8.35], 1.5, 0.08, C.roof, {
      id: 'outhouse-roof',
    }),
    drawn(92.85, 8.1, 93.55, 8.13, PY, PY + 2.0, C['timber-dark'], { id: 'outhouse-door' }),
    drawn(93.12, 8.13, 93.28, 8.15, PY + 1.7, PY + 1.85, C.dark, { id: 'outhouse-moon' }),
    ...[92.6, 94.6].map((x, k) =>
      drawn(x - 0.06, 12.4, x + 0.06, 12.52, PY, PY + 2.5, C.timber, { id: `game-pole-${k + 1}` }),
    ),
    drawn(92.6, 12.42, 94.6, 12.5, PY + 2.4, PY + 2.48, C.timber, { id: 'game-pole-bar' }),
  ]);

  // ------------------------------------------------------------- campsite
  // A clearing cut back from the trail (CAMP_PAD, level with it): two tents, a fire ring with
  // log seats, a picnic table under a tarp, a bear locker and a firewood stack (waist cover),
  // a rock on the open side.
  const Y = TRAIL_Y;
  const seat = (id, x, z, yaw) =>
    logLine(
      [
        x - 0.8 * Math.sin((yaw * Math.PI) / 180),
        Y + 0.22,
        z - 0.8 * Math.cos((yaw * Math.PI) / 180),
      ],
      [
        x + 0.8 * Math.sin((yaw * Math.PI) / 180),
        Y + 0.22,
        z + 0.8 * Math.cos((yaw * Math.PI) / 180),
      ],
      0.22,
      C.log,
      { id },
    );
  const camp = group('Campsite', [
    prefab('tent-shelter', 122, 13.2, { id: 'camp-tent-1', yaw: 10 }, Y),
    prefab('tent-shelter', 128.5, 12.8, { id: 'camp-tent-2', yaw: -20 }, Y),
    // the crew's EMS bag between the tents
    prefab('ems-bag', 125.3, 13.4, { id: 'camp-ems-bag', yaw: 8 }, Y),
    {
      type: 'cylinder',
      id: 'camp-fire-ring',
      pos: [125.3, Y, 15.8],
      radius: 0.75,
      height: 0.22,
      sides: 8,
      color: C.stone,
      collide: false,
    },
    {
      type: 'cylinder',
      id: 'camp-fire-ash',
      pos: [125.3, Y + 0.22, 15.8],
      radius: 0.6,
      height: 0.01,
      sides: 8,
      color: C.ash,
      collide: false,
    },
    along([124.8, Y + 0.3, 15.5], [125.8, Y + 0.3, 16.1], 0.12, 0.12, C.dark, {
      id: 'camp-fire-log-1',
    }),
    along([124.9, Y + 0.33, 16.2], [125.7, Y + 0.33, 15.4], 0.12, 0.12, C.dark, {
      id: 'camp-fire-log-2',
    }),
    seat('camp-seat-1', 123.4, 16.3, 70),
    seat('camp-seat-2', 127.2, 16.5, -60),
    seat('camp-seat-3', 125.4, 17.6, 90),
    prefab('wooden-chair', 124, 14.6, { yaw: 160 }, Y),
    // picnic table under a tarp
    box(130.55, 13.8, 132.45, 14.6, Y + 0.72, Y + 0.78, C.timber, { id: 'camp-table' }),
    box(130.55, 13.1, 132.45, 13.4, Y + 0.42, Y + 0.46, C.timber, { id: 'camp-bench-n' }),
    box(130.55, 15.0, 132.45, 15.3, Y + 0.42, Y + 0.46, C.timber, { id: 'camp-bench-s' }),
    ...[130.8, 132.2].map((x, k) =>
      drawn(x - 0.05, 13.2, x + 0.05, 15.2, Y, Y + 0.72, C['timber-dark'], {
        id: `camp-table-legs-${k + 1}`,
      }),
    ),
    drawn(131.1, 13.95, 131.5, 14.25, Y + 0.78, Y + 1.0, C.lamp, { id: 'camp-lantern' }),
    drawn(132.0, 15.05, 132.4, 15.3, Y + 0.46, Y + 0.8, C['paint-white'], { id: 'camp-cooler' }),
    along([131.6, Y + 2.6, 12.6], [131.6, Y + 1.9, 16.2], 3.4, 0.04, C.tarp, { id: 'camp-tarp' }),
    ...[
      [129.9, 12.6, 2.6],
      [133.3, 12.6, 2.6],
      [129.9, 16.2, 1.9],
      [133.3, 16.2, 1.9],
    ].map(([x, z, t], k) =>
      drawn(x - 0.03, z - 0.03, x + 0.03, z + 0.03, Y, Y + t, C['steel-dark'], {
        id: `camp-tarp-pole-${k + 1}`,
      }),
    ),
    // a camper's bag left by the bear locker (2026-11-17, `duffle-bag`)
    prefab('duffle-bag', 120.6, 16.0, { id: 'camp-bag', yaw: 75 }, Y),
    box(118.6, 15.4, 119.9, 16.3, Y, Y + 0.85, C.metal, { id: 'camp-bear-locker' }),
    drawn(118.6, 15.38, 119.9, 15.4, Y + 0.7, Y + 0.74, C['steel-dark'], {
      id: 'camp-bear-locker-lid',
    }),
    box(133.2, 11.8, 134.8, 12.5, Y, Y + 0.95, C.log, { id: 'camp-firewood' }),
    drawn(133.2, 12.5, 134.8, 12.52, Y + 0.05, Y + 0.9, C['log-end'], { id: 'camp-firewood-ends' }),
    prefab('rock-large', 135.6, 16.4, { yaw: 30 }, Y),
  ]);

  // ------------------------------------------------------------- deer stands
  // Ladder perches, player-only (MT-2): a floor at 3.65 m on four posts, a rail on the north,
  // a seat and side rails (drawn).
  const standAt = (id, x, z) => {
    const y = groundAt(x, z);
    return group(`Deer stand ${id}`, [
      ...[
        [-0.9, -0.9],
        [0.9, -0.9],
        [-0.9, 0.9],
        [0.9, 0.9],
      ].map(([dx, dz], k) =>
        box(
          x + dx - 0.08,
          z + dz - 0.08,
          x + dx + 0.08,
          z + dz + 0.08,
          y - 0.3,
          y + 3.5,
          C.timber,
          {
            id: `stand-${id}-post-${k + 1}`,
          },
        ),
      ),
      box(x - 1, z - 1, x + 1, z + 1, y + 3.5, y + 3.65, C.timber, { id: `stand-${id}-floor` }),
      box(x - 1, z - 1, x + 1, z - 0.9, y + 3.65, y + 4.6, C.timber, { id: `stand-${id}-rail` }),
      {
        type: 'ladder',
        id: `stand-${id}-ladder`,
        pos: [r2(x), r2(y), r2(z + 1)],
        yaw: 0,
        height: 3.65,
        color: C.timber,
      },
      drawn(x - 0.6, z - 0.2, x + 0.6, z + 0.25, y + 3.65, y + 4.1, C['timber-dark'], {
        id: `stand-${id}-seat`,
      }),
      drawn(x - 1, z - 0.9, x - 0.92, z + 0.4, y + 4.4, y + 4.48, C.timber, {
        id: `stand-${id}-rail-w`,
      }),
      drawn(x + 0.92, z - 0.9, x + 1, z + 0.4, y + 4.4, y + 4.48, C.timber, {
        id: `stand-${id}-rail-e`,
      }),
      drawn(x - 1, z - 0.92, x + 1, z - 0.88, y + 3.0, y + 3.5, C['paint-green'], {
        id: `stand-${id}-skirt`,
      }),
    ]);
  };

  // ------------------------------------------------------------- clear-cut
  // Stumps (off the trail), slash piles of brush (concealment only), and the landing on the
  // trail: a skidder left parked across its south half, a fuel tank and two log piles.
  const STUMPS = [
    [757.7, 97.4],
    [773.5, 119.7],
    [716.7, 103.8],
    [638.7, 104.7],
    [701.3, 106.2],
    [731.5, 72.6],
    [638.6, 118.7],
    [650.9, 86],
    [684.6, 73.4],
    [746.3, 122.3],
    [671.6, 99.2],
    [677.9, 92.1],
    [692.5, 64],
    [656.2, 67],
    [772.3, 87.8],
    [665.3, 117.3],
    [786.5, 84.4],
    [645.2, 76.6],
    [671.3, 93],
    [769.4, 106],
    [695.4, 81.8],
    [712.8, 79.1],
    [683.8, 56.5],
    [674.3, 121.7],
    [650.6, 88.2],
    [729.2, 114.1],
    [664.7, 71.5],
    [669.8, 80.8],
    [700.6, 120.7],
    [763.4, 114.8],
    [741.7, 116.5],
  ];
  const stumps = STUMPS.map(([px, py]) => [sx(px + 3), sz(py + 3)])
    .filter(([, z]) => z < TRAIL.z0 - 0.5 || z > TRAIL.z1 + 0.5)
    // Two sketch dots closer than a stump's width are one stump (2026-11-16).
    .filter(
      ([x, z], i, all) => !all.slice(0, i).some(([x2, z2]) => Math.hypot(x - x2, z - z2) < 1.4),
    )
    .map(([x, z], k) => on('tree-stump', x, z, { id: `stump-${k + 1}`, yaw: (k * 47) % 360 }));
  const slash = (id, x, z) => {
    const y = groundAt(x, z);
    return group(`Slash ${id}`, [
      on('bush', x, z),
      ...[
        [-1.8, -0.4, 1.6, 0.5, 0.15],
        [-1.2, 0.9, 1.4, -0.8, 0.4],
        [-0.4, -1.5, 0.6, 1.4, 0.25],
        [0.8, -1.1, -1.5, 1.0, 0.55],
      ].map(([ax, az, bx, bz, lift], k) =>
        logLine(
          [x + ax, y + 0.1, z + az],
          [x + bx, y + lift + 0.3, z + bz],
          0.1,
          C['timber-dark'],
          {
            id: `slash-${id}-${k + 1}`,
            collide: false,
          },
        ),
      ),
    ]);
  };
  const clearCut = group('Clear-cut', [
    group('Clear-cut stumps', stumps),
    slash(1, 210, 9),
    slash(2, 233, 6.5),
    slash(3, 245, 13),
    prefab('skidder', 213.5, 21.2, { yaw: 84 }, TRAIL_Y),
    trailPile(226, 'n'),
    prefab('log-pile', 203.5, 22.1, { yaw: 2 }, TRAIL_Y),
    // fuel tank on a skid
    box(218.2, 21.6, 220.8, 23, TRAIL_Y, TRAIL_Y + 0.15, C['timber-dark'], { id: 'fuel-skid' }),
    // the skidder driver's toolbox on the skid's end (2026-11-17)
    prefab('toolbox', 218.6, 22.3, { id: 'landing-toolbox', yaw: 90 }, TRAIL_Y + 0.15),
    {
      type: 'cylinder',
      id: 'fuel-tank',
      pos: [219.5, r2(TRAIL_Y + 0.75 - 1.2), 22.3],
      radius: 0.6,
      height: 2.4,
      sides: 10,
      roll: 90,
      color: C['paint-red'],
    },
    on('rock-large', 220, 11, { yaw: 15 }),
    bedded('log-pile', 229, 9, 3, 0.8),
    // Piles left along the slope's contour: the clear-cut's only eye-height cover.
    bedded('log-pile-tall', 206.5, 12.4, 3, 1, { yaw: 2 }),
    bedded('log-pile-tall', 238, 10, 3, 1, { yaw: -3 }),
    bedded('log-pile-tall', 267, 15, 3, 1, { yaw: 1 }),
    on('rock-large', 241, 25.8, { yaw: -40 }),
  ]);

  // ------------------------------------------------------------- the trail and the slopes
  // Cover on the trail west of the campsite (staggered across it), and copses on the slope
  // between the cabin, the campsite, the jam and the clear-cut, so the ridge has no clear
  // line along it past the fog.
  const ridgeCover = group('Ridge cover', [
    trailPile(32, 'n'),
    trailPile(62, 's'),
    trailPile(99, 'n'),
    trailPile(113, 's'),
    trailPile(256, 's'),
    trailPile(275, 'n'),
    trailPile(298, 's'),
    copse('Copse between the cabin and the campsite', [
      ['pine-tree', 103, 11],
      ['pine-tree', 106.5, 13.4],
      ['broadleaf-tree', 104.4, 14.6],
      ['bush-tall', 107.3, 11.6],
      ['rock', 105.2, 12.6, 20],
    ]),
    copse('Copse east of the jam', [
      ['pine-tree', 193, 10],
      ['broadleaf-tree', 196.5, 12],
      ['pine-tree', 194.5, 13.8],
      ['bush', 197.5, 9.8],
      ['tree-stump', 195.6, 10.8, 120],
      ['rock', 192.4, 12.6, -40],
    ]),
    copse('Copse east of the clear-cut', [
      ['pine-tree', 260, 8],
      ['pine-tree', 263.5, 10.5],
      ['broadleaf-tree', 261.4, 12.6],
      ['bush-tall', 264.2, 8.2],
      ['rock', 262.4, 10.2, 75],
    ]),
  ]);

  return group('Ridge', [
    cabin,
    camp,
    standAt(1, sx(748), sz(115)),
    // a hunter's cache on stand 1's floor (2026-11-17): a ladder perch, player-only
    {
      type: 'lootSpawn',
      id: 'stand-1-cache',
      pos: [sx(748), r2(groundAt(sx(748), sz(115)) + 3.65), r2(sz(115) + 0.5)],
      lootTable: 'lookout-cache',
      chance: 0.4,
    },
    standAt(2, sx(910), sz(85)),
    clearCut,
    ridgeCover,
  ]);
}
