// The AKS-74U's model (GM-3), on the `ak` family's shared body in gun-ak.mjs (receiver, railed
// dust cover, notch and post irons, gas system, handguards, grip), cut short: a short
// handguard, the gas block and front sight close to the muzzle. Its own parts here: the
// booster, the folding triangle stock, the points and mounts. Replaces only `model` in its
// item file. See docs/guns.md.
//
//   node scripts/gun-aks-74u.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AK, akRifle, keptFolds, mountsFor } from './gun-ak.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/aks-74u.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { SLOT, STEEL, PIN, RUBBER, BORE, BAND, REC } = AK;

// ---- Key sizes everything hangs off (the rest of the layout is the family's, in akRifle)
const B = 0.012; // bore height
const RW = 0.0145; // receiver half width
const RTOP = B + 0.01; // receiver walls' top, under the cover
const RBOT = B - 0.034; // receiver bottom: the magazine's mouth
const RZ0 = -0.105; // receiver front
const RZ1 = 0.13; // receiver rear: the stock's front
const GZ = [-0.247, -0.217]; // gas block [front, rear]: the front sight on it
const HZ0 = -0.203; // lower handguard front
const HW = 0.0225; // lower handguard half width
const HBOT = B - 0.027;
const MUZZLE_Z = -0.268; // where a muzzle device threads on

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism } = kit;
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
  irons: 'flip',
  barrelSlot: false,
  FOREGRIP_Z: -0.154,
});

// ================= The booster (factory, hidden by a muzzle device): a wide expansion
// chamber on a collar, tapering to a coned nose.
const M = { hiddenBy: 'muzzle' };
const NOSE = MUZZLE_Z - 0.071;
tubeZ('muzzle', 'booster collar', B, MUZZLE_Z + 0.003, MUZZLE_Z - 0.007, 0.0094, SLOT, {
  sides: 10,
  ...M,
});
tubeZ('muzzle', 'booster', B, MUZZLE_Z - 0.007, MUZZLE_Z - 0.056, 0.0142, STEEL, {
  sides: 12,
  ...M,
});
// The cone: a cylinder pitched along z, its top toward the eye.
add({
  type: 'cylinder',
  pos: v3([0, B, (MUZZLE_Z - 0.056 + NOSE) / 2]),
  pitch: 90,
  radius: 0.0098,
  radiusTop: 0.0142,
  height: 0.015,
  sides: 12,
  color: STEEL,
  name: 'booster cone',
  group: 'muzzle',
  ...M,
});
// Two rings round the chamber, a step lighter, and the bore at the nose.
for (const z of [MUZZLE_Z - 0.018, MUZZLE_Z - 0.045])
  tubeZ('muzzle', 'booster ring', B, z + 0.0015, z - 0.0015, 0.0146, BAND, { sides: 12, ...M });
add({
  type: 'panel',
  pos: v3([0, B, NOSE - 0.0003]),
  pitch: 90,
  points: roundOutline(8)(0.0058).map(v3),
  color: BORE,
  name: 'muzzle bore',
  group: 'muzzle',
  ...M,
});

// ================= The folding triangle stock (factory, hidden by a fitted stock; it folds
// to the left on the gun's factoryFold): two stamped struts from the receiver's back to a
// small curved butt plate, a hinge block on the left.
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ1 = 0.355; // the butt plate's front
const SW = 0.0042; // the struts' half width
prism(
  ST,
  'stock strut',
  [
    [RTOP - 0.002, RZ1 + 0.004],
    [RTOP - 0.002, SZ1],
    [RTOP - 0.0125, SZ1],
    [RTOP - 0.0125, RZ1 + 0.004],
  ].map(([y, z]) => [y, z, SW]),
  REC,
  hide,
);
prism(
  ST,
  'stock strut',
  [
    [RBOT + 0.012, RZ1 + 0.004],
    [RBOT + 0.002, RZ1 + 0.004],
    [B - 0.096, SZ1],
    [B - 0.086, SZ1],
  ].map(([y, z]) => [y, z, SW]),
  REC,
  hide,
);
// The strut ends' lighter rib, so the frame reads in two shades.
box(
  ST,
  'strut rib',
  [0, RTOP - 0.0018, (RZ1 + SZ1) / 2],
  [2 * SW - 0.002, 0.0008, SZ1 - RZ1 - 0.02],
  '#3a3d41',
  hide,
);
// The hinge block on the left, its pin upright.
box(ST, 'hinge block', [-(RW + 0.002), B - 0.012, RZ1 + 0.012], [0.004, 0.03, 0.022], BAND, hide);
tubeX(ST, 'hinge pin', [-(RW + 0.0042), B - 0.012, RZ1 + 0.012], 0.0024, 0.026, PIN, {
  sides: 8,
  roll: 0,
  ...hide,
});
// The butt plate: a curved steel plate (a slab, its corners rounded), the shoulder face dark.
add({
  type: 'slab',
  pos: v3([0, B - 0.04, SZ1 + 0.003]),
  size: v3([0.032, 0.122, 0.008]),
  corners: [0.006, 0.006, 0.006, 0.006],
  segments: 2,
  color: STEEL,
  name: 'butt plate',
  group: ST,
  ...hide,
});
box(ST, 'butt plate face', [0, B - 0.04, SZ1 + 0.0072], [0.026, 0.106, 0.0006], RUBBER, hide);

// ---- Points and mounts
const model = {
  parts,
  grip: body.grip,
  support: body.support,
  muzzle: [0, B, NOSE],
  sight: body.sight,
  ...keptFolds(ITEM),
  mounts: mountsFor(ITEM.slots, body.mounts),
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
