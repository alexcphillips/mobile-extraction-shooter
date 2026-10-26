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
- [ ] **6. Weapons and damage.**
  - Hitscan shooting, hit zones and multipliers, armour % absorption and durability, limb HP, spillover to the chest, broken-limb effects, bleeding, death.
  - **Fall damage** (agreed 2026-10-26): to the legs from the landing speed, which the sim already knows.
  - Weapon stats and simple recoil; reloading from carried ammo.
  - Attachment slots (optic, muzzle, mag): stat changes, full-screen zoom with scope mask, red-dot reticles, suppressor hearing radius.
  - HUD: health bar, status icons, armour icon colours.
- [ ] **7. AI part 1: navigation and perception.**
  - Generate the multi-layer navigation grid (stairs, no ladders); A*.
  - Patrol routes. Sight cones with line of sight; hearing (shot radius, suppressors).
  - Awareness states. A debug navigation overlay in the game.
- [ ] **8. AI part 2: combat.**
  - Engage, take cover, hold angles, search after losing you.
  - Handle an unreachable player (break line of sight, hold, give up).
  - Bosses as enemy types. Enemy spawn points with loadout rolls and loot weighting. Bodies can be looted.
- [ ] **8b. Character visuals.**
  - Choose the CC0 character pack and confirm its licence; import it, recolour to flat colours, draw it unlit.
  - Named mount points for helmet, armour, backpack and weapon; equipped gear shows on the body.
  - Hit-zone capsules attached to bones. An animation state machine (idle, walk, run, aim, shoot, reload, death).
  - First-person arms. Distant characters update their animation less often.
- [ ] **9. Item and inventory model (shared).**
  - Item definition schemas for all item types.
  - Grid containers with item sizes and rotation, auto-placement, no nesting.
  - Equipment slots (weapon, helmet, armour, rig, backpack), the vault, quick slots.
  - Unit tests.
- [ ] **10. Inventory and in-raid UI.**
  - Tabbed raid screen: inventory, map, quests.
  - Looting containers and bodies, double-tap auto-fit, rotating items, attachment manager.
  - Using quick slots, the heal progress ring, slow walking while healing and cancelling.
  - Prototype on the phone early.
- [ ] **11. Raid lifecycle and loot.**
  - Raid config format, including a timer (15 minutes by default) and a random player spawn (co-op players together).
  - Loot tables rolled at raid start.
  - Extraction points; doors and keys. Doors are loaded and drawn since session 4 but don't collide: add them as solids that move, in the simulation state.
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
