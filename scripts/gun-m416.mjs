// The reference gun (GM-1): the M416's model, built from the gun kit. Kept as the worked
// example for the gun sessions (docs/guns.md): how a gun's constants, profiles, rails, factory
// parts, iron sights and mounts are laid out in code. Replaces only `model` in its item file.
//
//   node scripts/gun-m416.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit). Copy it to the scratchpad to start a new gun.
import { gunParts, octagon, r5, teeth, v3, writeModel } from './gun-kit.mjs';
import { coreOutline, edgeFaces, ringFaces, roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/m416.json', import.meta.url).pathname;

// ---- Colors (two shades plus black, props.md → A black gun still reads in two shades)
const REC = '#2a2c2f'; // anodized receivers, rail teeth
const SLOT = '#161719'; // rail bases between teeth, ports, slots
const HG = '#34373b'; // handguard (a step lighter than the receivers)
const POLY = '#3a3d41'; // grip, stock (polymer)
const POLY_HI = '#45494e'; // polymer edges that catch the light
const STEEL = '#202123'; // barrel, flash hider, buffer tube
const RUBBER = '#18191a'; // butt pad, grip cap
const PIN = '#55585d'; // pins, screws, small accents that catch the light

// ---- Key sizes everything hangs off
const B = 0.012; // bore height
const RAIL_BASE = 0.04; // rail base bottom (sunk 0.5 mm into what it sits on)
const RAIL_TOP = 0.05; // top of the teeth: the optic mount's height
const TEETH_Y0 = 0.0452;
const RAIL_W = 0.0215;
const UZ0 = -0.068; // upper receiver front (inside the handguard)
const UZ1 = 0.124; // upper receiver rear
const UW = 0.0285; // upper width
const HZ0 = -0.338; // handguard front
const HZ1 = -0.066; // handguard rear
const HW = 0.025; // handguard half width
const HTOP = 0.0405;
const HBOT = -0.016;
const MUZZLE_Z = -0.4; // where a muzzle device threads on
// Iron sight line: under the lowest optic's sight, so the front post never covers a dot,
// and low enough that the sights stay in proportion to the gun (the user's call).
const SIGHT_Y = RAIL_TOP + 0.024;
const REAR_Z = 0.108;
const FRONT_Z = -0.318;
const MAG = [0, -0.052, -0.022]; // magazine mount: the magwell's mouth
const TUBE_Y = 0.012; // buffer tube axis
const STOCK = [0, TUBE_Y, 0.18];

const { parts, add, box, tubeZ, tubeX, prism, extrudeZ } = gunParts();

// ================= Upper receiver
const UPPER = 'upper receiver';
// Square sides with the top edges chamfered under the rail.
extrudeZ(
  UPPER,
  'upper receiver',
  [
    [-UW / 2, 0],
    [UW / 2, 0],
    [UW / 2, 0.034],
    [0.0102, 0.04],
    [-0.0102, 0.04],
    [-UW / 2, 0.034],
  ],
  UZ0,
  UZ1,
  REC,
);
// Ejection port and dust cover hinge, on the right (+x).
box(UPPER, 'ejection port', [UW / 2 + 0.0003, 0.02, 0.03], [0.001, 0.014, 0.056], SLOT);
tubeZ(UPPER, 'dust cover hinge', 0.0105, 0.0, 0.06, 0.0016, PIN, { x: UW / 2 + 0.0008 });
// Forward assist housing and its button, right rear.
prism(
  UPPER,
  'forward assist housing',
  [
    [0.016, 0.064, 0.016],
    [0.036, 0.07, 0.016],
    [0.036, 0.1, 0.02],
    [0.016, 0.104, 0.02],
  ],
  REC,
  { x: 0.008 },
);
tubeZ(UPPER, 'forward assist', 0.027, 0.1, 0.112, 0.0045, PIN, { x: 0.017 });
// Brass deflector behind the port.
prism(
  UPPER,
  'brass deflector',
  [
    [0.018, 0.058, 0.004],
    [0.036, 0.058, 0.004],
    [0.036, 0.066, 0.004],
    [0.022, 0.07, 0.004],
  ],
  REC,
  { x: UW / 2 + 0.002 },
);
// Charging handle out the back, its T wings either side of the buffer tube's top.
box(UPPER, 'charging handle', [0, 0.034, UZ1 + 0.008], [0.012, 0.008, 0.018], STEEL);
box(UPPER, 'charging handle wings', [0, 0.034, UZ1 + 0.0145], [0.04, 0.0085, 0.007], STEEL);
box(UPPER, 'charging handle latch', [-0.0165, 0.034, UZ1 + 0.009], [0.006, 0.006, 0.01], PIN);

// ================= Rails: one top rail along the upper and the handguard
const RAILS = 'rails';
box(
  RAILS,
  'top rail base',
  [0, (RAIL_BASE + TEETH_Y0) / 2, (UZ0 + 0.004 + UZ1 - 0.003) / 2],
  [RAIL_W, TEETH_Y0 - RAIL_BASE, UZ1 - 0.003 - UZ0 - 0.004],
  SLOT,
);
box(
  RAILS,
  'handguard rail base',
  [0, (RAIL_BASE + TEETH_Y0) / 2 + 0.0005, (HZ0 + 0.003 + UZ0 + 0.002) / 2],
  [RAIL_W, TEETH_Y0 - RAIL_BASE, UZ0 + 0.002 - HZ0 - 0.003],
  SLOT,
);
teeth(UZ0 + 0.006, UZ1 - 0.005, (z) =>
  box(
    RAILS,
    'top rail tooth',
    [0, (TEETH_Y0 + RAIL_TOP) / 2, z],
    [RAIL_W, RAIL_TOP - TEETH_Y0, 0.0053],
    REC,
  ),
);
teeth(HZ0 + 0.005, UZ0 - 0.002, (z) =>
  box(
    RAILS,
    'handguard rail tooth',
    [0, (TEETH_Y0 + RAIL_TOP) / 2 + 0.0005, z],
    [RAIL_W, RAIL_TOP - TEETH_Y0, 0.0053],
    HG,
  ),
);

// ================= Handguard: an octagonal free-float tube with M-LOK slots
const HAND = 'handguard';
const C = 0.009; // chamfer
const section = octagon;
extrudeZ(HAND, 'handguard', section(HW, HTOP, HBOT, C), HZ0, HZ1, HG);
extrudeZ(
  HAND,
  'handguard end cap',
  section(HW + 0.0006, HTOP + 0.0006, HBOT - 0.0006, C),
  HZ0 - 0.0015,
  HZ0 + 0.004,
  SLOT,
);
// Side slots, both sides, either side of the rail sections.
const SIDE_RAIL_Z = [-0.281, -0.239];
for (const s of [1, -1]) {
  for (const z of [-0.314, -0.205, -0.165, -0.125, -0.089])
    box(HAND, 'm-lok slot', [s * (HW + 0.0002), 0.0125, z], [0.001, 0.0075, 0.03], SLOT);
}
// Bottom slots fore and aft of the bottom rail.
for (const z of [-0.314, -0.125, -0.089])
  box(HAND, 'm-lok slot', [0, HBOT - 0.0002, z], [0.009, 0.001, 0.03], SLOT);
// Short rail sections where the rail slots and the foregrip go.
for (const s of [1, -1]) {
  const x0 = HW - 0.0005;
  box(
    RAILS,
    'side rail base',
    [s * (x0 + 0.003), 0.0125, (SIDE_RAIL_Z[0] + SIDE_RAIL_Z[1]) / 2],
    [0.006, RAIL_W, SIDE_RAIL_Z[1] - SIDE_RAIL_Z[0]],
    SLOT,
  );
  teeth(SIDE_RAIL_Z[0] + 0.002, SIDE_RAIL_Z[1] - 0.002, (z) =>
    box(
      RAILS,
      'side rail tooth',
      [s * (x0 + 0.006 + 0.0022), 0.0125, z],
      [0.0048, RAIL_W, 0.0053],
      HG,
    ),
  );
}
const BOT_RAIL_Z = [-0.27, -0.17];
box(
  RAILS,
  'bottom rail base',
  [0, HBOT + 0.0005 - 0.003, (BOT_RAIL_Z[0] + BOT_RAIL_Z[1]) / 2],
  [RAIL_W, 0.006, BOT_RAIL_Z[1] - BOT_RAIL_Z[0]],
  SLOT,
);
const BOT_TEETH = HBOT + 0.0005 - 0.006;
teeth(BOT_RAIL_Z[0] + 0.002, BOT_RAIL_Z[1] - 0.002, (z) =>
  box(RAILS, 'bottom rail tooth', [0, BOT_TEETH - 0.0022, z], [RAIL_W, 0.0048, 0.0053], HG),
);
// A QD sling cup on the left at the back of the handguard.
tubeX(HAND, 'sling cup', [-(HW + 0.0015), 0.012, -0.1], 0.0055, 0.004, SLOT, { sides: 6 });

// ================= Barrel and flash hider (factory parts)
tubeZ('barrel', 'barrel', B, HZ0 + 0.004, MUZZLE_Z - 0.002, 0.0085, STEEL, {
  sides: 8,
  hiddenBy: 'barrel',
});
const FH = 'flash hider';
tubeZ(FH, 'flash hider', B, MUZZLE_Z + 0.002, MUZZLE_Z - 0.045, 0.0108, STEEL, {
  sides: 8,
  hiddenBy: 'muzzle',
});
tubeZ(FH, 'flash hider shoulder', B, MUZZLE_Z + 0.003, MUZZLE_Z - 0.006, 0.0115, STEEL, {
  sides: 8,
  hiddenBy: 'muzzle',
});
// Birdcage slots round the front: four, top and sides and the lower diagonals left closed.
for (const [x, y, w, h] of [
  [0, 0.011, 0.0035, 0.001],
  [0.011, 0, 0.001, 0.0035],
  [-0.011, 0, 0.001, 0.0035],
  [0.0078, 0.0078, 0.0025, 0.0025],
  [-0.0078, 0.0078, 0.0025, 0.0025],
])
  box(FH, 'flash hider slot', [x, B + y, MUZZLE_Z - 0.027], [w || 0.001, h || 0.001, 0.024], SLOT, {
    hiddenBy: 'muzzle',
    ...(x && y ? { roll: x > 0 ? -45 : 45 } : {}),
  });
tubeZ(FH, 'flash hider crown', B, MUZZLE_Z - 0.044, MUZZLE_Z - 0.0465, 0.0085, SLOT, {
  sides: 8,
  hiddenBy: 'muzzle',
});

// ================= Lower receiver
const LOWER = 'lower receiver';
const LW = 0.027;
// The lower's side profile: flat on top under the upper, a tang rising round the buffer
// tube at the back, sloping down into the grip.
prism(
  LOWER,
  'lower receiver',
  [
    [-0.0005, UZ0 + 0.002, LW / 2],
    [-0.0005, 0.128, LW / 2],
    [-0.014, 0.132, LW / 2],
    [-0.025, 0.126, LW / 2],
    [-0.0305, 0.106, LW / 2],
    [-0.0305, 0.012, LW / 2],
    [-0.012, UZ0 + 0.002, LW / 2],
  ],
  REC,
);
prism(
  LOWER,
  'magazine well',
  [
    [-0.004, -0.066, 0.0145],
    [-0.004, 0.013, 0.0145],
    [-0.046, 0.013, 0.0155],
    [-0.0525, 0.014, 0.0165],
    [-0.0525, -0.071, 0.0165],
    [-0.04, -0.069, 0.0155],
  ],
  REC,
);
box(LOWER, 'magazine well mouth', [0, MAG[1] - 0.0003, -0.0285], [0.027, 0.001, 0.078], SLOT);
// Trigger guard and trigger.
box(LOWER, 'trigger guard', [0, -0.048, 0.048], [0.011, 0.004, 0.07], REC);
box(LOWER, 'trigger guard front', [0, -0.039, 0.0155], [0.011, 0.018, 0.005], REC);
box(LOWER, 'trigger', [0, -0.039, 0.044], [0.005, 0.016, 0.005], STEEL, { pitch: -18 });
// Controls: selector and bolt catch left, magazine release right, the two takedown pins.
box(LOWER, 'selector', [-(LW / 2 + 0.001), -0.012, 0.1], [0.002, 0.005, 0.018], PIN, { pitch: 25 });
tubeX(LOWER, 'selector hub', [-(LW / 2 + 0.0005), -0.012, 0.1], 0.004, 0.002, STEEL);
box(LOWER, 'bolt catch', [-(LW / 2 + 0.0008), -0.008, 0.013], [0.0016, 0.012, 0.006], STEEL);
tubeX(LOWER, 'magazine release', [LW / 2 + 0.0012, -0.022, 0.02], 0.0035, 0.003, STEEL);
tubeX(LOWER, 'front pin', [0, -0.006, -0.058], 0.0026, LW + 0.0016, PIN);
tubeX(LOWER, 'rear pin', [0, -0.006, 0.118], 0.0026, LW + 0.0016, PIN);

// ================= Pistol grip (factory, hidden by a fitted grip)
const GRIP_MOUNT = [0, -0.0305, 0.083];
prism(
  'grip',
  'pistol grip',
  [
    [-0.026, 0.079, 0.014],
    [-0.026, 0.115, 0.014],
    [-0.07, 0.134, 0.014],
    [-0.108, 0.148, 0.014],
    [-0.113, 0.141, 0.014],
    [-0.111, 0.118, 0.014],
    [-0.062, 0.092, 0.014],
  ],
  POLY,
  { hiddenBy: 'grip' },
);
prism(
  'grip',
  'grip cap',
  [
    [-0.106, 0.117, 0.0145],
    [-0.106, 0.146, 0.0145],
    [-0.1145, 0.149, 0.0145],
    [-0.1155, 0.118, 0.0145],
  ],
  RUBBER,
  { hiddenBy: 'grip' },
);
// A lighter backstrap edge so the grip's rake reads.
prism(
  'grip',
  'grip backstrap',
  [
    [-0.03, 0.113, 0.0142],
    [-0.03, 0.116, 0.0142],
    [-0.106, 0.149, 0.0142],
    [-0.106, 0.145, 0.0142],
  ],
  POLY_HI,
  { hiddenBy: 'grip' },
);

// ================= Buffer tube (stays) and the factory stock on it
const BUF = 'buffer tube';
tubeZ(BUF, 'castle nut', TUBE_Y, 0.126, 0.136, 0.0175, SLOT, { sides: 8 });
tubeZ(BUF, 'end plate', TUBE_Y, 0.124, 0.127, 0.0165, STEEL, { sides: 8 });
tubeZ(BUF, 'buffer tube', TUBE_Y, 0.13, 0.302, 0.0148, STEEL, { sides: 10 });
const ST = 'stock';
const SZ0 = STOCK[2];
const SZ1 = 0.3;
const hide = { hiddenBy: 'stock' };
// The sleeve round the tube, chamfered, with a cheek ridge on top.
extrudeZ(
  ST,
  'stock sleeve',
  [
    [-0.0125, -0.006],
    [0.0125, -0.006],
    [0.017, -0.0015],
    [0.017, 0.029],
    [0.012, 0.034],
    [-0.012, 0.034],
    [-0.017, 0.029],
    [-0.017, -0.0015],
  ],
  SZ0,
  SZ1 - 0.002,
  POLY,
  hide,
);
box(ST, 'cheek rest', [0, 0.0355, 0.25], [0.022, 0.004, 0.086], POLY_HI, hide);
// The butt: a deep plate at the back, its front edge raked.
prism(
  ST,
  'stock butt',
  [
    [0.0335, 0.262],
    [0.0355, SZ1],
    [-0.075, SZ1],
    [-0.073, 0.282],
    [-0.02, 0.266],
  ].map(([y, z]) => [y, z, 0.0185]),
  POLY,
  hide,
);
// The toe strut from under the sleeve down to the bottom of the butt.
prism(
  ST,
  'stock strut',
  [
    [-0.004, 0.198],
    [-0.004, 0.214],
    [-0.07, 0.284],
    [-0.072, 0.27],
  ].map(([y, z]) => [y, z, 0.0065]),
  POLY,
  hide,
);
// Storage tubes along both sides, with dark end caps.
for (const s of [1, -1]) {
  tubeZ(ST, 'storage tube', -0.0155, 0.224, SZ1 - 0.001, 0.0085, POLY_HI, {
    x: s * 0.0142,
    sides: 8,
    ...hide,
  });
  tubeZ(ST, 'storage tube cap', -0.0155, 0.219, 0.2245, 0.0072, RUBBER, {
    x: s * 0.0142,
    sides: 6,
    ...hide,
  });
}
add({
  type: 'slab',
  pos: v3([0, -0.0195, SZ1 + 0.0075]),
  size: v3([0.0405, 0.117, 0.015]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
box(ST, 'adjustment lever', [0, -0.008, 0.2], [0.008, 0.005, 0.03], SLOT, hide);
tubeX(ST, 'sling loop', [0, -0.069, 0.29], 0.0032, 0.022, STEEL, hide);

// ================= Iron sights (hidden by an optic): flip-up rear peep and front post
const IRONS = 'iron sights';
// Flip-up sights modeled on the real gun's (GM-1): rounded and bevelled solids, a real round
// peep hole built from panels, lighter lips where light catches.
const hideRear = { hiddenBy: 'optic' };
const SIGHT_BODY = '#25272a'; // sight housings
const SIGHT_LIP = '#575b61'; // lips and index marks that catch the light
const BORE = '#0d0e0f'; // inside the peep
const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

// A clamp on the rail: bevelled top edges, a cross-bolt head on the left.
const clamp = (name, z, len, extra) => {
  extrudeZ(
    IRONS,
    name,
    [
      [-0.0092, RAIL_TOP - 0.0005],
      [0.0092, RAIL_TOP - 0.0005],
      [0.0092, RAIL_TOP + 0.0031],
      [0.0077, RAIL_TOP + 0.0046],
      [-0.0077, RAIL_TOP + 0.0046],
      [-0.0092, RAIL_TOP + 0.0031],
    ],
    z - len / 2,
    z + len / 2,
    REC,
    extra,
  );
  tubeX(IRONS, `${name} bolt`, [-0.0098, RAIL_TOP + 0.0018, z], 0.0021, 0.0014, PIN, {
    sides: 6,
    ...extra,
  });
};

// ---- Rear: a diopter sight. One wide housing whose top corners rise into a U-shaped hood,
// the aperture a small round hole set low between them, behind the hood's face.
clamp('rear sight', REAR_Z, 0.016, hideRear);
tubeX(IRONS, 'rear sight hinge', [0, RAIL_TOP + 0.0057, REAR_Z + 0.0035], 0.0017, 0.0152, STEEL, {
  sides: 8,
  ...hideRear,
});
const HW_R = 0.0094; // the housing's half width
const HZ = 0.005; // half its depth
const FLOOR = SIGHT_Y - 0.003; // the hood's floor, under the aperture
extrudeZ(
  IRONS,
  'rear sight housing',
  rounded(
    [
      [-HW_R + 0.0012, RAIL_TOP + 0.0036],
      [HW_R - 0.0012, RAIL_TOP + 0.0036],
      [HW_R - 0.0016, FLOOR - 0.0012],
      [-HW_R + 0.0016, FLOOR - 0.0012],
    ],
    0.0012,
  ),
  REAR_Z - HZ,
  REAR_Z + HZ,
  SIGHT_BODY,
  hideRear,
);
// The hood's sides: the housing's corners rising either side of the aperture, their inner
// top edges chamfered, the same depth and color as the housing so they read as one piece.
for (const s of [1, -1]) {
  const core = [
    [0.0045, FLOOR - 0.0015],
    [HW_R - 0.0016, FLOOR - 0.0015],
    [HW_R - 0.0019, SIGHT_Y + 0.0028],
    [0.0062, SIGHT_Y + 0.0028],
    [0.0045, SIGHT_Y + 0.0006],
  ].map(([x, y]) => [s * x, y]);
  extrudeZ(
    IRONS,
    'rear sight hood',
    rounded(s > 0 ? core : [...core].reverse(), 0.0006),
    REAR_Z - HZ,
    REAR_Z + HZ,
    SIGHT_BODY,
    hideRear,
  );
}
// The face toward the eye: a recessed panel and an index tick below the hood.
add({
  type: 'panel',
  pos: v3([0, 0, REAR_Z + HZ + 0.0006 + 0.0002]),
  pitch: 90,
  // pitch 90: local z is world −y, so points are [x, −y].
  points: [
    [-0.0062, -(RAIL_TOP + 0.0068)],
    [0.0062, -(RAIL_TOP + 0.0068)],
    [0.0058, -(FLOOR - 0.0034)],
    [-0.0058, -(FLOOR - 0.0034)],
  ].map(v3),
  color: '#1c1e20',
  name: 'rear sight panel',
  group: IRONS,
  ...hideRear,
});
add({
  type: 'panel',
  pos: v3([0, FLOOR - 0.0052, REAR_Z + HZ + 0.0006 + 0.0004]),
  pitch: 90,
  size: [0.0008, 0.0022],
  color: SIGHT_LIP,
  name: 'rear sight index',
  group: IRONS,
  ...hideRear,
});
// The aperture: a small ring sunk into the hood, its face behind the hood's face, a real
// round hole with a dark bore and a lighter lip. Every face panel's pos is the sight point
// (the test checks the ring is centered on it).
const APERTURE = {
  rOut: 0.0038,
  rHole: 0.0027,
  rLip: 0.003,
  z0: REAR_Z - 0.0035,
  z1: REAR_Z + 0.0035,
};
const roundRing = roundOutline(24);
const ringPart = (name, color) => (p) => add({ ...p, name, group: IRONS, color, ...hideRear });
ringFaces(ringPart('rear sight ring', SIGHT_BODY), {
  outline: roundRing,
  rOut: APERTURE.rOut,
  rIn: APERTURE.rLip,
  center: [0, SIGHT_Y],
  z: APERTURE.z1,
  back: true,
  color: SIGHT_BODY,
});
ringFaces(ringPart('rear sight ring', SIGHT_LIP), {
  outline: roundRing,
  rOut: APERTURE.rLip,
  rIn: APERTURE.rHole,
  center: [0, SIGHT_Y],
  z: APERTURE.z1 + 0.0002,
  back: true,
  color: SIGHT_LIP,
});
ringFaces(ringPart('rear sight ring', SIGHT_BODY), {
  outline: roundRing,
  rOut: APERTURE.rOut,
  rIn: APERTURE.rHole,
  center: [0, SIGHT_Y],
  z: APERTURE.z0,
  back: false,
  color: SIGHT_BODY,
});
edgeFaces(ringPart('rear sight ring', SIGHT_BODY), {
  outline: roundRing,
  r: APERTURE.rOut,
  center: [0, SIGHT_Y],
  z0: APERTURE.z0,
  z1: APERTURE.z1,
  outward: true,
  color: SIGHT_BODY,
});
edgeFaces(ringPart('rear sight ring', BORE), {
  outline: roundRing,
  r: APERTURE.rHole,
  center: [0, SIGHT_Y],
  z0: APERTURE.z0,
  z1: APERTURE.z1 + 0.0002,
  outward: false,
  color: BORE,
});

// ---- Front: a hooded post on a flip-up blade, as on the real gun: a flat blade with a
// hinge knuckle and a hole, topped by a ring open at the top, the post rising to the ring's
// center (aimed, the hood sits centered in the rear aperture). It's part of the gun and
// stays under an optic (the user's call); only the rear sight folds away.
clamp('front sight', FRONT_Z, 0.012, {});
const HOOD = { rOut: 0.0064, rIn: 0.0046, half: 0.0016, gap: 34 }; // gap: degrees either side of up
const BLADE_TOP = SIGHT_Y - HOOD.rOut + 0.0008;
const KNUCKLE_Y = RAIL_TOP + 0.0068;
tubeX(IRONS, 'front sight knuckle', [0, KNUCKLE_Y, FRONT_Z], 0.0024, 0.0072, SIGHT_BODY, {
  sides: 8,
});
tubeX(IRONS, 'front sight pin', [0, KNUCKLE_Y, FRONT_Z], 0.0011, 0.0104, STEEL, { sides: 6 });
for (const s of [1, -1])
  box(
    IRONS,
    'front sight lug',
    [s * 0.0044, KNUCKLE_Y - 0.0016, FRONT_Z],
    [0.0016, 0.0058, 0.0056],
    REC,
  );
// The blade: flat, narrowing a little toward the hood.
extrudeZ(
  IRONS,
  'front sight blade',
  rounded(
    [
      [-0.0034, KNUCKLE_Y],
      [0.0034, KNUCKLE_Y],
      [0.0026, BLADE_TOP - 0.0006],
      [-0.0026, BLADE_TOP - 0.0006],
    ],
    0.0006,
  ),
  FRONT_Z - HOOD.half,
  FRONT_Z + HOOD.half,
  SIGHT_BODY,
);
// The hole near the blade's top, on both faces.
for (const back of [true])
  add({
    type: 'panel',
    pos: v3([0, BLADE_TOP - 0.0034, FRONT_Z + (back ? 1 : -1) * (HOOD.half + 0.0002)]),
    pitch: back ? 90 : -90,
    points: roundOutline(10)(0.0011).map(v3),
    color: BORE,
    name: 'front sight hole',
    group: IRONS,
  });
// The hood: a ring open at the top, each cut end capped.
const hoodRing = roundOutline(20);
const center = [0, SIGHT_Y];
const up = (x, y) => (Math.abs(Math.atan2(x, y)) * 180) / Math.PI < HOOD.gap;
const openQuad = (quad) => up((quad[0][0] + quad[1][0]) / 2, (quad[0][1] + quad[1][1]) / 2);
const openEdge = (a, b) => up((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
const hoodPart = (p) => add({ ...p, name: 'front sight hood', group: IRONS, color: SIGHT_BODY });
for (const [z, back] of [
  [FRONT_Z + HOOD.half, true],
  [FRONT_Z - HOOD.half, false],
])
  ringFaces(hoodPart, {
    outline: hoodRing,
    rOut: HOOD.rOut,
    rIn: HOOD.rIn,
    center,
    z,
    back,
    color: SIGHT_BODY,
    skip: openQuad,
  });
edgeFaces(hoodPart, {
  outline: hoodRing,
  r: HOOD.rOut,
  center,
  z0: FRONT_Z - HOOD.half,
  z1: FRONT_Z + HOOD.half,
  outward: true,
  color: SIGHT_BODY,
  skip: openEdge,
});
edgeFaces(hoodPart, {
  outline: hoodRing,
  r: HOOD.rIn,
  center,
  z0: FRONT_Z - HOOD.half,
  z1: FRONT_Z + HOOD.half,
  outward: false,
  color: SIGHT_BODY,
  skip: openEdge,
});
// Caps on the cut ends, where the ring's segments stop either side of the gap.
{
  const seg = 360 / 20;
  const end = Math.ceil(HOOD.gap / seg - 0.5) * seg; // the first drawn segment's edge
  for (const s of [1, -1]) {
    const a = (s * end * Math.PI) / 180; // from straight up, + to the right
    const r = (HOOD.rOut + HOOD.rIn) / 2;
    box(
      IRONS,
      'front sight hood',
      [r * Math.sin(a), SIGHT_Y + r * Math.cos(a), FRONT_Z],
      [0.0003, HOOD.rOut - HOOD.rIn, HOOD.half * 2],
      SIGHT_BODY,
      { roll: r5(-s * end) },
    );
  }
}
// The post, from the hood's bottom to its center: the sight line.
box(
  IRONS,
  'front sight post',
  [0, (SIGHT_Y - HOOD.rIn - 0.0004 + SIGHT_Y) / 2, FRONT_Z],
  [0.0019, HOOD.rIn + 0.0004, 0.0019],
  SIGHT_BODY,
);

// ---- Points and mounts
const model = {
  parts,
  grip: [0, -0.068, 0.112],
  support: [0, -0.022, -0.22],
  muzzle: [0, B, MUZZLE_Z - 0.046],
  sight: [0, SIGHT_Y, REAR_Z],
  mounts: {
    optic: [0, RAIL_TOP, 0.07],
    offsetOptic: [0, RAIL_TOP, -0.01],
    muzzle: [0, B, MUZZLE_Z],
    barrel: [0, B, HZ0],
    foregrip: [0, BOT_TEETH - 0.0044, -0.22],
    leftRail: [-(HW + 0.0105 + 0.011), 0.0125, -0.26],
    rightRail: [HW + 0.0105 + 0.011, 0.0125, -0.26],
    grip: GRIP_MOUNT,
    magazine: MAG,
    stock: STOCK,
  },
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
