#!/usr/bin/env node
// The map report (MK-4, 2026-11-12): level-design.md's measures on the real collision world
// and nav grid, as one short table, instead of throwaway vitests.
//
//   node scripts/map-report.mjs <map> [--zone <area>] [--detail] [--compare <map|run.json>]
//                                     [--no-cost] [--out <dir>]
//
// Prints the summary and a row per named area (the map's 'area' labels); --detail adds the
// islands, perches, drops, walks and spawns. Writes heatmaps (lines.png, open.png, nav.png)
// and the run (run.json) to node_modules/.cache/map-report/<map>/ unless --out says where.
// --compare puts another map's numbers (its saved run, or measured now) or a saved
// run.json beside these. Measures and yardsticks: docs/level-design.md → Map report.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fromRoot, importTs, readContent, SHARED } from './mapkit/import-ts.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const out = { map: '', zone: undefined, detail: false, compare: undefined, cost: true, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--zone') out.zone = argv[++i];
    else if (a === '--detail') out.detail = true;
    else if (a === '--compare') out.compare = argv[++i];
    else if (a === '--no-cost') out.cost = false;
    else if (a === '--out') out.out = argv[++i];
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out.map = a;
  }
  if (!out.map)
    throw new Error(
      'usage: node scripts/map-report.mjs <map> [--zone <area>] [--detail] [--compare <map|run.json>] [--no-cost] [--out <dir>]',
    );
  return out;
}

const lib = await importTs([
  SHARED,
  'packages/client/src/map-report/measure.ts',
  'packages/client/src/map-report/cost.ts',
]);

let prefabs;
function compile(id) {
  if (!prefabs) {
    const files = {};
    for (const f of readdirSync(resolve(ROOT, 'content/prefabs')))
      if (f.endsWith('.json')) files[`content/prefabs/${f}`] = readContent(`prefabs/${f}`);
    prefabs = lib.loadById(lib.PREFAB_FORMAT, files);
  }
  const raw = readContent(`maps/${id}.json`);
  if (!raw) throw new Error(`no map content/maps/${id}.json`);
  const map = lib.loadById(lib.MAP_FORMAT, { [`content/maps/${id}.json`]: raw }).get(id);
  return lib.compileMap(map, prefabs);
}

/** Measures a map: the summary numbers kept in run.json, and the full measures. */
function run(id, opts) {
  const t0 = performance.now();
  const map = compile(id);
  const world = new lib.CollisionWorld(map.world);
  const nav = new lib.NavGrid(world);
  const m = lib.measureMap(map, world, nav, { zone: opts.zone });
  const cost = opts.cost ? lib.measureCost(map, lib.costSpots(map, nav)) : undefined;
  const layout = readContent(`layouts/${id}.json`);
  return { id, map, m, cost, layout, seconds: (performance.now() - t0) / 1000 };
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const m0 = (v) => (v === Infinity || v === undefined ? '–' : `${Math.round(v)}`);
const time = (meters, speed) => {
  if (meters === Infinity || meters === undefined) return '–';
  const s = Math.round(meters / speed);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const at = (x, z) => `(${Math.round(x)}, ${Math.round(z)})`;

/** The run's headline numbers, the ones --compare lines up. */
function summary(r) {
  const { m, cost } = r;
  const sum = (k) => m.areas.reduce((a, s) => a + s[k], 0);
  const outdoor = sum('outdoor');
  const indoor = sum('indoor');
  const circle = m.areas.reduce((a, s) => (s.openCircle.d > a.d ? s.openCircle : a), {
    d: 0,
    x: 0,
    z: 0,
  });
  const runA = m.areas.reduce((a, s) => (s.openRun.length > a.openRun.length ? s : a), m.areas[0]);
  let longest = { meters: 0, a: '', b: '' };
  m.walks.meters.forEach((row, i) =>
    row.forEach((v, j) => {
      if (v !== Infinity && v > longest.meters)
        longest = { meters: v, a: m.walks.from[i], b: m.walks.to[j] };
    }),
  );
  const median = (k) => {
    const v = m.spawns
      .map((s) => s[k])
      .filter((x) => x !== Infinity && x > 0)
      .sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : undefined;
  };
  const near = median('nearest');
  const far = median('farthest');
  const b = m.bounds;
  return [
    ['Size', `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxZ - b.minZ)} m`],
    ['Outdoor looks seeing 70 m+', pct(sum('outdoor70'), outdoor)],
    ['Outdoor looks seeing 30 m+', pct(sum('outdoor30'), outdoor)],
    ['Indoor looks seeing 30 m+', pct(sum('indoor30'), indoor)],
    ['Biggest open circle', circle.d ? `${m0(circle.d)} m at ${at(circle.x, circle.z)}` : '–'],
    ['Longest exposed run', runA ? `${m0(runA.openRun.length)} m (${runA.name})` : '–'],
    ['Exposed ground on runs over 40 m', `${m0(sum('overCap'))} m²`],
    ['AI main area', `${pct(m.mainShare, 1)} of ${(m.navNodes / 1000).toFixed(0)}k nodes`],
    [
      'Islands over 4 m²',
      `${m.islands.length}: ${m.islands.filter((i) => i.reach === 'climb' || i.reach === 'ladder').length} a player gets onto, ${m.islands.filter((i) => i.reach === 'pit').length} pits, the rest nobody`,
    ],
    [
      'Ways out of the play area',
      m.escapes.length
        ? `${m.escapes.length}: ${m.escapes
            .slice(0, 3)
            .map((w) => `${w.ladder ? 'ladder' : 'off'} ${at(w.x, w.z)} y ${w.y.toFixed(1)}`)
            .join(', ')}`
        : 'none',
    ],
    [
      'Perches',
      `${m.perches.length} (${m.perches.filter((p) => p.reach === 'AI').length} AI, ${m.perches.filter((p) => p.reach === 'none').length} unreached)`,
    ],
    [
      'Drops over 3.3 m, 4 m patches',
      `${m.drops.length} (${m.drops.filter((d) => d.ai).length} off AI ground, ${m.drops.filter((d) => d.drop > 3.9).length} over 3.9 m)`,
    ],
    [
      'Longest walk between areas',
      longest.meters
        ? `${m0(longest.meters)} m: ${time(longest.meters, 3.5)} walk, ${time(longest.meters, 6)} sprint`
        : '–',
    ],
    [
      'Spawn to extraction walk, median nearest / farthest',
      near !== undefined ? `${time(near, 3.5)} / ${time(far, 3.5)}` : '–',
    ],
    ['Triangles / meshes', cost ? `${Math.round(cost.triangles / 1000)}k / ${cost.meshes}` : '–'],
    ['Draw calls in view, p50 / p95', cost ? `${cost.draws.p50} / ${cost.draws.p95}` : '–'],
    ['Triangles in view, p95', cost ? `${Math.round(cost.trisInView.p95 / 1000)}k` : '–'],
  ];
}

function table(head, rows) {
  const all = [head, ...rows].map((r) => r.map(String));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r) => `| ${r.map((c, i) => c.padEnd(w[i])).join(' | ')} |`;
  return [
    line(all[0]),
    `|${w.map((n) => '-'.repeat(n + 2)).join('|')}|`,
    ...all.slice(1).map(line),
  ].join('\n');
}

// PNG heatmaps, 2 px a meter, north (−z) up.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(width, height, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PALETTES = {
  // none, under 30, 30 m+, 70 m+
  lines: [
    [24, 24, 28],
    [96, 100, 110],
    [230, 180, 60],
    [220, 60, 50],
  ],
  // not ground, something on it, open near cover, exposed, exposed on a run over 40 m
  open: [
    [24, 24, 28],
    [90, 120, 90],
    [150, 150, 140],
    [230, 220, 190],
    [220, 60, 50],
  ],
  // none, AI main, island reached, island unreached or pit, perch, drop over 3.3 m
  nav: [
    [24, 24, 28],
    [110, 110, 120],
    [80, 160, 220],
    [230, 140, 40],
    [170, 90, 220],
    [230, 50, 50],
  ],
};
function heatmap(r, raster, palette) {
  const S = 2;
  const w = r.cols * S;
  const h = r.rows * S;
  const rgb = Buffer.alloc(w * h * 3);
  for (let j = 0; j < r.rows; j++)
    for (let i = 0; i < r.cols; i++) {
      const c = palette[raster[j * r.cols + i]] ?? palette[0];
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++) {
          const o = ((j * S + dy) * w + i * S + dx) * 3;
          rgb[o] = c[0];
          rgb[o + 1] = c[1];
          rgb[o + 2] = c[2];
        }
    }
  return png(w, h, rgb);
}

function savedRun(id, outRoot) {
  const path = resolve(outRoot, id, 'run.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}

const opts = parseArgs(process.argv.slice(2));
const outRoot = opts.out ? resolve(opts.out) : resolve(ROOT, 'node_modules/.cache/map-report');
const r = run(opts.map, opts);
const rows = summary(r);

const outDir = opts.out
  ? outRoot
  : resolve(outRoot, opts.map + (opts.zone ? `-${opts.zone.replace(/\W+/g, '-')}` : ''));
mkdirSync(outDir, { recursive: true });
const ras = r.m.rasters;
writeFileSync(resolve(outDir, 'lines.png'), heatmap(ras, ras.lines, PALETTES.lines));
writeFileSync(resolve(outDir, 'open.png'), heatmap(ras, ras.open, PALETTES.open));
writeFileSync(resolve(outDir, 'nav.png'), heatmap(ras, ras.nav, PALETTES.nav));
writeFileSync(
  resolve(outDir, 'run.json'),
  JSON.stringify(
    { map: opts.map, zone: opts.zone, date: new Date().toISOString(), summary: rows },
    null,
    1,
  ),
);

let compare;
if (opts.compare) {
  if (opts.compare.endsWith('.json'))
    compare = JSON.parse(readFileSync(resolve(opts.compare), 'utf8'));
  else
    compare = savedRun(opts.compare, outRoot) ?? {
      map: opts.compare,
      summary: summary(run(opts.compare, { cost: opts.cost })),
    };
}

console.log(
  `${r.map.name} (${opts.map})${opts.zone ? `, area ${opts.zone}` : ''}: ${r.seconds.toFixed(1)} s`,
);
if (compare) {
  const other = new Map(compare.summary);
  console.log(
    table(
      ['Measure', opts.map, compare.map],
      rows.map(([k, v]) => [k, v, other.get(k) ?? '–']),
    ),
  );
} else console.log(table(['Measure', 'Value'], rows));

const areas = r.m.areas.filter((a) => a.outdoor + a.indoor > 0);
console.log(
  '\n' +
    table(
      ['Area', 'Out spots', '70 m+', '30 m+', 'In 30 m+', 'Open circle', 'Exposed run', '>40 m'],
      areas.map((a) => [
        a.name,
        a.outdoor / 8,
        pct(a.outdoor70, a.outdoor),
        pct(a.outdoor30, a.outdoor),
        a.indoor ? pct(a.indoor30, a.indoor) : '–',
        a.openCircle.d ? `${m0(a.openCircle.d)} m` : '–',
        a.openRun.length ? `${m0(a.openRun.length)} m` : '–',
        a.overCap ? `${a.overCap} m²` : '–',
      ]),
    ),
);

if (r.layout) {
  const byPoi = new Map();
  for (const a of r.layout.areas ?? []) {
    const k = a.poi ?? a.id;
    byPoi.set(k, (byPoi.get(k) ?? 0) + (a.entrances?.length ?? 0));
  }
  const few = [...byPoi].filter(([, n]) => n < 3);
  console.log(
    `\nLayout entrances: ${byPoi.size} POIs; under three ways in: ${few.length ? few.map(([k, n]) => `${k} ${n}`).join(', ') : 'none'}`,
  );
}

function wayText(v) {
  return v ? ` ${v.ladder ? 'ladder' : 'climb'} at ${at(v.x, v.z)} y ${v.y.toFixed(1)}` : '';
}
function reachText(i) {
  return i.reach === 'climb' || i.reach === 'ladder' || i.reach === 'pit'
    ? `${i.reach},${wayText(i.via)}`
    : i.reach;
}

if (opts.detail) {
  const m = r.m;
  if (m.islands.length)
    console.log(
      '\nIslands a player gets onto, and pits (biggest 10)\n' +
        table(
          ['Where', 'm²', 'Height', 'Reach'],
          m.islands
            .filter((i) => i.reach !== 'none')
            .slice(0, 10)
            .map((i) => [
              `${i.area} ${at(i.x, i.z)}`,
              m0(i.nodes / 4),
              `${i.above.toFixed(1)} m`,
              reachText(i),
            ]),
        ),
    );
  if (m.perches.length)
    console.log(
      '\nPerches (highest 12)\n' +
        table(
          ['Where', 'm²', 'Above ground', 'Reach', '70 m lines'],
          m.perches
            .slice(0, 12)
            .map((p) => [
              `${p.area} ${at(p.x, p.z)}`,
              m0(p.size),
              `${p.above.toFixed(1)} m`,
              reachText(p),
              `${p.long}/8`,
            ]),
        ),
    );
  if (m.drops.length)
    console.log(
      '\nDrops over 3.3 m (off AI ground first, worst first; 10)\n' +
        table(
          ['Where', 'Drop', 'Edges', 'From'],
          m.drops
            .slice(0, 10)
            .map((d) => [
              `${d.area} ${at(d.x, d.z)}`,
              `${d.drop.toFixed(1)} m`,
              d.edges,
              d.ai ? 'AI ground' : `player only, on${wayText(d.via)}`,
            ]),
        ),
    );
  const names = m.walks.from;
  if (names.length > 1)
    console.log(
      '\nWalks between areas (walk m:ss; sprint is ×0.58, stamina aside)\n' +
        table(
          ['From \\ to', ...names.map((n) => n.slice(0, 10))],
          names.map((n, i) => [
            n,
            ...m.walks.meters[i].map((v, j) => (i === j ? '' : time(v, 3.5))),
          ]),
        ),
    );
  if (m.spawns.length)
    console.log(
      '\nSpawns to extractions (walk)\n' +
        table(
          ['Spawn', 'Nearest', 'Farthest'],
          m.spawns.map((s) => [
            s.name,
            `${time(s.nearest, 3.5)} ${s.nearestTo}`,
            time(s.farthest, 3.5),
          ]),
        ),
    );
}
console.log(`\nHeatmaps: ${fromRoot(outDir)}/{lines,open,nav}.png`);
