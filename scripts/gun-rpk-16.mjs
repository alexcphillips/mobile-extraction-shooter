// The RPK-16's model (GM-3), on the `ak` family's shared body in gun-ak.mjs (receiver, railed
// dust cover, notch and post irons, gas system, handguards, grip), stretched: a long heavy
// barrel, the gas block far forward, a bipod folded under the barrel ahead of the handguard
// (clear of the foregrip rail). Its own parts here: the slotted brake, the bipod, the
// adjustable stock on its folding tube, the points and mounts. Replaces only `model` in its
// item file. See docs/guns.md.
//
//   node scripts/gun-rpk-16.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AK, akRifle, keptFolds, mountsFor } from './gun-ak.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/rpk-16.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { SLOT, POLY, POLY_HI, STEEL, PIN, RUBBER, BORE, BAND } = AK;

// ---- Key sizes everything hangs off (the rest of the layout is the family's, in akRifle)
const B = 0.012; // bore height
const RW = 0.0145; // receiver half width
const RTOP = B + 0.01; // receiver walls' top, under the cover
const RBOT = B - 0.034; // receiver bottom: the magazine's mouth
const RZ0 = -0.105; // receiver front
const RZ1 = 0.13; // receiver rear: the stock's front
const GZ = [-0.452, -0.422]; // gas block [front, rear]: the front sight on it
const HZ0 = -0.3; // lower handguard front
const HW = 0.0225; // lower handguard half width
const HBOT = B - 0.027;
const MUZZLE_Z = -0.6; // where a muzzle device threads on
const BARREL_R = 0.0094; // the heavy barrel

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
  BARREL_R,
  barrelSlot: false,
  ribs: 2,
});
// The heavy barrel shows between the handguard and the gas block too: thicken that run.
tubeZ('barrel', 'barrel', B, HZ0 - 0.008, GZ[1] - 0.001, BARREL_R, STEEL, { sides: 8 });

// ================= The bipod, folded forward under the barrel: a clamp ahead of the
// handguard, two legs side by side, their feet short of the gas block.
const BP = 'bipod';
const CLAMP_Z = HZ0 - 0.022;
tubeZ(BP, 'bipod clamp', B, CLAMP_Z + 0.009, CLAMP_Z - 0.009, BARREL_R + 0.003, BAND, {
  sides: 10,
});
box(BP, 'bipod yoke', [0, B - BARREL_R - 0.004, CLAMP_Z], [0.02, 0.007, 0.016], BAND);
tubeX(BP, 'bipod pivot', [0, B - BARREL_R - 0.004, CLAMP_Z - 0.002], 0.0022, 0.023, PIN, {
  sides: 8,
});
for (const s of [1, -1]) {
  tubeZ(BP, 'bipod leg', B - BARREL_R - 0.0055, CLAMP_Z - 0.006, CLAMP_Z - 0.058, 0.0032, STEEL, {
    x: s * 0.0062,
    sides: 6,
  });
  // The inner leg, lighter, sliding out of it, and the foot.
  tubeZ(BP, 'bipod leg', B - BARREL_R - 0.0055, CLAMP_Z - 0.06, GZ[1] + 0.012, 0.0025, '#3a3d41', {
    x: s * 0.0062,
    sides: 6,
  });
  box(
    BP,
    'bipod foot',
    [s * 0.0062, B - BARREL_R - 0.0055, GZ[1] + 0.007],
    [0.0076, 0.0058, 0.008],
    RUBBER,
  );
}

// ================= The slotted brake (factory, hidden by a muzzle device): a long round body,
// three slots each side on its upper half, a crown with the bore.
const M = { hiddenBy: 'muzzle' };
const BRAKE_END = MUZZLE_Z - 0.062;
tubeZ('muzzle', 'brake collar', B, MUZZLE_Z + 0.003, MUZZLE_Z - 0.008, 0.0098, SLOT, {
  sides: 10,
  ...M,
});
tubeZ('muzzle', 'brake', B, MUZZLE_Z - 0.008, BRAKE_END, 0.0112, STEEL, { sides: 10, ...M });
for (let i = 0; i < 3; i++)
  for (const s of [1, -1])
    box(
      'muzzle',
      'brake slot',
      [s * 0.0104, B + 0.0042, MUZZLE_Z - 0.02 - i * 0.012],
      [0.0034, 0.0042, 0.0062],
      BORE,
      { roll: s * 22, ...M },
    );
add({
  type: 'panel',
  pos: v3([0, B, BRAKE_END - 0.0003]),
  pitch: 90,
  points: roundOutline(8)(0.0052).map(v3),
  color: BORE,
  name: 'muzzle bore',
  group: 'muzzle',
  ...M,
});

// ================= The stock (factory, hidden by a fitted stock): a folding hinge block, the
// tube, and on it an adjustable polymer stock: a sleeve with a cheek riser, a tall butt with
// a toe strut, a rubber pad.
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const TUBE_Y = B - 0.004;
const SZ0 = RZ1 + 0.1; // the sleeve's front
const SZ1 = 0.385; // the pad's front
box(ST, 'hinge block', [0, B - 0.006, RZ1 + 0.012], [2 * RW + 0.002, 0.032, 0.024], BAND, hide);
tubeX(ST, 'hinge pin', [-(RW + 0.0014), B - 0.006, RZ1 + 0.012], 0.0028, 0.03, PIN, {
  sides: 8,
  roll: 0,
  ...hide,
});
tubeZ(ST, 'stock tube', TUBE_Y, RZ1 + 0.024, SZ0 + 0.01, 0.0135, STEEL, { sides: 10, ...hide });
prism(
  ST,
  'stock sleeve',
  [
    [TUBE_Y + 0.0175, SZ0],
    [TUBE_Y + 0.0175, SZ1],
    [TUBE_Y - 0.018, SZ1],
    [TUBE_Y - 0.018, SZ0 + 0.01],
  ].map(([y, z]) => [y, z, 0.0168]),
  POLY,
  hide,
);
prism(
  ST,
  'cheek riser',
  [
    [TUBE_Y + 0.017, SZ0 + 0.03],
    [TUBE_Y + 0.0235, SZ0 + 0.05],
    [TUBE_Y + 0.0235, SZ1 - 0.004],
    [TUBE_Y + 0.017, SZ1 - 0.004],
  ].map(([y, z]) => [y, z, 0.0124]),
  POLY_HI,
  hide,
);
prism(
  ST,
  'stock butt',
  [
    [TUBE_Y - 0.016, SZ1 - 0.05],
    [TUBE_Y - 0.016, SZ1],
    [B - 0.118, SZ1],
    [B - 0.112, SZ1 - 0.024],
  ].map(([y, z]) => [y, z, 0.0168]),
  POLY,
  hide,
);
box(ST, 'adjustment lever', [0, TUBE_Y - 0.0195, SZ0 + 0.03], [0.008, 0.004, 0.026], SLOT, hide);
add({
  type: 'slab',
  pos: v3([0, (TUBE_Y + 0.0235 + B - 0.118) / 2, SZ1 + 0.0055]),
  size: v3([0.0346, TUBE_Y + 0.0235 - (B - 0.118), 0.011]),
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
  muzzle: [0, B, BRAKE_END],
  sight: body.sight,
  ...keptFolds(ITEM),
  mounts: mountsFor(ITEM.slots, body.mounts),
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
