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
- [ ] **3. Simulation core.**
  - Fixed-tick loop, entity model, serialisable inputs and state, seeded RNG.
  - Capsule against rotated-box collision, terrain height grid, stair ramps, ladders, raycasts, spatial hash.
  - Player movement: walk, sprint, crouch if wanted, climbing ladders.
  - Unit tests.
- [ ] **4. Map format and loader.**
  - zod schema with `formatVersion` and migrations: terrain height grid, water level, primitives, prefabs by reference, markers, named zones, doors.
  - Loader: merged chunks, instancing, per-face shading, fog.
  - A hand-written test map in `content/maps/`.
- [ ] **5. Touch controls and HUD shell.**
  - Virtual stick and look, buttons for fire, aim, reload, interact and quick slots.
  - Settings screen: adjustable and saved layout, radio buttons for aim and fire behaviour, aim assist level.
  - Portrait overlay that pauses, audio unlock, PWA manifest and standalone mode.
- [ ] **6. Weapons and damage.**
  - Hitscan shooting, hit zones and multipliers, armour % absorption and durability, limb HP, spillover to the chest, broken-limb effects, bleeding, death.
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
  - Extraction points; doors and keys.
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
