// The ADAR's model (GM-2): a plain civilian AR-15. What sets it apart from the M416 is what
// a budget rifle carries: a round, ribbed two-piece carbine handguard behind a delta ring, a
// triangular A2-style front sight base on the barrel at the gas port, a long exposed barrel,
// an A2 grip with its finger nub and a fixed rifle stock. The family's common parts come
// from gun-ar15.mjs. Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-adar.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, r5, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { coreOutline, roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/adar.json', import.meta.url).pathname;
const { REC, SLOT, HG, POLY, POLY_HI, STEEL, RUBBER, PIN, SIGHT_BODY, SIGHT_LIP } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RAIL_BASE = 0.04;
const RAIL_TOP = 0.05; // top of the teeth: the optic mount's height
const TEETH_Y0 = 0.0452;
const RAIL_W = 0.0215;
const UZ0 = -0.068; // upper receiver front
const UZ1 = 0.124; // upper receiver rear
const UW = 0.0285;
// The round handguard: an oval tube round the barrel from the delta ring to its front cap.
const HZ0 = -0.252; // handguard front (its cap)
const HZ1 = -0.08; // handguard rear (into the delta ring)
const HR = [0.0205, 0.0222]; // its half width and half height
const HY = B + 0.0015; // its center, a little over the bore (the heat shield is under the barrel)
const HBOT = HY - HR[1];
// The front sight base (FSB) clamps the barrel at the gas port, just ahead of the handguard.
const FSB_Z = -0.274; // its center
const FSB_L = 0.03; // its length along the barrel
const MUZZLE_Z = -0.42; // a 16-inch barrel: where a muzzle device threads on
// Iron sight line: the same height over the rail as the M416's, so optics and irons line up
// alike across the family. The A2 base's post rises to it.
const SIGHT_Y = RAIL_TOP + 0.024;
const REAR_Z = 0.108;
const MAG = [0, -0.052, -0.022]; // magazine mount: the magwell's mouth
const TUBE_Y = 0.012; // buffer tube axis
const STOCK = [0, TUBE_Y, 0.18];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

// ================= Upper receiver and its rail (the only rail on top: the handguard is round)
ar.upper({ UZ0, UZ1, UW });
ar.topRail({ name: 'top rail', z0: UZ0 + 0.004, z1: UZ1 - 0.003 });

// ================= Delta ring, handguard and its rail panels
const HAND = 'handguard';
const oval = (rx, ry, n = 16) => roundOutline(n)(1).map(([x, y]) => [x * rx, HY + y * ry]);
// The barrel nut's collar in front of the upper, then the delta ring that holds the
// handguard's back: a flared ring, stepped so it reads from the side.
tubeZ(HAND, 'barrel nut', B, UZ0 + 0.001, UZ0 - 0.006, 0.0165, STEEL, { sides: 12 });
extrudeZ(
  HAND,
  'delta ring',
  oval(HR[0] + 0.0028, HR[1] + 0.0022, 12),
  UZ0 - 0.006,
  HZ1 + 0.004,
  REC,
);
extrudeZ(HAND, 'slip ring', oval(HR[0] + 0.0036, HR[1] + 0.003, 12), HZ1 + 0.004, HZ1 - 0.004, REC);
// The handguard: one oval tube, its two halves' seam and lengthwise ribs as dark grooves.
extrudeZ(HAND, 'handguard', oval(HR[0], HR[1]), HZ0 + 0.004, HZ1 - 0.003, HG);
// The front cap: a ring a step out from the handguard, darker.
extrudeZ(HAND, 'handguard cap', oval(HR[0] + 0.0012, HR[1] + 0.0012), HZ0, HZ0 + 0.006, REC);
// Ribs: grooves at fixed angles round the oval, along the handguard between its ends.
const ribAngles = [45, 90, 135]; // degrees from straight up, each side
const RIB_Z = [HZ0 + 0.012, HZ1 - 0.012];
for (const s of [1, -1])
  for (const a of ribAngles) {
    const rad = (a * Math.PI) / 180;
    const x = Math.sin(rad) * (HR[0] + 0.0002);
    const y = HY + Math.cos(rad) * (HR[1] + 0.0002);
    // The groove lies along the surface: rolled to the surface's slope at that angle.
    const slope = (Math.atan2(HR[1] * Math.sin(rad), HR[0] * Math.cos(rad)) * 180) / Math.PI;
    box(
      HAND,
      'handguard rib groove',
      [s * x, y, (RIB_Z[0] + RIB_Z[1]) / 2],
      [0.0012, 0.0008, RIB_Z[1] - RIB_Z[0]],
      SLOT,
      {
        roll: r5(s * (90 - slope)),
      },
    );
  }
// The seam between the halves, along each side at the bore's height.
for (const s of [1, -1])
  box(
    HAND,
    'handguard seam',
    [s * (HR[0] + 0.0002), HY, (HZ0 + HZ1) / 2],
    [0.0008, 0.0012, HZ1 - HZ0 - 0.008],
    SLOT,
  );
// Rail panels clamped onto the handguard: a short section on the right for a rail item, one
// underneath for a foregrip. Their bases sit on flat pads over the round.
const SIDE_RAIL_Z = [-0.232, -0.19];
const RAIL_X = ar.sideRail({
  s: 1,
  x0: HR[0] - 0.0012,
  y: HY,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});
const BOT_RAIL_Z = [-0.236, -0.15];
const FOREGRIP_Y = ar.bottomRail({
  bot: HBOT + 0.0012,
  z0: BOT_RAIL_Z[0],
  z1: BOT_RAIL_Z[1],
  color: REC,
});
for (const [z0, z1] of [SIDE_RAIL_Z, BOT_RAIL_Z])
  for (const z of [z0 + 0.004, z1 - 0.004])
    tubeZ(HAND, 'rail panel band', HY, z - 0.0015, z + 0.0015, HR[0] + 0.0012, REC, { sides: 8 });

// ================= Barrel (stays: no barrel slot), A2 front sight base, flash hider
tubeZ('barrel', 'barrel', B, HZ0 + 0.004, MUZZLE_Z - 0.002, 0.0085, STEEL, { sides: 8 });
// A step down in the barrel's profile ahead of the base (the carbine's cut), so it doesn't
// read as a plain rod.
tubeZ(
  'barrel',
  'barrel step',
  B,
  FSB_Z - FSB_L / 2 - 0.0005,
  FSB_Z - FSB_L / 2 - 0.03,
  0.0092,
  STEEL,
  { sides: 8 },
);
ar.birdcage({ B, MUZZLE_Z });

// ---- The front sight base: a block round the barrel, a tower tapering up to the sight
// line, its two protective ears either side of a square post, a bayonet lug and a sling
// swivel under it. It's part of the gun and stays under an optic, low in its window.
const FS = 'front sight base';
const FZ0 = FSB_Z - FSB_L / 2;
const FZ1 = FSB_Z + FSB_L / 2;
// The block: a rounded square round the barrel.
extrudeZ(
  FS,
  'front sight block',
  rounded(
    [
      [-0.0098, B - 0.0108],
      [0.0098, B - 0.0108],
      [0.0098, B + 0.0098],
      [-0.0098, B + 0.0098],
    ],
    0.0016,
  ),
  FZ0,
  FZ1,
  REC,
);
// The tower, from the block up: from the side its front slopes back and its rear forward,
// meeting at the ears' foot; from behind it narrows a little.
const EAR_FOOT = SIGHT_Y - 0.0125; // where the ears rise from (the floor under the post)
const TZ = [FSB_Z - 0.0052, FSB_Z + 0.0036]; // the tower's top front and rear
prism(
  FS,
  'front sight tower',
  [
    [B + 0.0105, FZ0 + 0.003, 0.0085],
    [B + 0.0105, FZ1 - 0.002, 0.0085],
    [EAR_FOOT, TZ[1], 0.0062],
    [EAR_FOOT, TZ[0], 0.0062],
  ],
  REC,
);
// The ears: one piece with the tower, rising either side of the post, their tops rounded
// and their inner edges chamfered. Thick enough to read at the front's distance.
const EAR = { in: 0.0043, out: 0.0071, top: SIGHT_Y + 0.0036 };
for (const s of [1, -1]) {
  const core = [
    [EAR.in, EAR_FOOT - 0.001],
    [EAR.out, EAR_FOOT - 0.002],
    [EAR.out - 0.0008, EAR.top - 0.001],
    [EAR.in + 0.0006, EAR.top - 0.001],
    [EAR.in, EAR.top - 0.0035],
  ].map(([x, y]) => [s * x, y]);
  extrudeZ(
    FS,
    'front sight ear',
    rounded(s > 0 ? core : [...core].reverse(), 0.0006),
    TZ[0] + 0.0004,
    TZ[1] - 0.0004,
    REC,
  );
}
// The floor between the ears, a lighter lip on its face toward the eye.
box(
  FS,
  'front sight floor',
  [0, EAR_FOOT - 0.0004, FSB_Z - 0.0008],
  [2 * EAR.in + 0.0008, 0.0024, TZ[1] - TZ[0] - 0.001],
  REC,
);
// The post: square, its top on the sight line, a lighter detent under it on the rear face.
box(
  FS,
  'front sight post',
  [0, (EAR_FOOT + SIGHT_Y) / 2, FSB_Z - 0.0008],
  [0.0024, SIGHT_Y - EAR_FOOT, 0.0024],
  SIGHT_BODY,
);
box(
  FS,
  'front sight detent',
  [0, EAR_FOOT + 0.0012, TZ[1] - 0.0003],
  [0.0028, 0.0018, 0.0006],
  SIGHT_LIP,
);
// Two taper pins through the block, and the gas port's dark tube line under the tower.
for (const z of [FZ0 + 0.007, FZ1 - 0.007])
  tubeX(FS, 'front sight pin', [0, B + 0.0055, z], 0.0011, 0.0204, PIN, { sides: 6 });
// The bayonet lug under the block, and the sling swivel behind it: a loop on a stud.
box(FS, 'bayonet lug', [0, B - 0.0145, FSB_Z - 0.004], [0.0066, 0.0075, 0.016], REC);
box(FS, 'swivel stud', [0, B - 0.0125, FZ1 - 0.0045], [0.0045, 0.004, 0.006], REC);
for (const [y, z, h, l] of [
  [B - 0.0195, FZ1 - 0.0095, 0.0115, 0.0016],
  [B - 0.0195, FZ1 + 0.0005, 0.0115, 0.0016],
  [B - 0.0245, FZ1 - 0.0045, 0.0016, 0.0116],
])
  box(FS, 'sling swivel', [0, y, z], [0.0026, h, l], STEEL);

// ================= Lower receiver and the A2 grip (factory, hidden by a fitted grip)
ar.lower({ UZ0, MAG });
const GRIP_MOUNT = [0, -0.0305, 0.083];
ar.pistolGrip({ swell: true });

// ================= The rifle's buffer tube (stays) and the fixed stock round it
ar.bufferTube({ TUBE_Y, castleNut: false });
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ0 = 0.1335; // the stock's front, against the lower's tang
const SZ1 = 0.352; // the butt plate's face
// The body: straight along the top, the bottom line falling to the toe, a little wider at
// the butt. Two hulls (front and back halves) so it widens along its length.
const top = (z) => 0.029 + (z - SZ0) * 0.02; // the comb rises a touch toward the butt
const bot = (z) => -0.009 - (z - SZ0) * 0.33;
const half = (z) => 0.0158 + (z - SZ0) * 0.016;
const ZM = 0.25;
prism(
  ST,
  'stock',
  [
    [top(SZ0), SZ0, half(SZ0)],
    [top(ZM), ZM, half(ZM)],
    [bot(ZM), ZM, half(ZM)],
    [bot(SZ0) + 0.004, SZ0, half(SZ0)],
    [(top(SZ0) + bot(SZ0)) / 2, SZ0 - 0.0015, half(SZ0) - 0.002],
  ],
  POLY,
  hide,
);
prism(
  ST,
  'stock',
  [
    [top(ZM), ZM, half(ZM)],
    [top(SZ1), SZ1, half(SZ1)],
    [bot(SZ1), SZ1, half(SZ1)],
    [bot(ZM), ZM, half(ZM)],
  ],
  POLY,
  hide,
);
// A lighter strip along the comb so the stock's top line reads, and the seam where its two
// halves were molded, dark along each side.
box(
  ST,
  'stock comb',
  [0, top((SZ0 + SZ1) / 2) + 0.0004, (SZ0 + SZ1) / 2 + 0.004],
  [0.017, 0.0012, SZ1 - SZ0 - 0.02],
  POLY_HI,
  {
    pitch: r5((-Math.atan(0.02) * 180) / Math.PI),
  },
);
// The butt plate: a ribbed plate with a trap door, a step from the stock.
add({
  type: 'slab',
  pos: v3([0, (top(SZ1) + bot(SZ1)) / 2, SZ1 + 0.005]),
  size: v3([2 * half(SZ1) + 0.001, top(SZ1) - bot(SZ1) + 0.001, 0.01]),
  corners: [0.004, 0.004, 0.006, 0.006],
  segments: 2,
  color: RUBBER,
  name: 'butt plate',
  group: ST,
  ...hide,
});
for (const y of [-0.06, -0.072, -0.084])
  box(
    ST,
    'butt plate rib',
    [0, y, SZ1 + 0.0102],
    [2 * half(SZ1) - 0.006, 0.002, 0.0006],
    SLOT,
    hide,
  );
box(ST, 'trap door', [0, -0.025, SZ1 + 0.0103], [0.022, 0.03, 0.0006], STEEL, hide);
// The rear sling swivel under the toe.
box(ST, 'swivel stud', [0, bot(0.322) - 0.002, 0.322], [0.006, 0.006, 0.01], REC, {
  ...hide,
  pitch: -20,
});
for (const [y, z, h, l] of [
  [-0.0035, -0.004, 0.0105, 0.0016],
  [-0.0035, 0.0068, 0.0105, 0.0016],
  [-0.008, 0.0014, 0.0016, 0.0124],
])
  box(ST, 'sling swivel', [0, bot(0.322) - 0.004 + y, 0.322 + z], [0.0026, h, l], STEEL, hide);

// ================= Iron sights: the flip-up rear peep (hidden by an optic); the front is
// the A2 base's post above.
ar.flipRear({ SIGHT_Y, REAR_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.068, 0.112],
  support: [0, HBOT - 0.006, -0.17],
  muzzle: [0, B, MUZZLE_Z - 0.046],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.07],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, -0.19],
    rightRail: [RAIL_X, HY, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    grip: GRIP_MOUNT,
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
