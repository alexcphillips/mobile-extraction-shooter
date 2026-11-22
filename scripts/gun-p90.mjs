// The P90's model (GM-4b), built from the gun kit: a bullpup, so the gun is one smooth
// polymer shell from the nose to the butt, a closed frame under it round the thumbhole with
// the support hand's loop at its front, the magazine lying along the top, and over the
// magazine a bridge carrying a short rail and the built-in sight housing. The housing's
// backup irons, a notch and a post on its top edges, are what a bare p90 aims with (the
// user's call): an optic replaces the whole housing, irons and all, on the same rail. Its
// factory stock is the rubber butt plate, which the p90's own pad replaces (stocks.mjs).
// Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-p90.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { coreOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/p90.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, PIN, STEEL, RUBBER, HG, SIGHT_BODY, SIGHT_LIP } = AR;
const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

// ---- Key sizes everything hangs off
const B = 0; // bore height
const W = 0.026; // the shell's half width
const TOP = 0.022; // the shell's top, under the magazine
const SBOT = -0.03; // the upper shell's bottom
const NOSE = -0.215; // the shell's front
const BUTT = 0.245; // the shell's back, before the butt plate
const TOE = -0.092; // the butt's bottom at the back
const FOOT = -0.124; // the frame's bottom under the grip
const MUZZLE_Z = -0.255; // where a muzzle device threads on
const MAG = [0, TOP, -0.07]; // magazine mount: its underside's middle, on the shell's top
const BRIDGE = [-0.132, -0.018]; // the sight bridge over the magazine
const RAIL_BASE = 0.0585;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048;
const HOUSING = [-0.118, -0.036]; // the sight housing on the rail
const HTOP = 0.094; // its top edge
const SIGHT_Y = HTOP + 0.0045; // the backup irons' line
const STOCK = [0, -0.035, BUTT]; // the pad's mount, mid-butt

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W: 0.0215 });

// ================= Shell: the rounded upper, its nose, the lower mass of grip and butt
const SH = 'shell';
const r = 0.008;
extrudeZ(SH, 'upper shell', rounded([[-W + r, SBOT + r], [W - r, SBOT + r], [W - r, TOP - r], [-W + r, TOP - r]], r), NOSE + 0.014, BUTT, REC);
prism(
  SH,
  'nose',
  [
    [TOP - 0.003, NOSE + 0.015, W - 0.003],
    [TOP - 0.008, NOSE, W - 0.008],
    [SBOT + 0.008, NOSE, W - 0.008],
    [SBOT + 0.002, NOSE + 0.015, W - 0.003],
  ],
  REC,
);
prism(
  SH,
  'butt',
  [
    [SBOT + 0.002, -0.032, 0.023],
    [SBOT + 0.002, BUTT, W - 0.001],
    [TOE, BUTT, W - 0.001],
    [-0.112, 0.08, 0.023],
    [FOOT, 0.012, 0.0205],
    [FOOT, -0.016, 0.0195],
    [-0.11, -0.032, 0.0195],
  ],
  POLY,
);
// The grip's texture down each side, the ejection chute under the butt.
for (const s of [1, -1])
  box(SH, 'grip texture', [s * 0.0212, -0.08, -0.012], [0.0006, 0.064, 0.026], HG, { pitch: -6 });
box(SH, 'ejection chute', [0, -0.1035, 0.066], [0.014, 0.001, 0.034], SLOT, { pitch: -7.5 });
for (const s of [1, -1]) {
  box(SH, 'shell seam', [s * (W + 0.0002), SBOT + 0.002, (NOSE + BUTT) / 2], [0.0006, 0.0012, BUTT - NOSE - 0.02], SLOT);
  // Charging handles both sides at the front, and the sling loops.
  box(SH, 'charging handle', [s * (W + 0.003), B + 0.006, -0.17], [0.006, 0.008, 0.012], STEEL);
  tubeX(SH, 'sling loop', [s * (W + 0.0005), SBOT + 0.008, 0.2], 0.004, 0.003, PIN, { sides: 6 });
}

// ================= The frame under the front: the support hand's loop, the bar under the
// thumbhole, the trigger and the rotary selector under it
const FR = 'frame';
prism(
  FR,
  'front loop',
  [
    [SBOT + 0.003, NOSE + 0.012],
    [SBOT + 0.003, -0.168],
    [-0.118, -0.136],
    [-0.13, -0.144],
    [-0.126, -0.17],
    [-0.062, NOSE + 0.016],
  ].map(([y, z]) => [y, z, 0.0175]),
  POLY,
);
// On the loop's raked front face (from y −0.062 to −0.126), its middle at y −0.094.
box(FR, 'loop texture', [0, -0.094, -0.1849], [0.022, 0.056, 0.0006], HG, { pitch: -24.4 });
prism(
  FR,
  'frame bar',
  [
    [-0.108, -0.148],
    [-0.108, -0.016],
    [FOOT + 0.002, -0.014],
    [-0.13, -0.146],
  ].map(([y, z]) => [y, z, 0.0155]),
  POLY,
);
prism(
  FR,
  'trigger',
  [
    [SBOT + 0.002, -0.06],
    [SBOT + 0.002, -0.052],
    [SBOT - 0.022, -0.048],
    [SBOT - 0.024, -0.053],
  ].map(([y, z]) => [y, z, 0.003]),
  PIN,
);
// The selector disc, flat against the bar's underside (y −0.125 at z −0.06).
add({ type: 'cylinder', pos: v3([0, -0.1258, -0.06]), radius: 0.008, height: 0.002, sides: 12, color: STEEL, name: 'selector', group: FR });
box(FR, 'selector mark', [0, -0.127, -0.064], [0.002, 0.0006, 0.006], SIGHT_LIP);

// ================= Barrel and flash hider (factory, hidden by a muzzle device)
tubeZ('barrel', 'barrel', B, NOSE + 0.004, MUZZLE_Z - 0.0015, 0.0075, STEEL, { sides: 8 });
tubeZ('barrel', 'barrel collar', B, NOSE + 0.002, NOSE - 0.008, 0.0115, STEEL, { sides: 10 });
const hideMz = { hiddenBy: 'muzzle' };
tubeZ('flash hider', 'flash hider', B, MUZZLE_Z + 0.001, MUZZLE_Z - 0.026, 0.0102, STEEL, { sides: 10, ...hideMz });
for (const s of [1, -1])
  box('flash hider', 'flash hider slot', [s * 0.0095, B, MUZZLE_Z - 0.015], [0.002, 0.004, 0.018], SLOT, hideMz);
box('flash hider', 'flash hider slot', [0, B + 0.0095, MUZZLE_Z - 0.015], [0.004, 0.002, 0.018], SLOT, hideMz);

// ================= The bridge over the magazine, its rail, and the sight housing
const BR = 'sight bridge';
for (const [z0, z1] of [
  [BRIDGE[0], BRIDGE[0] + 0.014],
  [BRIDGE[1] - 0.014, BRIDGE[1]],
])
  for (const s of [1, -1])
    prism(
      BR,
      'bridge leg',
      [
        [TOP - 0.004, z0],
        [TOP - 0.004, z1],
        [RAIL_BASE, z1 - 0.002],
        [RAIL_BASE, z0 + 0.002],
      ].map(([y, z]) => [y, z, 0.0022]),
      REC,
      { x: s * (W - 0.0022) },
    );
extrudeZ(BR, 'bridge', rounded([[-W + 0.002, RAIL_BASE - 0.0045], [W - 0.002, RAIL_BASE - 0.0045], [W - 0.002, RAIL_BASE - 0.001], [-W + 0.002, RAIL_BASE - 0.001]], 0.001), BRIDGE[0] + 0.001, BRIDGE[1] - 0.001, REC);
ar.topRail({ name: 'top rail', z0: BRIDGE[0] + 0.004, z1: BRIDGE[1] - 0.004, group: 'rails' });
// The housing (hidden by an optic): rounded, its windows dark glass front and back, the
// backup notch and post on its top edges.
const hide = { hiddenBy: 'optic' };
const IS = 'iron sights';
const HW = 0.0175;
extrudeZ(IS, 'sight housing', rounded([[-HW + 0.004, RAIL_TOP - 0.0005], [HW - 0.004, RAIL_TOP - 0.0005], [HW - 0.004, HTOP - 0.004], [-HW + 0.004, HTOP - 0.004]], 0.004), HOUSING[0], HOUSING[1], POLY, hide);
for (const [z, back] of [
  [HOUSING[0] - 0.0004, false],
  [HOUSING[1] + 0.0004, true],
])
  add({
    type: 'panel',
    pos: v3([0, 0, z]),
    pitch: back ? 90 : -90,
    points: rounded([[-HW + 0.007, RAIL_TOP + 0.0055], [HW - 0.007, RAIL_TOP + 0.0055], [HW - 0.007, HTOP - 0.0075], [-HW + 0.007, HTOP - 0.0075]], 0.002).map(([x, y]) => v3([x, back ? -y : y])),
    color: '#232b30',
    name: back ? 'rear lens' : 'front lens',
    group: IS,
    ...hide,
  });
for (const s of [1, -1]) {
  box(IS, 'housing rib', [s * (HW + 0.0002), (RAIL_TOP + HTOP) / 2, (HOUSING[0] + HOUSING[1]) / 2], [0.0006, 0.004, HOUSING[1] - HOUSING[0] - 0.016], POLY_HI, hide);
  // The notch: two ears on the back edge, their tops on the sight line.
  box(IS, 'rear sight ear', [s * 0.0048, (HTOP - 0.001 + SIGHT_Y) / 2, HOUSING[1] - 0.004], [0.004, SIGHT_Y - HTOP + 0.001, 0.006], SIGHT_BODY, hide);
}
box(IS, 'rear sight index', [0, HTOP - 0.0004, HOUSING[1] - 0.0008], [0.0008, 0.0008, 0.002], SIGHT_LIP, hide);
box(IS, 'front sight post', [0, (HTOP - 0.001 + SIGHT_Y) / 2, HOUSING[0] + 0.004], [0.0024, SIGHT_Y - HTOP + 0.001, 0.0024], SIGHT_BODY, hide);
tubeX(IS, 'housing knob', [HW + 0.002, RAIL_TOP + 0.01, HOUSING[0] + 0.02], 0.004, 0.004, STEEL, { sides: 10, ...hide });

// ================= The butt plate (the factory stock, hidden by a fitted one)
add({
  type: 'slab',
  pos: v3([0, (TOP - 0.002 + TOE) / 2, BUTT + 0.004]),
  size: v3([2 * W - 0.002, TOP - 0.002 - TOE, 0.008]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt plate',
  group: 'stock',
  hiddenBy: 'stock',
});

// ---- Points and mounts
const RAIL_X = ar.sideRail({ s: 1, x0: W - 0.0005, y: B - 0.006, z0: -0.198, z1: -0.158, color: REC });
const model = {
  parts,
  grip: [0, -0.085, -0.008],
  support: [0, -0.098, -0.16],
  muzzle: [0, B, MUZZLE_Z - 0.026],
  sight: [0, SIGHT_Y, HOUSING[1] - 0.004],
  mounts: {
    optic: [0, RAIL_TOP, (BRIDGE[0] + BRIDGE[1]) / 2],
    muzzle: [0, B, MUZZLE_Z],
    magazine: MAG,
    rightRail: [RAIL_X, B - 0.006, -0.178],
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
