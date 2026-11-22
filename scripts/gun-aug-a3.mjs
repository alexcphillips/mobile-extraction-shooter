// The AUG A3's model (GM-5b): a 5.56 bullpup. What makes it read as itself: the long
// polymer shell with the magazine behind the grip and the butt under the cheek; the big
// trigger guard that closes round the whole hand from the shell's front to the grip's foot;
// the receiver housing riding on top of the shell with a full-length rail; a long bare
// barrel with its gas cylinder and the folding vertical foregrip hinged under it near the
// receiver; and a closed flash hider. The foregrip is part of the gun (no foregrip slot, the
// user's call), and so is the grip. The real A3 has no irons; bare it takes the family's
// flip-ups on the rail (the user's call). Rail runs and irons come from gun-ar15.mjs.
// Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-aug-a3.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/aug-a3.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, STEEL, RUBBER, PIN, BORE } = AR;

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RAIL_BASE = B + 0.03;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048; // top of the teeth: the optic mount's height
const RAIL_W = 0.0215;
const RZ0 = -0.178; // the receiver housing's front
const RZ1 = 0.124; // its back, over the ejection port
const RW = 0.0185; // its half width
const STOP = B + 0.013; // the shell's top, the cheek rest behind the receiver
const SW = 0.026; // the shell's half width
const SZ0 = -0.135; // the shell's front
const SZ1 = 0.3; // the butt's back, the pad's front
const SBOT = -0.088; // the butt's toe
const MAG = [0, -0.052, 0.098]; // magazine mount: the well's mouth, behind the grip
const GRIP_Z = -0.028; // the grip's top front
const MUZZLE_Z = -0.452; // where a muzzle device threads on
const FH_L = 0.052;
const FG_Z = -0.222; // the foregrip's middle
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const REAR_Z = RZ1 - 0.016;
const FRONT_Z = RZ0 + 0.016;
const SIDE_RAIL_Z = [RZ0 + 0.006, RZ0 + 0.048];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });
const at = (pts, w) => pts.map(([y, z]) => [y, z, w]);

// ================= The shell: one long hull from the guard's root to the butt, the cheek
// rest on top behind the receiver, the ejection port on the right and its cover on the
// left, a rubber pad; the magazine well hangs behind the grip.
const SH = 'stock';
prism(
  SH,
  'shell',
  at(
    [
      [STOP, SZ0 + 0.012],
      [STOP, SZ1 - 0.004],
      [STOP - 0.008, SZ1],
      [SBOT, SZ1],
      [SBOT + 0.004, SZ1 - 0.07],
      [-0.044, 0.16],
      [-0.036, SZ0 + 0.06],
      [-0.016, SZ0],
      [STOP - 0.006, SZ0],
    ],
    SW,
  ),
  POLY,
);
// The cheek rest: a lighter raised pad on top of the shell behind the receiver.
prism(
  SH,
  'cheek rest',
  at(
    [
      [STOP + 0.0006, RZ1 + 0.01],
      [STOP + 0.0045, RZ1 + 0.03],
      [STOP + 0.0045, SZ1 - 0.02],
      [STOP + 0.0006, SZ1 - 0.01],
    ],
    SW - 0.006,
  ),
  POLY_HI,
);
// A lighter band where the shell's two halves meet, along its flank.
for (const s of [1, -1])
  box(SH, 'shell seam', [s * (SW + 0.0002), -0.018, 0.16], [0.0006, 0.0014, 0.25], POLY_HI);
// The ejection port on the right, its cover on the left (the AUG ejects either side).
box(SH, 'ejection port', [SW + 0.0003, B - 0.002, 0.168], [0.0008, 0.014, 0.05], SLOT);
box(SH, 'port cover', [-(SW + 0.0004), B - 0.002, 0.168], [0.001, 0.016, 0.054], POLY_HI);
// The cross-bolt safety above the grip, the takedown button behind the well.
tubeX(SH, 'safety', [0, -0.026, GRIP_Z - 0.004], 0.0036, 2 * SW + 0.004, PIN, { sides: 8 });
tubeX(SH, 'takedown button', [0, -0.026, 0.19], 0.004, 2 * SW + 0.002, SLOT, { sides: 8 });
// The magazine well behind the grip, flaring a little at its mouth.
prism(
  SH,
  'magazine well',
  [
    [-0.03, 0.062, 0.0175],
    [-0.03, 0.142, 0.0175],
    [MAG[1], 0.14, 0.019],
    [MAG[1], 0.058, 0.019],
  ],
  POLY,
);
box(SH, 'magazine well mouth', [0, MAG[1] - 0.0003, MAG[2]], [0.03, 0.001, 0.074], SLOT);
box(SH, 'magazine catch', [0, MAG[1] + 0.006, 0.146], [0.012, 0.01, 0.006], SLOT);
add({
  type: 'slab',
  pos: v3([0, (STOP - 0.008 + SBOT) / 2, SZ1 + 0.006]),
  size: v3([2 * SW - 0.002, STOP - 0.008 - SBOT, 0.012]),
  corners: [0.005, 0.005, 0.005, 0.005],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: SH,
});
tubeX(SH, 'sling loop', [-(SW + 0.002), -0.03, SZ1 - 0.03], 0.004, 0.003, STEEL, { sides: 8 });

// ================= Grip and trigger guard: the guard closes from the shell's front down
// and back to the grip's foot, round the whole hand.
const GR = 'grip';
prism(
  GR,
  'pistol grip',
  at(
    [
      [-0.034, GRIP_Z],
      [-0.034, GRIP_Z + 0.038],
      [-0.11, GRIP_Z + 0.056],
      [-0.118, GRIP_Z + 0.05],
      [-0.116, GRIP_Z + 0.02],
      [-0.07, GRIP_Z + 0.004],
    ],
    0.0135,
  ),
  POLY,
);
// Finger grooves down the front strap.
for (let i = 0; i < 3; i++) {
  const t = 0.25 + i * 0.22;
  box(
    GR,
    'grip groove',
    [0, -0.04 - t * 0.075, GRIP_Z + 0.002 + t * 0.016],
    [0.022, 0.0016, 0.0016],
    SLOT,
    {
      pitch: -12,
    },
  );
}
prism(
  GR,
  'trigger guard',
  at(
    [
      [-0.02, SZ0 + 0.004],
      [-0.03, SZ0 + 0.024],
      [-0.104, GRIP_Z + 0.026],
      [-0.118, GRIP_Z + 0.026],
      [-0.122, GRIP_Z + 0.014],
      [-0.11, GRIP_Z - 0.002],
    ],
    0.0125,
  ),
  POLY,
);
box(GR, 'trigger', [0, -0.05, GRIP_Z - 0.022], [0.006, 0.026, 0.006], STEEL, { pitch: -14 });

// ================= Receiver housing on top of the shell, the rail along it, the cocking
// handle in its slot on the left, a short rail section on the right at its front.
const RC = 'receiver';
extrudeZ(RC, 'receiver', octagon(RW, RAIL_BASE + 0.0005, B - 0.006, 0.006), RZ0, RZ1, REC);
box(RC, 'cocking slot', [-(RW + 0.0002), B + 0.008, -0.04], [0.0008, 0.005, 0.15], SLOT);
box(RC, 'cocking handle', [-(RW + 0.006), B + 0.008, -0.105], [0.012, 0.007, 0.01], STEEL);
box(RC, 'cocking handle', [-(RW + 0.012), B + 0.008, -0.105], [0.004, 0.011, 0.016], STEEL);
tubeX(RC, 'barrel release', [RW + 0.001, B - 0.001, RZ0 + 0.06], 0.004, 0.003, PIN, { sides: 8 });
ar.topRail({ name: 'top rail', z0: RZ0 + 0.003, z1: RZ1 - 0.003 });
const RAIL_Y = B + 0.004;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: RW - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});

// ================= Barrel, gas cylinder and the folding vertical foregrip (part of the gun)
const BR = 'barrel';
tubeZ(BR, 'barrel', B, RZ0 + 0.004, MUZZLE_Z - 0.002, 0.0084, STEEL, { sides: 8 });
tubeZ(BR, 'barrel collar', B, RZ0 + 0.002, RZ0 - 0.022, 0.0142, STEEL, { sides: 10 });
tubeZ(BR, 'gas cylinder', B + 0.0135, RZ0 + 0.002, FG_Z - 0.02, 0.0062, STEEL, {
  sides: 8,
  x: 0.004,
});
const FG = 'foregrip';
box(FG, 'foregrip clamp', [0, B - 0.012, FG_Z], [0.022, 0.012, 0.03], STEEL);
tubeX(FG, 'foregrip hinge', [0, B - 0.016, FG_Z + 0.008], 0.0032, 0.024, PIN, { sides: 8 });
prism(
  FG,
  'foregrip',
  at(
    [
      [B - 0.018, FG_Z - 0.016],
      [B - 0.018, FG_Z + 0.016],
      [-0.094, FG_Z + 0.012],
      [-0.1, FG_Z + 0.004],
      [-0.1, FG_Z - 0.014],
      [-0.094, FG_Z - 0.02],
    ],
    0.0122,
  ),
  POLY,
);
for (let i = 0; i < 3; i++)
  box(
    FG,
    'foregrip groove',
    [0, -0.03 - i * 0.02, FG_Z - 0.018 - i * 0.0004],
    [0.02, 0.0016, 0.0016],
    SLOT,
  );

// ================= Flash hider (factory, hidden by a muzzle device): a closed cylinder with
// slots round its front, the bore at its end.
const M = { hiddenBy: 'muzzle' };
const FH_END = MUZZLE_Z - FH_L;
tubeZ('muzzle', 'flash hider', B, MUZZLE_Z + 0.002, FH_END, 0.0108, STEEL, { sides: 10, ...M });
for (let i = 0; i < 6; i++) {
  const a = ((i * 60 + 30) * Math.PI) / 180;
  const r = 0.0103;
  box(
    'muzzle',
    'flash hider slot',
    [r * Math.sin(a), B + r * Math.cos(a), FH_END + 0.014],
    [0.0024, 0.0012, 0.02],
    BORE,
    {
      roll: -(i * 60 + 30),
      ...M,
    },
  );
}
add({
  type: 'panel',
  pos: v3([0, B, FH_END - 0.0003]),
  pitch: 90,
  points: roundOutline(10)(0.0074).map(v3),
  color: BORE,
  name: 'muzzle bore',
  group: 'muzzle',
  ...M,
});

// ================= Iron sights: the family's flip-ups on the rail (the rear hidden by an
// optic, the front stays).
ar.flipRear({ SIGHT_Y, REAR_Z });
ar.flipFront({ SIGHT_Y, FRONT_Z });

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.072, GRIP_Z + 0.03],
  support: [0, -0.06, FG_Z],
  muzzle: [0, B, FH_END - 0.0015],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.03],
    muzzle: [0, B, MUZZLE_Z],
    magazine: MAG,
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
