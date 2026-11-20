// Close-up screenshots of an item in the item editor's model tab, for building guns and their
// parts (GM-1): zoomed and panned views, the game's hip and aimed first person, with parts
// fitted, and the triangle budget line for that build. Needs `npm run dev` (Vite on 5180).
// See docs/guns.md → The process.
//
//   node scripts/gun-shot.mjs <item-id> <out.png> [--view side|3D|top|front] [--zoom n]
//     [--pan dx,dy] [--orbit dx,dy] [--fit <attachment-id>]... [--hip | --aimed]
//
// --zoom is mouse-wheel steps in (4 frames a long gun side on); --pan right-drags the view by
// pixels; --orbit left-drags (it can pick a part instead, so prefer --pan). --fit picks the
// attachment in the first slot that offers it (rail items go on the first rail). --hip and
// --aimed shoot the game's first person instead of a view. Prints the budget line
// ("333 parts · 3494 triangles (… + … fitted) of 3500 for a long gun").

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const id = args.shift();
const out = args.shift();
if (!id || !out || id.startsWith('--'))
  throw new Error('usage: gun-shot.mjs <item-id> <out.png> [options]');
const opt = { view: '3D', zoom: 0, pan: null, orbit: null, fit: [], fp: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--view') opt.view = args[++i];
  else if (a === '--zoom') opt.zoom = +args[++i];
  else if (a === '--pan') opt.pan = args[++i].split(',').map(Number);
  else if (a === '--orbit') opt.orbit = args[++i].split(',').map(Number);
  else if (a === '--fit') opt.fit.push(args[++i]);
  else if (a === '--hip') opt.fp = 'hip';
  else if (a === '--aimed') opt.fp = 'aimed';
  else throw new Error(`unknown option ${a}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:5180/item-editor?item=${encodeURIComponent(id)}`);
await page.waitForTimeout(2000);
await page.click('button:text-is("model")');
await page.waitForTimeout(1200);
for (const item of opt.fit) {
  await page
    .locator('select')
    .filter({ has: page.locator(`option:text-is("${item}")`) })
    .first()
    .selectOption({ label: item });
  await page.waitForTimeout(300);
}
console.log((await page.getByText(/\d+ parts · \d+ triangles/).textContent())?.trim());
await page.click(`button:text-is("${opt.fp ?? opt.view}")`);
await page.waitForTimeout(opt.fp ? 1500 : 600);

// The biggest canvas is the view.
const canvases = page.locator('canvas');
let view = null;
let area = 0;
for (let k = 0; k < (await canvases.count()); k++) {
  const b = await canvases.nth(k).boundingBox();
  if (b && b.width * b.height > area) [view, area] = [b, b.width * b.height];
}
const cx = view.x + view.width / 2;
const cy = view.y + view.height / 2;
const drag = async ([dx, dy], button) => {
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button });
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up({ button });
};
if (opt.orbit) await drag(opt.orbit, 'left');
if (opt.pan) await drag(opt.pan, 'right');
await page.mouse.move(cx, cy);
for (let k = 0; k < opt.zoom; k++) {
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(500);
await page.screenshot({ path: out, clip: view });
console.log(out);
if (errors.length) console.log('page errors:', errors);
await browser.close();
