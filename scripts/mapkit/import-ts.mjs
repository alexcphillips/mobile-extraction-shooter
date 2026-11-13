// Lets a map script use the game's TypeScript (MK-3, 2026-11-12): the shared package's
// layouts, schemas and compiler, or a pure client module like the layout sketch. Node can't
// load them as they are (extensionless imports), so esbuild bundles the files asked for
// into one ES module under node_modules/.cache/mapkit, named by a hash of its text, and
// that is imported. Bundled afresh each run (a fraction of a second), so it's never stale.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = resolve(ROOT, 'node_modules/.cache/mapkit');

/** The shared package's entry, the usual thing to import. */
export const SHARED = 'packages/shared/src/index.ts';

/**
 * One module re-exporting everything from these files (paths from the repo root); names
 * two of them export clash. `@mes/shared` inside them resolves as in the packages.
 * @param {string[]} files
 * @returns {Promise<Record<string, any>>}
 */
export async function importTs(files = [SHARED]) {
  const entry = files.map((f) => `export * from ${JSON.stringify(resolve(ROOT, f))};`).join('\n');
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  });
  const text = result.outputFiles[0].text;
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 12);
  const out = resolve(CACHE, `${hash}.mjs`);
  if (!existsSync(out)) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(out, text);
  }
  return import(pathToFileURL(out).href);
}

/**
 * A content file (path from content/) read as JSON, or undefined if there's none.
 * @param {string} file
 */
export function readContent(file) {
  const path = resolve(ROOT, 'content', file);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** A path for messages: from the repo root. */
export const fromRoot = (path) => relative(ROOT, path);
