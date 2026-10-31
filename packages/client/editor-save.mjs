// The map editor (session 15), item editor (session 18) and sound editor (session 19) save
// content files through the dev server, so only `vite` on the Mac can write them; a build
// has no such endpoint. POST /__editor/save with
// { files: [{ file: "maps/<id>.json", doc }, …] } writes each doc formatted by Prettier, as
// `npm run format` would, laid out like the hand-written files (see `layout`). With
// `create: true` a file is new, refused if one is there. All are checked and formatted
// before any is written, so a map and the prefabs it uses go together (session 16b). The
// editors check the docs first; this only checks they're map, prefab, item or sound files.
//
// Notes (2026-10-30): GET /__editor/notes?map=<id> reads content/notes/<id>.json, and POST
// /__editor/note with { map, add: { pos, text } } or { map, remove: id } changes it, stamped
// with `git config user.name` and the date, so notes from play-tests and the map editor
// reach other developers through git. Open pages hear of a change as `mes:notes`.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../content');
const FILE = /^(maps|prefabs|items|sounds)\/[a-z0-9][a-z0-9-]*\.json$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const NOTES_FORMAT = 1;

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
      // content globs only see a new map, prefab, item or sound (made here, say) once it's watched.
      server.watcher.add(['maps', 'prefabs', 'items', 'sounds'].map((d) => resolve(CONTENT, d)));
      server.middlewares.use('/__editor/notes', (req, res) => {
        const map = new URL(req.url ?? '', 'http://x').searchParams.get('map') ?? '';
        if (!ID.test(map)) return reply(res, 400, { error: 'no map' });
        readNotes(map).then(
          (doc) => reply(res, 200, doc),
          (err) => reply(res, 500, { error: String(err) }),
        );
      });
      // One change at a time, so two notes written together both stay.
      let queue = Promise.resolve();
      server.middlewares.use('/__editor/note', (req, res) => {
        const refused = refuse(req);
        if (refused) return reply(res, ...refused);
        readBody(req, (body) => {
          queue = queue.then(async () => {
            try {
              const { map, add, remove } = JSON.parse(body);
              if (typeof map !== 'string' || !ID.test(map))
                return reply(res, 400, { error: 'no map' });
              const doc = await readNotes(map);
              if (add) {
                const { pos, text } = add;
                const point = Array.isArray(pos) && pos.length === 3 && pos.every(Number.isFinite);
                if (!point || typeof text !== 'string' || !text.trim())
                  return reply(res, 400, { error: 'a note needs a pos and some text' });
                doc.notes.push({
                  id: `note-${randomBytes(4).toString('hex')}`,
                  pos: pos.map((v) => Math.round(v * 100) / 100),
                  text: text.trim(),
                  author: await author(),
                  // The local day (en-CA writes YYYY-MM-DD).
                  date: new Date().toLocaleDateString('en-CA'),
                });
              } else if (typeof remove === 'string') {
                doc.notes = doc.notes.filter((n) => n.id !== remove);
              } else return reply(res, 400, { error: 'add or remove a note' });
              const path = notesPath(map);
              await mkdir(dirname(path), { recursive: true });
              const options = (await prettier.resolveConfig(path)) ?? {};
              await writeFile(
                path,
                await prettier.format(layout(doc), { ...options, filepath: path }),
              );
              server.ws.send({ type: 'custom', event: 'mes:notes', data: { map } });
              reply(res, 200, doc);
            } catch (err) {
              reply(res, 500, { error: err instanceof Error ? err.message : String(err) });
            }
          });
        });
      });
      server.middlewares.use('/__editor/save', (req, res) => {
        const reply = (status, body) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const refused = refuse(req);
        if (refused) return reply(...refused);
        readBody(req, async (body) => {
          try {
            const { files } = JSON.parse(body);
            if (!Array.isArray(files) || !files.length)
              return reply(400, { error: 'no files to save' });
            const out = [];
            for (const { file, doc, create } of files) {
              if (typeof file !== 'string' || !FILE.test(file))
                return reply(400, { error: `not a map, prefab, item or sound file: ${file}` });
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

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Why a write is refused, as [status, body], or null. The dev server listens on the LAN for
 * the phone, but only the Mac may write, and only from its own pages (JSON can't be sent
 * cross-site without CORS).
 */
function refuse(req) {
  if (req.method !== 'POST') return [405, { error: 'POST only' }];
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const origin = req.headers.origin;
  const sameOrigin = origin === undefined || new URL(origin).host === req.headers.host;
  if (!local || !sameOrigin) return [403, { error: 'saves only from this Mac' }];
  if (req.headers['content-type'] !== 'application/json') return [415, { error: 'JSON only' }];
  return null;
}

function readBody(req, then) {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => then(body));
}

const notesPath = (map) => resolve(CONTENT, 'notes', `${map}.json`);

/** A map's notes file, or an empty one. */
async function readNotes(map) {
  const text = await readFile(notesPath(map), 'utf8').catch(() => null);
  if (text === null) return { formatVersion: NOTES_FORMAT, map, notes: [] };
  return JSON.parse(text);
}

let gitName;
/** Who's writing: git's user.name, or the login name. */
function author() {
  gitName ??= new Promise((done) =>
    execFile('git', ['config', 'user.name'], (err, out) =>
      done((!err && out.trim()) || userInfo().username),
    ),
  );
  return gitName;
}

/**
 * JSON for Prettier to format. Prettier keeps an object expanded if there's a line break
 * after its "{", and puts it on one line if it fits otherwise; arrays always go on one
 * line if they fit. So objects get the break, one key per line, except items of lists
 * other than nodes and zones (patrol stops, reticle shapes, sound layers), which go on one
 * line if they fit, with whatever objects they hold (a layer's filter).
 */
export function layout(value, key = '', inList = false) {
  if (Array.isArray(value)) return `[${value.map((v) => layout(v, key, true)).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const oneLine = inList && key !== 'nodes' && key !== 'zones';
  const body = Object.entries(value)
    .map(([k, v]) => `${JSON.stringify(k)}:${layout(v, k, oneLine && !Array.isArray(v))}`)
    .join(',');
  return oneLine ? `{${body}}` : `{\n${body}}`;
}
