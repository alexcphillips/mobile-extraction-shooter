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
- **Fixed 30 Hz tick:** `step(state, inputs) -> state`. The renderer interpolates between ticks.
- **Serialisable inputs and state.** This is what lets co-op run the same code on the server later. Bit-exact determinism isn't needed (the server is authoritative in co-op).
- **Seeded RNG** for loot rolls, enemy loadouts and AI decisions.
- **Collision:** written in-house, no physics engine:
  - A capsule for the player and AI, against rotated boxes, the terrain height grid and stair ramps.
  - A spatial hash for broad-phase checks.
  - Raycasts for hitscan and line of sight.
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
- The client is hosted on Cloudflare (Pages, or Workers static assets) on the same account as the server.
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
