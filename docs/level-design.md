# Level design: what we look for

How to design and review map layouts and environments for tactical play. Read this before laying out or reviewing an area.

**For the extraction mode's maps only** (the user's call, 2026-11-07), such as Northpoint and the test map. Other modes would have their own goals, and these rules don't apply to them unless the user says so. It collects decisions made with the user. Where one is recorded in [design.md](design.md), that entry is the source; this page is the working summary. Add to it when a new principle is agreed.

## Principles

1. **High ground means two-way exposure, not a safe perch.** A roof, a rack top or a container stack should show you a lot of the area, and show you to a lot of it. Climbing up is a risk you choose. Avoid full cover up high that keeps the view: a covered tunnel or nook on a perch that looks out over a wide area undoes the risk. Check what can be seen from inside any cover up there. (Examples: the yard's `cans` roofs, the warehouse rack tops.)
2. **Getting down is quick; getting up is the commitment.** One or two ways up is fine, but a perch should have edges you can drop off (within the safe fall height below), so being spotted isn't a death trap.
3. **No single-entry traps by default.** A space with one way in should be a deliberate high-value pick, not the norm ("stores are not traps", design.md). Most spaces get two or more ways in, and pockets with loot in them get a second exit or an obvious warning that they're dead ends. **Key rooms are the exception (the user's call, 2026-11-10):** one way in, through the locked door. A separate way out may come later, not now.
4. **Close quarters: short lanes, quick corners, layers.** Lanes of about 8 m or less between corners, 1.5–3 m wide, mostly with more than one way in. Layer the space where you can: under and over (a pocket under a stacked deck, a tunnel through an open container), through (cut-throughs between aisles), and up (a nest you climb into). Keep squeezes of about 1 m rare, never the main route: a thumbstick camera is cramped in them.
5. **Sightlines: mostly mid-range, long lines are thin.** Most clear lines in a busy area run about 25 m (the yard's median is 25 m east-west and 29 m north-south). Longer lines exist as slits: along walls, between stock, under a ceiling over rack tops. Break any straight run longer than about 20–25 m with staggered cover (service corridor: longest straight about 22 m; service hall: four overlapping stacks across 80 m).
6. **Cover height means what it says.** Cover at 1.6 m or taller blocks a standing eye; anything lower is waist cover, however solid it looks. Things you can see through (rack shelves, bars, mesh, glass) make long thin lines on purpose. Bars stop about 22% of shots and mesh about 6%; glass can be shot out.
7. **Decide whether the AI can follow you.** The AI walks stairs and slopes but never ladders, ledges, vaults or crouch-only spaces. So every raised spot is either:
   - **player-only on purpose** (a ladder lookout, a rack nest): the AI can still see and shoot you there, but can't come up, so don't scatter too many; or
   - **reachable by the AI** (stairs, a ramp), so a fight can follow you up.

   Say which one you meant when you build it. Use the nav grid to confirm it.
8. **Risk should match reward.** Rich loot shouldn't sit in the safest, least-watched corner. Spawns and loot come last (the user places them), but the layout should leave somewhere to make a rich spot contested: exposure, a choke, or being en route to something noisy.
9. **Every area should have a reason to cross it,** and more than one way through. Areas link into loops (back routes, flanks, shortcuts) so players can rotate rather than funnel.
10. **Variety, not copy-paste.** Repeated modules (rack lanes, stores, container rows) each get their own arrangement and a tactical purpose. Identical copies read as filler and play the same everywhere.
11. **Uneven spacing, long crossings at the rich places (the user's call, 2026-11-12).** Space buildings unevenly: some close, some far, never a regular grid or an even ring round a center. Between high-value places, or around a very high-value one (the boss's ground, the richest loot), put a deliberately long or dangerous crossing on the fast route, with a slower covered way round. These are the named exceptions to an open-ground cap such as District's 40 m; elsewhere the cap holds.
12. **A cluster shares one grid (the user's call, 2026-11-12).** Buildings and yards that stand together line up: the same rotation, or square to it (90°). A building at a different angle needs open space around it so it reads as its own cluster; District's check is no two buildings or yards within 30 m of each other off-grid. Odd angles side by side read as messy. Angled pieces inside an area (container stacks, wrecks, cover rows) are detail, not buildings, and are fine.

## Numbers that decide what's reachable

From `MOVEMENT` in `packages/shared/src/sim/movement.ts` and design.md. Check the code if these look stale.

| What | Value |
|---|---|
| Walk-up step | 0.45 m |
| Jump | 0.6 m; jump plus step mantles about 1 m |
| Jump, then vault (in the air) | ledges up to about 1.7 m above your feet |
| Vault over (from the ground) | 0.45–1.1 m high, up to 1 m deep, with a gap 0.8 m tall and 0.7 m wide above it |
| Landing on top from a vault | needs 0.8 m clear above the top across your path. A shelf or slab within 0.8 m above it blocks the vault. |
| Headroom | 1.8 m to stand, 1.2 m to crouch, 0.6 m prone. You can't jump while crouched. |
| Capsule | 0.35 m radius, so a gap needs about 0.75 m to pass |
| Safe fall | up to about 3.9 m (12.5 m/s); about 5 m bruises, about 7 m breaks both legs |
| Ladder | 2 m/s; it drops you 0.45 m past its top, onto whatever is there |
| Terrain slope | walked up to 45° (rise over run 1), walked down at any steepness. So steeper ground you can reach must have a walkable way back up, or it's a pit. Banks down to water: 35° or less from the top to below the deep line (the water level less 1.2 m), steep only below it (Silver Creek, 2026-11-10) |
| AI nav | 0.5 m cells, climbs 0.45 m, needs 1.8 m headroom (it doesn't crouch), slopes up to 45° |
| AI sight | 120° view out to 70 m; full notice takes about 3 s at 25 m and 9 s at 50 m; crouching ×0.6 |
| Warehouse ceiling | 5.85 m west of x 60, 9.2 m in the high bay |
| Fall per drop-off step | keep to 3.3 m: drops of 3.6–3.7 m already cost a couple of leg HP in the sim |
| Doors in the nav grid | it's built with every door open both ways, and an open leaf stands its width out on either side of the wall and is solid. So keep about a door's width clear of furniture, stair feet and rails on the hinge side of every doorway. A leaf beside a stair foot cut the AI off from a whole upper floor (MT-6, 2026-11-10). |
| Eye-height cover outdoors | measured in MT-7: a `log-pile-tall` blocks a standing eye only along its top log, and `rock-large` collides only to 1.45 m. Piles or rocks set to one side of a lane leave its center line clear, so set tall cover across the lane at an angle, alternating from each edge (props.md → Silver Creek props). |
| Two-stage drops | a walk carries you about 3 m forward over a 3.3 m fall, and a sprint about 5 m (3.5 and 6 m/s). A ledge you drop onto from an open edge above needs to be about 5 m deep, or to end against something taller that stops you, or a sprinting player sails past it to the ground. The loading tower's first apron was 1.2 m deep and broke your legs (MT-8, 2026-11-10). |
| Foliage | parts marked `foliage` (the pine's leaves) block the AI's sight as they do a player's, but shots, grenades and sound pass through: concealment, not cover (2026-11-10). |

## Review checklist

Run through this for a new area or a review. Report problems ranked by how much they matter, and say what wasn't checked.

- [ ] **Entrances:** how many ways in to each space? Are any one-entry pockets deliberate?
- [ ] **Lanes:** longest straight run, and where it is? Lane widths, and any squeeze under 1 m on a main route?
- [ ] **Sightlines:** typical clear line length; the longest lines and whether they're slits; whether each long line has a counter-position.
- [ ] **Cover:** eye-height cover (1.6 m or more) versus waist cover; whether anything see-through is meant to be.
- [ ] **Levels:** every raised spot, how you get up and down, whether a vault or jump actually works (check the headroom and the 0.8 m clearance), and whether the AI can follow. Does it match what was intended?
- [ ] **Perches:** what you see from each one and what sees it; whether any cover up there lets you watch without being seen.
- [ ] **Falls:** each drop-off point under about 3.9 m, or deliberately higher.
- [ ] **Loops:** routes in and out, flanks, and whether the area funnels.
- [ ] **Reward versus risk:** where loot or objectives will go relative to exposure and enemy paths (even before they're placed).
- [ ] **Variety:** repeated modules that are still identical.
- [ ] **Cost:** parts and triangles against the phone budget (props.md); draw calls in the debug overlay.

## How to check, not guess

Layouts are built from numbers, so verify movement in the sim instead of reasoning about it. The rack nest's first version looked right on paper and failed in the sim.

- **The map report first** (below): lines, open ground, reach, perches, drops, walks and cost. What follows is for what it doesn't measure.
- **Routes in the sim:** a throwaway vitest under `packages/shared/src/sim/` can load the real map with `loadById(MAP_FORMAT, …)`, `loadById(PREFAB_FORMAT, …)` and `compileMap`, build a `CollisionWorld`, spawn a character with `spawnCharacter(state, world, x, z, yaw, y)`, and `step` it with inputs: walk, jump, ladder, drop. Log x, y, z, mode and leg HP along the way. Yaw 0 faces −z, −π/2 faces +x. Delete the test afterwards. Run it under Node 22. For a generator piece, `scripts/mapkit/sim.mjs` does this in a few lines (`build`, `walk`, `joined`; tech/editors.md → Map kit).
- **AI reach:** `new NavGrid(world)`, then `nav.nearest(x, y, z)` for a spot. −1 means the AI can't stand there. Compare `nav.component[...]` either side of a gap to see whether they're linked, and use `nav.componentSizes` to spot small islands the AI can't get to.
- **Top-down shape:** a script that compiles boxes to world footprints and prints a height map (`.` floor, `o` waist, `#` over eye height, `H` two-high) is a quick way to read lane widths and pockets from the JSON.
- **Open ground (MT-7):** for an outdoor area, sample every meter across it, cast east and west at standing eye height (solids by `raycast`, leaves by `foliageWithin`, both bounded by the map's edges) and count the share of spots with a clear line of 70 m or more (the AI's sight). Silver Creek's west end measured 19–33%; use that as the yardstick. Five sample lines over-fit: the cover ends up placed to block the lines, not the area.
- **Looks:** the user usually checks visuals in the game themselves. A headless screenshot through `/play-test?peaceful&at=x,z[,y]` (the map handed over in localStorage `mes.playTest`) works if one's really needed.

## Map report (MK-4, 2026-11-12)

`node scripts/map-report.mjs <map> [--zone <area>] [--detail] [--compare <map|run.json>] [--no-cost]` measures a map on its real collision world and nav grid in a few seconds (Silver Creek 2 s, Northpoint 5 s with the cost). It prints one summary table and a row per named area (the map's `mapLabel`s of size `area`; the whole map if it has none), writes heatmaps (`lines.png`, `open.png`, `nav.png`, 2 px a meter, north up) and `run.json` to `node_modules/.cache/map-report/<map>/`, and `--compare` lines another map's saved run up beside it. `--detail` adds the islands, perches, drops, walks between areas and spawn-to-extraction walks. **Use it instead of throwaway vitests** for anything it measures; keep the sim for a single route (above). Code: `packages/client/src/map-report/` (`measure.ts` pure, for MK-8's editor overlays too; `cost.ts` with three.js).

**What it measures** (numbers in `REPORT`, `measure.ts`):
- **Lines:** a spot every meter on every nav floor a player reaches, eight looks each at standing eye height (1.6 m), solids and glass-seen-through by raycast, foliage blocking, cut at the map's edge. The share of *looks* (not spots: nearly every spot has one long line somewhere) that see 70 m or 30 m, outdoors (open sky above) and indoors.
- **Open ground:** a 1 m cell of outdoor ground is "something on it" if a solid rises 0.5 m or more over it, or foliage. **Exposed** ground has nothing within 3 m (a dive away); open ground nearer than that is a lane beside cover. A **crossing** is a straight run over exposed ground on four axes; the report gives the longest and the square meters lying on runs over 40 m (District's cap), plus the biggest open circle (chamfer distance, ±8%).
- **Reach:** the AI's main area is the nav component holding the most spawns (not the largest: Northpoint's unused ground outside its fences is bigger than the mall). Other components are reached by a player if a jump and vault (1.7 m) or a drop (to 7 m) within a meter crosses to them, checked by overlap so invisible walls count, or by a ladder; transitively. **Pits** are reached and not left; **ways out of the play area** are reached components touching the map's edge. One-node strips (rail and wall tops) are left out.
- **Perches:** raised spots 2.5 m or more over the ground (or water) under open sky, clustered; how they're reached and from where, and how many of eight looks from the middle see 70 m.
- **Drops:** edges of reached ground with no rail where the fall is over 3.3 m, grouped in 4 m patches; off the AI's ground first.
- **Walks:** Dijkstra over the nav grid (8-way, a few percent over a smoothed path; sprint ignores stamina).
- **Cost:** the map built by the game's `buildMap`; triangles and meshes, and draw calls and triangles in view from 150 spots on the main area × 8 headings, frustum out to the fog at 70° and a phone's 2.16 aspect (no occlusion; the landmark silhouette isn't counted).

**Yardsticks (2026-11-12, the first runs):**

| | Silver Creek | Northpoint |
|---|---|---|
| Outdoor looks seeing 70 m / 30 m | 13% / 37% (areas 9–22% / 32–42%) | 3% / 18% (the yard) |
| Indoor looks seeing 30 m | 13% (areas 10–20%) | 15% |
| Longest exposed run; on runs over 40 m | 134 m (Company town's roads); 5,475 m² | 59 m; 1,027 m² |
| Biggest open circle | 36 m | 20 m |
| Drop patches over 3.3 m (off AI ground) | 15 (6) | 26 (2) |
| Triangles / meshes; draw calls in view p50 / p95; triangles in view p95 | 205k / 107; 43 / 56; 151k | 282k / 127; 47 / 63; 245k |

The cost matches MT-11's throwaway count (209k and 56; 282k and 63). For District: exposed runs held to 40 m outside the named long crossings (principle 11); outdoor 70 m looks within Silver Creek's 9–22% per area; the mall's indoor 30 m looks near Northpoint's 15%; cost no more than Northpoint's.

## Worked examples

- **Yard container field (`cans`, the user's):** a ramp up a tilted container onto 2.8 m roofs, an open container on top as a covered walk-through, and a covered pocket under the stacked containers. It's good close quarters with a high-risk layer on top. Points raised: check what the rooftop tunnel can see without being seen, and keep roof edges droppable.
- **Warehouse rack lanes (2026-11-07):** eight lanes, each with its own job:
  - cut-throughs between aisles, which the AI can use too;
  - a low-beam nest you jump into, player-only;
  - a ladder to the top shelves and a bridge across an aisle, player-only.

  Details are in design.md (warehouse) and props.md (racking).
- **Silver Creek graybox (MT-3, 2026-11-09):** an outdoor map, where the lines that matter are 70–120 m long (AI sight up to fog). Fixes were made in `scripts/gen-silver-creek.mjs`: drop-down steps beside the high ladder perches; abandoned trucks on the highway, alternating lanes; a shack mid-way across the log boom; rails at the stair shafts' deep ends. Details are in design.md (Silver Creek).
- **Silver Creek middle and ridge (MT-7, 2026-11-10):** cover on the ridge trail was mostly waist-high and pushed to the trail's edges, so 43% of spots on it still had a 70 m line. Tall piles set across it at 20°, alternating north and south and leaving 2 m past each, brought that to none in the trail's middle. Details are in design.md (Silver Creek).
