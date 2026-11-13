#!/usr/bin/env node
// The prefab catalog (MK-5, 2026-11-12): find a prefab to reuse without reading 200 files.
//
//   node scripts/prefabs.mjs [words…] [--tag <t>] [--height drawn|low|waist|eye|tall]
//                            [--map <id>] [--unused] [--loot] [--sort id|tris|uses|size]
//                            [--detail] [--json] [--tags]
//   node scripts/prefabs.mjs [words…] [filters…] --sheet [--out <file.png>] [--base <url>]
//
// Each word must be in the id, the name or a tag. One row per prefab: size (w × h × d, m),
// height class (by the top of what collides: low < 0.6 m, waist < 1.6, eye < 3, tall;
// drawn = no collision), triangles, solids, loot, flags, tags and copies per map (nested
// ones included). --detail adds color slots, what it's built on and what holds it. --tags
// lists the tags in use. --sheet screenshots the thumbnails of the rows it would print
// (needs `npm run dev`, Vite on 5180) to node_modules/.cache/prefabs/sheet.png.
// Detail: docs/tech/editors.md → Prefab catalog; tag list: docs/props.md → Prefab catalog.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { catalog, HEIGHTS, search } from './mapkit/catalog.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SHORT = { northpoint: 'np', 'silver-creek': 'sc', district: 'ds', tutorial: 'tut' };

function parseArgs(argv) {
  const o = { words: [], sort: 'id', base: 'http://localhost:5180' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tag') o.tag = argv[++i];
    else if (a === '--height') o.height = argv[++i];
    else if (a === '--map') o.map = argv[++i];
    else if (a === '--sort') o.sort = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--base') o.base = argv[++i];
    else if (['--unused', '--loot', '--detail', '--json', '--tags', '--sheet'].includes(a))
      o[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.words.push(a);
  }
  const heights = ['drawn', ...HEIGHTS.map(([h]) => h)];
  if (o.height && !heights.includes(o.height))
    throw new Error(`--height is one of ${heights.join(', ')}`);
  return o;
}

const o = parseArgs(process.argv.slice(2));
const all = await catalog();
let rows = search(all, o.words);
if (o.tag) rows = rows.filter((r) => r.tags.includes(o.tag));
if (o.height) rows = rows.filter((r) => r.height === o.height);
if (o.map) rows = rows.filter((r) => r.uses[o.map]);
if (o.unused) rows = rows.filter((r) => !r.total && !r.heldBy.length && !r.lookOf);
if (o.loot) rows = rows.filter((r) => r.containerCount || r.spots);
const vol = (r) => (r.size ? r.size[0] * r.size[2] : 0);
const sorts = {
  id: (a, b) => a.id.localeCompare(b.id),
  tris: (a, b) => b.triangles - a.triangles,
  uses: (a, b) => b.total - a.total,
  size: (a, b) => vol(b) - vol(a),
};
if (!sorts[o.sort]) throw new Error(`--sort is one of ${Object.keys(sorts).join(', ')}`);
rows.sort(sorts[o.sort]);

if (o.tags) {
  const count = new Map();
  for (const r of all) for (const t of r.tags) count.set(t, (count.get(t) ?? 0) + 1);
  const untagged = all.filter((r) => !r.tags.length && !r.lookOf).length;
  console.log(
    [...count]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} ${n}`)
      .join(' · ') + ` · (untagged ${untagged})`,
  );
} else if (o.json) {
  console.log(JSON.stringify(rows, null, 1));
} else if (o.sheet) {
  await sheet(rows);
} else {
  table(rows);
}

function table(rows) {
  const n1 = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const size = (s) => (s ? s.map(n1).join('×') : '–');
  const loot = (r) =>
    [
      r.containerCount ? `${r.containerCount} ${r.containers.join('/')}` : '',
      r.spots ? `${r.spots} spot${r.spots > 1 ? 's' : ''}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  const flags = (r) =>
    [
      r.instanced && 'inst',
      r.building && 'bldg',
      r.landmark && 'mark',
      r.doors && `${r.doors}door`,
      r.glass && `${r.glass}glass`,
      r.lookOf && `look:${r.lookOf}`,
      r.variantOf && `${r.variantKind === 'recolor' ? 'recolor' : 'on'}:${r.variantOf}`,
    ]
      .filter(Boolean)
      .join(' ');
  const uses = (r) =>
    Object.entries(r.uses)
      .map(([m, n]) => `${SHORT[m] ?? m} ${n}`)
      .join(', ') + (r.heldBy.length ? `${r.total ? '; ' : ''}in ${r.heldBy.length} prefab` : '');
  const cols = [
    ['id', (r) => r.id],
    ['size m', (r) => size(r.size)],
    ['height', (r) => r.height],
    ['tris', (r) => String(r.triangles)],
    ['solid', (r) => String(r.solids)],
    ['loot', loot],
    ['flags', flags],
    ['tags', (r) => r.tags.join(' ')],
    ['uses', uses],
  ];
  const cells = rows.map((r) => cols.map(([, f]) => f(r)));
  const widths = cols.map(([h], i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) =>
    c
      .map((v, i) => v.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  console.log(line(cols.map(([h]) => h)));
  for (const c of cells) console.log(line(c));
  if (o.detail)
    for (const r of rows)
      console.log(
        `\n${r.id}${r.name ? ` (${r.name})` : ''}: top ${r.top === null ? '–' : r.top.toFixed(2)} m` +
          `; colors ${r.colors.join(', ') || '–'}` +
          (r.variantOf ? `; ${r.variantKind} of ${r.variantOf}` : '') +
          (r.heldBy.length ? `; held by ${r.heldBy.join(', ')}` : ''),
      );
  console.log(
    `${rows.length} of ${all.length} prefabs · maps: ${Object.entries(SHORT)
      .map(([m, s]) => `${s} ${m}`)
      .join(', ')}`,
  );
}

async function sheet(rows) {
  if (!rows.length) return console.log('no prefab matches');
  const { chromium } = await import('playwright');
  const out = resolve(ROOT, o.out ?? 'node_modules/.cache/prefabs/sheet.png');
  mkdirSync(dirname(out), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ids = rows.map((r) => r.id).join(',');
  await page.goto(`${o.base}/prefab-sheet?ids=${encodeURIComponent(ids)}`);
  await page.waitForSelector('[data-sheet-done]', { timeout: 60000 });
  await page.locator('.sheet').screenshot({ path: out });
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
  console.log(`${rows.length} prefabs → ${out}`);
}
