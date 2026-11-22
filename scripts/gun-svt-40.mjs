// The SVT-40's model (GM-6b), built from the gun kit, the ak kit's notch and front post (the
// user's call: these rifles take optics and irons the ak family's way), the bolt-action
// kit's ported brake and the wood-stock pieces (gun-wood.mjs). What makes it read as itself:
// a long slim stock, a vented sheet-steel handguard over the gas piston, a big six-port
// brake, two bands, a cleaning rod down the right side and a detachable magazine. Its open
// receiver has no top of its own, so optics go on a rail bridging it on two feet (as the
// mp5's claw rail bridges its receiver), the notch at the rail's back. Replaces only `model`
// in its item file. See docs/guns.md.
//
//   node scripts/gun-svt-40.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { AK, akPieces, akRail, hull2d } from './gun-ak.mjs';
import { boltPieces } from './gun-bolt.mjs';
import { roundOutline } from './optic-kit.mjs';
import { woodPieces } from './gun-wood.mjs';

const FILE = new URL('../content/items/svt-40.json', import.meta.url).pathname;
const { REC, SLOT, POLY, PIN, STEEL, BAND } = AK;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RW = 0.0135; // receiver half width
const RTOP = B + 0.011; // receiver walls' top
const RBOT = B - 0.024; // receiver bottom, inside the stock
const RZ0 = -0.095; // receiver front
const RZ1 = 0.12; // receiver rear: the wrist's front
const RSB = [RZ0 - 0.05, RZ0 + 0.002]; // the rear sight base ahead of the receiver (bare)
const TUBE_Y = B + 0.0185; // gas piston axis, under the handguard
const GZ = [-0.475, -0.455]; // gas block [front, rear], just ahead of the front band
const MUZZLE_Z = -0.69; // where a muzzle device threads on
const FZ0 = -0.455; // the stock's front
const FTOP = B; // the forend's top, up to the barrel's middle
const FW = 0.015; // forend half width at its top
const FW_BOT = 0.013; // and at its bottom
const FBOT = (z) => B - 0.027 - (0.007 * (z - FZ0)) / (RZ0 - FZ0); // the forend's underside
const BED_BOT = B - 0.038; // under the action
const MAG = [0, BED_BOT, RZ0 + 0.072]; // magazine mount: the well's mouth
const { RAIL_BASE, RAIL_TOP, RAIL_W } = akRail(B);
const SIGHT_Y = RAIL_TOP + 0.02; // the family's sight line over the rail
const RAIL_Z = [RZ0 - 0.002, RZ1 - 0.004]; // the bridge rail
const REAR_Z = RZ1 - 0.016; // the notch, at the rail's back
const FRONT_Z = MUZZLE_Z + 0.016;

const kit = gunParts();
const { parts, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ak = akPieces(kit, { B, RW, RTOP, RBOT, SIGHT_Y });
const bolt = boltPieces(kit);
const wood = woodPieces(kit);

// ================= Receiver: open on top, the bolt carrier and its handle showing
const RA = 'receiver';
const c = 0.0035;
for (const s of [1, -1])
  extrudeZ(
    RA,
    'receiver wall',
    [
      [s * (RW - 0.004), RTOP],
      [s * RW, RTOP],
      [s * RW, RBOT + c],
      [s * (RW - c), RBOT],
      [s * (RW - 0.004), RBOT],
    ].map(([x, y]) => [x, y]),
    RZ0,
    RZ1,
    REC,
  );
extrudeZ(RA, 'receiver floor', [[-RW + 0.004, B - 0.006], [RW - 0.004, B - 0.006], [RW - 0.004, RBOT], [-RW + 0.004, RBOT]], RZ0, RZ1, REC);
box(RA, 'bolt carrier', [0, RTOP - 0.0035, (RZ0 + RZ1) / 2 + 0.01], [0.0185, 0.008, RZ1 - RZ0 - 0.07], STEEL);
box(RA, 'bolt carrier groove', [0, RTOP + 0.0006, (RZ0 + RZ1) / 2 + 0.01], [0.004, 0.0004, RZ1 - RZ0 - 0.08], SLOT);
box(RA, 'charging handle', [RW + 0.0045, RTOP - 0.004, RZ0 + 0.135], [0.009, 0.006, 0.01], STEEL);
tubeX(RA, 'charging handle knob', [RW + 0.0105, RTOP - 0.004, RZ0 + 0.135], 0.0046, 0.005, STEEL, { sides: 8 });
box(RA, 'ejection port', [RW + 0.0002, B + 0.002, RZ0 + 0.085], [0.0006, 0.01, 0.05], SLOT);
for (const z of [RZ0 + 0.01, RZ1 - 0.02])
  tubeX(RA, 'pin', [0, B - 0.008, z], 0.0014, 2 * RW + 0.0012, PIN, { sides: 6 });
// The safety at the receiver's back, on the right.
box(RA, 'safety', [RW + 0.001, RTOP - 0.008, RZ1 - 0.006], [0.0016, 0.006, 0.01], PIN);

// ================= The bridge rail on two feet, and the notch on its back
const RL = 'rails';
const foot = (z0, z1) => {
  extrudeZ(
    RL,
    'rail foot',
    [
      [-RW - 0.0006, RTOP - 0.004],
      [RW + 0.0006, RTOP - 0.004],
      [RW + 0.0006, RAIL_BASE - 0.004],
      [0.0108, RAIL_BASE + 0.0004],
      [-0.0108, RAIL_BASE + 0.0004],
      [-RW - 0.0006, RAIL_BASE - 0.004],
    ],
    z0,
    z1,
    REC,
  );
  tubeX(RL, 'rail foot screw', [-(RW + 0.0012), RTOP - 0.0005, (z0 + z1) / 2], 0.0022, 0.0016, PIN, { sides: 6 });
};
foot(RAIL_Z[0] + 0.004, RAIL_Z[0] + 0.026);
foot(RAIL_Z[1] - 0.03, RAIL_Z[1] - 0.006);
extrudeZ(
  RL,
  'rail spine',
  [
    [-0.0075, RAIL_BASE + 0.0004],
    [0.0075, RAIL_BASE + 0.0004],
    [0.006, RAIL_BASE - 0.0035],
    [-0.006, RAIL_BASE - 0.0035],
  ],
  RAIL_Z[0] + 0.02,
  RAIL_Z[1] - 0.02,
  REC,
);
ak.ar.topRail({ name: 'bridge rail', z0: RAIL_Z[0], z1: RAIL_Z[1] });
ak.rearBlock({ z0: RSB[0], z1: RSB[1] });
ak.railNotch({ REAR_Z });

// ================= Barrel, gas system, handguard, brake and the front post
tubeZ('barrel', 'barrel', B, RZ0 + 0.01, MUZZLE_Z - 0.0015, 0.0084, STEEL, { sides: 8 });
tubeZ('gas block', 'gas piston', TUBE_Y, RSB[0] + 0.002, GZ[1] + 0.002, 0.006, STEEL, { sides: 8 });
const ring = (cx, cy, r, n = 8) => roundOutline(n)(r).map(([x, y]) => [x + cx, y + cy]);
extrudeZ('gas block', 'gas block', hull2d([...ring(0, B, 0.0112), ...ring(0, TUBE_Y, 0.009)]), GZ[0], GZ[1], STEEL);
tubeZ('gas block', 'gas regulator', TUBE_Y, GZ[0] - 0.014, GZ[0] + 0.001, 0.0068, STEEL, { sides: 6 });
tubeX('gas block', 'regulator flat', [0, TUBE_Y, GZ[0] - 0.007], 0.002, 0.0142, PIN, { sides: 6 });
// The sheet-steel handguard over the piston, a row of long vents down each side.
const HG_TOP = TUBE_Y + 0.0095;
extrudeZ(
  'handguard',
  'handguard',
  [
    [-0.0128, FTOP - 0.001],
    [0.0128, FTOP - 0.001],
    [0.0128, TUBE_Y + 0.002],
    [0.0095, HG_TOP - 0.0012],
    [0.006, HG_TOP],
    [-0.006, HG_TOP],
    [-0.0095, HG_TOP - 0.0012],
    [-0.0128, TUBE_Y + 0.002],
  ],
  GZ[1] + 0.012,
  RSB[0] - 0.001,
  BAND,
);
const HZ = [GZ[1] + 0.03, RSB[0] - 0.02];
for (const s of [1, -1])
  for (let i = 0; i < 6; i++) {
    const z = HZ[0] + ((HZ[1] - HZ[0]) * (i + 0.5)) / 6;
    box('handguard', 'handguard vent', [s * 0.0130, TUBE_Y - 0.0015, z], [0.0006, 0.0055, 0.034], SLOT);
  }
bolt.brake({
  B,
  z0: MUZZLE_Z,
  len: 0.074,
  r: 0.0122,
  portH: 0.0062,
  ports: [0, 1, 2, 3, 4, 5].map((i) => [MUZZLE_Z - 0.016 - i * 0.0095, 0.0055]),
});
ak.gasBlock({ z0: MUZZLE_Z + 0.002, z1: MUZZLE_Z + 0.03, TUBE_Y: B + 0.007, FRONT_Z });

// ================= Stock: forend, bands, cleaning rod, action bed, magazine well, wrist, butt
const ST = 'stock';
prism(
  ST,
  'forend',
  [
    [FTOP, FZ0 + 0.004, FW - 0.001],
    [FTOP, RZ0, FW],
    [FBOT(RZ0), RZ0, FW_BOT],
    [FBOT(FZ0 + 0.008), FZ0 + 0.008, FW_BOT - 0.001],
    [FBOT(FZ0) + 0.005, FZ0, FW_BOT - 0.002],
    [FTOP - 0.005, FZ0, FW - 0.002],
  ],
  POLY,
);
wood.band({ z: FZ0 + 0.012, len: 0.024, hw: FW, top: HG_TOP, bot: FBOT(FZ0) - 0.0005 });
box(ST, 'bayonet lug', [FW + 0.003, B + 0.002, FZ0 + 0.012], [0.004, 0.006, 0.02], STEEL);
wood.band({ z: -0.27, len: 0.009, hw: FW, top: HG_TOP, bot: FBOT(-0.27), swivel: true });
tubeZ(ST, 'cleaning rod', B - 0.011, FZ0 + 0.004, RZ0 - 0.015, 0.0021, STEEL, { x: FW + 0.0012, sides: 6 });
box(ST, 'cleaning rod head', [FW + 0.0012, B - 0.011, FZ0 + 0.001], [0.005, 0.005, 0.006], STEEL);
prism(
  ST,
  'action bed',
  [
    [RTOP - 0.006, RZ0 - 0.0005, FW + 0.0005],
    [RTOP - 0.006, RZ1 + 0.002, 0.0155],
    [BED_BOT, RZ1 + 0.002, 0.0155],
    [BED_BOT, RZ0 - 0.0005, FW + 0.0005],
  ],
  POLY,
);
box(ST, 'magazine well', [0, BED_BOT - 0.0002, MAG[2]], [0.03, 0.001, 0.096], SLOT);
// The trigger guard, its front leg the magazine catch.
const TG = [RZ0 + 0.13, RZ0 + 0.205];
box('trigger', 'trigger guard', [0, B - 0.0655, (TG[0] + TG[1]) / 2], [0.01, 0.004, TG[1] - TG[0]], STEEL);
box('trigger', 'magazine catch', [0, (BED_BOT + B - 0.066) / 2, TG[0] + 0.002], [0.009, BED_BOT - B + 0.066, 0.005], STEEL);
box('trigger', 'trigger guard rear', [0, (BED_BOT + B - 0.066) / 2, TG[1] - 0.002], [0.01, BED_BOT - B + 0.066, 0.005], STEEL);
box('trigger', 'trigger', [0, BED_BOT - 0.011, TG[0] + 0.03], [0.0045, 0.018, 0.005], STEEL, { pitch: -14 });
const BACK = wood.wristButt({
  WZ0: RZ1,
  WZ1: 0.225,
  BZ: 0.43,
  top: [RTOP - 0.006, B - 0.002, B - 0.004],
  bot: [BED_BOT - 0.002, B - 0.052, B - 0.12],
  w: [0.0145, 0.0192],
});

// ---- Points and mounts
const model = {
  parts,
  grip: [0, B - 0.044, 0.16],
  support: [0, FBOT(-0.2) - 0.006, -0.2],
  muzzle: [0, B, MUZZLE_Z - 0.075],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, (RAIL_Z[0] + RAIL_Z[1]) / 2 - 0.005],
    muzzle: [0, B, MUZZLE_Z],
    magazine: MAG,
    stock: [0, B - 0.02, 0.225],
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts; rail width', RAIL_W, '; back at', BACK.toFixed(3));
