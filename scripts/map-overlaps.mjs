#!/usr/bin/env node
// Overlap check (2026-11-14): what the map editor outlines in red, from the command
// line, so a generated or hand-built map can be checked without opening the editor. Run it
// after making or changing any map; the generators run it themselves (mapkit/generated.mjs).
//
//   node scripts/map-overlaps.mjs <map>… | --all   [--limit <n>]
//
// Kinds (one row per problem, up to --limit per kind, default 20):
//   overlap   two placed things whose solids cut into each other: the editor's findOverlaps
//             (packages/client/src/editor/overlap.ts), the same rules, joints and tolerances
//   building  two buildings' footprints overlap (the editor refuses these)
//   buried    the ground comes up through a building's floor
//   floor     something's bottom sits inside a floor slab (a slab no thicker than 0.6 m) that
//             it stands over: a prop or wall sunk into the floor. The editor's joint rule lets
//             small ones pass as overlaps, so it's checked here on its own.
//   ground    the ground up through a floor slab, where nothing stands at its height and no
//             roof is over it (an underground room); or a placed prefab sunk below the lowest
//             ground under it (nature and rail prefabs left out). Holes in the terrain don't
//             count, nor slabs buried deeper than 1.5 m.
// Exits 1 if any map has a problem. Detail: docs/tech/editors.md → Overlap check.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importTs, readContent, SHARED } from './mapkit/import-ts.mjs';

const ROOT = resolve(import.meta.dirname, '..');
/** Deeper than this into a floor or the ground counts (as the editor's 5 cm). */
const SINK = 0.05;
/** A solid no thicker than this is a floor slab (overlap.ts's SLAB). */
const SLAB = 0.6;
/** A slab this far under the ground is buried on purpose (a tunnel's roof), not shown through. */
const BURIED = 1.5;

const lib = await importTs([SHARED, 'packages/client/src/editor/overlap.ts']);

let prefabs;
function loadPrefabs() {
  if (!prefabs) {
    const files = {};
    for (const f of readdirSync(resolve(ROOT, 'content/prefabs')))
      if (f.endsWith('.json')) files[`content/prefabs/${f}`] = readContent(`prefabs/${f}`);
    prefabs = lib.loadById(lib.PREFAB_FORMAT, files);
  }
  return prefabs;
}

/** A node's name for messages, as the editor gives it, with the groups it's in. */
function labelOf(map, path) {
  const names = [];
  let nodes = map.nodes;
  let n;
  for (const i of path) {
    n = nodes[i];
    if (!n) break;
    if (n.type === 'group') {
      if (n.name) names.push(n.name);
      nodes = n.nodes;
    }
  }
  let own = '';
  if (n?.type === 'prefab') own = n.id ? `${n.id} (${n.prefab})` : n.prefab;
  else if (n && n.type !== 'group') own = n.id ?? '';
  if (!own) own = `${n?.type ?? 'node'} #${path.join('.')}`;
  return [...names.slice(-2), own].join(' › ');
}

const r1 = (v) => Math.round(v * 10) / 10;
const at = (s) => `${r1(s.x)}, ${r1(s.y0)}, ${r1(s.z)}`;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y0: Math.max(a.y0, b.y0) });

/** Whether `s` has its bottom inside the floor slab `f`, standing up out of it. */
function sunkInFloor(s, f) {
  if (f.y1 - f.y0 > SLAB || s === f) return false;
  if (s.y0 <= f.y0 + 0.01 || s.y0 >= f.y1 - SINK || s.y1 <= f.y1 + 0.01) return false;
  return lib.solidsOverlap(s, f, SINK, 0);
}

/**
 * Every problem in a map file's JSON (as on disk), as rows { kind, a, b?, at }.
 * @param {object} raw
 * @param {string} id
 */
export function checkMap(raw, id) {
  const prefabs = loadPrefabs();
  const map = lib.loadById(lib.MAP_FORMAT, { [`content/maps/${id}.json`]: raw }).get(id);
  const rows = [];
  const placed = lib.placedNodes(map, prefabs);
  const byPath = new Map(placed.map((p) => [p.path.join('.'), p]));
  const o = lib.findOverlaps(map, prefabs);
  const where = (pa, pb, test) => {
    const a = byPath.get(pa.join('.'));
    const b = byPath.get(pb.join('.'));
    for (const s of a?.solids ?? [])
      for (const t of b?.solids ?? []) if (test(s, t)) return at(mid(s, t));
    return a
      ? at({ x: (a.minX + a.maxX) / 2, z: (a.minZ + a.maxZ) / 2, y0: a.solids[0]?.y0 ?? 0 })
      : '';
  };
  const overlap = (s, t) =>
    !lib.sameSlab(s, t) && !lib.sameRun(s, t) && lib.solidsOverlap(s, t, SINK, 0.45);
  for (const [a, b] of o.buildings)
    rows.push({ kind: 'building', a, b, at: where(a, b, () => true) });
  for (const [a, b] of o.props) rows.push({ kind: 'overlap', a, b, at: where(a, b, overlap) });
  for (const p of o.buried) rows.push({ kind: 'buried', a: p, at: where(p, p, () => true) });

  // Sunk into a floor: pairs the editor didn't already flag.
  const flagged = new Set(o.props.map(([a, b]) => `${a.join('.')}|${b.join('.')}`));
  for (let i = 0; i < placed.length; i++) {
    for (let j = 0; j < placed.length; j++) {
      if (i === j) continue;
      const a = placed[i];
      const b = placed[j];
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ) continue;
      const key =
        i < j
          ? `${a.path.join('.')}|${b.path.join('.')}`
          : `${b.path.join('.')}|${a.path.join('.')}`;
      if (flagged.has(key)) continue;
      for (const s of a.solids) {
        const f = b.solids.find((t) => sunkInFloor(s, t));
        if (!f) continue;
        rows.push({ kind: 'floor', a: a.path, b: b.path, at: at(mid(s, f)), depth: f.y1 - s.y0 });
        flagged.add(key);
        break;
      }
    }
  }

  // The ground, as the game grades it. Up through a floor: over a floor slab's top where no
  // solid stands at the ground's height (the editor's 'buried' covers only building nodes;
  // a foundation under a floor slab is covered by the slab). Sunk in the ground: a placed
  // prefab's bottom under the lowest ground below it, nature and rail left out (trees, rocks
  // and track are set in on purpose). Posts, walls and foundations set into a slope pass.
  const terrain = new lib.HeightGrid(lib.compileMap(map, prefabs).world.terrain);
  const ground = (x, z) => (terrain.holeAt(x, z) ? -Infinity : terrain.heightAt(x, z));
  const all = placed.flatMap((p) => p.solids);
  const covered = (x, z, h) =>
    all.some((s) => s.y0 <= h + SINK && s.y1 >= h - SINK && inside(s, x, z));
  // Something over (x, z) between `from` and the ground: a roof underground, a tunnel's.
  const roofed = (x, z, from, h) =>
    all.some((s) => s.y0 > from + SINK && s.y0 < h && inside(s, x, z));
  for (const p of placed) {
    if (p.buildings.length) continue;
    let worst = null;
    for (const s of p.solids) {
      if (s.y1 - s.y0 > SLAB) continue;
      for (const [x, z] of samples(s)) {
        const h = ground(x, z);
        const depth = h - s.y1;
        if (depth <= SINK || depth > BURIED || (worst && depth <= worst.depth)) continue;
        if (!covered(x, z, h) && !roofed(x, z, s.y1, h))
          worst = { depth, at: at({ x, z, y0: s.y1 }) };
      }
    }
    if (worst) {
      rows.push({ kind: 'ground', a: p.path, ...worst, note: 'up through the floor' });
      continue;
    }
    const n = nodeAt(map, p.path);
    if (n?.type !== 'prefab') continue;
    const tags = prefabs.get(n.prefab)?.tags ?? [];
    if (tags.includes('nature') || tags.includes('rail')) continue;
    const bottom = Math.min(...p.solids.map((s) => s.y0));
    const base = p.solids.filter((s) => s.y0 < bottom + 0.01);
    const points = base.flatMap(samples).filter(([x, z]) => !terrain.holeAt(x, z));
    if (!points.length) continue;
    const low = Math.min(...points.map(([x, z]) => terrain.heightAt(x, z)));
    if (bottom < low - SINK && !points.some(([x, z]) => roofed(x, z, bottom, low)))
      rows.push({
        kind: 'ground',
        a: p.path,
        at: at(base[0]),
        depth: low - bottom,
        note: 'sunk in the ground',
      });
  }
  return { map, rows };
}

const nodeAt = (map, path) =>
  path.reduce((n, i) => (n?.type === 'group' ? n.nodes[i] : undefined), {
    type: 'group',
    nodes: map.nodes,
  });

/** Whether (x, z) is inside a solid's rectangle (yaw 0 faces −z, as in overlap.ts). */
function inside(s, x, z) {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  const dx = x - s.x;
  const dz = z - s.z;
  return Math.abs(dx * c - dz * n) <= s.hx + 1e-6 && Math.abs(dx * n + dz * c) <= s.hz + 1e-6;
}

/** Points about a meter apart over a solid's rectangle, its edges pulled in 10 cm. */
function samples(s) {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  const hx = Math.max(0, s.hx - 0.1);
  const hz = Math.max(0, s.hz - 0.1);
  const nx = Math.max(1, Math.ceil(2 * hx));
  const nz = Math.max(1, Math.ceil(2 * hz));
  const out = [];
  for (let i = 0; i <= nx; i++)
    for (let k = 0; k <= nz; k++) {
      const lx = -hx + (2 * hx * i) / nx;
      const lz = -hz + (2 * hz * k) / nz;
      out.push([s.x + lx * c + lz * n, s.z - lx * n + lz * c]);
    }
  return out;
}

const ORDER = ['building', 'buried', 'overlap', 'floor', 'ground'];

/** One short table: counts by kind, then up to `limit` rows of each. */
export function formatRows(map, rows, limit = 20) {
  if (!rows.length) return 'no overlaps';
  const counts = ORDER.filter((k) => rows.some((r) => r.kind === k)).map(
    (k) => `${rows.filter((r) => r.kind === k).length} ${k}`,
  );
  const lines = [counts.join(', ')];
  for (const k of ORDER) {
    const of = rows.filter((r) => r.kind === k);
    for (const r of of.slice(0, limit)) {
      const what = r.b ? `${labelOf(map, r.a)}  ×  ${labelOf(map, r.b)}` : labelOf(map, r.a);
      const depth = r.depth ? `  ${Math.round(r.depth * 100)} cm${r.note ? ` ${r.note}` : ''}` : '';
      lines.push(`  ${k.padEnd(8)}  (${r.at})  ${what}${depth}`);
    }
    if (of.length > limit) lines.push(`  ${k.padEnd(8)}  … ${of.length - limit} more`);
  }
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const l = argv.indexOf('--limit');
  const limit = l >= 0 ? Number(argv[l + 1]) : 20;
  let ids = argv.filter((a, i) => !a.startsWith('--') && !(l >= 0 && i === l + 1));
  if (argv.includes('--all'))
    ids = readdirSync(resolve(ROOT, 'content/maps'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5));
  if (!ids.length) {
    console.error('usage: node scripts/map-overlaps.mjs <map>… | --all  [--limit <n>]');
    process.exit(2);
  }
  let bad = false;
  for (const id of ids) {
    const raw = readContent(`maps/${id}.json`);
    if (!raw) throw new Error(`no map content/maps/${id}.json`);
    const { map, rows } = checkMap(raw, id);
    if (rows.length) bad = true;
    console.log(`${id}: ${formatRows(map, rows, limit)}`);
  }
  process.exit(bad ? 1 : 0);
}
