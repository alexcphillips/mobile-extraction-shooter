// The review sketch of a map's layout (MK-3, 2026-11-12): content/layouts/<map>.json drawn
// by the layout board's own drawing (packages/client/src/layout-board/sketch.ts) into one
// standalone HTML page, light and dark, to publish as an artifact for a review. The board
// and the sketch draw from the same file with the same code, so they can't disagree.
//
//   node scripts/layout-sketch.mjs <map> [--out <file.html>] [--rings <x>,<z>] [--cell <m>]
//
// --out defaults to the system temp folder; the path is printed.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { SHARED, importTs, readContent } from './mapkit/import-ts.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, rings: { type: 'string' }, cell: { type: 'string' } },
});
const map = positionals[0];
if (!map) {
  console.error(
    'usage: node scripts/layout-sketch.mjs <map> [--out file.html] [--rings x,z] [--cell m]',
  );
  process.exit(1);
}
const raw = readContent(`layouts/${map}.json`);
if (!raw) {
  console.error(`No content/layouts/${map}.json.`);
  process.exit(1);
}

const kit = await importTs([SHARED, 'packages/client/src/layout-board/sketch.ts']);
const layout = kit.loadLayout(raw, `layouts/${map}.json`);
const [rx, rz] = (values.rings ?? '').split(',').map(Number);
const svg = kit.layoutSvg(layout, {
  scale: 1000 / Math.max(...kit.sketchView(layout).slice(2)),
  cell: values.cell === undefined ? 5 : Number(values.cell),
  rings: Number.isFinite(rx) && Number.isFinite(rz) ? { x: rx, z: rz } : null,
});

const count = (k) => layout[k].length;
const title = `${layout.name ?? map} layout`;
const b = layout.bounds;
const heights = [];
for (let z = b.z0; z <= b.z1; z += 5)
  for (let x = b.x0; x <= b.x1; x += 5) heights.push(kit.heightAt(layout, x, z));
const facts = [
  `${b.x1 - b.x0} × ${b.z1 - b.z0} m`,
  `ground ${Math.min(...heights).toFixed(1)} to ${Math.max(...heights).toFixed(1)} m`,
  `${count('areas')} areas`,
  `${count('pads')} pads`,
  `${count('roads')} roads`,
  `${count('landmarks')} landmarks`,
  `${count('zones')} zones`,
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --bg:#f4f1ea; --ink:#1d2430; --muted:#5d6675; --line:#1d243022; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#16191e; --ink:#e6e8ec; --muted:#9aa3b0; --line:#e6e8ec22; } }
:root[data-theme="dark"] { --bg:#16191e; --ink:#e6e8ec; --muted:#9aa3b0; --line:#e6e8ec22; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui, sans-serif; }
main { max-width:1100px; margin:0 auto; padding:20px 16px 40px; }
h1 { font-size:20px; margin:0 0 4px; }
.facts { color:var(--muted); margin:0 0 14px; }
.sheet { border:1px solid var(--line); border-radius:6px; overflow:hidden; }
.sheet svg { display:block; width:100%; height:auto; }
.key { display:flex; flex-wrap:wrap; gap:6px 18px; color:var(--muted); margin-top:12px; font-size:13px; }
.key b { color:var(--ink); font-weight:600; }
${kit.SKETCH_CSS}
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="facts">${facts.map(esc).join(' · ')}. Drawn from content/layouts/${esc(map)}.json.</p>
<div class="sheet">${svg}</div>
<div class="key">
<span><b>Solid</b> full depth · <b>lighter</b> partial · <b>dashed</b> facade</span>
<span><b>Red ticks</b> ways in (amber: upper floor)</span>
<span><b>Stronger ground tint</b> is higher</span>
<span><b>Dashed outline</b> a pad (flat level) · <b>heavy outline</b> a retaining wall</span>
<span><b>Rings</b> 10, 20, 30 s at 3.5 m/s (solid) and 6 m/s (dashed)</span>
</div>
</main>
</body>
</html>
`;

const out = resolve(values.out ?? resolve(tmpdir(), `mes-layout-${map}.html`));
writeFileSync(out, html);
console.log(`${title}: ${facts.join(', ')} → ${out}`);

function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}
