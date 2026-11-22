// The R93's model (GM-6a), built from the gun kit and the bolt-action pieces (gun-bolt.mjs):
// a straight-pull rifle, so a slim flat-sided action sunk deep in the stock with the bolt's
// knob on a short stalk at its very back; a plain barrel and a short brake ported on top and
// sides. The thumbhole stock tells it from the other two: the action bed rising up the
// action's sides, a squared forend with three vents down each side, a near-upright grip on a
// palm shelf, a long cheek riser sloping up from the wrist, and a hooked toe on the pad. No
// iron sights, true to the real one (the user's call): bare, it aims along the rail.
// Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-r93.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, writeModel } from './gun-kit.mjs';
import { arPieces } from './gun-ar15.mjs';
import { BOLT, boltPieces } from './gun-bolt.mjs';

const FILE = new URL('../content/items/r93.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, PIN, STEEL, RUBBER, HG } = BOLT;

// ---- Key sizes everything hangs off
const B = 0; // bore height
const RW = 0.0125; // the action's half width
const RTOP = 0.0155; // the action's flat top
const RZ0 = -0.095; // action front
const RZ1 = 0.064; // action rear
const RAIL_Z = [-0.108, 0.046];
const RAIL_W = 0.0215;
const MUZZLE_Z = -0.7; // the barrel's end: where a muzzle device threads on
const TOP = 0.008; // the action bed's top, up the action's sides
const FTOP = 0.003; // the forend's top, ahead of the action
const BOT = -0.05; // the stock's bottom under the action and forend
const FZ0 = -0.44; // forend front
const MAG = [0, BOT, -0.045]; // magazine mount: the well's mouth
const STOCK = [0, -0.01, 0.13]; // where a stock's front would sit, behind the grip
const BUTT_Z = 0.37; // the stock's back, before the spacer and pad
const HEEL = 0.006;
const TOE = -0.135;

const kit = gunParts();
const { parts, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const bolt = boltPieces(kit);

// ================= Action, rail and bolt
const RA = 'receiver';
extrudeZ(RA, 'receiver', octagon(RW, RTOP, -0.012, 0.004), RZ0, RZ1, REC);
box(RA, 'ejection port', [RW + 0.0002, 0.0095, -0.022], [0.001, 0.009, 0.05], SLOT);
box(RA, 'bolt head', [RW - 0.002, 0.0095, -0.016], [0.004, 0.006, 0.026], STEEL);
const RAIL_BASE = RTOP - 0.0005;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
ar.topRail({ name: 'top rail', z0: RAIL_Z[0], z1: RAIL_Z[1], inset: [0.003, 0.003] });
// The straight-pull bolt: a collar at the action's back, the knob on a short stalk out right.
tubeZ('bolt', 'bolt collar', 0.004, RZ1 - 0.012, RZ1 + 0.004, 0.0118, STEEL, { sides: 10 });
bolt.boltHandle({
  B: 0.004,
  R: 0.0125,
  z1: RZ1 + 0.004,
  shroud: 0.014,
  root: [0.0125, 0.004, RZ1 - 0.004],
  knob: [0.035, 0.0, RZ1 - 0.004],
  knobR: 0.0078,
});
box(RA, 'cocking slide', [0, RTOP + 0.0018, RZ1 + 0.006], [0.012, 0.004, 0.016], PIN);

// ================= Barrel and brake (the factory muzzle)
bolt.barrel({ B, z0: RZ0, zTaper: -0.24, zMuzzle: MUZZLE_Z, rShank: 0.0125, r: 0.0104 });
bolt.brake({
  B,
  z0: MUZZLE_Z,
  len: 0.056,
  r: 0.0135,
  portH: 0.0055,
  ports: [
    [-0.713, 0.006],
    [-0.723, 0.006],
    [-0.733, 0.006],
    [-0.743, 0.006],
  ],
  top: true,
});

// ================= Stock: the action bed, then the squared forend ahead of it
const ST = 'stock';
const FW = 0.025;
const FW_BOT = 0.022;
prism(
  ST,
  'action bed',
  [
    [TOP, -0.1, FW],
    [TOP, 0.062, FW],
    [BOT, 0.062, FW_BOT],
    [BOT, -0.1, FW_BOT],
  ],
  POLY,
);
prism(
  ST,
  'forend',
  [
    [FTOP, FZ0 + 0.006, FW - 0.0025],
    [FTOP, -0.099, FW - 0.0005],
    [BOT + 0.0005, -0.099, FW_BOT - 0.0005],
    [BOT + 0.0005, FZ0 + 0.01, FW_BOT - 0.0015],
    [BOT + 0.008, FZ0, FW_BOT - 0.003],
    [FTOP - 0.006, FZ0, FW - 0.004],
  ],
  POLY,
);
const sideW = (y) => FW_BOT + ((FW - FW_BOT) * (y - BOT)) / (TOP - BOT);
for (const s of [1, -1]) {
  for (const z of [-0.335, -0.27, -0.205])
    box(ST, 'forend vent', [s * (sideW(-0.024) - 0.0003), -0.024, z], [0.0012, 0.013, 0.05], SLOT);
  box(ST, 'bed edge', [s * (FW - 0.0014), TOP + 0.0002, -0.02], [0.003, 0.001, 0.15], POLY_HI);
}
box(ST, 'forend tip', [0, BOT + 0.004, FZ0 + 0.0035], [0.034, 0.006, 0.006], HG);
box(ST, 'magazine well', [0, BOT - 0.0002, MAG[2]], [0.03, 0.001, 0.09], SLOT);
bolt.triggerGuard({ y0: BOT, y1: -0.073, z0: 0.0, z1: 0.058, trigger: 0.032, color: POLY });
bolt.slingStud({ y: BOT + 0.0005, z: -0.41 });

// The grip: near upright, on a palm shelf that runs into the bottom bar.
prism(
  ST,
  'pistol grip',
  [
    [BOT + 0.002, 0.058],
    [BOT + 0.002, 0.114],
    [-0.13, 0.124],
    [-0.136, 0.072],
    [-0.08, 0.062],
  ].map(([y, z]) => [y, z, 0.0155]),
  POLY,
);
prism(
  ST,
  'palm shelf',
  [
    [-0.128, 0.064],
    [-0.128, 0.13],
    [-0.152, 0.134],
    [-0.152, 0.07],
    [-0.142, 0.06],
  ].map(([y, z]) => [y, z, 0.0175]),
  POLY,
);
for (const s of [1, -1])
  box(ST, 'grip texture', [s * 0.0157, -0.094, 0.091], [0.001, 0.05, 0.026], HG, { pitch: -8 });

// The butt (the factory stock, hidden by a fitted one): the comb over a small thumbhole, a
// solid back, a deep bottom bar, a long cheek riser and the pad with its hooked toe.
const hide = { hiddenBy: 'stock' };
const BW = 0.019;
prism(
  ST,
  'stock comb',
  [
    [TOP - 0.001, 0.06],
    [HEEL - 0.001, 0.26],
    [-0.036, 0.26],
    [-0.036, 0.13],
    [-0.022, 0.06],
  ].map(([y, z]) => [y, z, BW - 0.001]),
  POLY,
  hide,
);
prism(
  ST,
  'stock back',
  [
    [HEEL, 0.236],
    [HEEL, BUTT_Z],
    [TOE, BUTT_Z],
    [TOE, 0.3],
    [-0.092, 0.226],
    [-0.036, 0.222],
  ].map(([y, z]) => [y, z, BW]),
  POLY,
  hide,
);
prism(
  ST,
  'stock bottom',
  [
    [-0.096, 0.126],
    [-0.092, 0.24],
    [TOE + 0.002, 0.31],
    [-0.152, 0.132],
  ].map(([y, z]) => [y, z, BW - 0.003]),
  POLY,
  hide,
);
// The cheek riser: long, its front sloping up off the wrist, two knobs on the right.
prism(
  ST,
  'cheek riser',
  [
    [HEEL - 0.006, 0.12],
    [0.016, 0.15],
    [0.033, 0.2],
    [0.035, 0.232],
    [0.035, BUTT_Z - 0.004],
    [HEEL - 0.006, BUTT_Z - 0.004],
  ].map(([y, z]) => [y, z, 0.0165]),
  POLY_HI,
  hide,
);
box(ST, 'cheek seam', [0, HEEL - 0.0055, 0.26], [0.0335, 0.0012, 0.2], SLOT, hide);
for (const z of [0.26, 0.33]) {
  tubeX(ST, 'cheek knob', [BW + 0.0028, -0.008, z], 0.0055, 0.0056, STEEL, { sides: 10, ...hide });
  tubeX(ST, 'cheek knob cap', [BW + 0.0061, -0.008, z], 0.0034, 0.001, PIN, { sides: 8, ...hide });
}
bolt.slingStud({ y: -0.148, z: 0.2, hide });
const BACK = bolt.buttPad({ z: BUTT_Z, y0: TOE + 0.004, y1: HEEL - 0.002, w: BW - 0.0005, hide });
prism(
  ST,
  'pad toe hook',
  [
    [TOE + 0.012, BUTT_Z + 0.006],
    [TOE + 0.012, BACK],
    [TOE - 0.012, BACK + 0.004],
    [TOE - 0.016, BACK - 0.003],
    [TOE - 0.004, BUTT_Z + 0.004],
  ].map(([y, z]) => [y, z, BW - 0.002]),
  RUBBER,
  hide,
);

// ---- Points and mounts
const RAIL_X = ar.sideRail({
  s: 1,
  x0: FW - 0.0005 - 0.0015,
  y: -0.02,
  z0: -0.428,
  z1: -0.368,
  color: POLY,
});
const model = {
  parts,
  grip: [0, -0.09, 0.09],
  support: [0, BOT - 0.006, -0.28],
  muzzle: [0, B, MUZZLE_Z - 0.057],
  // No irons: bare, the eye looks along the rail.
  sight: [0, RAIL_TOP + 0.03, RAIL_Z[1]],
  mounts: {
    optic: [0, RAIL_TOP, -0.03],
    muzzle: [0, B, MUZZLE_Z],
    magazine: MAG,
    rightRail: [RAIL_X, -0.02, -0.398],
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts; back of the pad at', BACK.toFixed(3));
