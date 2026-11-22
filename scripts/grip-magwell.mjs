// Each rear grip's look on a gun whose grip wraps the magazine well (GM-4, the user's call:
// grips stay one item per platform or class, with the same stats everywhere, and only look
// different on such a gun). Writes `model.magwell` into every grip that fits a gun with
// `model.magwellGrip`: a shell round the standard well (MAGWELL_WELL in models.ts), built
// from the grip's own look so it reads as the same grip: its body color and thickness, its
// finger grooves, palm swell, texture panels and base plate where it has them.
//
//   node scripts/grip-magwell.mjs [--dry]
//
// A grip's normal look is the source: change that, then re-run. Hand edits to a `magwell`
// look are overwritten, so make them here.
import fs from 'node:fs';
import { gunParts, v3, writeModel } from './gun-kit.mjs';

const DIR = new URL('../content/items/', import.meta.url).pathname;
// MAGWELL_WELL in packages/shared/src/content/models.ts: the well's half width, half
// length along z and depth, from the grip mount at its top center.
const WELL = { halfWidth: 0.0125, halfLength: 0.022, depth: 0.086 };

const items = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: DIR + f, item: JSON.parse(fs.readFileSync(DIR + f, 'utf8')) }));
const magwellGuns = items.filter((x) => x.item.type === 'weapon' && x.item.model?.magwellGrip);
/** fitsIn's lists (items.ts → listsGun): by id, platform or class, or no lists at all. */
const lists = (g, w) =>
  (!g.weapons && !g.platforms && !g.classes) ||
  !!g.weapons?.includes(w.id) ||
  (!!w.platform && !!g.platforms?.includes(w.platform)) ||
  (!!w.class && !!g.classes?.includes(w.class));
const grips = items.filter(
  (x) =>
    x.item.type === 'attachment' &&
    x.item.slot === 'grip' &&
    magwellGuns.some((g) => g.item.slots?.includes('grip') && lists(x.item, g.item)),
);

const named = (parts, name) => parts.filter((p) => p.name === name);

for (const { file, item } of grips) {
  const own = item.model.parts;
  const body = named(own, 'grip')[0] ?? own[0];
  // How much bulkier than a slim grip this one is, from its normal width.
  const extra = Math.max(0, body.size?.[0] - 0.027 || 0) / 2;
  const W = WELL.halfWidth + 0.004 + extra; // the shell's half width
  const Z0 = -WELL.halfLength - 0.008; // the front strap
  const Z1 = WELL.halfLength + 0.01 + extra * 2; // the back strap, fuller for the palm
  const BOT = -WELL.depth + 0.003; // above the well's collar, which stays
  const kit = gunParts();
  const { parts, box, prism } = kit;
  const G = 'grip';
  prism(
    G,
    'grip shell',
    [
      [-0.0005, Z0],
      [-0.0005, Z1],
      [-0.04, Z1 + 0.002],
      [BOT + 0.004, Z1 - 0.002],
      [BOT, Z1 - 0.006],
      [BOT, Z0 + 0.002],
      [-0.048, Z0 - 0.002],
    ].map(([y, z]) => [y, z, W]),
    body.color,
  );
  // A palm swell on the back strap where the grip has one.
  const swell = named(own, 'palm swell')[0];
  if (swell)
    box(G, 'palm swell', [0, -0.036, Z1 + 0.003], [2 * W - 0.004, 0.036, 0.004], swell.color);
  // Texture panels either side where it has them, else a plain recessed panel.
  const panel = named(own, 'texture panel')[0];
  for (const s of [1, -1])
    box(
      G,
      panel ? 'texture panel' : 'side panel',
      [s * (W + 0.0003), -0.044, (Z0 + Z1) / 2],
      [0.0008, 0.048, Z1 - Z0 - 0.014],
      panel?.color ?? '#303236',
    );
  // Finger grooves across the front strap where it has them.
  const groove = named(own, 'finger groove')[0];
  if (groove)
    for (const y of [-0.026, -0.05, -0.072])
      box(G, 'finger groove', [0, y, Z0 - 0.0015], [2 * W - 0.006, 0.005, 0.002], groove.color);
  // Its base plate as a band round the shell's foot.
  const base = named(own, 'base plate')[0];
  if (base)
    box(
      G,
      'base plate',
      [0, BOT + 0.002, (Z0 + Z1) / 2],
      [2 * W + 0.002, 0.004, Z1 - Z0 + 0.002],
      base.color,
    );
  const magwell = { parts, grip: v3([0, -0.042, (Z0 + Z1) / 2]) };
  const changed = await writeModel(file, { ...item.model, magwell });
  console.log(item.id, parts.length, 'parts', changed ? '' : '(unchanged)');
}
