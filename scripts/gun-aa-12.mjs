// The AA-12's model (GM-7a): a 12-gauge automatic shotgun. What makes it read as itself: a
// tall, boxy receiver with a long flat top, a ventilated shroud round the barrel almost to the
// muzzle, a deep magazine well ahead of the trigger, an AR-style pistol grip and a straight-
// line stock in one piece with the receiver's back. Optics go on the rail along the receiver's
// top; bare it aims with the family's flip-ups, the rear on that rail and the front on a short
// rail section on a riser at the shroud's front, so it stays with any barrel. A barrel mounts
// at the shroud's front, the factory barrel the short run ahead of it. No stock slot: nothing
// fits it. Barrels come from barrels-shotgun.mjs; rails, grip and irons from gun-ar15.mjs.
// Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-aa-12.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { SG, shotgunBarrel } from './gun-shotgun.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/aa-12.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, STEEL, RUBBER, PIN, BORE } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RT = B + 0.034; // the receiver's top
const RB = B - 0.038; // its bottom
const RW = 0.0255; // its half width
const RZ0 = -0.15; // its front, where the shroud starts
const RZ1 = 0.132; // its back, where the stock starts
const RAIL_BASE = RT - 0.0005;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048;
const RAIL_W = 0.0215;
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const HZ0 = -0.43; // the shroud's front: the barrel mount
const SR = 0.0215; // the shroud's radius
const MUZZLE_Z = -0.47; // the factory barrel's end
const MAG = [0, RB, -0.07]; // the magazine well's mouth
const SZ1 = 0.395; // the butt's back, the pad's front
const REAR_Z = RZ1 - 0.024;
const FRONT_Z = HZ0 + 0.018;

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const at = (pts, w) => pts.map(([y, z]) => [y, z, w]);

// ================= Receiver: a tall box, its top edges chamfered under the rail, a seam where
// the top half meets the bottom, the ejection port on the right, the charging handle forward
// on the left, pins.
const RC = 'receiver';
extrudeZ(
  RC,
  'receiver',
  [
    [-RW, RB + 0.006],
    [-RW + 0.006, RB],
    [RW - 0.006, RB],
    [RW, RB + 0.006],
    [RW, RT - 0.006],
    [RW - 0.006, RT],
    [-RW + 0.006, RT],
    [-RW, RT - 0.006],
  ],
  RZ0,
  RZ1,
  REC,
);
for (const s of [1, -1]) {
  box(
    RC,
    'receiver seam',
    [s * (RW + 0.0002), B + 0.002, (RZ0 + RZ1) / 2],
    [0.0006, 0.0012, RZ1 - RZ0 - 0.012],
    SLOT,
  );
  for (const z of [RZ0 + 0.016, 0.02, RZ1 - 0.016])
    tubeX(RC, 'pin', [s * (RW + 0.0003), B - 0.016, z], 0.0024, 0.0008, PIN, { sides: 6 });
}
box(RC, 'ejection port', [RW + 0.0003, B + 0.012, -0.02], [0.0008, 0.016, 0.062], SLOT);
box(RC, 'charging slot', [-(RW + 0.0003), B + 0.018, -0.04], [0.0008, 0.005, 0.15], SLOT);
box(RC, 'charging handle', [-(RW + 0.006), B + 0.018, -0.1], [0.012, 0.007, 0.012], STEEL);
box(RC, 'charging handle', [-(RW + 0.012), B + 0.018, -0.1], [0.004, 0.012, 0.018], STEEL);
box(RC, 'selector', [-(RW + 0.001), RB + 0.008, 0.1], [0.002, 0.005, 0.016], PIN, { pitch: 25 });

// ================= Rail along the top
ar.topRail({ name: 'top rail', z0: RZ0 + 0.008, z1: RZ1 - 0.006 });
const RAIL_Y = B - 0.006;
const SIDE_RAIL_Z = [RZ0 + 0.006, RZ0 + 0.048];
const RAIL_X = ar.sideRail({
  s: 1,
  x0: RW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});

// ================= Magazine well ahead of the trigger
prism(
  RC,
  'magazine well',
  [
    [RB + 0.002, -0.118, RW - 0.004],
    [RB + 0.002, -0.02, RW - 0.004],
    [RB - 0.012, -0.022, RW - 0.002],
    [RB - 0.012, -0.116, RW - 0.002],
  ],
  REC,
);
box(RC, 'magazine well mouth', [0, RB - 0.0123, MAG[2]], [2 * RW - 0.012, 0.001, 0.09], SLOT);
box(RC, 'magazine catch', [0, RB - 0.008, -0.0185], [0.014, 0.008, 0.004], STEEL);

// ================= The ventilated shroud round the barrel, its front ring, rows of vents
const SH = 'shroud';
tubeZ(SH, 'shroud', B, RZ0 + 0.002, HZ0, SR, STEEL, { sides: 12 });
tubeZ(SH, 'shroud cap', B, HZ0 + 0.012, HZ0 - 0.002, SR + 0.0015, SG.BAND, { sides: 12 });
for (let i = 0; i < 6; i++)
  for (const a of [-60, 0, 60, 120, 180, 240]) {
    if (a === 0) continue; // the top stays solid under the riser's line
    const r = (a * Math.PI) / 180;
    box(
      SH,
      'shroud vent',
      [(SR + 0.0002) * Math.sin(r), B + (SR + 0.0002) * Math.cos(r), RZ0 - 0.04 - i * 0.04],
      [0.006, 0.001, 0.02],
      BORE,
      {
        roll: -a,
      },
    );
  }
// The riser at the shroud's front carrying a short rail for the front sight.
prism(
  SH,
  'sight riser',
  [
    [B + SR - 0.004, HZ0 + 0.002, 0.009],
    [B + SR - 0.004, HZ0 + 0.034, 0.009],
    [RAIL_BASE + 0.0005, HZ0 + 0.03, 0.0095],
    [RAIL_BASE + 0.0005, HZ0 + 0.004, 0.0095],
  ],
  SG.BAND,
);
ar.topRail({ name: 'front rail', z0: HZ0 + 0.004, z1: HZ0 + 0.032 });

// ================= The factory barrel: the short run ahead of the shroud (hidden by a barrel)
shotgunBarrel(kit, {
  z0: MUZZLE_Z,
  z1: HZ0,
  y: B,
  rib: false,
  bead: false,
  extra: { hiddenBy: 'barrel' },
});

// ================= Grip and trigger (part of the gun: no grip slot)
ar.pistolGrip({});
const TG = 'trigger';
box(TG, 'trigger guard', [0, RB - 0.022, 0.05], [0.011, 0.004, 0.066], REC);
box(TG, 'trigger guard front', [0, RB - 0.011, 0.019], [0.011, 0.02, 0.005], REC);
box(TG, 'trigger', [0, RB - 0.012, 0.045], [0.005, 0.016, 0.005], STEEL, { pitch: -18 });

// ================= The straight-line stock in one with the receiver's back, a lighter cheek
// rest, a rubber pad, a sling loop.
const ST = 'stock';
prism(
  ST,
  'stock',
  at(
    [
      [RT - 0.002, RZ1 - 0.002],
      [RT - 0.008, SZ1],
      [B - 0.104, SZ1],
      [B - 0.096, SZ1 - 0.06],
      [RB + 0.004, RZ1 + 0.06],
      [RB + 0.006, RZ1 - 0.002],
    ],
    RW - 0.004,
  ),
  POLY,
);
prism(
  ST,
  'cheek rest',
  at(
    [
      [RT - 0.0015, RZ1 + 0.05],
      [RT - 0.0065, SZ1 - 0.016],
      [RT - 0.014, SZ1 - 0.016],
      [RT - 0.009, RZ1 + 0.05],
    ],
    RW - 0.0025,
  ),
  POLY_HI,
);
add({
  type: 'slab',
  pos: v3([0, (RT - 0.008 + B - 0.104) / 2, SZ1 + 0.007]),
  size: v3([2 * RW - 0.008, RT - 0.008 - (B - 0.104), 0.014]),
  corners: [0.005, 0.005, 0.005, 0.005],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
});
tubeX(ST, 'sling loop', [-(RW - 0.002), B - 0.08, SZ1 - 0.03], 0.0042, 0.003, STEEL, { sides: 8 });

// ================= Iron sights: the rear flip-up on the top rail (hidden by an optic), the
// front on the riser's rail (stays).
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts: parts.map(({ hiddenBy, ...p }) =>
    hiddenBy === 'grip' ? p : { ...p, ...(hiddenBy && { hiddenBy }) },
  ),
  grip: [0, -0.068, 0.112],
  support: [0, B - SR - 0.004, -0.3],
  muzzle: [0, B, MUZZLE_Z],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.04],
    muzzle: [0, B, MUZZLE_Z],
    barrel: [0, B, HZ0],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    magazine: MAG.map((v, i) => (i === 1 ? v - 0.012 : v)),
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
