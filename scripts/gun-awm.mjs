// The AWM's model (GM-6a), built from the gun kit and the bolt-action pieces (gun-bolt.mjs):
// a heavy fluted barrel and a big ported brake, a round action under a long top rail, and
// the slab-sided thumbhole stock that makes it read as itself: a deep flat forend with a
// groove down each side, a near-upright grip, a solid butt with an adjustable cheek piece
// and a spacered pad. No iron sights, true to the real one (the user's call): bare, it aims
// along the rail. Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-awm.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { arPieces } from './gun-ar15.mjs';
import { BOLT, boltPieces } from './gun-bolt.mjs';

const FILE = new URL('../content/items/awm.json', import.meta.url).pathname;
const { SLOT, POLY, POLY_HI, PIN, STEEL, HG } = BOLT;

// ---- Key sizes everything hangs off
const B = 0; // bore height
const R = 0.0175; // the action's radius
const RZ0 = -0.135; // action front
const RZ1 = 0.095; // action rear
const RAIL_Z = [-0.15, 0.088];
const RAIL_W = 0.0215;
const MUZZLE_Z = -0.79; // the barrel's end: where a muzzle device threads on
const TOP = 0.005; // the stock's top line along the action and forend
const BOT = -0.052; // the stock's bottom under the action
const FZ0 = -0.475; // forend front
const MAG = [0, BOT, -0.06]; // magazine mount: the well's mouth
const STOCK = [0, -0.01, 0.135]; // where a stock's front would sit, behind the grip
const BUTT_Z = 0.385; // the stock's back, before the spacer and pad
const HEEL = 0.013; // the butt's top at the back
const TOE = -0.128; // the butt's bottom at the back

const kit = gunParts();
const { parts, box, tubeX, prism } = kit;
const bolt = boltPieces(kit);

// ================= Action, rail and bolt
const RAIL_BASE = bolt.receiver({ B, R, z0: RZ0, z1: RZ1, port: [-0.045, 0.03], railZ: RAIL_Z });
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
ar.topRail({ name: 'top rail', z0: RAIL_Z[0], z1: RAIL_Z[1], inset: [0.003, 0.003] });
bolt.boltHandle({
  B,
  R,
  z1: RZ1,
  shroud: 0.026,
  root: [R, 0.004, 0.072],
  knob: [0.047, -0.017, 0.072],
  knobR: 0.0085,
});
// The bolt release on the left at the back of the action.
box('receiver', 'bolt release', [-(R + 0.001), 0.004, 0.082], [0.003, 0.006, 0.012], PIN);

// ================= Barrel and brake (the brake is the factory muzzle)
bolt.barrel({
  B,
  z0: RZ0,
  zTaper: -0.3,
  zMuzzle: MUZZLE_Z,
  rShank: 0.0138,
  r: 0.0115,
  flutes: [-0.33, -0.72],
});
bolt.brake({
  B,
  z0: MUZZLE_Z,
  len: 0.075,
  r: 0.0165,
  portH: 0.007,
  ports: [
    [-0.812, 0.01],
    [-0.829, 0.01],
    [-0.846, 0.01],
  ],
  top: true,
});

// ================= Stock: forend and action bed in one slab-sided hull
const ST = 'stock';
const FW = 0.026; // half width at the top
const FW_BOT = 0.022; // and at the bottom
prism(
  ST,
  'stock body',
  [
    [TOP, FZ0 + 0.006, FW - 0.002],
    [TOP, 0.07, FW],
    [BOT, 0.07, FW_BOT],
    [BOT, -0.11, FW_BOT],
    [BOT + 0.006, -0.42, FW_BOT - 0.001],
    [-0.036, FZ0, FW_BOT - 0.003],
    [TOP - 0.008, FZ0, FW - 0.004],
  ],
  POLY,
);
// A groove down each side of the forend, and its bevelled top edge catching the light.
const sideW = (y) => FW_BOT + ((FW - FW_BOT) * (y - BOT)) / (TOP - BOT);
for (const s of [1, -1]) {
  box(ST, 'forend groove', [s * (sideW(-0.024) + 0.0002), -0.024, -0.27], [0.001, 0.0045, 0.29], SLOT);
  box(ST, 'forend edge', [s * (FW - 0.0016), TOP + 0.0002, -0.25], [0.0036, 0.001, 0.4], POLY_HI);
}
// The magazine well's mouth, and the release lever ahead of the trigger guard.
box(ST, 'magazine well', [0, BOT - 0.0002, MAG[2]], [0.028, 0.001, 0.108], SLOT);
box(ST, 'magazine release', [0, BOT - 0.004, -0.001], [0.009, 0.008, 0.005], STEEL);
bolt.triggerGuard({ y0: BOT, y1: -0.079, z0: 0.004, z1: 0.07, trigger: 0.038, color: POLY });
bolt.slingStud({ y: BOT + 0.006, z: -0.43 });

// The grip: the thumbhole's front, near upright, a palm swell at its back.
prism(
  ST,
  'pistol grip',
  [
    [BOT + 0.002, 0.062],
    [BOT + 0.002, 0.122],
    [-0.1, 0.136],
    [-0.142, 0.138],
    [-0.146, 0.11],
    [-0.13, 0.092],
    [-0.08, 0.072],
  ].map(([y, z]) => [y, z, 0.0155]),
  POLY,
);
for (const s of [1, -1])
  box(ST, 'grip texture', [s * 0.0157, -0.1, 0.104], [0.001, 0.05, 0.024], HG, { pitch: -14 });

// The butt (the factory stock, hidden by a fitted one): the comb over the thumbhole, a solid
// back, the bottom bar from the grip's foot, an adjustable cheek piece and the pad.
const hide = { hiddenBy: 'stock' };
const BW = 0.02; // the butt's half width
prism(
  ST,
  'stock comb',
  [
    [TOP - 0.001, 0.068],
    [HEEL - 0.001, 0.27],
    [-0.04, 0.27],
    [-0.034, 0.12],
    [-0.02, 0.068],
  ].map(([y, z]) => [y, z, BW - 0.001]),
  POLY,
  hide,
);
prism(
  ST,
  'stock back',
  [
    [HEEL, 0.25],
    [HEEL, BUTT_Z],
    [TOE, BUTT_Z],
    [TOE + 0.004, 0.3],
    [-0.105, 0.238],
    [-0.04, 0.236],
  ].map(([y, z]) => [y, z, BW]),
  POLY,
  hide,
);
prism(
  ST,
  'stock bottom',
  [
    [-0.116, 0.128],
    [-0.106, 0.25],
    [TOE + 0.004, 0.3],
    [-0.143, 0.128],
  ].map(([y, z]) => [y, z, BW - 0.003]),
  POLY,
  hide,
);
// The cheek piece: a block riding on the comb, its height set by a knob on the left.
prism(
  ST,
  'cheek piece',
  [
    [HEEL - 0.004, 0.17],
    [0.03, 0.185],
    [0.034, 0.24],
    [0.034, 0.372],
    [HEEL - 0.004, 0.372],
  ].map(([y, z]) => [y, z, 0.017]),
  POLY_HI,
  hide,
);
box(ST, 'cheek piece seam', [0, HEEL - 0.0035, 0.27], [0.0352, 0.0012, 0.2], SLOT, hide);
tubeX(ST, 'cheek knob', [-(BW + 0.003), -0.004, 0.33], 0.0065, 0.006, STEEL, { sides: 10, ...hide });
tubeX(ST, 'cheek knob cap', [-(BW + 0.0062), -0.004, 0.33], 0.004, 0.001, PIN, { sides: 8, ...hide });
bolt.slingStud({ y: TOE + 0.003, z: 0.34, hide });
const BACK = bolt.buttPad({ z: BUTT_Z, y0: TOE + 0.002, y1: HEEL - 0.002, w: BW - 0.0005, hide });

// ---- Points and mounts
const RAIL_X = ar.sideRail({
  s: 1,
  x0: sideW(-0.02) - 0.0005,
  y: -0.02,
  z0: -0.42,
  z1: -0.34,
  color: POLY,
});
const model = {
  parts,
  grip: [0, -0.088, 0.104],
  support: [0, BOT - 0.006, -0.3],
  muzzle: [0, B, MUZZLE_Z - 0.076],
  // No irons: bare, the eye looks along the rail.
  sight: [0, RAIL_TOP + 0.03, RAIL_Z[1]],
  mounts: {
    optic: [0, RAIL_TOP, -0.035],
    muzzle: [0, B, MUZZLE_Z],
    magazine: MAG,
    rightRail: [RAIL_X, -0.02, -0.38],
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts; back of the pad at', BACK.toFixed(3));
