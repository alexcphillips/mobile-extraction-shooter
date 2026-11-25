// The Five-seveN's model (GM-7b): a long polymer-covered slide with bevelled shoulders, a
// deep, near-upright grip for its long rounds, the safety up front over the trigger, a
// squared oversize guard and tall adjustable sights.
//
//   node scripts/gun-five-seven.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { B, PC, PISTOL, pistolPieces } from './gun-pistol.mjs';

const FILE = new URL('../content/items/five-seven.json', import.meta.url).pathname;
const P = PISTOL['five-seven'];
const kit = gunParts();
const p = pistolPieces(kit);
const { box, extrudeZ, prism } = kit;
const W = 0.0144;
const SB = B - 0.0145;
const ST = B + 0.0135;
const Z0 = -0.159;
const Z1 = 0.041;
const REAR_Z = 0.026;

// ================= Slide: big bevelled shoulders, a long slanted nose, a scooped rear
const sec = [
  [-W, SB],
  [W, SB],
  [W, B + 0.0035],
  [W - 0.0062, ST],
  [-W + 0.0062, ST],
  [-W, B + 0.0035],
];
extrudeZ('slide', 'slide', sec, Z0 + 0.016, Z1, PC.SLIDE);
p.loftZ(
  'slide',
  'slide nose',
  sec.map(([x, y]) => [x * 0.84, y > B ? y - 0.001 : y + 0.0055]),
  Z0,
  sec,
  Z0 + 0.0162,
  PC.SLIDE,
);
p.serrations(W, {
  z0: Z1 - 0.034,
  n: 7,
  step: 0.0042,
  width: 0.0019,
  y0: SB + 0.0035,
  y1: B + 0.0025,
  lean: 0.004,
});
p.serrations(W, {
  z0: Z0 + 0.028,
  n: 4,
  step: 0.0042,
  width: 0.0019,
  y0: SB + 0.0035,
  y1: B + 0.0025,
  lean: 0.004,
});
p.port({
  profile: [
    [W, B - 0.0035],
    [W, B + 0.0035],
    [W - 0.0062, ST],
  ],
  z0: -0.056,
  z1: -0.013,
});
p.decals(
  'slide',
  'slide crease',
  W + 0.0003,
  p.rect(SB + 0.0022, SB + 0.003, Z0 + 0.02, Z1 - 0.002),
  PC.SLOT,
);
p.facing(
  'slide',
  'rear plate',
  Z1 + 0.0003,
  [
    [-0.0095, SB + 0.004],
    [0.0095, SB + 0.004],
    [0.0095, B + 0.0035],
    [0.0062, B + 0.009],
    [-0.0062, B + 0.009],
    [-0.0095, B + 0.0035],
  ],
  PC.SLIDE_HI,
);
p.facing(
  'slide',
  'hammer slot',
  Z1 + 0.0006,
  [
    [-0.0032, SB + 0.005],
    [0.0032, SB + 0.005],
    [0.0032, B + 0.004],
    [-0.0032, B + 0.004],
  ],
  PC.SLOT,
);

// ================= Frame
const FB = -0.0235;
extrudeZ(
  'frame',
  'frame',
  [
    [-0.0136, SB + 0.0005],
    [0.0136, SB + 0.0005],
    [0.0136, FB + 0.006],
    [0.0095, FB],
    [-0.0095, FB],
    [-0.0136, FB + 0.006],
  ],
  Z0 + 0.016,
  0.014,
  PC.FRAME,
);
p.decals(
  'frame',
  'slide rail line',
  0.0139,
  p.rect(SB - 0.0012, SB + 0.0004, Z0 + 0.018, 0.014),
  PC.SLOT,
);
const railBottom = p.rail({ y: FB, z0: Z0 + 0.019, z1: -0.09, cuts: 3 });
prism(
  'frame',
  'frame rear',
  [
    [SB + 0.0005, 0.005],
    [SB + 0.0005, Z1 - 0.002],
    [-0.02, 0.041],
    [-0.036, 0.045],
    [-0.036, -0.004],
    [FB, -0.014],
  ].map(([y, z]) => [y, z, 0.0138]),
  PC.FRAME,
);
p.tang(
  [
    [SB - 0.003, 0.034],
    [SB - 0.006, 0.051],
    [-0.0135, 0.0525],
    [-0.036, 0.046],
  ],
  0.009,
);
p.guard({ top: FB + 0.001, bottom: -0.0575, z0: -0.085, z1: -0.005, hook: 0.004, th: 0.0046 });
p.trigger({ top: FB + 0.001, z: -0.036, len: 0.023 });
p.grip(P, { top: -0.03, panelTop: -0.04, lines: 10, swell: 0.002, inset: 0.0065 });
box(
  'grip',
  'front strap',
  [0, -0.072, p.axis(P, -0.072) - P.d - 0.0003],
  [0.015, 0.045, 0.002],
  PC.PANEL,
  { pitch: -11.3 },
);
for (const s of [1, -1]) {
  prism(
    'frame',
    'safety',
    [
      [SB - 0.004, -0.052],
      [SB - 0.01, -0.051],
      [SB - 0.0115, -0.037],
      [SB - 0.006, -0.035],
    ].map(([y, z]) => [y, z, 0.0013]),
    PC.LEVER,
    { x: s * 0.0146 },
  );
  p.decal('frame', 'safety mark', s, 0.0162, p.circle(0.0014, [SB - 0.008, -0.04], 8), '#b8392e');
}
box('frame', 'slide stop', [-0.0146, SB - 0.0045, -0.006], [0.0018, 0.0036, 0.028], PC.LEVER);
box('frame', 'takedown lever', [-0.0146, SB - 0.0065, -0.071], [0.002, 0.0048, 0.011], PC.LEVER);
box('frame', 'magazine catch', [-0.0148, -0.0375, -0.007], [0.0036, 0.0072, 0.0085], PC.LEVER);
p.pin('frame', 'trigger pin', 0.0137, -0.018, -0.036, 0.0018);

// ================= Irons, muzzle, points
p.irons({
  rearZ: REAR_Z,
  rearBase: ST,
  frontZ: Z0 + 0.021,
  frontBase: ST - 0.0002,
  dots: 'three',
  W: 0.0125,
  foot: 0.0086,
  depth: 0.014,
});
const muzzleZ = p.muzzle({ z0: Z0, len: 0.005, r: 0.0064, rodY: B - 0.0075, rodR: 0 });
await writeModel(FILE, {
  parts: kit.parts,
  ...p.points(P, { muzzleZ, muzzleEnd: muzzleZ, rearZ: REAR_Z, railY: railBottom, railZ: -0.122 }),
});
console.log(kit.parts.length, 'parts');
