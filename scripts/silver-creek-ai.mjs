// Silver Creek's AI (roadmap MT-9, 2026-11-10), used by gen-silver-creek.mjs: scav spawns and
// their patrols, PMC spawns, and the PMCs' points of interest with their areas.
//
// The starter map is easier through how many enemies there are and what they carry, not
// through dumber AI (design/maps/silver-creek.md): few scavs at the two ends, in
// the light scav kit (`scav-kit-light`), and the usual scav kit round the mill, where the PMCs
// start too. Claude's first pass, for the user to reshape in the editor; the numbers and why
// are in design/ai-scavs-pmcs-bosses.md → Silver Creek (MT-9).
//
// World coordinates: x east, z south, y up. Enemy spawns keep 60 m from every player spawn
// (the default clearance) and out of their sight; the content test checks it.

/** h: the generator's helpers (group, r2, groundAt). */
export function buildAi(h) {
  const { group, r2, groundAt } = h;
  const y = (x, z, floor) => r2(floor ?? groundAt(x, z));
  const pos = (x, z, floor) => [x, y(x, z, floor), z];

  /**
   * A scav spawn. `light` puts it in the light kit (the ends and the ridge). A sector's
   * spawns share `oneOf`; `chance` is rolled once a raid for the whole sector (waves.ts).
   * The points of interest's scavs are `once`: in at raid start, never again (2026-11-11,
   * the user's call). Only the `edge` sectors are wave slots, refilled through the raid.
   */
  const scav = (id, x, z, yaw, o = {}) => ({
    type: 'enemySpawn',
    id,
    pos: pos(x, z, o.floor),
    yaw,
    enemy: 'scav',
    ...(o.light ? { loadout: 'scav-kit-light' } : {}),
    ...(o.patrol ? { patrol: o.patrol } : {}),
    ...(o.oneOf ? { oneOf: o.oneOf } : {}),
    radius: o.radius ?? 1.5,
    ...(o.chance !== undefined ? { chance: o.chance } : {}),
    ...(o.edge ? {} : { once: true }),
  });
  /** A patrol stop: [x, z, wait, radius, floor]. */
  const stop = ([x, z, wait = 4, radius = 2, floor]) => ({ pos: pos(x, z, floor), wait, radius });
  const patrol = (id, stops, extra = {}) => ({
    type: 'patrol',
    id,
    points: stops.map(stop),
    ...extra,
  });

  const HOUSE = 0.35;
  const MILL = 0.3;
  /** The ridge trail's bench. */
  const TRAIL = 2.92;

  // ---------------------------------------------------------------- scavs
  // Nine sectors: two at each end and one on the ridge in the light kit, four round the
  // mill in the usual kit. The ends' second sectors and the ridge are used 60% of raids.
  const enemies = [
    // West: the far houses, walking the lane between the two rows; the hunting cabin.
    scav('sc-house-3', 77.5, 72.5, 180, {
      light: true,
      oneOf: 'sc-west-houses',
      floor: HOUSE,
      patrol: 'pt-house-lane',
    }),
    scav('sc-house-6', 81.5, 89.5, 0, {
      light: true,
      oneOf: 'sc-west-houses',
      floor: HOUSE,
      patrol: 'pt-house-lane',
    }),
    patrol('pt-house-lane', [
      [86, 81, 5],
      [70, 81, 4],
      [52, 81, 5],
      [70, 81, 4],
    ]),
    scav('sc-hunting-cabin', 84, 12, 180, { light: true, oneOf: 'sc-west-ridge', chance: 0.6 }),
    scav('sc-west-field', 92, 104, -90, { light: true, oneOf: 'sc-west-ridge', chance: 0.6 }),

    // The ridge: the campsite or the clear-cut's landing.
    scav('sc-campsite', 126, 14, 180, { light: true, oneOf: 'sc-ridge', chance: 0.6 }),
    scav('sc-clear-cut', 222, 20, 180, { light: true, oneOf: 'sc-ridge', chance: 0.6 }),

    // The mill, in the usual kit: the saw hall (two ends of the floor), the deck and timber
    // yard, the burner and kilns, the bridge and tunnel.
    scav('sc-hall-west', 147, 96, 90, { oneOf: 'sc-hall', floor: MILL, patrol: 'pt-hall' }),
    scav('sc-hall-east', 184, 86, -90, { oneOf: 'sc-hall', floor: MILL, patrol: 'pt-hall' }),
    patrol('pt-hall', [
      [147, 96, 5, 2, MILL],
      [164, 98, 3, 2, MILL],
      [184, 86, 5, 2, MILL],
      [148, 77, 3, 2, MILL],
    ]),
    // The mill's boss (MT-12, the user's design): the foreman and his three guards, who
    // hold the saw hall (their ground, 25 m from his patrol) and walk it with him. In 40% of
    // raids, as Jug on Northpoint. Numbers and why: design/ai-scavs-pmcs-bosses.md → Foreman.
    {
      type: 'enemySpawn',
      id: 'boss-foreman',
      pos: pos(184, 86, MILL),
      yaw: -90,
      enemy: 'foreman',
      chance: 0.4,
      patrol: 'pt-foreman',
    },
    patrol('pt-foreman', [
      [184, 86, 8, 2, MILL],
      [164, 98, 5, 2, MILL],
      [147, 96, 6, 2, MILL],
      [148, 77, 5, 2, MILL],
    ]),
    scav('sc-timber-yard', 112, 98, 0, { oneOf: 'sc-yard' }),
    scav('sc-log-deck', 128, 54, 90, { oneOf: 'sc-yard' }),
    scav('sc-burner', 206, 72, 180, { oneOf: 'sc-kilns', patrol: 'pt-kilns' }),
    scav('sc-kilns', 230, 100, 0, { oneOf: 'sc-kilns', patrol: 'pt-kilns' }),
    patrol('pt-kilns', [
      [206, 72, 4],
      [208, 100, 4],
      [238, 100, 5],
      [222, 74, 4],
    ]),
    scav('sc-bridge', 186, 126, -90, { oneOf: 'sc-crossings' }),
    scav('sc-tunnel', 140, 106, 90, { oneOf: 'sc-crossings', floor: -6 }),

    // East: the freight dock and the leads; the depot and the kilns' east end.
    scav('sc-freight-dock', 238, 46, 90, {
      light: true,
      oneOf: 'sc-east-yard',
      patrol: 'pt-east-yard',
    }),
    scav('sc-engine-shed', 250, 66, 90, {
      light: true,
      oneOf: 'sc-east-yard',
      patrol: 'pt-east-yard',
    }),
    patrol('pt-east-yard', [
      [238, 46, 5],
      [218, 50, 4],
      [250, 66, 5],
    ]),
    scav('sc-depot', 240, 130, 0, { light: true, oneOf: 'sc-east-south', chance: 0.6 }),
    scav('sc-tanker', 232, 116, 90, { light: true, oneOf: 'sc-east-south', chance: 0.6 }),

    // The edges (2026-11-11, the user's call: Silver Creek was too quiet, its scavs standing
    // at their posts while the PMCs picked them off far from you). Eight sectors in the trees
    // on the ridge and the south edge, between the ends' spawns: the only wave slots. Each
    // walks in once (repeatFrom) and then loops through several points of interest without
    // stopping long, so they cross the map, meet the PMCs and come past you. The loops keep
    // 55 m+ from the player spawns. The light kit but for the middle of the ridge's.
    scav('sc-edge-nw', 72, 6, 180, { light: true, edge: true, patrol: 'pt-edge-nw' }),
    patrol(
      'pt-edge-nw',
      [
        [84, 18, 2],
        [100, 21, 2, 2, TRAIL],
        [110, 40, 3],
        [117, 90, 4],
        [92, 104, 3],
        [75, 81, 4],
        [80, 45, 3],
      ],
      { repeatFrom: 2 },
    ),
    scav('sc-edge-n', 185, 8, 180, { edge: true, patrol: 'pt-edge-n' }),
    patrol(
      'pt-edge-n',
      [
        [190, 21, 2, 2, TRAIL],
        [160.5, 20, 3, 2, TRAIL],
        [126, 14, 3, 2, TRAIL],
        [128, 44, 3],
        [166, 56, 3, 2, 0],
        [194, 66, 3],
        [222, 20, 3, 2, TRAIL],
      ],
      { repeatFrom: 1 },
    ),
    scav('sc-edge-nc', 125, 5, 180, { edge: true, patrol: 'pt-edge-nc' }),
    patrol(
      'pt-edge-nc',
      [
        [126, 14, 2, 2, TRAIL],
        [128, 44, 3],
        [117, 90, 4],
        [168, 118, 3, 2, MILL],
        [195, 112, 3],
        [194, 66, 3],
        [166, 56, 3, 2, 0],
      ],
      { repeatFrom: 1 },
    ),
    scav('sc-edge-ne2', 220, 6, 180, { edge: true, patrol: 'pt-edge-ne2' }),
    patrol(
      'pt-edge-ne2',
      [
        [222, 20, 2, 2, TRAIL],
        [201, 48, 3],
        [230, 48, 3],
        [225, 94, 4],
        [195, 112, 3],
        [194, 66, 3],
      ],
      { repeatFrom: 1 },
    ),
    scav('sc-edge-ne', 255, 8, 180, { light: true, edge: true, patrol: 'pt-edge-ne' }),
    patrol(
      'pt-edge-ne',
      [
        [250, 20, 2, 2, TRAIL],
        [230, 48, 3],
        [250, 70, 4],
        [250, 95, 3],
        [225, 94, 4],
        [206, 72, 3],
      ],
      { repeatFrom: 1 },
    ),
    scav('sc-edge-sw', 80, 146, 0, { light: true, edge: true, patrol: 'pt-edge-sw' }),
    patrol(
      'pt-edge-sw',
      [
        [95, 135, 2],
        [117, 98, 4],
        [130, 128, 3],
        [163, 136, 3, 2, -2.6],
        [130, 128, 2],
        [92, 104, 3],
        [75, 81, 4],
      ],
      { repeatFrom: 1 },
    ),
    scav('sc-edge-sc', 150, 147, 0, { edge: true, patrol: 'pt-edge-sc' }),
    patrol(
      'pt-edge-sc',
      [
        [130, 128, 2],
        [117, 98, 4],
        [168, 118, 3, 2, MILL],
        [195, 112, 3],
        [225, 94, 4],
        [200, 135, 3],
        [163, 136, 3, 2, -2.6],
        [130, 128, 3],
      ],
      { repeatFrom: 1 },
    ),
    scav('sc-edge-se', 245, 146, 0, { light: true, edge: true, patrol: 'pt-edge-se' }),
    patrol(
      'pt-edge-se',
      [
        [240, 125, 2],
        [200, 135, 3],
        [168, 118, 3, 2, MILL],
        [195, 112, 3],
        [225, 94, 4],
        [250, 95, 3],
        [240, 125, 3],
      ],
      { repeatFrom: 1 },
    ),
  ];

  // ---------------------------------------------------------------- PMCs
  // Four spawns round the mill, two off the ridge and two on the south bank, so squads
  // start among the strong scavs and away from both ends' players. The map's
  // `pmcs.spawns: "pmc"` keeps them off the player spawns.
  const pmcSpawn = (id, x, z, yaw) => ({ type: 'pmcSpawn', id, pos: pos(x, z), yaw });
  const pmcSpawns = [
    pmcSpawn('pmc-ridge-west', 104, 24, 180),
    pmcSpawn('pmc-ridge-east', 206, 26, 180),
    pmcSpawn('pmc-south-west', 116, 144, 0),
    pmcSpawn('pmc-south-east', 214, 144, 0),
  ];

  // ---------------------------------------------------------------- points of interest
  // Loot spots where loot will be (MT-10 places it, so they'll move with it) and chokes at
  // the crossings. Areas: each squad works its own first (AI-19).
  const poi = (id, kind, x, z, area, o = {}) => ({
    type: 'poi',
    id,
    pos: pos(x, z, o.floor),
    kind,
    ...(o.weight ? { weight: o.weight } : {}),
    ...(o.radius ? { radius: o.radius } : {}),
    area,
  });
  const pois = [
    // The mill's north: the deck, the pond and its crossings, the ridge above.
    poi('poi-log-deck', 'loot', 126, 44, 'mill-north', { radius: 10 }),
    poi('poi-hunting-cabin', 'loot', 84, 12, 'mill-north'),
    poi('poi-campsite', 'loot', 126, 13, 'mill-north'),
    poi('poi-log-jam', 'choke', 145, 19, 'mill-north'),
    poi('poi-log-boom', 'choke', 128, 58, 'mill-north'),
    poi('poi-jack-ladder', 'choke', 194, 66, 'mill-north'),
    // The mill's south: the hall, office, timber yard, bridge, ford and tunnel.
    poi('poi-mill-office', 'loot', 186, 97, 'mill-south', { weight: 2, floor: MILL }),
    poi('poi-saw-hall', 'loot', 158, 96, 'mill-south', { weight: 1.5, radius: 12, floor: MILL }),
    poi('poi-timber-yard', 'loot', 116, 98, 'mill-south', { radius: 10 }),
    poi('poi-road-bridge', 'choke', 152, 118, 'mill-south'),
    poi('poi-weir-ford', 'choke', 172, 138, 'mill-south'),
    poi('poi-tunnel', 'choke', 166, 106, 'mill-south', { floor: -6 }),
    // East of the creek: the kilns, the burner, the clear-cut, the rail yard's west half.
    poi('poi-kilns', 'loot', 222, 98, 'mill-east', { weight: 1.5, radius: 12 }),
    poi('poi-burner', 'choke', 206, 72, 'mill-east'),
    poi('poi-clear-cut', 'loot', 222, 20, 'mill-east'),
    poi('poi-caboose', 'loot', 201, 48, 'mill-east'),
    // The west end: the company town.
    poi('poi-company-office', 'loot', 27, 38, 'west', { weight: 1.5, radius: 10 }),
    poi('poi-store', 'loot', 38, 128, 'west', { weight: 1.5 }),
    poi('poi-houses', 'loot', 62, 81, 'west', { radius: 14 }),
    poi('poi-sheds', 'loot', 53, 40, 'west'),
    // The east end: the yard, the shed, the camp and the depot.
    poi('poi-freight-dock', 'loot', 248, 44, 'east', { radius: 10 }),
    poi('poi-engine-shed', 'loot', 262, 65, 'east', { weight: 1.5, radius: 12 }),
    poi('poi-bunkhouse', 'loot', 283, 96, 'east', { radius: 10 }),
    poi('poi-depot', 'loot', 247, 132, 'east', { weight: 1.5, radius: 12 }),
    poi('poi-loading-tower', 'choke', 270, 38, 'east'),
  ];

  return [
    group('Enemies', enemies),
    group('PMC spawns', pmcSpawns),
    group('PMC points of interest', pois),
  ];
}
