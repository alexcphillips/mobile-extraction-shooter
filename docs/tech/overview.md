# Tech stack: Overview

Part of the [tech-stack.md index](../tech-stack.md). Record decisions here, in the topic they belong to.

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
content/     # JSON game data: maps, prefabs, items, loot tables, quests, vendors, enemies, zombies modes
docs/
```

## Raid lifecycle
Session 11, `sim/raid.ts`. See design.md → Raids and maps → Extraction.
- `SimState.raid` (`RaidState`: the tick the timer runs out on, and the extraction points from the map's extraction zones since map format 4; before, its markers) is set by `startRaid`, and null outside a raid (tests, the perf scene), where nothing below happens. `Character.extracting` counts the seconds a player has stood in an extraction point (within its radius across, and `RAID.extractHeight` up or down).
- `updateRaid` runs last in `step`, after the tick count goes up. A living player who reaches `RAID.extractTime` (7 s) leaves; when the timer runs out, every living player still in the raid leaves as missing in action. **A player who leaves is taken out of `state.entities`** and kept in `state.left` (`LeftRaid`: the character with all its gear, how, where, and the tick), with a `leave` event. So nothing can shoot or follow them, and enemies who were after them calm down (they already handle a target that no longer exists). Enemies never leave. The dead stay in `entities` as bodies.
- `gearItems(gear)` lists everything a character carries; `keptItems(gear, survived)` is what a player keeps (everything after extracting; otherwise the knife and the vault). Session 12's raid end will send these.

## Hosting and testing
- **One Worker serves both the client and the API** (decided 2026-10-26, session 1). The built client is the Worker's static assets (`packages/server/wrangler.jsonc` points at `packages/client/dist`). Only `/api/*` runs Worker code; any other unknown path falls back to `index.html`. Sharing one origin means no CORS, and session cookies work with no extra setup. Pages was the alternative; Cloudflare is moving new projects to Workers static assets anyway.
- In dev, the client (Vite, port 5180) and the Worker (`wrangler dev`, port 8787) run separately, and Vite proxies `/api` to the Worker. `wrangler dev` refuses to start if the assets folder is missing, and `dist` is gitignored, so the server's `predev` creates an empty `packages/client/dist` (decided 2026-10-30). A fresh clone runs `npm run dev` without building first.
- **Phone testing during development:** run `vite --host` and open it on the iPhone over the local network. When HTTPS is needed (installing as a home-screen app, some browser features), use a Cloudflare preview deployment or a `cloudflared` tunnel.
- Each milestone ends with a performance check on the real iPhone (FPS counter in dev builds).
- **Screenshots for Claude (2026-11-09, the user's request):** `npm run look -- [--phone] [--click <selector>]... --out <file.png>` (`scripts/look.mjs`) opens the dev server in headless Chromium (Playwright, a dev dependency), signs in as the local test account `claude-test` (registered on first use, on the local dev database only; the script refuses any host that isn't this machine or the LAN), does the clicks and saves a screenshot. `--phone` is an iPhone 15 held sideways (touch, no hover), which the inventory lays out differently from a PC; `--fresh` uses a new account with a new character's kit. It needs `npm run dev` (both servers) running, and `npx playwright install chromium` once per machine. It's for looking at UI, not a replacement for testing on the real iPhone.

## Characters (confirmed, see design.md → Characters)
- The base body is a rigged, animated low-poly humanoid from a CC0 pack in glTF format. Recolor it to flat colors and draw it unlit, so it matches the map.
- Gear (helmet, armor, rig, backpack, weapon) is built in the item editor and attached to the skeleton at named mount points (`MOUNTS`: rigs on the armor's bone). Rigs are drawn since session 18b.
- Hit zones are simple capsules, not tests against the mesh itself. **They're a fixed layout in the simulation, not attached to bones** (changed 2026-10-26, session 6, so a co-op server needs no skeleton); the body is drawn to match.
- Distant characters update their animation less often to save performance.

Built in session 8b:
- **The asset:** `packages/client/public/characters/mannequin.glb`, from Quaternius's Universal Animation Library (Standard, CC0; license and source in the README next to it). `scripts/build-character.mjs` builds it from the pack's GLB with glTF Transform and meshoptimizer: 15 clips kept, UVs dropped, the mesh simplified from 13.7k to 5.8k triangles, only rotation tracks kept (plus the hips' translation). 556 kB, 279 kB gzipped, fetched at startup rather than bundled. Quaternius's site moved new downloads to its own license (QAL, August 2026), which forbids redistributing the files; this copy is CC0, but check before adding later downloads to the public repo.
- **One draw call per character, gear included** (`render/character.ts`). At load, the body is baked into flat triangles with face normals; each face takes the outfit part of the bone that weighs on it most (joint bands 20% darker). Each look (outfit, worn items, gun) is one geometry, built once and cached, with gear bound rigidly to its mount bone. Shading happens on the GPU from the skinned normal, with the same formula as the map. Bodies cull by a fixed sphere, since animation moves them far from their rest-pose bounds.
- **Animation** (`render/character-body.ts`): two layers, legs and upper body, from clips split by bone. The legs pick idle, walk, jog, sprint, crouch, crouch walk, jump or death by speed and stance, paced to the speed. When strafing, the hips turn towards where it's going (up to about 70°) and the chest turns back to face forward; going backwards plays the clip in reverse. The upper body leans with the look pitch and flinches when hit. **Leaning** (2026-11-01) turns the lower and upper spine (60/40) about the body's forward axis by the sim's lean angle, smoothed, and cants the gun by the same angle; the IK'd arms follow the shoulder. `CapsuleBody` tips its upper capsules about the same pivot, so `/bodies` (poses "lean left/right aimed", "crouch lean right") and `?hitzones` show them matching. **Gun hold by IK:** a two-bone IK per arm, with the hand rotations measured once from the pistol aim clip. The gun's position and tilt per hold are in `HOLD` there.
- **three.js's mixer only writes a bone when its clip value changes**, so posing on top of clips must put each bone back to its clip rotation before every update; otherwise turns pile up frame after frame. `CharacterBody` does this for the bones it poses.
- **LOD:** a body animates every frame within 20 m, every 2nd frame to 45 m, every 4th beyond, and every 8th off screen. It uses IK within 30 m; beyond that the gun goes in the hand. The dead stop animating 3 s after falling. Positions and yaw are interpolated between ticks.
- `/bodies` shows every pose with the hit zones over them, and `?hitzones` does the same in play.

## Still open
- Nothing at the moment.
