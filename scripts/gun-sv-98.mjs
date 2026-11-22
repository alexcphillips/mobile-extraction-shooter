// The SV-98's model (GM-6a), built from the gun kit and the bolt-action pieces (gun-bolt.mjs):
// a plain heavy barrel with a slotted muzzle device, a round action under a rail, and the
// skeleton thumbhole stock that makes it read as itself: a shallow forend with a bipod bar
// under it, a big opening through the butt, a cheek rest standing on two posts and a butt
// plate with horns at heel and toe. Its irons are a target-style diopter on the action
// behind the rail (near the eye, so it reads on a phone) and a globe over a post at the
// muzzle. Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-sv-98.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, r5, v3, writeModel } from './gun-kit.mjs';
import { arPieces } from './gun-ar15.mjs';
import { BOLT, boltPieces } from './gun-bolt.mjs';
import { coreOutline, edgeFaces, ringFaces, roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/sv-98.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, PIN, STEEL, RUBBER, HG, SIGHT_BODY, SIGHT_LIP, BORE } = BOLT;
const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

// ---- Key sizes everything hangs off
const B = 0; // bore height
const R = 0.0165; // the action's radius
const RZ0 = -0.12; // action front
const RZ1 = 0.06; // action rear
const RAIL_Z = [-0.135, 0.026];
const RAIL_W = 0.0215;
const MUZZLE_Z = -0.74; // the barrel's end: where a muzzle device threads on
const TOP = 0.003; // the stock's top line along the action and forend
const BOT = -0.048; // the stock's bottom under the action
const FZ0 = -0.46; // forend front
const MAG = [0, BOT, -0.055]; // magazine mount: the well's mouth
const STOCK = [0, -0.01, 0.12]; // where a stock's front would sit, behind the grip
const REAR_Z = 0.044; // the diopter, on the action behind the rail
const FRONT_Z = -0.703; // the globe, just behind the muzzle device

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const bolt = boltPieces(kit);

// ================= Action, rail and bolt
const RAIL_BASE = bolt.receiver({ B, R, z0: RZ0, z1: RZ1, port: [-0.05, 0.02], railZ: RAIL_Z });
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048;
// The sight line: under the lowest optic's sight point, as on every gun.
const SIGHT_Y = RAIL_TOP + 0.024;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
ar.topRail({ name: 'top rail', z0: RAIL_Z[0], z1: RAIL_Z[1], inset: [0.003, 0.003] });
bolt.boltHandle({
  B,
  R,
  z1: RZ1,
  shroud: 0.024,
  root: [R, 0.003, 0.05],
  knob: [0.05, -0.023, 0.05],
  knobR: 0.0075,
});
box('receiver', 'safety', [0, R + 0.001, RZ1 + 0.012], [0.006, 0.004, 0.01], PIN);

// ================= Barrel and muzzle device (the factory muzzle)
bolt.barrel({ B, z0: RZ0, zTaper: -0.26, zMuzzle: MUZZLE_Z, rShank: 0.0125, r: 0.0098 });
bolt.brake({
  B,
  z0: MUZZLE_Z,
  len: 0.062,
  r: 0.0142,
  portH: 0.004,
  ports: [[-0.776, 0.034]],
});

// ================= Stock: forend and action bed in one hull
const ST = 'stock';
const FW = 0.024; // half width at the top
const FW_BOT = 0.019; // and at the bottom
prism(
  ST,
  'stock body',
  [
    [TOP, FZ0 + 0.01, FW - 0.003],
    [TOP, 0.064, FW],
    [BOT, 0.064, FW_BOT],
    [BOT, -0.12, FW_BOT],
    [-0.037, -0.44, FW_BOT - 0.002],
    [-0.026, FZ0, FW_BOT - 0.004],
    [TOP - 0.01, FZ0, FW - 0.005],
  ],
  POLY,
);
const sideW = (y) => FW_BOT + ((FW - FW_BOT) * (y - BOT)) / (TOP - BOT);
// The plywood's glue lines: a lighter edge along the top, a dark line down each side.
for (const s of [1, -1]) {
  box(ST, 'forend edge', [s * (FW - 0.0014), TOP + 0.0002, -0.22], [0.003, 0.001, 0.44], POLY_HI);
  box(ST, 'forend line', [s * (sideW(-0.016) + 0.0002), -0.016, -0.25], [0.001, 0.0025, 0.36], HG);
}
// The bipod bar under the forend: a flat strip, no teeth (nothing mounts there).
const barY = (z) => BOT + ((-0.037 - BOT) * (z + 0.12)) / (-0.44 + 0.12);
extrudeZ(
  ST,
  'bipod bar',
  [
    [-0.0065, 0.0005],
    [0.0065, 0.0005],
    [0.0065, -0.004],
    [0.0045, -0.0055],
    [-0.0045, -0.0055],
    [-0.0065, -0.004],
  ].map(([x, y]) => [x, y + barY(-0.27)]),
  -0.41,
  -0.15,
  SLOT,
  { pitch: r5((Math.atan2(barY(-0.41) - barY(-0.15), 0.26) * 180) / Math.PI) },
);
box(ST, 'magazine well', [0, BOT - 0.0002, MAG[2]], [0.03, 0.001, 0.094], SLOT);
bolt.triggerGuard({ y0: BOT, y1: -0.074, z0: 0.0, z1: 0.066, trigger: 0.035, color: STEEL });
box(ST, 'magazine catch', [0, BOT - 0.004, -0.003], [0.008, 0.008, 0.006], STEEL);
bolt.slingStud({ y: barY(-0.43) + 0.002, z: -0.43 });

// The grip, raked further back than the AWM's.
prism(
  ST,
  'pistol grip',
  [
    [BOT + 0.002, 0.054],
    [BOT + 0.002, 0.112],
    [-0.1, 0.128],
    [-0.136, 0.138],
    [-0.142, 0.112],
    [-0.124, 0.088],
    [-0.08, 0.066],
  ].map(([y, z]) => [y, z, 0.015]),
  POLY,
);
for (const s of [1, -1])
  box(ST, 'grip stipple', [s * 0.0152, -0.097, 0.098], [0.001, 0.046, 0.022], HG, { pitch: -22 });

// The butt (the factory stock, hidden by a fitted one): a comb bar and a bottom bar framing
// a big opening, an upright at the back, the cheek rest on posts and the horned plate.
const hide = { hiddenBy: 'stock' };
const BW = 0.0175;
const UZ1 = 0.355; // the upright's back
prism(
  ST,
  'stock comb',
  [
    [TOP - 0.001, 0.062],
    [0.008, UZ1 - 0.02],
    [-0.026, UZ1 - 0.02],
    [-0.028, 0.13],
    [-0.018, 0.062],
  ].map(([y, z]) => [y, z, BW - 0.0015]),
  POLY,
  hide,
);
prism(
  ST,
  'stock upright',
  [
    [0.008, 0.3],
    [0.008, UZ1],
    [-0.106, UZ1],
    [-0.114, 0.33],
    [-0.1, 0.296],
    [-0.024, 0.3],
  ].map(([y, z]) => [y, z, BW]),
  POLY,
  hide,
);
prism(
  ST,
  'stock bottom',
  [
    [-0.118, 0.116],
    [-0.098, 0.31],
    [-0.114, 0.335],
    [-0.14, 0.13],
  ].map(([y, z]) => [y, z, BW - 0.003]),
  POLY,
  hide,
);
// The cheek rest: a block on two posts, a clamp knob on the left.
for (const z of [0.19, 0.29])
  box(ST, 'cheek post', [0, 0.0175, z], [0.006, 0.02, 0.006], STEEL, hide);
extrudeZ(
  ST,
  'cheek rest',
  rounded(
    [
      [-0.0145, 0.0255],
      [0.0145, 0.0255],
      [0.0145, 0.032],
      [-0.0145, 0.032],
    ],
    0.002,
  ),
  0.165,
  0.33,
  POLY_HI,
  hide,
);
tubeX(ST, 'cheek clamp', [-(BW + 0.0025), -0.006, 0.29], 0.0055, 0.005, STEEL, { sides: 10, ...hide });
// The butt plate: two rods out of the upright, a rubber pad, horns at heel and toe.
for (const y of [-0.02, -0.085])
  tubeZ(ST, 'butt plate rod', y, UZ1 - 0.002, UZ1 + 0.008, 0.003, PIN, { sides: 6, ...hide });
const PZ = UZ1 + 0.007; // the pad's front
prism(
  ST,
  'butt pad',
  [
    [0.0, PZ],
    [0.0, PZ + 0.012],
    [-0.104, PZ + 0.012],
    [-0.104, PZ],
  ].map(([y, z]) => [y, z, 0.0185]),
  RUBBER,
  hide,
);
for (const [name, pts] of [
  [
    'butt plate heel',
    [
      [-0.001, PZ],
      [-0.001, PZ + 0.013],
      [0.019, PZ + 0.019],
      [0.024, PZ + 0.013],
      [0.012, PZ + 0.002],
    ],
  ],
  [
    'butt plate toe',
    [
      [-0.103, PZ],
      [-0.103, PZ + 0.013],
      [-0.132, PZ + 0.022],
      [-0.138, PZ + 0.016],
      [-0.12, PZ + 0.002],
    ],
  ],
])
  prism(ST, name, pts.map(([y, z]) => [y, z, 0.018]), RUBBER, hide);
bolt.slingStud({ y: -0.124, z: 0.24, hide });

// ================= Iron sights: the diopter (hidden by an optic) and the globe front (stays)
const IS = 'iron sights';
const hideRear = { hiddenBy: 'optic' };
// Rear: a clamp on the action, a narrow housing, and a thin ring on top facing the eye
// (a ghost ring: the hole large, the ring thin), knurled knobs either side.
const A = { rOut: 0.0084, rLip: 0.0068, rHole: 0.0062, z0: REAR_Z - 0.0005, z1: REAR_Z + 0.0055 };
const HOUSING_TOP = SIGHT_Y - A.rOut + 0.0012;
extrudeZ(
  IS,
  'rear sight base',
  [
    [-0.0098, R - 0.004],
    [0.0098, R - 0.004],
    [0.0098, R + 0.0035],
    [0.008, R + 0.0055],
    [-0.008, R + 0.0055],
    [-0.0098, R + 0.0035],
  ],
  REAR_Z - 0.009,
  REAR_Z + 0.009,
  REC,
  hideRear,
);
extrudeZ(
  IS,
  'rear sight housing',
  rounded(
    [
      [-0.0062, R + 0.005],
      [0.0062, R + 0.005],
      [0.0052, HOUSING_TOP - 0.0012],
      [-0.0052, HOUSING_TOP - 0.0012],
    ],
    0.0012,
  ),
  REAR_Z - 0.006,
  REAR_Z + 0.005,
  SIGHT_BODY,
  hideRear,
);
for (const s of [1, -1]) {
  tubeX(IS, 'rear sight knob', [s * 0.0094, SIGHT_Y - 0.013, REAR_Z - 0.001], 0.0042, 0.0046, SIGHT_BODY, {
    sides: 12,
    ...hideRear,
  });
  tubeX(IS, 'rear sight knob cap', [s * 0.0119, SIGHT_Y - 0.013, REAR_Z - 0.001], 0.0026, 0.0008, SIGHT_LIP, {
    sides: 8,
    ...hideRear,
  });
}
add({
  type: 'panel',
  pos: v3([0, SIGHT_Y - 0.0125, REAR_Z + 0.0051]),
  pitch: 90,
  size: [0.0008, 0.0026],
  color: SIGHT_LIP,
  name: 'rear sight index',
  group: IS,
  ...hideRear,
});
const ringPart = (name, color, extra = hideRear) => (p) =>
  add({ ...p, name, group: IS, color, ...extra });
const c = [0, SIGHT_Y];
const ring24 = roundOutline(24);
ringFaces(ringPart('rear sight ring', SIGHT_BODY), {
  outline: ring24,
  rOut: A.rOut,
  rIn: A.rLip,
  center: c,
  z: A.z1,
  back: true,
  color: SIGHT_BODY,
});
ringFaces(ringPart('rear sight ring', SIGHT_LIP), {
  outline: ring24,
  rOut: A.rLip,
  rIn: A.rHole,
  center: c,
  z: A.z1 + 0.0002,
  back: true,
  color: SIGHT_LIP,
});
ringFaces(ringPart('rear sight ring', SIGHT_BODY), {
  outline: ring24,
  rOut: A.rOut,
  rIn: A.rHole,
  center: c,
  z: A.z0,
  back: false,
  color: SIGHT_BODY,
});
edgeFaces(ringPart('rear sight ring', SIGHT_BODY), {
  outline: ring24,
  r: A.rOut,
  center: c,
  z0: A.z0,
  z1: A.z1,
  outward: true,
  color: SIGHT_BODY,
});
edgeFaces(ringPart('rear sight ring', BORE), {
  outline: ring24,
  r: A.rHole,
  center: c,
  z0: A.z0,
  z1: A.z1 + 0.0002,
  outward: false,
  color: BORE,
});

// Front: a band round the barrel, a tower, and a globe (a tunnel open both ends) with the
// post rising to its center. Thick enough to read a meter from the eye.
const G = { rOut: 0.0086, rIn: 0.0068, half: 0.0065 };
tubeZ(IS, 'front sight band', B, FRONT_Z - 0.011, FRONT_Z + 0.011, 0.0122, SIGHT_BODY, { sides: 12 });
extrudeZ(
  IS,
  'front sight tower',
  rounded(
    [
      [-0.0058, 0.008],
      [0.0058, 0.008],
      [0.0036, SIGHT_Y - G.rOut + 0.0012],
      [-0.0036, SIGHT_Y - G.rOut + 0.0012],
    ],
    0.001,
  ),
  FRONT_Z - 0.0055,
  FRONT_Z + 0.0055,
  SIGHT_BODY,
);
const ring20 = roundOutline(20);
const globe = ringPart('front sight hood', SIGHT_BODY, {});
for (const [zz, back] of [
  [FRONT_Z + G.half, true],
  [FRONT_Z - G.half, false],
])
  ringFaces(globe, { outline: ring20, rOut: G.rOut, rIn: G.rIn, center: c, z: zz, back, color: SIGHT_BODY });
edgeFaces(globe, {
  outline: ring20,
  r: G.rOut,
  center: c,
  z0: FRONT_Z - G.half,
  z1: FRONT_Z + G.half,
  outward: true,
  color: SIGHT_BODY,
});
edgeFaces(ringPart('front sight hood', BORE, {}), {
  outline: ring20,
  r: G.rIn,
  center: c,
  z0: FRONT_Z - G.half,
  z1: FRONT_Z + G.half,
  outward: false,
  color: '#1c1e20',
});
box(
  IS,
  'front sight post',
  [0, SIGHT_Y - G.rIn / 2 + 0.0002, FRONT_Z],
  [0.0034, G.rIn + 0.0004, 0.0034],
  SIGHT_BODY,
);

// ---- Points and mounts
const RAIL_X = ar.sideRail({
  s: 1,
  x0: sideW(-0.018) - 0.0005,
  y: -0.018,
  z0: -0.4,
  z1: -0.33,
  color: POLY,
});
const model = {
  parts,
  grip: [0, -0.086, 0.094],
  support: [0, -0.052, -0.29],
  muzzle: [0, B, MUZZLE_Z - 0.063],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, -0.055],
    muzzle: [0, B, MUZZLE_Z],
    magazine: MAG,
    rightRail: [RAIL_X, -0.018, -0.365],
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts; sight line', SIGHT_Y.toFixed(4));
