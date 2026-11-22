// A contact sheet of every part that fits one slot of a gun, each fitted in turn and shot
// the same way, labeled, in one picture (GM sessions: docs/guns.md → The process, "every part
// that fits each slot"). Uses the item editor's model tab like gun-shot.mjs; needs
// `npm run dev` (Vite on 5180).
//
//   node scripts/gun-fits.mjs <gun-id> <out.png> --slot <slot> [--view side|3D|top|front]
//     [--zoom n] [--pan dx,dy] [--orbit dx,dy] [--hip | --aimed] [--with slot=id]...
//     [--only id,id] [--cols n] [--width px]
//
// --with fits another slot first (a foregrip under a stock kit, an optic while checking
// irons). Prints each part's budget line, so the heaviest build can be read off.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const id = args.shift();
const out = args.shift();
if (!id || !out || id.startsWith('--'))
  throw new Error('usage: gun-fits.mjs <gun-id> <out.png> --slot <slot> [options]');
const opt = {
  slot: null,
  view: 'side',
  zoom: 0,
  pan: null,
  orbit: null,
  fp: null,
  with: [],
  only: null,
  cols: 4,
  width: 520,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--slot') opt.slot = args[++i];
  else if (a === '--view') opt.view = args[++i];
  else if (a === '--zoom') opt.zoom = +args[++i];
  else if (a === '--pan') opt.pan = args[++i].split(',').map(Number);
  else if (a === '--orbit') opt.orbit = args[++i].split(',').map(Number);
  else if (a === '--hip') opt.fp = 'hip';
  else if (a === '--aimed') opt.fp = 'aimed';
  else if (a === '--with') opt.with.push(args[++i].split('='));
  else if (a === '--only') opt.only = args[++i].split(',');
  else if (a === '--cols') opt.cols = +args[++i];
  else if (a === '--width') opt.width = +args[++i];
  else throw new Error(`unknown option ${a}`);
}
if (!opt.slot) throw new Error('--slot is required');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:5180/item-editor?item=${encodeURIComponent(id)}`);
await page.waitForTimeout(2000);
await page.click('button:text-is("model")');
await page.waitForTimeout(1200);

// A slot's picker is the field labeled with the slot's name.
const picker = (slot) =>
  page
    .locator('label.ed-field')
    .filter({ hasText: new RegExp(`^${slot}`) })
    .locator('select')
    .first();
for (const [slot, item] of opt.with) {
  await picker(slot).selectOption(item);
  await page.waitForTimeout(300);
}
const select = picker(opt.slot);
// The first option is the picker's "none" (its value a sentinel).
const values = await select.locator('option').evaluateAll((os) => os.map((o) => o.value));
const none = values[0];
let ids = values.slice(1);
if (opt.only) ids = ids.filter((x) => opt.only.includes(x));

const shots = [];
for (const item of [none, ...ids]) {
  await select.selectOption(item);
  await page.waitForTimeout(350);
  const budget = (await page.getByText(/\d+ parts · \d+ triangles/).textContent())?.trim();
  // The camera keeps its place between fits: set the view once, on the first shot.
  const first = item === none;
  if (first || opt.fp) {
    await page.click(`button:text-is("${opt.fp ?? opt.view}")`);
    await page.waitForTimeout(opt.fp ? 1300 : 450);
  }
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
  if (!opt.fp && first) {
    if (opt.orbit) await drag(opt.orbit, 'left');
    if (opt.pan) await drag(opt.pan, 'right');
    await page.mouse.move(cx, cy);
    for (let k = 0; k < opt.zoom; k++) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(350);
  }
  const png = await page.screenshot({ clip: view });
  const label = item === none ? '(none)' : item;
  shots.push({ item: label, budget, src: `data:image/png;base64,${png.toString('base64')}` });
  console.log(`${label.padEnd(32)} ${budget}`);
}

// The sheet: a grid of the shots, each labeled with the part and its budget line.
const sheet = await browser.newPage({
  viewport: { width: opt.cols * opt.width + 16, height: 600 },
});
await sheet.setContent(`<body style="margin:8px;background:#111;font:13px sans-serif;color:#ddd">
  <div style="display:grid;grid-template-columns:repeat(${opt.cols},${opt.width}px)">
  ${shots
    .map(
      (
        s,
      ) => `<figure style="margin:0;padding:2px"><img src="${s.src}" style="width:100%;display:block">
      <figcaption style="padding:2px 4px"><b>${s.item}</b> · ${(s.budget ?? '').replace(/ for .*/, '')}</figcaption></figure>`,
    )
    .join('')}</div></body>`);
await sheet.waitForTimeout(300);
await sheet.screenshot({ path: out, fullPage: true });
console.log(out);
if (errors.length) console.log('page errors:', errors);
await browser.close();
