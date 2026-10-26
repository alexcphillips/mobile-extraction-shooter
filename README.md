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

## Deploying
`npm run deploy` (wrangler must be logged in: `npx wrangler login`, check with `npx wrangler whoami`). It's one Worker, `mobile-extraction-shooter`, on workers.dev. Only `/api/*` runs Worker code; every other path is served from the built client, falling back to `index.html`.
