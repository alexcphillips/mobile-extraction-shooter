#!/usr/bin/env node
// Wipes accounts in the D1 database: inventories, money, quests and open raids go back to
// a new player's (packages/server/src/wipe.ts says exactly what and why). Run through
// `npm run wipe -- ...`. Changes nothing without --apply.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import bundleContent from './bundle-content.mjs';

const USAGE = `Usage: npm run wipe -- (--user <name> [--user <name> ...] | --all) [--apply] [--local]

  --user <name>  Wipe this account (repeatable; ignores case)
  --all          Wipe every account
  --apply        Do it, after a typed confirmation. Without this, only shows who'd be wiped
  --local        Use the local dev database instead of production`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(root, 'packages/server');

function stop(message) {
  console.error(message);
  process.exit(1);
}

function run(file, args, cwd) {
  const res = spawnSync(file, args, { cwd, encoding: 'utf8' });
  if (res.error) stop(`${file}: ${res.error.message}`);
  if (res.status !== 0) stop(`${file} ${args[0]} failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

function wrangler(...args) {
  return run(join(root, 'node_modules/.bin/wrangler'), args, server);
}

let flags;
try {
  flags = parseArgs({
    options: {
      user: { type: 'string', multiple: true, default: [] },
      all: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      local: { type: 'boolean', default: false },
    },
  }).values;
} catch (err) {
  stop(`${err.message}\n\n${USAGE}`);
}
if (flags.all === flags.user.length > 0) stop(USAGE);

const target = flags.all ? 'all' : flags.user;
const where = flags.local ? '--local' : '--remote';
const place = flags.local ? 'the LOCAL database' : 'PRODUCTION';

/** Rows from a read-only query. */
function query(sql) {
  const out = wrangler('d1', 'execute', 'mes', where, '--json', '--command', sql);
  return JSON.parse(out)[0].results;
}

// wipe.ts needs TypeScript and the bundled content, so it's built for this one run.
const temp = mkdtempSync(join(tmpdir(), 'mes-wipe-'));
try {
  bundleContent();
  const module = join(temp, 'wipe.mjs');
  await build({
    entryPoints: [join(server, 'src/wipe.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: module,
    logLevel: 'error',
  });
  const { wipeSql, wipeTargetsSql } = await import(pathToFileURL(module).href);

  const rows = query(wipeTargetsSql(target));
  if (target !== 'all') {
    const found = new Set(rows.map((r) => r.username.toLowerCase()));
    const missing = target.filter((name) => !found.has(name.toLowerCase()));
    if (missing.length)
      stop(`No such account in ${place}: ${missing.join(', ')}. Nothing changed.`);
  }
  if (!rows.length) stop(`No accounts in ${place}. Nothing changed.`);
  console.log(`In ${place}, ${rows.length} account(s) would be wiped:`);
  console.table(rows);

  if (!flags.apply) {
    console.log('Nothing changed. Add --apply to wipe them.');
    process.exit(0);
  }

  // A wipe writes this checkout's starting kit, so it has to match what's deployed: a
  // format or item the Worker doesn't know yet would break every wiped account.
  if (!flags.local) {
    const paths = ['content', 'packages/shared', 'packages/server/src'];
    const dirty = run('git', ['status', '--porcelain', '--', ...paths], root);
    if (dirty) stop(`Refusing: uncommitted game changes, which prod doesn't have:\n${dirty}`);
    const commit = run('git', ['rev-parse', '--short', 'HEAD'], root).trim();
    console.log(`Writing the starting kit from commit ${commit}: this must be what's deployed.`);
  }

  const phrase = `wipe ${rows.length} accounts`;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Type "${phrase}" to wipe them in ${place}: `);
  prompt.close();
  if (answer.trim() !== phrase) stop('Not confirmed. Nothing changed.');

  // Time Travel can put the whole database back to this point (7 days on the free plan).
  if (!flags.local) {
    const { bookmark } = JSON.parse(wrangler('d1', 'time-travel', 'info', 'mes', '--json'));
    if (!bookmark) stop('No Time Travel bookmark to come back to. Nothing changed.');
    console.log(`To undo: npx wrangler d1 time-travel restore mes --bookmark=${bookmark}`);
    console.log('(run in packages/server; that rolls back the whole database, not just these)');
  }

  // A file, not --command: wrangler's import is all-or-nothing.
  const file = join(temp, 'wipe.sql');
  writeFileSync(file, `${wipeSql(target, Date.now()).join(';\n')};\n`);
  wrangler('d1', 'execute', 'mes', where, '--yes', '--file', file);

  console.log('Done. They now have:');
  console.table(query(wipeTargetsSql(target)));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
