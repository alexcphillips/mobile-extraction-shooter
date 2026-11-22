// The VSS's model (GM-6c), on the platform's shared body (gun-val.mjs): the receiver, railed
// cover, notch, integral suppressor with its front post, and trigger guard. Its own furniture
// tells it from the as-val: a steel cover over the gas tube, a wooden forend cradling the
// suppressor's back half with a laser rail on its right, and the skeleton thumbhole stock,
// its grip part of the wood, one big opening through the butt behind it. Only the butt is the
// factory stock (hidden by a fitted one): the grip stays, as on the bolt-action rifles.
// Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-vss.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { AK } from './gun-ak.mjs';
import { VAL, valBody } from './gun-val.mjs';

const FILE = new URL('../content/items/vss.json', import.meta.url).pathname;
const { SLOT, POLY, POLY_HI, PIN, RUBBER, BAND } = AK;
const { B, RBOT, RZ0, RZ1, SZ, SR, GRIP_Z } = VAL;

const kit = gunParts();
const { parts, add, box, prism, extrudeZ } = kit;
const body = valBody(kit);

// ================= The steel cover over the gas tube, and the wooden forend
extrudeZ(
  'handguard',
  'gas tube cover',
  [
    [-0.0158, B + 0.004],
    [0.0158, B + 0.004],
    [0.0158, B + 0.012],
    [0.011, B + 0.0185],
    [-0.011, B + 0.0185],
    [-0.0158, B + 0.012],
  ],
  SZ[0] + 0.004,
  RZ0 - 0.001,
  BAND,
);
const FW = SR + 0.0022; // the forend's half width, round the suppressor
const FTOP = B + 0.005;
const FBOT = B - 0.03;
const FZ0 = -0.33; // the forend's front, under the suppressor
prism(
  'stock',
  'forend',
  [
    [FTOP, FZ0 + 0.008, FW - 0.0015],
    [FTOP, RZ0, FW],
    [FBOT, RZ0, FW - 0.003],
    [FBOT + 0.002, FZ0 + 0.03, FW - 0.0035],
    [FBOT + 0.012, FZ0, FW - 0.005],
    [FTOP - 0.006, FZ0, FW - 0.003],
  ],
  POLY,
);
for (const s of [1, -1])
  box('stock', 'forend edge', [s * (FW - 0.0012), FTOP + 0.0002, (FZ0 + RZ0) / 2], [0.0026, 0.001, RZ0 - FZ0 - 0.03], POLY_HI);
box('stock', 'forend groove', [0, FBOT - 0.0002, -0.17], [0.012, 0.001, 0.12], SLOT);
const RAIL_X = body.ak.ar.sideRail({ s: 1, x0: FW - 0.0025, y: B - 0.012, z0: -0.215, z1: -0.165, color: POLY });

// ================= Stock: the grip (stays), then the skeleton butt round its opening
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const BZ = 0.385; // the butt's back, before the pad
const TOP = B + 0.005; // the comb's top
const TOE = B - 0.118;
const FOOT = RBOT - 0.09; // the grip's foot
const W = 0.0148;
prism(
  ST,
  'grip',
  [
    [RBOT + 0.002, GRIP_Z - 0.002],
    [RBOT + 0.002, GRIP_Z + 0.044],
    [FOOT + 0.008, GRIP_Z + 0.07],
    [FOOT, GRIP_Z + 0.072],
    [FOOT, GRIP_Z + 0.034],
    [RBOT - 0.05, GRIP_Z + 0.014],
  ].map(([y, z]) => [y, z, W]),
  POLY,
);
for (const s of [1, -1])
  box(ST, 'grip stipple', [s * (W + 0.0002), RBOT - 0.045, GRIP_Z + 0.033], [0.0006, 0.05, 0.022], '#323539', { pitch: -18 });
// The wrist from the receiver's back over the opening, the comb along its top.
prism(
  ST,
  'stock comb',
  [
    [TOP, RZ1 - 0.002],
    [TOP + 0.003, BZ - 0.03],
    [B - 0.024, BZ - 0.03],
    [B - 0.03, RZ1 + 0.05],
    [RBOT + 0.004, RZ1 - 0.002],
  ].map(([y, z]) => [y, z, W]),
  POLY,
  hide,
);
box(ST, 'comb strip', [0, TOP + 0.0025, (RZ1 + BZ) / 2 + 0.02], [W * 2 - 0.006, 0.0012, BZ - RZ1 - 0.09], POLY_HI, { pitch: -0.7, ...hide });
prism(
  ST,
  'stock back',
  [
    [TOP + 0.003, BZ - 0.05],
    [TOP + 0.003, BZ],
    [TOE, BZ],
    [TOE + 0.004, BZ - 0.045],
    [B - 0.03, BZ - 0.06],
  ].map(([y, z]) => [y, z, W + 0.0015]),
  POLY,
  hide,
);
prism(
  ST,
  'stock bottom',
  [
    [FOOT + 0.016, GRIP_Z + 0.064],
    [TOE + 0.02, BZ - 0.04],
    [TOE, BZ - 0.035],
    [FOOT, GRIP_Z + 0.068],
  ].map(([y, z]) => [y, z, W - 0.002]),
  POLY,
  hide,
);
add({
  type: 'slab',
  pos: [0, (TOP + 0.003 + TOE) / 2, BZ + 0.006],
  size: [2 * W + 0.004, TOP + 0.003 - TOE, 0.012],
  corners: [0.003, 0.003, 0.003, 0.003],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
box(ST, 'sling slot', [-(W + 0.0017), B - 0.06, BZ - 0.022], [0.0006, 0.005, 0.02], SLOT, hide);
box(ST, 'stock screw', [W + 0.0002, B - 0.006, RZ1 + 0.012], [0.0006, 0.004, 0.004], PIN);

// ---- Points and mounts
const model = {
  parts,
  grip: body.grip,
  support: [0, FBOT - 0.004, -0.17],
  muzzle: body.muzzle,
  sight: body.sight,
  mounts: {
    optic: body.mounts.optic,
    magazine: body.mounts.magazine,
    rightRail: [RAIL_X, B - 0.012, -0.19],
    stock: body.mounts.stock,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
