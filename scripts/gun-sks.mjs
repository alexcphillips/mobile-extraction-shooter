// The SKS's model (GM-6b), built from the gun kit, the ak kit's railed cover, notch and front
// post (the user's call: these rifles take optics and irons the ak family's way) and the
// wood-stock pieces (gun-wood.mjs). What makes it read as itself: a short receiver under a
// railed cover, the upper handguard over a long gas tube, the bayonet folded back under the
// barrel from its hinge at the front sight, the fixed magazine box ahead of the trigger
// guard, and a one-piece stock with a straight wrist. Replaces only `model` in its item
// file. See docs/guns.md.
//
//   node scripts/gun-sks.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { AK, akPieces, akRail, hull2d } from './gun-ak.mjs';
import { roundOutline } from './optic-kit.mjs';
import { woodPieces } from './gun-wood.mjs';

const FILE = new URL('../content/items/sks.json', import.meta.url).pathname;
const { REC, SLOT, POLY, PIN, STEEL } = AK;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RW = 0.0145; // receiver half width
const RTOP = B + 0.01; // receiver walls' top, under the cover
const RBOT = B - 0.026; // receiver bottom, inside the stock
const RZ0 = -0.1; // receiver front
const RZ1 = 0.115; // receiver rear: the wrist's front
const RSB = [RZ0 - 0.062, RZ0 + 0.004]; // the rear sight block ahead of the cover
const TUBE_Y = B + 0.0205; // gas tube axis
const GZ = [-0.388, -0.362]; // gas block [front, rear]
const MUZZLE_Z = -0.585; // where a muzzle device threads on
const FZ0 = -0.352; // the stock's front
const FTOP = B - 0.002; // the forend's top, up to the barrel's middle
const FW = 0.0155; // forend half width at its top
const FW_BOT = 0.0135; // and at its bottom
const FBOT = (z) => B - 0.03 - (0.006 * (z - FZ0)) / (RZ0 - FZ0); // the forend's underside
const BED_BOT = B - 0.04; // under the action
const { RAIL_TOP } = akRail(B);
const SIGHT_Y = RAIL_TOP + 0.02; // the family's sight line over the cover rail
const REAR_Z = RZ1 - 0.012; // the notch, at the cover rail's back
const FRONT_Z = MUZZLE_Z + 0.017;

const kit = gunParts();
const { parts, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ak = akPieces(kit, { B, RW, RTOP, RBOT, SIGHT_Y });
const wood = woodPieces(kit);

// ================= Receiver, railed cover, rear sight block and the notch
const RA = 'receiver';
const c = 0.0035;
extrudeZ(
  RA,
  'receiver',
  [
    [-RW, RTOP],
    [-RW, RBOT + c],
    [-RW + c, RBOT],
    [RW - c, RBOT],
    [RW, RBOT + c],
    [RW, RTOP],
  ],
  RZ0,
  RZ1,
  REC,
);
// Right side: the ejection port, the bolt carrier in it, its handle at the port's back.
const PORT = [RZ0 + 0.06, RZ0 + 0.15];
box(RA, 'ejection port', [RW + 0.0002, B + 0.003, (PORT[0] + PORT[1]) / 2], [0.0006, 0.012, PORT[1] - PORT[0]], SLOT);
box(RA, 'bolt carrier', [RW + 0.0006, B + 0.004, (PORT[0] + PORT[1]) / 2 - 0.004], [0.0008, 0.0075, PORT[1] - PORT[0] - 0.02], STEEL);
box(RA, 'charging handle', [RW + 0.005, B + 0.004, PORT[1] - 0.008], [0.009, 0.006, 0.009], STEEL);
tubeX(RA, 'charging handle knob', [RW + 0.012, B + 0.004, PORT[1] - 0.008], 0.0048, 0.006, STEEL, { sides: 8 });
// The cover latch on the right at the back, and the trunnion pins.
tubeX(RA, 'cover latch', [RW + 0.0016, RTOP - 0.004, RZ1 - 0.008], 0.0034, 0.003, STEEL, { sides: 8 });
box(RA, 'cover latch lever', [RW + 0.0025, RTOP - 0.0085, RZ1 - 0.002], [0.0014, 0.009, 0.004], STEEL);
for (const z of [RZ0 + 0.012, RZ1 - 0.03])
  tubeX(RA, 'pin', [0, B - 0.006, z], 0.0014, 2 * RW + 0.0012, PIN, { sides: 6 });
const RAIL = ak.cover({ z0: RSB[1] - 0.003, z1: RZ1 + 0.005 });
ak.rearBlock({ z0: RSB[0], z1: RSB[1] });
ak.railNotch({ REAR_Z });

// ================= Barrel, gas system, the front sight base and the folded bayonet
tubeZ('barrel', 'barrel', B, RZ0 + 0.01, MUZZLE_Z - 0.0015, 0.0084, STEEL, { sides: 8 });
tubeZ('gas block', 'gas tube', TUBE_Y, RSB[0] + 0.002, GZ[1] + 0.002, 0.0078, STEEL, { sides: 8 });
const ring = (cx, cy, r, n = 8) => roundOutline(n)(r).map(([x, y]) => [x + cx, y + cy]);
extrudeZ('gas block', 'gas block', hull2d([...ring(0, B, 0.0115), ...ring(0, TUBE_Y, 0.0094)]), GZ[0], GZ[1], STEEL);
tubeZ('gas block', 'gas cylinder plug', TUBE_Y, GZ[0] - 0.008, GZ[0] + 0.001, 0.0062, STEEL, { sides: 8 });
tubeX('gas block', 'gas block pin', [0, B + 0.001, GZ[1] - 0.006], 0.0015, 0.024, PIN, { sides: 6 });
ak.upperHandguard({ z0: GZ[1] + 0.003, z1: RSB[0] - 0.001, TUBE_Y });
// The front sight base at the muzzle: the family's tower, ears and post, which stays under an
// optic. Its lower ring wraps the barrel; its upper ring sits low (no gas tube here).
ak.gasBlock({ z0: MUZZLE_Z + 0.002, z1: MUZZLE_Z + 0.032, TUBE_Y: B + 0.007, FRONT_Z });
// The bayonet: its hinge under the sight base, the blade folded back under the barrel, its
// tip in the forend's groove.
const BY = 'bayonet';
box(BY, 'bayonet lug', [0, B - 0.0145, MUZZLE_Z + 0.02], [0.009, 0.009, 0.022], STEEL);
tubeX(BY, 'bayonet hinge', [0, B - 0.0145, MUZZLE_Z + 0.02], 0.0035, 0.0112, PIN, { sides: 8 });
prism(
  BY,
  'bayonet handle',
  [
    [B - 0.011, MUZZLE_Z + 0.028],
    [B - 0.011, MUZZLE_Z + 0.085],
    [B - 0.023, MUZZLE_Z + 0.085],
    [B - 0.023, MUZZLE_Z + 0.032],
  ].map(([y, z]) => [y, z, 0.0042]),
  STEEL,
);
box(BY, 'bayonet guard', [0, B - 0.017, MUZZLE_Z + 0.088], [0.011, 0.016, 0.004], STEEL);
prism(
  BY,
  'bayonet blade',
  [
    [B - 0.012, MUZZLE_Z + 0.09],
    [B - 0.012, FZ0 + 0.02],
    [B - 0.016, FZ0 + 0.028],
    [B - 0.022, MUZZLE_Z + 0.09],
  ].map(([y, z]) => [y, z, 0.0013]),
  '#2a2c2f',
);
box(BY, 'bayonet edge', [0, B - 0.0218, (MUZZLE_Z + 0.09 + FZ0 + 0.02) / 2], [0.0018, 0.0006, FZ0 - MUZZLE_Z - 0.075], PIN);

// ================= Stock: forend, action bed, the magazine box, wrist and butt
const ST = 'stock';
prism(
  ST,
  'forend',
  [
    [FTOP, FZ0 + 0.004, FW - 0.001],
    [FTOP, RZ0, FW],
    [FBOT(RZ0), RZ0, FW_BOT],
    [FBOT(FZ0 + 0.008), FZ0 + 0.008, FW_BOT - 0.001],
    [FBOT(FZ0) + 0.006, FZ0, FW_BOT - 0.002],
    [FTOP - 0.006, FZ0, FW - 0.002],
  ],
  POLY,
);
// The groove the bayonet's tip sits in, under the forend's front.
box(ST, 'bayonet groove', [0, FBOT(FZ0 + 0.03) - 0.0002, FZ0 + 0.03], [0.004, 0.001, 0.05], SLOT);
prism(
  ST,
  'action bed',
  [
    [RTOP - 0.005, RZ0 - 0.0005, FW + 0.0005],
    [RTOP - 0.005, RZ1 + 0.002, 0.0158],
    [BED_BOT, RZ1 + 0.002, 0.0158],
    [BED_BOT, RZ0 - 0.0005, FW + 0.0005],
  ],
  POLY,
);
wood.band({ z: GZ[1] + 0.012, len: 0.012, hw: FW, top: TUBE_Y + 0.011, bot: FBOT(FZ0) - 0.0005, swivel: true });
// The fixed magazine box ahead of the trigger guard, its front swept forward.
prism(
  'magazine',
  'magazine box',
  [
    [BED_BOT + 0.001, RZ0 + 0.032],
    [BED_BOT + 0.001, RZ0 + 0.128],
    [B - 0.066, RZ0 + 0.124],
    [B - 0.072, RZ0 + 0.1],
    [B - 0.072, RZ0 + 0.05],
    [B - 0.062, RZ0 + 0.03],
  ].map(([y, z]) => [y, z, 0.0122]),
  STEEL,
);
box('magazine', 'floor plate seam', [0, B - 0.0722, RZ0 + 0.075], [0.016, 0.0006, 0.044], SLOT);
for (const s of [1, -1])
  box('magazine', 'magazine rib', [s * 0.0125, B - 0.056, RZ0 + 0.078], [0.0006, 0.014, 0.05], AK.BAND);
// The trigger guard behind it, the safety at its back.
const TG = [RZ0 + 0.13, RZ0 + 0.2];
box('trigger', 'trigger guard', [0, B - 0.0675, (TG[0] + TG[1]) / 2], [0.01, 0.004, TG[1] - TG[0]], STEEL);
box('trigger', 'trigger guard rear', [0, (BED_BOT + B - 0.068) / 2, TG[1] - 0.002], [0.01, BED_BOT - B + 0.068, 0.005], STEEL);
box('trigger', 'trigger', [0, BED_BOT - 0.011, TG[0] + 0.03], [0.0045, 0.018, 0.005], STEEL, { pitch: -14 });
box('trigger', 'safety', [0, BED_BOT - 0.006, TG[1] - 0.009], [0.004, 0.01, 0.004], PIN);
const BACK = wood.wristButt({
  WZ0: RZ1,
  WZ1: 0.215,
  BZ: 0.405,
  top: [RTOP - 0.005, B - 0.002, B - 0.004],
  bot: [BED_BOT - 0.002, B - 0.054, B - 0.118],
  w: [0.0148, 0.019],
});

// ---- Points and mounts
const fw = (y) => FW_BOT + ((FW - FW_BOT) * (y - FBOT(-0.28))) / (FTOP - FBOT(-0.28));
const RAIL_X = ak.ar.sideRail({ s: 1, x0: fw(B - 0.016) - 0.0005, y: B - 0.016, z0: -0.31, z1: -0.25, color: POLY });
const model = {
  parts,
  grip: [0, B - 0.044, 0.15],
  support: [0, FBOT(-0.22) - 0.006, -0.22],
  muzzle: [0, B, MUZZLE_Z - 0.002],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, RZ1 - 0.066],
    muzzle: [0, B, MUZZLE_Z],
    rightRail: [RAIL_X, B - 0.016, -0.28],
    stock: [0, B - 0.02, 0.215],
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts; rail', RAIL.map((z) => z.toFixed(3)).join('..'), '; back at', BACK.toFixed(3));
