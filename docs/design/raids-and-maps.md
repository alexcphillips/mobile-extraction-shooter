# Game design: Raids and maps

Part of the [design.md index](../design.md). Rules shared by every raid and map; each map's own decisions are in its file (Maps, below). "The user's call" marks decisions not to reverse without asking.

## Raids
- **Small maps,** roughly 10–15 minutes to explore thoroughly.
- **Raid timer: 15 minutes by default,** set in the raid config, a little shorter than a full sweep so you choose where to go. Northpoint is 20 (the user's call: 70-plus rooms worth entering). Silver Creek is 20.
- **A raid is a data config:** map, playable area, starting loadout rules, objectives, enemy spawns. Normal raids and future weekly challenges share the format.
- **Quest items** spawn only for a player who has that quest accepted (in co-op, only for the quest holder).

## Spawns
- **Player spawns:** several per map, one picked at random each raid; a co-op party spawns together. They go on a map's edges, Tarkov-style; enemies hold the points of interest in the middle.
- **Enemy spawns keep clear of player spawns (the user's call):** none within the map's `enemyClearance` (60 m by default; Northpoint 0, where 60 m left about 1% of the floor legal) or in sight of one within 70 m (a clear line between standing eyes). The map editor warns and a content test fails on a breach.

## Terrain, water and buildings
- **Terrain is a height grid** (smooth hills). On slopes, buildings sit on a concrete base filling the gap to the ground.
- **Water (the user's calls):** flat see-through rectangles, each at its own level, sized in the editor (so a pond can sit above a creek and a tunnel stays dry). You walk on the ground under it. Water deeper than 1.2 m stops you like a wall, players and AI alike; above the knee (0.6 m over your feet) every ground speed drops to 70%. Maps keep water about 1 m deep so it's waded, not walled. Shots and sight pass over it.
- **Landmarks:** nodes marked `landmark` are also drawn past the fog as a flat silhouette.
- **Stairs and ladders** work for players; the AI uses stairs and slopes, never ladders.
- **Key rooms:** locked doors opened with key items.
- **Named zones** label places on the map; a zone with `extraction` is an extraction point. **Zones don't weight loot** (the user's call): every spot and container names its own table or mix.

## Loot
Everything is rolled once when the raid starts.

### Containers
- **Each container rolls a mix:** tables by weight plus a chance of being empty, either one table for the whole container (a house fridge is food 8 times in 10, parts 2 in 10) or a table per item (`each`: both in one fridge). Each kind (`content/loot-containers/`) has a default mix; a placed one can have its own.
- **A container's items depend only on its tables,** not its size; what doesn't fit is left out.
- **Enemies carry loot too:** an enemy type lists tables with weights and counts; a spawn's loot weights multiply them (the yard boss doubles military).
- **Where they roll (per item):** briefcases documents 0.75 / intel 0.25; filing cabinets and drawers documents 0.85 / intel 0.15; medical crates medical 0.75 / medical-loot 0.25; electrical cabinets electrical 0.8 / industrial 0.2; toolboxes sawmill-tools 0.5 / millwright 0.3 / industrial 0.2 (a quarter empty); tool chests sawmill-tools 0.5 / saw-filer 0.2 / millwright 0.2 / industrial 0.1; scavs industrial 1 (with household 4, electronics 3); footlockers fire-watch 0.6 / household 0.25 / medical 0.15 (0.3 empty).

### Loose loot
A loose spot holds **one item** and has a **chance** of holding anything (1 if not given), so loose loot isn't in the same places every raid. It can be anything, guns, armor and ammo included.
- **Placed with intent, not as a container pool (the user's call, 2026-11-16).** A hand-placed spot is there for a reason, and its table says what would plausibly lie there:
  - **Storytelling:** the spot's own small table, named for the place or the person (the saw filer's bench mostly has angle grinders; the lookout's cache on a roof has rounds, water and maybe binoculars). Each table spreads its theme over common, uncommon and rare.
  - **Showpieces:** a big find in plain view, where reaching it is the risk (the catwalk across Silver Creek's saw hall). A mythic should be seen in all its glory, not found in a drawer.
  - Weights in these tables bend the rarity scale to fit the story; that's the point of them.
- **Top tiers go in a place within a place (the user's call, 2026-11-17).** A legendary or mythic loose spawn never lies on open floor or in a big open hall: it sits in a room inside the point of interest that you commit to going into (a control room up a stair, a small room in the hot core, a dead-end pocket). Mythic spots are a tiny chance (about 2%), legendary small (about 6%), each from a one-tier table of its theme (`mythic-electronics`, `mythic-industrial`, `legendary-electronics`, `legendary-industrial`). An epic showpiece can stand in the open, if it's exposed.
- **Spots on furniture:** a prefab that things lie on carries its own (`lootSpawn` with id `loose` on its top surface): desk, executive desk, monitor desk, nightstand, coffee table, TV unit, kitchen run, shop counter, medical cart, gun wall rack, at chance 0.25–0.5, rolling a generic mix. Hand-placed spots are for the intentional ones above and one-offs (keys).
- **Facing (2026-11-17):** a loose spot can have a `yaw`, the way its item faces; without one the item is turned at random. A loot item with a `lean` (paintings, 12°) placed by such a spot stands leaning on what's behind the spot's point instead of lying flat.
- **Weights stay in tables,** never in a list of items per spot, so changing a weight is one edit.
- **One of several:** spots sharing a `oneOf` name are a set, one picked at random each raid (then rolling its chance): for a key that must be somewhere, not always in one place.
- **N of a group:** placed prefabs with the same `lootGroup` are a group; the map's `lootGroups` says how many are used each raid (`pick`, 1 if not set, 0 switches a group off: the tutorial's furniture).

### Tables
- **Loose only (the user's rule, 2026-11-17):** mythic ("red") valuables and paintings of epic rarity and up (The Tempest, Portrait of the Regent, The Unfinished Masterpiece, A World Beyond, The Last Supper of Kings) are never in a container or on a body: only in tables loose spots roll. Their homes: `mythic-paintings`, `mythic-electronics`, `mythic-industrial`, `mythic-intel`, `mythic-medical`, `mythic-household`, `craftwork-prize`, `fine-paintings`, `jewelry`. Guarded by `scripts/mapkit/loot-rules.test.mjs`. Gear isn't a valuable: the `military` table still has mythic ammo and armor on bodies and in crates (the user's call to make).
- **Jewelry cases (2026-11-17, the user's ask):** the prefab `jewelry-case` is not a container: a small box with a real door and a loose `jewelry` spot inside. Ground loot is only taken in sight, so the piece can't be had until the door is open (tested in `scripts/mapkit/jewelry-case.test.mjs`), and being loose, the table may hold mythic pieces. The old `jewelry-case` container kind (no loot, no prefab) is left unused.
- **Craftwork is rarer than household or industrial (2026-11-17):** `household` has none; `craftwork` (everyday pieces) for rare spots in homes and offices; `craftwork-fine` (valuable, container-safe) in safes and rich or locked rooms; `craftwork-prize` (loose only) mixed into those rooms' spots.
- **Tables are where you'd find a thing, not what it is:** an item's category is for the UI and vendors. Military electronics go in `military-tech`, kept out of laptop bags and office computers.
- **Weights follow rarity (the user's call, 2026-11-11):** common 4, uncommon 2, rare 1, epic 0.5, legendary 0.2, mythic 0.05 in every generic table (cash counts as common). Guns, attachments and grenades are common by rule, so theirs are set by hand. Map and story tables keep their own weights. **Paintings are the rarest category (the user's call, 2026-11-17):** in `art` and `high-value` every painting is weighted below its tier and each by itself (lighthouse 0.6, waterfall 0.5, autumn overlook 0.3, golden harvest 0.25, lavender fields 0.2, the tempest 0.12, the regent 0.05, the unfinished masterpiece 0.04, a world beyond 0.012, the last supper of kings 0.004); a spot that can roll a mythic painting is 2% or less, and **the last supper of kings is the rarest item in the game** (0.26% a raid from house 2's office, against 0.4–0.67% for each mill mythic). The user hasn't done a weighting pass yet (2026-11-16), so Claude may tune any table.
- **Mythics:** each is in its theme's table at the mythic weight. **Bosses, safes and locked rooms get a boost** from `high-value` (every legendary and mythic loot item, about 15% of its rolls mythic): Jug 0.4 (about a 25% chance he carries one), the office-safe kind 0.25 per item. Locked-room loose loot should mix in `high-value` too.
- **Themed tables:** `art`, `medical-loot` (equipment and lab finds, apart from `medical`, the meds enemies drop), `intel` (secret files; `documents` is everyday papers), `lab-tech` (reactors, nuclear fuel, the rocket thruster), `fridge-parts`, `industrial` (every general industrial item), `electrical` (wiring and power parts: relays, tape, cords, bulbs, batteries, breakers, boards; `electronics` stays consumer gear). `art` and `lab-tech` aren't placed yet.
- **Story tables (Silver Creek's mill, 2026-11-16):** `saw-filer`, `millwright`, `hydraulics`, `lumber-yard`, `switch-room`, `lookout-cache`, `mill-showpiece`, and the painting tables `house-paintings` (uncommon), `fine-paintings` (rare to epic) and `mythic-paintings` (house 2, 2026-11-17), and `fire-watch` (the lookout hut, 2026-11-17: what a lookout keeper leaves, common and uncommon only, the antique telescope the best of it; 1–3 rolls so it fills a footlocker) (design/maps/silver-creek.md → Loot and quests).
- **Quest and hangar items** need several sources: hangar.md → Where required items come from.

## Extraction
- **Stand inside an extraction zone for 7 seconds** (a countdown naming it; stepping out resets it, being shot doesn't). **When the raid timer runs out you're missing in action,** which counts as dying: you keep only your vault and knife. The timer is top left, red under 2 minutes.
- **Zones, not circles:** drawn in the map editor and ticked **Extraction point**, with a floor height (measured from the surface under it, editable) and a height it counts up to (2 m by default). You leave from 0.5 m under the floor up to that height. In the raid it's a short light-green border round the outline; the map tab draws the outline. Kept visible on purpose (the user's call): easy to find on a small screen.
- **Always open or rotating (the user's call):** a rotating extraction is open in only some raids; the map says how many of its rotating ones each raid opens. A closed one doesn't exist for you: no border, not on the map tab.
- **Extractions depend on where you spawn (the user's call):** each player spawn lists the extractions a player starting there can't use. Your extractions are the always-open ones your spawn allows plus the rotating ones it allows out of your own random pick (drawn from all the map's rotating ones, then filtered, so a rotating extract stays a chance for every spawn). A co-op party shares them. The editor and a content test flag a spawn left with none.

## After the raid
- **Results:** extracted (green), killed (red, with what killed you) or missing (orange), 1.5 s after a death. After a death it lists every hit taken, falls and bleeding, the killing blow in red.
- **Found in raid:** a saved mark on each item (`Item.found`). Found and not-found stacks never merge; a `handOver` objective with `foundInRaid` takes only found items. What you bring in is marked `brought`, so anything unmarked came from the raid; a found item taken back in is `refound` (found again on the way out, but not counted in the raid gain). What comes off a gun (attachments, rounds) is never found.
- **Raid gain:** the found-in-raid items you keep, vault included, at vendor prices.
- **Victory screen** (extracting): a top bar (map, extraction, duration), the extracted value and kills in big numbers with list buttons, finished objectives, you on the plinth. Dev: `?victory`.
- **Defeat screen** (a death): the same layout in red, Killed by, the match total (the vault's found items) and kills, and in your place the **last fight**: every hit both ways, newest first, with distance, gun and round. Dev: `?defeat`.

## Saving raids
- **The server owns the profile** (money, stash, the gear you take in). Starting a raid needs a connection; the profile is locked until the raid ends. With no connection the game shows "No connection" with Try again (the user's call), not an unsaved practice raid.
- **A raid that ends offline** is kept on the phone and sent before the next raid. **A raid that never reports** counts as missing in action the next time the game opens.
- **Resuming (the user's call):** iOS may unload a backgrounded app, so the raid is saved on the phone whenever the game goes to the background, and the next start resumes it from that moment; the raid clock stops while you're away. Only that phone can resume it; anywhere else it counts as missing, and a late result is refused.

## Menus: modes and map select
- **Game modes:** the lobby's mode button opens a drawer of mode cards. Extraction is the only mode since zombies was archived (2026-11-13, [zombies.md](zombies.md)); the button stays for a later mode.
- **Map select is a region map (the user's call, after Delta Force's raid select; our own art):** one made-up valley ("Ashford Valley") with a marker per raid at its `region` spot. Tap a marker to pick it; **Layout** shows the map from above with its extracts. A raid can need a PMC level (`minLevel`; Northpoint 2): its marker is dimmed with a lock, and a party needs every member at that level (the server refuses otherwise).

## Switches
- **Anything solid can be a switch (the user's design):** rows that each open a door, at once or after a timer, with a map-wide noise for as long as set and another at the door. Used once a raid, by any player; a door named by a switch stays locked until then. A **use time** means holding the use button (a ring fills; letting go or looking away starts over). **Enemies never use one and don't react to its noises.** The tag and links go on the placed copy, not the prefab.
- **Freight elevator** (the first use): one 45 s trip down, a klaxon across the map, the lamp flashing yellow, the cab coming down in sight; then a buzzer, the shutter rolls up, the lamp goes green. Nobody rides it: the real cab and its loot sit behind the shutter from the start, and the moving cab is drawn only.

## Maps
Each map has its own design file, which starts with a short summary; read that, then search the rest. Older references to "Raids and maps → Silver Creek" (or Northpoint, District, the Mall) mean these files.

| Map | File | Status |
|---|---|---|
| Silver Creek | [maps/silver-creek.md](maps/silver-creek.md) | starter map, v1 built, not played yet |
| Northpoint | [maps/northpoint.md](maps/northpoint.md) | hard map, playable; mall inside only |
| District | [maps/district.md](maps/district.md) | planning (MK, then DS sessions) |
| d2 | [maps/d2.md](maps/d2.md) | the user's hand-built District; mall shell 2026-11-14 |
| Tutorial house | [maps/tutorial.md](maps/tutorial.md) | built; design in tutorial.md |
| The Mall | [maps/mall.md](maps/mall.md) | deleted 2026-11-09, a record |
