// The SCAR-H's model (GM-5a): a 7.62 piston battle rifle. What makes it read as itself: a
// tall monolithic upper, receiver and handguard in one, with an unbroken top rail from the
// hinge to the muzzle end; the reciprocating charging handle out on the left; a polymer
// lower with a deep, flared well for its 20-round magazine; short side and bottom rail
// sections up front; the gas regulator poking out ahead of the upper; and the skeletal
// side-folding stock on a hinge block at the back. It takes AR grips and stocks (it's on the
// `ar15` platform: weapon-stats.md → The AR-15 platform is wide); a fitted stock goes on the
// hinge block in the factory stock's place. The lower, grip and irons come from
// gun-ar15.mjs. Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-scar-h.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, r5, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';

const FILE = new URL('../content/items/scar-h.json', import.meta.url).pathname;
const { REC, SLOT, HG, POLY, POLY_HI, STEEL, RUBBER, PIN } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const UTOP = 0.0415; // the upper's top, under the rail
const RAIL_BASE = 0.042;
const TEETH_Y0 = 0.0472;
const RAIL_TOP = 0.052; // top of the teeth: the optic mount's height
const RAIL_W = 0.0215;
const UZ0 = -0.335; // the upper's front (the handguard's end)
const UZ1 = 0.13; // the upper's back, where the hinge block sits
const LZ0 = -0.086; // the lower's front: the handguard runs on ahead of it
const UW = 0.0218; // the receiver section's half width
const UBOT = -0.001; // the receiver section's bottom, sunk a hair into the lower's top
const HW = 0.0205; // the handguard section's half width
const HBOT = -0.016;
const MUZZLE_Z = -0.476; // the barrel's end: where a muzzle device threads on
const FH_L = 0.056; // the factory flash hider's length
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const REAR_Z = 0.112;
const FRONT_Z = -0.318;
const MAG = [0, -0.062, -0.036]; // magazine mount: the well's mouth
const STOCK = [0, B, 0.148]; // the hinge block's back, on the bore's line like a buffer tube
const SZ1 = 0.37; // the factory stock's back, before the pad

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });

// ================= Upper: the receiver section over the lower, stepping down into the
// deeper handguard section ahead of it; one rail along the whole top
const UP = 'upper receiver';
extrudeZ(
  UP,
  'upper receiver',
  [
    [-UW + 0.003, UBOT],
    [UW - 0.003, UBOT],
    [UW, UBOT + 0.003],
    [UW, UTOP - 0.005],
    [UW - 0.004, UTOP],
    [-UW + 0.004, UTOP],
    [-UW, UTOP - 0.005],
    [-UW, UBOT + 0.003],
  ],
  LZ0 - 0.004,
  UZ1,
  REC,
);
extrudeZ(UP, 'handguard', octagon(HW, UTOP, HBOT, 0.007), UZ0, LZ0 - 0.002, REC);
// The step where the handguard's deeper section meets the lower, sloped like the real one.
prism(
  UP,
  'handguard step',
  [
    [UBOT, LZ0 - 0.004],
    [UBOT, LZ0 + 0.012],
    [HBOT + 0.007, LZ0 - 0.004],
  ].map(([y, z]) => [y, z, HW - 0.0004]),
  REC,
);
// The front end, a step proud, with the gas regulator poking out under the rail.
extrudeZ(
  UP,
  'handguard end',
  octagon(HW + 0.0005, UTOP + 0.0004, HBOT - 0.0005, 0.0075),
  UZ0 - 0.0015,
  UZ0 + 0.005,
  STEEL,
);
box(UP, 'gas regulator', [0, B + 0.016, UZ0 - 0.008], [0.016, 0.014, 0.014], STEEL);
tubeX(UP, 'regulator knob', [0, B + 0.016, UZ0 - 0.011], 0.005, 0.02, PIN, { sides: 6 });
// The reciprocating charging handle on the left: its slot along the receiver section, the
// handle and its knob forward in it.
box(UP, 'charging slot', [-(UW + 0.0003), 0.03, -0.05], [0.001, 0.006, 0.16], SLOT);
box(UP, 'charging handle', [-(UW + 0.006), 0.03, -0.112], [0.012, 0.007, 0.011], STEEL);
tubeZ(UP, 'charging handle knob', 0.03, -0.119, -0.105, 0.0055, POLY, {
  x: -(UW + 0.013),
  sides: 6,
});
// The ejection port and its brass deflector on the right.
box(UP, 'ejection port', [UW + 0.0003, 0.02, 0.015], [0.001, 0.015, 0.06], SLOT);
box(UP, 'brass deflector', [UW + 0.002, 0.03, 0.05], [0.004, 0.006, 0.012], REC);
// Screws holding the barrel in the upper on the left (the side first person sees), and the
// handguard's slots.
for (const s of [1, -1]) {
  if (s < 0)
    for (const z of [-0.07, -0.095])
      tubeX(UP, 'barrel screw', [s * (UW + 0.0004), 0.008, z], 0.0022, 0.001, PIN, { sides: 6 });
  for (const z of s > 0 ? [-0.19, -0.14] : [-0.29, -0.24, -0.19, -0.14])
    box(UP, 'handguard slot', [s * (HW + 0.0002), 0.012, z], [0.001, 0.008, 0.034], SLOT);
}
ar.topRail({ name: 'top rail', z0: UZ0 + 0.003, z1: UZ1 - 0.002 });

// Short rail sections up front: the right side for a rail item, the bottom for a foregrip.
const SIDE_RAIL_Z = [-0.325, -0.265];
const RAIL_Y = 0.012;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: HW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});
const FG_Z = [-0.3, -0.19];
const FOREGRIP_Y = ar.bottomRail({ bot: HBOT, z0: FG_Z[0], z1: FG_Z[1], color: REC });
// A QD sling cup on the left by the step.
tubeX(UP, 'sling cup', [-(HW + 0.0015), 0.0, LZ0 - 0.02], 0.0055, 0.004, SLOT, { sides: 6 });

// ================= Barrel (stays: no barrel slot) and the slotted flash hider (factory,
// hidden by a muzzle device)
tubeZ('barrel', 'barrel', B, UZ0 + 0.004, MUZZLE_Z + 0.002, 0.0098, STEEL, { sides: 8 });
const FH = 'flash hider';
const hideFh = { hiddenBy: 'muzzle' };
tubeZ(FH, 'flash hider shoulder', B, MUZZLE_Z + 0.002, MUZZLE_Z - 0.012, 0.0122, STEEL, {
  sides: 10,
  ...hideFh,
});
tubeZ(FH, 'flash hider', B, MUZZLE_Z - 0.012, MUZZLE_Z - FH_L, 0.0114, STEEL, {
  sides: 10,
  ...hideFh,
});
for (let i = 0; i < 6; i++) {
  const a = i * 60 + 30;
  const rad = (a * Math.PI) / 180;
  box(
    FH,
    'flash hider slot',
    [0.0113 * Math.sin(rad), B + 0.0113 * Math.cos(rad), MUZZLE_Z - 0.036],
    [0.0024, 0.0012, 0.03],
    SLOT,
    { roll: r5(-a), ...hideFh },
  );
}
tubeZ(FH, 'flash hider crown', B, MUZZLE_Z - FH_L, MUZZLE_Z - FH_L - 0.0015, 0.0094, SLOT, {
  sides: 10,
  ...hideFh,
});

// ================= Lower: polymer, with its deep flared well, and the pistol grip (factory,
// hidden by a fitted grip)
ar.lower({
  UZ0: LZ0,
  MAG,
  LW: 0.03,
  color: POLY,
  well: { bottom: MAG[1], z0: -0.07, z1: 0.002, w: [0.0172, 0.0182, 0.0196] },
});
const GRIP_MOUNT = [0, -0.0305, 0.083];
ar.pistolGrip({});

// ================= Hinge block (stays: the stock mount) and the skeletal folding stock
// (factory, hidden by a fitted stock). It's shaped like the real side-folder, but only SMG
// stocks fold in the game (weapon-stats.md).
const HB = 'hinge block';
extrudeZ(
  HB,
  'hinge block',
  [
    [-0.016, -0.014],
    [0.016, -0.014],
    [0.018, -0.01],
    [0.018, UTOP - 0.004],
    [0.014, UTOP - 0.001],
    [-0.014, UTOP - 0.001],
    [-0.018, UTOP - 0.004],
    [-0.018, -0.01],
  ],
  UZ1 - 0.001,
  STOCK[2],
  POLY,
);
add({
  type: 'cylinder',
  pos: v3([0.02, 0.013, STOCK[2] - 0.004]),
  radius: 0.0035,
  height: 0.05,
  color: STEEL,
  sides: 6,
  name: 'hinge knuckle',
  group: HB,
});
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ0 = STOCK[2];
// The comb: a deep beam along the top, in line with the upper.
prism(
  ST,
  'stock comb',
  [
    [UTOP - 0.002, SZ0],
    [UTOP - 0.001, SZ1],
    [0.008, SZ1],
    [0.002, SZ0 + 0.03],
    [-0.012, SZ0],
  ].map(([y, z]) => [y, z, 0.0165]),
  POLY,
  hide,
);
// The cheek riser along its top.
prism(
  ST,
  'cheek riser',
  [
    [UTOP - 0.0015, SZ0 + 0.07],
    [UTOP + 0.007, SZ0 + 0.09],
    [UTOP + 0.0075, SZ1 - 0.012],
    [UTOP - 0.0005, SZ1 - 0.012],
  ].map(([y, z]) => [y, z, 0.0135]),
  POLY_HI,
  hide,
);
// The toe strut from under the hinge down to the butt's toe: the gap above it is open.
prism(
  ST,
  'stock strut',
  [
    [-0.012, SZ0],
    [-0.004, SZ0 + 0.01],
    [-0.074, SZ1 - 0.02],
    [-0.084, SZ1 - 0.024],
  ].map(([y, z]) => [y, z, 0.0105]),
  POLY,
  hide,
);
// The butt: a deep plate, its front raked.
prism(
  ST,
  'stock butt',
  [
    [UTOP - 0.001, SZ1 - 0.03],
    [UTOP - 0.001, SZ1],
    [-0.088, SZ1],
    [-0.088, SZ1 - 0.022],
    [0.0, SZ1 - 0.04],
  ].map(([y, z]) => [y, z, 0.0172]),
  POLY,
  hide,
);
for (const s of [1, -1])
  box(ST, 'stock butt slot', [s * 0.0174, -0.03, SZ1 - 0.014], [0.0006, 0.05, 0.01], SLOT, hide);
add({
  type: 'slab',
  pos: v3([0, -0.0235, SZ1 + 0.0065]),
  size: v3([0.036, 0.13, 0.013]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
box(ST, 'length button', [0, -0.01, SZ0 + 0.03], [0.008, 0.005, 0.012], SLOT, hide);
tubeX(ST, 'stock pin', [0, 0.03, SZ1 - 0.015], 0.0022, 0.035, PIN, { sides: 6, ...hide });

// ================= Iron sights: the family's flip-up rear peep (hidden by an optic) and
// front post (part of the gun, stays under an optic)
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.068, 0.112],
  support: [0, HBOT - 0.006, -0.245],
  muzzle: [0, B, MUZZLE_Z - FH_L - 0.0015],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.06],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, (FG_Z[0] + FG_Z[1]) / 2],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    grip: GRIP_MOUNT,
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
