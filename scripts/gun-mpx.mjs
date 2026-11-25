// The MPX's model, from the user's reference picture: a 9 mm carbine whose railed handguard
// (toothed sides, a deep bottom rail, slanted vents along its shoulders) runs into the upper,
// a channel down the upper's left, a flared well leaning forward over a long curved magazine,
// a round trigger guard, a swept grip, and a thin two-rod stock with a small open butt. It
// doesn't fold (the user's call). Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-mpx.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { pistolPieces } from './gun-pistol.mjs';

const FILE = new URL('../content/items/mpx.json', import.meta.url).pathname;
const { REC, SLOT, HG, POLY, POLY_HI, STEEL, RUBBER, PIN } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RAIL_BASE = 0.04;
const RAIL_TOP = 0.05; // top of the teeth: the optic mount's height
const TEETH_Y0 = 0.0452;
const RAIL_W = 0.0215;
const UZ0 = -0.06; // upper receiver front (inside the handguard)
const UZ1 = 0.124; // upper receiver rear
const UW = 0.0275;
const HZ0 = -0.206; // handguard front
const HZ1 = -0.058; // handguard rear
const HW = 0.0188; // handguard half width, under its side rails
const HTOP = 0.0405;
const HBOT = -0.0145;
const MUZZLE_Z = -0.25; // where a muzzle device threads on
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const REAR_Z = 0.108;
const FRONT_Z = -0.19;
const MAG = [0, -0.058, -0.028]; // magazine mount: the magwell's mouth
const TUBE_Y = 0.012; // a fitted AR stock's tube axis
const STOCK = [0, TUBE_Y, 0.18];

const kit = gunParts();
const { parts, box, tubeZ, tubeX, prism, extrudeZ } = kit;
// Flat marks are panels (2 triangles), so the full build stays in budget.
const { decal, decals, circle, rect } = pistolPieces(kit);
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });

// ================= Upper receiver and one top rail along it and the handguard
ar.upper({ UZ0, UZ1, UW, forwardAssist: false });
ar.topRail({ name: 'top rail', z0: UZ0 + 0.004, z1: UZ1 - 0.003 });
ar.topRail({
  name: 'handguard rail',
  z0: HZ0 + 0.003,
  z1: UZ0 + 0.002,
  inset: [0.002, 0.004],
  dy: 0.0005,
  color: HG,
});

// The channel down the upper's left side, the ledge under it, the ambidextrous catch.
decal(
  'upper receiver',
  'side channel',
  -1,
  UW / 2 + 0.0004,
  rect(0.0157, 0.0273, 0.003, 0.121),
  SLOT,
);
box(
  'upper receiver',
  'channel ledge',
  [-(UW / 2 + 0.0012), 0.0135, 0.058],
  [0.0028, 0.0036, 0.126],
  HG,
);
box(
  'upper receiver',
  'channel lip',
  [-(UW / 2 + 0.0007), 0.0295, 0.062],
  [0.0018, 0.0026, 0.118],
  HG,
);
box(
  'upper receiver',
  'port catch',
  [-(UW / 2 + 0.0012), 0.0185, -0.014],
  [0.0028, 0.009, 0.011],
  PIN,
);

// ================= Handguard: railed on its sides and bottom, slanted vents on its shoulders
const HAND = 'handguard';
extrudeZ(HAND, 'handguard', octagon(HW, HTOP, HBOT, 0.005), HZ0, HZ1, REC);
tubeZ(HAND, 'handguard front ring', B, HZ0 - 0.001, HZ0 + 0.003, 0.0125, SLOT, { sides: 8 });
for (let i = 0; i < 6; i++) {
  const z = HZ0 + 0.0105 + i * 0.0215;
  decals(
    HAND,
    'vent',
    HW + 0.0004,
    [
      [0.0255, z],
      [0.0255, z + 0.0045],
      [0.0352, z + 0.0165],
      [0.0352, z + 0.012],
    ],
    SLOT,
  );
}
const SIDE_RAIL_Z = [HZ0 + 0.004, -0.12];
const RAIL_Y = 0.0115;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: HW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: HG,
});
ar.sideRail({
  s: -1,
  x0: HW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: HG,
});
// Behind the side rails, a smooth swell back to the receiver with a pinned sling cup.
for (const s of [1, -1]) {
  prism(
    HAND,
    'handguard swell',
    [
      [RAIL_Y + 0.0105, -0.119],
      [RAIL_Y + 0.0105, HZ1],
      [RAIL_Y - 0.0105, HZ1],
      [RAIL_Y - 0.0105, -0.119],
    ].map(([y, z]) => [y, z, 0.0026]),
    HG,
    { x: s * (HW + 0.0018) },
  );
  decal(HAND, 'sling cup', s, HW + 0.0047, circle(0.0052, [RAIL_Y, -0.084], 8), SLOT);
}
// The bottom rail on a step of its own, hanging below the handguard.
const STEP = HBOT - 0.005;
extrudeZ(
  HAND,
  'bottom step',
  [
    [-0.0125, HBOT + 0.001],
    [0.0125, HBOT + 0.001],
    [0.0108, STEP],
    [-0.0108, STEP],
  ],
  HZ0 + 0.014,
  -0.074,
  REC,
);
const FOREGRIP_Y = ar.bottomRail({ bot: STEP, z0: -0.172, z1: -0.098, color: HG });

// ================= Barrel (stays: no barrel slot) and flash hider (factory, hidden by a
// muzzle device)
tubeZ('barrel', 'barrel', B, HZ0 + 0.002, MUZZLE_Z - 0.002, 0.0068, STEEL, { sides: 8 });
ar.birdcage({ B, MUZZLE_Z });

// ================= Lower receiver: a well leaning forward and flaring to its mouth, a round
// trigger guard, oversize controls
const LO = 'lower receiver';
const LW = 0.0135;
const side = (pts, w) => pts.map(([y, z]) => [y, z, w]);
prism(
  LO,
  'lower receiver',
  side(
    [
      [-0.0005, UZ0 + 0.002],
      [-0.0005, 0.122],
      [-0.01, 0.13],
      [-0.02, 0.129],
      [-0.0305, 0.108],
      [-0.0305, 0.0],
      [-0.013, UZ0 + 0.002],
    ],
    LW,
  ),
  REC,
);
prism(
  LO,
  'magazine well',
  [
    [-0.004, -0.05, 0.0142],
    [-0.004, 0.011, 0.0142],
    [-0.03, 0.008, 0.0146],
    [-0.05, -0.0015, 0.0152],
    [-0.05, -0.0585, 0.0152],
  ],
  REC,
);
// The mouth's rim, a step wider, and two grooves leaning with the well.
prism(
  LO,
  'magazine well flare',
  [
    [-0.0485, -0.0005, 0.0172],
    [-0.0485, -0.0595, 0.0172],
    [-0.0585, -0.0635, 0.0178],
    [-0.0585, -0.0035, 0.0178],
  ],
  HG,
);
for (const z of [-0.036, -0.02])
  decals(
    LO,
    'well groove',
    0.0155,
    [
      [-0.018, z + 0.002],
      [-0.018, z + 0.006],
      [-0.043, z - 0.002],
      [-0.043, z - 0.006],
    ],
    SLOT,
  );
// The guard: a half round from the well's back to the grip.
const guard = (r) =>
  [0, 36, 72, 108, 144, 180].map((a) => {
    const t = (a * Math.PI) / 180;
    return [-0.0305 - Math.sin(t) * r * 0.84, 0.0475 - Math.cos(t) * r * 1.2];
  });
const gOut = guard(0.031);
const gIn = guard(0.0272);
for (let i = 0; i + 1 < gOut.length; i++)
  prism(LO, 'trigger guard', side([gOut[i], gOut[i + 1], gIn[i + 1], gIn[i]], 0.0055), REC);
prism(
  LO,
  'trigger',
  side(
    [
      [-0.03, 0.044],
      [-0.03, 0.051],
      [-0.042, 0.053],
      [-0.042, 0.049],
    ],
    0.0026,
  ),
  STEEL,
);
prism(
  LO,
  'trigger',
  side(
    [
      [-0.0415, 0.0495],
      [-0.0415, 0.053],
      [-0.051, 0.0475],
      [-0.051, 0.0455],
    ],
    0.0026,
  ),
  STEEL,
);
for (const s of [1, -1]) {
  tubeX(LO, 'selector hub', [s * (LW + 0.001), -0.012, 0.092], 0.0048, 0.003, STEEL, { sides: 6 });
  box(LO, 'selector', [s * (LW + 0.0024), -0.0175, 0.0925], [0.0016, 0.015, 0.0052], PIN);
  box(LO, 'magazine release', [s * (LW + 0.0016), -0.0245, 0.0165], [0.0034, 0.0062, 0.0105], PIN);
}
prism(
  LO,
  'bolt catch',
  side(
    [
      [0.001, 0.0005],
      [0.001, 0.0075],
      [-0.0165, 0.0065],
      [-0.0165, 0.001],
    ],
    0.0014,
  ),
  PIN,
  { x: -(LW + 0.0022) },
);
for (const z of [-0.052, 0.115])
  decals(LO, 'takedown pin', LW + 0.0004, circle(0.003, [-0.006, z], 6), PIN);

// The pistol grip (factory): swept back, waisted under the tang, swelling to its foot.
const GRIP_MOUNT = [0, -0.0305, 0.083];
const GR = 'grip';
const gh = { hiddenBy: 'grip' };
prism(
  GR,
  'pistol grip',
  side(
    [
      [-0.0295, 0.08],
      [-0.0255, 0.127],
      [-0.034, 0.1235],
      [-0.06, 0.1285],
      [-0.058, 0.0905],
    ],
    0.0138,
  ),
  POLY,
  gh,
);
prism(
  GR,
  'pistol grip',
  side(
    [
      [-0.0575, 0.0905],
      [-0.0595, 0.1285],
      [-0.094, 0.148],
      [-0.12, 0.1525],
      [-0.1215, 0.113],
    ],
    0.0148,
  ),
  POLY,
  gh,
);
for (const s of [1, -1])
  prism(
    GR,
    'grip texture',
    side(
      [
        [-0.062, 0.096],
        [-0.063, 0.1235],
        [-0.111, 0.144],
        [-0.112, 0.116],
      ],
      0.0005,
    ),
    REC,
    { x: s * 0.0151, ...gh },
  );
box(GR, 'grip cap', [0, -0.1222, 0.1325], [0.026, 0.0036, 0.037], RUBBER, { pitch: 1, ...gh });

// ================= The stock (factory): a hinge block, two thin rods and a small open butt
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ1 = 0.292; // the butt's back face, before the pad
extrudeZ(
  ST,
  'stock block',
  octagon(0.0145, 0.0325, -0.004, 0.004),
  UZ1 - 0.001,
  UZ1 + 0.019,
  POLY,
  hide,
);
prism(
  ST,
  'stock latch',
  side(
    [
      [-0.0035, UZ1 + 0.002],
      [-0.0035, UZ1 + 0.018],
      [-0.015, UZ1 + 0.034],
      [-0.018, UZ1 + 0.028],
      [-0.014, UZ1 + 0.005],
    ],
    0.0065,
  ),
  REC,
  hide,
);
tubeX(ST, 'stock pin', [0, 0.02, UZ1 + 0.012], 0.0032, 0.031, PIN, { sides: 6, ...hide });
for (const s of [1, -1])
  tubeZ(ST, 'stock rod', 0.0235, UZ1 + 0.017, SZ1 - 0.036, 0.0046, STEEL, {
    x: s * 0.0082,
    sides: 8,
    ...hide,
  });
box(ST, 'rod bridge', [0, 0.0235, UZ1 + 0.026], [0.027, 0.0125, 0.013], POLY, hide);
// The butt: a top block on the rods, a raked front leg and an upright back leg, open between.
prism(
  ST,
  'butt top',
  side(
    [
      [0.0305, SZ1 - 0.052],
      [0.0325, SZ1],
      [0.0105, SZ1],
      [0.0105, SZ1 - 0.036],
      [0.0165, SZ1 - 0.052],
    ],
    0.0145,
  ),
  POLY,
  hide,
);
prism(
  ST,
  'butt back leg',
  side(
    [
      [0.011, SZ1 - 0.0115],
      [0.011, SZ1],
      [-0.072, SZ1 - 0.006],
      [-0.072, SZ1 - 0.0165],
    ],
    0.0125,
  ),
  POLY,
  hide,
);
prism(
  ST,
  'butt front leg',
  side(
    [
      [0.011, SZ1 - 0.036],
      [0.011, SZ1 - 0.0255],
      [-0.056, SZ1 - 0.0235],
      [-0.056, SZ1 - 0.0312],
    ],
    0.0105,
  ),
  POLY,
  hide,
);
prism(
  ST,
  'butt toe',
  side(
    [
      [-0.0555, SZ1 - 0.0312],
      [-0.0555, SZ1 - 0.012],
      [-0.073, SZ1 - 0.006],
      [-0.073, SZ1 - 0.029],
    ],
    0.0125,
  ),
  POLY,
  hide,
);
box(ST, 'butt bridge', [0, -0.0035, SZ1 - 0.0185], [0.018, 0.0045, 0.018], POLY, hide);
tubeX(ST, 'sling cup', [0, 0.021, SZ1 - 0.017], 0.0052, 0.0302, SLOT, { sides: 8, ...hide });
box(ST, 'cheek line', [0, 0.0324, SZ1 - 0.022], [0.016, 0.001, 0.026], POLY_HI, {
  pitch: -2.2,
  ...hide,
});
prism(
  ST,
  'butt pad',
  [
    [0.0335, SZ1 - 0.0005, 0.0148],
    [0.0335, SZ1 + 0.0085, 0.0148],
    [-0.073, SZ1 + 0.002, 0.0132],
    [-0.073, SZ1 - 0.0065, 0.0132],
  ],
  RUBBER,
  hide,
);

// ================= Iron sights: flip-up rear peep (hidden by an optic) and front post
// (part of the gun, stays under an optic), the family's.
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.068, 0.112],
  support: [0, FOREGRIP_Y + 0.003, -0.135],
  muzzle: [0, B, MUZZLE_Z - 0.046],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.07],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, -0.135],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    grip: GRIP_MOUNT,
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
