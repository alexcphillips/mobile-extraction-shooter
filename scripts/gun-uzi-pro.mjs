// The Uzi Pro's model (GM-4b), built from the gun kit and the platform's pieces
// (gun-uzi-kit.mjs): a short slab-sided steel upper under a full top rail, the cocking knob
// moved to the left side, a polymer lower whose trigger guard runs forward into a hand stop,
// the grip the magazine goes up through, the peep at the rail's back (hidden by an optic)
// and the post at its front (it stays), and a skeleton stock on a hinge block that doesn't
// fold (the user's call). Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-uzi-pro.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { arPieces } from './gun-ar15.mjs';
import { UZI, uziPieces } from './gun-uzi-kit.mjs';

const FILE = new URL('../content/items/uzi-pro.json', import.meta.url).pathname;
const { REC, SLOT, POLY, POLY_HI, PIN, STEEL, RUBBER, BAND } = UZI;

// ---- Key sizes everything hangs off
const B = 0; // bore height
const RW = 0.019; // upper half width
const RTOP = 0.02; // the upper's flat top, under the rail
const RBOT = -0.02; // the upper's bottom: the magazine's mount
const RZ0 = -0.115; // upper front
const RZ1 = 0.1; // upper rear: the stock hinge
const MUZZLE_Z = -0.158; // where a muzzle device threads on
const RAIL_BASE = RTOP - 0.0005;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048;
const SIGHT_Y = RAIL_TOP + 0.02;
const REAR_Z = RZ1 - 0.016;
const FRONT_Z = RZ0 + 0.014;
const GRIP_Z = -0.006; // the grip's top front
const BZ = 0.305; // the butt's back, before the pad

const kit = gunParts();
const { parts, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const uzi = uziPieces(kit, { B, RW, RTOP, RBOT, SIGHT_Y });
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W: 0.0215 });

// ================= Upper: the steel box, the full top rail, port and side knob
const RA = 'receiver';
extrudeZ(
  RA,
  'receiver',
  [
    [-RW, RBOT],
    [RW, RBOT],
    [RW, RTOP - 0.004],
    [RW - 0.004, RTOP],
    [-RW + 0.004, RTOP],
    [-RW, RTOP - 0.004],
  ],
  RZ0,
  RZ1,
  REC,
);
for (const s of [1, -1])
  box(RA, 'side flat', [s * (RW + 0.0003), B + 0.004, (RZ0 + RZ1) / 2], [0.0006, 0.012, RZ1 - RZ0 - 0.04], BAND);
ar.topRail({ name: 'top rail', z0: RZ0 + 0.002, z1: RZ1 - 0.002, group: 'rails' });
box(RA, 'ejection port', [RW + 0.0002, B + 0.004, -0.006], [0.0006, 0.012, 0.044], SLOT);
box(RA, 'bolt face', [RW - 0.0005, B + 0.004, -0.004], [0.001, 0.008, 0.026], STEEL);
// The cocking knob on the left, in its slot.
box(RA, 'knob slot', [-(RW + 0.0003), B + 0.011, -0.05], [0.0006, 0.0035, 0.09], SLOT);
tubeX(RA, 'cocking knob', [-(RW + 0.006), B + 0.011, -0.09], 0.0055, 0.011, STEEL, { sides: 10 });
tubeX(RA, 'knob cap', [-(RW + 0.0117), B + 0.011, -0.09], 0.0045, 0.001, PIN, { sides: 10 });
uzi.barrel({ z0: RZ0, MUZZLE_Z, nutR: 0.016 });
tubeZ('barrel', 'muzzle thread', B, MUZZLE_Z + 0.001, MUZZLE_Z - 0.008, 0.0066, STEEL, { sides: 8, hiddenBy: 'muzzle' });

// ================= Lower: polymer, its trigger guard running forward into a hand stop
const LO = 'lower';
const LW = 0.0175;
prism(
  LO,
  'polymer lower',
  [
    [RBOT + 0.002, RZ0 + 0.004],
    [RBOT + 0.002, RZ1 - 0.016],
    [RBOT - 0.013, RZ1 - 0.024],
    [RBOT - 0.013, RZ0 + 0.014],
    [RBOT - 0.006, RZ0 + 0.004],
  ].map(([y, z]) => [y, z, LW]),
  POLY,
);
for (const s of [1, -1])
  box(LO, 'lower seam', [s * (LW + 0.0002), RBOT - 0.006, (RZ0 + RZ1) / 2 - 0.01], [0.0006, 0.0014, RZ1 - RZ0 - 0.06], SLOT);
// The hand stop: a lug down from the lower's front, the guard's bar from it to the grip.
prism(
  LO,
  'hand stop',
  [
    [RBOT - 0.012, -0.096],
    [RBOT - 0.012, -0.074],
    [RBOT - 0.05, -0.07],
    [RBOT - 0.056, -0.076],
    [RBOT - 0.05, -0.092],
  ].map(([y, z]) => [y, z, 0.0085]),
  POLY,
);
box(LO, 'hand stop texture', [0, RBOT - 0.032, -0.0958], [0.012, 0.03, 0.0006], SLOT);
const TG_Y = RBOT - 0.047;
box(LO, 'trigger guard', [0, TG_Y, (-0.074 + GRIP_Z) / 2], [0.0085, 0.004, GRIP_Z + 0.074], POLY);
prism(
  LO,
  'trigger',
  [
    [RBOT - 0.013, -0.033],
    [RBOT - 0.013, -0.027],
    [RBOT - 0.031, -0.024],
    [RBOT - 0.033, -0.028],
  ].map(([y, z]) => [y, z, 0.003]),
  PIN,
);
uzi.grip({ top: RBOT - 0.012, z: GRIP_Z, depth: 0.098, rake: 0.012 });
tubeX(LO, 'selector', [-(LW + 0.0012), RBOT - 0.006, GRIP_Z + 0.012], 0.004, 0.0024, STEEL, { sides: 10 });
box(LO, 'selector lever', [-(LW + 0.0026), RBOT - 0.006, GRIP_Z + 0.004], [0.0014, 0.0035, 0.014], STEEL);
const RAIL_X = ar.sideRail({ s: 1, x0: LW - 0.0005, y: RBOT - 0.0055, z0: RZ0 + 0.012, z1: RZ0 + 0.052, color: POLY });

// ================= Irons: the peep on a clamp at the rail's back, the post at its front
ar.clamp('iron sights', 'rear sight clamp', REAR_Z - 0.001, 0.016, { hiddenBy: 'optic' });
uzi.peepRear({ REAR_Z, base: RAIL_TOP + 0.004, hide: true });
uzi.frontPost({ FRONT_Z, base: RAIL_TOP - 0.0004 });

// ================= Stock: the hinge block (stays), then the skeleton stock (factory, hidden)
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ0 = RZ1 + 0.012;
extrudeZ(ST, 'hinge block', [[-RW, B + 0.012], [RW, B + 0.012], [RW, RBOT - 0.008], [-RW, RBOT - 0.008]], RZ1 - 0.001, SZ0, BAND);
tubeX(ST, 'hinge pin', [RW + 0.001, B - 0.004, SZ0 - 0.006], 0.0032, 0.0024, PIN, { sides: 8 });
prism(
  ST,
  'stock top',
  [
    [B + 0.011, SZ0],
    [B + 0.012, BZ],
    [B - 0.004, BZ],
    [B - 0.002, SZ0],
  ].map(([y, z]) => [y, z, 0.0105]),
  POLY,
  hide,
);
prism(
  ST,
  'stock strut',
  [
    [RBOT - 0.002, SZ0],
    [RBOT + 0.008, SZ0 + 0.01],
    [B - 0.072, BZ - 0.02],
    [B - 0.084, BZ - 0.024],
  ].map(([y, z]) => [y, z, 0.0085]),
  POLY,
  hide,
);
prism(
  ST,
  'stock butt',
  [
    [B + 0.012, BZ - 0.03],
    [B + 0.012, BZ],
    [B - 0.09, BZ],
    [B - 0.09, BZ - 0.016],
    [B - 0.004, BZ - 0.034],
  ].map(([y, z]) => [y, z, 0.0125]),
  POLY,
  hide,
);
box(ST, 'cheek strip', [0, B + 0.0124, (SZ0 + BZ) / 2 + 0.03], [0.014, 0.0008, BZ - SZ0 - 0.07], POLY_HI, hide);
extrudeZ(ST, 'butt pad', [[-0.0135, B + 0.0125], [0.0135, B + 0.0125], [0.0135, B - 0.0905], [-0.0135, B - 0.0905]], BZ, BZ + 0.01, RUBBER, hide);

// ---- Points and mounts
const model = {
  parts,
  grip: [0, RBOT - 0.05, GRIP_Z + 0.032],
  support: [0, RBOT - 0.03, -0.106],
  muzzle: [0, B, MUZZLE_Z - 0.009],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, -0.01],
    muzzle: [0, B, MUZZLE_Z],
    magazine: [0, RBOT, GRIP_Z + 0.022],
    rightRail: [RAIL_X, RBOT - 0.0055, RZ0 + 0.032],
    stock: [0, B, SZ0],
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
