// The MP7's model (GM-4): a 4.6 mm PDW, short and tall, proportioned from the user's
// reference photo. What makes it read as itself: a tall upper with the bore low in it, a
// full-length top rail, slots along the top of its front half and a hook under the nose; a
// wide slab at the back; a folding foregrip hung under the front; a thin trigger guard ahead
// of a fat, upright grip that is the magazine well; the T charging handle at the rail's back;
// and a tall butt plate on rods that slide into the body.
//
// The grip slot (the user's call): the grip shell is the factory grip, hidden by a fitted
// grip, while the magazine well inside it stays so the magazine still has a home. Its grip
// wraps the well (`magwellGrip`), so a fitted grip draws its magwell look round the well
// (scripts/grip-magwell.mjs); the well is the standard one (MAGWELL_WELL in models.ts). The factory folding foregrip is hidden by a fitted one, which
// goes on a short rail under its hinge. Flip-up irons and rail runs come from gun-ar15.mjs.
// Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-mp7.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { coreOutline, edgeFaces, ringFaces, roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/mp7.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { REC, SLOT, POLY, POLY_HI, STEEL, RUBBER, PIN, SIGHT_BODY, SIGHT_LIP, BORE } = AR;

// ---- Key sizes everything hangs off
const B = 0; // bore height: low in the upper
const UW = 0.04; // the upper's width at the front
const SW = 0.044; // the rear slab's width
const UTOP = 0.0402; // the upper's top, under the rail
const UBOT = -0.008; // the front half's bottom
const LBOT = -0.022; // the body's bottom, under the slab and the frame
const UZ0 = -0.207; // the nose's face
const UZ1 = 0.132; // the body's rear: the stock's front
const SLAB_Z = -0.022; // where the rear slab starts
const RAIL_BASE = UTOP + 0.0005;
const TEETH_Y0 = RAIL_BASE + 0.0052;
const RAIL_TOP = TEETH_Y0 + 0.0048; // top of the teeth: the optic mount's height
const RAIL_W = 0.0215;
const RAIL_Z = [-0.17, 0.122];
const SIGHT_Y = RAIL_TOP + 0.024; // the family's sight line over the rail
const REAR_Z = 0.108;
const FRONT_Z = -0.158;
const MUZZLE_Z = -0.215; // the factory barrel's end: where a muzzle device goes on
// The magazine well: the standard one (MAGWELL_WELL: half width, half length, depth).
const WELL = { z0: -0.014, z1: 0.03, bot: LBOT - 0.086, w: 0.0125 };
const SHELL = { z0: -0.023, z1: 0.04, w: 0.017 }; // the grip shell round it
const MAG = [0, WELL.bot - 0.004, (WELL.z0 + WELL.z1) / 2]; // the magazine's mouth
const FG_Z = [-0.181, -0.147]; // the folding foregrip's hinge along z
const STOCK = [0, 0.0, UZ1 + 0.002];

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
const ar = arPieces(kit, { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W });

// ================= Upper: the front half, chamfered under the rail, slots along its top,
// a hook under the nose; the wide slab at the back
const UP = 'upper receiver';
extrudeZ(
  UP,
  'upper receiver',
  [
    [-UW / 2, UBOT],
    [UW / 2, UBOT],
    [UW / 2, UTOP - 0.005],
    [UW / 2 - 0.005, UTOP],
    [-UW / 2 + 0.005, UTOP],
    [-UW / 2, UTOP - 0.005],
  ],
  UZ0,
  SLAB_Z + 0.002,
  REC,
);
extrudeZ(
  UP,
  'rear slab',
  [
    [-SW / 2, LBOT + 0.003],
    [-SW / 2 + 0.003, LBOT],
    [SW / 2 - 0.003, LBOT],
    [SW / 2, LBOT + 0.003],
    [SW / 2, UTOP - 0.006],
    [SW / 2 - 0.006, UTOP],
    [-SW / 2 + 0.006, UTOP],
    [-SW / 2, UTOP - 0.006],
  ],
  SLAB_Z,
  UZ1,
  POLY,
);
// The slab's front edge slants back toward the top, a lighter strip along it.
for (const s of [1, -1]) {
  box(
    UP,
    'slab edge',
    [s * (SW / 2 + 0.0003), (LBOT + UTOP) / 2, SLAB_Z + 0.004],
    [0.0008, UTOP - LBOT - 0.004, 0.003],
    POLY_HI,
    {
      pitch: -12,
    },
  );
  // Slots along the top of the front half, the barrel's dark showing through.
  for (const [z, len] of [
    [-0.164, 0.014],
    [-0.142, 0.016],
    [-0.117, 0.024],
  ])
    box(UP, 'upper slot', [s * (UW / 2 + 0.0003), 0.034, z], [0.0008, 0.005, len], SLOT);
  // Round screw heads and a long slot along the front's waist.
  for (const z of [-0.184, -0.1])
    tubeX(UP, 'screw', [s * (UW / 2 + 0.0004), 0.004, z], 0.0042, 0.0012, PIN, { sides: 8 });
  box(UP, 'waist slot', [s * (UW / 2 + 0.0003), 0.004, -0.157], [0.0008, 0.004, 0.022], SLOT);
  // Recessed panels on the slab.
  box(UP, 'slab panel', [s * (SW / 2 + 0.0003), 0.026, 0.07], [0.0008, 0.004, 0.012], SLOT);
  box(UP, 'slab panel', [s * (SW / 2 + 0.0003), 0.026, 0.1], [0.0008, 0.004, 0.012], SLOT);
  tubeX(UP, 'screw', [s * (SW / 2 + 0.0004), -0.01, 0.112], 0.0035, 0.0012, PIN, { sides: 8 });
}
// The hook under the nose and the nose's dark face round the barrel.
prism(
  UP,
  'nose hook',
  [
    [UBOT + 0.0005, UZ0],
    [UBOT + 0.0005, UZ0 + 0.03],
    [-0.017, UZ0 + 0.022],
    [-0.026, UZ0 + 0.006],
    [-0.024, UZ0],
  ].map(([y, z]) => [y, z, UW / 2 - 0.003]),
  REC,
);
box(UP, 'nose face', [0, B + 0.008, UZ0 - 0.0006], [UW - 0.012, 0.03, 0.0012], SLOT);
ar.topRail({ name: 'top rail', z0: RAIL_Z[0], z1: RAIL_Z[1] });
// The T charging handle at the rail's back, its wings either side.
box(UP, 'charging handle', [0, UTOP - 0.003, UZ1 - 0.004], [0.012, 0.006, 0.01], STEEL);
for (const s of [1, -1])
  box(
    UP,
    'charging handle wing',
    [s * 0.015, UTOP - 0.001, UZ1 - 0.004],
    [0.016, 0.008, 0.008],
    POLY,
    {
      yaw: s * 8,
    },
  );
// Side rails at the nose, both sides; the right one is the rail item's mount.
const SIDE_RAIL_Z = [-0.204, -0.17];
const RAIL_Y = 0.018;
const RAIL_X = ar.sideRail({
  s: 1,
  x0: UW / 2 - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});
ar.sideRail({
  s: -1,
  x0: UW / 2 - 0.0005,
  y: RAIL_Y,
  z0: SIDE_RAIL_Z[0],
  z1: SIDE_RAIL_Z[1],
  color: REC,
});

// ================= The frame under the front half: polymer, its screws; the guard and
// trigger, the controls
const LO = 'lower receiver';
box(
  LO,
  'frame',
  [0, (UBOT + LBOT) / 2, (UZ0 + 0.03 + SLAB_Z) / 2],
  [UW - 0.004, UBOT - LBOT, SLAB_Z - UZ0 - 0.03],
  POLY,
);
box(
  LO,
  'frame edge',
  [0, LBOT - 0.0004, (UZ0 + 0.03 + SLAB_Z) / 2],
  [UW - 0.01, 0.001, SLAB_Z - UZ0 - 0.034],
  POLY_HI,
);
const FOREGRIP_Y = ar.bottomRail({ bot: LBOT, z0: FG_Z[0], z1: FG_Z[1], color: REC });
// The thin guard, from the frame down and back to the grip's front.
const GUARD_Y = -0.046;
box(
  LO,
  'trigger guard',
  [0, GUARD_Y, (-0.074 + SHELL.z0) / 2],
  [0.006, 0.003, SHELL.z0 + 0.074],
  STEEL,
);
box(
  LO,
  'trigger guard front',
  [0, (LBOT + GUARD_Y) / 2, -0.08],
  [0.006, LBOT - GUARD_Y + 0.004, 0.003],
  STEEL,
  {
    pitch: 18,
  },
);
box(LO, 'trigger', [0, -0.032, -0.044], [0.0045, 0.018, 0.005], STEEL, { pitch: -14 });
// The selector over the grip's front and the magazine release ahead of the guard.
for (const s of [1, -1]) {
  tubeX(LO, 'selector hub', [s * (SW / 2 + 0.0006), 0.002, 0.004], 0.0045, 0.0016, STEEL);
  box(LO, 'selector', [s * (SW / 2 + 0.0012), 0.004, -0.004], [0.0016, 0.004, 0.02], PIN, {
    pitch: 20,
  });
  box(
    LO,
    'magazine release',
    [s * (UW / 2 - 0.001), LBOT - 0.002, -0.062],
    [0.003, 0.004, 0.014],
    STEEL,
  );
}

// ================= Grip: the magazine well (stays) and the shell round it (factory, hidden
// by a fitted grip): fat and upright, a stippled panel each side
const GR = 'grip';
prism(
  GR,
  'magazine well',
  [
    [LBOT + 0.001, WELL.z0],
    [LBOT + 0.001, WELL.z1],
    [WELL.bot, WELL.z1],
    [WELL.bot, WELL.z0],
  ].map(([y, z]) => [y, z, WELL.w]),
  POLY,
);
// The collar at the well's mouth, a step lighter.
box(
  GR,
  'magazine well collar',
  [0, WELL.bot - 0.002, MAG[2] - 0.002],
  [2 * WELL.w + 0.006, 0.005, WELL.z1 - WELL.z0 + 0.012],
  POLY_HI,
);
box(
  GR,
  'magazine well mouth',
  [0, MAG[1] - 0.0003, MAG[2] - 0.002],
  [2 * WELL.w - 0.002, 0.001, WELL.z1 - WELL.z0 - 0.004],
  SLOT,
);
const hideGrip = { hiddenBy: 'grip' };
prism(
  GR,
  'grip shell',
  [
    [LBOT + 0.0005, SHELL.z0],
    [LBOT + 0.0005, SHELL.z1],
    [-0.06, SHELL.z1 + 0.002],
    [WELL.bot + 0.006, SHELL.z1 - 0.002],
    [WELL.bot + 0.003, SHELL.z0 + 0.001],
    [-0.07, SHELL.z0 - 0.002],
  ].map(([y, z]) => [y, z, SHELL.w]),
  POLY,
  hideGrip,
);
for (const s of [1, -1]) {
  box(
    GR,
    'grip panel',
    [s * (SHELL.w + 0.0003), -0.068, (SHELL.z0 + SHELL.z1) / 2],
    [0.0008, 0.06, 0.044],
    '#303236',
    hideGrip,
  );
  for (let i = 0; i < 4; i++)
    box(
      GR,
      'grip rib',
      [s * (SHELL.w + 0.0007), -0.046 - i * 0.014, (SHELL.z0 + SHELL.z1) / 2],
      [0.0008, 0.002, 0.036],
      SLOT,
      hideGrip,
    );
}

// ================= Folding foregrip (factory, hidden by a fitted foregrip): a hinge block
// on the rail, a flat paddle hanging from it with ribs at its foot
const FG = 'foregrip';
const hideFg = { hiddenBy: 'foregrip' };
const FGZ = (FG_Z[0] + FG_Z[1]) / 2;
box(
  FG,
  'foregrip hinge',
  [0, FOREGRIP_Y + 0.001, FGZ],
  [0.024, 0.008, FG_Z[1] - FG_Z[0] + 0.002],
  POLY,
  hideFg,
);
tubeX(FG, 'foregrip pivot', [0, FOREGRIP_Y - 0.002, FGZ + 0.006], 0.0055, 0.026, PIN, {
  sides: 8,
  ...hideFg,
});
prism(
  FG,
  'foregrip paddle',
  [
    [FOREGRIP_Y - 0.002, FGZ - 0.017],
    [FOREGRIP_Y - 0.002, FGZ + 0.014],
    [-0.12, FGZ + 0.012],
    [-0.122, FGZ - 0.004],
    [-0.118, FGZ - 0.018],
  ].map(([y, z]) => [y, z, 0.0095]),
  POLY,
  hideFg,
);
box(FG, 'foregrip groove', [0.0098, -0.07, FGZ - 0.006], [0.0008, 0.06, 0.003], SLOT, hideFg);
box(FG, 'foregrip groove', [-0.0098, -0.07, FGZ - 0.006], [0.0008, 0.06, 0.003], SLOT, hideFg);
for (let i = 0; i < 5; i++)
  box(
    FG,
    'foregrip rib',
    [0, -0.1 - i * 0.0045, FGZ + 0.0145],
    [0.017, 0.0022, 0.005],
    RUBBER,
    hideFg,
  );

// ================= Barrel (factory, hidden by a fitted barrel) and flash hider (hidden by
// a muzzle device)
tubeZ('barrel', 'barrel collar', B, UZ0 + 0.001, UZ0 - 0.004, 0.0098, STEEL, { sides: 10 });
tubeZ('barrel', 'barrel', B, UZ0 - 0.003, MUZZLE_Z + 0.001, 0.0075, STEEL, {
  sides: 10,
  hiddenBy: 'barrel',
});
tubeZ('muzzle', 'flash hider', B, MUZZLE_Z + 0.001, MUZZLE_Z - 0.04, 0.0088, STEEL, {
  sides: 8,
  hiddenBy: 'muzzle',
});
for (let i = 0; i < 4; i++) {
  const a = (i * 90 + 45) * (Math.PI / 180);
  box(
    'muzzle',
    'flash hider slot',
    [0.0084 * Math.cos(a), B + 0.0084 * Math.sin(a), MUZZLE_Z - 0.026],
    [0.0012, 0.0012, 0.022],
    SLOT,
    { hiddenBy: 'muzzle' },
  );
}

// ================= The stock (factory, hidden by a fitted stock): two rods sliding into the
// body, a tall butt plate with a slanted front and a pad
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const PLATE = UZ1 + 0.142; // the plate's front at the top, extended
for (const s of [1, -1])
  tubeZ(ST, 'stock rod', 0.006, UZ1 - 0.01, PLATE + 0.004, 0.0034, STEEL, {
    x: s * 0.014,
    sides: 8,
    ...hide,
  });
prism(
  ST,
  'butt plate',
  [
    [0.032, PLATE],
    [0.032, PLATE + 0.026],
    [-0.076, PLATE + 0.026],
    [-0.076, PLATE + 0.012],
    [-0.03, PLATE + 0.004],
  ].map(([y, z]) => [y, z, 0.019]),
  POLY,
  hide,
);
box(ST, 'butt plate edge', [0, 0.0325, PLATE + 0.013], [0.032, 0.001, 0.022], POLY_HI, hide);
for (const y of [-0.05, -0.06])
  tubeX(ST, 'sling hole', [0, y, PLATE + 0.018], 0.003, 0.039, SLOT, { sides: 8, ...hide });
add({
  type: 'slab',
  pos: v3([0, -0.022, PLATE + 0.03]),
  size: v3([0.036, 0.104, 0.008]),
  corners: [0.006, 0.006, 0.006, 0.006],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});

// ================= Iron sights: the MP7's own flip-ups on the top rail, from the user's
// reference: a peep ring on a tall flat stem over a clamp with a big knurled knob (rear,
// hidden by an optic), and a post between two tall thin ears (front, stays)
const IS = 'iron sights';
const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);
const KNUCKLE_Y = RAIL_TOP + 0.0062; // the hinge's axis over the clamp

/** A clamp on the rail at z, its top edges bevelled, a hinge knuckle across its top. */
function sightClamp(name, z, len, extra) {
  extrudeZ(
    IS,
    `${name} base`,
    [
      [-0.0105, RAIL_TOP - 0.0005],
      [0.0105, RAIL_TOP - 0.0005],
      [0.0105, RAIL_TOP + 0.0034],
      [0.0085, RAIL_TOP + 0.0054],
      [-0.0085, RAIL_TOP + 0.0054],
      [-0.0105, RAIL_TOP + 0.0034],
    ],
    z - len / 2,
    z + len / 2,
    REC,
    extra,
  );
  for (const s of [1, -1])
    box(
      IS,
      `${name} lug`,
      [s * 0.0052, KNUCKLE_Y - 0.0008, z],
      [0.0022, 0.0046, 0.0068],
      REC,
      extra,
    );
  tubeX(IS, `${name} pin`, [0, KNUCKLE_Y, z], 0.0011, 0.0128, STEEL, { sides: 6, ...extra });
  // A small cross-bolt head on the right.
  tubeX(IS, `${name} bolt`, [0.0112, RAIL_TOP + 0.0018, z], 0.0024, 0.0016, SLOT, {
    sides: 6,
    ...extra,
  });
}

// Rear: clamp, the knurled windage knob on the left, the stem up to a thin ring.
{
  const hide = { hiddenBy: 'optic' };
  sightClamp('rear sight', REAR_Z, 0.014, hide);
  const KX = -(0.0105 + 0.003); // the knob's center
  tubeX(IS, 'rear sight knob', [KX, RAIL_TOP + 0.003, REAR_Z], 0.0058, 0.006, RUBBER, {
    sides: 14,
    ...hide,
  });
  for (let i = 0; i < 14; i++) {
    const a = ((i + 0.5) / 14) * Math.PI * 2;
    box(
      IS,
      'rear sight knob rib',
      [KX, RAIL_TOP + 0.003 + 0.0059 * Math.sin(a), REAR_Z + 0.0059 * Math.cos(a)],
      [0.0056, 0.0008, 0.0008],
      SLOT,
      { roll: 0, pitch: 0, yaw: 0, ...hide },
    );
  }
  tubeX(IS, 'rear sight knob cap', [KX - 0.0031, RAIL_TOP + 0.003, REAR_Z], 0.0026, 0.0006, PIN, {
    sides: 10,
    ...hide,
  });
  tubeX(IS, 'rear sight knuckle', [0, KNUCKLE_Y, REAR_Z], 0.0022, 0.0078, SIGHT_BODY, {
    sides: 8,
    ...hide,
  });
  const R = { rOut: 0.0047, rLip: 0.0036, rHole: 0.0033, half: 0.001 };
  // The stem: flat and thin, narrowing up into the ring.
  extrudeZ(
    IS,
    'rear sight stem',
    rounded(
      [
        [-0.0036, KNUCKLE_Y],
        [0.0036, KNUCKLE_Y],
        [0.0021, SIGHT_Y - R.rOut + 0.0006],
        [-0.0021, SIGHT_Y - R.rOut + 0.0006],
      ],
      0.0005,
    ),
    REAR_Z - R.half,
    REAR_Z + R.half,
    SIGHT_BODY,
    hide,
  );
  // The ring: a thin round plate with a large hole (a ghost ring), a lighter lip toward
  // the eye, a dark bore. Every face panel's pos is the sight point.
  const ring = roundOutline(24);
  const part = (color) => (p) => add({ ...p, name: 'rear sight ring', group: IS, color, ...hide });
  const c = [0, SIGHT_Y];
  const z0 = REAR_Z - R.half;
  const z1 = REAR_Z + R.half;
  ringFaces(part(SIGHT_BODY), {
    outline: ring,
    rOut: R.rOut,
    rIn: R.rLip,
    center: c,
    z: z1,
    back: true,
    color: SIGHT_BODY,
  });
  ringFaces(part(SIGHT_LIP), {
    outline: ring,
    rOut: R.rLip,
    rIn: R.rHole,
    center: c,
    z: z1 + 0.0002,
    back: true,
    color: SIGHT_LIP,
  });
  ringFaces(part(SIGHT_BODY), {
    outline: ring,
    rOut: R.rOut,
    rIn: R.rHole,
    center: c,
    z: z0,
    back: false,
    color: SIGHT_BODY,
  });
  edgeFaces(part(SIGHT_BODY), {
    outline: ring,
    r: R.rOut,
    center: c,
    z0,
    z1,
    outward: true,
    color: SIGHT_BODY,
  });
  edgeFaces(part(BORE), {
    outline: ring,
    r: R.rHole,
    center: c,
    z0,
    z1: z1 + 0.0002,
    outward: false,
    color: BORE,
  });
}

// Front: clamp, a flat blade, two tall thin ears from its corners and the post between them.
{
  sightClamp('front sight', FRONT_Z, 0.012, {});
  tubeX(IS, 'front sight knuckle', [0, KNUCKLE_Y, FRONT_Z], 0.0022, 0.0078, SIGHT_BODY, {
    sides: 8,
  });
  const HALF = 0.0011; // the blade's half thickness
  const BLADE_TOP = SIGHT_Y - 0.0085;
  extrudeZ(
    IS,
    'front sight blade',
    rounded(
      [
        [-0.0042, KNUCKLE_Y],
        [0.0042, KNUCKLE_Y],
        [0.0062, BLADE_TOP],
        [-0.0062, BLADE_TOP],
      ],
      0.0005,
    ),
    FRONT_Z - HALF,
    FRONT_Z + HALF,
    SIGHT_BODY,
  );
  // The ears: thin, rounded on top, rising a little over the post so they guard it.
  for (const s of [1, -1]) {
    const core = [
      [0.0042, BLADE_TOP - 0.001],
      [0.0062, BLADE_TOP - 0.001],
      [0.0058, SIGHT_Y + 0.0026],
      [0.0044, SIGHT_Y + 0.0026],
    ].map(([x, y]) => [s * x, y]);
    extrudeZ(
      IS,
      'front sight wing',
      rounded(s > 0 ? core : [...core].reverse(), 0.0004),
      FRONT_Z - HALF,
      FRONT_Z + HALF,
      SIGHT_BODY,
    );
  }
  // The post, its top on the sight line.
  box(
    IS,
    'front sight post',
    [0, (BLADE_TOP - 0.001 + SIGHT_Y) / 2, FRONT_Z],
    [0.0019, SIGHT_Y - BLADE_TOP + 0.001, 2 * HALF + 0.0004],
    SIGHT_BODY,
  );
}

// ---- Points and mounts
const { factoryFold } = ITEM.model ?? {};
const model = {
  parts,
  grip: [0, -0.064, (SHELL.z0 + SHELL.z1) / 2],
  support: [0, -0.068, FGZ],
  muzzle: [0, B, MUZZLE_Z - 0.04],
  sight: [0, SIGHT_Y, REAR_Z],
  ...(factoryFold && { factoryFold }),
  magwellGrip: true,
  mounts: {
    optic: [0, RAIL_TOP, 0.0],
    muzzle: [0, B, MUZZLE_Z],
    barrel: [0, B, UZ0 - 0.003],
    foregrip: [0, FOREGRIP_Y, FGZ],
    rightRail: [RAIL_X, RAIL_Y, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    grip: [0, LBOT, (WELL.z0 + WELL.z1) / 2],
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
