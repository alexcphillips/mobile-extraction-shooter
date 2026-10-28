// The map editor (session 15) saves content files through the dev server, so only `vite`
// on the Mac can write them; a build has no such endpoint. POST /__editor/save with
// { file: "maps/<id>.json", doc } writes the doc formatted by Prettier, as `npm run format`
// would, laid out like the hand-written files (see `layout`). The editor checks the doc first; this only checks it's a map or prefab file.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../content');
const FILE = /^(maps|prefabs)\/[a-z0-9][a-z0-9-]*\.json$/;

/** @returns {import('vite').Plugin} */
export function editorSave() {
  /** What was last written to each file, so the editor's own saves don't reload it. */
  const written = new Map();
  return {
    name: 'mes-editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor/save', (req, res) => {
        const reply = (status, body) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        // The dev server listens on the LAN for the phone, but only the Mac may save, and
        // only from the editor's own page (JSON can't be sent cross-site without CORS).
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        const origin = req.headers.origin;
        const sameOrigin = origin === undefined || new URL(origin).host === req.headers.host;
        if (!local || !sameOrigin) return reply(403, { error: 'saves only from this Mac' });
        if (req.headers['content-type'] !== 'application/json')
          return reply(415, { error: 'JSON only' });
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { file, doc } = JSON.parse(body);
            if (typeof file !== 'string' || !FILE.test(file))
              return reply(400, { error: `not a map or prefab file: ${file}` });
            const path = resolve(CONTENT, file);
            const options = (await prettier.resolveConfig(path)) ?? {};
            const text = await prettier.format(layout(doc), { ...options, filepath: path });
            const old = await readFile(path, 'utf8').catch(() => null);
            if (old !== text) {
              written.set(path, text);
              await writeFile(path, text);
            }
            reply(200, { file, changed: old !== text });
          } catch (err) {
            reply(500, { error: err instanceof Error ? err.message : String(err) });
          }
        });
      });
    },
    async handleHotUpdate(ctx) {
      const mine = written.get(ctx.file);
      if (mine === undefined) return;
      written.delete(ctx.file);
      // The editor that saved it already has it; other tabs pick it up when reloaded.
      if ((await ctx.read()) === mine) return [];
    },
  };
}

/**
 * JSON for Prettier to format. Prettier keeps an object expanded if there's a line break
 * after its "{", and puts it on one line if it fits otherwise; arrays always go on one
 * line if they fit. So objects get the break, one key per line, except items of lists
 * other than nodes and zones (patrol stops), which go on one line.
 */
function layout(value, key = '', inList = false) {
  if (Array.isArray(value)) return `[${value.map((v) => layout(v, key, true)).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const body = Object.entries(value)
    .map(([k, v]) => `${JSON.stringify(k)}:${layout(v, k)}`)
    .join(',');
  const oneLine = inList && key !== 'nodes' && key !== 'zones';
  return oneLine ? `{${body}}` : `{\n${body}}`;
}
