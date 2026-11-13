// Turns British spellings into American ones across every tracked text file, and renames
// tracked files whose names have them (git mv). Run from the repo root:
//   node scripts/american-spelling.mjs [--dry]
// Case is kept: colour → color, Colour → Color, COLOUR → COLOR. Made 2026-11-11, when the
// codebase moved to American spelling (the user's call). Safe to run again: it finds nothing.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const dry = process.argv.includes('--dry');

/**
 * [british, american, word-start only]. Matched anywhere in a word unless word-start
 * only (so camelCase like cellCentre or holdsFavourite is caught), longer forms first.
 */
const WORDS = [
  ['centred', 'centered'],
  ['centring', 'centering'],
  ['centre', 'center'],
  ['metre', 'meter'],
  ['calibre', 'caliber'],
  ['armour', 'armor'],
  ['colour', 'color'],
  ['behaviour', 'behavior'],
  ['favour', 'favor'],
  ['neighbour', 'neighbor'],
  ['honour', 'honor'],
  ['jewellery', 'jewelry'],
  ['aluminium', 'aluminum'],
  ['licence', 'license'],
  ['grey', 'gray'],
  // "tyre" sits inside "PartyResponse" ignoring case, so only at a word's start.
  ['tyre', 'tire', true],
  ['labelled', 'labeled'],
  ['labelling', 'labeling'],
  ['modelled', 'modeled'],
  ['modelling', 'modeling'],
  ['cancelled', 'canceled'],
  ['levelled', 'leveled'],
  ['levelling', 'leveling'],
  ['cancelling', 'canceling'],
  ['signalling', 'signaling'],
  ['tunnelled', 'tunneled'],
  ['analogue', 'analog'],
  ['memois', 'memoiz'],
  ['normalis', 'normaliz'],
  ['serialis', 'serializ'],
  ['optimis', 'optimiz'],
  ['categoris', 'categoriz'],
  ['recognis', 'recogniz'],
];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Each spelling in lower, Capital and UPPER case, as [regex, replacement]. */
const RULES = WORDS.flatMap(([gb, us, start]) =>
  [
    [gb, us],
    [cap(gb), cap(us)],
    [gb.toUpperCase(), us.toUpperCase()],
  ].map(([from, to]) => [
    // Word start: not after a letter of the same case run (a lower-case letter before a
    // lower-case form, or any letter before a capital that isn't camelCase).
    new RegExp(start ? `(?<![A-Za-z])${from}` : from, 'g'),
    to,
  ]),
);

export function americanise(text) {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

// This file lists the British forms, so it's left as it is.
const SELF = 'scripts/american-spelling.mjs';
// Files that must keep British forms: the profile migration renames the old saved keys and ids
// (bodyArmour, armourer, …) and its test builds old profiles with them (2026-11-12).
const KEEP = [SELF, 'packages/shared/src/profile.ts', 'packages/shared/src/profile.test.ts'];

// Anything but --dry (a typo, --help) prints the usage instead of running.
const unknown = process.argv.slice(2).filter((a) => a !== '--dry');
if (unknown.length) {
  console.log('usage: node scripts/american-spelling.mjs [--dry]');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

// Tracked text files (-I in grep skips binaries): every file with any British form.
const any = WORDS.map(([gb]) => gb).join('|');
let files = [];
try {
  files = git('grep', '-I', '-l', '-i', '-E', any, '--', '.', ':!package-lock.json', ...KEEP.map((f) => `:!${f}`))
    .split('\n')
    .filter(Boolean);
} catch {
  // git grep exits 1 when nothing matches.
}

let changed = 0;
let hits = 0;
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  const after = americanise(before);
  if (after === before) continue;
  for (const [re] of RULES) hits += (before.match(re) ?? []).length;
  changed++;
  console.log(`${dry ? 'would change' : 'changed'} ${f}`);
  if (!dry) writeFileSync(f, after);
}

// Then rename tracked files whose paths have British spellings.
const renames = git('ls-files')
  .split('\n')
  .filter((f) => f && !KEEP.includes(f))
  .map((f) => [f, americanise(f)])
  .filter(([a, b]) => a !== b);
for (const [from, to] of renames) {
  console.log(`rename ${from} → ${to}`);
  if (!dry) git('mv', from, to);
}

console.log(
  `${dry ? 'would change' : 'changed'} ${hits} spellings in ${changed} files; ${renames.length} files renamed`,
);
