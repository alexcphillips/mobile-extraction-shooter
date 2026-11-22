// The MPX's model (GM-2): a 9 mm carbine on AR controls. What sets it apart from the M416:
// a short, slim handguard whose nose tapers in, a narrow magazine well for its 9 mm
// magazine, no forward assist, a short barrel, and a skeletal collapsible stock. Its stock
// rides the buffer tube, so it doesn't fold (the user's call). The family's common parts
// come from gun-ar15.mjs. Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-mpx.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';

const FILE = new URL('../content/items/mpx.json', import.meta.url).pathname;
const { REC, SLOT, HG, POLY, POLY_HI, STEEL, RUBBER } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RAIL_BASE = 0.04;
const RAIL_TOP = 0.05; // top of the teeth: the optic mount's height
const TEETH_Y0 = 0.0452;
const RAIL_W = 0.0215;
const UZ0 = -0.06; // upper receiver front (inside the handguard)
const UZ1 = 0.124; // upper receiver rear
const UW = 0.0275;
const HZ0 = -0.212; // handguard front (where its nose starts to taper)
const HZ1 = -0.058; // handguard rear
const NOSE = 0.016; // the tapered nose's length
const HW = 0.0215; // handguard half width
const HTOP = 0.0405;
const HBOT = -0.0115;
const MUZZLE_Z = -0.25; // where a muzzle device threads on
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const REAR_Z = 0.108;
const FRONT_Z = -0.2;
const MAG = [0, -0.052, -0.016]; // magazine mount: the magwell's mouth
const TUBE_Y = 0.012; // buffer tube axis
const STOCK = [0, TUBE_Y, 0.18];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
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

// ================= Handguard: a slim octagon with M-LOK slots, its nose tapering in
const HAND = 'handguard';
const C = 0.008; // chamfer
extrudeZ(HAND, 'handguard', octagon(HW, HTOP, HBOT, C), HZ0, HZ1, HG);
// The nose: a hull from the handguard's section to a smaller one at the front, and a dark
// ring where the barrel comes out.
add({
  type: 'hull',
  pos: v3([0, (HTOP + HBOT) / 2, HZ0 - NOSE / 2]),
  points: [
    ...octagon(HW, HTOP, HBOT, C).map(([x, y]) => [x, y - (HTOP + HBOT) / 2, NOSE / 2]),
    ...octagon(HW - 0.006, HTOP - 0.0045, HBOT + 0.006, C - 0.002).map(([x, y]) => [
      x,
      y - (HTOP + HBOT) / 2,
      -NOSE / 2,
    ]),
  ].map(v3),
  color: HG,
  name: 'handguard nose',
  group: HAND,
});
tubeZ(HAND, 'handguard nose ring', B, HZ0 - NOSE - 0.0005, HZ0 - NOSE + 0.003, 0.0112, SLOT, {
  sides: 8,
});
// Side slots, both sides, either side of the right rail section; bottom slots ahead of the
// bottom rail.
const SIDE_RAIL_Z = [-0.19, -0.152];
for (const s of [1, -1])
  for (const z of s > 0 ? [-0.124, -0.09] : [-0.176, -0.124, -0.09])
    box(HAND, 'm-lok slot', [s * (HW + 0.0002), 0.0135, z], [0.001, 0.0072, 0.026], SLOT);
for (const z of [-0.196])
  box(HAND, 'm-lok slot', [0, HBOT - 0.0002, z], [0.008, 0.001, 0.02], SLOT);
const RAIL_X = ar.sideRail({
  s: 1,
  x0: HW - 0.0005,
  y: 0.0135,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: HG,
});
const FOREGRIP_Y = ar.bottomRail({ bot: HBOT, z0: -0.18, z1: -0.1, color: HG });
// A QD sling cup on the left at the back of the handguard.
tubeX(HAND, 'sling cup', [-(HW + 0.0015), 0.013, -0.075], 0.005, 0.004, SLOT, { sides: 6 });

// ================= Barrel (stays: no barrel slot) and flash hider (factory, hidden by a
// muzzle device)
tubeZ('barrel', 'barrel', B, HZ0 - NOSE + 0.002, MUZZLE_Z - 0.002, 0.0078, STEEL, { sides: 8 });
ar.birdcage({ B, MUZZLE_Z });

// ================= Lower receiver with its narrow 9 mm well, and the pistol grip (factory,
// hidden by a fitted grip)
ar.lower({
  UZ0,
  MAG,
  well: { bottom: -0.0525, z0: -0.045, z1: 0.005, w: [0.0125, 0.0133, 0.0142] },
});
// A flared lip round the well's mouth, as on the real gun, so it reads from the side.
prism(
  'lower receiver',
  'magazine well flare',
  [
    [-0.044, 0.005, 0.0146],
    [-0.0535, 0.0065, 0.0152],
    [-0.0535, -0.0505, 0.0152],
    [-0.044, -0.046, 0.0146],
  ],
  REC,
);
const GRIP_MOUNT = [0, -0.0305, 0.083];
ar.pistolGrip({});

// ================= Buffer tube (stays) and the skeletal collapsible stock on it
ar.bufferTube({ TUBE_Y });
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ0 = STOCK[2];
const SZ1 = 0.29; // the butt's back face
// A short sleeve round the tube, chamfered.
extrudeZ(
  ST,
  'stock sleeve',
  [
    [-0.011, -0.005],
    [0.011, -0.005],
    [0.0155, -0.0005],
    [0.0155, 0.026],
    [0.011, 0.0305],
    [-0.011, 0.0305],
    [-0.0155, 0.026],
    [-0.0155, -0.0005],
  ],
  SZ0,
  0.236,
  POLY,
  hide,
);
// A flat top bar from the sleeve to the butt, the cheek weld.
box(ST, 'stock top bar', [0, 0.0285, (0.232 + SZ1) / 2], [0.012, 0.0065, SZ1 - 0.232], POLY, hide);
box(
  ST,
  'stock top bar edge',
  [0, 0.0322, (0.236 + SZ1) / 2 - 0.002],
  [0.009, 0.001, SZ1 - 0.236 - 0.006],
  POLY_HI,
  hide,
);
// The butt: a narrow upright plate, its front edge raked.
prism(
  ST,
  'stock butt',
  [
    [0.031, 0.276],
    [0.032, SZ1],
    [-0.068, SZ1],
    [-0.066, 0.28],
    [-0.012, 0.272],
  ].map(([y, z]) => [y, z, 0.0145]),
  POLY,
  hide,
);
// A slim toe strut from under the sleeve to the bottom of the butt, open between.
prism(
  ST,
  'stock strut',
  [
    [-0.003, 0.2],
    [-0.003, 0.212],
    [-0.064, 0.282],
    [-0.066, 0.272],
  ].map(([y, z]) => [y, z, 0.0055]),
  POLY,
  hide,
);
add({
  type: 'slab',
  pos: v3([0, -0.018, SZ1 + 0.006]),
  size: v3([0.031, 0.104, 0.012]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
box(ST, 'adjustment lever', [0, -0.007, 0.205], [0.007, 0.005, 0.026], SLOT, hide);
tubeX(ST, 'sling loop', [0, -0.06, 0.281], 0.003, 0.02, STEEL, hide);

// ================= Iron sights: flip-up rear peep (hidden by an optic) and front post
// (part of the gun, stays under an optic), the family's.
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.068, 0.112],
  support: [0, HBOT - 0.006, -0.14],
  muzzle: [0, B, MUZZLE_Z - 0.046],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.07],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, -0.14],
    rightRail: [RAIL_X, 0.0135, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    grip: GRIP_MOUNT,
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
