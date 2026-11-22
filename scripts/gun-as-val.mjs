// The AS Val's model (GM-6c), on the platform's shared body (gun-val.mjs): the receiver,
// railed cover, notch, integral suppressor with its front post, and trigger guard. Its own
// furniture is what makes it read as itself: a squared polymer handguard between the
// receiver and the suppressor with a laser rail on its right, a polymer pistol grip, and the
// skeleton stock of steel tubes on a hinge block (shaped like the real side-folder, but it
// doesn't fold: folding is an SMG identity, the user's call). Replaces only `model` in its
// item file. See docs/guns.md.
//
//   node scripts/gun-as-val.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, writeModel } from './gun-kit.mjs';
import { AK } from './gun-ak.mjs';
import { VAL, valBody } from './gun-val.mjs';

const FILE = new URL('../content/items/as-val.json', import.meta.url).pathname;
const { SLOT, POLY, POLY_HI, STEEL, PIN, RUBBER, REC } = AK;
const { B, RBOT, RZ0, RZ1, SZ, GRIP_Z } = VAL;

const kit = gunParts();
const { parts, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const body = valBody(kit);

// ================= Handguard: squared polymer over the gas tube, vents down each side
const HG = 'handguard';
const HW = 0.0185;
const HTOP = B + 0.019;
const HBOT = B - 0.022;
extrudeZ(HG, 'handguard', octagon(HW, HTOP, HBOT, 0.006), SZ[0] + 0.004, RZ0 - 0.001, POLY);
for (const s of [1, -1])
  for (const z of [-0.105, -0.13])
    box(HG, 'handguard vent', [s * (HW + 0.0002), B + 0.01, z], [0.0006, 0.005, 0.018], SLOT);
for (const z of [-0.11, -0.15, -0.19])
  box(HG, 'handguard rib', [0, HBOT - 0.0002, z], [0.016, 0.0006, 0.004], POLY_HI);
const RAIL_X = body.ak.ar.sideRail({ s: 1, x0: HW - 0.0005, y: B - 0.004, z0: -0.195, z1: -0.145, color: POLY });

// ================= Pistol grip: raked, swelled at the palm, finger grooves, a dark cap
const GR = 'grip';
const y = RBOT + 0.0015;
const z = GRIP_Z;
prism(
  GR,
  'pistol grip',
  [
    [y, z, 0.0118],
    [y, z + 0.034, 0.0118],
    [y - 0.046, z + 0.052, 0.0142],
    [y - 0.09, z + 0.066, 0.0132],
    [y - 0.093, z + 0.062, 0.0128],
    [y - 0.093, z + 0.035, 0.0128],
    [y - 0.05, z + 0.016, 0.0142],
    [y - 0.012, z + 0.002, 0.0124],
  ],
  POLY,
);
for (let i = 0; i < 3; i++) {
  const t = 0.22 + i * 0.22;
  box(GR, 'grip groove', [0, y - 0.012 - t * 0.075, z + 0.004 + t * 0.03], [0.018, 0.0016, 0.0016], SLOT, {
    pitch: -21,
  });
}
prism(
  GR,
  'grip cap',
  [
    [y - 0.0915, z + 0.0345],
    [y - 0.0915, z + 0.0635],
    [y - 0.095, z + 0.0625],
    [y - 0.095, z + 0.0355],
  ].map(([yy, zz]) => [yy, zz, 0.0122]),
  RUBBER,
);

// ================= Stock: a hinge block on the receiver's back (stays), then the skeleton
// of tubes, a strut, and the steel butt frame round a rubber pad (factory, hidden by a stock)
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const BZ = 0.36; // the butt frame's front
const HEEL = B + 0.012;
const TOE = B - 0.098;
extrudeZ(
  ST,
  'hinge block',
  [
    [-0.0128, B + 0.008],
    [0.0128, B + 0.008],
    [0.0128, RBOT + 0.004],
    [-0.0128, RBOT + 0.004],
  ],
  RZ1 - 0.002,
  RZ1 + 0.018,
  REC,
);
tubeX(ST, 'hinge pin', [-0.0135, B - 0.004, RZ1 + 0.009], 0.003, 0.003, PIN, { sides: 8 });
tubeZ(ST, 'stock tube', B + 0.002, RZ1 + 0.016, BZ + 0.002, 0.0062, STEEL, { sides: 8, ...hide });
prism(
  ST,
  'stock strut',
  [
    [RBOT + 0.008, RZ1 + 0.012],
    [RBOT + 0.016, RZ1 + 0.026],
    [TOE + 0.012, BZ + 0.002],
    [TOE + 0.002, BZ + 0.002],
  ].map(([yy, zz]) => [yy, zz, 0.0052]),
  STEEL,
  hide,
);
// The cheek rest: a short steel saddle on the top tube.
prism(
  ST,
  'cheek rest',
  [
    [B + 0.006, 0.2],
    [B + 0.0105, 0.215],
    [B + 0.0105, 0.3],
    [B + 0.006, 0.31],
    [B - 0.001, 0.3],
    [B - 0.001, 0.21],
  ].map(([yy, zz]) => [yy, zz, 0.0085]),
  STEEL,
  hide,
);
// The butt frame: a steel loop, its rubber pad behind.
for (const [name, pts] of [
  [
    'butt frame top',
    [
      [HEEL, BZ - 0.004],
      [HEEL, BZ + 0.006],
      [HEEL - 0.009, BZ + 0.006],
      [HEEL - 0.009, BZ - 0.006],
    ],
  ],
  [
    'butt frame bottom',
    [
      [TOE + 0.009, BZ - 0.006],
      [TOE + 0.009, BZ + 0.006],
      [TOE, BZ + 0.006],
      [TOE, BZ - 0.002],
    ],
  ],
  [
    'butt frame back',
    [
      [HEEL, BZ],
      [HEEL, BZ + 0.006],
      [TOE, BZ + 0.006],
      [TOE, BZ],
    ],
  ],
])
  prism(ST, name, pts.map(([yy, zz]) => [yy, zz, 0.013]), STEEL, hide);
extrudeZ(
  ST,
  'butt pad',
  [
    [-0.0135, HEEL - 0.0015],
    [0.0135, HEEL - 0.0015],
    [0.0135, TOE + 0.0015],
    [-0.0135, TOE + 0.0015],
  ],
  BZ + 0.006,
  BZ + 0.016,
  RUBBER,
  hide,
);
box(ST, 'butt pad ribs', [0, (HEEL + TOE) / 2, BZ + 0.0162], [0.02, 0.07, 0.0006], SLOT, hide);

// ---- Points and mounts
const model = {
  parts,
  grip: body.grip,
  support: [0, HBOT - 0.003, -0.15],
  muzzle: body.muzzle,
  sight: body.sight,
  mounts: {
    optic: body.mounts.optic,
    magazine: body.mounts.magazine,
    rightRail: [RAIL_X, B - 0.004, -0.17],
    stock: body.mounts.stock,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
