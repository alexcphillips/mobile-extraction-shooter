# Tech stack and architecture

Status: **confirmed by the user on 2026-10-26.**

## Platform: a mobile web game, not React Native
React Native / Expo Go was considered and rejected:
- Hermes (React Native's JS engine) has no JIT and no WebAssembly, so game logic would run slowly.
- `expo-gl` puts rendering and game logic on one JS thread.
- Expo Go locks you to a fixed SDK and set of native modules.

Mobile Safari has a JIT and WebAssembly, needs no build step and no Apple developer account, and installs from Add to Home Screen. Every iOS browser uses Safari's engine underneath, so Chrome on iOS makes no difference.

## Repo layout (npm workspaces monorepo)
npm, not pnpm (the user's choice, 2026-10-26). Each package lists every dependency it imports, since npm won't catch a package using a dependency that only another package declared.

Tooling (session 1):
- `@mes/shared`, `@mes/client` and `@mes/server` are the package names. `shared` has no build step: it exports its TypeScript source, and Vite and wrangler bundle it.
- TypeScript is **pinned to 6.0.x**, because typescript-eslint doesn't support TypeScript 7 yet. Move to 7 once it does.
- `shared`'s tsconfig leaves out the DOM types, and ESLint blocks imports of three.js, React and the other packages from it, so the "no rendering or UI in the simulation" rule is enforced, not just written down.
- Strict TypeScript, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- One root ESLint (flat config) + Prettier setup. Vitest runs every package as a project from the root.
```
packages/
  shared/    # game simulation, rules, data schemas. No three.js, React or DOM.
  client/    # Vite app: three.js renderer, React UI, input; includes /editor
  server/    # Cloudflare Worker
content/     # JSON game data: maps, prefabs, items, loot tables, quests, vendors, enemies
docs/
```

## Shared simulation (`packages/shared`)
- Plain TypeScript.
- **Fixed 30 Hz tick:** `step(state, world, inputs)` advances the state **in place** (decided in session 3, so a tick allocates nothing). `FixedTimestep` turns frame times into ticks. The renderer interpolates between ticks, copying the few values it draws before each tick. Look direction is applied to the camera every frame, not every tick, so turning never lags.
- **Serialisable inputs and state.** This is what lets co-op run the same code on the server later. Bit-exact determinism isn't needed (the server is authoritative in co-op).
  - The state (`SimState`) is plain JSON-safe data: entities, the tick count and the RNG state. A test checks that a JSON round trip continues identically.
  - The static map is not in the state. It's a `CollisionWorld`, built once from a plain `WorldDef` (terrain grid, boxes, ramps and ladders) that the map loader produces.
  - Inputs are per entity per tick: the move stick, absolute yaw and pitch, and sprint, crouch and jump. Crouch is the wanted stance, so hold vs. toggle stays a client setting.
- **Combat (session 6):** `step(state, world, items, inputs)`. The item database (`ItemDb`, every item by id) is static like the world, so it's passed in rather than kept in the state. Each tick everyone moves (then takes fall damage), then everyone's gun updates (so shots see this tick's positions), then bleeding. Inputs gained `fire`, `aim` (both held) and `reload` (a press).
  - Character state gained `health` (HP and bleeding per zone, dead), `helmet` and `bodyArmour` (item and durability), `weapon` (item, rounds, spare rounds, cooldown, reload timer), `aim` (0–1) and the recoil offsets. **Spare rounds are a plain count on the weapon until the inventory (session 9).**
  - **Attachments (session 6b):** the weapon state has `attachments` (the item id in each slot, or null). `weaponStats(items, weapon, out)` works out the gun's stats with them into a scratch object, so a tick still allocates nothing. `attach` and `detach` change them (an attachment that doesn't fit throws; check with `fits`); for now the client calls them between ticks, like `giveWeapon`. In co-op they'll become inputs. Shot events carry `loudness` for AI hearing.
  - `state.events` lists what happened during the last tick (`shot`, `damage`, `death`) for effects, hit markers and the HUD. It's cleared each tick; events are the only allocation, and only when something happens.
  - **Hit zones** are six capsules in a fixed layout (`HIT_CAPSULES` in `sim/hit-zones.ts`), turned by yaw and squashed by crouch height. `raycastCharacters` checks each living character's bounding sphere, then its capsules. **No spatial hash for moving things:** with tens of characters, a sphere test each is cheaper than keeping a hash up to date. Revisit if a raid gets past about 100 characters.
- **Seeded RNG** for loot rolls, enemy loadouts, AI decisions, shot spread and bleeding.
- **Collision:** written in-house, no physics engine:
  - A capsule for the player and AI, against rotated boxes, the terrain height grid and stair ramps.
  - **Solids rotate about Y only** (session 3). A standing capsule against a solid is then a circle against a rectangle in XZ plus a height overlap: simple and robust. A tilted primitive in the editor is decorative or gets a Y-only collision box.
  - Ramps are wedges (solid underneath). Stairs are drawn as steps but collide as a ramp.
  - Terrain cells are two triangles split along the diagonal from (i+1, j) to (i, j+1). The renderer must use the same split, or feet float or sink.
  - The character controller is kinematic. It pushes out of walls horizontally (ignoring anything at or below step height), then follows the ground up steps and down slopes, or falls. When landing, it looks for surfaces between the old and new feet, so fast falls don't tunnel through thin floors.
  - A spatial hash (`StaticGrid`, 4 m cells) for the static solids; raycasts walk its cells in order.
  - Raycasts for hitscan and line of sight, against solids and terrain, with the hit normal. Queries reuse scratch space and allocate nothing.
- **Navigation:** a navigation grid with multiple layers (floors), generated from the map data. It links stairs and slopes, but not ladders. A* pathfinding.
  - **Session 7:** `NavGrid` (`nav/nav-grid.ts`) is built at load from the `CollisionWorld` (about 80 ms and 146k nodes for the 192 m test map on the Mac). It's static like the world and never part of the state. Columns every **0.5 m**; each holds a node for every surface (terrain, or a solid's top) where a standing body fits: no solid in the way from a step's height (0.45 m) to 1.8 m above it, within **0.2 m** (less than the body's 0.35 m radius, so 1 m doorways are always open however the grid lines up; bodies slide along the walls). A surface less than a step under another is dropped (stood on through it). Terrain steeper than 45° isn't walkable. Each node stores a bitmask of links to its 8 neighbours (a neighbour within a step's height; diagonals only if both sides are linked, so no corner cutting). Neighbours are found by looking in the column, not stored. A flood fill numbers the **connected components**, so "can it get there at all" is a lookup; the overlay and the editor's unreachable-spot view (session 17) use it.
  - `findPath` (`nav/path.ts`) is A* with an octile estimate plus climb, on preallocated typed arrays (it allocates nothing but its output). It stops after 20,000 nodes. Between different components it heads greedily for the closest spot it can find, with a smaller budget, and says `partial`. The path is smoothed by walking straight lines cell by cell over links (`straight`), so it only turns where it has to.
  - **Doors don't block navigation**, as they don't block movement yet. Session 11 (see design.md → AI → Doors): door state is a flag in the sim and collision snaps; closed unlocked doors stay nav links that an enemy opens on arrival (so the path follower needs to know which links cross a door); locked doors cut their links (enemies never open them, even with the key) until a player unlocks them, which lasts the raid. So door links can't be baked into the grid at load: the grid marks which links cross which door, and path searches check that door's current locked state. **The components lookup is recomputed after an unlock** (decided 2026-10-26): about 11 ms for the test map on the Mac (perhaps 15–25 ms on the iPhone), one dropped frame at a rare, deliberate moment. If that hitch shows on the phone: unlocking only ever joins components, never splits them, so relabelling just the smaller side (a key room's few hundred nodes) is enough.
- **AI (session 7):** each enemy is an ordinary `Character` with `ai: AiState` (plain data: awareness, activity, timers, focus, patrol and path as flat number arrays), so the state still saves and restores as JSON. **AI writes a `PlayerInput` for its character**, which moves and shoots through the same code as a player's; an input passed to `step` for that entity overrides it.
  - `step(state, world, items, inputs, nav?)`: after moving, shooting and bleeding, `updateAi` runs, so it perceives this tick's positions and events (shots, hits) and acts next tick. Without a nav grid enemies stand still (tests and the perf scene).
  - Sight and footsteps are checked every 3 ticks, staggered across enemies; shot and hit events every tick. **At most 2 path searches per tick across all enemies**; the rest wait a tick. An enemy plans again when its goal moves more than 1.5 m, or after 1.5 s stuck (and gives up after 3 tries).
  - Bodies push apart after everyone moves (`separateCharacters`, every pair, then out of walls).
  - **Combat (session 8):** `updateAi(state, world, items, nav)` (it needs the items for gun stats). Fighting is more activities in the same state machine (`engage`, `takeCover`, `cover`, `peek`, `hold`, `loiter`), with the extra state in `AiState` as plain numbers, so a save mid-fight restores exactly (tested). The enemy's skill is copied from its type into `AiState.skill` at spawn, so the state doesn't depend on content files. Its aim error wanders as a smooth function of the tick and a phase per enemy, so it needs no RNG per tick.
  - **Cover search** samples 12 random nav nodes within 10 m and keeps the nearest one that's hidden from the threat's eye at crouched-eye height, at its centre and 0.4 m either side (up to 4 raycasts per candidate, and a candidate further than the best so far is skipped before any raycast). **At most 1 cover search per tick across all enemies**, like path searches. Before each shot an enemy casts one ray through the characters to check no ally is in the way, and one through the world to choose chest or head.
  - Reachability is a components lookup (`nav.nearest` for both, then compare), every perception tick while alert. The way up to an unreachable target is the end of a partial path towards it.
- **Schemas:** zod schemas for all content. Every content file has a `formatVersion`, and old versions are upgraded by migrations when loaded.
- **Tests:** Vitest unit tests for rules (damage, armour, inventory placement, loot rolls, migrations).

## Map and prefab format
Decided in session 4. The schemas are in `packages/shared/src/content/schema.ts`, whose comments are the field-by-field reference.
- **Files:** `content/maps/<id>.json` and `content/prefabs/<id>.json`. The `id` inside must match the file name.
- **Loading:** `loadContent(format, json, source)` checks `formatVersion`, runs the migrations from the file's version up to the current one (`migrations[v]` turns v into v + 1), then validates with zod. A file newer than the build is rejected. Objects are **strict**: an unknown field is an error, so typos are caught and a migration must remove fields it renames.
- **Units and conventions:** metres; **angles in degrees** in files (radians everywhere after loading); y up, yaw 0 faces −z. **`pos` is the middle of a shape's base**, so y is where it stands. Sizes are full sizes, not half-extents. Colours are `#rrggbb`.
- **A map** has `environment` (sky colour, fog near and far), `terrain` (origin, cell size, `heights` as rows along +z of corners along +x, one ground colour), optional `water` (level, colour, opacity), optional colour slots, `nodes` and `zones`.
- **Nodes** (in maps and prefabs alike, told apart by `type`):
  - Shapes: `box`, `cylinder` (a `radiusTop` of 0 makes a cone), `ramp` (a wedge rising towards local +z), `stairs` (drawn as steps, collides as a ramp) and `ladder`. All collide unless `collide: false`.
  - **Only boxes and cylinders tilt** (`pitch`, `roll`). Tilting turns them about their centre, and they collide as their upright bounding box (solids rotate about Y only, see Collision).
  - `prefab`: a reference by id, with a position, a yaw (no tilt) and colour overrides. Prefabs can contain prefabs; a prefab that contains itself is an error.
  - `door`: width, height, hinge side, optional key item, starts open or closed.
  - Markers: `playerSpawn`, `enemySpawn` (enemy type, loadout, loot weight multipliers, optional `patrol`), `lootContainer` (container type, loot table), `lootSpawn`, `extraction` (name, radius) and `questMarker` (id required). Enemy types, loadouts, loot tables and keys are plain ids for now; they're checked against their own files once those exist.
  - `patrol` (session 7): a required `id`; `points` (at least 2, in the enclosing frame), each either a plain `[x, y, z]` to walk through or a stop `{ pos, wait, radius }` (wait defaults to 3 s, radius to 0); `repeatFrom` (default 0: the points before it are the way in, walked once; at least two must repeat); and `loop` (default true; false walks back and forth over the repeating points). An `enemySpawn`'s `patrol` names a patrol **beside it** (in the same map or prefab), so a prefab can carry its own guard and route; it compiles to the patrol's path id, and a missing one is an error. `enemySpawn.radius` spawns at a random clear spot within it. `CompiledMap.patrols` has them in world space, every point as `{ x, y, z, wait, radius }` (walk-through points have 0 and 0).
- **Format 2** (session 7) added patrols, for maps and prefabs alike; 1 → 2 changes nothing.
- **Named zones** are polygons in x, z, at map level only.
- **Colour slots (recolouring):** a prefab declares slots with default colours (`"colours": { "paint": "#c0392b" }`), and its shapes use either a hex colour or a slot name. A placement overrides slots, and an override can name a slot of the enclosing prefab or map. Overriding a slot the prefab doesn't have is an error.
- **Ids:** any node can have an `id`, unique among its siblings. Markers and doors come out of compilation with **path ids**, the ids from the map down joined by `/` (for example `house-a/desk`); a node without an id is `#` and its index. Anything other content refers to (quest markers, keyed doors) should have an explicit id.
- **Compilation:** `compileMap(map, prefabs)` (in shared, so the server can use it for co-op) flattens everything into a `CompiledMap`: the `WorldDef` for collision, world-space shapes to draw, instanced groups, doors, markers and zones.
- Deferred: per-cell terrain colours (roads, dirt) and scaled prefab placements. Both can be added later with a migration.


## Enemy types and loadouts
Session 8. The schemas are in `packages/shared/src/content/enemies.ts`, whose comments are the field-by-field reference. Loaded like items (`formatVersion` 1, strict zod objects, the id must match the file name).
- **`content/enemies/<id>.json`:** `name`, `loadout` (the default loadout id) and `skill` (`reaction` s, `aimError` and `aimSettled` degrees, `aimSettle` s, `holdChance` 0–1).
- **`content/loadouts/<id>.json`:** `weapons` (at least one: `weight`, `item`, `spare` as `[min, max]` rounds, optional `attachments` as `{ item, chance }` where the first to roll in a slot wins), and optional `helmets` and `bodyArmour` (`weight`, `item` or `null` for none, optional `condition` as a `[min, max]` fraction of full durability). Each part is picked by weight on its own.
- `checkEnemies` checks the references (loadouts exist, items are the right type and slot, attachments fit their gun); the client checks each map's enemy spawns name a type and loadout that exist. Both run in the client's content test.
- `equipLoadout(c, items, loadout, rng)` (`sim/loadout.ts`) rolls one onto a character, using the sim's RNG so a raid's rolls come from its seed.
- Loot weighting on enemy spawns (`lootWeights`) is in the map format but unused until loot tables exist (session 11).

## Item format
Started in session 6 with what combat needs; session 6b added attachments (format 2), and session 9 adds the rest of the item model. The schema is `packages/shared/src/content/items.ts`, whose comments are the field-by-field reference.
- **Files:** `content/items/<id>.json`, one item each, loaded like maps (`formatVersion`, migrations, strict zod objects). The `type` field picks the kind: `weapon`, `ammo`, `armour` or `attachment`.
- **weapon:** ammo item, `fireMode` (`auto` or `semi`), `rpm`, `magazine`, `reloadTime`, `aimTime`, `range`, `loudness` (hearing radius in metres), `slots` (any of `optic`, `muzzle`, `magazine`), `hipSpread` and `aimSpread` (degrees), and `recoil` (`up`, `side`, `recovery` in degrees per second).
- **attachment:** `slot`, optional `weapons` (the guns it fits; otherwise every gun with the slot), optional `mods` (multipliers `spread`, `recoil`, `aimTime`, `reloadTime`, `loudness`, and `magazine` as extra rounds), and for optics only `optic`: `zoom` (1 is a red dot, above 1 a scope) and `reticle` (`colour` and `shapes`: `dot`, `line` and `ring`, in % of the screen height from the aim point, y down; the scope mask's radius is `SCOPE_RADIUS`, 46).
- Format 1 → 2 (session 6b) gave weapons `loudness: 150`; slots are optional.
- **ammo:** `damage` (to the chest; zones multiply it), `armourDamage` (durability lost per point absorbed, default 1), `bleedChance`.
- **armour:** `slot` (`helmet` or `body`), `absorb` (0–1), `durability`.
- `checkItems` checks references between items (a weapon's ammo exists and is ammo; an attachment's guns exist and have its slot); the client's content test runs it.
- **Models, mount points and sight lines are not in item files yet** (decided 2026-10-26, session 6b). Until the item editor's model builder (session 18), the gun and its attachments are placeholder boxes in the client's `render/viewmodel.ts`, chosen by kind: scope or red dot by zoom, suppressor or brake by whether it makes the gun quieter, long mag if there's any magazine. Each sight placeholder has its sight height there. Session 18 moves geometry, mounts and sight lines into the item files.

## Client (`packages/client`)
- **Build tool:** Vite + TypeScript.
- **3D rendering:** plain three.js, not React Three Fiber, so the game loop and rendering stay outside React.
  - Static map geometry is **merged per chunk** (32 m): one mesh per chunk holding its terrain and every shape whose centre is in it.
  - **Instancing is opt-in per prefab** (`"instanced": true`, session 4), for small props placed many times, like trees and crates. Each instanced prefab and colour set becomes one `InstancedMesh` for the whole map. Merging is the default because it costs no extra draw calls; instancing saves memory and load time but adds one draw call per group, and a group is culled as a whole.
  - Colour is stored per vertex, with each face direction shaded differently; materials are unlit (`MeshBasicMaterial`); distance fog. Static geometry has the shading baked into its colours. Instanced and moving geometry (doors now, characters later) uses `shadedMaterial()`, which applies the same shading on the GPU from the world-space normal, so it stays right as the object turns.
  - Each door is its own mesh, pivoted at its hinge, so it can swing open.
  - Content is bundled into the client with `import.meta.glob`; in dev, saving a content file reloads the page.
  - The camera's far plane follows the fog distance.
  - **The first-person gun is drawn in a second pass** after the world, with the depth buffer cleared, so it never pokes into walls (`render/viewmodel.ts`). One extra draw call. It's a placeholder built from boxes until the item editor (session 18), with the arms (session 8b) in the same mesh. The placeholder guns, rifle and pistol, are shared with the bodies (`render/gun-model.ts`).
  - The viewmodel rebuilds its one mesh only when the gun or its attachments change. **Optic reticles and the scope mask are one SVG overlay** (`hud/optic.ts`, rebuilt only when the optic changes), not 3D, so they cost no draw calls; while scoped the gun isn't drawn at all.
  - Tracers and impact puffs come from fixed pools (`render/effects.ts`): one line mesh and one instanced mesh, so shooting allocates nothing and costs two draw calls.
  - Recoil is simulation state, so the camera interpolates it between ticks like the eye position.
- **UI:** React DOM overlays for menus, inventory, settings and the editors.
  - **React is loaded lazily** (session 5): menus are dynamic imports, so React is a separate chunk (about 70 kB gzipped) fetched the first time a menu opens, not part of startup. No `@vitejs/plugin-react`: Vite compiles JSX itself (`"jsx": "react-jsx"`), so there's no fast refresh and a change to a component reloads the page. ESLint runs the React hooks rules on `.tsx`.
  - The HUD doesn't re-render through React every frame. Values that change every frame are written straight to the DOM, or throttled to about 10 Hz. **The in-game HUD buttons are plain DOM** (`hud/`), as is the layout editor, which moves the real buttons over the paused game.
- **Input:** Pointer Events for the virtual sticks and buttons (`input/controls.ts`). Moves and lifts are listened for on `window`, so a touch that started on a button keeps working when it slides off. **The layout is stored in settings** as each moved control's centre (a fraction of the screen) and a size multiplier; unmoved controls follow the defaults in `hud/layout.ts`.
- **Settings:** stored locally first (`localStorage`, key `mes.settings`); synced to the account once the server exists. The schema is in `shared` (`settings.ts`), versioned like content files, and every field falls back to its default on its own, so a bad value never wipes the rest. `settings.ts` in the client is the store: changes save and apply straight away.
- **Pausing** (`app/pause.ts`): the game pauses for a reason (portrait, a menu, the page hidden). While paused the frame loop stops, every touch is let go, and the time away doesn't count as a frame. Co-op will need a different rule: the raid can't stop.
- **PWA:** web app manifest (`public/manifest.webmanifest`, landscape, standalone) and Apple meta tags, plus the Safari workarounds in design.md. The icons are placeholders drawn by a one-off script. **No service worker yet:** iOS doesn't need one to add to the home screen, and offline play is part of session 12's offline handling.
- **Audio:** Web Audio API, unlocked on the first tap (`app/audio.ts`: the first `touchend`, `pointerup` or key creates the context and plays a silent sample; later taps resume it after iOS suspends it).

## Editors (`/editor` route in the client)
- Desktop only (mouse and keyboard).
- **Saves through a Vite dev-server plugin** that writes JSON into `content/`.
  - The editor routes and the save endpoint exist **only in the dev server**, never in the production build. That makes them admin-only without needing an auth system.
  - Content changes go through git like code.

## Server (`packages/server`)
- **Cloudflare Workers (free plan)** with **Hono** for routing and **D1** (SQLite) for accounts, stash, vault, quest progress and vendor state.
- **Responsibilities:** accounts and sessions, profile and stash persistence, starting and ending raids (raid results go through sanity limits), vendor transactions, quest state.
- **Solo raids run entirely on the phone.** The server only sees the start and the result.
- **Co-op (later):** one Durable Object per co-op raid runs the shared simulation at 30 Hz, connected by WebSocket. It stays awake for the length of the raid (about 112 GB-s for a 15-minute raid, against a free allowance of 13,000 GB-s per day). Incoming WebSocket messages are billed at 20 per request, against 100k requests per day.
- **Free-plan limits are hard caps:** going over makes requests fail until midnight UTC. Nothing is charged.

## Hosting and testing
- **One Worker serves both the client and the API** (decided 2026-10-26, session 1). The built client is the Worker's static assets (`packages/server/wrangler.jsonc` points at `packages/client/dist`). Only `/api/*` runs Worker code; any other unknown path falls back to `index.html`. Sharing one origin means no CORS, and session cookies work with no extra setup. Pages was the alternative; Cloudflare is moving new projects to Workers static assets anyway.
- In dev, the client (Vite, port 5180) and the Worker (`wrangler dev`, port 8787) run separately, and Vite proxies `/api` to the Worker.
- **Phone testing during development:** run `vite --host` and open it on the iPhone over the local network. When HTTPS is needed (installing as a home-screen app, some browser features), use a Cloudflare preview deployment or a `cloudflared` tunnel.
- Each milestone ends with a performance check on the real iPhone (FPS counter in dev builds).

## Characters (confirmed, see design.md → Characters)
- The base body is a rigged, animated low-poly humanoid from a CC0 pack in glTF format. Recolour it to flat colours and draw it unlit, so it matches the map.
- Gear (helmet, armour, backpack, weapon) is built in the item editor and attached to the skeleton at named mount points.
- Hit zones are simple capsules, not tests against the mesh itself. **They're a fixed layout in the simulation, not attached to bones** (changed 2026-10-26, session 6, so a co-op server needs no skeleton); the body is drawn to match.
- Distant characters update their animation less often to save performance.

Built in session 8b:
- **The asset:** `packages/client/public/characters/mannequin.glb`, from Quaternius's Universal Animation Library (Standard, CC0; licence and source in the README next to it). `scripts/build-character.mjs` builds it from the pack's GLB with glTF Transform and meshoptimizer: 15 clips kept, UVs dropped, the mesh simplified from 13.7k to 5.8k triangles, only rotation tracks kept (plus the hips' translation). 556 kB, 279 kB gzipped, fetched at startup rather than bundled. Quaternius's site moved new downloads to its own licence (QAL, August 2026), which forbids redistributing the files; this copy is CC0, but check before adding later downloads to the public repo.
- **One draw call per character, gear included** (`render/character.ts`). At load, the body is baked into flat triangles with face normals; each face takes the outfit part of the bone that weighs on it most (joint bands 20% darker). Each look (outfit, helmet, armour, gun) is one geometry, built once and cached, with gear bound rigidly to its mount bone. Shading happens on the GPU from the skinned normal, with the same formula as the map. Bodies cull by a fixed sphere, since animation moves them far from their rest-pose bounds.
- **Animation** (`render/character-body.ts`): two layers, legs and upper body, from clips split by bone. The legs pick idle, walk, jog, sprint, crouch, crouch walk, jump or death by speed and stance, paced to the speed. When strafing, the hips turn towards where it's going (up to about 70°) and the chest turns back to face forward; going backwards plays the clip in reverse. The upper body leans with the look pitch and flinches when hit. **Gun hold by IK:** a two-bone IK per arm, with the hand rotations measured once from the pistol aim clip. The gun's position and tilt per hold are in `HOLD` there.
- **three.js's mixer only writes a bone when its clip value changes**, so posing on top of clips must put each bone back to its clip rotation before every update; otherwise turns pile up frame after frame. `CharacterBody` does this for the bones it poses.
- **LOD:** a body animates every frame within 20 m, every 2nd frame to 45 m, every 4th beyond, and every 8th off screen. It uses IK within 30 m; beyond that the gun goes in the hand. The dead stop animating 3 s after falling. Positions and yaw are interpolated between ticks.
- `/bodies` shows every pose with the hit zones over them, and `?hitzones` does the same in play.

## Still open
- Login method (username and password vs. invite codes vs. magic links). Decide in the server session.
- Where sound effects come from (CC0 packs vs. generated). Decide in the content session.
