#!/usr/bin/env node
// Checks the docs against the code and content (rules in docs/README.md).
// Usage: node scripts/docs-check.mjs [--quiet]   (exits 1 on errors; --quiet hides warnings)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const quiet = process.argv.includes('--quiet');
const rel = (p) => path.relative(root, p);

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'dist') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// Everything an id could legitimately name: content ids and filenames, and any text in code or content.
const contentFiles = walk(path.join(root, 'content'), (p) => p.endsWith('.json'));
const ids = new Set();
const vendorNames = new Map(); // display name -> id
for (const f of contentFiles) {
  ids.add(path.basename(f, '.json'));
  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    continue;
  }
  if (j && typeof j.id === 'string') ids.add(j.id);
  if (f.includes(`${path.sep}vendors${path.sep}`) && j?.name && j.name !== j.id)
    vendorNames.set(j.name, j.id);
}
const codeText = [
  ...walk(path.join(root, 'packages'), (p) => /\.(ts|tsx|js|mjs|css|json)$/.test(p)),
  ...walk(path.join(root, 'scripts'), (p) => /\.(mjs|js|ts)$/.test(p)),
  ...contentFiles,
]
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
const known = (id) => ids.has(id) || codeText.includes(id);

const docs = [
  path.join(root, 'CLAUDE.md'),
  ...walk(path.join(root, 'docs'), (p) => p.endsWith('.md')),
];
const featureDir = path.join(root, 'docs', 'features') + path.sep;
let errors = 0;
let warnings = 0;
const rows = [];
const report = (level, file, line, msg) => {
  if (level === 'error') errors++;
  else warnings++;
  if (level === 'error' || !quiet)
    rows.push(`${level === 'error' ? 'ERR ' : 'warn'}  ${rel(file)}:${line}  ${msg}`);
};

const exists = (file, target) => {
  const t = target.replace(/[#?].*$/, '');
  if (!t) return true;
  const bases = [
    path.dirname(file),
    root,
    path.join(root, 'packages'),
    ...['client', 'shared', 'server'].map((p) => path.join(root, 'packages', p, 'src')),
  ];
  return bases.some((b) => fs.existsSync(path.resolve(b, t)));
};

for (const file of docs) {
  const feature = file.startsWith(featureDir);
  const template = path.basename(file) === '_template.md';
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    // Links.
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const t = m[1];
      if (/^(https?:|mailto:|#)/.test(t)) continue;
      if (!exists(file, t)) report('error', file, n, `dead link: ${t}`);
    }
    // Backticked paths and ids.
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      const t = m[1];
      if (/[*<>{}$|]/.test(t) || t.startsWith('-')) continue;
      if (/^[\w.-]+\/[\w./-]*$/.test(t) && /(\.\w+|\/)$/.test(t) && !t.startsWith('docs-archive')) {
        if (!exists(file, t)) report('error', file, n, `missing path: ${t}`);
      } else if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(t) && !known(t)) {
        report(feature ? 'error' : 'warn', file, n, `unknown id: ${t}`);
      }
    }
    if (!feature || template) return;
    // Feature-doc-only rules.
    for (const [name, id] of vendorNames) {
      if (new RegExp(`\\b${name}\\b`).test(line))
        report('error', file, n, `vendor name "${name}": write \`${id}\``);
    }
    if (/\b20\d\d-\d\d-\d\d\b/.test(line))
      report('error', file, n, 'date: no history in feature docs');
    if (/\b(renamed|until 20|the user's request|\(was |was level)\b/i.test(line))
      report('error', file, n, 'history wording: state the decision as it stands');
    const nums = line.replace(/`[^`]*`/g, '').match(/\b\d+(?:[.,]\d+)*\b/g) ?? [];
    if (nums.length >= 3)
      report('warn', file, n, `${nums.length} numbers: values belong in content`);
  });
  if (feature && !template) {
    for (const h of ['## Rules', '## Decisions', '## Where it lives'])
      if (!lines.some((l) => l.trim() === h)) report('error', file, 1, `missing section "${h}"`);
    const words = text.split(/\s+/).length;
    if (words > 1200) report('warn', file, 1, `${words} words: split the feature (aim for 1,000)`);
  }
}

for (const r of rows) console.log(r);
console.log(`docs-check: ${docs.length} files, ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
