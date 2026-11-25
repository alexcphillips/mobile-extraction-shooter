// The P226's model (GM-7b): the slide's two steps, wide flats under a narrow bevelled top,
// the decocker and slide catch on the frame's left, an exposed spur hammer, the railed dust
// cover and screwed grip panels.
//
//   node scripts/gun-p226.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { B, PC, PISTOL, pistolPieces } from './gun-pistol.mjs';

const FILE = new URL('../content/items/p226.json', import.meta.url).pathname;
const P = PISTOL.p226;
const kit = gunParts();
const p = pistolPieces(kit);
const { box, tubeX, extrudeZ, prism } = kit;
const W = 0.0132;
const TW = 0.0098; // the upper step's half width
const SB = B - 0.0145;
const STEP = B + 0.0015;
const ST = B + 0.0142;
const Z0 = -0.15;
const Z1 = 0.036;
const REAR_Z = 0.0235;

// ================= Slide: the wide lower flats, the narrow bevelled top over them
const lower = [
  [-W, SB],
  [W, SB],
  [W, STEP - 0.0015],
  [W - 0.0018, STEP + 0.0008],
  [-W + 0.0018, STEP + 0.0008],
  [-W, STEP - 0.0015],
];
extrudeZ('slide', 'slide', lower, Z0 + 0.009, Z1, PC.SLIDE);
p.loftZ(
  'slide',
  'slide nose',
  lower.map(([x, y]) => [x * 0.82, y < B - 0.005 ? y + 0.002 : y]),
  Z0 + 0.001,
  lower,
  Z0 + 0.0092,
  PC.SLIDE,
);
const top = [
  [-TW - 0.0018, STEP - 0.001],
  [TW + 0.0018, STEP - 0.001],
  [TW + 0.0012, ST - 0.0055],
  [TW - 0.0032, ST],
  [-TW + 0.0032, ST],
  [-TW - 0.0012, ST - 0.0055],
];
extrudeZ('slide', 'slide top', top, Z0 + 0.006, Z1, PC.SLIDE);
p.loftZ(
  'slide',
  'slide nose',
  top.map(([x, y]) => [x * 0.93, y > B + 0.006 ? y - 0.0022 : y]),
  Z0,
  top,
  Z0 + 0.0062,
  PC.SLIDE,
);
p.serrations(W, { z0: Z1 - 0.0255, n: 6, y0: SB + 0.0025, y1: STEP - 0.003, lean: 0 });
p.port({
  profile: [
    [TW + 0.0017, STEP + 0.001],
    [TW + 0.0012, ST - 0.0055],
    [TW - 0.0032, ST],
  ],
  z0: -0.054,
  z1: -0.014,
});
p.facing('slide', 'firing pin', Z1 + 0.0003, p.circle(0.0024, [0, B + 0.0052], 8), PC.STEEL);
p.hammer({ z: Z1 + 0.003, y: B + 0.0005 });

// ================= Frame
const FB = -0.0235;
extrudeZ(
  'frame',
  'frame',
  [
    [-0.0126, SB + 0.0005],
    [0.0126, SB + 0.0005],
    [0.0126, FB + 0.004],
    [0.0105, FB],
    [-0.0105, FB],
    [-0.0126, FB + 0.004],
  ],
  Z0 + 0.012,
  0.014,
  PC.FRAME,
);
p.decals(
  'frame',
  'slide rail line',
  0.0129,
  p.rect(SB - 0.0012, SB + 0.0004, Z0 + 0.013, 0.014),
  PC.SLOT,
);
const railBottom = p.rail({ y: FB, z0: Z0 + 0.013, z1: -0.085, cuts: 2, w: 0.011 });
prism(
  'frame',
  'frame rear',
  [
    [SB + 0.0005, 0.005],
    [SB + 0.0005, Z1 - 0.002],
    [-0.02, 0.0365],
    [-0.036, 0.04],
    [-0.036, -0.006],
    [FB, -0.014],
  ].map(([y, z]) => [y, z, 0.013]),
  PC.FRAME,
);
p.tang(
  [
    [SB - 0.003, 0.03],
    [SB - 0.006, 0.0445],
    [-0.0125, 0.0455],
    [-0.035, 0.0415],
  ],
  0.009,
);
p.guard({ top: FB + 0.001, bottom: -0.055, z0: -0.079, z1: -0.007, hook: 0.0015 });
p.trigger({ top: FB + 0.001, z: -0.035, len: 0.023 });
p.grip(P, { top: -0.03, panelTop: -0.034, lines: 11, swell: 0.0035, inset: 0.0055 });
p.pin('grip', 'grip screw', P.w + 0.0006, -0.047, p.axis(P, -0.047) + 0.004, 0.0023);
p.pin('grip', 'grip screw', P.w + 0.0006, -0.09, p.axis(P, -0.09) + 0.004, 0.0023);
// The left side's levers in their row: takedown, decocker, slide catch, magazine catch.
tubeX('frame', 'takedown lever', [-0.0136, SB - 0.0055, -0.062], 0.0042, 0.0024, PC.LEVER, {
  sides: 10,
});
prism(
  'frame',
  'takedown arm',
  [
    [SB - 0.003, -0.061],
    [SB - 0.0078, -0.06],
    [SB - 0.0105, -0.073],
    [SB - 0.007, -0.0745],
  ].map(([y, z]) => [y, z, 0.001]),
  PC.LEVER,
  { x: -0.0145 },
);
prism(
  'frame',
  'decocker',
  [
    [SB - 0.0055, -0.022],
    [SB - 0.0115, -0.023],
    [SB - 0.019, -0.009],
    [SB - 0.0155, -0.006],
  ].map(([y, z]) => [y, z, 0.0014]),
  PC.LEVER,
  { x: -0.0142 },
);
box('frame', 'slide catch', [-0.0139, SB - 0.004, 0.0005], [0.002, 0.0038, 0.021], PC.LEVER);
box('frame', 'slide catch tab', [-0.0149, SB - 0.003, 0.0075], [0.0022, 0.0028, 0.007], PC.STEEL);
tubeX('frame', 'magazine catch', [-0.0144, -0.0355, -0.0085], 0.0033, 0.004, PC.LEVER, {
  sides: 8,
});
p.pin('frame', 'trigger pin', 0.0128, -0.0185, -0.036, 0.002);

// ================= Irons, muzzle, points
p.irons({
  rearZ: REAR_Z,
  rearBase: ST,
  frontZ: Z0 + 0.0155,
  frontBase: ST,
  dots: 'three',
  W: 0.0115,
  foot: 0.0078,
});
const muzzleZ = p.muzzle({ z0: Z0, len: 0.0045, rodY: B - 0.0105, rodR: 0.0032 });
await writeModel(FILE, {
  parts: kit.parts,
  ...p.points(P, { muzzleZ, muzzleEnd: muzzleZ, rearZ: REAR_Z, railY: railBottom, railZ: -0.115 }),
});
console.log(kit.parts.length, 'parts');
