// Shared pieces of the `ar15` family's gun models (GM-1, GM-2), lifted from the M416's
// generator so every gun on the platform draws its common parts the same way: the flat-top
// upper, Picatinny rail runs, the lower and its controls, the pistol grip, the buffer tube,
// the birdcage flash hider and the flip-up irons. See docs/guns.md.
//
//   import { arPieces, AR } from './gun-ar15.mjs';
//   const ar = arPieces(gunParts(), { RAIL_TOP: 0.05, ... });
//
// Each piece takes the gun's key sizes; sizes that stay the same across the family (the
// lower's profile, the grip's rake) are fixed here and moved along z by `dz`.
import { r5, teeth, v3 } from './gun-kit.mjs';
import { coreOutline, edgeFaces, ringFaces, roundOutline } from './optic-kit.mjs';

// ---- Colors (two shades plus black, props.md → A black gun still reads in two shades)
export const AR = {
  REC: '#2a2c2f', // anodized receivers, rail teeth
  SLOT: '#161719', // rail bases between teeth, ports, slots
  HG: '#34373b', // handguard (a step lighter than the receivers)
  POLY: '#3a3d41', // grip, stock (polymer)
  POLY_HI: '#45494e', // polymer edges that catch the light
  STEEL: '#202123', // barrel, flash hider, buffer tube
  RUBBER: '#18191a', // butt pad, grip cap
  PIN: '#55585d', // pins, screws, small accents that catch the light
  SIGHT_BODY: '#25272a', // sight housings
  SIGHT_LIP: '#575b61', // lips and index marks that catch the light
  BORE: '#0d0e0f', // inside a peep
};

/** Pieces drawn into `kit` (from gunParts). `rail` holds the rail's heights. */
export function arPieces(kit, rail) {
  const { add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
  const { RAIL_BASE, RAIL_TOP, TEETH_Y0, RAIL_W } = rail;
  const { REC, SLOT, STEEL, PIN, POLY, POLY_HI, RUBBER, SIGHT_BODY, SIGHT_LIP, BORE } = AR;
  const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

  /** The flat-top upper from UZ0 to UZ1, its port, forward assist and charging handle. */
  function upper({ UZ0, UZ1, UW, forwardAssist = true, group = 'upper receiver' }) {
    // Square sides with the top edges chamfered under the rail.
    extrudeZ(
      group,
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
    box(group, 'ejection port', [UW / 2 + 0.0003, 0.02, 0.03], [0.001, 0.014, 0.056], SLOT);
    tubeZ(group, 'dust cover hinge', 0.0105, 0.0, 0.06, 0.0016, PIN, { x: UW / 2 + 0.0008 });
    if (forwardAssist) {
      // Forward assist housing and its button, right rear.
      prism(
        group,
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
      tubeZ(group, 'forward assist', 0.027, 0.1, 0.112, 0.0045, PIN, { x: 0.017 });
    }
    // Brass deflector behind the port.
    prism(
      group,
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
    box(group, 'charging handle', [0, 0.034, UZ1 + 0.008], [0.012, 0.008, 0.018], STEEL);
    box(group, 'charging handle wings', [0, 0.034, UZ1 + 0.0145], [0.04, 0.0085, 0.007], STEEL);
    box(group, 'charging handle latch', [-0.0165, 0.034, UZ1 + 0.009], [0.006, 0.006, 0.01], PIN);
  }

  /** A top rail run: the dark base from z0 to z1 and teeth inset from its ends. */
  function topRail({ name, z0, z1, inset = [0.002, 0.002], dy = 0, color = REC, group = 'rails' }) {
    box(
      group,
      `${name} base`,
      [0, (RAIL_BASE + TEETH_Y0) / 2 + dy, (z0 + z1) / 2],
      [RAIL_W, TEETH_Y0 - RAIL_BASE, z1 - z0],
      SLOT,
    );
    teeth(z0 + inset[0], z1 - inset[1], (z) =>
      box(
        group,
        `${name} tooth`,
        [0, (TEETH_Y0 + RAIL_TOP) / 2 + dy, z],
        [RAIL_W, RAIL_TOP - TEETH_Y0, 0.0053],
        color,
      ),
    );
  }

  /**
   * A short side rail section on the face at x = ±x0, centered at height y: returns the
   * rail item mount's x (outboard by half a rail item's width).
   */
  function sideRail({ s, x0, y, z0, z1, color, group = 'rails' }) {
    box(
      group,
      'side rail base',
      [s * (x0 + 0.003), y, (z0 + z1) / 2],
      [0.006, RAIL_W, z1 - z0],
      SLOT,
    );
    teeth(z0 + 0.002, z1 - 0.002, (z) =>
      box(
        group,
        'side rail tooth',
        [s * (x0 + 0.006 + 0.0022), y, z],
        [0.0048, RAIL_W, 0.0053],
        color,
      ),
    );
    return s * (x0 + 0.022);
  }

  /**
   * A short bottom rail section under a face at y = bot: returns the foregrip mount's y
   * (the teeth's bottom).
   */
  function bottomRail({ bot, z0, z1, color, group = 'rails' }) {
    box(
      group,
      'bottom rail base',
      [0, bot + 0.0005 - 0.003, (z0 + z1) / 2],
      [RAIL_W, 0.006, z1 - z0],
      SLOT,
    );
    const teethY = bot + 0.0005 - 0.006;
    teeth(z0 + 0.002, z1 - 0.002, (z) =>
      box(group, 'bottom rail tooth', [0, teethY - 0.0022, z], [RAIL_W, 0.0048, 0.0053], color),
    );
    return teethY - 0.0044;
  }

  /** The A2-style birdcage flash hider on the bore at MUZZLE_Z (hidden by a muzzle device). */
  function birdcage({ B, MUZZLE_Z, group = 'flash hider' }) {
    const hide = { hiddenBy: 'muzzle' };
    tubeZ(group, 'flash hider', B, MUZZLE_Z + 0.002, MUZZLE_Z - 0.045, 0.0108, STEEL, {
      sides: 8,
      ...hide,
    });
    tubeZ(group, 'flash hider shoulder', B, MUZZLE_Z + 0.003, MUZZLE_Z - 0.006, 0.0115, STEEL, {
      sides: 8,
      ...hide,
    });
    // Birdcage slots round the front: four, top and sides and the lower diagonals left closed.
    for (const [x, y, w, h] of [
      [0, 0.011, 0.0035, 0.001],
      [0.011, 0, 0.001, 0.0035],
      [-0.011, 0, 0.001, 0.0035],
      [0.0078, 0.0078, 0.0025, 0.0025],
      [-0.0078, 0.0078, 0.0025, 0.0025],
    ])
      box(
        group,
        'flash hider slot',
        [x, B + y, MUZZLE_Z - 0.027],
        [w || 0.001, h || 0.001, 0.024],
        SLOT,
        {
          ...hide,
          ...(x && y ? { roll: x > 0 ? -45 : 45 } : {}),
        },
      );
    tubeZ(group, 'flash hider crown', B, MUZZLE_Z - 0.044, MUZZLE_Z - 0.0465, 0.0085, SLOT, {
      sides: 8,
      ...hide,
    });
  }

  /**
   * The AR lower: its side profile, the magazine well (its mouth at MAG), trigger guard and
   * controls. `well` sets the magazine well's front, depth and widths for other calibers.
   */
  function lower({
    UZ0,
    MAG,
    LW = 0.027,
    dz = 0,
    well = { bottom: -0.0525, z0: -0.066, z1: 0.013, w: [0.0145, 0.0155, 0.0165] },
    group = 'lower receiver',
    color = REC, // a polymer lower (the scar-h's) passes its own
  }) {
    const z = (n) => n + dz;
    // Flat on top under the upper, a tang rising round the buffer tube at the back, sloping
    // down into the grip.
    prism(
      group,
      'lower receiver',
      [
        [-0.0005, UZ0 + 0.002, LW / 2],
        [-0.0005, z(0.128), LW / 2],
        [-0.014, z(0.132), LW / 2],
        [-0.025, z(0.126), LW / 2],
        [-0.0305, z(0.106), LW / 2],
        [-0.0305, z(0.012), LW / 2],
        [-0.012, UZ0 + 0.002, LW / 2],
      ],
      color,
    );
    // Profile points are [y, z, half width]; the well flares a little toward its mouth.
    const [w0, w1, w2] = well.w;
    const { bottom: wb, z0: wz0, z1: wz1 } = well;
    prism(
      group,
      'magazine well',
      [
        [-0.004, z(wz0), w0],
        [-0.004, z(wz1), w0],
        [wb + 0.0065, z(wz1), w1],
        [wb, z(wz1 + 0.001), w2],
        [wb, z(wz0 - 0.005), w2],
        [wb + 0.0125, z(wz0 - 0.003), w1],
      ],
      color,
    );
    box(
      group,
      'magazine well mouth',
      [0, MAG[1] - 0.0003, z((wz0 - 0.005 + wz1 + 0.001) / 2)],
      [2 * w2 - 0.006, 0.001, wz1 - wz0 - 0.001],
      SLOT,
    );
    // Trigger guard and trigger.
    box(group, 'trigger guard', [0, -0.048, z(0.048)], [0.011, 0.004, 0.07], color);
    box(group, 'trigger guard front', [0, -0.039, z(0.0155)], [0.011, 0.018, 0.005], color);
    box(group, 'trigger', [0, -0.039, z(0.044)], [0.005, 0.016, 0.005], STEEL, { pitch: -18 });
    // Controls: selector and bolt catch left, magazine release right, the two takedown pins.
    box(group, 'selector', [-(LW / 2 + 0.001), -0.012, z(0.1)], [0.002, 0.005, 0.018], PIN, {
      pitch: 25,
    });
    tubeX(group, 'selector hub', [-(LW / 2 + 0.0005), -0.012, z(0.1)], 0.004, 0.002, STEEL);
    box(group, 'bolt catch', [-(LW / 2 + 0.0008), -0.008, z(0.013)], [0.0016, 0.012, 0.006], STEEL);
    tubeX(group, 'magazine release', [LW / 2 + 0.0012, -0.022, z(0.02)], 0.0035, 0.003, STEEL);
    tubeX(group, 'front pin', [0, -0.006, z(-0.058)], 0.0026, LW + 0.0016, PIN);
    tubeX(group, 'rear pin', [0, -0.006, z(0.118)], 0.0026, LW + 0.0016, PIN);
  }

  /** The AR pistol grip (factory, hidden by a fitted grip); `swell` adds an A2 finger nub. */
  function pistolGrip({ dz = 0, swell = false, group = 'grip' }) {
    const hide = { hiddenBy: 'grip' };
    const at = (pts) => pts.map(([y, z, w]) => [y, z + dz, w]);
    prism(
      group,
      'pistol grip',
      at([
        [-0.026, 0.079, 0.014],
        [-0.026, 0.115, 0.014],
        [-0.07, 0.134, 0.014],
        [-0.108, 0.148, 0.014],
        [-0.113, 0.141, 0.014],
        [-0.111, 0.118, 0.014],
        [-0.062, 0.092, 0.014],
      ]),
      POLY,
      hide,
    );
    if (swell)
      prism(
        group,
        'grip finger swell',
        at([
          [-0.058, 0.0925, 0.0128],
          [-0.0665, 0.0912, 0.0128],
          [-0.073, 0.0935, 0.0128],
          [-0.082, 0.1, 0.0128],
          [-0.08, 0.106, 0.0128],
          [-0.06, 0.1, 0.0128],
        ]),
        POLY,
        hide,
      );
    prism(
      group,
      'grip cap',
      at([
        [-0.106, 0.117, 0.0145],
        [-0.106, 0.146, 0.0145],
        [-0.1145, 0.149, 0.0145],
        [-0.1155, 0.118, 0.0145],
      ]),
      RUBBER,
      hide,
    );
    // A lighter backstrap edge so the grip's rake reads.
    prism(
      group,
      'grip backstrap',
      at([
        [-0.03, 0.113, 0.0142],
        [-0.03, 0.116, 0.0142],
        [-0.106, 0.149, 0.0142],
        [-0.106, 0.145, 0.0142],
      ]),
      POLY_HI,
      hide,
    );
  }

  /**
   * The carbine buffer tube behind the lower, from z0 (the end plate) to z1. It belongs to the
   * factory stock (`hiddenBy: 'stock'`): every AR stock brings its own (stocks.mjs). A fixed
   * rifle stock covers where the castle nut and end plate would show: `castleNut: false`.
   */
  function bufferTube({ TUBE_Y, z0 = 0.124, z1 = 0.302, castleNut = true, group = 'buffer tube' }) {
    const hide = { hiddenBy: 'stock' };
    if (castleNut) {
      tubeZ(group, 'castle nut', TUBE_Y, z0 + 0.002, z0 + 0.012, 0.0175, SLOT, {
        sides: 8,
        ...hide,
      });
      tubeZ(group, 'end plate', TUBE_Y, z0, z0 + 0.003, 0.0165, STEEL, { sides: 8, ...hide });
    }
    tubeZ(group, 'buffer tube', TUBE_Y, z0 + 0.006, z1, 0.0148, STEEL, { sides: 10, ...hide });
  }

  /** A clamp on the rail: bevelled top edges, a cross-bolt head on the left. */
  function clamp(group, name, z, len, extra) {
    extrudeZ(
      group,
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
    tubeX(group, `${name} bolt`, [-0.0098, RAIL_TOP + 0.0018, z], 0.0021, 0.0014, PIN, {
      sides: 6,
      ...extra,
    });
  }

  /**
   * The flip-up rear sight (hidden by an optic), modeled on the M416's (GM-1): a diopter, one
   * wide housing whose top corners rise into a U-shaped hood, the aperture a small round hole
   * set low between them, behind the hood's face. Rounded and bevelled solids, a real round
   * peep hole built from panels, lighter lips where light catches.
   */
  function flipRear({ SIGHT_Y, REAR_Z, group = 'iron sights' }) {
    const hideRear = { hiddenBy: 'optic' };
    clamp(group, 'rear sight', REAR_Z, 0.016, hideRear);
    tubeX(
      group,
      'rear sight hinge',
      [0, RAIL_TOP + 0.0057, REAR_Z + 0.0035],
      0.0017,
      0.0152,
      STEEL,
      {
        sides: 8,
        ...hideRear,
      },
    );
    const HW_R = 0.0094; // the housing's half width
    const HZ = 0.005; // half its depth
    const FLOOR = SIGHT_Y - 0.003; // the hood's floor, under the aperture
    extrudeZ(
      group,
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
        group,
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
      group,
      ...hideRear,
    });
    add({
      type: 'panel',
      pos: v3([0, FLOOR - 0.0052, REAR_Z + HZ + 0.0006 + 0.0004]),
      pitch: 90,
      size: [0.0008, 0.0022],
      color: SIGHT_LIP,
      name: 'rear sight index',
      group,
      ...hideRear,
    });
    // The aperture: a small ring sunk into the hood, its face behind the hood's face, a real
    // round hole with a dark bore and a lighter lip. Every face panel's pos is the sight point
    // (the test checks the ring is centered on it).
    const A = {
      rOut: 0.0038,
      rHole: 0.0027,
      rLip: 0.003,
      z0: REAR_Z - 0.0035,
      z1: REAR_Z + 0.0035,
    };
    const roundRing = roundOutline(24);
    const ringPart = (name, color) => (p) => add({ ...p, name, group, color, ...hideRear });
    const c = [0, SIGHT_Y];
    ringFaces(ringPart('rear sight ring', SIGHT_BODY), {
      outline: roundRing,
      rOut: A.rOut,
      rIn: A.rLip,
      center: c,
      z: A.z1,
      back: true,
      color: SIGHT_BODY,
    });
    ringFaces(ringPart('rear sight ring', SIGHT_LIP), {
      outline: roundRing,
      rOut: A.rLip,
      rIn: A.rHole,
      center: c,
      z: A.z1 + 0.0002,
      back: true,
      color: SIGHT_LIP,
    });
    ringFaces(ringPart('rear sight ring', SIGHT_BODY), {
      outline: roundRing,
      rOut: A.rOut,
      rIn: A.rHole,
      center: c,
      z: A.z0,
      back: false,
      color: SIGHT_BODY,
    });
    edgeFaces(ringPart('rear sight ring', SIGHT_BODY), {
      outline: roundRing,
      r: A.rOut,
      center: c,
      z0: A.z0,
      z1: A.z1,
      outward: true,
      color: SIGHT_BODY,
    });
    edgeFaces(ringPart('rear sight ring', BORE), {
      outline: roundRing,
      r: A.rHole,
      center: c,
      z0: A.z0,
      z1: A.z1 + 0.0002,
      outward: false,
      color: BORE,
    });
  }

  /**
   * A ring open at the top round the sight line at z, each cut end capped: the hood over a
   * front post (a flip-up's, or an A2 base's ears are built round the same idea).
   */
  function hood({
    SIGHT_Y,
    z,
    rOut,
    rIn,
    half,
    gap,
    name,
    group = 'iron sights',
    color = SIGHT_BODY,
  }) {
    const hoodRing = roundOutline(20);
    const center = [0, SIGHT_Y];
    const up = (x, y) => (Math.abs(Math.atan2(x, y)) * 180) / Math.PI < gap;
    const openQuad = (quad) => up((quad[0][0] + quad[1][0]) / 2, (quad[0][1] + quad[1][1]) / 2);
    const openEdge = (a, b) => up((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const part = (p) => add({ ...p, name, group, color });
    for (const [zz, back] of [
      [z + half, true],
      [z - half, false],
    ])
      ringFaces(part, { outline: hoodRing, rOut, rIn, center, z: zz, back, color, skip: openQuad });
    edgeFaces(part, {
      outline: hoodRing,
      r: rOut,
      center,
      z0: z - half,
      z1: z + half,
      outward: true,
      color,
      skip: openEdge,
    });
    edgeFaces(part, {
      outline: hoodRing,
      r: rIn,
      center,
      z0: z - half,
      z1: z + half,
      outward: false,
      color,
      skip: openEdge,
    });
    const seg = 360 / 20;
    const end = Math.ceil(gap / seg - 0.5) * seg; // the first drawn segment's edge
    for (const s of [1, -1]) {
      const a = (s * end * Math.PI) / 180; // from straight up, + to the right
      const r = (rOut + rIn) / 2;
      box(
        group,
        name,
        [r * Math.sin(a), SIGHT_Y + r * Math.cos(a), z],
        [0.0003, rOut - rIn, half * 2],
        color,
        {
          roll: r5(-s * end),
        },
      );
    }
  }

  /**
   * The flip-up front sight on the rail, as on the M416: a hooded post on a flat blade with a
   * hinge knuckle and a hole, topped by a ring open at the top, the post rising to the ring's
   * center (aimed, the hood sits centered in the rear aperture). It's part of the gun and
   * stays under an optic (the user's call).
   */
  function flipFront({ SIGHT_Y, FRONT_Z, group = 'iron sights' }) {
    clamp(group, 'front sight', FRONT_Z, 0.012, {});
    const HOOD = { rOut: 0.0064, rIn: 0.0046, half: 0.0016, gap: 34 }; // gap: degrees either side of up
    const BLADE_TOP = SIGHT_Y - HOOD.rOut + 0.0008;
    const KNUCKLE_Y = RAIL_TOP + 0.0068;
    tubeX(group, 'front sight knuckle', [0, KNUCKLE_Y, FRONT_Z], 0.0024, 0.0072, SIGHT_BODY, {
      sides: 8,
    });
    tubeX(group, 'front sight pin', [0, KNUCKLE_Y, FRONT_Z], 0.0011, 0.0104, STEEL, { sides: 6 });
    for (const s of [1, -1])
      box(
        group,
        'front sight lug',
        [s * 0.0044, KNUCKLE_Y - 0.0016, FRONT_Z],
        [0.0016, 0.0058, 0.0056],
        REC,
      );
    // The blade: flat, narrowing a little toward the hood.
    extrudeZ(
      group,
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
    // The hole near the blade's top, on the face toward the eye.
    add({
      type: 'panel',
      pos: v3([0, BLADE_TOP - 0.0034, FRONT_Z + HOOD.half + 0.0002]),
      pitch: 90,
      points: roundOutline(10)(0.0011).map(v3),
      color: BORE,
      name: 'front sight hole',
      group,
    });
    hood({ SIGHT_Y, z: FRONT_Z, ...HOOD, name: 'front sight hood', group });
    // The post, from the hood's bottom to its center: the sight line.
    box(
      group,
      'front sight post',
      [0, (SIGHT_Y - HOOD.rIn - 0.0004 + SIGHT_Y) / 2, FRONT_Z],
      [0.0019, HOOD.rIn + 0.0004, 0.0019],
      SIGHT_BODY,
    );
  }

  return {
    upper,
    topRail,
    sideRail,
    bottomRail,
    birdcage,
    lower,
    pistolGrip,
    bufferTube,
    clamp,
    flipRear,
    hood,
    flipFront,
  };
}
