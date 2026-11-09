---
name: look
description: Launch the game and screenshot a screen (menu, stash, vendors, a phone or PC layout) to check a UI change in the real app, signed in as the local test account.
---

# Looking at the game

`scripts/look.mjs` opens the dev server in headless Chromium (Playwright), signs in as
`claude-test` (made on first use, local dev database only), runs clicks in order and saves
a screenshot. Read the PNG afterwards: a screenshot you didn't look at checks nothing.

## 1. Make sure both dev servers are up

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:5180/            # 200: Vite
curl -s -o /dev/null -w "%{http_code}\n" localhost:5180/api/profile # 401: the Worker
```

- Vite down: `npm run dev:client` in the background.
- `/api` gives 502: the Worker isn't running. Start `npm run dev:server` in the background
  and wait for `/api/profile` to answer 401. If you started it, stop it when done (the user
  runs `npm run dev`, which wants port 8787).
- Node 22.23.4, not 22.12 (see the memory on Node versions).
- First time on a machine: `npx playwright install chromium`.

## 2. Take the screenshot

Save into the scratchpad directory, not the repo:

```bash
npm run look -- --out <scratchpad>/menu.png
npm run look -- --click "[aria-label='Loadout: open stash']" --out <scratchpad>/stash.png
npm run look -- --phone --click "text=Vendors" --out <scratchpad>/vendors-phone.png
```

- `--phone`: iPhone 15 held sideways, touch, no hover. The inventory is one merged column
  there and side by side on a PC (`(hover: hover) and (pointer: fine)`), so check both
  when changing it. Upright, the game only shows its "turn your phone" screen.
- `--size 1440x900`: the PC viewport (the default).
- `--click <selector>`: any Playwright selector, repeatable, run in order.
- `--wait <ms>`: extra time before the shot (default 600) for the 3D character or
  animations.
- `--fresh`: a brand-new account, for a new character's starting kit.

The script prints page errors and console errors after the shot; mention any you see.

## Notes

- Everyone is admin on the dev server, so the Admin page can give the test account items.
- The main menu has no URLs; get to a page by clicking (Stash, Vendors, Quests buttons, or
  the loadout card).
