// Generator runs keep the user's hand edits (roadmap MK-2; tech/editors.md → Generated maps).
//
// A generator builds its whole map fresh each run, then `writeGenerated` merges it into the
// map on disk:
// - Every named group the script makes gets a key from its name path (`gen`, e.g.
//   "east-end/rail-yard"), and the map's `generated` record keeps a hash of each group's own
//   content as last written (its props and nodes, a keyed group inside counting only as its
//   key), and of each top-level field the script writes (terrain, zones, …).
// - On a re-run, a group still matching its hash is the script's: it's replaced. One that
//   doesn't was edited by hand: it's kept as it is, and said so. A key the record knows but
//   the map lacks was deleted by hand and isn't put back. Nodes without a key are the user's
//   and are kept where they are. Fields work the same way.
// - `--dry-run` prints what would change and writes nothing; `--reclaim <key>[,<key>]` (or
//   `all`) hands groups (and everything under them) or fields back to the script.
// - `--dump <file>` writes what the script made (before the merge) there as plain JSON and
//   touches nothing else (MK-6): run it before and after a refactor and compare the two.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import * as prettier from 'prettier';
import { layout } from '../../packages/client/editor-save.mjs';

/** Fields a generator never owns: the map's identity, its nodes and the record itself. */
const NOT_FIELDS = new Set(['formatVersion', 'id', 'nodes', 'generated']);

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const isKeyed = (n) => n?.type === 'group' && typeof n.gen === 'string';

/**
 * Gives every named group a `gen` key from its name path (unnamed groups count as part of
 * their parent), placed just after its name. Throws on a key used twice, or on a top-level
 * node without one: everything at the top is either the script's or the user's.
 */
export function tagGroups(nodes) {
  const seen = new Set();
  const walk = (list, prefix) =>
    list.map((n) => {
      if (n.type !== 'group') return n;
      if (!n.name) return { ...n, nodes: walk(n.nodes, prefix) };
      const key = [...prefix, slug(n.name)].join('/');
      if (seen.has(key)) throw new Error(`two generated groups would have the key "${key}"`);
      seen.add(key);
      const tagged = {};
      for (const [k, v] of Object.entries(n)) {
        if (k === 'gen') continue;
        tagged[k] = k === 'nodes' ? walk(v, [...prefix, slug(n.name)]) : v;
        if (k === 'name') tagged.gen = key;
      }
      return tagged;
    });
  const out = walk(nodes, []);
  const bare = out.find((n) => !isKeyed(n));
  if (bare) throw new Error(`a top-level ${bare.type} has no name, so no generator key`);
  return out;
}

/** JSON with keys sorted, so a hash doesn't depend on key order. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

export const hash = (v) => createHash('sha1').update(canonical(v)).digest('hex').slice(0, 12);

/** A group's own content: a keyed group inside counts only as its key. */
const own = (g) => ({ ...g, nodes: g.nodes.map((n) => (isKeyed(n) ? { gen: n.gen } : n)) });

/** Every keyed group in a node tree: key → { node, parent } (parent '' is the top). */
function index(nodes) {
  const found = new Map();
  const dups = [];
  const walk = (list, parent) => {
    for (const n of list) {
      if (n.type !== 'group') continue;
      if (isKeyed(n)) {
        if (found.has(n.gen)) dups.push(n);
        else found.set(n.gen, { node: n, parent });
        walk(n.nodes, n.gen);
      } else walk(n.nodes, parent);
    }
  };
  walk(nodes, '');
  // A second group with a key already used (copied by hand outside the editor) is the user's.
  for (const d of dups) delete d.gen;
  return found;
}

/** The record a fresh run would leave: each keyed group's and owned field's hash. */
export function record(map, by) {
  const groups = {};
  for (const [k, { node }] of index(map.nodes)) groups[k] = hash(own(node));
  const fields = {};
  for (const [k, v] of Object.entries(map)) if (!NOT_FIELDS.has(k)) fields[k] = hash(v);
  return { by, fields, groups };
}

/**
 * Merges a freshly generated map into the one on disk. Returns the map to write and one
 * report row per group and field: { key, status, note? }, status one of same, updated,
 * new, kept, removed, deleted.
 */
export function merge(old, fresh, { by, reclaim = [] } = {}) {
  fresh = { ...fresh, nodes: tagGroups(fresh.nodes) };
  delete fresh.generated;
  if (!old) return { map: { ...fresh, generated: record(fresh, by) }, rows: [] };
  old = structuredClone(old);
  // A map from before records (or made by hand): its groups keyed by name path as the script
  // would, as if the script had last written today's output. What matches is the script's;
  // what differs counts as hand-edited and is kept.
  if (!old.generated) {
    old.nodes = tagLoose(old.nodes, index(fresh.nodes));
    old.generated = record(fresh, by);
  }
  const rec = old.generated;
  const reclaimed = (k) =>
    reclaim.includes('all') || reclaim.some((r) => k === r || k.startsWith(`${r}/`));
  const rows = [];

  // Fields.
  const fields = {};
  const map = { formatVersion: fresh.formatVersion, id: fresh.id };
  const fieldKeys = new Set([
    ...Object.keys(fresh),
    ...Object.keys(rec.fields),
    ...Object.keys(old),
  ]);
  for (const k of fieldKeys) {
    if (NOT_FIELDS.has(k)) continue;
    const mine = k in old && (!(k in rec.fields) || hash(old[k]) !== rec.fields[k]);
    if (!(k in rec.fields) && !(k in fresh))
      map[k] = old[k]; // the user's own field
    else if (k in rec.fields && !(k in old) && !reclaimed(k)) {
      if (k in fresh) {
        rows.push({ key: k, status: 'deleted', note: 'removed by hand' });
        fields[k] = rec.fields[k];
      }
    } else if (mine && !reclaimed(k)) {
      map[k] = old[k];
      if (k in fresh) fields[k] = rec.fields[k] ?? hash(fresh[k]);
      rows.push({
        key: k,
        status: 'kept',
        note: changedNote(hash(fresh[k]), rec.fields[k], 'field'),
      });
    } else if (k in fresh) {
      map[k] = fresh[k];
      fields[k] = hash(fresh[k]);
      rows.push({
        key: k,
        status: k in old ? (hash(old[k]) === fields[k] ? 'same' : 'updated') : 'new',
      });
    } else rows.push({ key: k, status: 'removed', note: 'field the script no longer writes' });
  }

  // Groups: decide each key, then find where it lives.
  const was = index(old.nodes);
  const now = index(fresh.nodes);
  const status = new Map(); // key → 'gen' | 'hand' | 'removed' | 'deleted'
  for (const k of new Set([...was.keys(), ...now.keys(), ...Object.keys(rec.groups)])) {
    const o = was.get(k);
    const f = now.get(k);
    if (!o) {
      if (f) status.set(k, k in rec.groups && !reclaimed(k) ? 'deleted' : 'gen');
      continue;
    }
    const edited = rec.groups[k] === undefined || hash(own(o.node)) !== rec.groups[k];
    if (edited && !reclaimed(k)) status.set(k, 'hand');
    else status.set(k, f ? 'gen' : 'removed');
  }
  const homeOf = (k) => {
    const s = status.get(k);
    if (s === 'gen') return now.get(k).parent;
    if (s === 'hand') {
      let p = was.get(k).parent;
      while (p && status.get(p) === 'removed') p = was.get(p).parent;
      return p;
    }
    return undefined;
  };
  const children = new Map(); // parent key → keys living there
  for (const k of status.keys()) {
    const h = homeOf(k);
    if (h === undefined) continue;
    if (h && !['gen', 'hand'].includes(status.get(h))) {
      // A new group whose parent was deleted by hand goes with it.
      status.set(k, 'deleted');
      continue;
    }
    if (!children.has(h)) children.set(h, new Set());
    children.get(h).add(k);
  }

  const groups = {};
  // A list: the owner's base list in order (the script's for a group it owns, else the old
  // one), its keyed groups replaced by what lives there now, and keys living here that the
  // base list lacks put after their neighbor in the other list, or at the end.
  const build = (key, base, other) => {
    const here = children.get(key) ?? new Set();
    const out = [];
    const placed = new Set();
    const emit = (k) => {
      if (placed.has(k) || !here.has(k)) return;
      placed.add(k);
      out.push(node(k));
    };
    const walk = (list) => {
      for (const n of list) {
        if (isKeyed(n)) emit(n.gen);
        else if (n.type === 'group' && !n.name) out.push({ ...n, nodes: walkInto(n.nodes) });
        else out.push(n);
      }
    };
    // Unnamed groups hold their parent's keyed groups too; keep them in place.
    const walkInto = (list) => {
      const saved = out.splice(0);
      walk(list);
      return out.splice(0, out.length, ...saved);
    };
    walk(base);
    for (const k of here) {
      if (placed.has(k)) continue;
      const before = keyedOrder(other);
      const i = before.indexOf(k);
      const prev = before
        .slice(0, Math.max(i, 0))
        .reverse()
        .find((p) => placed.has(p));
      const at = prev ? out.findIndex((n) => isKeyed(n) && n.gen === prev) + 1 : out.length;
      placed.add(k);
      out.splice(at, 0, node(k));
    }
    return out;
  };
  const building = new Set();
  const node = (k) => {
    // The script's tree and the user's could disagree about which holds which.
    if (building.has(k)) throw new Error(`"${k}" would end up inside itself; --reclaim it`);
    building.add(k);
    const o = was.get(k)?.node;
    const f = now.get(k)?.node;
    const gen = status.get(k) === 'gen';
    const src = gen ? f : o;
    const built = { ...src, nodes: build(k, src.nodes, gen ? (o?.nodes ?? []) : (f?.nodes ?? [])) };
    if (gen) {
      groups[k] = hash(own(built));
      const s = !o ? 'new' : hash(own(o)) === groups[k] ? 'same' : 'updated';
      rows.push({ key: k, status: s });
    } else {
      groups[k] = rec.groups[k];
      rows.push({
        key: k,
        status: 'kept',
        note: f
          ? changedNote(hash(own(f)), rec.groups[k], 'group')
          : 'edited by hand; the script no longer makes it',
      });
    }
    return built;
  };
  map.nodes = build('', old.nodes, fresh.nodes);
  for (const [k, s] of status) {
    if (s === 'removed')
      rows.push({ key: k, status: 'removed', note: 'the script no longer makes it' });
    if (s === 'deleted') {
      rows.push({ key: k, status: 'deleted', note: 'deleted by hand' });
      if (k in rec.groups) groups[k] = rec.groups[k];
    }
  }
  // Fields first in the map's usual order, the record last.
  const ordered = {};
  for (const k of Object.keys(fresh)) if (k in map) ordered[k] = map[k];
  for (const k of Object.keys(map)) if (!(k in ordered)) ordered[k] = map[k];
  ordered.generated = { by, fields, groups };
  return { map: ordered, rows };
}

const changedNote = (now, last, what) =>
  now === last
    ? 'edited by hand'
    : `edited by hand; the script's ${what} changed too (--reclaim to take it)`;

const keyedOrder = (list) => {
  const out = [];
  const walk = (l) => {
    for (const n of l) {
      if (isKeyed(n)) out.push(n.gen);
      else if (n.type === 'group' && !n.name) walk(n.nodes);
    }
  };
  walk(list);
  return out;
};

/** Keys an untagged map's named groups by name path, where the script makes that key. */
function tagLoose(nodes, known) {
  const walk = (list, prefix) =>
    list.map((n) => {
      if (n.type !== 'group') return n;
      if (!n.name || n.gen) return { ...n, nodes: walk(n.nodes, prefix) };
      const key = [...prefix, slug(n.name)].join('/');
      const path = [...prefix, slug(n.name)];
      return known.has(key)
        ? { ...n, gen: key, nodes: walk(n.nodes, path) }
        : { ...n, nodes: walk(n.nodes, path) };
    });
  return walk(nodes, []);
}

/** The command line's options: --dry-run, --reclaim a,b, --dump file (a dry run too). */
export function options(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--reclaim');
  const reclaim = at >= 0 ? (argv[at + 1] ?? '').split(',').filter(Boolean) : [];
  if (at >= 0 && !reclaim.length)
    throw new Error('--reclaim needs a key, keys split by commas, or all');
  const d = argv.indexOf('--dump');
  const dump = d >= 0 ? argv[d + 1] : undefined;
  if (d >= 0 && !dump) throw new Error('--dump needs a file');
  return { dryRun: argv.includes('--dry-run') || !!dump, reclaim, dump };
}

const LABEL = {
  updated: 'replaced',
  new: 'added',
  kept: 'kept',
  removed: 'removed',
  deleted: 'not put back',
};

/** One short table of what changed; groups the same as before are only counted. */
export function report(rows) {
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const shown = rows.filter((r) => r.status !== 'same');
  const lines = [
    Object.entries(counts)
      .map(([s, n]) => `${n} ${s === 'same' ? 'unchanged' : LABEL[s]}`)
      .join(', '),
  ];
  const w = Math.max(0, ...shown.map((r) => r.key.length));
  for (const r of shown)
    lines.push(`  ${r.key.padEnd(w)}  ${LABEL[r.status]}${r.note ? ` (${r.note})` : ''}`);
  return lines.join('\n');
}

export async function writeJson(path, doc) {
  const options = (await prettier.resolveConfig(path)) ?? {};
  await writeFile(path, await prettier.format(layout(doc), { ...options, filepath: path }));
}

/**
 * Merges a generated map into its file (see the top of this file), prints the report and
 * writes it unless it's a dry run. `by` is the generator script's path.
 */
export async function writeGenerated({ file, map, by, root, argv }) {
  const { dryRun, reclaim, dump } = options(argv);
  if (dump) {
    await writeFile(dump, JSON.stringify({ ...map, nodes: tagGroups(map.nodes) }, null, 1));
    console.log(`${relative(root, file)}: dumped to ${dump}`);
    return { map, rows: [] };
  }
  const old = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
  const rel = relative(root, file);
  const { map: merged, rows } = merge(old, map, { by: relative(root, by), reclaim });
  console.log(`${rel}: ${old ? report(rows) : 'new file'}`);
  if (dryRun) console.log('(dry run: nothing written)');
  else await writeJson(file, merged);
  return { map: merged, rows };
}

/** Writes a file the generator only starts (a raid): never over one that exists. */
export async function writeOnce({ file, doc, root, argv }) {
  const rel = relative(root, file);
  if (!existsSync(file)) {
    if (!options(argv).dryRun) await writeJson(file, doc);
    console.log(`${rel}: new file`);
    return;
  }
  const old = JSON.parse(await readFile(file, 'utf8'));
  const differ = Object.keys(doc).filter((k) => hash(old[k]) !== hash(doc[k]));
  console.log(
    `${rel}: left as it is${differ.length ? ` (the script's differs in ${differ.join(', ')})` : ''}`,
  );
}
