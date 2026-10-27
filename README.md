# mobile-extraction-shooter

A small Tarkov-style PvE extraction shooter for the iPhone, played as a mobile web game. See [CLAUDE.md](CLAUDE.md) and [docs/](docs/).

## Setup
Node 22+ and npm 11+.
```sh
npm install
```
npm 11 only runs install scripts you've approved. They're listed under `allowScripts` in `package.json` (esbuild, workerd). If an upgrade changes their versions, `npm install` warns; review with `npm install-scripts ls` and re-approve with `npm install-scripts approve <pkg>`.

## Commands (from the repo root)
| Command | What it does |
|---|---|
| `npm run dev` | Client (Vite, port 5180) and Worker (`wrangler dev`, port 8787) together. Vite proxies `/api` to the Worker. |
| `npm run dev:client` / `npm run dev:server` | Just one of them. |
| `npm run db:migrate -w @mes/server` | Builds or updates the local D1 database (under `packages/server/.wrangler`). Run it once before the first `dev`, and after adding a migration. |
| `npm test` | Vitest, all packages. `npx vitest` for watch mode. |
| `npm run check` | Typecheck, lint, Prettier check and tests. Run before committing. |
| `npm run format` | Prettier, write mode. Markdown is excluded. |
| `npm run build` | Builds the client into `packages/client/dist`. |
| `npm run deploy` | Builds the client, then deploys the Worker (which serves the client as static assets). |

## Testing on the iPhone
**Over the local network (everyday):**
1. Put the Mac and the iPhone on the same Wi-Fi.
2. `npm run dev`. Vite prints a `Network:` URL, such as `http://192.168.1.74:5180/`. (`ipconfig getifaddr en0` shows the Mac's IP.)
3. Open that URL in Safari on the phone. The status line in the top-left should say "hello from the Worker".

If the phone can't connect, check that the macOS firewall allows incoming connections for `node` (System Settings → Network → Firewall).

The port is fixed at 5180 with `strictPort`, so if something else is using it, Vite exits instead of silently moving to another port.

**Over HTTPS (Add to Home Screen, and browser features that need a secure context):** use the deployed URL, or tunnel the dev server with `cloudflared tunnel --url http://localhost:5180`.

## Playing a map (session 4)
The client opens into a map from `content/maps` (`test-map` by default) and lets you walk around it with the shared simulation. There's no raid yet.

**Shooting (session 6):** you start with an assault rifle, 120 spare rounds, a steel helmet and a plate carrier. Every enemy spawn on the map holds a **target dummy**: its hit-zone capsules, each coloured by its HP (green, yellow, red; black when broken), with boxes for armour coloured by durability. The yard boss wears armour. Dummies stand still, and get up again 6 s after dying. With **automatic fire** on (the default), the gun fires by itself while the crosshair is on a dummy. Health, broken limbs, bleeding and armour are at the top centre; ammo at the top right.

**Touch controls (session 5):** drag on the left half for the move stick and on the right half to look. Push the stick to its rim to sprint, and drag it on up into the **sprint** zone to lock sprinting, then let go. To stop, pull the stick back or tap the left half; aiming or crouching stops it too. Dragging on the **fire** button also looks. Aim zooms a little and slides the gun to the middle (hold, or toggle in settings). Firing stops a sprint and ends sprint lock. **Use** loots a container or body in reach, and **bag** opens your inventory. In the inventory, select a gun to see its optic, muzzle and magazine slots in the bottom bar: drop attachments on them (or straight on a gun), drag them off (into a grid or onto another gun), tap a slot to pick from what fits, or double-tap one to take it off.

**Weapons and meds (session 10b):** the four buttons along the bottom take out primary 1, primary 2, the sidearm or the knife (dimmed when empty, outlined when in hand); drawing takes a moment. With the knife out, **fire** says "knife" and swings it (and, with automatic fire on, it swings by itself when an enemy is in reach under the crosshair). The **heal** button shows the med a tap would use (bandage for bleeding, then splint or surgery for a broken limb, then medkit) and is greyed out when nothing helps; a ring fills while it works. Tap it again to stop; firing, sprinting, reloading or switching also stops it. Hold it for a picker of every carried med that would help.

**Desktop keys:** WASD, Shift sprint, Space jump, C crouch, F fire, Q aim, R reload, E use or loot, I or Tab the bag, 1–4 primary 1, primary 2, sidearm, knife, H heal (Shift+H the picker), and mouse drag to look.

**Settings** (gear, top right) pause the game: aim and fire behaviour, aim assist, sensitivity, invert, the stats overlay, and **Edit button layout** (drag buttons, size them with − and +, then Done). Settings are saved in the browser's local storage. Holding the phone upright shows a "turn your phone" screen and pauses.

**Home screen:** open the HTTPS URL (deployed or tunnelled, see above) in Safari, then Share → Add to Home Screen. Launched from there, it runs without browser UI and the stats header says `standalone` instead of `browser`.

**Raids need the Worker** (session 12b): the play page signs you in, starts the raid on the server and wears your account's gear, so run `npm run dev` (both), not just the client. `?weapon` and `?attach` are gone; change what you carry in the stash instead.

**Main menu (session 13):** after signing in the game opens on the menu: **Start raid**, **Stash and loadout** and **Settings**. The stash page is the raid inventory beside your stash (pages of 10×30; more are bought with **+ Page**, a second tap confirms): double-tap moves between your gear and the stash, drag places, and every change is saved to the server a moment later ("Saved" in the top bar). Starting a raid waits for the save. The results screen's **Continue** goes back to the menu. There's no way to earn money until vendors (13b); to try buying pages locally, `npx wrangler d1 execute mes --local --command "UPDATE profiles SET data = json_set(data, '$.money', 400000)"` in `packages/server`. A raid left mid-way (the app backgrounded and unloaded, or closed) is resumed at the next start.

**URL parameters:** `?raid=<id>` picks the raid the menu starts from `content/raids` (default `test-raid`, on the test map), `?time=<seconds>` sets its timer (to try running out of time), `?at=<x>,<z>` starts you at a point (on the ground, not a roof), `?spawn=<id>` a player spawn in its map (otherwise one is picked at random; the test map has `spawn-centre` and `spawn-north`), and `?debug` adds buttons down the left edge (and keys 7 and 8) for "hurt" (a 5.56 round to a random zone, armour and bleeding included) and "heal" (everything, at once), and shows markers as coloured posts (blue player spawn, red enemy spawn, yellow loot container, orange loot spawn, green extraction with its radius, purple quest marker), named zones as white outlines, patrols as pink lines with a ring at each stop, and what each enemy is thinking: a gem over its head (grey unaware, yellow suspicious, red alert, orange searching), the edges of its view, its path, and a cross where it thinks you or a noise are. It also draws a cyan diamond where the simulation will fire (its own look and recoil, without spread) and magenta diamonds where your last five shots landed, over everything, so you can check they line up with the crosshair. `?nav` draws the navigation grid: green where enemies can walk, orange on islands they can't reach (roofs, crate tops). Enemies get their type's skill and a loadout rolled from `content/loadouts`, and the dead stay down: `?respawn` brings them back at their spawn after 6 s with a new loadout, and `?peaceful` sends them in unarmed (they notice you and close in, but can't shoot). `?hitzones` draws the simulation's hit-zone capsules see-through over enemies' bodies. The stats overlay is the same as the perf test's, plus how long the nav grid took to build and how many enemies are on edge.

**The test map** (`content/maps/test-map.json`, 192 m square): straight ahead of `spawn-centre` is the movement playground from session 3 (a 3 m platform with stairs and a ladder, a 0.4 m step, a 1 m box to mantle, a 1.4 m wall, a beam to crouch under). To the west are two houses and to the east a third, all one prefab in different colours. To the south-east are a shipping container with a ramp, a shed with a locked door, and crates. To the north-east is a pond with a dock. Trees are on the hills around the edge. **Enemies (session 7):** a scav spawns near the playground and patrols back and forth past the west houses, another walks back and forth into the shed, and the yard boss (in armour) guards the storage yard. They notice and follow you but don't shoot yet, and come back 6 s after dying.

**Content files** are JSON, validated on load and in `npm test` (every map is loaded and compiled, and every item loaded with its references checked). Items (weapons, ammo, armour, attachments) are in `content/items`, described in the comments in `packages/shared/src/content/items.ts`. The format is described in [docs/tech-stack.md](docs/tech-stack.md#map-and-prefab-format) and in the comments in `packages/shared/src/content/schema.ts`. Saving a file reloads the page in dev.

## Perf test (session 2)
Open `/bodies` to see every pose the character body has side by side (rifle and pistol at the low ready and aimed, aiming up and down, walk, jog, sprint, strafing, backwards, crouched, reloading, dead, unarmed), with the hit zones drawn over them. `?focus=<n>` shows one body from the front, side and top; `?view=front|side|back|top` picks one view; `?zones=0` hides the hit zones; `?t=<seconds>` stops time there, for repeatable screenshots.

Open `/perf` (for example `http://192.168.1.74:5180/perf`): about 2,000 boxes merged per 32 m chunk, fog, 10 animated characters wandering, raycasts every tick, and a stats overlay.

**Controls:** the same as on maps (see above). The dot in the middle turns red when the aim ray hits something.

The movement playground that was at the perf scene's spawn in session 3 is now in the test map.

**Stats overlay:** fps; average and worst frame time over the last 0.5 s; `janks`, frames over 20 ms (each one missed a 60 Hz vsync), as a total since the first 3 s and as a count for the last full 10 s; CPU time per frame and per simulation tick; draw calls, triangles and the canvas resolution.

**Preset buttons** (top right) reload the page with common stress settings: no characters (to isolate their cost), 30 characters, 6,000 boxes, pixel ratio 3, or all three. They're just shortcuts for these **URL parameters**, which find the limits without rebuilding (for example `/perf?boxes=4000&chars=30&dpr=3`):
| Param | Default | What it changes |
|---|---|---|
| `boxes` | 2000 | Boxes in the world. |
| `chars` | 10 | Animated characters. |
| `rays` | 100 | Extra random raycasts per tick (on top of the aim ray and one line-of-sight ray per character). |
| `dpr` | min(devicePixelRatio, 2) | Render pixel ratio. iPhones are 3. |
| `aa` | 1 | `aa=0` turns antialiasing off. |
| `fog` | 120 | Fog and far-plane distance in metres. |

Turn off Low Power Mode when measuring: iOS caps Safari at 30 fps in it.

## Deploying
`npm run deploy` (wrangler must be logged in: `npx wrangler login`, check with `npx wrangler whoami`). It's one Worker, `mobile-extraction-shooter`, on workers.dev. Only `/api/*` runs Worker code; every other path is served from the built client, falling back to `index.html`.

**The database** is D1 `mes` (its id is in `wrangler.jsonc`, created 2026-10-27). Deploying applies any new migrations in `packages/server/migrations` remotely first.
