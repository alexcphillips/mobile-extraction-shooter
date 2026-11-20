// Screenshots an item's model in the item editor, so a model built from numbers can be
// looked at (2026-11-09, made for the jade dragon). Needs `npm run dev` (Vite on 5180).
// Prints the editor's budget line ("38 parts · 396 triangles of 400 for a loot") and saves
// <out>-pictures.png (the inventory picture from every view) and <out>-<view>.png for each
// --view (3D, side, top, front; default 3D and side).
//
//   node scripts/item-shot.mjs <item-id> [--out <prefix>] [--view side]... [--base <url>]
// --aimed (guns and optics) also saves <out>-aimed.png: the model tab's first person, fully
// aimed, as the game draws it (a scope looked through, its reticle on); --on <gun> picks the
// gun an attachment is shown on; --alt looks through the gun's second sight (a scope's
// red dot on top, optic.alt) instead.
// `@body` shoots the character body (content/characters/body.json) in its rest pose;
// --outfit <enemy>-<n> (scav-3) shows it in that enemy outfit, tinted, with its plating.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const id = args.shift();
if (!id || id.startsWith('--')) throw new Error('usage: item-shot.mjs <item-id> [options]');
const opt = {
  base: 'http://localhost:5180',
  out: `item-${id}`,
  views: [],
  query: '',
  aimed: false,
  alt: false,
  on: null,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--view') opt.views.push(args[++i]);
  else if (a === '--base') opt.base = args[++i];
  else if (a === '--outfit') opt.query += `&outfit=${encodeURIComponent(args[++i])}`;
  else if (a === '--aimed') opt.aimed = true;
  else if (a === '--alt') opt.alt = true;
  else if (a === '--on') opt.on = args[++i];
  else throw new Error(`unknown option ${a}`);
}
if (!opt.views.length) opt.views = ['3D', 'side'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${opt.base}/item-editor?item=${encodeURIComponent(id)}${opt.query}`);
await page.waitForTimeout(2000);
// The body (CH-2, `@body`) has no inventory picture and opens on its model.
if (id !== '@body') {
  // the Picture group's tiles, one per view (the caption was "its picture, taken from")
  const pictures = page.locator('.ie-views');
  await pictures.screenshot({ path: `${opt.out}-pictures.png` });
  await page.click('button:text-is("model")');
  await page.waitForTimeout(1500);
}
console.log((await page.getByText(/\d+ parts · \d+ triangles/).textContent())?.trim());
for (const view of opt.views) {
  await page.click(`button:text-is("${view}")`);
  await page.waitForTimeout(800);
  const file = `${opt.out}-${view.toLowerCase()}.png`;
  await page.screenshot({ path: file, clip: { x: 617, y: 60, width: 783, height: 740 } });
  console.log(file);
}
if (opt.aimed) {
  if (opt.on)
    await page
      .locator('select')
      .filter({ hasText: opt.on })
      .first()
      .selectOption({ label: opt.on });
  await page.click('button:text-is("aimed")');
  if (opt.alt) await page.getByRole('button', { name: /^sight \d/ }).click();
  await page.waitForTimeout(1500);
  const file = `${opt.out}-aimed.png`;
  await page.screenshot({ path: file, clip: { x: 655, y: 80, width: 732, height: 696 } });
  console.log(file);
}
if (errors.length) console.log('page errors:', errors);
await browser.close();
