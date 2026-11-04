// Runs the command it's given (wrangler dev) and rebuilds the server's content bundle
// whenever content/ changes, so the server never checks raids against stale items.
// Wrangler reloads when the bundle changes.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bundleContent from './bundle-content.mjs';

const content = join(dirname(fileURLToPath(import.meta.url)), '../content');
const SETTLE_MS = 200;

// A save can fire several events, and can catch a file half written. A bad file keeps the
// last good bundle until the next save.
let timer;
watch(content, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      bundleContent();
      console.log('[content] rebundled');
    } catch (error) {
      console.error(`[content] kept the last bundle: ${error.message}`);
    }
  }, SETTLE_MS);
});

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
