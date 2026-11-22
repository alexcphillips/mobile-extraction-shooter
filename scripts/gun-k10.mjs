// The K10's model (GM-2): a .45 SMG with a low bore and a boxy, slab-sided body. What
// makes it read as itself: one tall upper the whole length of the gun with a full top rail
// and vented sides at the front, a polymer lower whose front slants up under the muzzle,
// the magazine well forward of the trigger, its grip molded into the lower (so it has no
// grip slot), and a fixed tube with a skeletal stock behind. Its stock rides the buffer
// tube, so it doesn't fold (the user's call). Flip-up irons, rail runs, the tube and the
// flash hider come from gun-ar15.mjs. Replaces only `model` in its item file. See
// docs/guns.md.
//
//   node scripts/gun-k10.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { coreOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/k10.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, STEEL, RUBBER, PIN } = AR;

// ---- Key sizes everything hangs off
const B = 0; // bore height: low, in line with the hand
const RAIL_BASE = 0.034;
const RAIL_TOP = 0.044; // top of the teeth: the optic mount's height
const TEETH_Y0 = 0.0392;
const RAIL_W = 0.0215;
const UZ0 = -0.205; // the upper's front (the shroud's face)
const UZ1 = 0.085; // the upper's rear
const UW = 0.036; // the upper's width
const UTOP = RAIL_BASE + 0.0005;
const UBOT = -0.0135; // where upper meets lower
const LW = 0.034; // the lower's width
const LBOT = -0.044; // the lower's flat bottom, behind the slant
const SLANT = [-0.08, -0.026]; // [z, y] where the front slant starts and the y it rises to at UZ0
const MUZZLE_Z = -0.222; // where a muzzle device threads on
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const REAR_Z = 0.07;
const FRONT_Z = -0.192;
const MAG = [0, -0.0615, -0.061]; // magazine mount: the magwell's mouth
const TUBE_Y = 0.008; // buffer tube axis, a little over the bore
const TUBE_Z0 = 0.097; // the tube's end plate, behind the adapter
const STOCK = [0, TUBE_Y, TUBE_Z0 + 0.056];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

// ================= Upper: one tall box the whole length, its top edges chamfered under the
// rail, its front the barrel shroud with vents.
const UP = 'upper receiver';
extrudeZ(
  UP,
  'upper receiver',
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
// The shroud's face: a dark plate with the barrel's hole, a step proud.
box(
  UP,
  'shroud face',
  [0, (UBOT + UTOP) / 2, UZ0 - 0.0006],
  [UW - 0.008, UTOP - UBOT - 0.008, 0.0012],
  SLOT,
);
// Vents along both sides of the shroud, and a long recessed panel behind them.
for (const s of [1, -1]) {
  for (let i = 0; i < 4; i++)
    box(
      UP,
      'shroud vent',
      [s * (UW / 2 + 0.0003), 0.011, -0.192 + i * 0.016],
      [0.001, 0.016, 0.008],
      SLOT,
    );
  box(UP, 'side panel', [s * (UW / 2 + 0.0003), 0.008, -0.07], [0.0008, 0.018, 0.09], '#25272a');
}
// Ejection port on the right, the charging handle's slot and folding knob on the left.
box(UP, 'ejection port', [UW / 2 + 0.0004, 0.012, 0.03], [0.001, 0.016, 0.05], SLOT);
box(UP, 'charging slot', [-(UW / 2 + 0.0004), 0.02, -0.075], [0.001, 0.005, 0.09], SLOT);
box(UP, 'charging handle', [-(UW / 2 + 0.005), 0.02, -0.112], [0.01, 0.006, 0.008], STEEL);
box(UP, 'charging handle knob', [-(UW / 2 + 0.01), 0.02, -0.112], [0.0045, 0.012, 0.012], POLY);
// The top rail along its whole length.
ar.topRail({ name: 'top rail', z0: UZ0 + 0.002, z1: UZ1 - 0.002 });

// ================= Lower: the polymer body, its front slanting up under the shroud
const LO = 'lower receiver';
prism(
  LO,
  'lower receiver',
  [
    [UBOT + 0.0005, UZ0 + 0.003],
    [UBOT + 0.0005, UZ1],
    [-0.028, UZ1],
    [LBOT, 0.052],
    [LBOT, SLANT[0]],
    [SLANT[1], UZ0 + 0.003],
  ].map(([y, z]) => [y, z, LW / 2]),
  POLY,
);
// A lighter edge along the slant so the body's shape reads.
prism(
  LO,
  'lower slant edge',
  [
    [LBOT + 0.002, SLANT[0]],
    [LBOT - 0.0004, SLANT[0]],
    [SLANT[1] - 0.0004, UZ0 + 0.004],
    [SLANT[1] + 0.002, UZ0 + 0.004],
  ].map(([y, z]) => [y, z, LW / 2 - 0.0015]),
  POLY_HI,
);
// The magazine well under the body, forward of the trigger, its mouth darker.
prism(
  LO,
  'magazine well',
  [
    [LBOT + 0.002, -0.083],
    [LBOT + 0.002, -0.038],
    [MAG[1], -0.039],
    [MAG[1], -0.083],
  ].map(([y, z]) => [y, z, 0.0158]),
  POLY,
);
box(LO, 'magazine well mouth', [0, MAG[1] - 0.0003, MAG[2]], [0.027, 0.001, 0.042], SLOT);
box(LO, 'magazine release', [0, MAG[1] + 0.006, -0.0365], [0.012, 0.007, 0.004], STEEL);
// Trigger guard and trigger behind the well.
box(LO, 'trigger guard', [0, -0.063, 0.011], [0.011, 0.004, 0.098], POLY);
box(LO, 'trigger', [0, -0.052, -0.004], [0.005, 0.016, 0.005], STEEL, { pitch: -14 });
// Controls: safety either side over the grip, a takedown pin through the body.
for (const s of [1, -1]) {
  tubeX(LO, 'selector hub', [s * (LW / 2 + 0.0006), -0.024, 0.05], 0.0042, 0.0016, STEEL);
  box(LO, 'selector', [s * (LW / 2 + 0.0012), -0.022, 0.05], [0.0016, 0.004, 0.014], PIN, {
    pitch: 30,
  });
}
tubeX(LO, 'takedown pin', [0, -0.02, -0.13], 0.0025, LW + 0.0016, PIN);
tubeX(LO, 'takedown pin', [0, -0.02, 0.072], 0.0025, LW + 0.0016, PIN);
// The grip, molded into the lower: raked, its front strap with finger grooves, a lighter
// backstrap. Part of the body: no grip slot.
prism(
  LO,
  'grip',
  [
    [LBOT + 0.003, 0.045],
    [LBOT + 0.003, 0.084],
    [-0.124, 0.113],
    [-0.129, 0.105],
    [-0.126, 0.084],
    [-0.062, 0.058],
  ].map(([y, z]) => [y, z, 0.0142]),
  POLY,
);
prism(
  LO,
  'grip backstrap',
  [
    [LBOT + 0.001, 0.0838],
    [LBOT + 0.001, 0.0866],
    [-0.124, 0.1158],
    [-0.124, 0.1128],
  ].map(([y, z]) => [y, z, 0.013]),
  POLY_HI,
);
// Finger grooves across the front strap.
for (const y of [-0.082, -0.102]) {
  const z = 0.058 + ((-0.062 - y) / 0.064) * 0.026;
  box(LO, 'grip groove', [0, y, z], [0.0272, 0.0016, 0.004], SLOT);
}
box(LO, 'grip cap', [0, -0.1275, 0.0985], [0.0272, 0.003, 0.03], RUBBER);

// ================= Front: rail pad under the slant for a foregrip, a side rail section
const PAD = [-0.2, -0.15];
const padTop = SLANT[1] + 0.003;
const PAD_BOT = -0.0345;
box(
  LO,
  'rail pad',
  [0, (padTop + PAD_BOT) / 2, (PAD[0] + PAD[1]) / 2],
  [0.022, padTop - PAD_BOT, PAD[1] - PAD[0]],
  POLY,
);
const FOREGRIP_Y = ar.bottomRail({
  bot: PAD_BOT,
  z0: PAD[0] + 0.002,
  z1: PAD[1] - 0.002,
  color: REC,
});
const SIDE_RAIL_Z = [-0.2, -0.16];
const RAIL_Y = -0.001;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: UW / 2 - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});

// ================= Barrel (stays: no barrel slot) and flash hider (factory, hidden by a
// muzzle device)
tubeZ('barrel', 'barrel', B, UZ0 + 0.002, MUZZLE_Z - 0.002, 0.0085, STEEL, { sides: 8 });
tubeZ('barrel', 'barrel collar', B, UZ0 - 0.0005, UZ0 - 0.005, 0.0108, STEEL, { sides: 8 });
ar.birdcage({ B, MUZZLE_Z });

// ================= Stock adapter and buffer tube (stay), the skeletal stock on the tube
const BUF = 'buffer tube';
extrudeZ(
  BUF,
  'stock adapter',
  rounded(
    [
      [-0.0135, -0.012],
      [0.0135, -0.012],
      [0.0135, 0.027],
      [-0.0135, 0.027],
    ],
    0.003,
  ),
  UZ1 - 0.001,
  TUBE_Z0,
  REC,
);
ar.bufferTube({ TUBE_Y, z0: TUBE_Z0, z1: TUBE_Z0 + 0.172 });
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
// The skeletal stock from the MPX's recipe, moved onto this tube.
const dz = STOCK[2] - 0.18;
const dy = TUBE_Y - 0.012;
const at = (pts) => pts.map(([y, z]) => [y + dy, z + dz]);
const SZ1 = 0.29 + dz;
extrudeZ(
  ST,
  'stock sleeve',
  [
    [-0.011, -0.005 + dy],
    [0.011, -0.005 + dy],
    [0.0155, -0.0005 + dy],
    [0.0155, 0.026 + dy],
    [0.011, 0.0305 + dy],
    [-0.011, 0.0305 + dy],
    [-0.0155, 0.026 + dy],
    [-0.0155, -0.0005 + dy],
  ],
  STOCK[2],
  0.236 + dz,
  POLY,
  hide,
);
box(
  ST,
  'stock top bar',
  [0, 0.0285 + dy, (0.232 + 0.29) / 2 + dz],
  [0.012, 0.0065, 0.29 - 0.232],
  POLY,
  hide,
);
box(
  ST,
  'stock top bar edge',
  [0, 0.0322 + dy, (0.236 + 0.29) / 2 - 0.002 + dz],
  [0.009, 0.001, 0.29 - 0.236 - 0.006],
  POLY_HI,
  hide,
);
prism(
  ST,
  'stock butt',
  at([
    [0.031, 0.276],
    [0.032, 0.29],
    [-0.068, 0.29],
    [-0.066, 0.28],
    [-0.012, 0.272],
  ]).map(([y, z]) => [y, z, 0.0145]),
  POLY,
  hide,
);
prism(
  ST,
  'stock strut',
  at([
    [-0.003, 0.2],
    [-0.003, 0.212],
    [-0.064, 0.282],
    [-0.066, 0.272],
  ]).map(([y, z]) => [y, z, 0.0055]),
  POLY,
  hide,
);
add({
  type: 'slab',
  pos: v3([0, -0.018 + dy, SZ1 + 0.006]),
  size: v3([0.031, 0.104, 0.012]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
box(ST, 'adjustment lever', [0, -0.007 + dy, 0.205 + dz], [0.007, 0.005, 0.026], SLOT, hide);
tubeX(ST, 'sling loop', [0, -0.06 + dy, 0.281 + dz], 0.003, 0.02, STEEL, hide);

// ================= Iron sights: the family's flip-ups on the top rail
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.085, 0.085],
  support: [0, FOREGRIP_Y - 0.002, (PAD[0] + PAD[1]) / 2],
  muzzle: [0, B, MUZZLE_Z - 0.046],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.03],
    muzzle: [0, B, MUZZLE_Z],
    foregrip: [0, FOREGRIP_Y, (PAD[0] + PAD[1]) / 2],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
