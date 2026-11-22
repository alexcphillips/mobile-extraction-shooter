// The G3's model (GM-5a): a 7.62 roller-delayed battle rifle, the MP5's big brother. What
// makes it read as itself: a long stamped receiver with a rounded top and pressed ribs, the
// cocking tube running far forward over the barrel to a tall front sight hooded by a full
// ring, the cocking handle out on the left near the handguard's front, a wide ventilated
// handguard, the polymer trigger housing with its big square guard hung under the back, a
// drum rear sight, a straight magazine well with a paddle release, and a fixed polymer stock
// in line with the receiver. A claw-mount rail bridges the receiver for optics. Its grip is
// the trigger housing's, hidden by a fitted grip (AR grips, by name); no stock or barrel
// slot. Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-g3.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, r5, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { coreOutline } from './optic-kit.mjs';
import { hkSights } from './gun-hk.mjs';

const FILE = new URL('../content/items/g3.json', import.meta.url).pathname;
const { REC, SLOT, HG, POLY, POLY_HI, STEEL, RUBBER, PIN } = AR;
const RIB = '#303236'; // pressed ribs, a shade lighter than the receiver

// ---- Key sizes everything hangs off
const B = 0; // bore height
const RW = 0.0205; // the receiver's half width
const RTOP = 0.026; // the receiver's top
const RBOT = -0.024; // the receiver's bottom, where the trigger housing and magwell hang
const RZ0 = -0.13; // the receiver body's front: the cocking tube runs on from here
const RZ1 = 0.195; // the end cap: the stock's front
const TUBE_Y = 0.0145; // the cocking tube's axis
const TUBE_R = 0.0118;
const RAIL_BASE = RTOP + 0.0004;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048; // top of the claw mount's teeth: the optic mount
const RAIL_W = 0.0215;
const RAIL_Z = [-0.1, 0.135]; // the claw mount's rail run
const SIGHT_Y = RAIL_TOP + 0.013; // the sight line: under the lowest optic's dot
const REAR_Z = 0.17;
const FRONT_Z = -0.402; // the real gun's sight radius, 572 mm
const FSB = [-0.414, -0.39]; // the front sight base along z
const HZ0 = -0.375; // handguard front
const HZ1 = -0.134; // handguard rear (against the receiver)
const HW = 0.0255; // handguard half width
const HBOT = -0.033; // handguard bottom
const MUZZLE_Z = -0.56; // the barrel's end: where a muzzle device goes on
const FH_L = 0.055; // the factory flash hider's length
const MAG = [0, -0.05, -0.061]; // magazine mount: the magwell's mouth
const WELL = [-0.107, -0.022]; // the magwell along z
const GY = RBOT - 0.016; // the trigger housing's bottom, where the grip leaves it
const GRIP_MOUNT = [0, GY, 0.09];
const SZ1 = 0.402; // the stock's back, before the butt pad

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const hk = hkSights(kit);
const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

// ================= Receiver: the stamped body, rounded on top, ribs pressed down its sides
const RC = 'receiver';
const recOutline = (grow) => [
  [-RW + 0.007 - grow, RBOT + 0.001 - grow],
  [RW - 0.007 + grow, RBOT + 0.001 - grow],
  [RW - 0.001 + grow, RBOT + 0.005],
  [RW - 0.001 + grow, RTOP - 0.01],
  [RW - 0.007 + grow, RTOP - 0.001 + grow],
  [-RW + 0.007 - grow, RTOP - 0.001 + grow],
  [-RW + 0.001 - grow, RTOP - 0.01],
  [-RW + 0.001 - grow, RBOT + 0.005],
];
extrudeZ(RC, 'receiver', recOutline(0), RZ0, RZ1, REC);
for (const s of [1, -1]) {
  // The pressed ribs: a long one high, a short one low behind the magwell.
  box(RC, 'receiver rib', [s * (RW + 0.0003), 0.015, 0.03], [0.0012, 0.003, 0.3], RIB);
  box(RC, 'receiver rib', [s * (RW + 0.0003), -0.012, 0.105], [0.0012, 0.003, 0.14], RIB);
}
// The end cap, a step bigger, and the stock's pin through it.
extrudeZ(RC, 'end cap', recOutline(0.0004), RZ1 - 0.006, RZ1 + 0.002, STEEL);
// The ejection port on the right with its deflector bump; the cocking slot runs on the tube.
box(RC, 'ejection port', [RW + 0.0004, 0.011, -0.07], [0.001, 0.016, 0.07], SLOT);
box(RC, 'port deflector', [RW + 0.0018, 0.021, -0.028], [0.0035, 0.005, 0.014], STEEL);
// Push pins through the receiver for the trigger housing.
tubeX(RC, 'housing pin', [0, -0.017, -0.006], 0.0024, 2 * RW + 0.0016, PIN, { sides: 6 });
tubeX(RC, 'housing pin', [0, -0.017, 0.18], 0.0024, 2 * RW + 0.0016, PIN, { sides: 6 });

// ================= Cocking tube forward over the barrel, the cocking handle on the left
const CT = 'cocking tube';
tubeZ(CT, 'cocking tube', TUBE_Y, FSB[1], RZ0 + 0.002, TUBE_R, REC, { sides: 12 });
// The slot down its left side and the handle folded out forward from it.
box(CT, 'cocking slot', [-(TUBE_R - 0.0015), TUBE_Y + 0.002, -0.27], [0.002, 0.004, 0.17], SLOT, {
  roll: 30,
});
const CH = [-0.021, TUBE_Y + 0.004, -0.345];
box(CT, 'cocking handle', CH, [0.02, 0.0055, 0.007], STEEL, { yaw: -35 });
tubeZ(CT, 'cocking handle knob', CH[1], CH[2] - 0.007, CH[2] + 0.007, 0.0048, POLY, {
  x: CH[0] - 0.0075,
  sides: 8,
});

// ================= Front sight: a tall base clamped round tube and barrel, a tower rising
// to a full ring hood with the post inside (gun-hk.mjs)
const FS = 'iron sights';
extrudeZ(
  FS,
  'front sight base',
  rounded(
    [
      [-0.011, B - 0.0105],
      [0.011, B - 0.0105],
      [0.0135, TUBE_Y],
      [0.0125, TUBE_Y + TUBE_R + 0.0015],
      [-0.0125, TUBE_Y + TUBE_R + 0.0015],
      [-0.0135, TUBE_Y],
    ],
    0.002,
  ),
  FSB[0],
  FSB[1],
  REC,
);
tubeX(FS, 'front sight base pin', [0, B - 0.004, (FSB[0] + FSB[1]) / 2], 0.0017, 0.0256, PIN, {
  sides: 6,
});
// The cocking tube's front cap, ahead of the base.
tubeZ(FS, 'cocking tube cap', TUBE_Y, FSB[0] + 0.001, FSB[0] - 0.006, TUBE_R - 0.002, STEEL, {
  sides: 12,
});
hk.ringFront({ SIGHT_Y, FRONT_Z, BASE_Y: TUBE_Y + TUBE_R + 0.001, scale: 1.25, group: FS });

// ================= Rear sight: the HK drum on the receiver (gun-hk.mjs); hidden by an optic
hk.drumRear({ SIGHT_Y, REAR_Z, BASE_Y: RTOP - 0.001, group: FS });

// ================= Claw mount: a rail on a bridge clamped to the receiver between the sights
const CM = 'rails';
ar.topRail({ name: 'top rail', z0: RAIL_Z[0], z1: RAIL_Z[1], group: CM });
for (const z of [RAIL_Z[0] + 0.014, RAIL_Z[1] - 0.014]) {
  for (const s of [1, -1]) {
    // The claws gripping the receiver's shoulders, and a lever on the left one.
    box(CM, 'claw', [s * (RW - 0.0015), RTOP - 0.004, z], [0.004, 0.009, 0.016], REC, {
      roll: s * 25,
    });
  }
  tubeX(CM, 'claw lever', [-(RW + 0.001), RTOP - 0.002, z], 0.0024, 0.0024, PIN, { sides: 6 });
}

// ================= Magwell: straight, with a paddle release behind it and a button on the
// right
const MW = 'magazine well';
prism(
  MW,
  'magazine well',
  [
    [RBOT + 0.0005, WELL[0]],
    [RBOT + 0.0005, WELL[1]],
    [MAG[1], WELL[1] - 0.001],
    [MAG[1], WELL[0] + 0.001],
  ].map(([y, z]) => [y, z, 0.0168]),
  REC,
);
box(MW, 'magazine well mouth', [0, MAG[1] - 0.0003, MAG[2]], [0.028, 0.001, 0.08], SLOT);
for (const z of [WELL[0] + 0.001, WELL[1] - 0.001])
  box(MW, 'magazine well rib', [0, (RBOT + MAG[1]) / 2, z], [0.0352, 0.022, 0.0016], RIB);
box(MW, 'paddle release', [0, MAG[1] + 0.001, WELL[1] + 0.006], [0.013, 0.004, 0.012], STEEL, {
  pitch: -20,
});
tubeX(MW, 'magazine release', [0.0172, MAG[1] + 0.012, WELL[1] - 0.008], 0.0034, 0.002, STEEL);

// ================= Trigger housing: polymer, hung under the back, its guard and grip (the
// grip hidden by a fitted grip)
const TH = 'trigger housing';
const TZ = [-0.016, 0.192];
const hideGrip = { hiddenBy: 'grip' };
prism(
  TH,
  'trigger housing',
  [
    [RBOT + 0.0005, TZ[0]],
    [RBOT + 0.0005, TZ[1]],
    [RBOT - 0.01, TZ[1] - 0.006],
    [GY, 0.15],
    [GY, TZ[0] + 0.006],
  ].map(([y, z]) => [y, z, 0.0168]),
  POLY,
);
box(TH, 'housing edge', [0, GY - 0.0004, 0.065], [0.0276, 0.001, 0.15], POLY_HI);
prism(
  TH,
  'grip',
  [
    [GY, 0.09],
    [GY, 0.135],
    [-0.124, 0.161],
    [-0.127, 0.153],
    [-0.124, 0.121],
    [-0.076, 0.098],
  ].map(([y, z]) => [y, z, 0.0152]),
  POLY,
  hideGrip,
);
prism(
  TH,
  'grip backstrap',
  [
    [GY - 0.001, 0.134],
    [GY - 0.001, 0.1368],
    [-0.122, 0.1628],
    [-0.122, 0.16],
  ].map(([y, z]) => [y, z, 0.014]),
  POLY_HI,
  hideGrip,
);
for (const y of [-0.066, -0.084, -0.102]) {
  const z = 0.098 + ((-0.076 - y) / 0.048) * 0.023 - 0.001;
  box(TH, 'grip texture', [0, y, z + 0.025], [0.031, 0.0014, 0.027], SLOT, {
    pitch: -24,
    ...hideGrip,
  });
}
// The big square guard, open at the front where a gloved finger goes.
box(TH, 'trigger guard', [0, -0.068, 0.046], [0.015, 0.0042, 0.09], POLY);
box(
  TH,
  'trigger guard front',
  [0, (GY - 0.068) / 2, 0.0025],
  [0.015, 0.068 + GY + 0.002, 0.0042],
  POLY,
);
box(TH, 'trigger', [0, -0.05, 0.044], [0.0052, 0.018, 0.0052], STEEL, { pitch: -12 });
// The selector over the grip on the left.
tubeX(TH, 'selector hub', [-(0.0168 + 0.0006), RBOT - 0.008, 0.112], 0.0044, 0.0016, STEEL);
box(TH, 'selector', [-(0.0168 + 0.0012), RBOT - 0.005, 0.106], [0.0016, 0.0042, 0.017], PIN, {
  pitch: 60,
});

// ================= Handguard: wide and ventilated, wrapping the barrel under the tube,
// flared lips at both ends; a bottom rail section for a foregrip, a side one for a rail item
const HGG = 'handguard';
const hgOutline = (grow) => [
  [-HW + 0.008 - grow, HBOT + 0.001 - grow],
  [HW - 0.008 + grow, HBOT + 0.001 - grow],
  [HW - 0.001 + grow, HBOT + 0.009],
  [HW - 0.002 + grow, TUBE_Y - 0.003],
  [0.0105, TUBE_Y + 0.004 + grow],
  [-0.0105, TUBE_Y + 0.004 + grow],
  [-HW + 0.002 - grow, TUBE_Y - 0.003],
  [-HW + 0.001 - grow, HBOT + 0.009],
];
extrudeZ(HGG, 'handguard', hgOutline(0), HZ0 + 0.007, HZ1 - 0.007, HG);
extrudeZ(HGG, 'handguard lip', hgOutline(0.0013), HZ0, HZ0 + 0.007, HG);
extrudeZ(HGG, 'handguard lip', hgOutline(0.0009), HZ1 - 0.007, HZ1, HG);
// Two rows of vents down the left, the side first person sees; the right side has its rail
// section and the vents behind it.
for (const s of [1, -1])
  for (const y of [0.002, -0.014])
    for (let i = 0; i < 7; i++) {
      const z = HZ0 + 0.03 + i * 0.03;
      if (s > 0 && z < -0.27) continue;
      box(HGG, 'handguard vent', [s * (HW - 0.0006), y, z], [0.001, 0.0065, 0.016], SLOT);
    }
tubeX(HGG, 'handguard pin', [0, TUBE_Y - 0.004, HZ1 - 0.014], 0.0019, 2 * HW + 0.002, PIN, {
  sides: 6,
});
const FG_Z = [-0.31, -0.2];
const FOREGRIP_Y = ar.bottomRail({ bot: HBOT, z0: FG_Z[0], z1: FG_Z[1], color: REC });
const SIDE_RAIL_Z = [-0.35, -0.29];
const RAIL_Y = -0.006;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: HW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});

// ================= Barrel (stays: no barrel slot) ahead of the front sight base, and the
// slotted flash hider (factory, hidden by a muzzle device)
tubeZ('barrel', 'barrel', B, FSB[0] + 0.002, MUZZLE_Z + 0.002, 0.0095, STEEL, { sides: 10 });
tubeZ('barrel', 'barrel collar', B, MUZZLE_Z + 0.03, MUZZLE_Z + 0.022, 0.011, STEEL, {
  sides: 10,
});
const FH = 'flash hider';
const hideFh = { hiddenBy: 'muzzle' };
tubeZ(FH, 'flash hider', B, MUZZLE_Z + 0.002, MUZZLE_Z - FH_L, 0.0118, STEEL, {
  sides: 10,
  ...hideFh,
});
// Four long slots splitting its front into prongs.
for (const a of [45, 135, 225, 315]) {
  const rad = (a * Math.PI) / 180;
  box(
    FH,
    'flash hider slot',
    [0.0117 * Math.sin(rad), B + 0.0117 * Math.cos(rad), MUZZLE_Z - FH_L + 0.019],
    [0.0028, 0.0012, 0.034],
    SLOT,
    { roll: r5(-a), ...hideFh },
  );
}
tubeZ(FH, 'flash hider crown', B, MUZZLE_Z - FH_L, MUZZLE_Z - FH_L - 0.0015, 0.0098, SLOT, {
  sides: 10,
  ...hideFh,
});

// ================= The fixed stock: polymer, its top in line with the receiver, its bottom
// sloping down from the trigger housing to a deep butt with a rubber pad
const ST = 'stock';
prism(
  ST,
  'stock',
  [
    [RTOP - 0.002, RZ1 + 0.001, 0.0198],
    [RTOP - 0.0005, SZ1, 0.0205],
    [-0.106, SZ1, 0.0205],
    [-0.1, SZ1 - 0.022, 0.0205],
    [RBOT + 0.001, RZ1 + 0.001, 0.0198],
  ],
  POLY,
);
// A lighter comb along the top where the cheek goes, and a recess down each side.
prism(
  ST,
  'stock comb',
  [
    [RTOP - 0.0008, 0.24],
    [RTOP + 0.0008, 0.24],
    [RTOP + 0.0016, SZ1 - 0.004],
    [RTOP - 0.0002, SZ1 - 0.004],
  ].map(([y, z]) => [y, z, 0.017]),
  POLY_HI,
);
for (const s of [1, -1])
  prism(
    ST,
    'stock recess',
    [
      [0.008, 0.24],
      [0.01, 0.37],
      [-0.07, 0.37],
      [-0.03, 0.24],
    ].map(([y, z]) => [y, z, 0.0008]),
    '#33363a',
    { x: s * 0.0203 },
  );
add({
  type: 'slab',
  pos: v3([0, -0.04, SZ1 + 0.006]),
  size: v3([0.0405, 0.134, 0.012]),
  corners: [0.006, 0.006, 0.006, 0.006],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
});
tubeX(ST, 'stock pin', [0, 0.004, RZ1 + 0.014], 0.0022, 0.0412, PIN, { sides: 6 });
tubeX(ST, 'sling swivel', [0, -0.1, SZ1 - 0.03], 0.0032, 0.016, STEEL, { sides: 6 });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.085, 0.128],
  support: [0, FOREGRIP_Y - 0.002, (FG_Z[0] + FG_Z[1]) / 2],
  muzzle: [0, B, MUZZLE_Z - FH_L - 0.0015],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.06],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, (FG_Z[0] + FG_Z[1]) / 2],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    grip: GRIP_MOUNT,
    magazine: MAG,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
