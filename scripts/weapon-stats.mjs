// Every gun's stats with its default parts, as points and what they work out to
// (features/weapon-stats.md). With --against, only what changed from other item content:
// a directory of item files, or a git ref (its content/items). Older formats load through
// the item migrations, so a ref from before points compares too.
//
//   node scripts/weapon-stats.mjs [gun-id ...] [--against <dir|git-ref>]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { against: { type: 'string' } },
});

const temp = mkdtempSync(join(tmpdir(), 'weapon-stats-'));
try {
  const module = join(temp, 'stats.mjs');
  await build({
    stdin: {
      contents: `
        export * from './packages/shared/src/content/items';
        export * from './packages/shared/src/content/format';
        export * from './packages/shared/src/sim/weapons';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: module,
    logLevel: 'error',
  });
  const S = await import(pathToFileURL(module).href);

  /** Items by id from a directory of item files. */
  const load = (files) => {
    const items = new Map();
    for (const [name, text] of files) {
      const def = S.loadContent(S.ITEM_FORMAT, JSON.parse(text), name);
      items.set(def.id, def);
    }
    return items;
  };
  const fromDir = (dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
  const fromRef = (ref) =>
    execFileSync('git', ['ls-tree', '--name-only', `${ref}:content/items`], { cwd: root })
      .toString()
      .split('\n')
      .filter((f) => f.endsWith('.json'))
      .map((f) => [
        f,
        execFileSync('git', ['show', `${ref}:content/items/${f}`], { cwd: root }).toString(),
      ]);

  /** A gun's row with its default parts: points, then what they come to. */
  const row = (items, id) => {
    const def = items.get(id);
    const w = S.createWeapon(items, id, Object.values(def.defaults ?? {}));
    const s = S.weaponStats(items, w, S.createWeaponStats());
    const r = (n, d = 2) => +n.toFixed(d);
    return {
      ...Object.fromEntries(S.GUN_STATS.map((k) => [k, Math.round(s.points[k])])),
      kickUp: r(s.recoilUp),
      kickSide: r(s.recoilSide),
      recovery: r(s.recoilRecovery),
      jump: r(S.jumpAt(s.points.stability)),
      aim: r(s.aimTime, 3),
      draw: r(S.drawTimeAt(s.points.handling)),
      reload: r(s.reloadTime),
      hip: r(s.hipSpread),
      aimed: r(s.aimSpread, 3),
      stopsAt: Math.round(s.range),
      heard: Math.round(s.loudness),
    };
  };

  const now = load(fromDir(join(root, 'content/items')));
  const before = values.against
    ? load(
        values.against.includes('/') || values.against.startsWith('.')
          ? fromDir(values.against)
          : fromRef(values.against),
      )
    : null;
  const guns = [...now.values()]
    .filter((d) => d.type === 'weapon' && !d.spawns)
    .filter((d) => !positionals.length || positionals.includes(d.id))
    .map((d) => d.id)
    .sort();

  // Points keys, then values: points first, as the bars show them.
  const POINTS = S.GUN_STATS;
  for (const id of guns) {
    const a = row(now, id);
    if (!before) {
      const pts = POINTS.map((k) => `${k} ${a[k]}`).join(' · ');
      const vals = Object.entries(a)
        .filter(([k]) => !POINTS.includes(k))
        .map(([k, v]) => `${k} ${v}`)
        .join(' · ');
      console.log(`${id}\n  ${pts}\n  ${vals}`);
      continue;
    }
    if (!before.has(id)) {
      console.log(`${id}: new`);
      continue;
    }
    const b = row(before, id);
    const diffs = Object.keys(a)
      .filter((k) => a[k] !== b[k])
      .map((k) => {
        const pct =
          POINTS.includes(k) || !b[k]
            ? ''
            : ` (${a[k] > b[k] ? '+' : ''}${Math.round((a[k] / b[k] - 1) * 100)}%)`;
        return `${k} ${b[k]}→${a[k]}${pct}`;
      });
    console.log(`${id}: ${diffs.length ? diffs.join(' · ') : 'same'}`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
