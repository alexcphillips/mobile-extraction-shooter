// Silver Creek's quest markers (roadmap MT-10, 2026-11-10), used by gen-silver-creek.mjs: the
// spots the four starter quests (content/quests: get-your-bearings, ways-across,
// under-the-mill, kiln-four) send a new player to, so they learn the landmarks, the quiet
// crossings, the race tunnel and a key room. Investigate markers tick within 2.5 m; the
// logbook (an extract objective) lies at one of the race spots, picked each raid.
//
// Heights are the floors the player stands on there (checked in the sim): the lookout's
// landing, the log jam's top, the boom man's raft, the ford's raised bed, the tunnel floor.

/** h: the generator's helpers (group, r2, groundAt); at: places only the generator knows. */
export function buildQuests(h, at) {
  const { group, r2, groundAt } = h;
  const marker = (id, x, z, y = groundAt(x, z)) => ({
    type: 'questMarker',
    id,
    pos: [r2(x), r2(y), r2(z)],
  });
  const { lookout, tunnel, keyRoom } = at;
  return group('Quest markers', [
    // Get your bearings: the three landmarks.
    marker('sc-quest-lookout', lookout.x, lookout.z, 8.86),
    marker('sc-quest-burner', 201, 72.6),
    marker('sc-quest-tower', 296.75, 72.4),
    // Ways across: the crossings that aren't the mill or the road bridge.
    marker('sc-quest-jam', 160.5, 20, 2.92),
    marker('sc-quest-boom', 165, 56, 0.05),
    marker('sc-quest-ford', 163, 136, -2.6),
    // Under the mill: where the logbook may lie, along the race tunnel.
    marker('sc-quest-race-1', 142, 106, tunnel.floor),
    marker('sc-quest-race-2', 164, 106, tunnel.floor),
    marker('sc-quest-race-3', 197, 106.5, tunnel.floor),
    // Kiln four: inside the locked key room.
    marker('sc-quest-kiln', keyRoom.x, keyRoom.z, keyRoom.y),
  ]);
}
