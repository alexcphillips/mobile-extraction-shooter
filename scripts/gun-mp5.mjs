// The MP5's model (GM-4): a 9 mm roller-delayed SMG. What makes it read as itself: a slim
// stamped receiver with a rounded top and pressed ribs down its sides, the cocking tube
// running forward over the barrel to a front sight hooded by a full ring, the cocking handle
// sticking out forward on the left, a slim handguard under the tube, a polymer trigger
// housing with its grip and big square guard hung under the back, a drum rear sight, and the
// collapsing stock on two struts either side of the receiver. A claw-mount rail bridges the
// receiver between the sights for optics. Its grip is part of the trigger housing (no grip
// slot). Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-mp5.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, r5, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { coreOutline } from './optic-kit.mjs';
import { hkSights } from './gun-hk.mjs';

const FILE = new URL('../content/items/mp5.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { REC, SLOT, HG, POLY, POLY_HI, STEEL, RUBBER, PIN } = AR;

// ---- Key sizes everything hangs off
const B = 0; // bore height
const RW = 0.017; // the receiver's half width
const RTOP = 0.021; // the receiver's top (and the cocking tube's)
const RBOT = -0.017; // the receiver's bottom, where the trigger housing and magwell hang
const RZ0 = -0.05; // the receiver body's front: the cocking tube runs on from here
const RZ1 = 0.165; // the end cap: the stock's front
const TUBE_Y = 0.0105; // the cocking tube's axis
const TUBE_R = 0.0105;
const RAIL_BASE = RTOP + 0.0004;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048; // top of the claw mount's teeth: the optic mount
const RAIL_W = 0.0215;
const RAIL_Z = [-0.04, 0.1]; // the claw mount's rail run
const SIGHT_Y = RAIL_TOP + 0.013; // the sight line: under the lowest optic's dot
const REAR_Z = 0.138;
const FRONT_Z = -0.205;
const FSB = [-0.214, -0.196]; // the front sight base along z
const HZ0 = -0.19; // handguard front
const HZ1 = -0.052; // handguard rear (against the magwell)
const HW = 0.022; // handguard half width
const HBOT = -0.027; // handguard bottom
const MUZZLE_Z = -0.262; // the barrel's end: where a muzzle device goes on
const MAG = [0, -0.045, -0.014]; // magazine mount: the magwell's mouth
const WELL = [-0.054, 0.006]; // the magwell along z
const STOCK = [0, 0.004, RZ1 + 0.002];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const hk = hkSights(kit);
const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

// ================= Receiver: the stamped body, rounded on top, ribs pressed down its sides
const RC = 'receiver';
extrudeZ(
  RC,
  'receiver',
  [
    [-RW + 0.006, RBOT + 0.001],
    [RW - 0.006, RBOT + 0.001],
    [RW - 0.001, RBOT + 0.004],
    [RW - 0.001, RTOP - 0.009],
    [RW - 0.006, RTOP - 0.001],
    [-RW + 0.006, RTOP - 0.001],
    [-RW + 0.001, RTOP - 0.009],
    [-RW + 0.001, RBOT + 0.004],
  ],
  RZ0,
  RZ1,
  REC,
);
for (const s of [1, -1]) {
  // The pressed ribs: a long one high, a short one low, a step proud and a shade lighter.
  box(RC, 'receiver rib', [s * (RW + 0.0003), 0.012, 0.055], [0.0012, 0.0028, 0.2], '#303236');
  box(RC, 'receiver rib', [s * (RW + 0.0003), -0.008, 0.105], [0.0012, 0.0028, 0.1], '#303236');
  // The stock struts' channel below the high rib.
  box(RC, 'stock channel', [s * (RW + 0.0002), 0.0035, 0.11], [0.0008, 0.0052, 0.11], SLOT);
}
// The end cap, a step bigger, with its sling loop.
extrudeZ(
  RC,
  'end cap',
  [
    [-RW + 0.005, RBOT + 0.0005],
    [RW - 0.005, RBOT + 0.0005],
    [RW + 0.0003, RBOT + 0.004],
    [RW + 0.0003, RTOP - 0.009],
    [RW - 0.005, RTOP + 0.0003],
    [-RW + 0.005, RTOP + 0.0003],
    [-RW - 0.0003, RTOP - 0.009],
    [-RW - 0.0003, RBOT + 0.004],
  ],
  RZ1 - 0.004,
  RZ1 + 0.002,
  STEEL,
);
// The ejection port on the right, the "slap" notch over the cocking slot on the left.
box(RC, 'ejection port', [RW + 0.0004, 0.009, -0.02], [0.001, 0.014, 0.046], SLOT);
box(RC, 'port deflector', [RW + 0.0016, 0.0175, 0.008], [0.003, 0.004, 0.01], STEEL);
// Push pins through the receiver for the trigger housing.
tubeX(RC, 'housing pin', [0, -0.012, 0.012], 0.0022, 2 * RW + 0.0016, PIN, { sides: 6 });
tubeX(RC, 'housing pin', [0, -0.012, 0.152], 0.0022, 2 * RW + 0.0016, PIN, { sides: 6 });

// ================= Cocking tube forward over the barrel, the cocking handle on the left
const CT = 'cocking tube';
tubeZ(CT, 'cocking tube', TUBE_Y, FSB[1], RZ0 + 0.002, TUBE_R, REC, { sides: 12 });
// The slot down its left side and the handle folded out forward from it.
box(CT, 'cocking slot', [-(TUBE_R - 0.0015), TUBE_Y + 0.002, -0.125], [0.002, 0.004, 0.1], SLOT, {
  yaw: 0,
  roll: 30,
});
const CH = [-0.0175, TUBE_Y + 0.004, -0.172];
box(CT, 'cocking handle', CH, [0.016, 0.005, 0.006], STEEL, { yaw: -40 });
tubeZ(CT, 'cocking handle knob', CH[1], CH[2] - 0.006, CH[2] + 0.006, 0.0042, POLY, {
  x: CH[0] - 0.006,
  sides: 8,
});

// ================= Front sight: a base clamped round tube and barrel, a tower rising to a
// full ring hood with the post inside (gun-hk.mjs)
const FS = 'iron sights';
extrudeZ(
  FS,
  'front sight base',
  rounded(
    [
      [-0.0105, B - 0.0095],
      [0.0105, B - 0.0095],
      [0.0125, TUBE_Y],
      [0.0115, RTOP - 0.001],
      [-0.0115, RTOP - 0.001],
      [-0.0125, TUBE_Y],
    ],
    0.002,
  ),
  FSB[0],
  FSB[1],
  REC,
);
tubeX(FS, 'front sight base pin', [0, B - 0.004, (FSB[0] + FSB[1]) / 2], 0.0016, 0.0236, PIN, {
  sides: 6,
});
hk.ringFront({ SIGHT_Y, FRONT_Z, BASE_Y: RTOP - 0.002, group: FS });

// ================= Rear sight: the HK drum on the receiver (gun-hk.mjs); hidden by an optic
hk.drumRear({ SIGHT_Y, REAR_Z, BASE_Y: RTOP - 0.001, group: FS });

// ================= Claw mount: a rail on a bridge clamped to the receiver between the sights
const CM = 'rails';
ar.topRail({ name: 'top rail', z0: RAIL_Z[0], z1: RAIL_Z[1], group: CM });
for (const z of [RAIL_Z[0] + 0.012, RAIL_Z[1] - 0.012]) {
  for (const s of [1, -1]) {
    // The claws gripping the receiver's shoulders, and a lever on the left one.
    box(CM, 'claw', [s * (RW - 0.0015), RTOP - 0.004, z], [0.004, 0.009, 0.014], REC, {
      roll: s * 25,
    });
  }
  tubeX(CM, 'claw lever', [-(RW + 0.001), RTOP - 0.002, z], 0.0022, 0.0024, PIN, { sides: 6 });
}

// ================= Magwell and paddle release
const MW = 'magazine well';
prism(
  MW,
  'magazine well',
  [
    [RBOT + 0.0005, WELL[0]],
    [RBOT + 0.0005, WELL[1]],
    [MAG[1], WELL[1] - 0.002],
    [MAG[1], WELL[0] + 0.002],
  ].map(([y, z]) => [y, z, 0.0148]),
  REC,
);
box(MW, 'magazine well mouth', [0, MAG[1] - 0.0003, MAG[2]], [0.024, 0.001, 0.054], SLOT);
box(
  MW,
  'magazine well rib',
  [0, (RBOT + MAG[1]) / 2, WELL[0] + 0.001],
  [0.022, 0.02, 0.0012],
  '#303236',
);
box(MW, 'paddle release', [0, MAG[1] + 0.001, WELL[1] + 0.006], [0.012, 0.004, 0.012], STEEL, {
  pitch: -20,
});

// ================= Trigger housing: polymer, hung under the back, its guard and grip
const TH = 'trigger housing';
const TZ = [0.01, 0.16];
prism(
  TH,
  'trigger housing',
  [
    [RBOT + 0.0005, TZ[0]],
    [RBOT + 0.0005, TZ[1]],
    [RBOT - 0.012, TZ[1] - 0.008],
    [RBOT - 0.016, 0.13],
    [RBOT - 0.016, TZ[0] + 0.004],
  ].map(([y, z]) => [y, z, 0.0162]),
  POLY,
);
const GY = RBOT - 0.015; // where the grip leaves the housing
prism(
  TH,
  'grip',
  [
    [GY, 0.088],
    [GY, 0.132],
    [-0.118, 0.158],
    [-0.121, 0.15],
    [-0.118, 0.118],
    [-0.07, 0.096],
  ].map(([y, z]) => [y, z, 0.0148]),
  POLY,
);
prism(
  TH,
  'grip backstrap',
  [
    [GY - 0.001, 0.131],
    [GY - 0.001, 0.1338],
    [-0.116, 0.1598],
    [-0.116, 0.157],
  ].map(([y, z]) => [y, z, 0.0136]),
  POLY_HI,
);
for (const y of [-0.06, -0.078, -0.096]) {
  const z = 0.096 + ((-0.07 - y) / 0.048) * 0.022 - 0.001;
  box(TH, 'grip texture', [0, y, z + 0.024], [0.0302, 0.0014, 0.026], SLOT, { pitch: -24 });
}
// The big square guard, open at the front where a gloved finger goes.
box(TH, 'trigger guard', [0, -0.06, 0.052], [0.014, 0.004, 0.084], POLY);
box(
  TH,
  'trigger guard front',
  [0, (GY - 0.06) / 2, 0.0115],
  [0.014, GY - -0.06 + 0.002, 0.004],
  POLY,
);
box(TH, 'trigger', [0, -0.044, 0.05], [0.005, 0.017, 0.005], STEEL, { pitch: -12 });
// The selector over the grip on the left, a lighter edge along the housing's bottom.
tubeX(TH, 'selector hub', [-(0.0162 + 0.0006), RBOT - 0.008, 0.1], 0.0042, 0.0016, STEEL);
box(TH, 'selector', [-(0.0162 + 0.0012), RBOT - 0.005, 0.094], [0.0016, 0.004, 0.016], PIN, {
  pitch: 60,
});
box(TH, 'housing edge', [0, RBOT - 0.0163, 0.07], [0.026, 0.001, 0.11], POLY_HI);

// ================= Handguard: slim, wrapping the barrel under the tube, flared lips at
// both ends; a bottom rail section for a foregrip, a side section for a rail item
const HGG = 'handguard';
const hgOutline = (grow) => [
  [-HW + 0.006 - grow, HBOT + 0.001 - grow],
  [HW - 0.006 + grow, HBOT + 0.001 - grow],
  [HW - 0.001 + grow, HBOT + 0.007],
  [HW - 0.002 + grow, TUBE_Y - 0.002],
  [0.0095, TUBE_Y + 0.0035 + grow],
  [-0.0095, TUBE_Y + 0.0035 + grow],
  [-HW + 0.002 - grow, TUBE_Y - 0.002],
  [-HW + 0.001 - grow, HBOT + 0.007],
];
extrudeZ(HGG, 'handguard', hgOutline(0), HZ0 + 0.006, HZ1 - 0.006, HG);
extrudeZ(HGG, 'handguard lip', hgOutline(0.0012), HZ0, HZ0 + 0.006, HG);
extrudeZ(HGG, 'handguard lip', hgOutline(0.0008), HZ1 - 0.006, HZ1, HG);
// Grooves along both sides, and the cross pin that holds it.
for (const s of [1, -1])
  for (const y of [-0.004, -0.012])
    box(HGG, 'handguard groove', [s * (HW + 0.0002), y, -0.094], [0.0008, 0.0024, 0.06], SLOT);
tubeX(HGG, 'handguard pin', [0, TUBE_Y - 0.003, HZ1 - 0.012], 0.0018, 2 * HW + 0.002, PIN, {
  sides: 6,
});
const FG_Z = [-0.172, -0.124];
const FOREGRIP_Y = ar.bottomRail({ bot: HBOT, z0: FG_Z[0], z1: FG_Z[1], color: REC });
const SIDE_RAIL_Z = [-0.182, -0.146];
const RAIL_Y = -0.008;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: HW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});

// ================= Barrel (factory, hidden by a fitted barrel): the run ahead of the front
// sight base and its three locking lugs; a thread cap at its end (hidden by a muzzle device)
const BRL = 'barrel';
const hideBarrel = { hiddenBy: 'barrel' };
tubeZ(BRL, 'barrel', B, FSB[0] + 0.002, MUZZLE_Z + 0.002, 0.0088, STEEL, {
  sides: 10,
  ...hideBarrel,
});
tubeZ(BRL, 'lug collar', B, MUZZLE_Z + 0.024, MUZZLE_Z + 0.016, 0.0102, STEEL, {
  sides: 10,
  ...hideBarrel,
});
for (let i = 0; i < 3; i++) {
  const a = (i * 120 + 90) * (Math.PI / 180);
  box(
    BRL,
    'locking lug',
    [0.0104 * Math.cos(a), B + 0.0104 * Math.sin(a), MUZZLE_Z + 0.012],
    [0.0045, 0.003, 0.008],
    STEEL,
    { roll: r5((a * 180) / Math.PI - 90), ...hideBarrel },
  );
}
tubeZ('muzzle', 'thread cap', B, MUZZLE_Z + 0.001, MUZZLE_Z - 0.008, 0.0078, '#2c2e31', {
  sides: 10,
  hiddenBy: 'muzzle',
});

// ================= The collapsing stock (factory, hidden by a fitted stock): two struts
// riding the receiver's channels and a curved butt plate
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const STRUT = [0.096, 0.352]; // the struts along z, extended
for (const s of [1, -1]) {
  box(
    ST,
    'stock strut',
    [s * (RW + 0.0026), 0.0035, (STRUT[0] + STRUT[1]) / 2],
    [0.0036, 0.0048, STRUT[1] - STRUT[0]],
    STEEL,
    hide,
  );
}
// The struts' cross pieces behind the end cap and the butt.
box(ST, 'stock yoke', [0, 0.0035, STRUT[1] - 0.012], [2 * RW + 0.009, 0.0062, 0.012], STEEL, hide);
box(ST, 'stock latch', [0, -0.006, STRUT[1] - 0.014], [0.012, 0.012, 0.008], POLY, hide);
// The butt plate: curved, taller below the struts, rubber on the back.
prism(
  ST,
  'butt plate',
  [
    [0.028, STRUT[1] - 0.006],
    [0.03, STRUT[1] + 0.004],
    [-0.088, STRUT[1] + 0.004],
    [-0.086, STRUT[1] - 0.008],
    [-0.03, STRUT[1] - 0.012],
  ].map(([y, z]) => [y, z, 0.0185]),
  POLY,
  hide,
);
add({
  type: 'slab',
  pos: v3([0, -0.029, STRUT[1] + 0.008]),
  size: v3([0.036, 0.116, 0.008]),
  corners: [0.006, 0.006, 0.006, 0.006],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});

// ---- Points and mounts
const { factoryFold } = ITEM.model ?? {};
const model = {
  parts,
  grip: [0, -0.075, 0.122],
  support: [0, FOREGRIP_Y - 0.002, (FG_Z[0] + FG_Z[1]) / 2],
  muzzle: [0, B, MUZZLE_Z - 0.008],
  sight: [0, SIGHT_Y, REAR_Z],
  ...(factoryFold && { factoryFold }),
  mounts: {
    optic: [0, RAIL_TOP, 0.05],
    muzzle: [0, B, MUZZLE_Z],
    barrel: [0, B, FSB[0]],
    foregrip: [0, FOREGRIP_Y, (FG_Z[0] + FG_Z[1]) / 2],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
