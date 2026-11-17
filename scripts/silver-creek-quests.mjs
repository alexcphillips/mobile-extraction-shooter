// Silver Creek's quest markers (roadmap MT-10, 2026-11-10), used by gen-silver-creek.mjs: the
// spots the four starter quests (content/quests: area-familiarization,
// under-the-mill, kiln-four; both deleted 2026-11-17, their spots kept) send a new player to, so they learn the landmarks, the quiet
// crossings, the race tunnel and a key room. Investigate markers tick within 2.5 m; the
// logbook (an extract objective) lies at one of the race spots, picked each raid.
//
// Heights are the floors the player stands on there (checked in the sim): the ground under
// the lookout, the log jam's top, the boom man's raft, the ford's raised bed, the tunnel floor.

/** h: the generator's helpers (group, r2, groundAt); at: places only the generator knows. */
export function buildQuests(h, at) {
  const { group, r2, groundAt } = h;
  const marker = (id, x, z, y = groundAt(x, z)) => ({
    type: 'questMarker',
    id,
    pos: [r2(x), r2(y), r2(z)],
  });
  const { lookout, tunnel } = at;
  return group('Quest markers', [
    // Get your bearings: the three landmarks.
    marker('sc-quest-lookout', lookout.x, lookout.z),
    marker('sc-quest-burner', 201, 72.6),
    marker('sc-quest-tower', 296.75, 72.4),
    // Ways across: the crossings that aren't the mill or the road bridge.
    marker('sc-quest-jam', 160.5, 20, 2.92),
    marker('sc-quest-boom', 165, 56, 0.05),
    marker('sc-quest-ford', 163, 136, -2.6),
    // The race logbook's spots along the race tunnel (its quest, Under the mill, was
    // deleted 2026-11-17; the logbook lies only here, never in the kilns).
    marker('sc-quest-race-1', 142, 106, tunnel.floor),
    marker('sc-quest-race-2', 164, 106, tunnel.floor),
    marker('sc-quest-race-3', 197, 106.5, tunnel.floor),
    // Not used by a quest yet (2026-11-17): spots round the equipment depot for later ones
    // (silver-creek.md → Equipment depot): the yard office's desk, the crane bridge's middle,
    // the fuel pump between the shed and the tanks, inside the yard's open container.
    marker('sc-quest-depot-office', 259.2, 135.5, 3.3),
    marker('sc-quest-depot-crane', 245, 132.3, 3.3),
    marker('sc-quest-fuel-pump', 263.1, 134.2, 0),
    marker('sc-quest-yard-container', 285.5, 132.5, 0.2),
    // The same for the engine shed (2026-11-17, silver-creek.md → Engine shed): the dispatch
    // board in the foreman's office, the switcher's cab, the inspection pit, the battery
    // room's charger, the fuel column on road 2. Ideas: find the dispatcher's log, check the
    // switcher, plant something in the pit, bring the batteries for MT-13's train.
    // the rail yard (2026-11-17): the line-side phone at the tunnel (call the dispatcher),
    // the speeder in its shed, the conductor's desk in the caboose
    marker('sc-quest-tunnel-phone', 311.45, 40.4, 0),
    marker('sc-quest-speeder', 301.0, 38.2, 0.1),
    marker('sc-quest-caboose', 199.0, 51.0, 1.1),
    // the log deck's scaler shack (2026-11-17): find the scale book
    marker('sc-quest-scaler', 122.5, 56.9, 0.1),
    marker('sc-quest-shed-office', 264.3, 74.6, 3.3),
    marker('sc-quest-shed-cab', 256.2, 68.0, 1.05),
    marker('sc-quest-shed-pit', 259.5, 63.0, -1.4),
    marker('sc-quest-shed-batteries', 268.6, 73.8, 0),
    marker('sc-quest-shed-fuel', 282.6, 70.9, 0),
  ]);
}
