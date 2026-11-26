# Port

A working harbor that's emptied out. It's the big extraction map: room for six parties without fights at the spawns, and ten places that each lean toward one kind of loot, so where you go depends on what you're after. Its two signature places mirror each other: a cargo ship that rises above the quay and a dry dock that sinks below it.

## Rules

- **Six parties, no spawn fights** *(user's call)*. Spawn points sit round the edge near roads, none within 70 m of a major place and none round the ship's corner. A six-party raid picks six points with every pair at least 140 m apart (the distances live in `scripts/gen-port.mjs`, which prints how many picks there are). That picking is PvP logic and isn't built; PvE picks one point.
- **Three tiers of place.** Five majors (the ship, the dry dock, the warehouse, customs, the control tower), five secondaries (the coast guard station, the dorms, the container yard, the lockups, the fuel depot) and minis between them. Majors have several floors or zones, three or more ways in and a keyed room; minis are a room or a wreck.
- **Each kind of loot has one best place and some others.** Military at the ship; industrial at the dry dock; electronics at the cold store; intel at the control tower; art and jewelry at the customs vault; medical at the dorms' infirmary, with no major, so there's a quieter route. Craftwork and household are at the lockups.
- **Roads go round every block but never form a grid.** They bend every 60–90 m. The land side is square; the container yard and the lockups are on grids of their own with open space round them (level-design.md, principle 12).
- **The east leans rich.** The ship and the dry dock are neighbors, so the crossing between them stays open and exposed, and customs' vault must be worth the trip from the east.
- **Water is an edge, not a trap.** Quays are vertical faces, and deep water stops anyone stepping off. Rocky shores get invisible walls. The beach is the one place you can walk down into the water.
- **Falls over 3.3 m have rails.** This covers the dry dock's basin, its stairs and ramp, the hull's deck, the gangways and the holds' stairs. The hatch coamings are tall enough that going into a hold over one is a choice.
- **The AI can follow you everywhere that matters.** It reaches the ship's deck and holds, the stern pier, the basin floor and the hull's deck, the knoll, the boathouse and the south pier, all by stairs or ramps.

## Decisions

- **Ten places, chosen with the user** *(user's call)*. The shipyard became a dry dock with a hull on keel blocks (you can walk under it). The maintenance facility folded into the dry dock's workshop. The harbor offices became a control tower, the storage sheds self-storage lockups, and the south-west's place a coast guard station on a knoll. The warehouse is half rack hall, half cold store, because the other maps already have a plain rack warehouse.
- **The ship is boardable**: two gangways from the quay and a stern ramp from the pier. It's the richest place and the boss's ground. A second ship would be scenery only.
- **Minis** (Claude's, for the user's review): the north checkpoint, the truck stop, the quarantine tents (a second medical source), the seamen's canteen, the rail siding, the cash van wreck, the yard crane's cab (a player-only perch), the scrapyard and the beached trawler. No substation (two maps have one) and no lighthouse (a dead end with a long view).
- **The 140 m spawn rule, not 150 m**: the ship's corner and the sea along the east leave too little edge for more than a handful of 150 m picks at this size.

## Where it lives

- Code: `scripts/gen-port.mjs` builds the whole map; the layout is in its tables (seas, quays, places, roads, spawns, extracts).
- Content: `content/maps/port.json`, `content/raids/port.json` (dev only, tagged test).
- Tools: `node scripts/map-report.mjs port`, `node scripts/map-overlaps.mjs port` (the generator runs the overlap and fake-cover checks itself).

## Open questions

- The map's real name (it's "Port" for now).
- Whether to grow the map so six parties fit 150 m apart.
- Final extractions. The test ones sit on the roads out and at the south pier and the cove; each spawn is denied those within 150 m.
