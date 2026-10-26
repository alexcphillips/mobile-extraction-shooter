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
- **Seeded RNG** for loot rolls, enemy loadouts and AI decisions.
- **Collision:** written in-house, no physics engine:
  - A capsule for the player and AI, against rotated boxes, the terrain height grid and stair ramps.
  - **Solids rotate about Y only** (session 3). A standing capsule against a solid is then a circle against a rectangle in XZ plus a height overlap: simple and robust. A tilted primitive in the editor is decorative or gets a Y-only collision box.
  - Ramps are wedges (solid underneath). Stairs are drawn as steps but collide as a ramp.
  - Terrain cells are two triangles split along the diagonal from (i+1, j) to (i, j+1). The renderer must use the same split, or feet float or sink.
  - The character controller is kinematic. It pushes out of walls horizontally (ignoring anything at or below step height), then follows the ground up steps and down slopes, or falls. When landing, it looks for surfaces between the old and new feet, so fast falls don't tunnel through thin floors.
  - A spatial hash (`StaticGrid`, 4 m cells) for the static solids; raycasts walk its cells in order.
  - Raycasts for hitscan and line of sight, against solids and terrain, with the hit normal. Queries reuse scratch space and allocate nothing.
- **Navigation:** a navigation grid with multiple layers (floors), generated from the map data. It links stairs and slopes, but not ladders. A* pathfinding.
- **Schemas:** zod schemas for all content. Every content file has a `formatVersion`, and old versions are upgraded by migrations when loaded.
- **Tests:** Vitest unit tests for rules (damage, armour, inventory placement, loot rolls, migrations).

## Client (`packages/client`)
- **Build tool:** Vite + TypeScript.
- **3D rendering:** plain three.js, not React Three Fiber, so the game loop and rendering stay outside React.
  - Static map geometry is **merged per chunk**. Repeated props use instancing.
  - Colour is stored per vertex, with each face direction shaded differently; materials are unlit (`MeshBasicMaterial`); distance fog.
  - The camera's far plane follows the fog distance.
- **UI:** React DOM overlays for menus, inventory, settings and the editors.
  - The HUD doesn't re-render through React every frame. Values that change every frame are written straight to the DOM, or throttled to about 10 Hz.
- **Input:** Pointer Events for the virtual sticks and buttons. The layout is stored in settings.
- **Settings:** stored locally first; synced to the account once the server exists.
- **PWA:** web app manifest and standalone display mode, plus the Safari workarounds in design.md.
- **Audio:** Web Audio API, unlocked on the first tap.

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
- The base body is a rigged, animated low-poly humanoid from a CC0 pack in glTF format (for example Quaternius). **Check the licence in the session that imports it.** Recolour it to flat colours and draw it unlit, so it matches the map.
- Gear (helmet, armour, backpack, weapon) is built in the item editor and attached to the skeleton at named mount points.
- Hit zones are simple capsules attached to the skeleton's bones, not tests against the mesh itself.
- Distant characters update their animation less often to save performance.

## Still open
- Login method (username and password vs. invite codes vs. magic links). Decide in the server session.
- Where sound effects come from (CC0 packs vs. generated). Decide in the content session.
