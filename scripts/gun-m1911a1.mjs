// The M1911A1's model (GM-7b): the thin round-topped slide with its bushing, the spur hammer
// over a beavertail and grip safety, the thumb safety, and checkered grip panels on a steel
// frame. The real dust cover has no rail: it gets a short one for the rail slot.
//
//   node scripts/gun-m1911a1.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { B, PC, PISTOL, pistolPieces } from './gun-pistol.mjs';

const FILE = new URL('../content/items/m1911a1.json', import.meta.url).pathname;
const P = PISTOL.m1911a1;
const kit = gunParts();
const p = pistolPieces(kit);
const { box, tubeX, tubeZ, extrudeZ, prism } = kit;
const W = 0.0116;
const SB = B - 0.015;
const ST = B + 0.0138;
const Z0 = -0.153;
const Z1 = 0.034;
const REAR_Z = 0.0235;

// ================= Slide: flat sides, a round top, the bushing and recoil plug at its nose
const sec = [
  [-W, SB],
  [W, SB],
  [W, B + 0.003],
  [W * 0.88, B + 0.0085],
  [W * 0.58, B + 0.0122],
  [W * 0.2, ST],
  [-W * 0.2, ST],
  [-W * 0.58, B + 0.0122],
  [-W * 0.88, B + 0.0085],
  [-W, B + 0.003],
];
extrudeZ('slide', 'slide', sec, Z0 + 0.004, Z1, PC.SLIDE);
p.loftZ(
  'slide',
  'slide nose',
  sec.map(([x, y]) => [x * 0.93, y > B ? y - 0.001 : y + 0.001]),
  Z0,
  sec,
  Z0 + 0.0042,
  PC.SLIDE,
);
// The scallop under the slide's front, where the frame's dust cover starts.
p.serrations(W, {
  z0: Z1 - 0.031,
  n: 8,
  step: 0.0034,
  width: 0.0014,
  y0: SB + 0.002,
  y1: B + 0.0035,
  lean: 0,
});
p.port({
  profile: [
    [W, B - 0.0015],
    [W, B + 0.003],
    [W * 0.88, B + 0.0085],
    [W * 0.58, B + 0.0122],
    [W * 0.2, ST],
  ],
  z0: -0.056,
  z1: -0.018,
});
tubeZ('slide', 'barrel bushing', B, Z0 + 0.002, Z0 - 0.002, 0.0102, PC.STEEL, { sides: 12 });
p.facing(
  'slide',
  'firing pin stop',
  Z1 + 0.0003,
  [
    [-0.0045, SB + 0.003],
    [0.0045, SB + 0.003],
    [0.0045, B + 0.008],
    [-0.0045, B + 0.008],
  ],
  PC.SLIDE_HI,
);
p.facing('slide', 'firing pin', Z1 + 0.0006, p.circle(0.0016, [0, B + 0.004], 8), PC.SLOT);
p.hammer({ z: Z1 + 0.004, y: B + 0.001 });

// ================= Frame
const FB = -0.0215;
const FW = 0.0112;
extrudeZ(
  'frame',
  'frame',
  [
    [-FW, SB + 0.0005],
    [FW, SB + 0.0005],
    [FW, FB + 0.003],
    [FW - 0.003, FB],
    [-FW + 0.003, FB],
    [-FW, FB + 0.003],
  ],
  -0.122,
  0.014,
  PC.FRAME,
);
p.decals(
  'frame',
  'slide rail line',
  FW + 0.0003,
  p.rect(SB - 0.001, SB + 0.0004, -0.121, 0.014),
  PC.SLOT,
);
const railBottom = p.rail({ y: FB, z0: -0.121, z1: -0.082, cuts: 2, w: 0.0098 });
prism(
  'frame',
  'frame rear',
  [
    [SB + 0.0005, 0.005],
    [SB + 0.0005, Z1 - 0.004],
    [-0.018, 0.034],
    [-0.036, 0.037],
    [-0.036, -0.006],
    [FB, -0.014],
  ].map(([y, z]) => [y, z, 0.0114]),
  PC.FRAME,
);
// Beavertail over the grip safety, the arched mainspring housing below it.
p.tang(
  [
    [SB - 0.0015, 0.026],
    [SB - 0.0035, 0.048],
    [-0.0085, 0.0515],
    [-0.0165, 0.04],
    [-0.02, 0.03],
  ],
  0.0085,
  PC.FRAME,
  'beavertail',
);
prism(
  'grip',
  'grip safety',
  [
    [-0.016, 0.034],
    [-0.0185, 0.0425],
    [-0.044, 0.0475],
    [-0.058, 0.049],
    [-0.058, 0.04],
  ].map(([y, z]) => [y, z, 0.0068]),
  PC.STEEL,
);
p.guard({
  top: FB + 0.001,
  bottom: -0.0515,
  z0: -0.074,
  z1: -0.007,
  hook: -0.002,
  th: 0.0036,
  w: 0.0046,
});
p.trigger({ top: FB - 0.002, z: -0.028, len: 0.018, straight: true, color: PC.STEEL });
p.grip(P, {
  top: -0.03,
  panelTop: -0.034,
  lines: 0,
  swell: 0.003,
  inset: 0.0055,
  panel: PC.PANEL,
  c: 0.0045,
});
// Checkered panels: raised slabs over the frame, a lattice of light diamonds, two screws.
for (let i = 0; i < 8; i++)
  for (let j = 0; j < 4; j++) {
    const y = -0.0495 - i * 0.0046;
    const z = p.axis(P, y) - 0.0105 + j * 0.007 + (i % 2 ? 0.0018 : -0.0012);
    p.decals(
      'grip',
      'checkering',
      P.w + 0.0006,
      [
        [y + 0.0018, z],
        [y, z + 0.0026],
        [y - 0.0018, z],
        [y, z - 0.0026],
      ],
      PC.FRAME_LO,
    );
  }
p.pin('grip', 'grip screw', P.w + 0.0007, -0.0415, p.axis(P, -0.0415), 0.0027);
p.pin('grip', 'grip screw', P.w + 0.0007, -0.0888, p.axis(P, -0.0888), 0.0027);
prism(
  'frame',
  'thumb safety',
  [
    [SB + 0.001, 0.0285],
    [SB - 0.0045, 0.0285],
    [SB - 0.0045, 0.011],
    [SB - 0.0005, 0.0095],
  ].map(([y, z]) => [y, z, 0.0016]),
  PC.LEVER,
  { x: -0.0128 },
);
box('frame', 'slide stop', [-0.0122, SB - 0.0035, -0.032], [0.0018, 0.0034, 0.042], PC.LEVER);
box('frame', 'slide stop tab', [-0.0132, SB - 0.0025, -0.0155], [0.0026, 0.0028, 0.008], PC.LEVER);
tubeX('frame', 'magazine catch', [-0.0126, -0.031, -0.008], 0.0034, 0.004, PC.LEVER, { sides: 8 });
p.pin('frame', 'slide stop pin', FW + 0.0002, SB - 0.0035, -0.05, 0.0024);
p.pin('frame', 'plunger', FW + 0.0002, SB - 0.004, 0.0005, 0.0012, PC.STEEL);

// ================= Irons, muzzle, points
p.irons({
  rearZ: REAR_Z,
  rearBase: ST - 0.0012,
  frontZ: Z0 + 0.014,
  frontBase: ST,
  dots: 'plain',
  W: 0.0108,
  foot: 0.0062,
  postW: 0.0044,
});
const muzzleZ = p.muzzle({
  z0: Z0 - 0.002,
  len: 0.0025,
  r: 0.0078,
  rodY: B - 0.0122,
  rodR: 0.0042,
});
await writeModel(FILE, {
  parts: kit.parts,
  ...p.points(P, { muzzleZ, muzzleEnd: muzzleZ, rearZ: REAR_Z, railY: railBottom, railZ: -0.112 }),
});
console.log(kit.parts.length, 'parts');
