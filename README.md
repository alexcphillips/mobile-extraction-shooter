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
The client opens into a map from `content/maps` (`test-map` by default) and lets you walk around it with the shared simulation. There's no combat or raid yet.

**Touch controls (session 5):** drag on the left half for the move stick and on the right half to look. Push the stick to its rim to sprint, and drag it on up into the **sprint** zone to lock sprinting, then let go. To stop, pull the stick back or tap the left half; aiming or crouching stops it too. Dragging on the **fire** button also looks. Aim zooms a little (hold, or toggle in settings); fire, reload, use and the quick slots 1–4 only light up for now.

**Desktop keys:** WASD, Shift sprint, Space jump, C crouch, F fire, Q aim, R reload, E use, 1–4 quick slots, and mouse drag to look.

**Settings** (gear, top right) pause the game: aim and fire behaviour, aim assist, sensitivity, invert, the stats overlay, and **Edit button layout** (drag buttons, size them with − and +, then Done). Settings are saved in the browser's local storage. Holding the phone upright shows a "turn your phone" screen and pauses.

**Home screen:** open the HTTPS URL (deployed or tunnelled, see above) in Safari, then Share → Add to Home Screen. Launched from there, it runs without browser UI and the stats header says `standalone` instead of `browser`.

**URL parameters:** `?map=<id>` picks the map, `?spawn=<id>` a player spawn in it (otherwise one is picked at random; the test map has `spawn-centre` and `spawn-north`), and `?debug` shows markers as coloured posts (blue player spawn, red enemy spawn, yellow loot container, orange loot spawn, green extraction with its radius, purple quest marker) and named zones as white outlines. The stats overlay is the same as the perf test's.

**The test map** (`content/maps/test-map.json`, 192 m square): straight ahead of `spawn-centre` is the movement playground from session 3 (a 3 m platform with stairs and a ladder, a 0.4 m step, a 1 m box to mantle, a 1.4 m wall, a beam to crouch under). To the west are two houses and to the east a third, all one prefab in different colours. To the south-east are a shipping container with a ramp, a shed with a locked door, and crates. To the north-east is a pond with a dock. Trees are on the hills around the edge.

**Content files** are JSON, validated on load and in `npm test` (every map is loaded and compiled). The format is described in [docs/tech-stack.md](docs/tech-stack.md#map-and-prefab-format) and in the comments in `packages/shared/src/content/schema.ts`. Saving a file reloads the page in dev.

## Perf test (session 2)
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
