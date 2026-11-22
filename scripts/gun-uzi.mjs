// The Uzi's model (GM-4b), built from the gun kit and the platform's pieces (gun-uzi-kit.mjs):
// a stamped receiver, its top cover rounded and pressed with grooves, the cocking knob
// standing on top, the barrel nut, a short handguard under the front, the near-upright grip
// the magazine goes up through, a big trigger guard, a ghost-ring peep between guards and a
// post between ears, and the folding stock of flat steel arms (it folds: an SMG identity,
// its fold kept from the item). No optic slot, as the real one has no rail. Replaces only
// `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-uzi.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, writeModel } from './gun-kit.mjs';
import { keptFolds } from './gun-ak.mjs';
import { UZI, uziPieces } from './gun-uzi-kit.mjs';

const FILE = new URL('../content/items/uzi.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { REC, SLOT, POLY, PIN, STEEL, RUBBER, BAND } = UZI;

// ---- Key sizes everything hangs off
const B = 0; // bore height
const RW = 0.0205; // receiver half width
const RTOP = 0.026; // the top cover's crown
const RBOT = -0.024; // receiver bottom: the magazine's mount
const RZ0 = -0.155; // receiver front
const RZ1 = 0.14; // receiver rear: the stock hinge
const MUZZLE_Z = -0.215; // where a muzzle device threads on
const SIGHT_Y = RTOP + 0.024;
const REAR_Z = RZ1 - 0.012;
const FRONT_Z = RZ0 + 0.014;
const GRIP_Z = -0.004; // the grip's top front
const BZ = 0.385; // the butt plate's front

const kit = gunParts();
const { parts, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const uzi = uziPieces(kit, { B, RW, RTOP, RBOT, SIGHT_Y });

// ================= Receiver: the stamped box, the top cover's grooves, port and knob
const RA = 'receiver';
extrudeZ(
  RA,
  'receiver',
  [
    [-RW, RBOT],
    [RW, RBOT],
    [RW, RTOP - 0.009],
    [RW - 0.004, RTOP - 0.003],
    [RW - 0.011, RTOP],
    [-RW + 0.011, RTOP],
    [-RW + 0.004, RTOP - 0.003],
    [-RW, RTOP - 0.009],
  ],
  RZ0,
  RZ1,
  REC,
);
for (const s of [1, -1]) {
  box(RA, 'cover groove', [s * 0.0068, RTOP + 0.0002, (RZ0 + RZ1) / 2 + 0.01], [0.0018, 0.0006, RZ1 - RZ0 - 0.09], SLOT);
  for (const y of [B + 0.004, B - 0.011])
    box(RA, 'side rib', [s * (RW + 0.0003), y, (RZ0 + RZ1) / 2], [0.0006, 0.004, RZ1 - RZ0 - 0.05], BAND);
}
box(RA, 'knob slot', [0, RTOP + 0.0002, -0.07], [0.0034, 0.0006, 0.13], SLOT);
uzi.cockingKnob({ z: -0.125, top: RTOP });
box(RA, 'ejection port', [RW + 0.0002, B + 0.006, -0.002], [0.0006, 0.013, 0.05], SLOT);
box(RA, 'bolt face', [RW - 0.0005, B + 0.006, 0.0], [0.001, 0.009, 0.03], STEEL);
box(RA, 'front cap', [0, (RTOP + RBOT) / 2 - 0.001, RZ0 - 0.0005], [2 * RW - 0.004, RTOP - RBOT - 0.008, 0.001], BAND);
uzi.barrel({ z0: RZ0, MUZZLE_Z });
tubeZ('barrel', 'muzzle thread', B, MUZZLE_Z + 0.001, MUZZLE_Z - 0.008, 0.0066, STEEL, { sides: 8, hiddenBy: 'muzzle' });

// ================= Lower: the trigger frame, handguard, trigger guard, grip and selector
const LO = 'lower';
extrudeZ(LO, 'trigger frame', [[-0.0135, RBOT + 0.002], [0.0135, RBOT + 0.002], [0.0125, RBOT - 0.011], [-0.0125, RBOT - 0.011]], -0.078, GRIP_Z + 0.05, REC);
prism(
  LO,
  'handguard',
  [
    [RBOT + 0.002, RZ0 + 0.008],
    [RBOT + 0.002, -0.076],
    [RBOT - 0.019, -0.08],
    [RBOT - 0.019, RZ0 + 0.018],
    [RBOT - 0.012, RZ0 + 0.008],
  ].map(([y, z]) => [y, z, RW - 0.001]),
  POLY,
);
for (const z of [-0.135, -0.118, -0.101])
  for (const s of [1, -1])
    box(LO, 'handguard groove', [s * (RW - 0.0007), RBOT - 0.009, z], [0.0006, 0.012, 0.0028], SLOT);
const TG_Y = RBOT - 0.047; // the guard's bar
box(LO, 'trigger guard', [0, TG_Y, (-0.074 + GRIP_Z) / 2], [0.011, 0.0035, GRIP_Z + 0.074], STEEL);
prism(
  LO,
  'trigger guard front',
  [
    [RBOT - 0.011, -0.078],
    [RBOT - 0.011, -0.071],
    [TG_Y, -0.068],
    [TG_Y, -0.076],
  ].map(([y, z]) => [y, z, 0.0055]),
  STEEL,
);
prism(
  LO,
  'trigger',
  [
    [RBOT - 0.011, -0.033],
    [RBOT - 0.011, -0.027],
    [RBOT - 0.029, -0.024],
    [RBOT - 0.031, -0.028],
  ].map(([y, z]) => [y, z, 0.003]),
  PIN,
);
uzi.grip({ top: RBOT - 0.009, z: GRIP_Z, depth: 0.103, rake: 0.006 });
tubeX(LO, 'selector', [-(0.0135 + 0.0012), RBOT - 0.005, GRIP_Z + 0.012], 0.0042, 0.0024, STEEL, { sides: 10 });
box(LO, 'selector lever', [-(0.0135 + 0.0026), RBOT - 0.005, GRIP_Z + 0.004], [0.0014, 0.0035, 0.014], STEEL);
box(LO, 'magazine release', [-(0.0145 + 0.0008), RBOT - 0.096, GRIP_Z + 0.044], [0.002, 0.008, 0.008], STEEL);
const RAIL_X = uzi.ak.ar.sideRail({ s: 1, x0: RW - 0.0015, y: RBOT - 0.0085, z0: -0.135, z1: -0.095, color: POLY });

// ================= Irons: the peep (no optic slot, so it never hides) and the post
uzi.peepRear({ REAR_Z, base: RTOP - 0.0008 });
uzi.frontPost({ FRONT_Z, base: RTOP - 0.0008 });

// ================= Stock: the hinge block (stays), then the folding arms and butt plate
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ0 = RZ1 + 0.012;
extrudeZ(ST, 'hinge block', [[-RW, B + 0.012], [RW, B + 0.012], [RW, RBOT + 0.004], [-RW, RBOT + 0.004]], RZ1 - 0.001, SZ0, BAND);
tubeX(ST, 'hinge pin', [-(RW + 0.001), B - 0.005, SZ0 - 0.006], 0.0032, 0.0024, PIN, { sides: 8 });
for (const s of [1, -1]) {
  prism(
    ST,
    'stock arm',
    [
      [B + 0.01, SZ0],
      [B + 0.004, BZ],
      [B - 0.006, BZ],
      [B + 0.0, SZ0],
    ].map(([y, z]) => [y, z, 0.0016]),
    STEEL,
    { x: s * 0.0135, ...hide },
  );
  prism(
    ST,
    'stock strut',
    [
      [RBOT + 0.008, SZ0],
      [B - 0.06, BZ],
      [B - 0.07, BZ],
      [RBOT - 0.002, SZ0],
    ].map(([y, z]) => [y, z, 0.0016]),
    STEEL,
    { x: s * 0.0135, ...hide },
  );
}
// The butt plate: steel, curved at heel and toe, a thin rubber facing.
prism(
  ST,
  'butt plate',
  [
    [B + 0.008, BZ - 0.002],
    [B + 0.012, BZ + 0.004],
    [B + 0.01, BZ + 0.008],
    [B - 0.08, BZ + 0.008],
    [B - 0.086, BZ + 0.003],
    [B - 0.08, BZ - 0.002],
  ].map(([y, z]) => [y, z, 0.0165]),
  STEEL,
  hide,
);
box(ST, 'butt facing', [0, B - 0.035, BZ + 0.0084], [0.028, 0.08, 0.001], RUBBER, hide);

// ---- Points and mounts
const model = {
  parts,
  grip: [0, RBOT - 0.05, GRIP_Z + 0.03],
  support: [0, RBOT - 0.022, -0.105],
  muzzle: [0, B, MUZZLE_Z - 0.009],
  sight: [0, SIGHT_Y, REAR_Z],
  ...keptFolds(ITEM),
  mounts: {
    muzzle: [0, B, MUZZLE_Z],
    magazine: [0, RBOT, GRIP_Z + 0.022],
    rightRail: [RAIL_X, RBOT - 0.0085, -0.115],
    stock: [0, B, SZ0],
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
