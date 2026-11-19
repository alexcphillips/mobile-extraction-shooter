// Silver Creek's west end (roadmap MT-6, 2026-11-10), used by gen-silver-creek.mjs: the fire
// lookout, the company office, the sheds, six company houses each laid out differently, and
// the gas station and store, with cover across the open ground round them.
//
// Buildings are built in their own frame (front on +z, origin on the ground under the middle)
// and placed as a group turned by yaw. They follow admin-building's rules (design overview):
// outer walls 0.2 m, partitions 0.15 m, doorways 1.2 × 2.1 m, windows 0.9 to 2.0 m glazed
// (vaultable once broken), rooms about 1.25× real. The valley floor here is flat at y 0.

import { buildingKit } from './mapkit/building.mjs';
import { fenceRun } from './mapkit/fence.mjs';

export function buildWestEnd(h) {
  const { box, drawn, group, prefab, along, label, C, r2, groundAt, groundRange } = h;
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
  /**
   * A home or kitchen fridge's loot (2026-11-17): the everyday fridge table, a few parts,
   * often empty. The shared fridge-food table (a prime ribeye in it) stays for richer places.
   */
  const FRIDGE = {
    container: 'fridge',
    mix: { tables: { 'fridge-home': 0.8, 'fridge-parts': 0.2 }, empty: 0.4 },
  };
  const at = (name, x, z, y, extra = {}) => prefab(name, x, z, extra, y);

  // ---------------------------------------------------------------- fire lookout
  // A landmark, not a perch (the user's call, 2026-11-17: it needn't be climbable). Four
  // legs taper from 3.2 m off the middle at the footings to 2.0 m under the cab, girts and X
  // bracing on each face from 2.8 m up (the bottom bay is open, so nothing drawn crosses
  // head height), and a ladder up the middle hung from cross beams, its bottom section
  // fallen away so it ends 4 m up. The catwalk at 17 m sits on knee braces, railed on posts.
  // The footings and legs are solid (the legs as hidden stacked boxes); the bracing, ladder and
  // rail posts are drawn only.
  const LOOKOUT = { x: 30, z: 8, base: 3.2, top: 2.0, cab: 17 };
  const ly = groundRange(LOOKOUT.x - 3.6, LOOKOUT.z - 3.6, LOOKOUT.x + 3.6, LOOKOUT.z + 3.6)[0];
  const lookout = (() => {
    const { x, z, base, top, cab } = LOOKOUT;
    const y = ly;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    /** A leg's corner at height h over y: [x, y, z]. */
    const leg = ([sx, sz], h) => {
      const e = base + ((top - base) * h) / cab;
      return [x + sx * e, y + h, z + sz * e];
    };
    const legSolids = (c, fTop, k) => {
      const out = [];
      for (let j = 0, h0 = fTop - y; h0 < cab - 0.15 - 0.01; j++) {
        const h1 = Math.min(h0 + 2, cab - 0.15);
        const [mx, , mz] = leg(c, (h0 + h1) / 2);
        out.push(
          box(mx - 0.15, mz - 0.15, mx + 0.15, mz + 0.15, y + h0, y + h1, C.timber, {
            id: `lookout-leg-${k + 1}-solid-${j + 1}`,
            invisible: true,
            stopsShots: true,
          }),
        );
        h0 = h1;
      }
      return out;
    };
    const n = [];
    corners.forEach((c, k) => {
      const [fx, , fz] = leg(c, 0);
      const fTop = groundAt(fx, fz) + 0.3;
      n.push(
        box(fx - 0.4, fz - 0.4, fx + 0.4, fz + 0.4, y - 0.6, fTop, C['dark-concrete'], {
          id: `lookout-footing-${k + 1}`,
        }),
        // A tilted solid compiles to a slab, wrong for a near-upright leg: it's solid as
        // hidden 2 m boxes stacked up inside it instead, within 7 cm of the drawn leg.
        ...legSolids(c, fTop, k),
        along([fx, fTop, fz], leg(c, cab), 0.3, 0.3, C.timber, { id: `lookout-leg-${k + 1}` }),
      );
    });
    const levels = [2.8, 6.3, 9.8, 13.4, cab - 0.15];
    let brace = 0;
    for (let i = 0; i < levels.length; i++) {
      for (let f = 0; f < 4; f++) {
        const [c0, c1] = [corners[f], corners[(f + 1) % 4]];
        if (i < levels.length - 1)
          n.push(
            along(leg(c0, levels[i]), leg(c1, levels[i]), 0.12, 0.16, C['timber-dark'], {
              id: `lookout-girt-${i * 4 + f + 1}`,
            }),
          );
        if (i > 0)
          for (const [p, q] of [
            [leg(c0, levels[i - 1]), leg(c1, levels[i])],
            [leg(c1, levels[i - 1]), leg(c0, levels[i])],
          ])
            n.push(along(p, q, 0.1, 0.1, C['timber-dark'], { id: `lookout-brace-${++brace}` }));
      }
    }
    // Cross beams west to east through the middle, which the ladder hangs from.
    for (const [k, h] of levels.slice(1, -1).entries()) {
      const e = leg([1, 0], h)[0] - x;
      n.push(
        along([x - e, y + h, z], [x + e, y + h, z], 0.15, 0.15, C['timber-dark'], {
          id: `lookout-beam-${k + 1}`,
        }),
      );
    }
    const lz = z - 0.12;
    const [lb, lt] = [y + 4, y + cab - 0.15];
    for (const [k, sx] of [-0.22, 0.22].entries())
      n.push(
        drawn(x + sx - 0.03, lz - 0.03, x + sx + 0.03, lz + 0.03, lb, lt, C.steel, {
          id: `lookout-ladder-rail-${k + 1}`,
        }),
      );
    for (let k = 0, ry = lb + 0.3; ry < lt; k++, ry += 0.8)
      n.push(
        drawn(x - 0.22, lz - 0.02, x + 0.22, lz + 0.02, ry, ry + 0.04, C.steel, {
          id: `lookout-rung-${k + 1}`,
        }),
      );
    // The catwalk on knee braces from the legs, its rail on posts; the cab, glazed all round.
    const cw = 3;
    const deck = y + cab - 0.15;
    corners.forEach((c, k) =>
      n.push(
        along(
          leg(c, cab - 2),
          [x + c[0] * (cw - 0.2), deck, z + c[1] * (cw - 0.2)],
          0.12,
          0.12,
          C['timber-dark'],
          {
            id: `lookout-knee-${k + 1}`,
          },
        ),
      ),
    );
    n.push(
      box(x - cw, z - cw, x + cw, z + cw, deck, y + cab, C['timber-dark'], {
        id: 'lookout-catwalk',
      }),
    );
    let post = 0;
    for (const px of [-1, 0, 1])
      for (const pz of [-1, 0, 1]) {
        if (!px && !pz) continue;
        const [qx, qz] = [x + px * (cw - 0.05), z + pz * (cw - 0.05)];
        n.push(
          drawn(qx - 0.04, qz - 0.04, qx + 0.04, qz + 0.04, y + cab, y + cab + 0.95, C.timber, {
            id: `lookout-post-${++post}`,
          }),
        );
      }
    n.push(
      drawn(x - cw, z - cw, x + cw, z + cw, y + cab + 0.95, y + cab + 1.02, C.timber, {
        id: 'lookout-cab-rail',
      }),
      box(x - 2.2, z - 2.2, x + 2.2, z + 2.2, y + cab, y + cab + 2.6, C['timber-dark'], {
        id: 'lookout-cab',
      }),
      drawn(x - 2.23, z - 2.23, x + 2.23, z + 2.23, y + cab + 1.1, y + cab + 2.2, C.glass, {
        id: 'lookout-glazing',
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
    );
    return group('Fire lookout', n, { landmark: true });
  })();

  // ---------------------------------------------------------------- lookout hut
  // Cover at the tower's foot (the user's request, 2026-11-17): a one-room hut 3.8 × 3.2 m
  // east of the tower, its floor level with the uphill (north) ground, so the door is on that
  // side, flush; the slope drops 0.7 m to the south, where a concrete plinth makes it up. A
  // window south over the town and one west at the tower. Loot (2026-11-17): a loose find on
  // the table under the south window and a footlocker, both from fire-watch.
  const lookoutHut = (() => {
    const [cx, cz, hw, hd] = [37.8, 8, 1.9, 1.6];
    const [lo, hi] = groundRange(cx - hw, cz - hd, cx + hw, cz + hd);
    const fl = 0.15;
    const col = C['timber-dark'];
    const { nodes, top } = shell('lh', {
      hw,
      hd,
      fl,
      wallH: 2.5,
      color: col,
      ops: { front: [win(0, 1.4)], back: [door(-0.6)], west: [win(0, 0.9)], east: [] },
    });
    const rf = roof('lh-roof', -hw, hw, -hd, hd, top, 20, { roof: C.roof, gable: col });
    return group(
      'Lookout hut',
      [
        box(-hw, -hd, hw, hd, lo - hi - 0.3, -0.3, C['dark-concrete'], { id: 'lh-plinth' }),
        ...nodes,
        ...rf.nodes,
        doorX('lh-door', -0.6, -hd + 0.1, fl),
        // the watchman's table under the south window, a loose find on it (fire-watch:
        // common and uncommon), and his footlocker against the east wall
        at('wooden-table', 0, 1.08, fl, { id: 'lh-table' }),
        at('wooden-chair', 0, 0.42, fl, { id: 'lh-chair' }),
        {
          type: 'lootSpawn',
          id: 'lh-table-loose',
          pos: [0.15, r2(fl + 0.75), 1.08],
          lootTable: 'fire-watch',
          chance: 0.5,
        },
        at('footlocker', 1.43, 0.4, fl, { id: 'lh-footlocker', yaw: -90 }),
        at('crate', 1.25, -0.95, fl),
        // the watchman's EMS bag by the west wall, its lid opening into the room
        at('ems-bag', -1.45, -0.2, fl, { id: 'lh-ems-bag', yaw: -90 }),
      ],
      { pos: [cx, r2(hi), cz] },
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
      // pay office: the clerk's desk at the pay window, cabinets, the pay cabinet (a metal
      // cabinet since 2026-11-17: the safe here had no loot, so it looked searchable and
      // wasn't; a real safe on the west spawns' doorstep would be too rich for its risk)
      at('desk', -2.4, 2.4, fl, { yaw: -90 }),
      at('office-chair', -3.2, 2.4, fl, { yaw: 90 }),
      at('paper-stacks', -2.4, 2.2, fl + 0.76, { yaw: 90 }),
      at('filing-cabinet', -6.45, 1.0, fl, { yaw: 90 }),
      at('metal-cabinet', -6.48, 4.1, fl, { id: 'co-pay-cabinet', yaw: 90 }),
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
      // an ornament off the manager's shelves (2026-11-17: regular craftwork, rare)
      {
        type: 'lootSpawn',
        id: 'co-manager-craft',
        pos: [4.2, fl, 1.35],
        lootTable: 'craftwork',
        chance: 0.12,
      },
      at('potted-plant', 6.2, 1.2, fl),
      // store: lockers, water, crates of tools; and the building's electrics (2026-11-17,
      // the west end's low-risk electrical spot): the main board on the north-east corner
      // and its cabinet (`electrical-cabinet`), a fuse box spot (`switch-room`)
      at('locker-bank', 3.2, -4.5, fl),
      at('water-cooler', 6.4, 0.0, fl),
      at('crate', 5.2, -0.4, fl),
      at('crate', 5.2, -0.4, fl + 0.8, { yaw: 20 }),
      at('crate', 4.3, -0.5, fl, { yaw: 10 }),
      at('electrical-cabinet', 6.53, -3.9, fl, { id: 'co-electrics', yaw: -90 }),
      drawn(5.0, -4.8, 5.9, -4.74, fl + 1.1, fl + 2.1, C['steel-dark'], { id: 'co-main-board' }),
      drawn(5.4, -4.8, 5.5, -4.72, fl + 2.1, up - 0.2, C['steel-dark'], { id: 'co-main-conduit' }),
      {
        type: 'lootSpawn',
        id: 'co-fuse-box',
        pos: [5.45, fl, -4.3],
        lootTable: 'switch-room',
        chance: 0.3,
      },
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
      at('office-computer', 3.62, 3.02, up + 0.76, { id: 'co-drafting-computer', yaw: -90 }),
      at('filing-cabinet', 6.45, -3.0, up, { yaw: -90 }),
      at('paper-stacks', 3.5, 0.6, up + 0.76),
      at('clipboard', -4.0, 2.3, up + 0.76, { yaw: 25 }),
      at('notice-board', 4.0, -4.82, up),
      at('desk', -5.2, -2.9, up, { yaw: 90 }),
      at('office-chair', -4.6, -2.9, up, { yaw: -90 }),
      at('office-computer', -5.32, -2.48, up + 0.76, { id: 'co-chief-computer', yaw: 90 }),
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
      0.05,
    ),
    prefab('shed', 59.5, 35.2, { id: 'shed-2', yaw: 4 }, 0.15),
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
  // Redone 2026-11-17 (the user's request): six new plans, none kept from before. Each is
  // 11 × 9 m (frame x ±5.5, z ±4.5, front +z), placed facing the lane, with at least two
  // ways in and windows on every side. House 2 is the manager's: the only two-storey house
  // and the best loot, paintings upstairs (design/maps/silver-creek.md → Company houses).
  const FL = 0.35;
  const houseSpecs = [];

  /**
   * A picket fence from (x0, z0) to (x1, z1) in 3 m bays; bays listed in `gaps` are broken
   * through (walkable). Ends short of a whole bay are left open.
   */
  const fenceLine = (id, x0, z0, x1, z1, gaps) => fenceRun(id, [x0, z0], [x1, z1], { gaps });
  /** A wall-colored concrete step under a door with no porch. */
  const stoop = (id, x, hd) =>
    box(x - 0.7, hd, x + 0.7, hd + 1.0, -0.2, FL - 0.02, C['dark-concrete'], { id });
  /**
   * A loose spot, `table` rolled at `chance`. With a `yaw` its item faces that way, and a
   * painting leans with its back's top against the point, so the point goes on the face of
   * the wall or furniture behind it, at the floor.
   */
  const spot = (id, x, y, z, lootTable, chance, yaw) => ({
    type: 'lootSpawn',
    id,
    pos: [r2(x), r2(y), r2(z)],
    ...(yaw === undefined ? {} : { yaw }),
    lootTable,
    chance,
  });

  // House 1: a corner porch on the east into an entry hall; the kitchen across the front
  // west, the living room and a bedroom behind. The entry, living room and kitchen make a
  // loop; the back door is off the living room.
  houseSpecs.push({
    name: 'House 1 (corner porch)',
    pos: [41.5, 72.5],
    yaw: 0,
    color: C['siding-cream'],
    roofColor: C.roof,
    chimney: [-4.4, -3.2, -3.6, -2.4],
    ops: {
      front: [win(-3.8, 1.6), win(-1.2, 1.0), door(3.9)],
      back: [win(-3.2), win(1.0, 1.6), door(3.6)],
      west: [win(3.85, 0.8), win(-1.0, 0.9)],
      east: [win(2.6, 1.0), win(-3.7, 0.9)],
    },
    inside: (id) => [
      wX(`${id}-p1`, -5.3, 5.3, 0, FL, FL + 3, C.plaster, [door(0), door(3.5)], 0.15),
      wZ(`${id}-p2`, 1.5, 0.075, 4.3, FL, FL + 3, C.plaster, [{ ...door(2.2), width: 1.6 }], 0.15),
      wZ(`${id}-p3`, -1.0, -4.3, -0.075, FL, FL + 3, C.plaster, [door(-1.5)], 0.15),
      doorX(`${id}-door-front`, 3.9, 4.4, FL),
      doorX(`${id}-door-back`, 3.6, -4.4, FL, 1.2, { open: true }),
      doorZ(`${id}-door-bed`, -1.0, -1.5, FL),
      // kitchen
      at('kitchen-run', -5.0, 2.2, FL, { yaw: 90 }),
      at('fridge-v2', -4.65, 0.75, FL, { id: `${id}-fridge`, yaw: 90, loot: FRIDGE }),
      at('dining-set', -2.6, 2.4, FL),
      spot(`${id}-craft`, -2.6, FL + 0.77, 2.1, 'craftwork', 0.12),
      // entry
      at('duffle-bag', 4.85, 1.0, FL, { yaw: 90 }),
      at('floor-lamp', 1.95, 0.5, FL),
      // living room
      at('tv-unit', 5.07, -2.2, FL, { yaw: -90 }),
      at('couch', 2.6, -2.2, FL, { yaw: 90 }),
      at('coffee-table', 3.8, -2.2, FL, { yaw: 90 }),
      at('floor-lamp', 0, -3.8, FL),
      // bedroom
      at('bed-double', -4.2, -2.6, FL, { yaw: 90 }),
      at('nightstand', -5.08, -1.25, FL, { yaw: 90 }),
      at('wardrobe', -2.5, -0.375, FL, { yaw: 180 }),
      ...porch(id, 3.9, 4.5, FL, 2.6, 1.6),
    ],
    yard: (id) => [
      // back yard: a chopping block and a log pile under a shade tree
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [1]),
      ...fenceLine(`${id}-fence-e`, 7, -4.5, 7, -11.5, [1]),
      at('tree-stump', 1.8, -7.2, 0, { yaw: 20 }),
      at('log-pile', -3.6, -8.6, 0, { yaw: 90 }),
      at('broadleaf-tree', 4.6, -9.6, 0),
      at('mailbox', 5.6, 6.9, 0, { yaw: 180 }),
    ],
  });

  // House 2 (the manager's, two storeys): built by `manor` below.
  houseSpecs.push({
    name: "House 2 (manager's)",
    pos: [59.5, 72.5],
    yaw: 0,
    color: C['siding-blue'],
    roofColor: C['roof-red'],
    manor: true,
  });

  // House 3: a duplex, two flats under one roof with a front door each; the party wall's
  // been knocked through at the back, so it's a loop through both. West flat: kitchen and
  // dining in front, a bedroom behind with a back door. East flat: living room in front, a
  // kids' room behind with a side door.
  houseSpecs.push({
    name: 'House 3 (duplex)',
    pos: [77.5, 72.5],
    yaw: 0,
    color: C['siding-sage'],
    roofColor: C.roof,
    ops: {
      front: [door(-3.8), win(-1.6, 1.2), win(1.6, 1.2), door(3.8)],
      back: [win(-3.6), door(-0.8), win(2.4)],
      west: [win(3.6, 1.0), win(-3.6, 1.0)],
      east: [win(3.2), door(-1.4)],
    },
    inside: (id) => [
      wZ(`${id}-party`, 0, -4.3, 4.3, FL, FL + 3, C.plaster, [
        { at: -2.6, width: 1.0, bottom: 0, top: 2.1 },
      ]),
      wX(`${id}-p-west`, -5.3, -0.1, 0.2, FL, FL + 3, C.plaster, [door(-2.4)], 0.15),
      wX(`${id}-p-east`, 0.1, 5.3, -0.4, FL, FL + 3, C.plaster, [door(2.4)], 0.15),
      doorX(`${id}-door-front-w`, -3.8, 4.4, FL),
      doorX(`${id}-door-front-e`, 3.8, 4.4, FL, 1.2, { open: true }),
      doorX(`${id}-door-back`, -0.8, -4.4, FL),
      doorZ(`${id}-door-side`, 5.4, -1.4, FL),
      doorX(`${id}-door-bed-w`, -2.4, 0.2, FL),
      // west flat
      at('kitchen-run', -5.0, 1.6, FL, { yaw: 90 }),
      at('table-and-chairs', -2.4, 2.6, FL),
      at('bed-double', -4.2, -2.0, FL, { yaw: 90 }),
      at('nightstand', -5.08, -3.3, FL, { yaw: 90 }),
      at('wardrobe', -2.5, -3.97, FL),
      // east flat
      at('tv-unit', 0.35, 1.8, FL, { yaw: 90 }),
      at('coffee-table', 1.1, 1.8, FL, { yaw: 90 }),
      at('couch', 2.0, 1.8, FL, { yaw: -90 }),
      at('kitchen-run', 5.0, 1.0, FL, { yaw: -90 }),
      at('wooden-table', 2.0, 3.6, FL),
      at('wooden-chair', 2.0, 3.0, FL),
      at('bunk-bed', 4.75, -3.2, FL),
      at('mattress-bed', 2.4, -3.7, FL, { yaw: 90 }),
      at('suitcase', 2.4, -2.8, FL, { yaw: 90 }),
      stoop(`${id}-stoop-w`, -3.8, 4.5),
      stoop(`${id}-stoop-e`, 3.8, 4.5),
    ],
    yard: (id) => [
      // two yards, split by a fence with a gap: a clothes line west; pallets and a drum east
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [3]),
      ...fenceLine(`${id}-fence-mid`, 0, -4.5, 0, -11.5, [1]),
      at('clothes-line', -3.6, -8.0, 0, { yaw: 4 }),
      at('wood-pallet', 2.6, -7.0, 0, { yaw: 25 }),
      at('sideways-steel-barrel', 4.8, -9.4, 0, { yaw: 80 }),
      at('mailbox', -5.4, 6.9, 0, { yaw: 180 }),
      at('mailbox', 5.4, 6.9, 0, { yaw: 180, colors: { box: '#4a5a3a' } }),
    ],
  });

  // House 4 (south row, facing north): four rooms round a brick chimney core, every room
  // opening into the next, so it's a loop round the core. Living room with the hearth by
  // the front door, kitchen beside it, a bedroom behind, a workroom with the back door.
  houseSpecs.push({
    name: 'House 4 (chimney core)',
    pos: [45.5, 89.5],
    yaw: 180,
    color: C['siding-red'],
    roofColor: C.roof,
    chimney: [-0.4, -0.4, 0.4, 0.4],
    ops: {
      front: [win(-4.4, 1.0), door(-2.6), win(2.6, 1.6)],
      back: [win(-4.5, 0.9), win(1.2, 1.0), door(3.4)],
      west: [win(-3.5, 1.0)],
      east: [win(3.85, 0.8), win(-3.2)],
    },
    inside: (id) => [
      box(-1.0, -1.0, 1.0, 1.0, FL, FL + 3, C.stone, { id: `${id}-core` }),
      drawn(-0.9, 1.0, -0.1, 1.04, FL, FL + 0.9, '#2a2420', { id: `${id}-hearth` }),
      drawn(-1.0, 1.0, 0, 1.3, FL - 0.05, FL + 0.02, C.stone, { id: `${id}-hearth-stone` }),
      wX(`${id}-p-w`, -5.3, -1.0, 0, FL, FL + 3, C.plaster, [door(-3.2)], 0.15),
      wX(`${id}-p-e`, 1.0, 5.3, 0, FL, FL + 3, C.plaster, [door(3.2)], 0.15),
      wZ(`${id}-p-f`, 0, 1.0, 4.3, FL, FL + 3, C.plaster, [door(2.6)], 0.15),
      wZ(`${id}-p-b`, 0, -4.3, -1.0, FL, FL + 3, C.plaster, [door(-2.6)], 0.15),
      doorX(`${id}-door-front`, -2.6, 4.4, FL),
      doorX(`${id}-door-back`, 3.4, -4.4, FL),
      doorZ(`${id}-door-kitchen`, 0, 2.6, FL, 1.2, { open: true }),
      doorX(`${id}-door-bed`, -3.2, 0, FL),
      // living room
      at('bookcase-tall', -5.05, 2.2, FL, { yaw: 90 }),
      at('couch', -3.0, 2.2, FL, { yaw: 90 }),
      at('coffee-table', -1.9, 2.2, FL, { yaw: 90 }),
      at('floor-lamp', -4.0, 3.9, FL),
      // kitchen
      at('kitchen-run', 5.0, 2.2, FL, { yaw: -90 }),
      at('fridge-v2', 4.65, 0.3, FL, { id: `${id}-fridge`, yaw: -90, loot: FRIDGE }),
      spot(`${id}-craft`, -0.5, FL + 0.02, 1.15, 'craftwork', 0.12),
      at('dining-set', 2.6, 2.6, FL),
      // bedroom
      at('bed-double', -3.0, -3.2, FL),
      at('nightstand', -1.8, -4.05, FL),
      at('wardrobe', -5.0, -1.6, FL, { yaw: 90 }),
      // workroom
      at('tool-chest', 5.05, -1.6, FL, { yaw: -90 }),
      at('wooden-table', 2.2, -3.95, FL),
      at('toolbox', 2.2, -3.95, FL + 0.75, { yaw: 10 }),
      at('wooden-chair', 2.2, -3.3, FL, { yaw: 180 }),
      ...porch(id, -2.6, 4.5, FL, 2.6, 1.4),
    ],
    yard: (id) => [
      // back yard: a car up on blocks, a spare tire, the fence half down
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [0, 3]),
      ...fenceLine(`${id}-fence-w`, -7, -4.5, -7, -11.5, []),
      at('car', 2.6, -8.2, 0, { yaw: 74, colors: { paint: '#6a4a3a' } }),
      at('truck-tire-1', -2.2, -7.0, 0.4, { yaw: 30 }),
      at('mailbox', -0.4, 6.9, 0, { yaw: 180 }),
    ],
  });

  // House 5 (south row): an attached garage on the east, its door gone, a car inside; the
  // house is a living room across the front with a door into the garage, a bedroom and
  // the kitchen behind, the back door from the kitchen.
  houseSpecs.push({
    name: 'House 5 (garage)',
    pos: [63.5, 89.5],
    yaw: 180,
    color: C.siding,
    roofColor: C['roof-red'],
    ops: {
      front: [door(-3.0), win(-0.6, 1.6), { at: 3.3, width: 3.0, bottom: 0, top: 2.4 }],
      back: [win(-3.8), door(0.4), win(3.4, 1.0)],
      west: [win(3.7, 0.9), win(-0.8, 0.8)],
      east: [win(-1.0, 1.2)],
    },
    inside: (id) => [
      wZ(`${id}-garage-wall`, 1.275, -4.3, 4.3, FL, FL + 3, C.plaster, [door(3.4)], 0.15),
      wX(`${id}-p1`, -5.3, 1.2, 0.5, FL, FL + 3, C.plaster, [door(-0.5)], 0.15),
      wZ(`${id}-p2`, -2.2, -4.3, 0.425, FL, FL + 3, C.plaster, [door(-1.0)], 0.15),
      doorX(`${id}-door-front`, -3.0, 4.4, FL),
      doorX(`${id}-door-back`, 0.4, -4.4, FL),
      doorZ(`${id}-door-garage`, 1.275, 3.4, FL, 1.2, { open: true }),
      doorZ(`${id}-door-bed`, -2.2, -1.0, FL),
      // living room
      at('tv-unit', -5.07, 2.0, FL, { yaw: 90 }),
      at('coffee-table', -4.3, 2.0, FL, { yaw: 90 }),
      at('couch', -3.4, 2.0, FL, { yaw: -90 }),
      at('floor-lamp', -1.2, 3.9, FL),
      // bedroom
      at('bed-double', -4.2, -2.4, FL, { yaw: 90 }),
      at('nightstand', -5.08, -3.75, FL, { yaw: 90 }),
      at('wardrobe', -4.4, 0.125, FL, { yaw: 180 }),
      // kitchen
      at('kitchen-run', 0.9, -1.6, FL, { yaw: -90 }),
      at('table-and-chairs', -1.0, -2.6, FL),
      // garage: a gray concrete floor, the car, a workbench wall
      drawn(1.35, -4.3, 5.3, 4.3, FL, FL + 0.01, C.concrete, { id: `${id}-garage-floor` }),
      at('car', 3.0, 0.6, FL, { yaw: 180, colors: { paint: '#3a4a5a' } }),
      at('metal-cabinet', 4.95, -3.0, FL, { yaw: -90 }),
      at('toolbox', 4.95, -3.0, FL + 1.5, { yaw: -80 }),
      at('tool-chest', 2.2, -4.0, FL),
    ],
    yard: (id) => [
      // a drive to the garage; out back, a renovation that never happened
      box(1.8, 4.5, 4.8, 9.5, -0.1, 0.05, C.road, { id: `${id}-drive`, collide: false }),
      stoop(`${id}-stoop`, -3.0, 4.5),
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [2]),
      ...fenceLine(`${id}-fence-e`, 7, -4.5, 7, -11.5, [0]),
      at('concrete-bag-pallet-1', 3.0, -7.4, 0, { yaw: 12 }),
      at('wood-pallet-large', -3.4, -8.2, 0, { yaw: -8 }),
      at('mailbox', -5.0, 6.9, 0, { yaw: 180 }),
    ],
  });

  // House 6 (south row): a dining hall through the middle from the front door, a bedroom
  // west and the kitchen east (an archway, and a side door), and a glass sunroom across the
  // whole back that every room opens onto, with its own door to the garden.
  const SUN = { bottom: 0.6, top: 2.4, glass: C.glass };
  houseSpecs.push({
    name: 'House 6 (sunroom)',
    pos: [81.5, 89.5],
    yaw: 180,
    color: C['siding-cream'],
    roofColor: C['roof-red'],
    ops: {
      front: [win(-3.6, 1.6), door(0), win(3.6, 1.2)],
      back: [
        { at: -3.8, width: 2.0, ...SUN },
        { at: -1.6, width: 1.2, ...SUN },
        door(0),
        { at: 2.0, width: 1.6, ...SUN },
        { at: 4.0, width: 1.4, ...SUN },
      ],
      west: [win(3.6, 1.0), { at: -3.0, width: 1.6, ...SUN }],
      east: [door(2.6), { at: -3.0, width: 1.6, ...SUN }],
    },
    inside: (id) => [
      wX(`${id}-sun-wall`, -5.3, 5.3, -1.6, FL, FL + 3, C.plaster, [
        door(-3.6),
        { ...door(0), width: 1.6 },
        door(3.6),
      ]),
      wZ(`${id}-p-w`, -1.8, -1.525, 4.3, FL, FL + 3, C.plaster, [door(1.2)], 0.15),
      wZ(
        `${id}-p-e`,
        1.8,
        -1.525,
        4.3,
        FL,
        FL + 3,
        C.plaster,
        [{ ...door(1.8), width: 1.6 }],
        0.15,
      ),
      doorX(`${id}-door-front`, 0, 4.4, FL),
      doorX(`${id}-door-garden`, 0, -4.4, FL, 1.2, { open: true }),
      doorZ(`${id}-door-side`, 5.4, 2.6, FL),
      doorZ(`${id}-door-bed`, -1.8, 1.2, FL),
      doorX(`${id}-door-sun-w`, -3.6, -1.6, FL),
      // dining hall
      at('dining-set', 0, 1.2, FL, { yaw: 90 }),
      spot(`${id}-craft`, 0.3, FL + 0.77, 1.2, 'craftwork', 0.12),
      at('floor-lamp', 1.4, 3.9, FL),
      // bedroom
      at('bed-double', -4.2, 1.6, FL, { yaw: 90 }),
      at('nightstand', -5.08, 2.85, FL, { yaw: 90 }),
      at('wardrobe', -2.175, 3.3, FL, { yaw: -90 }),
      at('suitcase', -4.9, -0.9, FL, { yaw: 90 }),
      // kitchen
      at('kitchen-run', 5.0, 0.2, FL, { yaw: -90 }),
      at('wooden-table', 3.4, 3.9, FL),
      at('wooden-chair', 3.4, 3.3, FL),
      // sunroom: two couches facing the glass, a table each
      at('couch', -2.5, -2.4, FL, { yaw: 180 }),
      at('coffee-table', -2.5, -3.5, FL),
      at('couch', 2.5, -2.4, FL, { yaw: 180 }),
      at('coffee-table', 2.5, -3.5, FL),
      ...porch(id, 0, 4.5, FL, 3.6, 1.4),
    ],
    yard: (id) => [
      // a paved patio off the sunroom with a table and chairs, bushes and a shade tree
      drawn(-3.5, -7.5, 3.5, -4.5, -0.05, 0.03, C.concrete, { id: `${id}-patio` }),
      at('wooden-table', 2.0, -6.2, 0, { yaw: 90 }),
      at('wooden-chair', 1.4, -6.2, 0, { yaw: 90 }),
      at('wooden-chair', 2.6, -6.2, 0, { yaw: -90 }),
      at('bush', -4.6, -9.4, 0, { yaw: 30 }),
      at('broadleaf-tree', 3.4, -9.8, 0),
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 7, -11.5, [0]),
      ...fenceLine(`${id}-fence-e`, 7, -4.5, 7, -11.5, []),
      ...fenceLine(`${id}-fence-w`, -7, -4.5, -7, -11.5, [2]),
      at('mailbox', 1.6, 6.9, 0, { yaw: 180 }),
    ],
  });

  /**
   * House 2, the manager's: two storeys. Ground: a hall from the front door with the stairs
   * up its east side; living room and dining room west (an archway between, a chandelier
   * over the table); a library and the kitchen east, the kitchen's side door to the drive.
   * Upstairs: the master bedroom with the office off it (west), a second bedroom with the
   * bathroom off it (east; a door by the stair top cut the nav grid's link onto the
   * landing). The paintings are up there, each leaning on something, facing into its room:
   * an uncommon against the second bedroom's wall (often), a rare or epic on the master
   * bedroom's wardrobe (seldom), a mythic against the office wall (2%). The AI follows you
   * up.
   */
  function manor(id, color, roofColor) {
    const fl = 0.3;
    const up = 3.3;
    const top = 5.9;
    const n = [
      box(-5.5, -4.5, 5.5, 4.5, -0.3, fl, C['dark-concrete'], { id: `${id}-floor` }),
      drawn(-5.3, -4.3, 5.3, 4.3, fl, fl + 0.01, C.floorboards, { id: `${id}-boards` }),
    ];
    const g = {
      front: [win(-3.8, 1.6), door(-0.2), win(3.6, 1.6)],
      back: [win(-3.6, 1.6), win(3.6, 1.2)],
      west: [win(3.7, 0.9), win(-2.4)],
      east: [door(-1.0), win(-3.2, 1.0)],
    };
    const u = {
      front: [win(-3.8), win(-0.3, 1.0), win(3.6)],
      back: [
        win(-3.4),
        win(-0.4, 1.0),
        { at: 3.6, width: 0.8, bottom: 1.4, top: 2.0, glass: C.glass },
      ],
      west: [win(3.7, 1.0), win(-2.4)],
      east: [win(3.6, 1.0)],
    };
    const ring = (lvl, b, t, ops) => [
      wX(`${id}-${lvl}-front`, -5.5, 5.5, 4.4, b, t, color, ops.front),
      wX(`${id}-${lvl}-back`, -5.5, 5.5, -4.4, b, t, color, ops.back),
      wZ(`${id}-${lvl}-west`, -5.4, -4.3, 4.3, b, t, color, ops.west),
      wZ(`${id}-${lvl}-east`, 5.4, -4.3, 4.3, b, t, color, ops.east),
    ];
    n.push(...ring('g', fl, up, g));
    // the stair hole over the flight: x 0.5..1.725, z −3.0..1.5
    n.push(
      ...slabWithHoles(`${id}-upper`, -5.3, -4.3, 5.3, 4.3, up - 0.2, up, C.floorboards, [
        [0.5, -3.0, 1.725, 1.5],
      ]),
    );
    n.push(...ring('u', up, top + 0.2, u));
    n.push(box(-5.3, -4.3, 5.3, 4.3, top, top + 0.2, C.plaster, { id: `${id}-ceiling` }));
    n.push(drawn(-5.53, 4.47, 5.53, 4.53, up - 0.25, up - 0.05, C.trim, { id: `${id}-band` }));

    // ground floor: the hall's walls, the stairs rising north up its east side
    n.push(
      wZ(`${id}-g-p1`, -1.2, -4.3, 4.3, fl, up - 0.2, C.plaster, [door(2.4), door(-2.4)], 0.15),
      wZ(`${id}-g-p2`, 1.8, -4.3, 4.3, fl, up - 0.2, C.plaster, [door(2.6), door(-0.9)], 0.15),
      wX(
        `${id}-g-arch`,
        -5.3,
        -1.275,
        0,
        fl,
        up - 0.2,
        C.plaster,
        [{ at: -3.2, width: 2.0, bottom: 0, top: 2.3 }],
        0.15,
      ),
      wX(`${id}-g-p3`, 1.875, 5.3, 0, fl, up - 0.2, C.plaster, [], 0.15),
      {
        type: 'stairs',
        id: `${id}-stairs`,
        pos: [1.16, fl, -0.75],
        yaw: 180,
        size: [1.1, r2(up - fl), 4.5],
        color: C.timber,
      },
      along([0.55, fl + 0.5, 1.5], [0.55, up + 0.5, -3.0], 0.08, 1.0, C['timber-dark'], {
        id: `${id}-stair-rail`,
        collide: true,
      }),
      doorX(`${id}-door-front`, -0.2, 4.4, fl),
      doorZ(`${id}-door-side`, 5.4, -1.0, fl),
      doorZ(`${id}-door-living`, -1.2, 2.4, fl, 1.2, { open: true }),
      doorZ(`${id}-door-library`, 1.8, 2.6, fl),
      // living room
      at('tv-unit', -5.07, 2.2, fl, { yaw: 90 }),
      at('coffee-table', -4.3, 2.2, fl, { yaw: 90 }),
      at('couch', -3.3, 2.2, fl, { yaw: -90 }),
      at('floor-lamp', -1.7, 3.9, fl),
      // dining room, under a chandelier
      at('dining-set', -3.3, -2.2, fl, { yaw: 90 }),
      at('chandelier', -3.3, -2.2, up - 0.2 - 1.3),
      // the estate reserve on the dining table, very rarely (mythic: loose only)
      spot(`${id}-fine-wine`, -3.3, fl + 0.77, -1.85, 'fine-wine', 0.02),
      // library
      at('bookcase-tall', 5.05, 2.15, fl, { yaw: -90 }),
      at('couch', 3.6, 2.2, fl, { yaw: 90 }),
      at('floor-lamp', 2.3, 0.5, fl),
      // kitchen
      at('kitchen-run', 2.175, -2.75, fl, { yaw: 90 }),
      // the manager's limited-edition slow cooker, very rarely (mythic: loose only)
      spot(`${id}-mythic-cooker`, 2.9, fl, -2.2, 'mythic-household', 0.02),
      at('table-and-chairs', 3.9, -2.6, fl, { yaw: 90 }),
    );

    // upstairs: rails round the stair hole, the rooms
    n.push(
      box(0.42, -3.0, 0.5, 1.58, up, up + 1.0, C['timber-dark'], { id: `${id}-hole-rail-w` }),
      box(0.42, 1.5, 1.725, 1.58, up, up + 1.0, C['timber-dark'], { id: `${id}-hole-rail-s` }),
      wZ(`${id}-u-p1`, -1.2, -4.3, 4.3, up, top, C.plaster, [door(2.0), door(-2.6)], 0.15),
      wZ(`${id}-u-p2`, 1.8, -4.3, 4.3, up, top, C.plaster, [door(2.9)], 0.15),
      wX(`${id}-u-p3`, 1.875, 5.3, -1.0, up, top, C.plaster, [{ ...door(4.6), width: 0.9 }], 0.15),
      wX(`${id}-u-p4`, -5.3, -1.275, -0.5, up, top, C.plaster, [door(-2.9)], 0.15),
      doorZ(`${id}-door-master`, -1.2, 2.0, up),
      doorZ(`${id}-door-office`, -1.2, -2.6, up),
      doorX(`${id}-door-master-office`, -2.9, -0.5, up, 1.2, { open: true }),
      doorZ(`${id}-door-bed-2`, 1.8, 2.9, up, 1.2, { open: true }),
      doorX(`${id}-door-bath`, 4.6, -1.0, up, 0.9),
      // master bedroom
      at('bed-double', -4.2, 1.9, up, { yaw: 90 }),
      at('nightstand', -5.08, 0.7, up, { yaw: 90 }),
      at('nightstand', -5.08, 3.1, up, { yaw: 90 }),
      at('wardrobe', -1.575, 0.475, up, { yaw: -90 }),
      at('suitcase', -4.6, 3.75, up),
      // leaning on the wardrobe's front
      spot(`${id}-paint-fine`, -1.875, up, 0.475, 'fine-paintings', 0.08, -90),
      // office
      at('desk', -4.9, -2.4, up, { yaw: 90 }),
      at('briefcase', -4.9, -1.9, up + 0.76, { yaw: 80 }),
      // something fine on the manager's desk (2026-11-17: fine craftwork only in rich rooms)
      {
        type: 'lootSpawn',
        id: `${id}-fine-craft`,
        pos: [-4.9, r2(up + 0.76), -2.95],
        // fine craftwork, now and then a prize (loose only: epic+ paintings, mythic pieces)
        mix: { tables: { 'craftwork-fine': 3, 'craftwork-prize': 1 } },
        chance: 0.08,
      },
      at('filing-cabinet', -2.0, -4.0, up),
      // against the north wall, between the corner and the door to the master bedroom
      spot(`${id}-paint-mythic`, -4.4, up, -0.575, 'mythic-paintings', 0.02, 180),
      // second bedroom
      at('bed-double', 4.2, 1.6, up, { yaw: -90 }),
      at('wardrobe', 2.85, -0.625, up),
      at('wooden-table', 3.6, 3.95, up),
      at('wooden-chair', 3.6, 3.35, up),
      // against the west wall, between the wardrobe and the door
      spot(`${id}-paint-home`, 1.875, up, 1.0, 'house-paintings', 0.3, 90),
      // bathroom
      at('bathtub', 4.4, -3.85, up, { yaw: 90 }),
      at('toilet', 2.175, -2.0, up, { yaw: 90 }),
      // medicine cabinet on the partition over the toilet
      at('medicine-cabinet', 1.875, -2.0, up, { yaw: 90 }),
      // landing
      at('duffle-bag', -0.4, -3.9, up),
    );
    const rf = roof(`${id}-roof`, -5.5, 5.5, -4.5, 4.5, top + 0.2, 30, {
      roof: roofColor,
      gable: color,
    });
    n.push(...rf.nodes);
    // Drawn: it stands through the roof's slope, which is what collides up there.
    n.push(
      drawn(-4.4, -2.6, -3.6, -1.8, top + 0.2, rf.ridge + 1.0, C.stone, { id: `${id}-chimney` }),
    );
    n.push(...porch(id, -0.2, 4.5, fl, 3.0, 1.6));
    // the drive down the east side, the manager's car on it
    n.push(box(6.0, -6.0, 8.6, 9.5, -0.1, 0.05, C.road, { id: `${id}-drive`, collide: false }));
    n.push(at('car', 7.3, -1.5, 0, { yaw: 4, colors: { paint: '#2a2a30' } }));
    // back garden: a bench between two hedges, a pine
    n.push(
      ...fenceLine(`${id}-fence-back`, -7, -11.5, 5.5, -11.5, [2]),
      ...fenceLine(`${id}-fence-w`, -7, -4.5, -7, -11.5, []),
      at('mall-bench', 0, -8.4, 0, { yaw: 180 }),
      at('bush', -3.4, -9.8, 0),
      at('bush', 3.2, -9.9, 0, { yaw: 180 }),
      at('pine-tree', -5.4, -7.6, 0),
      at('mailbox', 5.4, 6.9, 0, { yaw: 180 }),
    );
    return n;
  }

  const houses = houseSpecs.map((s, k) => {
    const id = `house-${k + 1}`;
    let nodes;
    if (s.manor) nodes = manor(id, s.color, s.roofColor);
    else {
      const sh = shell(id, { fl: FL, color: s.color, ops: s.ops });
      const rf = roof(`${id}-roof`, -5.5, 5.5, -4.5, 4.5, sh.top, 30, {
        roof: s.roofColor,
        gable: s.color,
      });
      nodes = [...sh.nodes, ...rf.nodes, ...s.inside(id), ...s.yard(id)];
      if (s.chimney) {
        const [x0, z0, x1, z1] = s.chimney;
        nodes.push(drawn(x0, z0, x1, z1, sh.top, rf.ridge + 0.8, C.stone, { id: `${id}-chimney` }));
      }
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
      // the register over the counter's drawn till (2026-11-17, `cash-register`), a drinks
      // fridge by the back wall (`fridge`), and the station's electrics in the stockroom
      // (the west end's second low-risk electrical spot)
      at('cash-register', -4.7, 2.0, fl + 1.05, { id: 'store-register' }),
      at('fridge-v2', -2.6, -0.84, fl, { id: 'store-fridge', loot: FRIDGE }),
      at('electrical-cabinet', 5.2, -1.83, fl, { id: 'store-electrics', yaw: 180 }),
      drawn(3.9, -1.6, 4.6, -1.575, fl + 1.2, fl + 2.0, C['steel-dark'], { id: 'store-breakers' }),
      {
        type: 'lootSpawn',
        id: 'store-stock-spot',
        pos: [4.4, fl, -2.5],
        lootTable: 'switch-room',
        chance: 0.3,
      },
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
      at('toilet', -5.5, -4.95, fl),
      // medicine cabinet on the back wall over the toilet
      at('medicine-cabinet', -5.5, -5.3, fl, { id: 'store-meds' }),
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
    prefab('truck-tire-1', 31.5, 135.4, { yaw: 40 }, 0.4),
    prefab('car', 25.5, 140, { yaw: 72, colors: { paint: '#6a5a4a' } }, 0.2),
  ]);

  // ---------------------------------------------------------------- cover in the open
  // Cars along the houses' lane (staggered, so the 68 m lane has no clear line), and hard
  // cover over the open ground round the west spawns and south of the highway.
  /** A prefab on the lowest ground under its footprint (beds in on a slope). */
  const bedded = (name, x, z, hw, hd, extra = {}) =>
    prefab(name, x, z, extra, r2(groundRange(x - hw, z - hd, x + hw, z + hd)[0]));
  const cover = group('West end cover', [
    // The open-ground pass (2026-11-17, from the map report's runs over 40 m): eye-height
    // pieces set across the worst runs at an angle, alternating from each side, each with a
    // way past. The ridge foot north of the office (z 24-28, about 110 m end to end):
    bedded('lumber-stack-tall', 21, 26.8, 2.5, 1.5, { id: 'ct-ridge-foot-1', yaw: 28 }),
    bedded('log-pile-tall', 46, 27.2, 3, 1, { id: 'ct-ridge-foot-2', yaw: -24 }),
    bedded('rock-large', 69, 27.2, 2, 1, { id: 'ct-ridge-foot-3', yaw: 15 }),
    bedded('lumber-stack-tall', 93, 25.4, 2.5, 1.5, { id: 'ct-ridge-foot-4', yaw: -30 }),
    // the field between the sheds and the log deck, across its diagonal
    bedded('log-pile-tall', 83, 39, 3, 1, { id: 'ct-deck-field-1', yaw: -42 }),
    // the yard lane down the town's east side
    bedded('log-pile-tall', 97.5, 64, 3, 1, { id: 'ct-yard-lane-1', yaw: 22 }),
    prefab('car', 94.6, 97, { id: 'ct-yard-lane-car', yaw: 8, colors: { paint: '#3e4a3a' } }, 0),
    // south of the highway, east of the gas station
    prefab('car', 55, 126.5, { id: 'ct-verge-car', yaw: 35, colors: { paint: '#6a6a6a' } }, 0),
    bedded('lumber-stack-tall', 71, 129, 2.5, 1.5, { id: 'ct-verge-stack', yaw: -32 }),
    bedded('rock-large', 86, 125, 2, 1, { id: 'ct-verge-rock', yaw: 40 }),
    // the field between the sheds and the houses
    bedded('log-pile-tall', 60, 56.2, 3, 1, { id: 'ct-mid-field-1', yaw: 16 }),
    // the highway's west stretch from the west extract: two wrecks in alternate lanes, so
    // with the box truck (north lane, x 73.5) no lane runs clear
    prefab('car', 36, 116.6, { id: 'ct-highway-car-1', yaw: 14, colors: { paint: '#5a3a3a' } }, 0),
    prefab('car', 56, 119.6, { id: 'ct-highway-car-2', yaw: -12, colors: { paint: '#3a4a5a' } }, 0),
    // the field by the west-2 spawn, across its two diagonals
    bedded('log-pile-tall', 15, 90, 3, 1, { id: 'ct-spawn-field-1', yaw: 38 }),
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

  // ---------------------------------------------------------------- the west extracts
  // Made places (2026-11-17; the zones stay where they were, the user's pick): the highway
  // leaves by the company gate, the ridge trail by its trailhead. Each has a mark you can
  // see coming and cover on its last open stretch, with lanes past.
  const gy = (x, z) => r2(groundAt(x, z));
  const gate = group('Company gate', [
    // the gate posts either side of the highway, the arch and the company's board on it
    ...[113.4, 122.6].map((z, k) =>
      box(9.6, z - 0.2, 10.0, z + 0.2, 0, 5.2, C['timber-dark'], { id: `gate-post-${k + 1}` }),
    ),
    drawn(9.55, 113.2, 10.05, 122.8, 4.6, 5.0, C['timber-dark'], { id: 'gate-arch' }),
    drawn(9.5, 115.2, 9.55, 120.8, 4.85, 5.75, C.trim, { id: 'gate-board' }),
    drawn(9.47, 115.6, 9.5, 120.4, 5.15, 5.45, C['store-red'], { id: 'gate-board-text' }),
    // the gatehouse north of the road: solid, a window on each side, its roof over it
    box(8, 109.4, 10.6, 112.2, 0, 2.6, C['siding-cream'], { id: 'gatehouse' }),
    drawn(7.8, 109.2, 10.8, 112.4, 2.6, 2.75, C.roof, { id: 'gatehouse-roof' }),
    drawn(10.6, 110.2, 10.64, 111.4, 1.2, 2.0, C.glass, { id: 'gatehouse-window-e' }),
    drawn(8.6, 112.2, 10.0, 112.24, 1.2, 2.0, C.glass, { id: 'gatehouse-window-s' }),
    // the boom's post and its arm left raised
    box(10.3, 112.9, 10.7, 113.3, 0, 1.1, C.trim, { id: 'gate-boom-post' }),
    along([10.5, 1.0, 113.1], [10.5, 4.2, 115.0], 0.1, 0.1, C['store-red'], {
      id: 'gate-boom-arm',
    }),
    // the last stretch in: barriers staggered across the lanes, a lane past each
    prefab('jersey-barrier', 17, 116.2, { id: 'gate-barrier-1', yaw: 10 }, gy(17, 116.2)),
    prefab('jersey-barrier', 25, 120.4, { id: 'gate-barrier-2', yaw: -8 }, gy(25, 120.4)),
  ]);
  const trailhead = group('Trailhead', [
    // the trail map board on two posts at the bench's north edge (solid: no fake cover)
    ...[9.2, 11.2].map((x, k) => {
      const y = gy(x, 17.3);
      return box(x - 0.07, 17.23, x + 0.07, 17.37, y, y + 2.3, C['timber-dark'], {
        id: `trailhead-post-${k + 1}`,
      });
    }),
    box(9.3, 17.26, 11.1, 17.34, gy(10.2, 17.3) + 1.1, gy(10.2, 17.3) + 2.0, C.boards, {
      id: 'trailhead-board',
    }),
    drawn(9.4, 17.34, 11.0, 17.36, gy(10.2, 17.3) + 1.2, gy(10.2, 17.3) + 1.9, C.trim, {
      id: 'trailhead-map',
    }),
    drawn(9.15, 17.1, 11.25, 17.5, gy(10.2, 17.3) + 2.3, gy(10.2, 17.3) + 2.42, C.roof, {
      id: 'trailhead-cap',
    }),
    // a log bench, and the gate bar fallen across the trail's edge
    box(12.5, 22.0, 14.5, 22.5, gy(13.5, 22.25), gy(13.5, 22.25) + 0.45, C.log, {
      id: 'trailhead-bench',
    }),
    box(7.4, 22.3, 7.6, 22.5, gy(7.5, 22.4), gy(7.5, 22.4) + 1.1, C['timber-dark'], {
      id: 'trailhead-gate-post',
    }),
    box(7.5, 21.0, 10.4, 21.2, gy(9, 21.1), gy(9, 21.1) + 0.2, C['timber-dark'], {
      id: 'trailhead-gate-bar',
    }),
    // on the open bench between the zone and the trail's first pile: a boulder to the south
    // edge, the trail past it
    prefab('rock-large', 18, 21.6, { id: 'trailhead-rock', yaw: 12 }, gy(18, 21.6)),
  ]);

  return group('West end', [
    gate,
    trailhead,
    office,
    lookout,
    lookoutHut,
    group('Sheds', sheds),
    group('Company houses', houses),
    gas,
    cover,
    label('Company houses', 62, 81),
    // The store and its pumps are one place on the map tab: "Gas station" (MT-11).
  ]);
}
