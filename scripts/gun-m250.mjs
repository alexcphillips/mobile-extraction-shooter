// The M250's model (GM-5b): a belt-fed 6.8 mm light machine gun. What makes it read as
// itself: a tall, square receiver whose top is the feed cover, one unbroken rail from the
// cover's back to the handguard's front; a long square handguard with M-LOK slots and short
// rail sections; the belt pouch hanging under the receiver's front on the left; an AR-pattern
// lower and grip with no magazine well; a three-prong flash hider; and the folding, sliding
// stock on a hinge block at the receiver's back. It takes AR grips and stocks by name (the
// user's call, not the `ar15` platform): a fitted stock goes on the hinge block in the
// factory stock's place, the front of the tube it brings hidden inside the receiver. The
// grip, rail runs and flip-up irons come from gun-ar15.mjs. Replaces only `model` in its
// item file. See docs/guns.md.
//
//   node scripts/gun-m250.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/m250.json', import.meta.url).pathname;
const { REC, SLOT, HG, POLY, POLY_HI, STEEL, RUBBER, PIN, BORE } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height (the AR grips' and stocks' frame assumes it)
const RAIL_BASE = 0.045;
const TEETH_Y0 = 0.0502;
const RAIL_TOP = 0.055; // top of the teeth: the optic mount's height
const RAIL_W = 0.0215;
const UZ0 = -0.122; // the receiver's front, where the handguard meets it
const UZ1 = 0.132; // the receiver's back, where the hinge block sits
const UW = 0.0245; // the receiver's half width
const UBOT = -0.013; // the receiver's bottom ahead of the lower: the belt pouch hangs here
const COVER_Y = 0.029; // the feed cover's seam along the receiver's sides
const LZ0 = -0.004; // the lower's front
const HZ0 = -0.41; // handguard front
const HW = 0.0265; // handguard half width
const HTOP = RAIL_BASE + 0.0005;
const HBOT = -0.021;
const MUZZLE_Z = -0.452; // where a muzzle device threads on
const FH_L = 0.056; // the factory flash hider's length
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const REAR_Z = UZ1 - 0.024;
const FRONT_Z = HZ0 + 0.022;
const MAG = [0, UBOT, -0.062]; // the belt pouch's mount, under the receiver's front
const STOCK = [0, B, UZ1 + 0.018]; // the hinge block's back, on the bore's line like a buffer tube
const SZ1 = 0.335; // the factory butt's back
const SIDE_RAIL_Z = [-0.372, -0.33];
const FG_Z = [-0.31, -0.2]; // the bottom rail

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });

// ================= Receiver: a tall square box, the feed cover its top half, the seam and
// hinge pin showing; the belt's feed window on the left, the charging handle forward on the
// left, the ejection chute under the cover's front.
const RC = 'receiver';
extrudeZ(
  RC,
  'receiver',
  [
    [-UW, UBOT],
    [UW, UBOT],
    [UW, RAIL_BASE - 0.005],
    [UW - 0.0055, RAIL_BASE + 0.0005],
    [-UW + 0.0055, RAIL_BASE + 0.0005],
    [-UW, RAIL_BASE - 0.005],
  ],
  UZ0,
  UZ1,
  REC,
);
for (const s of [1, -1]) {
  box(
    RC,
    'cover seam',
    [s * (UW + 0.0002), COVER_Y, (UZ0 + UZ1) / 2 - 0.004],
    [0.0006, 0.0012, UZ1 - UZ0 - 0.012],
    SLOT,
  );
  tubeX(RC, 'takedown pin', [s * (UW + 0.0003), 0.0, UZ1 - 0.014], 0.0026, 0.0008, PIN, {
    sides: 8,
  });
}
tubeX(RC, 'cover hinge', [0, COVER_Y + 0.002, UZ0 + 0.008], 0.0034, 2 * UW + 0.003, STEEL, {
  sides: 8,
});
// The cover latch at the back, a lighter button on each side.
for (const s of [1, -1])
  box(
    RC,
    'cover latch',
    [s * (UW + 0.0008), COVER_Y + 0.008, UZ1 - 0.012],
    [0.0016, 0.008, 0.012],
    PIN,
  );
// The belt comes in on the left under the cover, through a window over the pouch.
box(RC, 'feed window', [-(UW + 0.0003), COVER_Y - 0.008, -0.062], [0.0008, 0.012, 0.06], SLOT);
box(RC, 'feed tray lip', [-(UW + 0.0007), COVER_Y - 0.0145, -0.062], [0.0012, 0.0014, 0.062], PIN);
// The links go out on the right.
box(RC, 'link port', [UW + 0.0003, COVER_Y - 0.008, -0.062], [0.0008, 0.009, 0.04], SLOT);
// The charging handle in its slot on the left.
box(RC, 'charging slot', [-(UW + 0.0003), 0.008, -0.02], [0.0008, 0.0055, 0.13], SLOT);
box(RC, 'charging handle', [-(UW + 0.006), 0.008, -0.078], [0.012, 0.007, 0.01], STEEL);
box(RC, 'charging handle', [-(UW + 0.012), 0.008, -0.078], [0.004, 0.011, 0.016], STEEL);
// The pouch's bracket under the receiver's front.
box(RC, 'pouch bracket', [0, UBOT - 0.0015, MAG[2]], [2 * UW - 0.008, 0.003, 0.1], SLOT);

// ================= One rail along the cover and the handguard
ar.topRail({ name: 'top rail', z0: HZ0 + 0.003, z1: UZ1 - 0.003 });

// ================= Handguard: a long square tube with chamfered corners, M-LOK slots, short
// rail sections on the right and underneath.
const HAND = 'handguard';
extrudeZ(HAND, 'handguard', octagon(HW, HTOP, HBOT, 0.008), HZ0, UZ0 + 0.002, HG);
extrudeZ(
  HAND,
  'handguard end cap',
  octagon(HW + 0.0006, HTOP + 0.0004, HBOT - 0.0006, 0.008),
  HZ0 - 0.0015,
  HZ0 + 0.004,
  SLOT,
);
for (const s of [1, -1])
  for (const z of [-0.29, -0.245, -0.2, -0.155])
    box(HAND, 'm-lok slot', [s * (HW + 0.0002), 0.012, z], [0.001, 0.0075, 0.032], SLOT);
box(HAND, 'm-lok slot', [-(HW + 0.0002), 0.012, -0.351], [0.001, 0.0075, 0.032], SLOT);
for (const z of [-0.375, -0.155])
  box(HAND, 'm-lok slot', [0, HBOT - 0.0002, z], [0.009, 0.001, 0.032], SLOT);
const RAIL_Y = 0.012;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: HW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: HG,
});
const FOREGRIP_Y = ar.bottomRail({ bot: HBOT, z0: FG_Z[0], z1: FG_Z[1], color: HG });
tubeX(HAND, 'sling cup', [-(HW + 0.0015), 0.012, -0.135], 0.0055, 0.004, SLOT, { sides: 6 });

// ================= Barrel and the three-prong flash hider (factory, hidden by a muzzle device)
tubeZ('barrel', 'barrel', B, HZ0 + 0.004, MUZZLE_Z - 0.002, 0.0092, STEEL, { sides: 8 });
const M = { hiddenBy: 'muzzle' };
const FH_END = MUZZLE_Z - FH_L;
tubeZ('muzzle', 'flash hider collar', B, MUZZLE_Z + 0.002, MUZZLE_Z - 0.012, 0.0102, SLOT, {
  sides: 10,
  ...M,
});
tubeZ('muzzle', 'flash hider', B, MUZZLE_Z - 0.012, FH_END, 0.0108, STEEL, { sides: 9, ...M });
for (let i = 0; i < 3; i++) {
  const a = ((i * 120 + 60) * Math.PI) / 180;
  const r = 0.0101;
  box(
    'muzzle',
    'flash hider slot',
    [r * Math.sin(a), B + r * Math.cos(a), FH_END + 0.016],
    [0.0028, 0.0016, 0.032],
    BORE,
    {
      roll: -(i * 120 + 60),
      ...M,
    },
  );
}
add({
  type: 'panel',
  pos: v3([0, B, FH_END - 0.0003]),
  pitch: 90,
  points: roundOutline(9)(0.0068).map(v3),
  color: BORE,
  name: 'muzzle bore',
  group: 'muzzle',
  ...M,
});

// ================= Lower: the AR lower's outline with no magazine well, its trigger guard
// and controls; the AR pistol grip (factory, hidden by a fitted grip).
const LW = 0.027;
const LO = 'lower receiver';
prism(
  LO,
  'lower receiver',
  [
    [UBOT + 0.0005, LZ0],
    [UBOT + 0.0005, 0.128],
    [-0.014, 0.132],
    [-0.025, 0.126],
    [-0.0305, 0.106],
    [-0.0305, 0.012],
    [-0.024, LZ0],
  ].map(([y, z]) => [y, z, LW / 2]),
  REC,
);
box(LO, 'trigger guard', [0, -0.048, 0.048], [0.011, 0.004, 0.07], REC);
box(LO, 'trigger guard front', [0, -0.039, 0.0155], [0.011, 0.018, 0.005], REC);
box(LO, 'trigger', [0, -0.039, 0.044], [0.005, 0.016, 0.005], STEEL, { pitch: -18 });
box(LO, 'selector', [-(LW / 2 + 0.001), -0.019, 0.1], [0.002, 0.005, 0.018], PIN, { pitch: 25 });
tubeX(LO, 'selector hub', [-(LW / 2 + 0.0005), -0.019, 0.1], 0.004, 0.002, STEEL);
tubeX(LO, 'rear pin', [0, -0.02, 0.118], 0.0026, LW + 0.0016, PIN);
const GRIP_MOUNT = [0, -0.0305, 0.083];
ar.pistolGrip({});

// ================= Hinge block (stays: the stock mount) and the folding, sliding factory
// stock (hidden by a fitted stock): a short tube, a sleeve with a cheek riser, a deep butt
// with a toe strut, a rubber pad.
const HB = 'hinge block';
extrudeZ(
  HB,
  'hinge block',
  octagon(0.0175, B + 0.022, B - 0.024, 0.004),
  UZ1 - 0.001,
  STOCK[2],
  POLY,
);
add({
  type: 'cylinder',
  pos: v3([0.019, B, STOCK[2] - 0.006]),
  radius: 0.0035,
  height: 0.042,
  color: STEEL,
  sides: 6,
  name: 'hinge knuckle',
  group: HB,
});
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ0 = STOCK[2];
const SL0 = SZ1 - 0.11; // the sleeve's front
tubeZ(ST, 'stock tube', B, SZ0, SL0 + 0.01, 0.0125, STEEL, { sides: 8, ...hide });
extrudeZ(
  ST,
  'stock sleeve',
  [
    [-0.0125, B - 0.019],
    [0.0125, B - 0.019],
    [0.0165, B - 0.014],
    [0.0165, B + 0.017],
    [0.0125, B + 0.021],
    [-0.0125, B + 0.021],
    [-0.0165, B + 0.017],
    [-0.0165, B - 0.014],
  ],
  SL0,
  SZ1 - 0.002,
  POLY,
  hide,
);
prism(
  ST,
  'cheek riser',
  [
    [B + 0.0205, SL0 + 0.012],
    [B + 0.029, SL0 + 0.03],
    [B + 0.029, SZ1 - 0.006],
    [B + 0.0205, SZ1 - 0.006],
  ].map(([y, z]) => [y, z, 0.0128]),
  POLY_HI,
  hide,
);
prism(
  ST,
  'stock butt',
  [
    [B - 0.018, SZ1 - 0.045],
    [B - 0.018, SZ1 - 0.002],
    [B - 0.112, SZ1 - 0.002],
    [B - 0.108, SZ1 - 0.022],
  ].map(([y, z]) => [y, z, 0.0165]),
  POLY,
  hide,
);
prism(
  ST,
  'stock strut',
  [
    [B - 0.017, SL0 + 0.004],
    [B - 0.017, SL0 + 0.018],
    [B - 0.098, SZ1 - 0.02],
    [B - 0.1, SZ1 - 0.036],
  ].map(([y, z]) => [y, z, 0.0062]),
  POLY,
  hide,
);
box(ST, 'adjustment lever', [0, B - 0.0195, SL0 + 0.02], [0.008, 0.004, 0.024], SLOT, hide);
add({
  type: 'slab',
  pos: v3([0, (B + 0.029 + B - 0.112) / 2, SZ1 + 0.0055]),
  size: v3([0.034, 0.029 + 0.112, 0.011]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});

// ================= Iron sights: the family's flip-ups on the rail (the rear hidden by an
// optic, the front stays).
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.068, 0.112],
  support: [0, HBOT - 0.006, -0.25],
  muzzle: [0, B, FH_END - 0.0015],
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
