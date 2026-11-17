#!/usr/bin/env node
// Fake-cover scan (2026-11-17, the user's rule: level-design.md 6a). Lists the map's
// drawn-only shapes (`collide: false`, not hidden) that could be taken for cover: a player
// sees something solid there, and shots and bodies pass through it.
//
//   node scripts/map-fake-cover.mjs <map>… | --all   [--strict] [--kept]
//
// What counts, by the shape's own size (a placed prefab's parts are left out: props.md's
// collision rules decide those, in the prefab):
//   block  a box or upright cylinder at least 0.3 m thick both ways across and 0.8 m tall,
//          starting under 2.5 m over the ground under it
//   beam   a tilted box at least 0.25 m thick both ways and 1.5 m long whose low end comes
//          within 2.5 m of the ground
//   log    a tilted cylinder of radius 0.2 m or more, 1.5 m or longer, lying within 1 m of
//          the ground (or the water)
// A shape with a solid already through its middle (a hidden collider built for it, or the
// thing it's drawn on) is skipped. Shapes kept drawn on purpose are listed, with the reason,
// in scripts/mapkit/fake-cover-keep.json ({ map: { id: reason } }), and reported apart.
// Groups that tilt (pitch or roll) aren't walked; the count of them is printed.
// It's a report, not a gate: exits 0 unless --strict and something unlisted is found.
// Detail: docs/tech/editors.md → Fake-cover scan.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importTs, readContent, SHARED } from './mapkit/import-ts.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const KEEP_FILE = resolve(ROOT, 'scripts/mapkit/fake-cover-keep.json');
export const FAKE = {
  /** A block: thick across, tall, low enough to stand behind. */
  thick: 0.3,
  tall: 0.8,
  under: 2.5,
  /** A beam: thick, long, its low end near the ground. */
  beamThick: 0.25,
  long: 1.5,
  /** A log: radius, lying this close to the ground. */
  logRadius: 0.2,
  logLow: 1.0,
};
const DEG = Math.PI / 180;

const lib = await importTs([SHARED]);
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

/** The kept-on-purpose list for a map: { id: reason }. */
export function keptFor(id) {
  if (!existsSync(KEEP_FILE)) return {};
  return JSON.parse(readFileSync(KEEP_FILE, 'utf8'))[id] ?? {};
}

/**
 * The drawn-only shapes in a map file's JSON (as on disk) that could read as cover.
 * @param {object} raw the map file
 * @param {string} id the map's id
 * @param {Record<string, string>} keep ids kept drawn on purpose, with the reason
 * @returns {{ rows: object[], kept: object[], tiltedGroups: number }}
 */
export function scanMap(raw, id, keep = keptFor(id)) {
  const map = lib.loadById(lib.MAP_FORMAT, { [`content/maps/${id}.json`]: raw }).get(id);
  const world = new lib.CollisionWorld(lib.compileMap(map, loadPrefabs()).world);
  const bt = new Float64Array(512);
  const tp = new Float64Array(512);
  const solidThrough = (x, z, y) => {
    const n = world.solidsAt(x, z, bt, tp);
    for (let i = 0; i < n; i++) if (bt[i] <= y && tp[i] >= y) return true;
    return false;
  };
  /** The ground (or water's surface) under a point. */
  const floorAt = (x, z) => {
    const g = world.terrain.heightAt(x, z);
    const d = world.waterDepth ? world.waterDepth(x, z) : 0;
    return d > 0 ? g + d : g;
  };
  const rows = [];
  const kept = [];
  let tiltedGroups = 0;
  const walk = (nodes, f, path) => {
    for (const n of nodes) {
      const p = n.pos ?? [0, 0, 0];
      const c = Math.cos(f.yaw * DEG);
      const s = Math.sin(f.yaw * DEG);
      const x = f.x + p[0] * c + p[2] * s;
      const z = f.z - p[0] * s + p[2] * c;
      const y = f.y + p[1];
      if (n.type === 'group') {
        if (n.pitch || n.roll) {
          tiltedGroups++;
          continue;
        }
        walk(n.nodes ?? [], { x, y, z, yaw: f.yaw + (n.yaw ?? 0) }, [...path, n.name ?? '']);
        continue;
      }
      if (n.collide !== false || n.invisible) continue;
      if (n.type !== 'box' && n.type !== 'cylinder') continue;
      const tilted = Boolean(n.pitch || n.roll);
      let kind = null;
      let mid = 0;
      let size = '';
      if (n.type === 'box' && tilted) {
        const [w, h, l] = n.size;
        mid = y + h / 2;
        const t = (n.pitch || n.roll) * DEG;
        const low = mid - (Math.abs(Math.sin(t)) * l) / 2;
        if (Math.min(w, h) >= FAKE.beamThick && l >= FAKE.long && low - floorAt(x, z) < FAKE.under)
          kind = 'beam';
        size = `${w} × ${h} × ${l}`;
      } else if (n.type === 'cylinder' && tilted) {
        mid = y + n.height / 2;
        if (
          n.radius >= FAKE.logRadius &&
          n.height >= FAKE.long &&
          mid - n.radius - floorAt(x, z) < FAKE.logLow
        )
          kind = 'log';
        size = `r ${n.radius} × ${n.height}`;
      } else {
        const [w, h, d] = n.type === 'box' ? n.size : [n.radius * 2, n.height, n.radius * 2];
        mid = y + h / 2;
        if (
          Math.min(w, d) >= FAKE.thick &&
          h >= FAKE.tall &&
          y - world.terrain.heightAt(x, z) < FAKE.under
        )
          kind = 'block';
        size = `${w} × ${h} × ${d}`;
      }
      if (!kind || solidThrough(x, z, mid)) continue;
      const row = { kind, id: n.id ?? '', path: path.filter(Boolean), x, z, y, size };
      if (n.id && keep[n.id] !== undefined) kept.push({ ...row, reason: keep[n.id] });
      else rows.push(row);
    }
  };
  walk(map.nodes, { x: 0, y: 0, z: 0, yaw: 0 }, []);
  return { rows, kept, tiltedGroups };
}

const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
/** One line per shape: kind, where, the group it's in, its id and size. */
export function formatScan({ rows, kept, tiltedGroups }, { showKept = false } = {}) {
  const line = (r) =>
    `  ${r.kind.padEnd(5)}  (${r1(r.x)}, ${r1(r.y)}, ${r1(r.z)})  ${[...r.path.slice(-2), r.id || '(no id)'].join(' › ')}  ${r.size}${r.reason ? `  kept: ${r.reason}` : ''}`;
  const head = rows.length ? `${rows.length} to look at` : 'no fake cover';
  const out = [
    `${head}${kept.length ? `, ${kept.length} kept drawn on purpose` : ''}${tiltedGroups ? `, ${tiltedGroups} tilted groups not walked` : ''}`,
    ...rows.map(line),
  ];
  if (showKept) out.push(...kept.map(line));
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  let ids = argv.filter((a) => !a.startsWith('--'));
  if (argv.includes('--all'))
    ids = readdirSync(resolve(ROOT, 'content/maps'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5));
  if (!ids.length) {
    console.error('usage: node scripts/map-fake-cover.mjs <map>… | --all  [--strict] [--kept]');
    process.exit(2);
  }
  let found = false;
  for (const id of ids) {
    const raw = readContent(`maps/${id}.json`);
    if (!raw) throw new Error(`no map content/maps/${id}.json`);
    const scan = scanMap(raw, id);
    if (scan.rows.length) found = true;
    console.log(`${id}: ${formatScan(scan, { showKept: argv.includes('--kept') })}`);
  }
  process.exit(argv.includes('--strict') && found ? 1 : 0);
}
