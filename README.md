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

## Perf test (session 2)
The client currently opens straight into the performance test scene: about 2,000 boxes merged per 32 m chunk, fog, 10 animated characters wandering, raycasts every tick, and a stats overlay.

**Controls:** drag on the left half for the move stick (push to the rim to sprint), drag on the right half to look. On desktop, WASD + Shift and mouse drag. The dot in the middle turns red when the aim ray hits a box.

**Stats overlay:** fps; average and worst frame time over the last 0.5 s; `janks`, frames over 20 ms (each one missed a 60 Hz vsync), as a total since the first 3 s and as a count for the last full 10 s; CPU time per frame and per simulation tick; draw calls, triangles and the canvas resolution.

**Preset buttons** (top right) reload the page with common stress settings: no characters (to isolate their cost), 30 characters, 6,000 boxes, pixel ratio 3, or all three. They're just shortcuts for these **URL parameters**, which find the limits without rebuilding (for example `/?boxes=4000&chars=30&dpr=3`):
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
