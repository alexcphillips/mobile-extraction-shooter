// Screenshots an item's model in the item editor, so a model built from numbers can be
// looked at (2026-11-09, made for the jade dragon). Needs `npm run dev` (Vite on 5180).
// Prints the editor's budget line ("38 parts · 396 triangles of 400 for a loot") and saves
// <out>-pictures.png (the inventory picture from every view) and <out>-<view>.png for each
// --view (3D, side, top, front; default 3D and side).
//
//   node scripts/item-shot.mjs <item-id> [--out <prefix>] [--view side]... [--base <url>]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const id = args.shift();
if (!id || id.startsWith('--')) throw new Error('usage: item-shot.mjs <item-id> [options]');
const opt = { base: 'http://localhost:5180', out: `item-${id}`, views: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--view') opt.views.push(args[++i]);
  else if (a === '--base') opt.base = args[++i];
  else throw new Error(`unknown option ${a}`);
}
if (!opt.views.length) opt.views = ['3D', 'side'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${opt.base}/item-editor?item=${encodeURIComponent(id)}`);
await page.waitForTimeout(2000);
const pictures = page.getByText('its picture, taken from').locator('..');
await pictures.screenshot({ path: `${opt.out}-pictures.png` });
await page.click('button:text-is("model")');
await page.waitForTimeout(1500);
console.log((await page.getByText(/\d+ parts · \d+ triangles/).textContent())?.trim());
for (const view of opt.views) {
  await page.click(`button:text-is("${view}")`);
  await page.waitForTimeout(800);
  const file = `${opt.out}-${view.toLowerCase()}.png`;
  await page.screenshot({ path: file, clip: { x: 617, y: 60, width: 783, height: 740 } });
  console.log(file);
}
if (errors.length) console.log('page errors:', errors);
await browser.close();
