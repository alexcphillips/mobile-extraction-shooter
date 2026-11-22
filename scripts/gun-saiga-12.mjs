// The Saiga-12's model (GM-3), on the `ak` family's shared body in gun-ak.mjs (receiver, railed
// dust cover, notch and post irons, gas system, handguards, grip), grown for 12 gauge: a
// wider, deeper receiver, a thick barrel, a wide handguard. Its own parts here: the thread
// protector, the skeleton folding stock, the points and mounts. Replaces only `model` in its
// item file. See docs/guns.md.
//
//   node scripts/gun-saiga-12.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AK, akRifle, keptFolds, mountsFor } from './gun-ak.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/saiga-12.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { SLOT, POLY, POLY_HI, STEEL, PIN, RUBBER, BORE, BAND } = AK;

// ---- Key sizes everything hangs off (the rest of the layout is the family's, in akRifle)
const B = 0.012; // bore height
const RW = 0.019; // receiver half width: 12 gauge
const RTOP = B + 0.012; // receiver walls' top, under the cover
const RBOT = B - 0.04; // receiver bottom: the magazine's mouth
const RZ0 = -0.105; // receiver front
const RZ1 = 0.135; // receiver rear: the stock's front
const MUZZLE_Z = -0.495; // where a muzzle device threads on
// The gas block 11 cm back from the muzzle, so the shotgun barrels (shorter and longer)
// each move the muzzle the way their length says.
const GZ = [MUZZLE_Z + 0.11, MUZZLE_Z + 0.14]; // gas block [front, rear]
const HZ0 = -0.28; // lower handguard front
const HW = 0.025; // lower handguard half width
const HBOT = B - 0.031;
const BARREL_R = 0.0105;

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
  irons: 'bead',
  BARREL_R,
  dimple: false,
});
// The thick barrel under the handguards.
tubeZ('barrel', 'barrel', B, RZ0 + 0.01, GZ[1] - 0.001, BARREL_R, STEEL, { sides: 8 });

// ================= The thread protector (factory, hidden by a muzzle device): a short knurled
// sleeve and the wide bore.
const M = { hiddenBy: 'muzzle' };
const END = MUZZLE_Z - 0.026;
tubeZ('muzzle', 'thread protector', B, MUZZLE_Z + 0.002, END, 0.0122, STEEL, { sides: 12, ...M });
for (const z of [MUZZLE_Z - 0.006, MUZZLE_Z - 0.012, MUZZLE_Z - 0.018])
  tubeZ('muzzle', 'knurl', B, z + 0.0012, z - 0.0012, 0.0125, SLOT, { sides: 12, ...M });
add({
  type: 'panel',
  pos: v3([0, B, END - 0.0003]),
  pitch: 90,
  points: roundOutline(10)(0.0092).map(v3),
  color: BORE,
  name: 'muzzle bore',
  group: 'muzzle',
  ...M,
});

// ================= The skeleton folding stock (factory, hidden by a fitted stock; shaped like
// the real side-folder, but a shotgun's stock doesn't fold in the game): a polymer frame, its open middle a dark web, the hinge
// block on the left, a rubber pad.
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ1 = 0.37; // the pad's front
const sw = (z) => 0.014 + ((z - RZ1) / (SZ1 - RZ1)) * 0.004;
prism(
  ST,
  'stock',
  [
    [RTOP - 0.002, RZ1 + 0.001, sw(RZ1)],
    [B - 0.002, SZ1, sw(SZ1)],
    [B - 0.124, SZ1, sw(SZ1)],
    [B - 0.108, SZ1 - 0.07, sw(SZ1 - 0.07)],
    [RBOT + 0.002, RZ1 + 0.001, sw(RZ1)],
  ],
  POLY,
  hide,
);
// The open middle: a dark web a hair proud of both faces, the frame's bars round it.
prism(
  ST,
  'stock web',
  [
    [B - 0.012, RZ1 + 0.045],
    [B - 0.014, SZ1 - 0.022],
    [B - 0.094, SZ1 - 0.022],
    [B - 0.084, SZ1 - 0.07],
    [RBOT - 0.008, RZ1 + 0.045],
  ].map(([y, z]) => [y, z, sw(z) + 0.0003]),
  SLOT,
  hide,
);
prism(
  ST,
  'stock comb',
  [
    [RTOP - 0.0012, RZ1 + 0.03],
    [B - 0.0012, SZ1 - 0.004],
    [B - 0.0052, SZ1 - 0.004],
    [RTOP - 0.0052, RZ1 + 0.03],
  ].map(([y, z]) => [y, z, sw(z) + 0.0002]),
  POLY_HI,
  hide,
);
box(ST, 'hinge block', [-(RW + 0.002), B - 0.014, RZ1 + 0.012], [0.004, 0.034, 0.022], BAND, hide);
tubeX(ST, 'hinge pin', [-(RW + 0.0042), B - 0.014, RZ1 + 0.012], 0.0026, 0.03, PIN, {
  sides: 8,
  roll: 0,
  ...hide,
});
add({
  type: 'slab',
  pos: v3([0, B - 0.063, SZ1 + 0.0055]),
  size: v3([2 * sw(SZ1) + 0.001, 0.125, 0.011]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});

// ---- Points and mounts
const model = {
  parts,
  grip: body.grip,
  support: body.support,
  muzzle: [0, B, END],
  sight: body.sight,
  ...keptFolds(ITEM),
  mounts: mountsFor(ITEM.slots, body.mounts),
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
