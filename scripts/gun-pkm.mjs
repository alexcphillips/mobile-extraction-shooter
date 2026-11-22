// The PKM's model (GM-5b): a belt-fed 7.62x54R machine gun. What makes it read as itself: a
// long stamped receiver with the feed cover over its front half and a lower step behind it,
// a long heavy barrel with the gas cylinder under it, a tall front sight tower near the
// muzzle, a slotted conical flash hider, the carry handle on the barrel ahead of the
// receiver, the bipod folded back under the gas cylinder, and the skeletal stock, open
// through its middle. It takes optics the `ak` family's way (the user's call): a rail on the
// feed cover, the family's flat notch on a clamp at the rail's back, and the post between
// ears on the front tower, which stays under an optic. No stock slot: nothing fits it, so the
// stock is part of the gun. The notch, post, grip and trigger guard come from gun-ak.mjs.
// Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-pkm.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AK, akPieces, akRail, hull2d } from './gun-ak.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/pkm.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, STEEL, PIN, RUBBER, BORE, BAND } = AK;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RW = 0.0185; // receiver half width
const RTOP = B + 0.011; // receiver walls' top, under the feed cover
const RBOT = B - 0.05; // receiver bottom
const RZ0 = -0.14; // receiver front
const RZ1 = 0.17; // receiver rear: the stock's front
const COVER_Z1 = 0.118; // the feed cover's back: the receiver steps down behind it
const { RAIL_TOP } = akRail(B);
const SIGHT_Y = RAIL_TOP + 0.02; // the family's sight line over the rail
const GZ = [-0.45, -0.422]; // gas block [front, rear]
const TUBE_Y = B - 0.019; // the gas cylinder's axis, under the barrel
const MUZZLE_Z = -0.68; // where a muzzle device threads on
const FH_L = 0.064; // the factory flash hider's length
const FRONT_Z = MUZZLE_Z + 0.03; // the front sight tower
const BARREL_R = 0.0092;
const GRIP_Z = 0.072; // the grip's top front
const MAG = [0, RBOT, -0.07]; // the ammo box's mount: under the receiver's front
const SZ1 = 0.385; // the butt's back, the pad's front
const SW = 0.0172; // the stock's half width

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ak = akPieces(kit, { B, RW, RTOP, RBOT, SIGHT_Y });
const ring = (cx, cy, r, n = 8) => roundOutline(n)(r).map(([x, y]) => [x + cx, y + cy]);

// ================= Receiver: square stamped sides with rounded bottom corners, a pressed rib
// along each side, rivets, the belt's feed window on the right and the ejection port low on
// the left, the charging handle forward on the right.
const RC = 'receiver';
extrudeZ(
  RC,
  'receiver',
  [
    [-RW, RTOP],
    [RW, RTOP],
    [RW, RBOT + 0.007],
    [RW - 0.005, RBOT],
    [-RW + 0.005, RBOT],
    [-RW, RBOT + 0.007],
  ],
  RZ0,
  RZ1,
  REC,
);
for (const s of [1, -1]) {
  box(RC, 'receiver rib', [s * (RW + 0.0003), B - 0.017, -0.01], [0.0008, 0.005, 0.26], BAND);
  for (const z of [RZ0 + 0.012, RZ0 + 0.03, RZ1 - 0.016])
    tubeX(RC, 'rivet', [s * (RW + 0.0003), B - 0.03, z], 0.0018, 0.0008, PIN, { sides: 6 });
}
// The belt comes in on the right under the cover; the empty links go out on the left.
box(RC, 'feed window', [RW + 0.0003, RTOP - 0.006, -0.085], [0.0008, 0.009, 0.05], SLOT);
box(RC, 'feed lip', [RW + 0.0006, RTOP - 0.0108, -0.085], [0.0012, 0.0012, 0.052], PIN);
box(RC, 'link port', [-(RW + 0.0003), RTOP - 0.006, -0.085], [0.0008, 0.007, 0.04], SLOT);
box(RC, 'ejection port', [-(RW + 0.0003), RBOT + 0.01, -0.03], [0.0008, 0.008, 0.045], SLOT);
// The charging handle in its slot on the right, a dark track behind it.
box(RC, 'charging slot', [RW + 0.0003, B - 0.006, 0.0], [0.0008, 0.0045, 0.11], SLOT);
box(RC, 'charging handle', [RW + 0.006, B - 0.006, -0.048], [0.012, 0.007, 0.01], STEEL);
box(RC, 'charging handle', [RW + 0.012, B - 0.006, -0.048], [0.004, 0.01, 0.016], STEEL);
// Behind the cover: the cover latch and the receiver's back plate where the stock bolts on.
box(RC, 'cover latch', [0, RTOP + 0.003, COVER_Z1 + 0.008], [0.02, 0.006, 0.012], STEEL);
box(RC, 'latch button', [0, RTOP + 0.003, COVER_Z1 + 0.0148], [0.008, 0.004, 0.002], PIN);
box(
  RC,
  'back plate',
  [0, (RTOP + RBOT) / 2, RZ1 - 0.003],
  [2 * RW + 0.0014, RTOP - RBOT + 0.001, 0.006],
  BAND,
);
// The ammo box's bracket under the receiver's front.
box(RC, 'box bracket', [0, RBOT - 0.002, MAG[2]], [2 * RW - 0.006, 0.004, 0.09], SLOT);

// ================= Feed cover over the receiver's front half, the rail along its top
ak.cover({ z0: RZ0 + 0.004, z1: COVER_Z1 });
// The cover's hinge at its front.
tubeX('dust cover', 'cover hinge', [0, RTOP + 0.002, RZ0 + 0.006], 0.0036, 2 * RW + 0.004, STEEL, {
  sides: 8,
});

// ================= Right rail: a short section low on the receiver's front
const RAIL_Y = B - 0.016;
const SIDE_RAIL_Z = [-0.132, -0.096];
const RAIL_X = ak.ar.sideRail({
  s: 1,
  x0: RW,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});

// ================= Barrel, gas system, carry handle
// The heavy barrel from the receiver to the muzzle, a thicker chamber run near the receiver.
tubeZ('barrel', 'barrel', B, RZ0 + 0.004, MUZZLE_Z - 0.002, BARREL_R, STEEL, { sides: 8 });
tubeZ('barrel', 'barrel chamber', B, RZ0 + 0.002, RZ0 - 0.06, BARREL_R + 0.0028, STEEL, {
  sides: 8,
});
tubeZ('barrel', 'barrel nut', B, RZ0 - 0.06, RZ0 - 0.066, BARREL_R + 0.0018, SLOT, { sides: 8 });
// The gas block round the barrel and the cylinder, the cylinder back to the receiver.
const GB = 'gas block';
extrudeZ(
  GB,
  'gas block',
  hull2d([...ring(0, B, 0.0118), ...ring(0, TUBE_Y, 0.0102)]),
  GZ[0],
  GZ[1],
  STEEL,
);
tubeX(GB, 'gas regulator', [0.0108, TUBE_Y, GZ[0] + 0.008], 0.0042, 0.006, BAND, { sides: 8 });
tubeZ(GB, 'gas cylinder', TUBE_Y, GZ[1] + 0.002, RZ0 + 0.002, 0.0074, STEEL, { sides: 8 });
for (const z of [-0.37, -0.3, -0.23])
  tubeZ(GB, 'cylinder vent', TUBE_Y - 0.0005, z, z - 0.012, 0.0077, SLOT, { sides: 8 });
// The carry handle, folded down along the barrel's right: a collar and a flat loop.
const CH = 'carry handle';
const CZ = RZ0 - 0.04;
tubeZ(CH, 'handle collar', B, CZ + 0.012, CZ - 0.012, BARREL_R + 0.0045, BAND, { sides: 10 });
box(CH, 'handle arm', [0.016, B + 0.004, CZ], [0.012, 0.006, 0.014], BAND);
box(CH, 'handle grip', [0.024, B + 0.001, CZ - 0.05], [0.007, 0.012, 0.1], POLY);
box(CH, 'handle tip', [0.023, B + 0.003, CZ - 0.1], [0.006, 0.006, 0.006], BAND);

// ================= The bipod: a yoke under the gas block, the legs folded back under the
// cylinder, their feet clear of the receiver.
const BP = 'bipod';
const BY = TUBE_Y - 0.0102;
box(BP, 'bipod yoke', [0, BY - 0.002, GZ[1] + 0.006], [0.022, 0.006, 0.02], BAND);
tubeX(BP, 'bipod pivot', [0, BY - 0.002, GZ[1] + 0.006], 0.0024, 0.026, PIN, { sides: 8 });
for (const s of [1, -1]) {
  tubeZ(BP, 'bipod leg', BY - 0.006, GZ[1] + 0.012, -0.29, 0.0034, STEEL, {
    x: s * 0.0075,
    sides: 6,
  });
  tubeZ(BP, 'bipod leg', BY - 0.006, -0.29, -0.215, 0.0028, POLY_HI, { x: s * 0.0075, sides: 6 });
  box(BP, 'bipod foot', [s * 0.0075, BY - 0.0065, -0.21], [0.008, 0.007, 0.012], RUBBER);
}

// ================= Front sight: a block on the barrel near the muzzle with the family's
// tower, ears and post (it stays under an optic).
ak.gasBlock({ z0: FRONT_Z - 0.012, z1: FRONT_Z + 0.012, TUBE_Y: B, FRONT_Z });

// ================= Flash hider (factory, hidden by a muzzle device): a cone flaring toward
// the muzzle, long slots round it, the bore at its end.
const M = { hiddenBy: 'muzzle' };
const FH_END = MUZZLE_Z - FH_L;
tubeZ('muzzle', 'flash hider collar', B, MUZZLE_Z + 0.002, MUZZLE_Z - 0.01, 0.0098, SLOT, {
  sides: 10,
  ...M,
});
add({
  type: 'cylinder',
  pos: v3([0, B, MUZZLE_Z - 0.01 - (FH_L - 0.01) / 2]),
  pitch: 90,
  radius: 0.0118, // the front (−z) end: the flare
  radiusTop: 0.0092,
  height: FH_L - 0.01,
  sides: 10,
  color: STEEL,
  name: 'flash hider',
  group: 'muzzle',
  ...M,
});
for (let i = 0; i < 5; i++) {
  const a = (i * 72 * Math.PI) / 180;
  const r = 0.0104;
  box(
    'muzzle',
    'flash hider slot',
    [r * Math.sin(a), B + r * Math.cos(a), FH_END + 0.022],
    [0.003, 0.0012, 0.03],
    BORE,
    {
      roll: -(i * 72),
      ...M,
    },
  );
}
add({
  type: 'panel',
  pos: v3([0, B, FH_END - 0.0003]),
  pitch: 90,
  points: roundOutline(8)(0.0072).map(v3),
  color: BORE,
  name: 'muzzle bore',
  group: 'muzzle',
  ...M,
});

// ================= Irons: the family's flat notch on a clamp at the cover rail's back.
const REAR_Z = COVER_Z1 - 0.012;
ak.railNotch({ REAR_Z });

// ================= Trigger group and grip (part of the gun: it has no grip slot).
ak.triggerGuard({ z0: GRIP_Z - 0.07, z1: GRIP_Z - 0.001 });
ak.pistolGrip({ z: GRIP_Z });

// ================= The skeletal stock: a comb along the top, a toe bar sloping down to the
// butt, a web at each end, the middle open; a rubber pad and a sling swivel.
const ST = 'stock';
const STOP = RTOP - 0.002; // the comb's top at the receiver
const SBOT = B - 0.112; // the butt's toe
const at = (pts, w = SW) => pts.map(([y, z]) => [y, z, w]);
prism(
  ST,
  'stock wrist',
  at(
    [
      [STOP, RZ1],
      [STOP - 0.001, RZ1 + 0.05],
      [RBOT + 0.004, RZ1 + 0.06],
      [RBOT + 0.008, RZ1],
    ],
    SW - 0.0012,
  ),
  POLY,
);
prism(
  ST,
  'stock comb',
  at([
    [STOP, RZ1 + 0.04],
    [STOP - 0.004, SZ1 - 0.05],
    [STOP - 0.021, SZ1 - 0.05],
    [STOP - 0.017, RZ1 + 0.04],
  ]),
  POLY,
);
prism(
  ST,
  'stock toe',
  at([
    [RBOT + 0.012, RZ1 + 0.04],
    [SBOT + 0.02, SZ1 - 0.05],
    [SBOT + 0.002, SZ1 - 0.05],
    [RBOT - 0.006, RZ1 + 0.05],
  ]),
  POLY,
);
prism(
  ST,
  'stock butt',
  at([
    [STOP - 0.004, SZ1 - 0.07],
    [STOP - 0.0045, SZ1],
    [SBOT, SZ1],
    [SBOT, SZ1 - 0.06],
  ]),
  POLY,
);
// A lighter edge along the comb's top, where the cheek rests.
prism(
  ST,
  'cheek rest',
  at(
    [
      [STOP + 0.0012, RZ1 + 0.06],
      [STOP - 0.003, SZ1 - 0.07],
      [STOP - 0.0055, SZ1 - 0.07],
      [STOP - 0.0015, RZ1 + 0.06],
    ],
    SW - 0.003,
  ),
  POLY_HI,
);
add({
  type: 'slab',
  pos: v3([0, (STOP - 0.0045 + SBOT) / 2, SZ1 + 0.006]),
  size: v3([2 * SW + 0.001, STOP - 0.0045 - SBOT, 0.012]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
});
tubeX(ST, 'sling swivel', [-(SW + 0.002), SBOT + 0.016, SZ1 - 0.03], 0.0045, 0.003, STEEL, {
  sides: 8,
});

// ---- Points and mounts
const model = {
  parts: parts.map(({ hiddenBy, ...p }) =>
    hiddenBy === 'grip' ? p : { ...p, ...(hiddenBy && { hiddenBy }) },
  ),
  grip: [0, RBOT - 0.046, GRIP_Z + 0.022],
  support: [0, TUBE_Y - 0.008, -0.235],
  muzzle: [0, B, FH_END - 0.0015],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.0],
    muzzle: [0, B, MUZZLE_Z],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    magazine: MAG,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
