// The UMP45's model (GM-4): a .45 polymer SMG, long and square. What makes it read as
// itself: a slab-sided box receiver the whole length of the gun with a long top rail, its
// front a squared nose with rails on the side and underneath, a straight magazine well,
// the grip molded into the lower with a big guard, the cocking handle forward on the left,
// HK drum and ring sights on the rail (gun-hk.mjs), and a skeleton stock that folds to the
// right. Its grip is part of the lower (no grip slot) and it has no barrel slot. Replaces
// only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-ump45.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { hkSights } from './gun-hk.mjs';

const FILE = new URL('../content/items/ump45.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { REC, SLOT, POLY, POLY_HI, STEEL, RUBBER, PIN } = AR;

// ---- Key sizes everything hangs off
const B = 0; // bore height
const UW = 0.046; // the receiver's width
const UTOP = 0.026; // the receiver's top, under the rail
const UBOT = -0.012; // where the upper meets the lower
const UZ0 = -0.215; // the nose's face
const UZ1 = 0.115; // the receiver's rear: the stock's hinge
const RAIL_BASE = UTOP + 0.0005;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048; // top of the teeth: the optic mount's height
const RAIL_W = 0.0215;
const SIGHT_Y = RAIL_TOP + 0.016; // under the lowest optic's dot
const REAR_Z = 0.096;
const FRONT_Z = -0.2;
const LW = 0.042; // the lower's width
const LBOT = -0.036; // the lower's bottom
const NOSE_BOT = -0.03; // the nose's bottom, where the bottom rail goes
const MUZZLE_Z = -0.252; // the barrel's end: where a muzzle device goes on
const MAG = [0, -0.047, -0.052]; // the magazine's mouth
const WELL = [-0.08, -0.024]; // the magazine well along z
const STOCK = [0, 0.008, UZ1 + 0.002];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const hk = hkSights(kit);

// ================= Receiver: the box upper, its top edges chamfered under the rail, a long
// recessed panel down each side, the nose squared off round the barrel
const UP = 'receiver';
extrudeZ(
  UP,
  'receiver',
  [
    [-UW / 2, UBOT],
    [UW / 2, UBOT],
    [UW / 2, UTOP - 0.006],
    [UW / 2 - 0.006, UTOP],
    [-UW / 2 + 0.006, UTOP],
    [-UW / 2, UTOP - 0.006],
  ],
  UZ0,
  UZ1,
  REC,
);
box(
  UP,
  'nose face',
  [0, (UBOT + UTOP) / 2 - 0.004, UZ0 - 0.0006],
  [UW - 0.01, UTOP - UBOT - 0.012, 0.0012],
  SLOT,
);
for (const s of [1, -1]) {
  box(UP, 'side panel', [s * (UW / 2 + 0.0003), 0.008, -0.03], [0.0008, 0.02, 0.17], '#25272a');
  // The ribs along the nose, either side.
  for (let i = 0; i < 3; i++)
    box(
      UP,
      'nose rib',
      [s * (UW / 2 + 0.0004), 0.016 - i * 0.008, -0.175],
      [0.001, 0.003, 0.05],
      '#303236',
    );
}
box(UP, 'ejection port', [UW / 2 + 0.0008, 0.006, 0.01], [0.001, 0.016, 0.05], SLOT);
// The cocking handle forward on the left, folding out of its slot.
box(UP, 'cocking slot', [-(UW / 2 + 0.0004), 0.017, -0.105], [0.001, 0.005, 0.1], SLOT);
box(UP, 'cocking handle', [-(UW / 2 + 0.005), 0.017, -0.148], [0.01, 0.006, 0.008], STEEL);
box(UP, 'cocking handle knob', [-(UW / 2 + 0.011), 0.017, -0.148], [0.005, 0.012, 0.012], POLY);
// The end plate at the back with the stock's hinge block on the right.
box(
  UP,
  'end plate',
  [0, (UBOT + UTOP) / 2, UZ1 + 0.0015],
  [UW - 0.006, UTOP - UBOT - 0.006, 0.003],
  '#25272a',
);
box(UP, 'stock hinge', [UW / 2 - 0.002, STOCK[1], UZ1 + 0.004], [0.01, 0.026, 0.008], STEEL);
tubeX(UP, 'hinge pin', [UW / 2 + 0.0035, STOCK[1], UZ1 + 0.004], 0.0022, 0.028, PIN, {
  roll: 0,
  sides: 6,
});
ar.topRail({ name: 'top rail', z0: UZ0 + 0.004, z1: UZ1 - 0.004 });
// The side rail at the nose (right) and its twin on the left.
const SIDE_RAIL_Z = [-0.212, -0.166];
const RAIL_Y = 0.004;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: UW / 2 - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});
ar.sideRail({
  s: -1,
  x0: UW / 2 - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});

// ================= Lower: polymer under the receiver, the nose's underside with a rail, a
// lighter edge, the magazine well, guard and grip
const LO = 'lower receiver';
prism(
  LO,
  'lower receiver',
  [
    [UBOT + 0.0005, UZ0 + 0.002],
    [UBOT + 0.0005, UZ1],
    [LBOT + 0.006, UZ1],
    [LBOT, UZ1 - 0.02],
    [LBOT, WELL[0] - 0.012],
    [NOSE_BOT, -0.14],
    [NOSE_BOT, UZ0 + 0.004],
  ].map(([y, z]) => [y, z, LW / 2]),
  POLY,
);
box(LO, 'lower edge', [0, LBOT - 0.0004, 0.03], [LW - 0.008, 0.001, 0.13], POLY_HI);
const FG_Z = [-0.21, -0.152];
const FOREGRIP_Y = ar.bottomRail({ bot: NOSE_BOT, z0: FG_Z[0], z1: FG_Z[1], color: REC });
// The straight magazine well, a step narrower than the lower, its mouth darker.
prism(
  LO,
  'magazine well',
  [
    [LBOT + 0.002, WELL[0]],
    [LBOT + 0.002, WELL[1]],
    [MAG[1], WELL[1]],
    [MAG[1], WELL[0]],
  ].map(([y, z]) => [y, z, 0.0175]),
  POLY,
);
box(LO, 'magazine well mouth', [0, MAG[1] - 0.0003, MAG[2]], [0.03, 0.001, 0.052], SLOT);
box(LO, 'magazine release', [0, MAG[1] + 0.006, WELL[1] + 0.003], [0.014, 0.008, 0.005], STEEL);
// The guard: big, from behind the well to the grip.
const GZ = [WELL[1] + 0.004, 0.046];
box(LO, 'trigger guard', [0, -0.07, (GZ[0] + GZ[1]) / 2], [0.013, 0.004, GZ[1] - GZ[0]], POLY);
box(
  LO,
  'trigger guard front',
  [0, (LBOT - 0.07) / 2, GZ[0] + 0.002],
  [0.013, LBOT + 0.07 + 0.002, 0.004],
  POLY,
);
box(LO, 'trigger', [0, -0.05, 0.004], [0.005, 0.02, 0.005], STEEL, { pitch: -12 });
// The selector either side over the grip.
for (const s of [1, -1]) {
  tubeX(LO, 'selector hub', [s * (LW / 2 + 0.0006), -0.024, 0.066], 0.0045, 0.0016, STEEL);
  box(LO, 'selector', [s * (LW / 2 + 0.0012), -0.021, 0.06], [0.0016, 0.004, 0.016], PIN, {
    pitch: 55,
  });
}
tubeX(LO, 'takedown pin', [0, -0.02, -0.19], 0.0024, LW + 0.0016, PIN, { sides: 6 });
tubeX(LO, 'takedown pin', [0, -0.02, 0.1], 0.0024, LW + 0.0016, PIN, { sides: 6 });
// The grip, molded into the lower: raked, a stippled panel each side, a lighter backstrap.
const GR = 'grip';
prism(
  GR,
  'grip',
  [
    [LBOT + 0.002, 0.042],
    [LBOT + 0.002, 0.084],
    [-0.128, 0.108],
    [-0.131, 0.1],
    [-0.128, 0.068],
    [-0.07, 0.05],
  ].map(([y, z]) => [y, z, 0.0155]),
  POLY,
);
prism(
  GR,
  'grip backstrap',
  [
    [LBOT + 0.001, 0.083],
    [LBOT + 0.001, 0.0858],
    [-0.126, 0.1098],
    [-0.126, 0.107],
  ].map(([y, z]) => [y, z, 0.0142]),
  POLY_HI,
);
for (const s of [1, -1])
  box(GR, 'grip panel', [s * 0.0157, -0.086, 0.077], [0.0008, 0.05, 0.026], '#303236', {
    pitch: -15,
  });
box(GR, 'grip cap', [0, -0.1305, 0.0855], [0.029, 0.003, 0.03], RUBBER);

// ================= Barrel (stays: no barrel slot) and flash hider (hidden by a muzzle device)
tubeZ('barrel', 'barrel', B, UZ0 + 0.002, MUZZLE_Z - 0.001, 0.0095, STEEL, { sides: 10 });
tubeZ('barrel', 'barrel nut', B, UZ0 + 0.0005, UZ0 - 0.006, 0.0115, STEEL, { sides: 10 });
tubeZ('muzzle', 'flash hider', B, MUZZLE_Z + 0.001, MUZZLE_Z - 0.024, 0.0098, STEEL, {
  sides: 8,
  hiddenBy: 'muzzle',
});
for (let i = 0; i < 4; i++) {
  const a = (i * 90 + 45) * (Math.PI / 180);
  box(
    'muzzle',
    'flash hider slot',
    [0.0094 * Math.cos(a), B + 0.0094 * Math.sin(a), MUZZLE_Z - 0.015],
    [0.0012, 0.0012, 0.014],
    '#161719',
    { hiddenBy: 'muzzle' },
  );
}

// ================= The skeleton stock (factory, hidden by a fitted stock): a frame of a top
// and a bottom bar to the butt, folding to the right about the hinge
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ = [STOCK[2] + 0.006, 0.33]; // the stock along z
box(ST, 'stock knuckle', [0, STOCK[1], SZ[0] + 0.006], [0.024, 0.03, 0.012], POLY, hide);
box(
  ST,
  'stock top bar',
  [0, STOCK[1] + 0.011, (SZ[0] + SZ[1]) / 2],
  [0.016, 0.008, SZ[1] - SZ[0]],
  POLY,
  hide,
);
box(
  ST,
  'stock top edge',
  [0, STOCK[1] + 0.0155, (SZ[0] + SZ[1]) / 2],
  [0.012, 0.001, SZ[1] - SZ[0] - 0.01],
  POLY_HI,
  hide,
);
prism(
  ST,
  'stock bottom bar',
  [
    [STOCK[1] - 0.006, SZ[0] + 0.01],
    [STOCK[1] - 0.014, SZ[0] + 0.01],
    [-0.072, SZ[1] - 0.012],
    [-0.062, SZ[1] - 0.012],
  ].map(([y, z]) => [y, z, 0.006]),
  POLY,
  hide,
);
prism(
  ST,
  'stock butt',
  [
    [STOCK[1] + 0.015, SZ[1] - 0.014],
    [STOCK[1] + 0.015, SZ[1]],
    [-0.082, SZ[1]],
    [-0.082, SZ[1] - 0.016],
  ].map(([y, z]) => [y, z, 0.012]),
  POLY,
  hide,
);
add({
  type: 'slab',
  pos: v3([0, (STOCK[1] + 0.015 - 0.082) / 2, SZ[1] + 0.005]),
  size: v3([0.027, STOCK[1] + 0.015 + 0.082, 0.01]),
  corners: [0.005, 0.005, 0.005, 0.005],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
tubeX(ST, 'sling loop', [0, -0.07, SZ[1] - 0.022], 0.003, 0.02, STEEL, hide);

// ================= Iron sights: the HK drum and ring on the top rail
hk.ringFront({ SIGHT_Y, FRONT_Z, BASE_Y: RAIL_TOP - 0.0005 });
hk.drumRear({ SIGHT_Y, REAR_Z, BASE_Y: RAIL_TOP - 0.0005 });

// ---- Points and mounts
const { factoryFold } = ITEM.model ?? {};
const model = {
  parts,
  grip: [0, -0.078, 0.074],
  support: [0, FOREGRIP_Y - 0.002, (FG_Z[0] + FG_Z[1]) / 2],
  muzzle: [0, B, MUZZLE_Z - 0.024],
  sight: [0, SIGHT_Y, REAR_Z],
  ...(factoryFold && { factoryFold }),
  mounts: {
    optic: [0, RAIL_TOP, 0.03],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, (FG_Z[0] + FG_Z[1]) / 2],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
