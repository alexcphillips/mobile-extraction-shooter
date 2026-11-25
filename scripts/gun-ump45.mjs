// The UMP45's model, from the user's reference picture: one polymer body in a single shade.
// What makes it read as itself: a low front half with toothed side rails and a narrow spine
// over it, the full-height receiver behind, a short rail ending at the hump of the rear
// sight, a tall front sight tower, a long straight magazine leaning forward, and a stock
// with a small and a large window. Its grip is part of the body (no grip slot) and it has no
// barrel slot; the stock doesn't fold. Replaces only `model` in its item file. See
// docs/guns.md.
//
//   node scripts/gun-ump45.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { hkSights } from './gun-hk.mjs';
import { pistolPieces } from './gun-pistol.mjs';
import { uziPieces } from './gun-uzi-kit.mjs';

const FILE = new URL('../content/items/ump45.json', import.meta.url).pathname;
const { REC, SLOT, HG, POLY_HI, STEEL, RUBBER, PIN } = AR;
const BODY = HG; // the whole body, one shade
const DARK = REC; // panels, rails' teeth

// ---- Key sizes everything hangs off
const B = 0; // bore height
const W = 0.0205; // the receiver's half width
const UTOP = 0.026; // the receiver's top, under the rail
const FZ = -0.238; // the front face
const SHZ = -0.098; // where the low front half meets the receiver
const RZ1 = 0.13; // the receiver's rear
const FW = 0.0182; // the front half's half width
const FTOP = 0.0115; // its shoulder, under the spine
const FBOT = -0.0205;
const RAIL_BASE = UTOP + 0.0005;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048; // top of the teeth: the optic mount's height
const RAIL_W = 0.0215;
const SIGHT_Y = RAIL_TOP + 0.016; // under the lowest optic's dot
const REAR_Z = 0.09;
const FRONT_Z = -0.224;
const LW = 0.0188; // the lower's half width
const LBOT = -0.039;
const MUZZLE_Z = -0.256; // the barrel's end: where a muzzle device goes on
const MAG = [0, -0.06, -0.086]; // the magazine's mouth
const STOCK = [0, 0.008, RZ1 + 0.004];

const kit = gunParts();
const { parts, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const hk = hkSights(kit);
const { decal, decals, circle, rect, band } = pistolPieces(kit);
const uzi = uziPieces(kit, { B, RW: W, RTOP: UTOP, RBOT: LBOT, SIGHT_Y });
const side = (pts, w) => pts.map(([y, z]) => [y, z, w]);

// ================= Receiver: full height behind, shoulders down to the front half
const UP = 'receiver';
extrudeZ(
  UP,
  'receiver',
  [
    [-W, -0.0125],
    [W, -0.0125],
    [W, 0.0185],
    [W - 0.0075, UTOP],
    [-W + 0.0075, UTOP],
    [-W, 0.0185],
  ],
  SHZ,
  RZ1,
  BODY,
);
// The front half: low and square, a narrow spine along its top to the front sight.
extrudeZ(
  UP,
  'front half',
  [
    [-FW + 0.003, FBOT],
    [FW - 0.003, FBOT],
    [FW, FBOT + 0.003],
    [FW, FTOP - 0.003],
    [FW - 0.004, FTOP],
    [-FW + 0.004, FTOP],
    [-FW, FTOP - 0.003],
    [-FW, FBOT + 0.003],
  ],
  FZ,
  SHZ + 0.002,
  BODY,
);
extrudeZ(
  UP,
  'spine',
  [
    [-0.0115, FTOP - 0.001],
    [0.0115, FTOP - 0.001],
    [0.0115, UTOP - 0.0055],
    [0.0085, UTOP - 0.0015],
    [-0.0085, UTOP - 0.0015],
    [-0.0115, UTOP - 0.0055],
  ],
  FZ + 0.004,
  SHZ + 0.002,
  BODY,
);
prism(
  UP,
  'shoulder',
  side(
    [
      [FTOP - 0.001, SHZ - 0.02],
      [UTOP - 0.008, SHZ + 0.001],
      [FTOP - 0.001, SHZ + 0.001],
    ],
    FW - 0.001,
  ),
  BODY,
);
box(
  UP,
  'front face',
  [0, (FTOP + FBOT) / 2 - 0.001, FZ - 0.0004],
  [2 * FW - 0.01, FTOP - FBOT - 0.01, 0.0008],
  SLOT,
);
// The cocking slot along the spine, its handle forward on the left.
decals(UP, 'cocking slot', 0.0118, rect(0.0135, 0.0185, -0.212, -0.112), SLOT);
box(UP, 'cocking handle', [-0.017, 0.016, -0.172], [0.011, 0.0055, 0.008], STEEL);
prism(
  UP,
  'cocking knob',
  side(
    [
      [0.0115, -0.18],
      [0.0205, -0.178],
      [0.0205, -0.167],
      [0.0115, -0.165],
    ],
    0.0028,
  ),
  DARK,
  { x: -0.0238 },
);
// The oval cut behind the side rails, a lighter insert in it.
const oval = (hy, hz) =>
  [...circle(hy, [-0.004, 0], 12)].map(([y, z]) => [
    y,
    -0.119 + z + (Math.abs(z) < 1e-6 ? 0 : Math.sign(z) * hz),
  ]);
decals(UP, 'front cut', FW + 0.0003, oval(0.0058, 0.0075), SLOT);
decals(UP, 'cut insert', FW + 0.0006, oval(0.003, 0.0055), PIN);
// The right side's ejection port; a flat panel and stamped lines on the left.
decal(UP, 'ejection port', 1, W + 0.0003, rect(-0.003, 0.0145, -0.072, -0.018), SLOT);
decal(UP, 'bolt', 1, W + 0.0006, rect(0.0005, 0.011, -0.069, -0.03), STEEL);
decals(UP, 'receiver seam', W + 0.0003, rect(-0.0128, -0.0118, SHZ + 0.004, RZ1 - 0.004), DARK);
decal(UP, 'stamp', -1, W + 0.0004, rect(0.0085, 0.0098, -0.064, -0.047), POLY_HI);
decal(UP, 'stamp', -1, W + 0.0004, rect(0.0085, 0.0098, -0.036, -0.012), POLY_HI);
decal(UP, 'stamp', -1, W + 0.0004, rect(0.0048, 0.0058, -0.036, -0.02), POLY_HI);
decal(UP, 'plate', -1, W + 0.0003, rect(-0.005, 0.0025, 0.012, 0.046), DARK);
decal(UP, 'plate mark', -1, W + 0.0006, rect(-0.002, -0.0005, 0.016, 0.042), POLY_HI);
ar.topRail({ name: 'top rail', z0: -0.092, z1: 0.056, color: DARK });
// The hump's foot behind the rail: low, so it stays under an optic.
prism(
  UP,
  'hump foot',
  side(
    [
      [UTOP - 0.0005, 0.056],
      [RAIL_TOP - 0.001, 0.058],
      [RAIL_TOP - 0.001, 0.112],
      [UTOP - 0.0005, 0.126],
    ],
    0.0154,
  ),
  BODY,
);

const SIDE_RAIL_Z = [-0.232, -0.146];
const RAIL_Y = -0.004;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: FW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: DARK,
});
ar.sideRail({
  s: -1,
  x0: FW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: DARK,
});
const FG_Z = [-0.23, -0.142];
const FOREGRIP_Y = ar.bottomRail({ bot: FBOT, z0: FG_Z[0], z1: FG_Z[1], color: DARK });

// ================= Lower: slab sides, its belly stepping down to the well
const LO = 'lower receiver';
prism(
  LO,
  'lower',
  side(
    [
      [-0.012, -0.112],
      [-0.012, RZ1 - 0.001],
      [-0.02, RZ1 - 0.002],
      [LBOT, 0.088],
      [LBOT, -0.05],
      [-0.024, -0.112],
    ],
    LW,
  ),
  BODY,
);
prism(
  LO,
  'magazine well',
  [
    [-0.018, -0.114, 0.0172],
    [-0.018, -0.052, 0.0172],
    [-0.052, -0.0555, 0.0176],
    [MAG[1], -0.0585, 0.0182],
    [MAG[1], -0.1165, 0.0182],
    [-0.05, -0.1165, 0.0176],
  ],
  BODY,
);
decals(
  LO,
  'well rib',
  0.0182,
  [
    [-0.026, -0.108],
    [-0.026, -0.1045],
    [-0.052, -0.1075],
    [-0.052, -0.111],
  ],
  DARK,
);
box(LO, 'magazine release', [0, -0.05, -0.0515], [0.013, 0.018, 0.0045], STEEL, { pitch: 8 });
prism(
  LO,
  'release paddle',
  side(
    [
      [-0.054, -0.053],
      [-0.056, -0.0485],
      [-0.072, -0.049],
      [-0.071, -0.053],
    ],
    0.006,
  ),
  DARK,
);
// The guard: its front raked down from the belly, flat along the bottom, up into the grip.
band(
  LO,
  'trigger guard',
  [
    [LBOT + 0.002, -0.044],
    [-0.061, -0.034],
    [-0.0715, -0.022],
    [-0.0735, 0.014],
    [-0.066, 0.034],
    [-0.058, 0.052],
  ],
  [
    [LBOT + 0.002, -0.0385],
    [-0.0595, -0.0295],
    [-0.068, -0.02],
    [-0.0697, 0.0125],
    [-0.062, 0.031],
    [-0.05, 0.047],
  ],
  0.0065,
  BODY,
);
band(
  LO,
  'trigger',
  [
    [LBOT + 0.001, 0.002],
    [-0.052, 0.0065],
    [-0.063, 0.0015],
  ],
  [
    [LBOT + 0.001, 0.0095],
    [-0.052, 0.011],
    [-0.063, 0.0045],
  ],
  0.0026,
  DARK,
);
for (const s of [1, -1]) {
  tubeX(LO, 'selector hub', [s * (LW + 0.0012), -0.0215, 0.053], 0.0058, 0.0026, STEEL, {
    sides: 10,
  });
  box(LO, 'selector', [s * (LW + 0.0028), -0.0185, 0.0475], [0.0014, 0.004, 0.0165], PIN, {
    pitch: 35,
  });
  for (let i = 0; i < 3; i++)
    decal(
      LO,
      'selector mark',
      s,
      LW + 0.0004,
      rect(-0.0315 + i * 0.0045, -0.0295 + i * 0.0045, 0.0665 + i * 0.002, 0.0705 + i * 0.002),
      i === 1 ? '#b8392e' : POLY_HI,
    );
}
for (const [y, z, r] of [
  [-0.02, -0.044, 0.0032],
  [-0.028, -0.006, 0.0022],
  [-0.025, 0.026, 0.0026],
  [-0.018, 0.112, 0.0036],
])
  decals(LO, 'pin', LW + 0.0005, circle(r, [y, z], 8), PIN);
decal(LO, 'bolt catch', -1, LW + 0.0005, rect(-0.036, -0.017, -0.0605, -0.0575), STEEL);
box(LO, 'bolt catch', [-(LW + 0.0013), -0.0215, -0.059], [0.0026, 0.0065, 0.009], STEEL);

// ================= Grip: part of the body, raked, its sides checkered
const GR = 'grip';
prism(
  GR,
  'grip',
  side(
    [
      [LBOT + 0.003, 0.043],
      [LBOT + 0.003, 0.092],
      [-0.054, 0.0865],
      [-0.08, 0.0915],
      [-0.082, 0.0555],
    ],
    0.0158,
  ),
  BODY,
);
prism(
  GR,
  'grip',
  side(
    [
      [-0.0795, 0.0548],
      [-0.0795, 0.0914],
      [-0.116, 0.107],
      [-0.1255, 0.1075],
      [-0.132, 0.0775],
      [-0.128, 0.0725],
    ],
    0.0162,
  ),
  BODY,
);
decals(
  GR,
  'grip panel',
  0.0165,
  [
    [-0.06, 0.0545],
    [-0.063, 0.082],
    [-0.115, 0.1],
    [-0.121, 0.077],
  ],
  DARK,
);
for (let i = 0; i < 7; i++) {
  const y = -0.067 - i * 0.0075;
  const z = 0.0585 + (-0.067 - y) * 0.36;
  decals(
    GR,
    'grip texture',
    0.0168,
    [
      [y, z],
      [y - 0.0042, z + 0.0235],
      [y - 0.0057, z + 0.0235],
      [y - 0.0015, z],
    ],
    BODY,
  );
}
prism(
  GR,
  'grip cap',
  side(
    [
      [-0.1245, 0.1078],
      [-0.1315, 0.0772],
      [-0.134, 0.0782],
      [-0.127, 0.1085],
    ],
    0.0145,
  ),
  RUBBER,
);

// ================= Barrel (stays: no barrel slot) and flash hider (hidden by a muzzle device)
tubeZ('barrel', 'barrel nut', B, FZ + 0.001, FZ - 0.006, 0.0125, STEEL, { sides: 10 });
tubeZ('barrel', 'barrel', B, FZ + 0.002, MUZZLE_Z - 0.001, 0.0088, STEEL, { sides: 10 });
tubeZ('muzzle', 'muzzle collar', B, MUZZLE_Z + 0.001, MUZZLE_Z - 0.008, 0.0108, STEEL, {
  sides: 10,
  hiddenBy: 'muzzle',
});
tubeZ('muzzle', 'muzzle', B, MUZZLE_Z - 0.007, MUZZLE_Z - 0.02, 0.0092, STEEL, {
  sides: 8,
  hiddenBy: 'muzzle',
});
tubeZ('muzzle', 'bore', B, MUZZLE_Z - 0.0195, MUZZLE_Z - 0.0204, 0.006, SLOT, {
  sides: 8,
  hiddenBy: 'muzzle',
});

// ================= The stock (factory, hidden by a fitted one): a neck on the hinge, the top
// and bottom bars to the butt, a web between leaving a small window and a large one
box(UP, 'end plate', [0, 0.004, RZ1 + 0.002], [0.034, 0.034, 0.004], DARK);
tubeX(UP, 'hinge button', [0, 0.0135, RZ1 - 0.006], 0.0052, 2 * W + 0.004, DARK, { sides: 8 });
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ0 = STOCK[2];
const BZ = 0.332;
const SW = 0.0095;
prism(
  ST,
  'stock neck',
  side(
    [
      [0.0205, SZ0],
      [0.019, SZ0 + 0.046],
      [-0.0105, SZ0 + 0.046],
      [-0.006, SZ0],
    ],
    SW + 0.002,
  ),
  BODY,
  hide,
);
for (let i = 0; i < 4; i++)
  for (const s of [1, -1])
    decal(
      ST,
      'neck rib',
      s,
      SW + 0.0023,
      rect(-0.002, 0.0155, SZ0 + 0.004 + i * 0.005, SZ0 + 0.0065 + i * 0.005),
      SLOT,
      hide,
    );
prism(
  ST,
  'stock top bar',
  side(
    [
      [0.0192, SZ0 + 0.045],
      [0.0225, BZ - 0.02],
      [0.0085, BZ - 0.02],
      [0.0065, SZ0 + 0.045],
    ],
    SW,
  ),
  BODY,
  hide,
);
prism(
  ST,
  'stock bottom bar',
  side(
    [
      [0.002, SZ0 + 0.045],
      [-0.0105, SZ0 + 0.045],
      [-0.068, BZ - 0.03],
      [-0.054, BZ - 0.026],
    ],
    SW - 0.001,
  ),
  BODY,
  hide,
);
// The web: joins both bars between the two windows.
prism(
  ST,
  'stock web',
  side(
    [
      [0.0085, SZ0 + 0.086],
      [0.0095, SZ0 + 0.108],
      [-0.0335, SZ0 + 0.12],
      [-0.0265, SZ0 + 0.096],
      [-0.008, SZ0 + 0.088],
    ],
    SW - 0.002,
  ),
  BODY,
  hide,
);
prism(
  ST,
  'stock butt',
  side(
    [
      [0.023, BZ - 0.032],
      [0.0245, BZ],
      [-0.072, BZ - 0.008],
      [-0.072, BZ - 0.034],
      [-0.05, BZ - 0.026],
    ],
    SW + 0.003,
  ),
  BODY,
  hide,
);
prism(
  ST,
  'butt pad',
  side(
    [
      [0.0252, BZ - 0.0005],
      [0.0235, BZ + 0.0085],
      [-0.07, BZ + 0.0015],
      [-0.0735, BZ - 0.0085],
    ],
    SW + 0.004,
  ),
  RUBBER,
  hide,
);
for (const s of [1, -1]) {
  decal(ST, 'stock bolt', s, SW + 0.0034, circle(0.0034, [-0.061, BZ - 0.02], 8), SLOT, hide);
  decal(
    ST,
    'stock groove',
    s,
    SW + 0.0004,
    [
      [0.0128, SZ0 + 0.052],
      [0.0142, SZ0 + 0.052],
      [0.0166, BZ - 0.04],
      [0.0152, BZ - 0.04],
    ],
    DARK,
    hide,
  );
}

// ================= Iron sights: a ghost-ring peep in the hump (hidden by an optic), and a
// post in a full ring on a tall tower (it stays)
const IS = 'iron sights';
const oh = { hiddenBy: 'optic' };
uzi.peepRear({ REAR_Z, base: RAIL_TOP - 0.0015, hide: true });
// The hump: a cheek each side of the peep, upright in front, falling away behind.
for (const s of [1, -1])
  prism(
    IS,
    'sight hump',
    side(
      [
        [RAIL_TOP - 0.0015, 0.064],
        [SIGHT_Y + 0.0035, 0.07],
        [SIGHT_Y + 0.0035, 0.086],
        [RAIL_TOP + 0.004, 0.108],
        [RAIL_TOP - 0.0015, 0.1105],
      ],
      0.0019,
    ),
    BODY,
    { x: s * 0.0133, ...oh },
  );
prism(
  IS,
  'front sight tower',
  side(
    [
      [UTOP - 0.002, FRONT_Z - 0.011],
      [SIGHT_Y - 0.0145, FRONT_Z - 0.0095],
      [SIGHT_Y - 0.0105, FRONT_Z - 0.0045],
      [SIGHT_Y - 0.0105, FRONT_Z + 0.0045],
      [UTOP - 0.002, FRONT_Z + 0.02],
    ],
    0.0062,
  ),
  BODY,
);
hk.ringFront({ SIGHT_Y, FRONT_Z, BASE_Y: UTOP + 0.004, scale: 1.25 });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.078, 0.074],
  support: [0, FOREGRIP_Y - 0.002, (FG_Z[0] + FG_Z[1]) / 2],
  muzzle: [0, B, MUZZLE_Z - 0.02],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.038],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, (FG_Z[0] + FG_Z[1]) / 2],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
