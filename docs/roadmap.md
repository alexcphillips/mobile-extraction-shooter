# Roadmap to v1

**v1 =** a solo PvE game that's fun to play on an iPhone:
- one handmade map, built in the map editor;
- the full loop: stash → vendors and quests → raid → extract or die;
- persistence on the server;
- the map and item editors working well enough to make more content.

Co-op, weekly challenges, the flea market and trading are post-v1.

## How to use this file
- Each session below is sized for one Claude Code session. Start a session with "Do session N from docs/roadmap.md".
- Read CLAUDE.md, design.md and tech-stack.md first.
- At the end of a session:
  - tick its box;
  - add short notes under it (what was built, anything deferred, decisions made);
  - update design.md or tech-stack.md if a decision changed.
- If a session is too big, split it here before starting rather than leaving it half done.

## Milestone A: foundation and performance gate
- [x] **1. Monorepo scaffold.**
  - npm workspaces (`shared`, `client`, `server`), TypeScript, ESLint and Prettier, Vitest.
  - A Vite client showing an empty three.js scene, and a "hello" Worker.
  - Deploy both to Cloudflare. Document dev commands and how to test on the phone over the local network.
  - *Done when* the deployed URL opens on the iPhone and the Worker responds.
  - **Notes (2026-10-26):**
    - Built: the `@mes/shared`, `@mes/client` and `@mes/server` workspaces. Strict TypeScript, ESLint flat config, Prettier and Vitest projects. `npm run check` runs all of them.
    - The client is an unlit three.js scene with fog, plus a status line that calls `/api/hello`. The Worker is Hono.
    - Deployed as **one Worker that also serves the client** at https://mobile-extraction-shooter.alexphillipsdev.workers.dev (see tech-stack.md → Hosting).
    - Dev port is 5180 (5173 is taken by another project on this Mac). The README covers dev commands and testing on the phone.
    - TypeScript is pinned to 6.0.x until typescript-eslint supports 7.
    - Checked with curl over the LAN and on the deployed URL; the user confirmed it opens and runs on the iPhone.
    - Deferred: three.js makes the bundle a ~600 kB chunk (Vite warns). Fine for now; split it into a vendor chunk or lazy-load it when the menu UI arrives.
- [x] **2. Performance test on the phone.**
  - A test scene with about 2,000 boxes merged per chunk, per-face shading, fog, about 10 **animated low-poly characters from a CC0 pack** wandering, raycasts every tick, basic touch move and look, and an FPS counter.
  - *Done when* it holds a steady 60 fps on the user's iPhone (or we know where the limit is and record it here). **This is the go/no-go gate for the whole approach.**
  - **Notes (2026-10-26), built; waiting on the iPhone measurement:**
    - The client opens straight into the perf scene (`packages/client/src/perf/`). The README covers its controls, stats and URL parameters (`boxes`, `chars`, `rays`, `dpr`, `aa`, `fog`) for probing the limit on the phone.
    - World: a 256 m map with height-function terrain (2 m cells) and 2,000 boxes rotated about Y, merged into 64 chunk meshes of 32 m. Per-face shading is baked into vertex colours; unlit `MeshBasicMaterial`. On desktop that's about 34 draw calls in view and 40k triangles.
    - Characters: "RobotExpressive" by Quaternius (CC0, from the three.js repo) as a stand-in until session 8b. As loaded it's 19 draw calls per character (rigid parts parented to bones), so at load time we **bake every part into one skinned mesh with flat per-face vertex colours**: one draw call per character, about 3.2k triangles. Session 8b should do the same with the real pack. Clones use `SkeletonUtils.clone`, each with its own `AnimationMixer`.
    - Raycasts: a throwaway uniform-grid (8 m cells) ray against Y-rotated boxes in `perf/raycast.ts`, tested against brute force. Each 30 Hz tick casts the aim ray, one line-of-sight ray per character, and 100 extra rays. The real version goes in `shared` in session 3.
    - Fixed 30 Hz tick with interpolated rendering, as planned for the simulation.
    - Test device: **iPhone 16 Pro, iOS 26.7.1**. The screen is 120 Hz, but Safari caps pages at 60 fps, so 60 is the target.
    - First run (dev server, default settings, standing still): a steady 60 fps, 16.7 ms frames, cpu about 2 ms per frame, tick 0.2–0.5 ms, 41 draw calls, 55k triangles. Janks (frames over 20 ms) came only from moving and turning. Since then, everything is drawn once at startup to warm up the GPU, and there are now preset buttons for the stress settings.
    - **Stress results (dev server, walking and spinning):** every preset held 60 fps.
      | Preset | fps | cpu ms/frame | Janks per 10 s while moving |
      |---|---|---|---|
      | 30 chars | 60 | 3–4.3 (5 peak) | up to 21 |
      | 6000 boxes | 60 | low | about 10 |
      | dpr 3 | 60 | 2 | about 10 |
      | All three | 59–61 (one dip to 56) | 3.5–4.4 | not recorded |
    - **Verdict: GO.** There's about 3× headroom over the planned scene in characters, boxes and resolution, and CPU is far below the 16.7 ms budget. The limit wasn't reached.
    - **Janks while moving: not the scene, not noticeable.** Frames over 20 ms happen only while walking or turning, never when still. With `0 chars` it was still about 20 per 10 s, so the cause is Safari's touch-input handling or 60-on-120 Hz frame timing, not our rendering or simulation. The user felt no stutter. Revisit only if stutter becomes visible in play: Safari Web Inspector timeline over USB, and check that the jank counter isn't measuring rAF jitter.

## Milestone B: a raid you can play offline (no server)
- [x] **3. Simulation core.**
  - Fixed-tick loop, entity model, serialisable inputs and state, seeded RNG.
  - Capsule against rotated-box collision, terrain height grid, stair ramps, ladders, raycasts, spatial hash.
  - Player movement: walk, sprint, crouch if wanted, climbing ladders.
  - Unit tests.
  - **Notes (2026-10-26):**
    - Built in `packages/shared/src`: `rng.ts` (mulberry32 with its state as a plain object), `FixedTimestep` in `tick.ts`, `world/` (the height grid, the `StaticGrid` spatial hash and `CellWalk` ray walk, and `CollisionWorld`), and `sim/` (state and entities, the character controller, `step`). 57 unit tests, including raycasts checked against brute force and a JSON save-and-restore that continues identically.
    - Decided with the user: **solids rotate about Y only** (slopes come from ramps and terrain), and the player gets **crouch and jump**. See design.md → Movement.
    - `step(state, world, inputs)` **mutates the state in place** rather than returning a copy, so a tick allocates nothing. The static map is a separate `CollisionWorld` built from a plain `WorldDef`, not part of the state. Session 4's loader should produce a `WorldDef`.
    - The perf scene now moves the player with the shared sim and uses `CollisionWorld.raycast` (terrain included) instead of the throwaway grid. It has a playground at the spawn: a step, a box to mantle, a wall too high to mantle, a beam to crouch under, and a 3 m platform with stairs and a ladder. There are jump and crouch buttons; on desktop, Space and C.
    - **Checked on the iPhone:** the tick stays at 0.4–0.67 ms with terrain raycasts added, and the user is happy with how jumping and ladders feel.
    - Fixed after the phone test: sprinting now turns the crouch toggle off. Before, you went back to crouching when you stopped sprinting. The sim already stood you up to sprint; the toggle lives in the client.
    - Deferred: characters don't collide with each other yet (session 7/8, when AI moves). A spatial hash for moving things, needed for hit-zone capsules, comes in session 6. Ladders are found by a linear scan, which is fine for dozens. Fall damage moved to session 6.
- [x] **4. Map format and loader.**
  - zod schema with `formatVersion` and migrations: terrain height grid, water level, primitives, prefabs by reference, markers, named zones, doors.
  - Loader: merged chunks, instancing, per-face shading, fog.
  - A hand-written test map in `content/maps/`.
  - **Notes (2026-10-26):**
    - Built in `packages/shared/src/content/`: `format.ts` (`loadContent`: version check, migrations, zod validation), `schema.ts` (map and prefab schemas) and `compile.ts` (`compileMap` flattens a map and its prefabs into the `WorldDef`, world-space shapes, instanced groups, doors, markers and zones). The format is written up in tech-stack.md → Map and prefab format. 18 new unit tests.
    - Client: `render/geometry.ts` (flat-shaded triangles for boxes, cylinders and cones, wedges and terrain), `render/map.ts` (chunks, instancing, doors, water), `render/debug.ts` (markers and zones) and `content.ts`, which bundles `content/` and loads it. `content.test.ts` loads and compiles every map in `npm test`, so a broken content file fails the check.
    - **The client now opens into the test map** (`play/`) with the shared movement; the perf scene moved to `/perf`. `?map`, `?spawn` and `?debug` are in the README. The perf scene now builds its chunks with the same code, and its movement playground moved into the test map. `Controls` and `Stats` moved to `input/` and `debug/`.
    - Decided: angles in degrees in files; `pos` is the middle of a shape's base; only boxes and cylinders tilt, about their centre, colliding as their upright bounding box; colour slots for recolouring; path ids for markers and doors; strict objects. **Instancing is opt-in per prefab** rather than automatic, because merging into chunks costs no extra draw calls.
    - Test content: `content/maps/test-map.json` (192 m, 4 m cells) and four prefabs (`small-house`, `car`, `crate` and `pine-tree`; the last two instanced). The terrain heights and the 70 trees on the hills came from a one-off script, since tree heights have to match the terrain. Everything else is written by hand. Until the editor's snap-down exists (session 15), anything placed on a slope needs its y worked out.
    - Checked in headless Chrome on the Mac: the test map draws in about 20 draw calls and 6–8k triangles in view; houses, recolours, doors, the pond, the tipped-over log and the debug markers all look right, and walking up the stairs reaches y = 3. **Checked on the iPhone:** a steady 60 fps on the test map, about 0.5 ms CPU per frame, and the tick barely measurable.
    - A slow first load after adding zod was a stale Vite dependency cache (requests failing with 504 "Outdated Optimize Dep", so the page sat on "starting…"). Reloading fixed it. After adding a dependency, restart `npm run dev` if the page hangs.
    - **Doors don't collide yet.** They're drawn, and their key and open state are loaded, but you walk through them. Doors that move are simulation state, not part of the static `CollisionWorld`; session 11 adds them.
    - Deferred: per-cell terrain colours (roads), scaled prefab placements, and checking enemy, loot table and key ids against their own files (once those exist). The bundle grew from about 600 to 780 kB (zod and the content); split it when the menu UI arrives (see session 1). If zod's size matters, `zod/mini` is smaller.
- [x] **5. Touch controls and HUD shell.**
  - Virtual stick and look, buttons for fire, aim, reload, interact and quick slots.
  - **Sprint lock:** drag the move stick up past the top of its area to lock sprinting for long runs, so the thumb can relax. Decide what unlocks it (for example, pulling the stick back or tapping it).
  - Sprinting turns crouch off, as in the perf scene since session 3.
  - Settings screen: adjustable and saved layout, radio buttons for aim and fire behaviour, aim assist level.
  - Portrait overlay that pauses, audio unlock, PWA manifest and standalone mode.
  - **Notes (2026-10-26):**
    - Decided with the user: **"automatic fire" means auto-fire on target**, and **sprint lock unlocks** when you pull the stick back, tap the left half, aim, crouch or jump off a ladder. Also decided: the fire button doubles as a look surface. All in design.md → Controls.
    - Built in the client: `hud/` (the buttons and their default layout, plus the layout editor: drag to move, − and + to size, Reset all, Cancel and Done), `input/controls.ts` (rewritten: stick, sprint lock, look from the right half and the fire button, hold and toggle aim, presses for reload, use and quick slots, sensitivity and invert), `app/` (pause, audio unlock, the frame loop helper), `settings.ts` (the store) and `ui/` (the React settings screen, loaded lazily). The settings schema is `packages/shared/src/settings.ts`, with 4 tests.
    - Settings: aim hold or toggle, firing auto or button only, aim assist off to high, look and aiming sensitivity, invert Y, show stats, edit layout, reset. Opening settings pauses the game.
    - Placeholders until the systems exist: aim narrows the FOV from 70° to 50°, fire grows the crosshair dot, and reload, use and the quick slots light up and register a press but do nothing. **The auto-fire and aim-assist settings are saved but not applied yet**; session 6 (firing) and sessions 7–8 (enemies) apply them. The use button is always shown; making it contextual comes with looting and doors (sessions 10–11).
    - PWA: manifest, Apple meta tags, placeholder icons. The stats header shows "standalone" or "browser" so you can tell whether the home-screen launch worked.
    - Checked in headless Chrome with touch emulation at iPhone landscape size: sprint lock engages, steers, and unlocks by tap and by pulling back; fire held shows the firing state and drags the view; settings save to local storage and survive a reload; the layout editor moves and resizes a button and saves only moved controls; portrait shows the overlay and freezes the game; the perf scene still runs. No console errors.
    - Bundle: React added no startup weight (the settings chunk is separate); the main chunk is still about 790 kB.
    - The first time React was imported, Vite re-optimised its dependencies and reloaded the page (the same thing as in session 4). If the settings button seems to do nothing straight after an install, reload.
    - Deferred: a fixed (non-floating) stick option, a left-side fire button, and a hint to add the game to the home screen.
    - **Checked on the iPhone:** the user tried it and it looks good.
- [x] **6. Weapons and damage.** (Split from the original session 6 on 2026-10-26: attachments moved to 6b.)
  - Hitscan shooting, hit zones and multipliers, armour % absorption and durability, limb HP, spillover to the chest, broken-limb effects, bleeding, death.
  - **Fall damage** (agreed 2026-10-26): to the legs from the landing speed, which the sim already knows.
  - Weapon stats and simple recoil; reloading from carried ammo.
  - Target dummies to shoot until AI exists; auto-fire on target and aim assist (saved in session 5, applied here).
  - HUD: health bar, status icons, armour icon colours.
  - **Notes (2026-10-26):**
    - Decided with the user: **split the session** (attachments are 6b), and **hit zones are a fixed capsule layout in the simulation**, not capsules on animated bones, so a co-op server needs no skeleton (design.md → Damage; tech-stack.md → Characters).
    - Shared: `content/items.ts` (the item format: weapon, ammo and armour; see tech-stack.md → Item format), `sim/health.ts` (zones, HP, multipliers, armour, spillover, bleeding, falls, death), `sim/hit-zones.ts` (capsule layout, ray against capsule, `raycastCharacters`) and `sim/weapons.ts` (aim, recoil, fire rate, spread, reload, firing). `step` now takes the item database and fills `state.events`. 35 new unit tests (111 in all), including ray-capsule against brute-force sampling.
    - Content: `content/items/` with an assault rifle (auto, 700 rpm, 30 rounds), a pistol (semi, 15 rounds), their ammo, a steel helmet and a plate carrier. Numbers are first guesses, to tune in play.
    - Decided along the way (all in design.md): the rest of a hit that breaks a limb also spills to the chest (otherwise big hits and falls on legs could never kill); armour absorbs its full percentage until it breaks; bleeding is a chance per ammo type, 1 HP/s per zone; fall damage from 10 m/s, 12 per m/s over, to each leg; firing stops a sprint and ends sprint lock; armour is "damaged" below 75% and "low" below 35%.
    - Client: target dummies at every enemy spawn (drawn as their hit-zone capsules coloured by HP, armour as boxes; they get up 6 s after dying; the yard boss wears armour), a placeholder gun drawn in a second pass so it never clips into walls, tracers and impact puffs from fixed pools, the HUD (`hud/vitals.ts`: health bar, broken and bleeding chips, armour icons, ammo and reload bar, hit and kill markers, red flash when hurt, a death screen whose "Try again" reloads the page). Auto-fire and aim assist now work. `?weapon=pistol` swaps the gun; with `?debug`, quick slots 1 and 2 shoot and heal yourself.
    - The player starts with the rifle, 120 spare rounds and both armour pieces, hard-coded in `play/` until loadouts exist (sessions 11 and 13).
    - Checked in headless Chrome at iPhone landscape size: auto-fire shoots a dummy once the crosshair is on it, empties the magazine and reloads; aimed manual shots at the legs broke one and spilled into the chest; the debug hurt key bleeds and wears the helmet to orange; the perf scene still runs. No console errors. 60 fps with 44 draw calls (the three dummies are 8 each, a debug stand-in).
    - **Not done yet:** nothing heals or stops bleeding in play except the debug key (meds are sessions 9–10); dead dummies just lie down (8b animates). Spread doesn't grow while moving; add it if hip-fire on the run feels too accurate.
    - Bundle: the main chunk is about 808 kB (up 18 kB).
    - **Checked on the iPhone:** the user tried it and it looks good.
- [x] **6b. Weapon attachments.**
  - Attachment slots (optic, muzzle, mag): attachment items, stat changes.
  - Optics: full-screen zoom with a scope mask, red-dot reticles, the gun's sight line so the reticle lines up when aiming.
  - Muzzle: suppressors and the shot's hearing radius (used by AI hearing in session 7).
  - Extended magazines.
  - **Notes (2026-10-26):**
    - Decided with the user: **an attachment fits every gun with its slot unless it lists the guns it fits** (magazines list theirs), and **models, mount points and sight lines stay client placeholders until session 18** rather than going into item files now. Both in design.md and tech-stack.md.
    - Shared: the item format is now **version 2**, with its first migration (weapons gained `loudness`; `slots` is optional). New `attachment` item type with stat changes (`mods`) and, for optics, zoom and a reticle made of dots, lines and rings. `WeaponState.attachments`, `weaponStats` (allocation-free), `attach`, `detach` and `fits`; shot events carry `loudness`. 5 new tests (118 in all).
    - Content: `red-dot`, `scope-4x` (rifle only, aim time ×1.4), `suppressor` (loudness ×0.3, recoil ×0.9), `muzzle-brake` (recoil ×0.7, loudness ×1.2), `mag-556-45` (+15 rounds, reload ×1.15) and `mag-9mm-24` (+9, reload ×1.1). Both guns have all three slots. Numbers are first guesses.
    - Client: placeholder models for each attachment kind on the viewmodel, which aims down the optic's sight line; no muzzle flash when suppressed. `hud/optic.ts` draws the reticle and scope mask as an SVG overlay. A 4× scope gives a 20° view and slows looking to match. The reload bar uses the reload time with attachments.
    - Testing: `?attach=<id>,<id>` sets the player's attachments, and with `?debug` quick slots 3 and 4 cycle through the optics and muzzles that fit.
    - Checked in headless Chrome at iPhone landscape size: the red dot lines up in its frame when aimed; the scope snaps to 4× behind the mask with the HUD on top; the 45-round mag fills to 45 and fires down at the right rate; cycling back to irons still lines up; the pistol takes the red dot and 24-round mag; `?attach=scope-4x` on the pistol stops with "doesn't fit"; the perf scene still runs. No console errors. 60 fps; scoped is 14 draw calls, since the gun isn't drawn.
    - Bundle: the main chunk is about 815 kB (up 7 kB).
    - Not done yet: nothing in play gives you attachments except the URL and debug keys (the attachment manager is session 10, stash loadouts session 13). Loudness isn't heard by anything until AI hearing (session 7). No sounds yet, so suppressed shots sound no different.
    - **Checked on the iPhone:** the user tried it and it looks good.
- [x] **7. AI part 1: navigation and perception.**
  - Generate the multi-layer navigation grid (stairs, no ladders); A*.
  - Patrol routes. Sight cones with line of sight; hearing (shot radius, suppressors).
  - Awareness states. A debug navigation overlay in the game.
  - **Notes (2026-10-26):**
    - Decided with the user: **patrols are named route nodes** that an enemy spawn points to (map and prefab format 2), shaped by walk-through points, with stops that have their own wait and an optional radius (a random spot each visit), spawn radii, and a way in walked once before the rest repeats (`repeatFrom`), **shot hearing is tiered** (heard: look; within half the loudness: investigate; within 15%: alert), and **footsteps are heard** (sprinting 15 m, walking 6 m, crouching silent). All in design.md → AI.
    - Shared: `nav/nav-grid.ts` (the layered grid: 0.5 m columns, 0.2 m wall clearance, step-height links, no corner cutting, connected components), `nav/path.ts` (A* on preallocated arrays, partial paths to unreachable goals, smoothing), `sim/ai.ts` (perception, the awareness states and behaviour; enemies write their own `PlayerInput`), `separateCharacters` in `sim/movement.ts`, two queries on `CollisionWorld` (`solidsAt`, `overlaps`), and patrols in the map compiler. `step` takes the nav grid as an optional fifth argument. 29 new tests (142 in shared), including a JSON save-and-restore with enemies mid-investigation.
    - Content: the test map's west scav spawns within 3 m of its spot, walks a set way in to a stop west of the houses, then goes back and forth to a stop beyond them by way of a bend; the yard scav walks back and forth into the shed through its doorway; the boss guards.
    - Client: target dummies are now enemies (still drawn as hit-zone capsules, `render/capsule-body.ts`), back at their spawn 6 s after dying. `?nav` draws the grid (green: reachable; orange: islands such as roofs and crate tops), and `?debug` adds patrol lines and each enemy's awareness gem, view edges, path and focus. The stats line shows the nav build time and how many enemies are on edge.
    - Checked in headless Chrome at iPhone landscape size: the nav grid builds in about 80 ms (146k nodes) with no console errors; standing in the open at the centre, the west scav noticed the player and closed to about 10 m, then held; a burst of fire made a third enemy suspicious. 60 fps; tick 0.15–0.3 ms with three enemies. The `?nav` overlay is heavy (about 150k triangles), but it's debug-only.
    - Bundle: the main chunk is about 837 kB (up 22 kB).
    - Not done yet: enemies don't shoot or take cover (session 8). Doors don't block navigation or sight, because they don't collide yet (session 11 must cut nav links at closed doors). Enemies' shots don't alarm other enemies. A path ends at the nav cell nearest its goal, not exactly on it (within 0.35 m). The `?debug` spawn post you stand on shows as a big blue shape over the view (from session 4, not new).
    - **Tested by the user:** it's good. The sight, hearing and patrol numbers stay as they are for now.
- [x] **8. AI part 2: combat.**
  - Engage, take cover, hold angles, search after losing you.
  - Handle an unreachable player (break line of sight, hold, give up).
  - Bosses as enemy types. Enemy spawn points with loadout rolls. (Loot weighting and looting bodies moved to session 11.)
  - **Notes (2026-10-26):**
    - Decided with the user: **looting bodies and loot weighting move to session 11**, since they need items, inventory and loot tables, and the dead now stay down for it; enemies' aim is a **settling aim error** (a reaction time, then aim that wanders less the longer it watches you, in bursts); **enemies join an ally's fight** when they hear it close by. All in design.md → AI → Session 8.
    - Decided along the way (in design.md): bosses are better skill and gear, not more HP; re-seeing you where it last saw you is quick, somewhere else takes a fresh reaction (rewards repositioning); it holds an angle only if it can see it; it aims at your head when only that shows over cover; it never fires through an ally.
    - Shared: `content/enemies.ts` (enemy type and loadout formats, `checkEnemies`), `sim/loadout.ts` (`equipLoadout`), and combat in `sim/ai.ts`: the `engage`, `takeCover`, `cover`, `peek`, `hold` and `loiter` activities, the aim model, bursts, sidestepping, the cover search, reachability and the way up, and allies' shots. `updateAi` and `step` pass the items through. 13 new tests (160 in all): reaction then hits, aim settling and moving targets, no shooting through an ally, cover hidden from the player and peeking out, ducking into cover when hit, joining an ally's fight, holding the way up to an unreachable player and giving up, a JSON save and restore mid-fight, and loadout rolls and reference checks.
    - Content: `content/enemies/scav.json` and `boss-scav.json`, `content/loadouts/scav-kit.json` and `boss-kit.json`. Numbers are first guesses.
    - Client: enemies spawn with their type's skill and a rolled loadout, and stay dead; `?respawn` brings them back (with a new roll) and `?peaceful` sends them in unarmed. The content test checks the new files and every enemy spawn's type and loadout.
    - Checked in headless Chrome at iPhone landscape size, and by running the test map's simulation headless: standing still in the open at the centre, all three enemies engage within about 10 s; scavs at about 30 m land roughly 1 in 6 shots, the boss up close most; they take cover, peek and come back; the player died at about 22 s. 60 fps, the tick 0.1–0.35 ms through the fight, one dropped frame now and then. No console errors.
    - Bundle: the main chunk is about 851 kB (up 14 kB).
    - Not done yet: enemies are still capsules with no gun drawn (8b); their shots make tracers but no sound (no sounds yet). They don't use doors (session 11), throw grenades or flank on purpose. Cover is judged from your eye at the moment it looks, so a player who moves can catch it out of cover, which is intended.
    - Fixed after trying it on the iPhone: **a double tap zoomed Safari in** with no way back (iOS ignores `user-scalable=no`), so `app/no-zoom.ts` now cancels Safari's pinch gestures and quick second taps, except while zoomed in so you can always pinch back out; and **fall damage started too low**, so it now starts at about a 4 m drop (was 2.5 m) and still breaks legs at about 7 m and kills at about 11 m (design.md → Damage).
    - Added for a suspected aim offset that turned out fine: with `?debug`, a cyan diamond where the sim will fire and magenta diamonds where your last five shots landed, drawn over everything.
    - Deployed to Workers so it can be tested over cellular (the phone couldn't reach the Mac's dev server).
    - **To check on the iPhone:** how fights feel, especially the scav and boss skill numbers in `content/enemies/`.
- [x] **8b. Character visuals.**
  - Choose the CC0 character pack and confirm its licence; import it, recolour to flat colours, draw it unlit.
  - Named mount points for helmet, armour, backpack and weapon; equipped gear shows on the body.
  - Pose the body to match the simulation's hit-zone capsules (they're a fixed layout in the sim since session 6, not attached to bones). An animation state machine (idle, walk, run, aim, shoot, reload, death).
  - First-person arms. Distant characters update their animation less often.
  - **Notes (2026-10-26):**
    - Decided with the user: the pack is **Quaternius's Universal Animation Library (Standard)**, CC0 per the `License.txt` in the OpenGameArt download. It has one mannequin and 45 clips, pistol clips but no rifle ones, so guns are held by IK. Also decided: **the arm hit capsules moved forward** to the gun-holding pose instead of staying at the sides, where no armed pose could match them. Both in design.md; the details are in tech-stack.md → Characters.
    - Decided along the way: the chest is now two narrower capsules (wider than deep, like the torso), so it doesn't swallow forearm shots; each arm is an upper-arm and a forearm capsule. Weapons gained an optional `hold` (`rifle` or `pistol`) and enemy types an optional `outfit`; both are optional fields, so no format version change. The scav wears olive and grey, the boss dark green.
    - Asset: `scripts/build-character.mjs` builds `packages/client/public/characters/mannequin.glb` (5.8k triangles, 15 clips, 556 kB, 279 kB gzipped) from the pack; licence and source in the README beside it. The robot stand-in, its README and `perf/characters.ts` are gone, and the perf scene uses the mannequin.
    - Client: `render/character.ts` (load, bake by body part, looks with gear on mount bones, one draw call each), `render/character-body.ts` (legs and upper-body layers, strafing twist, look lean, flinch, IK gun hold from low ready to aimed, gun in hand for reloads, sprinting and distance, death, LOD, interpolation), `render/gun-model.ts` (placeholder rifle and pistol with attachments, shared with first person), first-person arms and a reload dip in `render/viewmodel.ts`, the `/bodies` viewer, and `?hitzones`. Enemy shots kick their gun; hits make them flinch.
    - Shared: the new capsule layout, `createHealth` exported, and two hit-zone tests rewritten for it. One of those had a wrong comment: the old "facing −x" yaw faces +x, which only passed because the old layout was symmetric. 160 tests pass.
    - Checked in headless Chrome: every pose in `/bodies` from front, side and top (rifle and pistol aimed and low, aiming up and down, walk, jog, sprint, strafe, backwards, crouch aimed, crouch walk, reload, dead); the test map at iPhone landscape size, where enemies walk in as bodies, fight, and the first person shows the arms and the reload dip; and the perf scene (10 mannequins, 49k triangles, 60 fps). No console errors. In play, 60 fps with 25–39 draw calls, CPU 0.5–1.1 ms per frame with three enemies.
    - Bundle: the main chunk is about 869 kB (up 18 kB); the mannequin is fetched separately.
    - Not done yet: no shoot clip is played; a shot kicks the IK'd gun instead. The rifle reload borrows the pistol clip, so the rifle points up while reloading. A sprinting or unarmed body's arms don't match the forward arm capsules. Crouched, the body leans forward a little past its capsules. From the hip, the gun hides most of the first-person arms. No backpack is drawn (there are no backpacks until session 9). Ladders play idle. The player's own body isn't drawn (it will be for co-op).
    - **To check on the iPhone:** frame rate with the bodies in a fight and in `/perf` (each body is now 5.8k triangles, the robot was 3.2k), and how the bodies and first-person arms look.
- [x] **9. Item and inventory model (shared).**
  - Item definition schemas for all item types.
  - Grid containers with item sizes and rotation, auto-placement, no nesting.
  - Equipment slots (weapon, helmet, armour, rig, backpack), the vault, quick slots.
  - Unit tests.
  - **Notes (2026-10-26):**
    - Decided with the user (all in design.md → Inventory and UI, and → Damage): **gear slots are two primaries, a sidearm (pistols only) and the knife**, plus helmet, armour, rig and backpack, with which one is in your hands in the sim; **everyone has 4×1 pockets**; and **quick slots are replaced by one heal button** (Delta Force style) that offers the treatment your state needs (bleeding → bandage, broken → splint or else surgery, lost HP → medkit), with a long press for a picker of the alternatives and greyed out when nothing's wrong. **Painkillers are punted**; the user wants temporary effects later.
    - Decided along the way (design.md): ammo is loose stacked rounds; reloading and meds draw from pockets, rig and backpack, never the vault; each bandage, splint or surgery use treats one zone in the fixed order, a medkit heals down the order skipping broken limbs and keeps the rest of its pool; a splinted limb stays at 0 HP and still spills over; no nesting means rigs and backpacks go only in gear slots, the stash and loot containers; a gun's size ignores attachments.
    - Shared: item format **3** (every item has a grid `size`; ammo a `stack`; new types `med`, `container`, `melee`, `key`, `quest`, `loot` and `repair`; migration from 2). `inventory/grid.ts` (items, grids, auto-placement, stacking, drag and drop, rotation, double-tap transfer), `sim/gear.ts` (gear slots, hand, carried ammo, stowing), `sim/meds.ts` (the heal button's choices and one use), `sim/create-item.ts`. `Character.weapon`, `helmet` and `bodyArmour` became `Character.gear`, and the gun in hand is `heldWeapon(c)`. `WeaponState.reserve` is gone: reloading takes from carried rounds. `attach` and `detach` return rounds that no longer fit. `Health` gained `splinted`. Loadouts gained optional `rigs` and `backpacks`, and spare rounds are stowed as stacks. See tech-stack.md → Inventory model. 26 new tests (186 in all), including a JSON round trip of a character's gear and an enemy reloading until its carried rounds run out.
    - Content: sizes on every item; bandage, splint, surgery kit, medkit (200 HP), chest rig (4×2 inside), small (4×4) and large (5×6) backpacks, knife, shed key (the test map's locked door now names a real key, and the content test checks door keys), cash, gold watch, armour repair kit. Scavs sometimes wear a rig or small backpack; the boss wears both. Numbers are first guesses.
    - Client: the player starts with the rifle and pistol (`?weapon` picks which is out), armour, knife, rig, small backpack, 120 + 45 rounds and a few meds, all hard-coded in `play/` until loadouts (session 13). The ammo count shows loaded / carried. Backpacks are drawn on bodies (placeholder boxes); rigs aren't drawn.
    - Checked in headless Chrome at iPhone landscape size: `/bodies` with backpacks; the test map with the rifle (30 / 120) and with the pistol and 24-round mag (24 / 45); a 30 s fight standing at the centre, where all three enemies engage and the player dies between 20 and 30 s as in session 8. 60 fps, tick 0.14–0.37 ms, 24–39 draw calls, no console errors.
    - Bundle: the main chunk is about 876 kB (up 7 kB).
    - Not done yet: nothing switches guns in play yet, and nothing uses meds except the debug heal (both session 10b). The HUD still has quick slots 1–4 for the debug keys. The knife has a slot but no attack yet (session 10b). No prices yet (session 13).
- [x] **10. Inventory and in-raid UI.** (Split on 2026-10-26: the heal button, switching guns and the knife moved to 10b; the attachment manager to 10c.)
  - Tabbed raid screen: inventory, map, quests.
  - Looting containers and bodies, double-tap auto-fit, rotating items.
  - Prototype on the phone early.
  - **Notes (2026-10-26):**
    - Decided with the user (design.md → Inventory and UI): **the raid keeps running while the screen is open** (you stand still and can be shot), so **inventory moves are sim actions** sent with the next tick's input, as a co-op server will need; **containers get a fixed test fill** until session 11 rolls loot tables; and **the attachment manager is split off to 10c**, after the grids have been tried on the phone.
    - Shared: `sim/looting.ts`: `LootContainer`s in the new `SimState.loot`; `InventoryAction` (`move`, `rotate`, `quick`) in the new optional `PlayerInput.inventory`, applied at the start of `step` with an `inventory` event each (ok or refused). Items are addressed by owner (you, a dead body, a container) plus grid and index or gear slot, together with the item id the sender saw, so a stale action fails rather than moving something else. Reach is 2 m across and up or down from your feet. `placeLootContainers` puts one at every `lootContainer` marker. New content kind **`content/loot-containers/`** (format 1: `name`, `grid`): `desk` 4×3, `cabinet` 3×4, `weapon-crate` 6×3. `rotateAt` now refuses a square item. 8 new tests (194 in all).
    - Client: the raid screen (`ui/raid.tsx`, `ui/raid-screen.tsx`, `ui/inventory-controller.ts`, `ui/drag.ts`), loaded lazily like settings (a 12 kB chunk plus React). Inventory tab: your gear slots, your pockets, rig, backpack and vault, and the open body or container; a bar about the selected item with Rotate and Take / Put in / Equip / Stow. Map and Quests tabs are placeholders. Drag and drop is plain DOM with a ghost and a green or red drop outline; a second finger (or R) turns the item mid-drag. The **use button says "loot"** with a container or dead body in reach that you're facing, and is dimmed otherwise; a new **bag button** (I or Tab on desktop) opens just your inventory; Esc, I or Tab closes it. While it's open the HUD is hidden except the health bar, the red hurt flash still shows, and the screen closes if you die. `play/loot.ts` has the test fill (household: cash, gold watch, bandage, 9 mm; military: pistol, 24-round mag, suppressor, 5.56, medkit, large backpack) and finds what's in reach. `?at=<x>,<z>` starts you at a point (on the ground, not a roof) for testing.
    - Checked in headless Chrome at iPhone landscape size, with touch events: Use turns to loot facing house C's desk; tapping it opens the desk; double-tapping cash with full pockets put it in the rig; dragging the gold watch into the backpack, and the medkit from the rig into the backpack turned 2×1 by a second finger mid-drag; on a scav killed at close range, Use said loot and double-tapping its pistol put it in Primary 2 (sidearm taken); Esc closes and I opens and closes. `/perf` at 60 fps and `/bodies` load. No console errors.
    - Bundle: startup is the main chunk plus a shared chunk Vite now splits out, about 884 kB together (up 8 kB).
    - Not done yet: no dropping items on the ground (loose items come with loot spawns, session 11); no search time for containers; item names are cut short in 1×1 cells (icons come with the item editor); the vault is below the fold in its column on a phone and needs a scroll. A looted body redraws without what was taken (its mesh is rebuilt when its gear changes).
    - **To check on the iPhone:** the whole screen, especially dragging with a thumb (does the ghost hide under it?), the second-finger rotate, the cell size (38 px), and whether the columns scroll comfortably.
- [ ] **10c. Attachment manager.** (Split from session 10 on 2026-10-26.)
  - In the inventory: tap a gun to see its optic, muzzle and magazine slots; drag attachments on and off, or pick from those you carry that fit. As inventory actions in the sim, like session 10's.
  - Stowing the rounds a smaller magazine hands back (`attach` and `detach` already return them).
  - Remove the debug "optic" and "muzzle" actions (keys 9 and 0, the `?debug` buttons) that cycle attachments, once this replaces them.
- [x] **10b. Heal button, switching guns and the knife.**
  - **The heal button** (replaces the quick slots, decided in session 9): a tap uses `treatments()`'s first choice, a long press opens the picker, greyed out when there's nothing to do. The heal progress ring, slow walking while healing, cancelling on firing or sprinting, and the use time in the sim. Remove the quick-slot buttons (move the debug keys elsewhere).
  - **Switching guns**: a button (or buttons) for primary 1, primary 2, sidearm and knife, a draw time, the draw animation, and the viewmodel following the gun in hand. Running is slightly faster with the knife out.
  - **The knife attack** (decided 2026-10-26, see design.md → Core loop → Knife): Tarkov-style, good damage, for close quarters and raids with no gear. A swing in the sim against the hit zones (armour absorbs it), its HUD use of the fire button, first-person and body animations, and AI taking knife hits like shots (flinch, alert). Tune the swing time against the scavs' reaction time on the phone.
  - **Notes (2026-10-26):**
    - Decided with the user (design.md → Inventory and UI, and → Core loop → Knife): **four slot buttons** for switching, where the quick slots were (rather than one swap button), and **the knife swings by itself with automatic fire on** when an enemy is in reach under the crosshair.
    - Decided along the way (all in design.md): each heal tap is one use; using caps walking at 1.5 m/s and lowers the gun; firing, sprinting, reloading, switching, a ladder or a second tap stops it with nothing used; **auto-fire never fires while using a med**, so only the fire button cancels; a swing lands at once and forgives aim by 10° either way; swings are silent; the knife is ×1.1 on walking and sprinting; you can't fire, aim or reload until drawn.
    - Shared: item format **4** (weapons' `drawTime`; the knife's `damage`, `bleedChance`, `swingTime`, `reach`, `drawTime`; migration from 3). `Character.draw`, `swing` and `using`; `PlayerInput.draw` and `use`; `switchHand` takes the draw time; `startUse` and `updateMedUse` in `sim/meds.ts`; `sim/melee.ts` (`updateMelee`, the `swing` event); `shootCharacter` takes a `Wound` and a cause. See tech-stack.md → Hands, meds and the knife. 11 new tests (205 in all): draw time before firing and aiming, knife speed, knife hits through armour at its pace, out of reach, through a wall and within the fan, a med's use time and slow walk, each way of stopping it, a stale press and a moved med, a JSON round trip mid-heal and mid-draw, an enemy knifed from behind going alert and flinching, and the 3 → 4 migration.
    - Client: `hud/hands.ts` (slot buttons with icons, the heal button with its choice, progress ring and long-press picker; "knife" on the fire button; aim and reload dimmed without a gun); the first-person knife, the draw-up, lowering while healing and the slash in `render/viewmodel.ts`; the body holding the knife, slashing by IK, and arms down while drawing or using a med; `/bodies` poses for a med, the knife and a slash. Quick slots are gone: `?debug`'s hurt, heal, optic and muzzle are buttons down the left edge and keys 7–0. Desktop: 1–4 switch, H heals, Shift+H opens the picker.
    - Checked in headless Chrome at iPhone landscape size, with touch: the heal button greyed at full health, "bandage" after the debug hurt, a tap fills the ring and walking slows; holding it opens the picker (bandage, splint, medkit with HP left) and picking the medkit starts it; tapping fire stops it; slot 4 brings the knife up, the fire button says "knife" and a tap slashes; slot 3 brings the pistol up from below; an empty slot 2 is empty hands. `/bodies` with the new poses. No console errors. 60 fps on the test map, CPU 0.9–1.3 ms per frame. `/perf` showed 30 fps in headless Chrome even with no characters at dpr 1, so that's the headless browser capping frames there, not load.
    - Bundle: startup is about 894 kB (up 10 kB).
    - Not done yet: no sounds for swings or meds. Enemies never switch weapons, heal or use knives. The knife and the arms are placeholders (session 18); the body holds the knife in the pistol idle pose. A sprinting body's arms still don't match the capsules (from 8b).
    - **To check on the iPhone:** the knife against scavs' 0.7 s reaction (sneaking up crouched, and round a corner), whether the 10° fan feels fair or too generous, the slot buttons' size and reach for a thumb, the long press (400 ms) on the heal button, and the picker's position.

- [ ] **11. Raid lifecycle and loot.**
  - Raid config format, including a timer (15 minutes by default) and a random player spawn (co-op players together).
  - Loot tables rolled at raid start.
  - **Looting bodies** (moved from session 8): a dead enemy's gun, armour and rolled loot, through session 10's inventory screen. **Enemy loot weighting**: an enemy spawn's `lootWeights` multiply its loot table's weights (the yard boss has `military: 2`).
  - Extraction points; doors and keys. Doors are loaded and drawn since session 4 but don't collide: add them as solids that move, in the simulation state.
  - **AI opens doors** (decided 2026-10-26, see design.md → AI → Doors): open or closed in the sim with collision snapping, the swing animated only in the renderer; closed unlocked doors stay nav links that enemies open on arrival; no noise. Enemies never open locked doors, even with the key, but once a player unlocks one it stays unlocked for the raid and enemies can use it. Recompute the nav components after an unlock (about 11 ms on the Mac; see tech-stack.md → Navigation for the cheaper fallback if it hitches on the phone).
  - Results screens for death and extraction (vault and knife kept).
  - SVG map tab with your position and named zones.
  - *Done when* one complete solo raid on the test map works on the phone with nothing but local state.

## Milestone C: the meta loop and server
- [ ] **12. Server foundation.**
  - Hono with D1; decide the login method.
  - Accounts and sessions; profile, stash and vault persistence; raid start and end endpoints with sanity limits.
  - Client integration, plus offline handling (what happens if a raid ends while the phone is offline).
- [ ] **13. Main menu, stash and vendors.**
  - Stash screen (reuses the inventory UI), loadout, buying and selling, vendor stock and prices, starting kit, always-kept knife, armour repair kits.
- [ ] **14. Quests.**
  - Quest definitions as data; accept, progress and complete.
  - Investigate markers (visible through walls, with distance), extract-with-item, quest-only item spawns, rewards.

## Milestone D: editors
- [ ] **15. Map editor 1: core editing.**
  - `/editor` route (dev server only), save plugin writing to `content/`.
  - Camera, placing primitives, adjustable grid snap, angle snap, "match rotation", snapping down to surfaces.
  - Selecting and grouping, deleting whole groups, undo/redo, ground layer locked.
- [ ] **16. Map editor 2: terrain and prefabs.**
  - Terrain raise and lower brushes, water level, automatic concrete bases.
  - Saving and placing prefabs (by reference, with recolouring).
  - Overlap warnings, buildings blocked from overlapping each other.
- [ ] **17. Map editor 3: gameplay.**
  - Markers: spawns (enemy type, loadout, loot weighting), loot containers and spawn points, extraction points, quest markers, doors and keys, named zones, stairs and ladders.
  - Navigation overlay with the unreachable-spot highlights.
  - Play-test button.
- [ ] **18. Item editor.**
  - Stats forms for all item types; grid size.
  - Model builder from simple shapes; attachment mount points and sight line.
  - Reticle designer and zoom level for optics. Med item settings (use time, HP pool, what they fix).

## Milestone E: content and release
- [ ] **19. The first real map and content set.**
  - Build the map in the editor. Items, prefabs, loot tables, enemies and a boss, quests, vendors.
  - Sound effects (decide where they come from).
- [ ] **20. Polish and v1 release.**
  - Performance pass on the phone, balance pass, bug fixes.
  - Deploy, install from the home screen, play-test with a friend.

## After v1 (not scheduled)
- Co-op vs. AI (Durable Object raid server, client movement prediction, shared loot rolls, quest items only for the holder).
- Weekly admin challenges (raid configs, publishing from the server without a redeploy).
- NPC flea market (explain it and decide first). Trading with friends.
- Grenades for AI (with a shared token), gyro aiming, water slowing movement, more attachment slots.

## Open questions
- Login method (session 12). Sound effect source (session 19).
- **Container search time** (session 10): Tarkov reveals a container's items one by one. Not designed; containers open instantly for now.
- **Melee** (raised in session 9; the user's answer, 2026-10-26): there is a Tarkov-style knife attack with good damage, for raids where you bring nothing at all and for close quarters (design.md → Core loop → Knife). Built in session 10b.
- **Temporary effects** (the user wants them, 2026-10-26): painkillers and similar. Not scheduled.
