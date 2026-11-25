// The MP-133's model (GM-7a): a 12-gauge pump. What makes it read as itself: a slab-sided
// receiver with a rounded back sloping into the stock's wrist, a long barrel with a raised
// vent rib and a pale bead, the magazine tube under it to a band near the muzzle, the ribbed
// pump forend on the tube with its action bars running back, and a plain straight stock.
// Optics go on a low saddle rail on the receiver; bare, it aims along the rail and rib to the
// bead (the user's call), as the saiga-12 does. A barrel mounts at the tube's band, the
// factory barrel the run ahead of it; the magazine slot takes a tube extension in the tube
// cap's place. No stock slot: nothing fits it. The rib, bead and barrels come from
// gun-shotgun.mjs (barrels-shotgun.mjs builds the fitted ones). Replaces only `model` in its
// item file. See docs/guns.md.
//
//   node scripts/gun-mp-133.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { BEAD_TOP, SG, shotgunBarrel } from './gun-shotgun.mjs';

const FILE = new URL('../content/items/mp-133.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, STEEL, RUBBER, PIN } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RT = B + 0.017; // the receiver's top
const RB = B - 0.044; // its bottom
const RW = 0.0165; // its half width
const RZ0 = -0.1; // its front
const RZ1 = 0.105; // its back, where the stock's wrist starts
const RAIL_BASE = RT - 0.0005;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048;
const RAIL_W = 0.0215;
const SIGHT_Y = B + BEAD_TOP; // the bead's top: the line along the rail and rib
const TUBE_Y = B + SG.TUBE_DY; // the magazine tube's axis
const CAP_Z = -0.44; // the barrel band's front: the barrel mount
// The tube's front, behind the band: a tube extension runs on forward through the band, so it
// ends under even the shortest barrel.
const TUBE_END = CAP_Z + 0.062;
const MUZZLE_Z = -0.56; // the factory barrel's end
const FZ = [-0.31, -0.13]; // the forend [front, back]
const SZ1 = 0.4; // the butt's back, the pad's front
const TRIG_Z = 0.058;

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const at = (pts, w) => pts.map(([y, z]) => [y, z, w]);

// ================= Receiver: slab sides, the back rounding down into the wrist, the ejection
// port on the right, the loading port underneath, the cross-bolt safety behind the trigger.
const RC = 'receiver';
prism(
  RC,
  'receiver',
  at(
    [
      [RT, RZ0],
      [RT, RZ1 - 0.03],
      [RT - 0.008, RZ1 - 0.004],
      [RT - 0.016, RZ1],
      [RB + 0.012, RZ1],
      [RB, RZ1 - 0.02],
      [RB, RZ0 + 0.008],
      [RB + 0.006, RZ0],
    ],
    RW,
  ),
  REC,
);
box(RC, 'ejection port', [RW + 0.0003, B + 0.002, -0.035], [0.0008, 0.016, 0.06], SLOT);
box(RC, 'bolt', [RW + 0.0006, B + 0.002, -0.035], [0.0008, 0.011, 0.054], STEEL);
box(RC, 'loading port', [0, RB - 0.0003, -0.035], [2 * RW - 0.008, 0.0008, 0.07], SLOT);
for (const s of [1, -1]) {
  box(RC, 'receiver flat', [s * (RW + 0.0003), B - 0.022, 0.02], [0.0006, 0.012, 0.15], POLY_HI);
  tubeX(RC, 'trigger pin', [s * (RW + 0.0002), RB + 0.009, TRIG_Z - 0.018], 0.002, 0.0008, PIN, {
    sides: 6,
  });
  tubeX(RC, 'trigger pin', [s * (RW + 0.0002), RB + 0.009, TRIG_Z + 0.03], 0.002, 0.0008, PIN, {
    sides: 6,
  });
}
tubeX(RC, 'safety', [0, RB - 0.004, TRIG_Z + 0.03], 0.0036, 2 * RW + 0.003, PIN, { sides: 8 });
// The trigger guard and trigger under the receiver's back half.
const TG = 'trigger';
box(TG, 'trigger guard', [0, RB - 0.024, TRIG_Z + 0.004], [0.01, 0.004, 0.064], REC);
box(TG, 'trigger guard', [0, RB - 0.012, TRIG_Z - 0.03], [0.01, 0.026, 0.004], REC);
box(TG, 'trigger guard', [0, RB - 0.012, TRIG_Z + 0.037], [0.01, 0.026, 0.004], REC);
box(TG, 'trigger', [0, RB - 0.011, TRIG_Z - 0.004], [0.005, 0.02, 0.005], STEEL, { pitch: -14 });
box(TG, 'action release', [-0.0035, RB - 0.006, TRIG_Z - 0.022], [0.003, 0.008, 0.004], PIN);

// ================= The saddle rail on the receiver's top
ar.topRail({ name: 'saddle rail', z0: RZ0 + 0.012, z1: RZ1 - 0.034 });
for (const s of [1, -1])
  box(
    'rails',
    'saddle',
    [s * (RW + 0.0008), RT - 0.005, (RZ0 + RZ1 - 0.022) / 2],
    [0.0016, 0.012, RZ1 - RZ0 - 0.05],
    REC,
  );

// ================= Barrel: the run under the band stays, the run ahead of it is the factory
// barrel (hidden by a fitted barrel), each with the rib; the bead on the factory run.
shotgunBarrel(kit, { z0: CAP_Z + 0.012, z1: RZ0 + 0.002, y: B, bead: false });
shotgunBarrel(kit, { z0: MUZZLE_Z, z1: CAP_Z, y: B, extra: { hiddenBy: 'barrel' } });
// The band holding barrel and tube together at the tube's front, a short rail on its right.
const BAND = 'barrel band';
extrudeZ(
  BAND,
  'barrel band',
  [
    [-0.009, B + SG.BR + 0.002],
    [0.009, B + SG.BR + 0.002],
    [0.0135, B],
    [0.0135, TUBE_Y],
    [0.009, TUBE_Y - 0.0135],
    [-0.009, TUBE_Y - 0.0135],
    [-0.0135, TUBE_Y],
    [-0.0135, B],
  ],
  CAP_Z + 0.046,
  CAP_Z + 0.002,
  SG.BAND,
);
tubeX(BAND, 'band screw', [-0.014, TUBE_Y + 0.008, CAP_Z + 0.024], 0.0022, 0.002, PIN, {
  sides: 6,
});
const RAIL_Y = (B + TUBE_Y) / 2;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: 0.0135,
  y: RAIL_Y,
  z0: CAP_Z + 0.004,
  z1: CAP_Z + 0.044,
  color: REC,
});

// ================= Magazine tube to the band, its cap (hidden by a tube extension)
tubeZ('magazine tube', 'magazine tube', TUBE_Y, RZ0 + 0.002, TUBE_END, 0.0108, STEEL, {
  sides: 10,
});
tubeZ('magazine tube', 'tube cap', TUBE_Y, TUBE_END + 0.001, TUBE_END - 0.01, 0.0116, SG.BAND, {
  sides: 10,
  hiddenBy: 'magazine',
});

// ================= The pump forend on the tube, its grooves, the action bars back to the
// receiver.
const FE = 'forend';
extrudeZ(
  FE,
  'forend',
  [
    [-0.015, B - 0.002],
    [0.015, B - 0.002],
    [0.021, B - 0.012],
    [0.021, TUBE_Y - 0.008],
    [0.014, TUBE_Y - 0.017],
    [-0.014, TUBE_Y - 0.017],
    [-0.021, TUBE_Y - 0.008],
    [-0.021, B - 0.012],
  ],
  FZ[0],
  FZ[1],
  POLY,
);
for (const s of [1, -1])
  for (let i = 0; i < 7; i++)
    box(
      FE,
      'forend groove',
      [s * 0.0212, TUBE_Y + 0.002, FZ[0] + 0.03 + i * 0.02],
      [0.0008, 0.016, 0.004],
      SLOT,
    );
for (const s of [1, -1])
  box(
    FE,
    'action bar',
    [s * 0.0105, TUBE_Y + 0.007, (FZ[1] + RZ0) / 2],
    [0.002, 0.004, RZ0 - FZ[1] + 0.004],
    STEEL,
  );

// ================= The stock: one straight-bottomed piece from the wrist to the butt, a
// rubber pad, a sling swivel underneath.
const ST = 'stock';
prism(
  ST,
  'stock',
  at(
    [
      [RT - 0.016, RZ1 - 0.002],
      [B + 0.004, SZ1],
      [B - 0.128, SZ1],
      [RB + 0.008, RZ1 - 0.002],
    ],
    0.0152,
  ),
  POLY,
);
prism(
  ST,
  'comb',
  at(
    [
      [B + 0.0085, RZ1 + 0.1],
      [B + 0.0052, SZ1 - 0.012],
      [B - 0.003, SZ1 - 0.012],
      [B, RZ1 + 0.1],
    ],
    0.0128,
  ),
  POLY_HI,
);
add({
  type: 'slab',
  pos: v3([0, (B + 0.004 + B - 0.128) / 2, SZ1 + 0.007]),
  size: v3([0.032, 0.132, 0.014]),
  corners: [0.005, 0.005, 0.005, 0.005],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
});
tubeX(ST, 'sling swivel', [0, B - 0.112, SZ1 - 0.045], 0.004, 0.004, STEEL, { sides: 8, pitch: 0 });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, RB - 0.03, TRIG_Z + 0.07],
  support: [0, TUBE_Y - 0.017, (FZ[0] + FZ[1]) / 2],
  muzzle: [0, B, MUZZLE_Z],
  sight: [0, SIGHT_Y, RZ1 - 0.04],
  mounts: {
    optic: [0, RAIL_TOP, 0.01],
    muzzle: [0, B, MUZZLE_Z],
    barrel: [0, B, CAP_Z],
    rightRail: [RAIL_X, RAIL_Y, CAP_Z + 0.024],
    magazine: [0, TUBE_Y, TUBE_END],
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
