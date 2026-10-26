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
- [ ] **1. Monorepo scaffold.**
  - pnpm workspaces (`shared`, `client`, `server`), TypeScript, ESLint and Prettier, Vitest.
  - A Vite client showing an empty three.js scene, and a "hello" Worker.
  - Deploy both to Cloudflare. Document dev commands and how to test on the phone over the local network.
  - *Done when* the deployed URL opens on the iPhone and the Worker responds.
- [ ] **2. Performance test on the phone.**
  - A test scene with about 2,000 boxes merged per chunk, per-face shading, fog, about 10 **animated low-poly characters from a CC0 pack** wandering, raycasts every tick, basic touch move and look, and an FPS counter.
  - *Done when* it holds a steady 60 fps on the user's iPhone (or we know where the limit is and record it here). **This is the go/no-go gate for the whole approach.**

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
- Confirm the character appearance proposal (design.md → Characters).
- Login method (session 12). Sound effect source (session 19).
