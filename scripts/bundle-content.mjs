// Bundles the content files the server needs into one module it imports, since
// wrangler can't glob a directory the way Vite does. Keys are paths from the repo root
// ("content/items/knife.json"), as the client's loader sees them. Run before the server's
// dev, deploy, typecheck and tests; the output is gitignored.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = ['items', 'raids', 'starting-kits'];
const out = join(root, 'packages/server/src/generated/content.js');

/** Writes the bundle. The default export, so Vitest can run it as a globalSetup. */
export default function bundleContent() {
  const files = {};
  for (const kind of KINDS) {
    for (const name of readdirSync(join(root, 'content', kind)).sort()) {
      if (!name.endsWith('.json')) continue;
      const path = `content/${kind}/${name}`;
      files[path] = JSON.parse(readFileSync(join(root, path), 'utf8'));
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `export default ${JSON.stringify(files)};\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) bundleContent();
