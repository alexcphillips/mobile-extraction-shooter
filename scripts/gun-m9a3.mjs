// The M9A3's model (GM-7b): the open-topped slide with the barrel showing in it, a bridge
// at the front carrying the post, the slide's safety levers, a ring hammer, the recurved
// guard and the threaded barrel under its protector.
//
//   node scripts/gun-m9a3.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, octagon, writeModel } from './gun-kit.mjs';
import { B, PC, PISTOL, pistolPieces } from './gun-pistol.mjs';

const FILE = new URL('../content/items/m9a3.json', import.meta.url).pathname;
const P = PISTOL.m9a3;
const kit = gunParts();
const p = pistolPieces(kit);
const { box, tubeX, tubeZ, extrudeZ, prism } = kit;
const W = 0.0134; // slide half width
const SB = B - 0.0135;
const ST = B + 0.0142; // the rear block's top
const WT = B + 0.0046; // the open walls' top
const Z0 = -0.158; // slide front
const Z1 = 0.037;
const ZB = -0.026; // the rear block's front
const REAR_Z = 0.01; // with the sight line, what the arm pose and the hit zones are fit to

// ================= Slide: rear block, open walls, front bridge
const block = octagon(W, ST, SB, 0.0034);
block[3] = [W, SB + 0.001];
block[4] = [W, SB];
block[5] = [-W, SB];
block[6] = [-W, SB + 0.001];
extrudeZ('slide', 'slide', block, ZB, Z1 - 0.006, PC.SLIDE);
p.loftZ(
  'slide',
  'slide rear',
  block,
  Z1 - 0.0065,
  block.map(([x, y]) => [x * 0.86, y > B ? y - 0.004 : y]),
  Z1,
  PC.SLIDE,
);
extrudeZ(
  'slide',
  'slide floor',
  [
    [-W, SB],
    [W, SB],
    [W, B - 0.004],
    [-W, B - 0.004],
  ],
  Z0 + 0.001,
  ZB + 0.002,
  PC.SLIDE,
);
for (const s of [1, -1]) {
  // The walls, falling from the block to the open length.
  const wall = [
    [s * 0.0086, B - 0.005],
    [s * W, B - 0.005],
    [s * W, WT - 0.0016],
    [s * (W - 0.0016), WT],
    [s * 0.0086, WT],
  ];
  extrudeZ('slide', 'slide wall', s > 0 ? wall : wall.reverse(), Z0 + 0.001, ZB + 0.002, PC.SLIDE);
  prism(
    'slide',
    'wall ramp',
    [
      [WT - 0.0005, ZB - 0.02],
      [ST - 0.004, ZB + 0.001],
      [WT - 0.0005, ZB + 0.001],
    ].map(([y, z]) => [y, z, 0.0022]),
    PC.SLIDE,
    { x: s * (W - 0.0026) },
  );
}
const bridge = [
  [W - 0.0004, B - 0.004],
  [W - 0.0004, B + 0.005],
  [0.0068, B + 0.0115],
  [-0.0068, B + 0.0115],
  [-W + 0.0004, B + 0.005],
  [-W + 0.0004, B - 0.004],
];
extrudeZ('slide', 'front bridge', bridge, Z0, Z0 + 0.021, PC.SLIDE);
tubeZ('barrel', 'barrel', B, Z0 + 0.018, ZB + 0.004, 0.0086, PC.BARREL, { sides: 12 });
box('barrel', 'chamber block', [0, B + 0.005, ZB - 0.011], [0.0165, 0.0088, 0.026], PC.BARREL);
box('barrel', 'extractor cut', [0, B + 0.0095, ZB - 0.0015], [0.0168, 0.0008, 0.004], PC.SLOT);
p.serrations(W, { z0: Z1 - 0.028, n: 5, y0: SB + 0.003, y1: B + 0.0015, lean: -0.002 });
p.serrations(W, { z0: Z0 + 0.0085, n: 4, y0: SB + 0.003, y1: B + 0.001, lean: -0.002 });
p.decal(
  'slide',
  'extractor',
  1,
  W + 0.0003,
  p.rect(B + 0.002, B + 0.005, ZB - 0.001, ZB + 0.018),
  PC.STEEL,
);
p.decals(
  'slide',
  'slide flat',
  W + 0.0003,
  p.rect(SB + 0.004, SB + 0.005, Z0 + 0.028, ZB + 0.026),
  PC.SLOT,
);
for (const s of [1, -1]) {
  tubeX('slide', 'safety', [s * (W + 0.0014), B + 0.0035, 0.0195], 0.0052, 0.0028, PC.LEVER, {
    sides: 10,
  });
  prism(
    'slide',
    'safety lever',
    [
      [B + 0.0062, 0.018],
      [B + 0.0005, 0.0175],
      [B - 0.0005, 0.005],
      [B + 0.0025, 0.0035],
    ].map(([y, z]) => [y, z, 0.0013]),
    PC.LEVER,
    { x: s * (W + 0.0028) },
  );
}
p.hammer({ z: Z1 + 0.003, y: B + 0.002, spur: false });

// ================= Frame
const FB = -0.0225;
extrudeZ(
  'frame',
  'frame',
  [
    [-0.0128, SB + 0.0005],
    [0.0128, SB + 0.0005],
    [0.0128, FB + 0.006],
    [0.0088, FB],
    [-0.0088, FB],
    [-0.0128, FB + 0.006],
  ],
  -0.138,
  0.014,
  PC.FRAME,
);
p.decals(
  'frame',
  'slide rail line',
  0.0131,
  p.rect(SB - 0.0012, SB + 0.0004, -0.137, 0.014),
  PC.SLOT,
);
const railBottom = p.rail({ y: FB, z0: -0.137, z1: -0.086, cuts: 3 });
prism(
  'frame',
  'frame rear',
  [
    [SB + 0.0005, 0.005],
    [SB + 0.0005, Z1 - 0.003],
    [-0.02, 0.036],
    [-0.036, 0.038],
    [-0.036, -0.006],
    [FB, -0.014],
  ].map(([y, z]) => [y, z, 0.013]),
  PC.FRAME,
);
p.tang(
  [
    [SB - 0.002, 0.03],
    [SB - 0.005, 0.046],
    [-0.0115, 0.0475],
    [-0.035, 0.0415],
  ],
  0.0085,
);
p.guard({ top: FB + 0.001, bottom: -0.0545, z0: -0.08, z1: -0.008, hook: 0.005 });
p.trigger({ top: FB + 0.001, z: -0.036, len: 0.023 });
p.grip(P, { top: -0.03, panelTop: -0.036, lines: 9, swell: 0.003 });
p.pin('grip', 'grip screw', P.w + 0.0006, -0.0455, p.axis(P, -0.0455), 0.0024);
p.pin('grip', 'grip screw', P.w + 0.0006, -0.089, p.axis(P, -0.089), 0.0024);
box('frame', 'slide stop', [-0.0139, SB - 0.0045, -0.016], [0.0018, 0.0034, 0.036], PC.LEVER);
box('frame', 'slide stop tab', [-0.0148, SB - 0.0035, -0.004], [0.0024, 0.0028, 0.008], PC.LEVER);
tubeX('frame', 'magazine catch', [-0.0142, -0.0335, -0.007], 0.0034, 0.004, PC.LEVER, { sides: 8 });
for (const s of [1, -1])
  box(
    'frame',
    'takedown lever',
    [s * 0.0135, SB - 0.005, -0.062],
    [0.0016, 0.0042, 0.013],
    PC.LEVER,
  );
p.decal(
  'frame',
  'trigger bar',
  1,
  0.0131,
  p.rect(SB - 0.0075, SB - 0.0035, -0.034, 0.006),
  PC.STEEL,
);
p.pin('frame', 'trigger pin', 0.0129, -0.0165, -0.037, 0.0019);

// ================= Irons, muzzle, points
p.irons({ rearZ: REAR_Z, rearBase: ST, frontZ: Z0 + 0.014, frontBase: B + 0.0115, dots: 'three' });
const muzzleZ = p.muzzle({ z0: Z0, len: 0.008, r: 0.0074, thread: 0.0125 });
await writeModel(FILE, {
  parts: kit.parts,
  ...p.points(P, {
    muzzleZ,
    muzzleEnd: muzzleZ - 0.0125,
    rearZ: REAR_Z,
    railY: railBottom,
    railZ: -0.117,
  }),
});
console.log(kit.parts.length, 'parts');
