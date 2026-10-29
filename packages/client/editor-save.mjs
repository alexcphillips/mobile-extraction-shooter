// The map editor (session 15) and item editor (session 18) save content files through the dev server, so only `vite`
// on the Mac can write them; a build has no such endpoint. POST /__editor/save with
// { files: [{ file: "maps/<id>.json", doc }, …] } writes each doc formatted by Prettier, as
// `npm run format` would, laid out like the hand-written files (see `layout`). With
// `create: true` a file is new, refused if one is there. All are checked and formatted
// before any is written, so a map and the prefabs it uses go together (session 16b). The
// editors check the docs first; this only checks they're map, prefab or item files.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../content');
const FILE = /^(maps|prefabs|items)\/[a-z0-9][a-z0-9-]*\.json$/;

/** @returns {import('vite').Plugin} */
export function editorSave() {
  /** What was last written to each file, so the editor's own saves don't reload it. */
  const written = new Map();
  return {
    name: 'mes-editor-save',
    apply: 'serve',
    // After Vite's own plugins, so the content globs' reload for a new file can be skipped.
    enforce: 'post',
    configureServer(server) {
      // content/ is outside the client's root, so Vite doesn't watch it for new files; the
      // content globs only see a new map, prefab or item (made here, say) once it's watched.
      server.watcher.add(['maps', 'prefabs', 'items'].map((d) => resolve(CONTENT, d)));
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
            const { files } = JSON.parse(body);
            if (!Array.isArray(files) || !files.length)
              return reply(400, { error: 'no files to save' });
            const out = [];
            for (const { file, doc, create } of files) {
              if (typeof file !== 'string' || !FILE.test(file))
                return reply(400, { error: `not a map, prefab or item file: ${file}` });
              const path = resolve(CONTENT, file);
              const options = (await prettier.resolveConfig(path)) ?? {};
              const text = await prettier.format(layout(doc), { ...options, filepath: path });
              const old = await readFile(path, 'utf8').catch(() => null);
              if (create && old !== null) return reply(409, { error: `content/${file} exists` });
              out.push({ file, path, text, changed: old !== text });
            }
            for (const f of out) {
              if (!f.changed) continue;
              written.set(f.path, f.text);
              await writeFile(f.path, f.text);
            }
            reply(200, { changed: out.filter((f) => f.changed).map((f) => f.file) });
          } catch (err) {
            reply(500, { error: err instanceof Error ? err.message : String(err) });
          }
        });
      });
    },
    // hotUpdate (unlike handleHotUpdate) also sees new files, which the content globs pick
    // up with a full reload; the module graph is still updated for the next one.
    async hotUpdate({ file, read }) {
      const mine = written.get(file);
      if (mine === undefined) return;
      if (this.environment.name === 'client') written.delete(file);
      // The editor that saved it already has it; other tabs pick it up when reloaded.
      if ((await read()) === mine) return [];
    },
  };
}

/**
 * JSON for Prettier to format. Prettier keeps an object expanded if there's a line break
 * after its "{", and puts it on one line if it fits otherwise; arrays always go on one
 * line if they fit. So objects get the break, one key per line, except items of lists
 * other than nodes and zones (patrol stops, reticle shapes), which go on one line.
 */
export function layout(value, key = '', inList = false) {
  if (Array.isArray(value)) return `[${value.map((v) => layout(v, key, true)).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const body = Object.entries(value)
    .map(([k, v]) => `${JSON.stringify(k)}:${layout(v, k)}`)
    .join(',');
  const oneLine = inList && key !== 'nodes' && key !== 'zones';
  return oneLine ? `{${body}}` : `{\n${body}}`;
}
