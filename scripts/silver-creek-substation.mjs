// Silver Creek's mill substation (2026-11-16, the user's ask: electrical loot near the middle,
// so quests and the hangar that need it don't stall). A fenced yard on the east end of the
// strip between the mill and the highway, by the headgate house: hard cover across that
// strip's long east-west lines (MT-11's open item). No loot placed: the user places it.
//
// - Palisade fence 12 × 9 m, a gate gap on the west (towards the headgate house and the
//   race tunnel's east exit) and one on the south (towards the highway), so it's no trap.
// - The transformer along the north fence: eye cover, its lid out of a jump's reach.
// - The switch house in the south-east corner: one room, a door on the west, a window on
//   the south to shoot from; switchgear, a control panel and a wall panel inside, room
//   for the user's electrical cabinets.
// - A cable drum and a transformer enclosure in the yard's west half, a pole bringing the
//   line in. Nothing that's a step stands by the fence or the house.
import { buildingKit } from './mapkit/building.mjs';

export const SUBSTATION = { x0: 224, x1: 236, z0: 98.5, z1: 107.5 };

export function buildSubstation(h) {
  const { box, drawn, group, prefab, C } = h;
  const { wX, wZ, doorZ, win } = buildingKit(h);
  const S = SUBSTATION;
  const fence = (x, z, yaw = 0) => prefab('palisade-fence', x, z, yaw ? { yaw } : {}, 0);
  // Panels are 3 m, posts on the joints; the gaps are a panel left out.
  const panels = [
    ...[225.5, 228.5, 231.5, 234.5].map((x) => fence(x, S.z0)),
    ...[225.5, 231.5, 234.5].map((x) => fence(x, S.z1)), // gap x 227–230
    ...[100, 106].map((z) => fence(S.x0, z, 90)), // gap z 101.5–104.5
    ...[100, 103, 106].map((z) => fence(S.x1, z, 90)),
  ];
  const signs = [
    prefab('high-voltage-sign', 225.5, S.z0 - 0.06, { yaw: 180 }, 1.7),
    prefab('high-voltage-sign', S.x0 - 0.06, 100, { yaw: -90 }, 1.7),
    prefab('high-voltage-sign', 234.5, S.z1 + 0.06, {}, 1.7),
  ];

  // The switch house: walls 0.2, floor at 0.15, roof slab at 2.9.
  const HS = { x0: 231.6, x1: 235.6, z0: 104, z1: 107.2, fl: 0.15, top: 2.9 };
  const color = C.concrete;
  const house = group('Switch house', [
    box(HS.x0, HS.z0, HS.x1, HS.z1, -0.2, HS.fl, C['dark-concrete'], { id: 'sw-floor' }),
    wX('sw-wall-n', HS.x0, HS.x1, HS.z0 + 0.1, HS.fl, HS.top, color),
    wX('sw-wall-s', HS.x0, HS.x1, HS.z1 - 0.1, HS.fl, HS.top, color, [win(233.9, 1.2)]),
    wZ('sw-wall-w', HS.x0 + 0.1, HS.z0 + 0.2, HS.z1 - 0.2, HS.fl, HS.top, color, [
      { at: 105.6, width: 1.1, bottom: 0, top: 2.1 },
    ]),
    wZ('sw-wall-e', HS.x1 - 0.1, HS.z0 + 0.2, HS.z1 - 0.2, HS.fl, HS.top, color),
    doorZ('sw-door', HS.x0 + 0.1, 105.6, HS.fl, 1.1, { color: C['steel-dark'] }),
    box(HS.x0 - 0.2, HS.z0 - 0.2, HS.x1 + 0.2, HS.z1 + 0.2, HS.top, HS.top + 0.2, C.roof, {
      id: 'sw-roof',
    }),
    prefab('high-voltage-sign', HS.x0 - 0.01, 106.6, { yaw: -90 }, 1.9),
    prefab('wall-light', HS.x0 - 0.01, 104.7, { yaw: -90 }, 2.4),
    // Inside: switchgear on the east wall, the control panel on the north, a wall panel south.
    // the switchgear is searchable: the substation's own table (grid parts, not the office
    // and computer electrics of the `electrical` table)
    prefab(
      'switchgear-cabinet',
      HS.x1 - 0.2 - 0.4,
      105.6,
      {
        id: 'sw-switchgear',
        yaw: -90,
        loot: {
          container: 'electrical-cabinet',
          mix: { tables: { substation: 1 }, empty: 0.15 },
        },
      },
      HS.fl,
    ),
    {
      type: 'lootSpawn',
      id: 'sw-floor-spot',
      pos: [233.2, HS.fl, 106.2],
      lootTable: 'substation',
      chance: 0.35,
    },
    // a spare traction battery on the floor in the corner (loose only)
    {
      type: 'lootSpawn',
      id: 'sw-battery-spot',
      pos: [232.2, HS.fl, 104.6],
      lootTable: 'substation-battery',
      chance: 0.15,
    },
    prefab('substation-control-panel', 233.2, HS.z0 + 0.2, { id: 'sw-control-panel' }, HS.fl),
    prefab('electrical-panel', 232.6, HS.z1 - 0.2, { yaw: 180 }, HS.fl),
  ]);

  // The line comes in on a pole west of the yard, over the fence to the transformer.
  const pole = [
    box(221.85, 99.35, 222.15, 99.65, 0, 8, C.timber, { id: 'sub-pole' }),
    drawn(221.2, 99.4, 222.8, 99.6, 7.4, 7.55, C.timber, { id: 'sub-pole-arm' }),
  ];

  return group('Substation', [
    drawn(S.x0, S.z0, S.x1, S.z1, -0.05, 0.03, '#85827a', { id: 'sub-gravel' }),
    group('Substation fence', [...panels, ...signs]),
    prefab('power-transformer', 230.5, 100.6, { id: 'sub-transformer' }, 0),
    prefab('cable-drum', 226.6, 100.4, { id: 'sub-cable-drum', yaw: 90 }, 0),
    // left by the cable drum: a fitter's spares (electrical and industrial)
    {
      type: 'lootSpawn',
      id: 'sub-drum-spot',
      pos: [227.9, 0.03, 101.6],
      mix: { tables: { substation: 2, industrial: 1 } },
      chance: 0.3,
    },
    // Over a jump's reach (3.2 m), so it's no step onto the fence.
    prefab('transformer-enclosure', 226, 105.6, { id: 'sub-enclosure' }, 0),
    house,
    ...pole,
  ]);
}
