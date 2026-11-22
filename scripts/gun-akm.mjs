// The AKM's model (GM-3), the `ak` family's reference build, on the family's shared body in
// gun-ak.mjs (receiver, railed dust cover, notch and post irons, gas system, handguards,
// grip). Its own parts here: the slant brake, the fixed stock, the points and mounts. Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-akm.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AK, akRifle, hull2d, keptFolds, mountsFor } from './gun-ak.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/akm.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { SLOT, POLY, POLY_HI, STEEL, PIN, RUBBER, BORE } = AK;

// ---- Key sizes everything hangs off (the rest of the layout is the family's, in akRifle)
const B = 0.012; // bore height
const RW = 0.0145; // receiver half width
const RTOP = B + 0.01; // receiver walls' top, under the cover
const RBOT = B - 0.034; // receiver bottom: the magazine's mouth
const RZ0 = -0.105; // receiver front
const RZ1 = 0.13; // receiver rear: the stock's front
const GZ = [-0.352, -0.322]; // gas block [front, rear]: the front sight on it
const HZ0 = -0.28; // lower handguard front
const HW = 0.0225; // lower handguard half width
const HBOT = B - 0.027;
const MUZZLE_Z = -0.482; // where a muzzle device threads on

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
// The body: receiver, railed cover, notch and post irons, gas system, handguards, grip.
const body = akRifle(kit, {
  B,
  RW,
  RTOP,
  RBOT,
  RZ0,
  RZ1,
  GZ,
  HZ0,
  HW,
  HBOT,
  MUZZLE_Z,
  railSides: [1, -1],
});

// ================= Slant brake (factory, hidden by a muzzle device): its front cut back on
// top so the gas kicks the muzzle down and left of the climb.
const BR = 0.0108;
const brakeZ = (y) => MUZZLE_Z - 0.031 - ((B - y) / (2 * BR)) * 0.014;
const ring = roundOutline(10)(BR).map(([x, y]) => [x, y + B]);
const brakePts = ring.flatMap(([x, y]) => [
  [x, y, MUZZLE_Z + 0.004],
  [x, y, brakeZ(y)],
]);
const bc = [0, B, (MUZZLE_Z + 0.004 + brakeZ(B)) / 2];
add({
  type: 'hull',
  pos: v3(bc),
  points: brakePts.map((p) => v3([p[0] - bc[0], p[1] - bc[1], p[2] - bc[2]])),
  color: STEEL,
  name: 'slant brake',
  group: 'muzzle',
  hiddenBy: 'muzzle',
});
// The brake's bore and its relief cut, dark.
add({
  type: 'panel',
  pos: v3([0, B - 0.002, brakeZ(B - 0.002) - 0.0003]),
  pitch: 90,
  points: roundOutline(8)(0.0042).map(v3),
  color: BORE,
  name: 'muzzle bore',
  group: 'muzzle',
  hiddenBy: 'muzzle',
});
tubeZ('muzzle', 'brake collar', B, MUZZLE_Z + 0.004, MUZZLE_Z + 0.0005, 0.0092, SLOT, {
  sides: 10,
  hiddenBy: 'muzzle',
});
tubeX('muzzle', 'brake detent', [0, B - BR + 0.0012, MUZZLE_Z + 0.001], 0.0012, 0.008, PIN, {
  sides: 6,
  hiddenBy: 'muzzle',
});

// ================= The fixed stock (factory, hidden by a fitted stock): straight comb, the
// toe line falling to a deep butt, a steel butt plate and the rear tang over its front.
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ1 = 0.372; // the butt plate's front
prism(
  ST,
  'stock',
  [
    [RTOP - 0.002, RZ1 + 0.001, 0.0128],
    [B - 0.004, SZ1, 0.0188],
    [B - 0.121, SZ1, 0.0188],
    [B - 0.104, SZ1 - 0.06, 0.017],
    [RBOT + 0.002, RZ1 + 0.001, 0.0128],
  ],
  POLY,
  hide,
);
// A lighter strip down the comb and the wrist's edge, so the stock reads in two shades.
prism(
  ST,
  'stock comb',
  [
    [RTOP - 0.0012, RZ1 + 0.03],
    [B - 0.0032, SZ1 - 0.004],
    [B - 0.0072, SZ1 - 0.004],
    [RTOP - 0.0052, RZ1 + 0.03],
  ].map(([y, z]) => [y, z, 0.0148 + ((z - RZ1) / (SZ1 - RZ1)) * 0.0028]),
  POLY_HI,
  hide,
);
// An inset panel down each side, a step darker, following the stock's taper.
const sw = (z) => 0.0128 + ((z - RZ1) / (SZ1 - RZ1)) * 0.006 + 0.0003;
prism(
  ST,
  'stock panel',
  [
    [B - 0.014, RZ1 + 0.05],
    [B - 0.016, SZ1 - 0.03],
    [B - 0.088, SZ1 - 0.03],
    [RBOT - 0.014, RZ1 + 0.05],
  ].map(([y, z]) => [y, z, sw(z)]),
  '#323539',
  hide,
);
box(ST, 'rear tang', [0, RTOP - 0.0004, RZ1 + 0.02], [0.012, 0.0024, 0.04], STEEL, hide);
tubeX(ST, 'tang screw', [0, RTOP + 0.0008, RZ1 + 0.03], 0.0016, 0.0036, PIN, {
  sides: 6,
  roll: 0,
  ...hide,
});
// Butt plate: steel, a hair larger than the stock's end, with its trap door.
extrudeZ(
  ST,
  'butt plate',
  hull2d([
    [-0.0196, B - 0.0035],
    [0.0196, B - 0.0035],
    [0.0196, B - 0.1215],
    [-0.0196, B - 0.1215],
  ]),
  SZ1,
  SZ1 + 0.006,
  STEEL,
  hide,
);
box(ST, 'butt trap', [0, B - 0.03, SZ1 + 0.0062], [0.022, 0.03, 0.0008], RUBBER, hide);
// Sling swivel on the left.
tubeX(ST, 'sling swivel', [-0.0186, B - 0.074, SZ1 - 0.02], 0.0055, 0.003, STEEL, {
  sides: 8,
  ...hide,
});
tubeX(ST, 'sling swivel hole', [-0.0202, B - 0.074, SZ1 - 0.02], 0.003, 0.0005, SLOT, {
  sides: 8,
  ...hide,
});

// ---- Points and mounts
const model = {
  parts,
  grip: body.grip,
  support: body.support,
  muzzle: [0, B, brakeZ(B)],
  sight: body.sight,
  ...keptFolds(ITEM),
  mounts: mountsFor(ITEM.slots, body.mounts),
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
