// The MCX-SPEAR's model (GM-2): a big-bore piston carbine on AR controls. What sets it apart
// from the M416: a taller, wider upper with a charging handle on its left side, a long slim
// handguard almost to the muzzle, a long three-prong flash hider, a deep magazine well for
// its 6.8 mm magazine and a stock with a cheek riser. Its stock rides the buffer tube, so it
// doesn't fold (the user's call). The family's common parts come from gun-ar15.mjs.
// Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-mcx-spear.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, r5, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';

const FILE = new URL('../content/items/mcx-spear.json', import.meta.url).pathname;
const { REC, SLOT, HG, POLY, POLY_HI, STEEL, RUBBER, PIN } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RAIL_BASE = 0.04;
const RAIL_TOP = 0.05; // top of the teeth: the optic mount's height
const TEETH_Y0 = 0.0452;
const RAIL_W = 0.0215;
const UZ0 = -0.078; // upper receiver front (inside the handguard)
const UZ1 = 0.124; // upper receiver rear
const UW = 0.031; // wider than the family's: a bigger bolt
const HZ0 = -0.43; // handguard front
const HZ1 = -0.076; // handguard rear
const HW = 0.0255; // handguard half width
const HTOP = 0.0405;
const HBOT = -0.0165;
const MUZZLE_Z = -0.47; // where a muzzle device threads on
const FH_L = 0.058; // the factory flash hider's length
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const REAR_Z = 0.108;
const FRONT_Z = -0.41;
const MAG = [0, -0.055, -0.03]; // magazine mount: the magwell's mouth
const TUBE_Y = 0.012; // buffer tube axis
const STOCK = [0, TUBE_Y, 0.18];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });

// ================= Upper receiver, its side charging handle, and one top rail along it and
// the handguard
ar.upper({ UZ0, UZ1, UW, forwardAssist: false });
// A deeper skirt under the upper's sides, so it reads taller than an AR's.
for (const s of [1, -1])
  box(
    'upper receiver',
    'upper skirt',
    [s * (UW / 2 + 0.0004), 0.003, (UZ0 + 0.0) / 2],
    [0.0008, 0.006, -UZ0 - 0.004],
    REC,
  );
// The side charging handle: a slot along the left of the upper, the handle forward in it.
box(
  'upper receiver',
  'charging slot',
  [-(UW / 2 + 0.0003), 0.024, -0.03],
  [0.001, 0.006, 0.082],
  SLOT,
);
box(
  'upper receiver',
  'side charging handle',
  [-(UW / 2 + 0.006), 0.024, -0.062],
  [0.012, 0.007, 0.01],
  STEEL,
);
box(
  'upper receiver',
  'side charging handle knob',
  [-(UW / 2 + 0.0115), 0.024, -0.062],
  [0.004, 0.011, 0.013],
  POLY,
  {
    pitch: 0,
  },
);
ar.topRail({ name: 'top rail', z0: UZ0 + 0.004, z1: UZ1 - 0.003 });
ar.topRail({
  name: 'handguard rail',
  z0: HZ0 + 0.003,
  z1: UZ0 + 0.002,
  inset: [0.002, 0.004],
  dy: 0.0005,
  color: HG,
});

// ================= Handguard: a long octagon with M-LOK slots
const HAND = 'handguard';
const C = 0.0095; // chamfer
extrudeZ(HAND, 'handguard', octagon(HW, HTOP, HBOT, C), HZ0, HZ1, HG);
extrudeZ(
  HAND,
  'handguard end cap',
  octagon(HW + 0.0006, HTOP + 0.0006, HBOT - 0.0006, C),
  HZ0 - 0.0015,
  HZ0 + 0.004,
  SLOT,
);
// The barrel nut's ring where the handguard meets the upper.
extrudeZ(
  HAND,
  'handguard collar',
  octagon(HW + 0.0006, HTOP - 0.002, HBOT - 0.0006, C),
  HZ1 - 0.004,
  HZ1 + 0.002,
  REC,
);
// Slots along the left side, the one first person sees; the right side, which barely shows
// held, has only its rail section and two slots (the full build's budget).
const SIDE_RAIL_Z = [-0.38, -0.335];
for (const s of [1, -1])
  for (const z of s > 0
    ? [-0.29, -0.155]
    : [-0.41, -0.365, -0.32, -0.275, -0.23, -0.185, -0.14, -0.1])
    box(HAND, 'm-lok slot', [s * (HW + 0.0002), 0.0125, z], [0.001, 0.0075, 0.03], SLOT);
const RAIL_X = ar.sideRail({
  s: 1,
  x0: HW - 0.0005,
  y: 0.0125,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: HG,
});
const FOREGRIP_Y = ar.bottomRail({ bot: HBOT, z0: -0.31, z1: -0.2, color: HG });
// A QD sling cup on the left at the back of the handguard.
tubeX(HAND, 'sling cup', [-(HW + 0.0015), 0.012, -0.088], 0.0055, 0.004, SLOT, { sides: 6 });

// ================= Barrel (stays: no barrel slot) and the three-prong flash hider
// (factory, hidden by a muzzle device)
tubeZ('barrel', 'barrel', B, HZ0 + 0.004, MUZZLE_Z - 0.002, 0.0095, STEEL, { sides: 8 });
const FH = 'flash hider';
const hideFh = { hiddenBy: 'muzzle' };
// A stepped shoulder that takes a suppressor's mount, then the prongs' body.
tubeZ(FH, 'flash hider shoulder', B, MUZZLE_Z + 0.002, MUZZLE_Z - 0.014, 0.0128, STEEL, {
  sides: 10,
  ...hideFh,
});
tubeZ(FH, 'flash hider', B, MUZZLE_Z - 0.014, MUZZLE_Z - FH_L, 0.0114, STEEL, {
  sides: 9,
  ...hideFh,
});
// Three long slots splitting it into prongs: up and to either side below.
for (const a of [0, 120, 240]) {
  const rad = (a * Math.PI) / 180;
  box(
    FH,
    'flash hider slot',
    [0.0113 * Math.sin(rad), B + 0.0113 * Math.cos(rad), MUZZLE_Z - 0.038],
    [0.0028, 0.0012, 0.04],
    SLOT,
    {
      roll: r5(-a),
      ...hideFh,
    },
  );
}
tubeZ(FH, 'flash hider crown', B, MUZZLE_Z - FH_L, MUZZLE_Z - FH_L - 0.0015, 0.0095, SLOT, {
  sides: 9,
  ...hideFh,
});

// ================= Lower receiver with its deep well, and the pistol grip (factory, hidden
// by a fitted grip)
ar.lower({
  UZ0,
  MAG,
  LW: 0.029,
  well: { bottom: -0.0555, z0: -0.07, z1: 0.005, w: [0.0162, 0.0172, 0.0182] },
});
const GRIP_MOUNT = [0, -0.0305, 0.083];
ar.pistolGrip({});

// ================= Buffer tube (stays) and the collapsible stock on it, with a cheek riser
ar.bufferTube({ TUBE_Y });
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ0 = STOCK[2];
const SZ1 = 0.305;
// The sleeve round the tube, chamfered.
extrudeZ(
  ST,
  'stock sleeve',
  [
    [-0.0125, -0.007],
    [0.0125, -0.007],
    [0.0175, -0.002],
    [0.0175, 0.027],
    [0.0135, 0.031],
    [-0.0135, 0.031],
    [-0.0175, 0.027],
    [-0.0175, -0.002],
  ],
  SZ0,
  SZ1 - 0.002,
  POLY,
  hide,
);
// The cheek riser: a raised pad along the top, its front ramped.
prism(
  ST,
  'cheek riser',
  [
    [0.0305, 0.205],
    [0.039, 0.222],
    [0.0395, SZ1 - 0.006],
    [0.0305, SZ1 - 0.006],
  ].map(([y, z]) => [y, z, 0.0115]),
  POLY_HI,
  hide,
);
// The butt: a deep plate at the back, its front edge raked, with a dark lightening slot.
prism(
  ST,
  'stock butt',
  [
    [0.03, 0.266],
    [0.031, SZ1],
    [-0.078, SZ1],
    [-0.076, 0.284],
    [-0.02, 0.268],
  ].map(([y, z]) => [y, z, 0.0185]),
  POLY,
  hide,
);
for (const s of [1, -1])
  box(ST, 'stock butt slot', [s * 0.0187, -0.04, 0.29], [0.0006, 0.034, 0.012], SLOT, hide);
// The toe strut, from under the sleeve to the bottom of the butt.
prism(
  ST,
  'stock strut',
  [
    [-0.005, 0.196],
    [-0.005, 0.212],
    [-0.073, 0.286],
    [-0.075, 0.272],
  ].map(([y, z]) => [y, z, 0.0068]),
  POLY,
  hide,
);
add({
  type: 'slab',
  pos: v3([0, -0.0235, SZ1 + 0.0075]),
  size: v3([0.0405, 0.115, 0.015]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
box(ST, 'adjustment lever', [0, -0.009, 0.2], [0.008, 0.005, 0.03], SLOT, hide);
tubeX(ST, 'sling loop', [0, -0.07, 0.296], 0.0032, 0.022, STEEL, hide);
tubeX(ST, 'sleeve pin', [0, 0.012, 0.29], 0.0022, 0.0362, PIN, { sides: 6, ...hide });

// ================= Iron sights: flip-up rear peep (hidden by an optic) and front post
// (part of the gun, stays under an optic), the family's.
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.068, 0.112],
  support: [0, HBOT - 0.006, -0.25],
  muzzle: [0, B, MUZZLE_Z - FH_L - 0.0015],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.07],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, -0.25],
    rightRail: [RAIL_X, 0.0125, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    grip: GRIP_MOUNT,
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
