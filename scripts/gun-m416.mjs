// The reference gun (GM-1): the M416's model, built from the gun kit. Kept as the worked
// example for the gun sessions (docs/guns.md): how a gun's constants, profiles, rails, factory
// parts, iron sights and mounts are laid out in code. Replaces only `model` in its item file.
// The parts it shares with the rest of the `ar15` family (upper, lower, grip, buffer tube,
// rail runs, flash hider, flip-up irons) are in gun-ar15.mjs.
//
//   node scripts/gun-m416.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit). Copy it to start a new gun.
import { gunParts, octagon, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';

const FILE = new URL('../content/items/m416.json', import.meta.url).pathname;

// ---- Colors (two shades plus black, props.md → A black gun still reads in two shades)
const { SLOT, HG, POLY, POLY_HI, STEEL, RUBBER } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RAIL_BASE = 0.04; // rail base bottom (sunk 0.5 mm into what it sits on)
const RAIL_TOP = 0.05; // top of the teeth: the optic mount's height
const TEETH_Y0 = 0.0452;
const RAIL_W = 0.0215;
const UZ0 = -0.068; // upper receiver front (inside the handguard)
const UZ1 = 0.124; // upper receiver rear
const UW = 0.0285; // upper width
const HZ0 = -0.338; // handguard front
const HZ1 = -0.066; // handguard rear
const HW = 0.025; // handguard half width
const HTOP = 0.0405;
const HBOT = -0.016;
const MUZZLE_Z = -0.4; // where a muzzle device threads on
// Iron sight line: under the lowest optic's sight, so the front post never covers a dot,
// and low enough that the sights stay in proportion to the gun (the user's call).
const SIGHT_Y = RAIL_TOP + 0.024;
const REAR_Z = 0.108;
const FRONT_Z = -0.318;
const MAG = [0, -0.052, -0.022]; // magazine mount: the magwell's mouth
const TUBE_Y = 0.012; // buffer tube axis
const STOCK = [0, TUBE_Y, 0.18];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });

// ================= Upper receiver
ar.upper({ UZ0, UZ1, UW });

// ================= Rails: one top rail along the upper and the handguard
ar.topRail({ name: 'top rail', z0: UZ0 + 0.004, z1: UZ1 - 0.003 });
ar.topRail({
  name: 'handguard rail',
  z0: HZ0 + 0.003,
  z1: UZ0 + 0.002,
  inset: [0.002, 0.004],
  dy: 0.0005,
  color: HG,
});

// ================= Handguard: an octagonal free-float tube with M-LOK slots
const HAND = 'handguard';
const C = 0.009; // chamfer
extrudeZ(HAND, 'handguard', octagon(HW, HTOP, HBOT, C), HZ0, HZ1, HG);
extrudeZ(
  HAND,
  'handguard end cap',
  octagon(HW + 0.0006, HTOP + 0.0006, HBOT - 0.0006, C),
  HZ0 - 0.0015,
  HZ0 + 0.004,
  SLOT,
);
// Side slots, both sides, either side of the rail sections.
const SIDE_RAIL_Z = [-0.281, -0.239];
for (const s of [1, -1]) {
  for (const z of [-0.314, -0.205, -0.165, -0.125, -0.089])
    box(HAND, 'm-lok slot', [s * (HW + 0.0002), 0.0125, z], [0.001, 0.0075, 0.03], SLOT);
}
// Bottom slots fore and aft of the bottom rail.
for (const z of [-0.314, -0.125, -0.089])
  box(HAND, 'm-lok slot', [0, HBOT - 0.0002, z], [0.009, 0.001, 0.03], SLOT);
// Short rail sections where the rail slots and the foregrip go.
const RAIL_X = {};
for (const s of [1, -1])
  RAIL_X[s] = ar.sideRail({
    s,
    x0: HW - 0.0005,
    y: 0.0125,
    z0: SIDE_RAIL_Z[0],
    z1: SIDE_RAIL_Z[1],
    color: HG,
  });
const FOREGRIP_Y = ar.bottomRail({ bot: HBOT, z0: -0.27, z1: -0.17, color: HG });
// A QD sling cup on the left at the back of the handguard.
tubeX(HAND, 'sling cup', [-(HW + 0.0015), 0.012, -0.1], 0.0055, 0.004, SLOT, { sides: 6 });

// ================= Barrel and flash hider (factory parts)
tubeZ('barrel', 'barrel', B, HZ0 + 0.004, MUZZLE_Z - 0.002, 0.0085, STEEL, {
  sides: 8,
  hiddenBy: 'barrel',
});
ar.birdcage({ B, MUZZLE_Z });

// ================= Lower receiver and pistol grip (factory, hidden by a fitted grip)
ar.lower({ UZ0, MAG });
const GRIP_MOUNT = [0, -0.0305, 0.083];
ar.pistolGrip({});

// ================= Buffer tube (stays) and the factory stock on it
ar.bufferTube({ TUBE_Y });
const ST = 'stock';
const SZ0 = STOCK[2];
const SZ1 = 0.3;
const hide = { hiddenBy: 'stock' };
// The sleeve round the tube, chamfered, with a cheek ridge on top.
extrudeZ(
  ST,
  'stock sleeve',
  [
    [-0.0125, -0.006],
    [0.0125, -0.006],
    [0.017, -0.0015],
    [0.017, 0.029],
    [0.012, 0.034],
    [-0.012, 0.034],
    [-0.017, 0.029],
    [-0.017, -0.0015],
  ],
  SZ0,
  SZ1 - 0.002,
  POLY,
  hide,
);
box(ST, 'cheek rest', [0, 0.0355, 0.25], [0.022, 0.004, 0.086], POLY_HI, hide);
// The butt: a deep plate at the back, its front edge raked.
prism(
  ST,
  'stock butt',
  [
    [0.0335, 0.262],
    [0.0355, SZ1],
    [-0.075, SZ1],
    [-0.073, 0.282],
    [-0.02, 0.266],
  ].map(([y, z]) => [y, z, 0.0185]),
  POLY,
  hide,
);
// The toe strut from under the sleeve down to the bottom of the butt.
prism(
  ST,
  'stock strut',
  [
    [-0.004, 0.198],
    [-0.004, 0.214],
    [-0.07, 0.284],
    [-0.072, 0.27],
  ].map(([y, z]) => [y, z, 0.0065]),
  POLY,
  hide,
);
// Storage tubes along both sides, with dark end caps.
for (const s of [1, -1]) {
  tubeZ(ST, 'storage tube', -0.0155, 0.224, SZ1 - 0.001, 0.0085, POLY_HI, {
    x: s * 0.0142,
    sides: 8,
    ...hide,
  });
  tubeZ(ST, 'storage tube cap', -0.0155, 0.219, 0.2245, 0.0072, RUBBER, {
    x: s * 0.0142,
    sides: 6,
    ...hide,
  });
}
add({
  type: 'slab',
  pos: v3([0, -0.0195, SZ1 + 0.0075]),
  size: v3([0.0405, 0.117, 0.015]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
box(ST, 'adjustment lever', [0, -0.008, 0.2], [0.008, 0.005, 0.03], SLOT, hide);
tubeX(ST, 'sling loop', [0, -0.069, 0.29], 0.0032, 0.022, STEEL, hide);

// ================= Iron sights: flip-up rear peep (hidden by an optic) and front post
// (part of the gun, stays under an optic). The m416's are the reference (docs/guns.md).
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.068, 0.112],
  support: [0, -0.022, -0.22],
  muzzle: [0, B, MUZZLE_Z - 0.046],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.07],
    offsetOptic: [0, RAIL_TOP, -0.01],
    muzzle: [0, B, MUZZLE_Z],
    barrel: [0, B, HZ0],
    foregrip: [0, FOREGRIP_Y, -0.22],
    leftRail: [RAIL_X[-1], 0.0125, -0.26],
    rightRail: [RAIL_X[1], 0.0125, -0.26],
    grip: GRIP_MOUNT,
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
