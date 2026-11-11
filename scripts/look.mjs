// Opens the game in a headless browser, signed in as the local test account, does a few
// clicks and saves a screenshot, so Claude can see a UI change (2026-11-09, the user's
// request). Needs `npm run dev` (Vite on 5180 and the Worker on 8787).
//
//   node scripts/look.mjs [--phone] [--size 1440x900] [--click <selector>]... \
//     [--wait <ms>] [--out <file.png>] [--base <url>] [--query <q>] [--fresh]
//
// --click takes a Playwright selector ("text=Stash", "[aria-label='Loadout: open stash']")
// and can be given several times, run in order. --phone is an iPhone 15 held sideways, as
// the game wants (touch, no hover), which the inventory lays out differently from a PC.
// --fresh signs in with a new account (a new character's starting kit) instead of the
// shared test one.
// --query adds a query string to the page (not the API), e.g. "victory" for the dev victory screen.
import { chromium, devices } from 'playwright';

/** The test account: on the local dev database only, so its password needn't be secret. */
const TEST_USER = 'claude-test';
const TEST_PASSWORD = 'claude-test-local';

const args = process.argv.slice(2);
const opt = { base: 'http://localhost:5180', size: '1440x900', clicks: [], wait: 600 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--phone') opt.phone = true;
  else if (a === '--fresh') opt.fresh = true;
  else if (a === '--size') opt.size = args[++i];
  else if (a === '--click') opt.clicks.push(args[++i]);
  else if (a === '--wait') opt.wait = Number(args[++i]);
  else if (a === '--out') opt.out = args[++i];
  else if (a === '--base') opt.base = args[++i];
  else if (a === '--query') opt.query = args[++i];
  else throw new Error(`unknown option ${a}`);
}
opt.out ??= `look-${Date.now()}.png`;

// Never sign in anywhere but a dev server on this machine or the LAN.
const host = new URL(opt.base).hostname;
if (!/^(localhost|127\.|192\.168\.|10\.)/.test(host))
  throw new Error(`refusing to sign in to ${host}: local dev servers only`);

const [w, h] = opt.size.split('x').map(Number);
const browser = await chromium.launch();
const context = await browser.newContext(
  opt.phone ? devices['iPhone 15 landscape'] : { viewport: { width: w, height: h } },
);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const login = opt.fresh
  ? { username: `t${Date.now().toString(36)}`, password: TEST_PASSWORD }
  : { username: TEST_USER, password: TEST_PASSWORD };
let res = await page.request.post(`${opt.base}/api/login`, { data: login });
// The first time on this database (or with --fresh), the account isn't there yet.
if (!res.ok() && (await res.json().catch(() => null))?.error === 'wrong-login')
  res = await page.request.post(`${opt.base}/api/register`, { data: login });
if (!res.ok()) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`);

await page.goto(opt.query ? `${opt.base}/?${opt.query}` : opt.base);
await page.waitForLoadState('networkidle');
for (const sel of opt.clicks) {
  await page.locator(sel).first().click();
  // Past the inventory's double-tap window (350 ms), so a tap's open isn't cancelled by the next.
  await page.waitForTimeout(450);
}
await page.waitForTimeout(opt.wait);
await page.screenshot({ path: opt.out });
console.log(`signed in as ${login.username}; saved ${opt.out}`);
if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
await browser.close();
