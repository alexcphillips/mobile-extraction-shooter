// Checks our character body and its animations (CH-3, 2026-11-13). Today only the fit report:
//
//   node scripts/anim-check.mjs --fit [--kit slot=item,...] [--each] [--outfit scav-2]
//
// --fit: for each worn item, its worst fit in each test pose (render/fit-check.ts's
// FIT_POSES until CH-5 brings clips), in cm: "through" is the covered body (or gear worn
// under it) poking out through the gear, "into" a limb, the gun or the other stack's gear
// sunk into it. Default kit: the CH-3 test kit (FIT_KIT). --kit replaces slots of it
// (helmet=steel-helmet,visor=); --each checks every helmet, body armor, rig and backpack
// alone on the bare body instead. --where adds where the worst point is (rest pose).
// --outfit adds that enemy outfit's plating to the body.
// CH-4 adds the clip checks (foot slide, head table) to this script.
import { readdirSync } from 'node:fs';
import { importTs, readContent, SHARED } from './mapkit/import-ts.mjs';

const args = process.argv.slice(2);
const opt = { fit: false, each: false, where: false, kit: {}, outfit: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--fit') opt.fit = true;
  else if (a === '--each') opt.each = true;
  else if (a === '--where') opt.where = true;
  else if (a === '--outfit') opt.outfit = args[++i];
  else if (a === '--kit')
    for (const pair of args[++i].split(',')) {
      const [slot, id] = pair.split('=');
      opt.kit[slot] = id || null;
    }
  else throw new Error(`unknown option ${a}`);
}
if (!opt.fit)
  throw new Error('usage: anim-check.mjs --fit [--kit slot=item,...] [--each] [--outfit scav-2]');

const ts = await importTs([
  SHARED,
  'packages/client/src/render/fit-check.ts',
  'packages/client/src/render/skeleton-pose.ts',
]);
const byId = (dir) =>
  Object.fromEntries(
    readdirSync(`content/${dir}`).map((f) => [`${dir}/${f}`, readContent(`${dir}/${f}`)]),
  );
const items = ts.loadById(ts.ITEM_FORMAT, byId('items'));
const skeleton = ts.compileSkeleton(
  ts.loadContent(ts.SKELETON_FORMAT, readContent('characters/skeleton.json'), 'skeleton'),
);
const body = ts.loadContent(ts.BODY_FORMAT, readContent('characters/body.json'), 'body');
let outfit;
if (opt.outfit) {
  const [enemy, n] = opt.outfit.split(/-(?=\d+$)/);
  const def = ts.loadContent(ts.ENEMY_FORMAT, readContent(`enemies/${enemy}.json`), enemy);
  outfit = def.outfits?.[Number(n ?? 1) - 1];
  if (!outfit) throw new Error(`${opt.outfit}: no such outfit`);
}

const kits = [];
if (opt.each) {
  for (const [id, def] of items) {
    const slot =
      def.type === 'armor'
        ? def.slot === 'helmet'
          ? 'helmet'
          : 'armor'
        : def.type === 'container'
          ? def.slot
          : null;
    if (['helmet', 'armor', 'rig', 'backpack'].includes(slot)) kits.push({ [slot]: id });
  }
} else {
  const kit = { ...ts.FIT_KIT };
  for (const [slot, id] of Object.entries(opt.kit)) {
    if (!ts.FIT_SLOTS.includes(slot))
      throw new Error(`${slot}: not a worn slot (${ts.FIT_SLOTS.join(', ')})`);
    if (id) kit[slot] = id;
    else delete kit[slot];
  }
  kits.push(kit);
}

const rows = kits.flatMap((kit) => ts.fitCheck(body, skeleton, kit, items, ts.FIT_POSES, outfit));
const names = ts.FIT_POSES.map((p) => p.name);
const cm = (m) => (m < 0.005 ? '·' : (m * 100).toFixed(1));
// Into: the deepest point (cm) and the area sunk in (cm²), as "1.2 30".
const into = (c) => (c.into < 0.005 ? '·' : `${cm(c.into)} ${Math.round(c.intoArea * 1e4)}`);
const width = Math.max(...rows.map((r) => r.item.length)) + 2;
for (const [what, cell, col, note] of [
  ['through', (c) => cm(c.through), 6, 'cm; · under 0.5'],
  ['into', into, 9, 'deepest cm, then area sunk in, cm²'],
]) {
  console.log(`\n${what} (${note})`);
  console.log(''.padEnd(width) + names.map((n) => n.padStart(col)).join('') + '   worst');
  for (const r of rows) {
    let at = 0;
    r.cells.forEach((c, i) => {
      if (c[what] > r.cells[at][what] + 1e-4) at = i;
    });
    const worst = r.cells[at];
    const where = opt.where ? ` at ${worst[`${what}At`].map((n) => n.toFixed(3)).join(', ')}` : '';
    const by = worst[what] >= 0.005 ? `${worst[`${what}By`]} in ${names[at]}${where}` : '';
    console.log(
      r.item.padEnd(width) + r.cells.map((c) => cell(c).padStart(col)).join('') + `   ${by}`,
    );
  }
}
