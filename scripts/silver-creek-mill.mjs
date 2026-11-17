// The saw hall's upper level and lumber shed (2026-11-16, the user's ask: dress up the mill
// with tactical play and risk/reward in mind). The hall's shell and floor machines are in
// gen-silver-creek.mjs; design in docs/design/maps/silver-creek.md → The sawmill core.
//
// - Filing loft (south-west, 3.5 m, level with the office roof): the saw-filing room on it,
//   windows over the floor, doors west and east. A stair up from the west lane (the AI
//   follows); its north edge railed (vaultable) with one open gap, all 3.2 m drops.
// - Catwalk: freestanding, railed both sides, 25 m from the loft to the office roof, so the
//   two rooms with loot are joined by a fast high route that the whole floor can see.
// - Lumber shed: an open lean-to on the south wall over the strip (cover on its long lines).
//   A door from the loft steps down onto its roof, a perch over the strip and the tunnel's
//   west stairs (3.3 m, every edge a safe drop). Players can also climb it by lumber stacks
//   at its west end; the AI only by the loft.
import { buildingKit } from './mapkit/building.mjs';

export const LOFT = { x0: 140.3, x1: 158, z0: 95.5, z1: 101.7, y: 3.5 };
export const SHED = { x0: 140, x1: 157, z0: 102, z1: 108, y: 3.3 };
/** The loft's door out to the shed roof, in the hall's south wall. */
export const LOFT_DOOR = { x: 141.6, width: 1.0 };

export function buildMillLoft(h, { F }) {
  const { box, drawn, group, prefab, C } = h;
  const { wX, wZ, win, door, doorZ } = buildingKit(h);
  const L = LOFT;
  const U = L.y;
  const rail = (id, x0, z0, x1, z1) => box(x0, z0, x1, z1, U, U + 1, C.hazard, { id });
  const post = (id, x, z) =>
    box(x - 0.1, z - 0.1, x + 0.1, z + 0.1, F, U - 0.2, C['steel-dark'], { id });
  const at = (name, x, z, y, extra = {}) => prefab(name, x, z, extra, y);
  /** A loose item's spot, from one of the mill's own tables (docs: → Loot in the mill). */
  const spot = (id, x, y, z, lootTable, chance) => ({
    type: 'lootSpawn',
    id,
    pos: [x, y, z],
    lootTable,
    chance,
  });

  // ------------------------------------------------------------------ the loft
  const FR = { x0: 143, x1: 154, z0: 97, top: U + 2.6 };
  const siding = C['office-siding'];
  const loft = group('Filing loft', [
    box(L.x0, L.z0, L.x1, L.z1, U - 0.2, U, C.floorboards, { id: 'loft-floor' }),
    ...[144, 151.5, 157.8].map((x, k) => post(`loft-post-${k + 1}`, x, L.z0 + 0.1)),
    {
      type: 'stairs',
      id: 'loft-stairs',
      pos: [141.1, F, 92.75],
      yaw: 0,
      size: [1.2, U - F, 5.5],
      color: C.timber,
      sides: 1.0,
    },
    // the north edge: railed from the stair head, with an open gap mid-way to drop through
    rail('loft-rail-n-1', 141.75, L.z0, 152, L.z0 + 0.08),
    rail('loft-rail-n-2', 153.5, L.z0, L.x1, L.z0 + 0.08),
    drawn(152, L.z0, 153.5, L.z0 + 0.08, U, U + 0.02, C.hazard, { id: 'loft-gap-edge' }),
    // the east edge, either side of the catwalk
    rail('loft-rail-e-1', L.x1 - 0.08, L.z0, L.x1, 98.2),
    rail('loft-rail-e-2', L.x1 - 0.08, 99.6, L.x1, L.z1),
    // the filing room: windows over the floor, a door at each end
    wX(
      'filing-wall-n',
      FR.x0,
      FR.x1,
      FR.z0 + 0.07,
      U,
      FR.top,
      siding,
      [win(145.6, 2.0), win(151.4, 2.0)],
      0.15,
    ),
    wZ(
      'filing-wall-w',
      FR.x0 + 0.07,
      FR.z0 + 0.15,
      L.z1,
      U,
      FR.top,
      siding,
      [door(99.4, 1.0)],
      0.15,
    ),
    wZ(
      'filing-wall-e',
      FR.x1 - 0.07,
      FR.z0 + 0.15,
      L.z1,
      U,
      FR.top,
      siding,
      [door(99.4, 1.0)],
      0.15,
    ),
    doorZ('filing-door-w', FR.x0 + 0.07, 99.4, U, 1.0),
    doorZ('filing-door-e', FR.x1 - 0.07, 99.4, U, 1.0),
    box(FR.x0, FR.z0, FR.x1, L.z1, FR.top, FR.top + 0.2, C.roof, { id: 'filing-roof' }),
    // inside: the grinder and bench along the back wall, blades on the wall, shelving
    box(144.2, 100.6, 148.2, L.z1, U, U + 0.95, C.timber, { id: 'filing-bench' }),
    box(149, 100.3, 150.6, 101.4, U, U + 1.4, C.machine, { id: 'filing-grinder' }),
    drawn(149.3, 100.5, 150.3, 101.2, U + 1.4, U + 1.8, C['machine-dark']),
    ...[145.2, 146.8, 151.8].map((x, k) => ({
      type: 'cylinder',
      id: `filing-blade-${k + 1}`,
      pos: [x, U + 1.9, L.z1 - 0.03],
      radius: 0.6,
      height: 0.04,
      sides: 12,
      pitch: 90,
      color: C.roller,
      collide: false,
    })),
    at('metal-shelving', 153, 98.2, U, { id: 'filing-shelving', yaw: -90 }),
    at('notice-board', 147.4, FR.z0 + 0.17, U, { id: 'filing-notices' }),
    // loot: the filer's chest and toolbox, and whatever he left on the bench
    at('tool-chest', 149.3, FR.z0 + 0.38, U, { id: 'filing-chest' }),
    at('toolbox', 145, 101.15, U + 0.95, { id: 'filing-toolbox', yaw: 180 }),
    spot('filing-bench-loose', 146.3, U + 0.95, 101.15, 'saw-filer', 0.6),
    // A tiny chance of a mythic, in the room you commit to (the user's call, 2026-11-17:
    // top-tier loose loot sits in a place within a place, never the open floor).
    spot('filing-bench-mythic', 147.7, U + 0.95, 101.15, 'mythic-industrial', 0.02),
    // the door out onto the shed roof
    {
      type: 'door',
      id: 'loft-door-s',
      pos: [LOFT_DOOR.x, U, 101.85],
      yaw: 0,
      size: [LOFT_DOOR.width, 2.1],
      color: C['timber-dark'],
    },
  ]);

  // ------------------------------------------------------------------ the catwalk
  const CW = { x0: L.x1, x1: 183, z0: 98.2, z1: 99.6 };
  const catwalk = group('Catwalk', [
    box(CW.x0, CW.z0, CW.x1, CW.z1, U - 0.2, U, C.steel, { id: 'catwalk' }),
    rail('catwalk-rail-n-1', CW.x0, CW.z0, 169, CW.z0 + 0.08),
    rail('catwalk-rail-n-2', 170.5, CW.z0, CW.x1, CW.z0 + 0.08),
    rail('catwalk-rail-s', CW.x0, CW.z1 - 0.08, 176.2, CW.z1),
    ...[164, 170.5, 176.2].map((x, k) => post(`catwalk-post-${k + 1}`, x, 98.9)),
    // The showpiece: something big and good left mid-span, in plain view of the loft, the
    // office roof and the floor's far side. Worth the walk out, sometimes.
    spot('catwalk-showpiece', 167, U, 98.9, 'mill-showpiece', 0.15),
  ]);

  // ------------------------------------------------------------------ the lumber shed
  const S = SHED;
  const shed = group('Lumber shed', [
    box(S.x0, S.z0, S.x1, S.z1, S.y - 0.2, S.y, C.roof, { id: 'shed-roof' }),
    drawn(S.x0, S.z1 - 0.1, S.x1, S.z1, S.y - 0.45, S.y - 0.2, C['timber-dark'], {
      id: 'shed-fascia',
    }),
    ...[140.2, 146, 151.5, 156.8].map((x, k) =>
      box(x - 0.12, S.z1 - 0.4, x + 0.12, S.z1 - 0.16, 0, S.y - 0.2, C.timber, {
        id: `shed-post-${k + 1}`,
      }),
    ),
    at('lumber-stack-tall', 144.5, 105.6, 0, { id: 'shed-stack-1' }),
    at('lumber-stack-tall', 154.2, 104.4, 0, { id: 'shed-stack-2' }),
    // the way up from outside: a low stack, a tall one, then the roof's edge (player-only)
    at('lumber-stack-tall', 139.3, 105.4, 0, { id: 'shed-climb-tall', yaw: 90 }),
    at('lumber-stack', 137.75, 105.9, 0, { id: 'shed-climb-low', yaw: 90 }),
    spot('shed-loose', 149.5, 0, 106.6, 'lumber-yard', 0.3),
    // Someone watched the tunnel's west stairs from the roof: a bedroll, a crate to sit on,
    // cans, and what they left behind.
    drawn(141, 104.2, 141.7, 106.1, S.y, S.y + 0.12, C.canvas ?? '#5f6b4a', {
      id: 'lookout-bedroll',
    }),
    at('small-crate', 143.4, 103.9, S.y, { id: 'lookout-crate' }),
    ...[
      [142.6, 104.5],
      [142.8, 104.7],
    ].map(([x, z], k) =>
      drawn(x - 0.04, z - 0.04, x + 0.04, z + 0.04, S.y, S.y + 0.12, C.steel, {
        id: `lookout-can-${k + 1}`,
      }),
    ),
    spot('lookout-cache', 143.4, S.y + 0.4, 103.9, 'lookout-cache', 0.5),
  ]);

  return group('Saw hall upper', [loft, catwalk, shed]);
}
