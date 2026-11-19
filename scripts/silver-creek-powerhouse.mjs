// Silver Creek's powerhouse (2026-11-16, the user's ask: a third electrical place, and more to
// the middle than the mill). The mill burns its waste in a boiler and makes its own power. It
// stands on the south bank, south of the highway between the race tunnel's west stairs and
// the road bridge. Design and loot spots: docs/design/maps/silver-creek.md → Powerhouse.
// No loot placed: the user places it.
//
// - Boiler house (west, x 121–131): the boiler is one solid block with lanes round it. An
//   L-shaped gallery at 3.3 m above the floor runs along the south wall and up the east side,
//   reached by a stair in the west lane (the AI follows) and an outside stair on the west
//   wall. The catwalk's north end and the gallery's edge drop 3.3 m to the floor.
// - Turbine hall (east, x 131–146): the turbine-generator set on a waist-high plinth splits
//   the floor into a north and a south lane. A mezzanine along the south wall carries the
//   control room, the only way between its two ends: windows over the floor (it sees all of
//   it and is seen from all of it), doors west (to the boiler gallery) and east (the hall's
//   stair). Under it, the switch room (three doors) and the battery room (two).
// - Outside: a transformer yard west, the stack south, a pole line north across the highway
//   to the mill.
import { buildingKit } from './mapkit/building.mjs';

// Grid electrics roll the substation's table, not office/computer electrical (looting.md).
const GRID_MIX = { tables: { substation: 0.8, industrial: 0.2 }, empty: 0.15 };

export const POWERHOUSE = { x0: 121, xm: 131, x1: 146, z0: 126, z1: 140 };

export function buildPowerhouse(h) {
  const { box, drawn, group, prefab, along, label, C } = h;
  const { wX, wZ, door, win, doorX, doorZ } = buildingKit(h);
  Object.assign(C, {
    'ph-brick': '#86503c',
    turbine: '#5f7a86',
    'ph-gravel': '#85827a',
  });
  const P = { ...POWERHOUSE, fl: 0.3, up: 3.6, bTop: 9.5, hTop: 8.6 };
  const brick = C['ph-brick'];
  const steel = C.steel;
  // Openings are measured from the wall's foot (the floor, 0.3).
  const clere = (at, w = 1.6) => win(at, w, { bottom: 6.4, top: 7.6 });
  const upWin = (at, w = 1.4) => win(at, w, { bottom: 4.2, top: 5.3 });
  const upDoor = (at) => ({ at, width: 1.1, bottom: 3.3, top: 5.4 });
  const dcol = { color: C['steel-dark'] };
  /** A rail 1 m high on the upper level (vaultable, so every edge is also a drop). */
  const rail = (id, x0, z0, x1, z1, y = P.up) => box(x0, z0, x1, z1, y, y + 1, C.hazard, { id });
  const at = (name, x, z, y, extra = {}) => prefab(name, x, z, extra, y);
  /** A loose spot (the top tiers only go in rooms you commit to: the user's call, 2026-11-17). */
  const spot = (id, x, y, z, lootTable, chance) => ({
    type: 'lootSpawn',
    id,
    pos: [x, y, z],
    lootTable,
    chance,
  });

  // ------------------------------------------------------------------ shell
  const shell = [
    box(P.x0, P.z0, P.x1, P.z1, -0.2, P.fl, C['dark-concrete'], { id: 'ph-floor' }),
    wX('ph-wall-n-b', P.x0, P.xm, P.z0 + 0.1, P.fl, P.bTop, brick, [
      win(123.2),
      door(126),
      win(129.3),
      clere(124.7, 1.2),
      clere(127.6, 1.2),
    ]),
    wX('ph-wall-n-h', P.xm, P.x1, P.z0 + 0.1, P.fl, P.hTop, brick, [
      door(133.5),
      { at: 138, width: 4, bottom: 0, top: 4 }, // the bay, its shutter rolled up
      win(142.6),
      clere(135, 1.2),
      clere(141),
    ]),
    wX('ph-wall-s-b', P.x0, P.xm, P.z1 - 0.1, P.fl, P.bTop, brick, [
      door(123.5),
      win(128.3),
      clere(126),
    ]),
    wX('ph-wall-s-h', P.xm, P.x1, P.z1 - 0.1, P.fl, P.hTop, brick, [
      door(133),
      win(136.8),
      win(143.2),
      upWin(138.5, 1.6), // the control room's one window out, onto the slope
    ]),
    wZ('ph-wall-w', P.x0 + 0.1, P.z0 + 0.2, P.z1 - 0.2, P.fl, P.bTop, brick, [
      door(128),
      upDoor(138.4),
      clere(130.5),
      clere(135),
    ]),
    wZ('ph-wall-e', P.x1 - 0.1, P.z0 + 0.2, P.z1 - 0.2, P.fl, P.hTop, brick, [
      win(127.6),
      door(137.5),
      clere(132),
    ]),
    // Boiler house | turbine hall: a door on the floor, a door and a window on the upper level.
    wZ('ph-wall-mid', P.xm, P.z0 + 0.2, P.z1 - 0.2, P.fl, P.bTop, brick, [
      door(127.5),
      upDoor(137.5),
      upWin(132.2, 1.6),
    ]),
    doorX('ph-door-n-b', 126, P.z0 + 0.1, P.fl, 1.2, dcol),
    doorX('ph-door-n-h', 133.5, P.z0 + 0.1, P.fl, 1.2, dcol),
    doorX('ph-door-s-b', 123.5, P.z1 - 0.1, P.fl, 1.2, dcol),
    doorX('ph-door-s-h', 133, P.z1 - 0.1, P.fl, 1.2, dcol),
    doorZ('ph-door-w', P.x0 + 0.1, 128, P.fl, 1.2, dcol),
    doorZ('ph-door-w-up', P.x0 + 0.1, 138.4, P.up, 1.1, dcol),
    doorZ('ph-door-e', P.x1 - 0.1, 137.5, P.fl, 1.2, dcol),
    doorZ('ph-door-mid', P.xm, 127.5, P.fl, 1.2, dcol),
    doorZ('ph-door-mid-up', P.xm, 137.5, P.up, 1.1, dcol),
    drawn(136, P.z0 - 0.15, 140, P.z0 + 0.35, 4.3, 4.8, C['steel-dark'], { id: 'ph-shutter' }),
    box(P.x0, P.z0, P.xm, P.z1, P.bTop, P.bTop + 0.2, C.roof, { id: 'ph-roof-b' }),
    box(P.xm, P.z0, P.x1, P.z1, P.hTop, P.hTop + 0.2, C.roof, { id: 'ph-roof-h' }),
    drawn(P.x0 - 0.05, P.z0 - 0.05, P.x1 + 0.05, P.z0 + 0.05, 3.3, 3.5, C.concrete, {
      id: 'ph-band-n',
    }),
    drawn(P.x0 - 0.05, P.z1 - 0.05, P.x1 + 0.05, P.z1 + 0.05, 3.3, 3.5, C.concrete, {
      id: 'ph-band-s',
    }),
    prefab('wall-light', 126, P.z0 - 0.01, { yaw: 180 }, 2.8),
    prefab('wall-light', 138, P.z0 - 0.01, { yaw: 180 }, 4.9),
    prefab('high-voltage-sign', P.x1 + 0.01, 136.3, { yaw: 90 }, 1.7),
  ];

  // ------------------------------------------------------------------ boiler house
  // The boiler: x 123.5–128.5, z 128.5–135.5, brick-set to the gallery, steel above. Lanes
  // round it: west 2.3 m (the stair), east 2.4 (under the catwalk), north 2.3, south 4.3.
  const B = { x0: 123.5, x1: 128.5, z0: 128.5, z1: 135.5 };
  const boiler = group('Boiler house', [
    box(B.x0, B.z0, B.x1, B.z1, P.fl, 3.4, brick, { id: 'ph-boiler-setting' }),
    box(B.x0 + 0.2, B.z0 + 0.2, B.x1 - 0.2, B.z1 - 0.2, 3.4, 9.0, C['steel-dark'], {
      id: 'ph-boiler',
    }),
    ...[124.6, 126.9].map((x, k) =>
      drawn(x, B.z0 - 0.06, x + 1.1, B.z0, 0.9, 1.9, C.rust, { id: `ph-fire-door-${k + 1}` }),
    ),
    drawn(125.2, B.z0 - 0.5, 127.2, B.z0, 4.6, 6.6, C.rust, { id: 'ph-fuel-hopper' }),
    ...[130.4, 132.6].map((z, k) =>
      drawn(B.x1, z, B.x1 + 0.05, z + 0.4, 4.7, 5.1, C['paint-white'], {
        id: `ph-gauge-${k + 1}`,
      }),
    ),
    // the gallery: the south strip and the east catwalk, steel at 3.3 m
    box(P.x0 + 0.2, 136.8, P.xm - 0.1, P.z1 - 0.2, P.up - 0.2, P.up, steel, {
      id: 'ph-gallery-s',
    }),
    box(B.x1 + 0.1, B.z0, P.xm - 0.1, 136.8, P.up - 0.2, P.up, steel, { id: 'ph-gallery-e' }),
    rail('ph-gallery-rail-n', 122.6, 136.8, B.x1 + 0.1, 136.88),
    rail('ph-gallery-rail-w', B.x1 + 0.02, B.z1, B.x1 + 0.1, 136.8),
    drawn(B.x1 + 0.1, B.z0, P.xm - 0.1, B.z0 + 0.08, P.up, P.up + 0.02, C.hazard, {
      id: 'ph-catwalk-edge',
    }),
    ...[125, 128].map((x, k) =>
      box(x - 0.1, 136.8, x + 0.1, 137.0, P.fl, P.up - 0.2, C['steel-dark'], {
        id: `ph-gallery-post-${k + 1}`,
      }),
    ),
    {
      type: 'stairs',
      id: 'ph-stairs-boiler',
      pos: [121.9, P.fl, 133.65],
      yaw: 0,
      size: [1.2, P.up - P.fl, 6.3],
      color: steel,
      sides: 1.0,
    },
    // the floor: feed pumps and a bench in the south lane, lockers in the east, shelving
    box(126.6, 137.1, 129.4, 138.2, P.fl, 1.4, C.machine, { id: 'ph-feed-pumps' }),
    spot('ph-pumps-loose', 128, 1.4, 137.65, 'hydraulics', 0.4),
    box(125.2, 139.2, 128.4, P.z1 - 0.2, P.fl, 1.25, C.timber, { id: 'ph-bench' }),
    at('tool-chest', 129.9, P.z1 - 0.43, P.fl, { id: 'ph-tool-chest', yaw: 180 }),
    at('toolbox', 126.5, P.z1 - 0.4, P.up, { id: 'ph-gallery-toolbox', yaw: 180 }),
    spot('ph-catwalk-loose', 129.8, P.up, 129.2, 'millwright', 0.3),
    at('locker-bank', 130.6, 134, P.fl, { id: 'ph-lockers', yaw: -90 }),
    // the crew's first-aid cabinet on the mid wall beside the lockers
    at('medicine-cabinet', 130.85, 135.6, P.fl, { id: 'ph-first-aid', yaw: -90 }),
    at('ems-bag', 130.3, 136.6, P.fl, { id: 'ph-ems-bag', yaw: 90 }),
    at('metal-shelving', 122.4, 126.5, P.fl, { id: 'ph-shelving' }),
    at('steel-barrel', 121.7, 138.0, P.fl, { id: 'ph-drum-1' }),
    at('steel-barrel', 121.75, 138.7, P.fl, { id: 'ph-drum-2' }),
    // steam out to the turbine, over the catwalk
    drawn(B.x1, 130.2, P.xm - 0.1, 130.8, 6.6, 7.2, steel, { id: 'ph-steam-b' }),
  ]);

  // ------------------------------------------------------------------ turbine hall
  const MZ = { z0: 135, y: P.up };
  const CR = { x0: 134, x1: 143, z0: 135.3 };
  const hall = group('Turbine hall', [
    // the turbine set: plinth 0.8 m (waist), casing and generator at eye height on it
    box(133, 129, 142, 132, P.fl, 1.1, C.concrete, { id: 'ph-plinth' }),
    spot('ph-plinth-loose', 135.5, 1.1, 129.2, 'millwright', 0.3),
    box(133.4, 129.4, 137.6, 131.6, 1.1, 2.7, C.turbine, { id: 'ph-turbine' }),
    box(138.4, 129.3, 141.6, 131.7, 1.1, 2.9, C.machine, { id: 'ph-generator' }),
    drawn(137.6, 130.2, 138.4, 130.8, 1.6, 2.2, C['steel-dark'], { id: 'ph-coupling' }),
    drawn(P.xm + 0.1, 130.2, 134.4, 130.8, 6.6, 7.2, steel, { id: 'ph-steam-h' }),
    drawn(133.8, 130.2, 134.4, 130.8, 2.7, 6.6, steel, { id: 'ph-steam-down' }),
    box(141, 126.3, 143, 127.4, P.fl, 2.0, C['machine-dark'], { id: 'ph-oil-tank' }),
    at('cable-drum-small', 132.1, 133.6, P.fl, { id: 'ph-drum-small' }),
    at('hazard-barrel', 143.6, 128.2, P.fl, { id: 'ph-barrel-1' }),
    // the overhead crane, drawn
    drawn(P.xm + 0.1, P.z0 + 0.2, P.x1 - 0.1, P.z0 + 0.5, 7.3, 7.5, steel, {
      id: 'ph-crane-rail-n',
    }),
    drawn(P.xm + 0.1, P.z1 - 0.5, P.x1 - 0.1, P.z1 - 0.2, 7.3, 7.5, steel, {
      id: 'ph-crane-rail-s',
    }),
    drawn(137, P.z0 + 0.2, 137.8, P.z1 - 0.2, 7.5, 8.0, C.hazard, { id: 'ph-crane' }),
    drawn(137.25, 130.3, 137.55, 130.6, 5.6, 7.5, C.dark, { id: 'ph-crane-hook' }),
    // the hall's stair up the east wall to the mezzanine's east end
    {
      type: 'stairs',
      id: 'ph-stairs-hall',
      pos: [145.1, P.fl, 132],
      yaw: 0,
      size: [1.2, P.up - P.fl, 6],
      color: steel,
      sides: 1.0,
    },
    // the mezzanine over the switch and battery rooms
    box(P.xm + 0.1, MZ.z0, P.x1 - 0.1, P.z1 - 0.2, MZ.y - 0.2, MZ.y, steel, { id: 'ph-mezz' }),
    rail('ph-mezz-rail-w', P.xm + 0.1, MZ.z0, CR.x0, MZ.z0 + 0.08),
    rail('ph-mezz-rail-e', CR.x1, MZ.z0, 144.5, MZ.z0 + 0.08),
    // the control room: windows over the floor, doors at both ends of the mezzanine
    wX(
      'ph-cr-wall-n',
      CR.x0,
      CR.x1,
      CR.z0,
      MZ.y,
      6.4,
      C['office-siding'],
      [win(135.6, 2.0), win(138.5, 2.0), win(141.4, 2.0)],
      0.15,
    ),
    wZ(
      'ph-cr-wall-w',
      CR.x0 + 0.07,
      CR.z0 + 0.08,
      P.z1 - 0.2,
      MZ.y,
      6.4,
      C['office-siding'],
      [door(137.5, 1.0)],
      0.15,
    ),
    wZ(
      'ph-cr-wall-e',
      CR.x1 - 0.07,
      CR.z0 + 0.08,
      P.z1 - 0.2,
      MZ.y,
      6.4,
      C['office-siding'],
      [door(137.5, 1.0)],
      0.15,
    ),
    doorZ('ph-door-cr-w', CR.x0 + 0.07, 137.5, MZ.y, 1.0),
    doorZ('ph-door-cr-e', CR.x1 - 0.07, 137.5, MZ.y, 1.0),
    box(CR.x0, CR.z0 - 0.08, CR.x1, P.z1 - 0.2, 6.4, 6.6, steel, { id: 'ph-cr-roof' }),
    at('monitor-desk', 137.2, 135.8, MZ.y, { id: 'ph-cr-desk-1' }),
    spot('ph-cr-loose', 136.4, MZ.y + 0.77, 135.75, 'substation', 0.4),
    at('electrical-cabinet', 140.3, P.z1 - 0.45, MZ.y, {
      id: 'ph-cr-cabinet',
      yaw: 180,
      loot: { container: 'electrical-cabinet', mix: GRID_MIX },
    }),
    at('monitor-desk', 140.4, 135.8, MZ.y, { id: 'ph-cr-desk-2' }),
    at('office-chair', 137.2, 136.8, MZ.y, { id: 'ph-cr-chair-1', yaw: 180 }),
    at('office-chair', 140.6, 136.9, MZ.y, { id: 'ph-cr-chair-2', yaw: 160 }),
    at('substation-control-panel', 136.2, P.z1 - 0.4, MZ.y, { id: 'ph-cr-panel', yaw: 180 }),
    spot('ph-cr-mythic', 139.55, MZ.y + 0.77, 135.75, 'mythic-electronics', 0.02),
    at('electrical-panel', 141.6, P.z1 - 0.2, MZ.y, { id: 'ph-cr-wall-panel', yaw: 180 }),
    // under the mezzanine: the switch room (west) and the battery room (east)
    wX('ph-wall-rooms', P.xm + 0.1, P.x1 - 0.1, MZ.z0 + 0.1, P.fl, MZ.y - 0.2, C.concrete, [
      door(136.5),
      door(142.5),
    ]),
    wZ('ph-wall-battery', 139.5, MZ.z0 + 0.2, P.z1 - 0.2, P.fl, MZ.y - 0.2, C.concrete, [
      door(137.4, 1.0),
    ]),
    doorX('ph-door-switch', 136.5, MZ.z0 + 0.1, P.fl, 1.2, dcol),
    doorX('ph-door-battery', 142.5, MZ.z0 + 0.1, P.fl, 1.2, dcol),
    doorZ('ph-door-battery-in', 139.5, 137.4, P.fl, 1.0, dcol),
    // switchgear down the switch room's middle: a lane each side, round either end
    at('switchgear-cabinet', 134.3, 137.4, P.fl, { id: 'ph-switchgear-1' }),
    at('switchgear-cabinet', 136.85, 137.4, P.fl, { id: 'ph-switchgear-2' }),
    at('electrical-panel', 131.4, 137.6, P.fl, { id: 'ph-panel-1', yaw: 90 }),
    at('ups-cabinet', 138.8, P.z1 - 0.65, P.fl, { id: 'ph-ups', yaw: 180 }),
    at('battery-rack', 141.3, P.z1 - 0.6, P.fl, { id: 'ph-battery-1' }),
    spot('ph-battery-loose', 141.3, P.fl + 1.3, P.z1 - 0.6, 'substation', 0.3),
    at('electrical-cabinet', 131.6, 136.2, P.fl, {
      id: 'ph-switch-cabinet',
      yaw: 90,
      loot: { container: 'electrical-cabinet', mix: GRID_MIX },
    }),
    at('battery-rack', 143.8, P.z1 - 0.6, P.fl, { id: 'ph-battery-2' }),
    spot('ph-battery-legendary', 143.8, P.fl + 1.3, P.z1 - 0.6, 'legendary-electronics', 0.06),
    at('circuit-breaker', 141.0, MZ.z0 + 0.45, P.fl, { id: 'ph-breaker' }),
  ]);

  // ------------------------------------------------------------------ outside
  const outside = group('Powerhouse yard', [
    // the outside stair up the west wall to the gallery, its landing railed
    {
      type: 'stairs',
      id: 'ph-stairs-out',
      pos: [120.15, 0, 133.9],
      yaw: 0,
      size: [1.2, P.up, 5.8],
      color: steel,
      sides: 1.0,
    },
    box(119.35, 136.8, P.x0 - 0.1, P.z1 - 0.2, P.up - 0.2, P.up, steel, { id: 'ph-landing' }),
    rail('ph-landing-rail-w', 119.35, 136.8, 119.43, P.z1 - 0.2),
    rail('ph-landing-rail-s', 119.43, P.z1 - 0.28, P.x0 - 0.1, P.z1 - 0.2),
    box(119.4, 139.4, 119.6, 139.6, 0, P.up - 0.2, C['steel-dark'], { id: 'ph-landing-post' }),
    // the stack on its base south of the boiler house, the flue into it
    box(125.3, 141.2, 127.7, 143.6, -0.5, 2.2, C.concrete, { id: 'ph-stack-base' }),
    {
      type: 'cylinder',
      id: 'ph-stack',
      pos: [126.5, 2.2, 142.4],
      radius: 0.85,
      radiusTop: 0.7,
      height: 15.8,
      sides: 8,
      color: C['dark-concrete'],
    },
    drawn(125.9, P.z1, 127.1, 141.6, 6.2, 7.4, C.rust, { id: 'ph-flue' }),
    // the transformer yard west
    drawn(108.5, 130.5, 117.6, 140, -0.05, 0.03, C['ph-gravel'], { id: 'ph-yard-gravel' }),
    at('power-transformer', 112.2, 135.2, 0, { id: 'ph-transformer', yaw: 90 }),
    at('transformer-enclosure', 115.8, 138.2, 0, { id: 'ph-enclosure' }),
    at('electrical-cabinet', 115.6, 133.2, 0, {
      id: 'ph-yard-cabinet',
      yaw: 90,
      loot: { container: 'electrical-cabinet', mix: GRID_MIX },
    }),
    prefab('high-voltage-sign', 115.8, 136.69, { yaw: 180 }, 1.7),
    box(109.85, 130.85, 110.15, 131.15, 0, 8, C.timber, { id: 'ph-yard-pole' }),
    drawn(109.2, 130.9, 110.8, 131.1, 7.4, 7.55, C.timber, { id: 'ph-yard-pole-arm' }),
    along([110, 7.45, 131], [P.x0, 7.2, 131.6], 0.04, 0.04, C.dark, { id: 'ph-wire-yard' }),
    // the pole line north over the highway to the mill
    box(143.35, 123.85, 143.65, 124.15, 0, 8.4, C.timber, { id: 'ph-pole-1' }),
    drawn(142.7, 123.9, 144.3, 124.1, 7.8, 7.95, C.timber, { id: 'ph-pole-1-arm' }),
    box(143.35, 110.35, 143.65, 110.65, 0, 8.4, C.timber, { id: 'ph-pole-2' }),
    drawn(142.7, 110.4, 144.3, 110.6, 7.8, 7.95, C.timber, { id: 'ph-pole-2-arm' }),
    along([143.5, 7.9, P.z0], [143.5, 7.9, 124], 0.04, 0.04, C.dark, { id: 'ph-wire-1' }),
    along([143.5, 7.9, 124], [143.5, 7.9, 110.5], 0.04, 0.04, C.dark, { id: 'ph-wire-2' }),
    along([143.5, 7.9, 110.5], [143.5, 7.6, 102.2], 0.04, 0.04, C.dark, { id: 'ph-wire-3' }),
  ]);

  return group('Powerhouse', [
    group('Powerhouse shell', shell),
    boiler,
    hall,
    outside,
    label('Powerhouse', 133.5, 132),
  ]);
}
