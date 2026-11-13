// The prefab catalog (MK-5, 2026-11-12): what each prefab is, measured from the real
// compiler, so a session finds one to reuse without reading its file. Used by
// scripts/prefabs.mjs; detail in docs/tech/editors.md → Prefab catalog.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { importTs, readContent, SHARED } from './import-ts.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Height classes by the top of what collides (docs/level-design.md → cover height): low
 * hides only a prone body, waist a crouched one, eye blocks a standing eye (1.6 m), tall is
 * wall or building sized. "drawn" collides with nothing.
 */
export const HEIGHTS = [
  ['low', 0.6],
  ['waist', 1.6],
  ['eye', 3],
  ['tall', Infinity],
];

export function heightClass(top) {
  if (top === null) return 'drawn';
  return HEIGHTS.find(([, below]) => top < below)[0];
}

let libPromise;
/** The shared package and the client's triangle builder, bundled once. */
export function loadLib() {
  libPromise ??= importTs([SHARED, 'packages/client/src/render/geometry.ts']);
  return libPromise;
}

/** Every prefab file, by id. */
export async function loadPrefabs() {
  const lib = await loadLib();
  const files = {};
  for (const f of readdirSync(resolve(ROOT, 'content/prefabs')))
    if (f.endsWith('.json')) files[`content/prefabs/${f}`] = readContent(`prefabs/${f}`);
  return lib.loadById(lib.PREFAB_FORMAT, files);
}

/** Every map file as raw JSON, by id (only its nodes are read). */
export function loadMaps() {
  const maps = new Map();
  for (const f of readdirSync(resolve(ROOT, 'content/maps')))
    if (f.endsWith('.json')) maps.set(f.slice(0, -5), readContent(`maps/${f}`));
  return maps;
}

/** How many times each prefab is placed directly in these nodes (groups walked into). */
function directCounts(nodes, out = new Map()) {
  for (const n of nodes) {
    if (n.type === 'prefab') out.set(n.prefab, (out.get(n.prefab) ?? 0) + 1);
    else if (n.type === 'group') directCounts(n.nodes, out);
  }
  return out;
}

/**
 * Copies of every prefab in these nodes, nested ones included (a placed table-and-chairs
 * counts its chairs).
 */
function allCounts(nodes, prefabs, memo) {
  const out = new Map();
  for (const [id, n] of directCounts(nodes)) {
    out.set(id, (out.get(id) ?? 0) + n);
    const inner = prefabCounts(id, prefabs, memo);
    for (const [k, m] of inner) out.set(k, (out.get(k) ?? 0) + n * m);
  }
  return out;
}

function prefabCounts(id, prefabs, memo) {
  if (memo.has(id)) return memo.get(id);
  memo.set(id, new Map()); // a cycle counts as nothing (the schema check reports it)
  const p = prefabs.get(id);
  const out = p ? allCounts(p.nodes, prefabs, memo) : new Map();
  memo.set(id, out);
  return out;
}

const isAt0 = (n) =>
  n.pos.every((v) => v === 0) && !(n.yaw ?? 0) && !(n.pitch ?? 0) && !(n.roll ?? 0);

/** Searched looks named by any prefab's containers, by look id: the container's prefab. */
function searchedLooks(prefabs) {
  const looks = new Map();
  const walk = (owner, nodes) => {
    for (const n of nodes) {
      if (n.loot?.searched) looks.set(n.loot.searched, owner);
      if (n.type === 'group') walk(owner, n.nodes);
    }
  };
  for (const p of prefabs.values()) walk(p.id, p.nodes);
  return looks;
}

/** Bounds of a list of x, y, z triples. */
function bounds(pos) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[i + k]);
      hi[k] = Math.max(hi[k], pos[i + k]);
    }
  return { lo, hi };
}

/**
 * One prefab measured as placed at the origin, yaw 0 (nested prefabs included).
 * @returns {Promise<object>}
 */
export async function measurePrefab(id, prefabs) {
  const lib = await loadLib();
  const c = lib.compileNodes([{ type: 'prefab', prefab: id, pos: [0, 0, 0] }], prefabs, {});
  const tb = new lib.TriangleBuilder(true);
  for (const s of c.shapes) tb.shape(s);
  // The builder keeps its corners private; read them for the bounds (checked in the test).
  const pos = [...tb.pos];
  for (const d of [...c.doors, ...c.glass]) {
    // A door or pane as its upright rectangle; close enough for a size.
    const w = (d.width ?? d.hx * 2) / 2;
    const s = Math.sin(d.yaw);
    const k = Math.cos(d.yaw);
    for (const e of [-w, w]) pos.push(d.x + k * e, d.y, d.z - s * e);
    pos.push(d.x, d.y + (d.height ?? d.hy * 2), d.z);
  }
  const { lo, hi } = bounds(pos);
  const size = lo[0] === Infinity ? null : [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const tops = [
    ...c.boxes.map((b) => b.y + b.hy),
    ...c.ramps.map((r) => Math.max(r.low, r.high)),
    ...c.doors.filter((d) => !d.look || d.look.length).map((d) => d.y + d.height),
  ];
  const top = tops.length ? Math.max(...tops) : null;
  const containers = c.markers.filter((m) => m.type === 'lootContainer');
  const spots = c.markers.filter((m) => m.type === 'lootSpawn');
  return {
    size,
    triangles: tb.triangles + 12 * (c.doors.length + c.glass.length),
    solids: c.boxes.length + c.ramps.length,
    top,
    height: heightClass(top),
    containers: [...new Set(containers.map((m) => m.container))],
    containerCount: containers.length,
    spots: spots.length,
    doors: c.doors.length,
    glass: c.glass.length,
  };
}

/**
 * The whole catalog: a row per prefab with its measures, tags, what it's built on, where
 * it's used (copies per map, nested ones included) and which prefabs hold it.
 */
export async function catalog(prefabs = undefined, maps = undefined) {
  prefabs ??= await loadPrefabs();
  maps ??= loadMaps();
  const memo = new Map();
  const perMap = new Map();
  for (const [id, m] of maps) perMap.set(id, allCounts(m.nodes ?? [], prefabs, memo));
  const looks = searchedLooks(prefabs);
  const holders = new Map();
  for (const p of prefabs.values())
    for (const [id] of directCounts(p.nodes)) holders.set(id, [...(holders.get(id) ?? []), p.id]);
  const rows = [];
  for (const p of [...prefabs.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const m = await measurePrefab(p.id, prefabs);
    const base = p.nodes.find((n) => n.type === 'prefab' && isAt0(n));
    const uses = {};
    for (const [map, counts] of perMap) if (counts.get(p.id)) uses[map] = counts.get(p.id);
    rows.push({
      id: p.id,
      name: p.name ?? '',
      tags: p.tags ?? [],
      instanced: !!p.instanced,
      building: !!p.building,
      landmark: !!p.landmark,
      colors: Object.keys(p.colors ?? {}),
      ...m,
      // Built on another prefab, at its origin: a recolor, or the parent plus parts.
      variantOf: base ? base.prefab : null,
      variantKind: base ? (p.nodes.length === 1 ? 'recolor' : 'adds parts') : null,
      lookOf: looks.get(p.id) ?? null,
      heldBy: holders.get(p.id) ?? [],
      uses,
      total: Object.values(uses).reduce((a, b) => a + b, 0),
    });
  }
  return rows;
}

/** Rows matching a query: every word must be in the id, the name or a tag. */
export function search(rows, words) {
  const ws = words.map((w) => w.toLowerCase());
  return rows.filter((r) =>
    ws.every((w) => r.id.includes(w) || r.name.toLowerCase().includes(w) || r.tags.includes(w)),
  );
}
