// Shared pieces of the `ak` family's gun models (GM-3): the stamped receiver and its controls,
// the railed dust cover (the family takes optics on a top rail over the cover, the user's
// call), the rear sight block, the notch rear sight on the cover rail, the gas block with its
// front sight tower, the handguards, the AK pistol grip and trigger guard. Each gun's own parts (muzzle device,
// stock, magazine well) are in its script. See docs/guns.md.
//
//   import { akPieces, AK } from './gun-ak.mjs';
//   const ak = akPieces(gunParts(), { B: 0.012, RW: 0.0145, ... });
//
// Every piece hangs off the gun's key sizes, passed once: the bore height B, the receiver's
// half width RW, top RTOP and bottom RBOT, the sight line SIGHT_Y. Lengths go by z.
import { v3 } from './gun-kit.mjs';
import { AR, arPieces } from './gun-ar15.mjs';
import { coreOutline, roundOutline } from './optic-kit.mjs';

// ---- Colors: the AR palette (two shades plus black), steel for the stamped receiver.
export const AK = {
  ...AR,
  REC: '#2a2c2f', // receiver, cover, rail teeth
  STEEL: '#202123', // barrel, muzzle device, sight blocks
  BAND: '#26282b', // retainer bands and trunnion ends, a hair off the receiver
};

/** Rail heights over the bore: the cover's rail sits this far above it. */
export const akRail = (B) => {
  const RAIL_BASE = B + 0.0235;
  const TEETH_Y0 = RAIL_BASE + 0.0052;
  return { RAIL_BASE, TEETH_Y0, RAIL_TOP: TEETH_Y0 + 0.0048, RAIL_W: 0.0215 };
};

/** Pieces drawn into `kit` (from gunParts), from the gun's key sizes `g`. */
export function akPieces(kit, g) {
  const { add, box, tubeZ, tubeX, prism } = kit;
  // Hull parts take at most 32 points: a section of at most 16.
  const extrudeZ = (group, name, section, ...rest) => {
    if (section.length > 16) throw new Error(`${name}: ${section.length} points in its section`);
    return kit.extrudeZ(group, name, section, ...rest);
  };
  const { B, RW, RTOP, RBOT, SIGHT_Y } = g;
  const rail = akRail(B);
  const { RAIL_BASE, RAIL_TOP } = rail;
  const ar = arPieces(kit, rail);
  const { REC, SLOT, STEEL, PIN, POLY, POLY_HI, RUBBER, SIGHT_BODY, SIGHT_LIP, BAND } = AK;
  const rounded = (core, r, step = Math.PI / 3) => coreOutline(core, { step })(r);

  /**
   * The stamped receiver from RZ0 to RZ1: square sides, rounded bottom corners, trunnion
   * rivets, the magazine-well dimple, the right side's ejection port, bolt carrier, charging
   * handle and the long selector lever. `port` is the ejection port's [z0, z1].
   */
  function receiver({ RZ0, RZ1, port, dimple = true, group = 'receiver' }) {
    const c = 0.0035;
    extrudeZ(
      group,
      'receiver',
      [
        [-RW, RTOP],
        [-RW, RBOT + c],
        [-RW + c, RBOT],
        [RW - c, RBOT],
        [RW, RBOT + c],
        [RW, RTOP],
      ],
      RZ0,
      RZ1,
      REC,
    );
    // Trunnion ends: a band at each end, a hair proud, so the stamped box reads as riveted.
    for (const [z0, z1] of [
      [RZ0 - 0.0005, RZ0 + 0.026],
      [RZ1 - 0.02, RZ1 + 0.0005],
    ])
      extrudeZ(
        group,
        'trunnion',
        [
          [-RW - 0.0004, RTOP - 0.0005],
          [-RW - 0.0004, RBOT + c],
          [-RW + c, RBOT - 0.0004],
          [RW - c, RBOT - 0.0004],
          [RW + 0.0004, RBOT + c],
          [RW + 0.0004, RTOP - 0.0005],
        ],
        z0,
        z1,
        BAND,
      );
    // Rivet heads through both sides (one cylinder shows on each face).
    const rivet = (y, z) =>
      tubeX(group, 'rivet', [0, y, z], 0.0016, 2 * RW + 0.0016, PIN, { sides: 6 });
    for (const [y, z] of [
      [B - 0.002, RZ0 + 0.008],
      [RBOT + 0.008, RZ0 + 0.008],
      [B + 0.004, RZ0 + 0.019],
      [B - 0.004, RZ1 - 0.01],
      [RBOT + 0.009, RZ1 - 0.01],
    ])
      rivet(y, z);
    // Trigger group pins.
    for (const z of [RZ0 + 0.134, RZ0 + 0.162])
      tubeX(group, 'pin', [0, RBOT + 0.0085, z], 0.0013, 2 * RW + 0.0012, PIN, { sides: 6 });
    // The dimple over the magazine well: a shallow recess, a dark panel a hair proud.
    if (dimple)
      for (const s of [1, -1])
        box(
          group,
          'magazine dimple',
          [s * (RW + 0.0002), B - 0.008, RZ0 + 0.062],
          [0.0006, 0.0075, 0.026],
          SLOT,
        );
    // Right side: ejection port, the bolt carrier in it and the charging handle at its front.
    const [p0, p1] = port;
    box(
      group,
      'ejection port',
      [RW + 0.0002, B + 0.0025, (p0 + p1) / 2],
      [0.0006, 0.012, p1 - p0],
      SLOT,
    );
    box(
      group,
      'bolt carrier',
      [RW + 0.0006, B + 0.004, (p0 + p1) / 2 + 0.006],
      [0.0008, 0.0075, p1 - p0 - 0.016],
      STEEL,
    );
    prism(
      group,
      'charging handle',
      [
        [B + 0.0075, p0 + 0.001],
        [B + 0.0075, p0 + 0.012],
        [B - 0.0005, p0 + 0.012],
        [B - 0.0005, p0 + 0.003],
      ].map(([y, z]) => [y, z, 0.006]),
      STEEL,
      { x: RW + 0.0062 },
    );
    tubeX(
      group,
      'charging handle knob',
      [RW + 0.0135, B + 0.0035, p0 + 0.002],
      0.0047,
      0.006,
      STEEL,
      {
        sides: 8,
      },
    );
    // The selector: a long flat lever closing the port's top, its paddle at the front.
    prism(
      group,
      'selector',
      [
        [RTOP - 0.0012, RZ1 - 0.016],
        [RTOP - 0.0012, p0 + 0.004],
        [RTOP - 0.0085, p0 - 0.002],
        [RTOP - 0.0108, p0 + 0.004],
        [RTOP - 0.0058, RZ1 - 0.024],
      ].map(([y, z]) => [y, z, 0.0006]),
      STEEL,
      { x: RW + 0.0008 },
    );
    tubeX(group, 'selector pivot', [RW + 0.0014, RTOP - 0.0042, RZ1 - 0.018], 0.0026, 0.0014, PIN, {
      sides: 8,
    });
  }

  /**
   * The railed dust cover from z0 to z1 over the receiver: chamfered shoulders under a full
   * top rail, the recoil spring button at its back. Returns the rail's [z0, z1].
   */
  function cover({ z0, z1, group = 'dust cover' }) {
    const w = RW + 0.0009;
    extrudeZ(
      group,
      'dust cover',
      [
        [-w, RTOP - 0.0012],
        [w, RTOP - 0.0012],
        [w, RAIL_BASE - 0.0045],
        [w - 0.0045, RAIL_BASE + 0.0004],
        [-w + 0.0045, RAIL_BASE + 0.0004],
        [-w, RAIL_BASE - 0.0045],
      ],
      z0,
      z1,
      REC,
    );
    // Side flats a step lighter along the shoulders, so the cover reads apart from the receiver.
    for (const s of [1, -1])
      box(
        group,
        'cover rib',
        [s * (w + 0.0002), RTOP + 0.0042, (z0 + z1) / 2 + 0.006],
        [0.0006, 0.0028, z1 - z0 - 0.03],
        BAND,
      );
    tubeZ(group, 'spring button', RTOP + 0.0042, z1 - 0.002, z1 + 0.0035, 0.0028, STEEL, {
      sides: 8,
    });
    const r0 = z0 + 0.004;
    const r1 = z1 - 0.004;
    ar.topRail({ name: 'cover rail', z0: r0, z1: r1, group: 'rails' });
    return [r0, r1];
  }

  /**
   * The rear sight block on the barrel from z0 to z1, ahead of the cover. On the family's
   * railed covers the rear sight is on the rail (railNotch), so the block is bare.
   */
  function rearBlock({ z0, z1, top = RAIL_BASE - 0.002, group = 'receiver' }) {
    extrudeZ(
      group,
      'rear sight block',
      rounded(
        [
          [-0.0108, B - 0.004],
          [0.0108, B - 0.004],
          [0.0108, top - 0.008],
          [0.0078, top - 0.0012],
          [-0.0078, top - 0.0012],
          [-0.0108, top - 0.008],
        ],
        0.0012,
      ),
      z0,
      z1,
      STEEL,
    );
    tubeX(group, 'block pin', [0, top - 0.006, (z0 + z1) / 2], 0.0016, 0.0222, PIN, { sides: 6 });
  }

  /**
   * The rear sight (hidden by an optic) on the back of the cover's rail, near the eye: an
   * AK-style notch and post kept at a distance that reads aimed (the user's call). Flat like
   * the AK's leaf (the user's call): a clamp on the rail, a low ramp rising toward the eye, and
   * at its back a wide thin plate, flat across the top on the sight line, no wings, a U notch
   * with a lighter lip and a tick under it on the face toward the eye, a windage knob on the
   * right.
   */
  function railNotch({ REAR_Z, group = 'iron sights' }) {
    const hide = { hiddenBy: 'optic' };
    ar.clamp(group, 'rear sight', REAR_Z, 0.016, hide);
    const W = 0.0118; // the plate's half width
    const PZ = 0.0014; // the plate's half depth
    const N = 0.0027; // the notch's half width: the front sight's ears fit inside with air
    const ND = 0.0034; // its depth
    const BASE = RAIL_TOP + 0.0042; // the ramp's bottom, on the clamp
    const PLATE = SIGHT_Y - 0.0062; // the plate's bottom
    // The ramp: low at the clamp's front, rising to the plate, its sides drawn in.
    prism(
      group,
      'rear sight ramp',
      [
        [BASE, REAR_Z - 0.0075],
        [BASE, REAR_Z + PZ],
        [PLATE + 0.0006, REAR_Z + PZ],
        [PLATE + 0.0006, REAR_Z - 0.0015],
        [BASE + 0.0022, REAR_Z - 0.0075],
      ].map(([y, z]) => [y, z, W - 0.0022]),
      SIGHT_BODY,
      hide,
    );
    notchPlate({ Z: REAR_Z, PZ, W, N, ND, PLATE, hide, group });
    // Windage knob on the right, a lighter cap.
    tubeX(
      group,
      'rear sight knob',
      [W - 0.0006, PLATE - 0.0026, REAR_Z],
      0.0026,
      0.0036,
      SIGHT_BODY,
      { sides: 10, ...hide },
    );
    tubeX(group, 'rear sight knob', [W + 0.0014, PLATE - 0.0026, REAR_Z], 0.0019, 0.0006, PIN, {
      sides: 10,
      ...hide,
    });
  }

  /**
   * A notch plate at Z (half depth PZ, half width W): flat shoulders on the sight line, a U
   * notch (half width N, depth ND) filleted at its floor, and on the face toward the eye a
   * recessed panel, a lighter lip along the notch's floor and a tick under it.
   */
  function notchPlate({ Z, PZ, W, N, ND, PLATE, hide, group }) {
    const REAR_Z = Z;
    // The shoulders, flat on the sight line from the notch out to the plate's ends.
    for (const s of [1, -1]) {
      const shoulder = [
        [N + 0.0004, PLATE],
        [W - 0.0005, PLATE],
        [W - 0.0005, SIGHT_Y - 0.0004],
        [N + 0.0004, SIGHT_Y - 0.0004],
      ].map(([x, y]) => [s * x, y]);
      extrudeZ(
        group,
        'rear sight shoulder',
        rounded(s > 0 ? shoulder : [...shoulder].reverse(), 0.0004),
        REAR_Z - PZ,
        REAR_Z + PZ,
        SIGHT_BODY,
        hide,
      );
    }
    // The notch's floor, its corners filleted into the shoulders.
    const FLOOR = SIGHT_Y - ND;
    extrudeZ(
      group,
      'rear sight notch',
      rounded(
        [
          [-N - 0.0002, PLATE + 0.0004],
          [N + 0.0002, PLATE + 0.0004],
          [N + 0.0002, FLOOR - 0.0004],
          [-N - 0.0002, FLOOR - 0.0004],
        ],
        0.0004,
      ),
      REAR_Z - PZ,
      REAR_Z + PZ,
      SIGHT_BODY,
      hide,
    );
    for (const s of [1, -1]) {
      const tri = [
        [s * (N + 0.0002), FLOOR - 0.0002],
        [s * (N + 0.0002), FLOOR + 0.0008],
        [s * (N - 0.0008), FLOOR - 0.0002],
      ];
      extrudeZ(
        group,
        'rear sight notch',
        s > 0 ? tri : [...tri].reverse(),
        REAR_Z - PZ,
        REAR_Z + PZ,
        SIGHT_BODY,
        hide,
      );
    }
    // The face toward the eye: a recessed panel, the notch's lip and the tick under it.
    const FACE = REAR_Z + PZ + 0.0002;
    box(
      group,
      'rear sight panel',
      [0, (PLATE + FLOOR) / 2 - 0.0012, FACE],
      [2 * W - 0.006, FLOOR - PLATE - 0.0026, 0.0003],
      '#1c1e20',
      hide,
    );
    box(
      group,
      'rear sight lip',
      [0, FLOOR, FACE + 0.0001],
      [2 * N + 0.0004, 0.0005, 0.0003],
      SIGHT_LIP,
      hide,
    );
    box(
      group,
      'rear sight index',
      [0, FLOOR - 0.0024, FACE + 0.0002],
      [0.0008, 0.0022, 0.0003],
      SIGHT_LIP,
      hide,
    );
  }

  /**
   * The aks-74u's rear sight (hidden by an optic), the user's call: a flip-up L at the very back
   * of the cover rail, closest to the eye, its upright leaf with a wider notch for a fast, open
   * sight picture, the other leaf folded flat ahead of it. A clamp, hinge ears and a knuckle on
   * its pin, the leaf rising from the knuckle to the notch plate.
   */
  function flipNotch({ REAR_Z, group = 'iron sights' }) {
    const hide = { hiddenBy: 'optic' };
    ar.clamp(group, 'rear sight', REAR_Z - 0.004, 0.022, hide);
    const W = 0.0105; // the leaf's half width
    const PZ = 0.0011; // its half depth
    const N = 0.0036; // the notch's half width: wider than the other AKs', for CQB
    const ND = 0.0042;
    const H = RAIL_TOP + 0.0068; // the hinge's axis
    const PLATE = SIGHT_Y - 0.0075; // the notch plate's bottom
    for (const s of [1, -1])
      box(
        group,
        'rear sight hinge ear',
        [s * (W - 0.0005), H - 0.0012, REAR_Z],
        [0.0024, 0.0058, 0.0064],
        REC,
        hide,
      );
    tubeX(group, 'rear sight knuckle', [0, H, REAR_Z], 0.0022, 2 * W - 0.0058, SIGHT_BODY, {
      sides: 10,
      ...hide,
    });
    tubeX(group, 'rear sight pin', [0, H, REAR_Z], 0.0011, 2 * W + 0.0022, PIN, {
      sides: 6,
      ...hide,
    });
    // The upright leaf from the knuckle to the plate, drawn in a little toward the top.
    extrudeZ(
      group,
      'rear sight leaf',
      [
        [-W + 0.0026, H],
        [W - 0.0026, H],
        [W - 0.0012, PLATE + 0.0006],
        [-W + 0.0012, PLATE + 0.0006],
      ],
      REAR_Z - PZ,
      REAR_Z + PZ,
      SIGHT_BODY,
      hide,
    );
    notchPlate({ Z: REAR_Z, PZ, W, N, ND, PLATE, hide, group });
    // The other leaf, folded flat ahead of the knuckle, its small notch dark at the far end.
    box(
      group,
      'rear sight folded leaf',
      [0, H + 0.0004, REAR_Z - 0.0085],
      [2 * W - 0.006, 0.0016, 0.012],
      SIGHT_BODY,
      hide,
    );
    box(
      group,
      'rear sight folded notch',
      [0, H + 0.0013, REAR_Z - 0.0135],
      [0.0026, 0.0004, 0.0024],
      SLOT,
      hide,
    );
  }

  /**
   * The gas block from z0 to z1 round the barrel and the gas tube, its front sight on top: a
   * tower rising to the sight line, the post on its drum between two protective ears. It's
   * part of the gun, so the front sight stays under an optic and with any barrel.
   */
  function gasBlock({ z0, z1, TUBE_Y, FRONT_Z, front = 'post', group = 'gas block' }) {
    const ring = (cx, cy, r, n = 8) => roundOutline(n)(r).map(([x, y]) => [x + cx, y + cy]);
    extrudeZ(
      group,
      'gas block',
      hull2d([...ring(0, B, 0.0118), ...ring(0, TUBE_Y, 0.0098)]),
      z0,
      z1,
      STEEL,
    );
    tubeX(group, 'gas block pin', [0, B + 0.0005, z0 + 0.006], 0.0016, 0.0246, PIN, { sides: 6 });
    const BASE = TUBE_Y + 0.0096; // the block's top
    // A shotgun's bead (the saiga-12, the user's call): a low pad, a short stem and a light
    // bead just over the rail line, the rail itself the rib it's aimed along.
    if (front === 'bead') {
      extrudeZ(
        'iron sights',
        'front sight base',
        rounded(
          [
            [-0.0056, BASE - 0.0024],
            [0.0056, BASE - 0.0024],
            [0.004, BASE + 0.0014],
            [-0.004, BASE + 0.0014],
          ],
          0.0008,
        ),
        FRONT_Z - 0.006,
        FRONT_Z + 0.006,
        SIGHT_BODY,
      );
      const BEAD = 0.0056; // the bead's height: big enough to pick up fast at its distance
      const STEM = [BASE + 0.001, SIGHT_Y - BEAD + 0.0004];
      add({
        type: 'cylinder',
        pos: v3([0, (STEM[0] + STEM[1]) / 2, FRONT_Z]),
        radius: 0.0022,
        height: STEM[1] - STEM[0],
        sides: 8,
        color: SIGHT_BODY,
        name: 'front sight stem',
        group: 'iron sights',
      });
      add({
        type: 'cylinder',
        pos: v3([0, SIGHT_Y - BEAD / 2, FRONT_Z]),
        radius: 0.0042,
        radiusTop: 0.003,
        height: BEAD,
        sides: 10,
        color: SIGHT_LIP,
        name: 'front sight post',
        group: 'iron sights',
      });
      return;
    }
    const TOP = SIGHT_Y - 0.0098; // the tower's top: the ears and drum stand on it
    const FZ = 0.0055; // the ears' half depth
    // The tower: wide at the block, drawn in toward the top, its back face raked.
    prism(
      'iron sights',
      'front sight tower',
      [
        [BASE - 0.002, FRONT_Z - FZ - 0.003, 0.0094],
        [BASE - 0.002, FRONT_Z + FZ + 0.0045, 0.0094],
        [TOP, FRONT_Z + FZ + 0.0008, 0.0088],
        [TOP, FRONT_Z - FZ - 0.0008, 0.0088],
      ],
      SIGHT_BODY,
    );
    // The ears: inner faces upright, outer faces drawn in toward rounded tops a little over
    // the post, so aimed the post stands in clear air between them.
    const EAR_IN = 0.0044;
    for (const s of [1, -1]) {
      const core = [
        [EAR_IN + 0.0006, TOP - 0.001],
        [0.0088 - 0.0006, TOP - 0.001],
        [0.0072, SIGHT_Y + 0.0016],
        [EAR_IN + 0.0006, SIGHT_Y + 0.0016],
      ].map(([x, y]) => [s * x, y]);
      extrudeZ(
        'iron sights',
        'front sight ear',
        rounded(s > 0 ? core : [...core].reverse(), 0.0006),
        FRONT_Z - FZ,
        FRONT_Z + FZ,
        SIGHT_BODY,
      );
    }
    // The post on its drum (the elevation drum), the post's top on the sight line.
    add({
      type: 'cylinder',
      pos: v3([0, TOP + 0.002, FRONT_Z]),
      radius: 0.003,
      height: 0.004,
      sides: 10,
      color: SIGHT_BODY,
      name: 'front sight drum',
      group: 'iron sights',
    });
    const P0 = TOP + 0.0038;
    box(
      'iron sights',
      'front sight post',
      [0, (P0 + SIGHT_Y) / 2, FRONT_Z],
      [0.003, SIGHT_Y - P0, 0.003],
      SIGHT_BODY,
    );
    box(
      'iron sights',
      'front sight lip',
      [0, SIGHT_Y - 0.0005, FRONT_Z + 0.0016],
      [0.003, 0.001, 0.0003],
      SIGHT_LIP,
    );
  }

  /**
   * The gas tube's upper handguard from z0 (front) to z1 over a tube at TUBE_Y: rounded on
   * top, wider at its base, a cooling vent run along each side.
   */
  function upperHandguard({ z0, z1, TUBE_Y, half = 0.0128, color = POLY, group = 'handguard' }) {
    const bot = B + 0.0075;
    const top = TUBE_Y + 0.0112;
    extrudeZ(
      group,
      'upper handguard',
      rounded(
        [
          [-half + 0.001, bot + 0.001],
          [half - 0.001, bot + 0.001],
          [half - 0.002, top - 0.006],
          [half - 0.0065, top - 0.001],
          [-half + 0.0065, top - 0.001],
          [-half + 0.002, top - 0.006],
        ],
        0.001,
        Math.PI / 2,
      ),
      z0,
      z1,
      color,
    );
    for (const s of [1, -1])
      box(
        group,
        'handguard vent',
        [s * (half - 0.0006), TUBE_Y - 0.002, (z0 + z1) / 2],
        [0.0008, 0.0026, (z1 - z0) * 0.62],
        SLOT,
        {
          yaw: s * -2.2,
        },
      );
  }

  /**
   * The lower handguard from z0 (front) to z1: a deep rounded U under the barrel, wide at the
   * hands, its top at the bore line. `rails` adds the short sections the foregrip and rail
   * items mount on: { bottom: [z0, z1], side: { y, z: [z0, z1], sides: [1] } }. Returns the
   * foregrip mount's y and each side rail item's x.
   */
  function lowerHandguard({
    z0,
    z1,
    HW,
    HBOT,
    rails,
    color = POLY,
    ribs = 0,
    group = 'handguard',
  }) {
    const top = B + 0.0085;
    extrudeZ(
      group,
      'lower handguard',
      rounded(
        [
          [-HW + 0.002, HBOT + 0.012],
          [-HW + 0.008, HBOT + 0.002],
          [HW - 0.008, HBOT + 0.002],
          [HW - 0.002, HBOT + 0.012],
          [HW - 0.002, top - 0.001],
          [-HW + 0.002, top - 0.001],
        ],
        0.002,
        Math.PI / 2,
      ),
      z0,
      z1,
      color,
    );
    // Ribs along the sides (a step lighter), like the 74's handguard.
    for (let i = 0; i < ribs; i++)
      for (const s of [1, -1])
        box(
          group,
          'handguard rib',
          [s * (HW + 0.0002), top - 0.006 - i * 0.0055, (z0 + z1) / 2],
          [0.0008, 0.0022, z1 - z0 - 0.024],
          POLY_HI,
        );
    let foregripY;
    if (rails?.bottom) {
      foregripY = ar.bottomRail({ bot: HBOT, z0: rails.bottom[0], z1: rails.bottom[1], color });
    }
    const railX = {};
    if (rails?.side)
      for (const s of rails.side.sides ?? [1])
        railX[s] = ar.sideRail({
          s,
          x0: HW - 0.0005,
          y: rails.side.y,
          z0: rails.side.z[0],
          z1: rails.side.z[1],
          color,
        });
    return { foregripY, railX };
  }

  /** The retainer band round the lower handguard's front at z, its lever on the right. */
  function retainer({ z, HW, HBOT, group = 'handguard' }) {
    const top = B + 0.0105;
    extrudeZ(
      group,
      'handguard retainer',
      rounded(
        [
          [-HW + 0.0018, HBOT + 0.012],
          [-HW + 0.0078, HBOT + 0.0018],
          [HW - 0.0078, HBOT + 0.0018],
          [HW - 0.0018, HBOT + 0.012],
          [HW - 0.0018, top - 0.001],
          [-HW + 0.0018, top - 0.001],
        ],
        0.0026,
        Math.PI / 2,
      ),
      z - 0.004,
      z + 0.004,
      BAND,
    );
    box(
      group,
      'retainer lever',
      [HW + 0.0012, B + 0.002, z + 0.006],
      [0.0016, 0.004, 0.016],
      STEEL,
    );
  }

  /**
   * The AK pistol grip (factory, hidden by a fitted grip) with its top front at [RBOT, z]:
   * raked back, swelled at the palm, a dark cap. Returns the grip mount.
   */
  function pistolGrip({ z, group = 'grip' }) {
    const hide = { hiddenBy: 'grip' };
    const y = RBOT + 0.0015;
    prism(
      group,
      'pistol grip',
      [
        [y, z, 0.0118],
        [y, z + 0.033, 0.0118],
        [y - 0.046, z + 0.051, 0.0142],
        [y - 0.088, z + 0.064, 0.0132],
        [y - 0.091, z + 0.06, 0.0128],
        [y - 0.091, z + 0.034, 0.0128],
        [y - 0.05, z + 0.016, 0.0142],
        [y - 0.012, z + 0.002, 0.0124],
      ],
      POLY,
      hide,
    );
    // Finger texture: a few dark grooves down the front strap.
    for (let i = 0; i < 4; i++) {
      const t = 0.18 + i * 0.17;
      box(
        group,
        'grip groove',
        [0, y - 0.012 - t * 0.075, z + 0.004 + t * 0.03],
        [0.018, 0.0016, 0.0016],
        SLOT,
        {
          pitch: -21,
          ...hide,
        },
      );
    }
    prism(
      group,
      'grip cap',
      [
        [y - 0.0895, z + 0.0335, 0.0122],
        [y - 0.0895, z + 0.0615, 0.0122],
        [y - 0.093, z + 0.0605, 0.0122],
        [y - 0.093, z + 0.0345, 0.0122],
      ],
      RUBBER,
      hide,
    );
    return [0, RBOT, z];
  }

  /**
   * The stamped trigger guard from the magazine catch at z0 to the grip at z1, the catch's
   * paddle at its front and the trigger inside.
   */
  function triggerGuard({ z0, z1, group = 'trigger' }) {
    const y = RBOT - 0.023;
    box(group, 'trigger guard', [0, y, (z0 + z1) / 2], [0.0085, 0.0026, z1 - z0], STEEL);
    prism(
      group,
      'trigger guard',
      [
        [RBOT + 0.001, z0 + 0.004],
        [RBOT + 0.001, z0 + 0.008],
        [y, z0 + 0.012],
        [y, z0 + 0.006],
      ].map(([yy, zz]) => [yy, zz, 0.0042]),
      STEEL,
    );
    prism(
      group,
      'trigger guard',
      [
        [RBOT + 0.001, z1 - 0.003],
        [RBOT + 0.001, z1 + 0.001],
        [y + 0.001, z1],
        [y + 0.001, z1 - 0.006],
      ].map(([yy, zz]) => [yy, zz, 0.0042]),
      STEEL,
    );
    // The magazine catch paddle, ahead of the guard, and the trigger.
    prism(
      group,
      'magazine catch',
      [
        [RBOT + 0.001, z0 - 0.002],
        [RBOT + 0.001, z0 + 0.004],
        [RBOT - 0.017, z0 + 0.001],
        [RBOT - 0.017, z0 - 0.004],
      ].map(([yy, zz]) => [yy, zz, 0.006]),
      STEEL,
    );
    prism(
      group,
      'trigger',
      [
        [RBOT + 0.001, z0 + 0.03],
        [RBOT + 0.001, z0 + 0.036],
        [RBOT - 0.013, z0 + 0.04],
        [RBOT - 0.017, z0 + 0.037],
        [RBOT - 0.012, z0 + 0.033],
      ].map(([yy, zz]) => [yy, zz, 0.0028]),
      PIN,
    );
  }

  return {
    rail,
    ar,
    receiver,
    cover,
    rearBlock,
    railNotch,
    flipNotch,
    gasBlock,
    upperHandguard,
    lowerHandguard,
    retainer,
    pistolGrip,
    triggerGuard,
  };
}

/** The convex hull of 2-D points, counter-clockwise (monotone chain). */
export function hull2d(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
      upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * A whole AK rifle body on the family's layout, laid out from the receiver's front RZ0: the
 * receiver from RZ0 to RZ1, the railed cover, the bare rear sight block, the notch at the
 * rail's back, the barrel, gas tube and gas block (GZ: [front, rear]), the handguards (the
 * lower one's front at HZ0), the grip and trigger guard. The factory barrel runs from the gas
 * block to MUZZLE_Z (hidden by a barrel). Each gun adds its muzzle device and stock. Returns
 * the pieces and the model's points and mounts, so a gun can move any of them.
 */
export function akRifle(kit, g) {
  const { B, RBOT, RZ0, RZ1, GZ, HZ0, HW, HBOT, MUZZLE_Z, TUBE_Y = B + 0.0205 } = g;
  const { STEEL } = AK;
  const { RAIL_TOP } = akRail(B);
  // The irons: the family's flat notch, the aks-74u's flip-up, or the saiga-12's bead on the
  // rail's rib (its line just over the rail).
  const irons = g.irons ?? 'notch';
  const SIGHT_Y = g.SIGHT_Y ?? RAIL_TOP + (irons === 'bead' ? 0.008 : 0.02);
  const ak = akPieces(kit, { ...g, SIGHT_Y });
  const { tubeZ } = kit;
  const RSB = [RZ0 - 0.062, RZ0 + 0.004];
  const REAR_Z = RZ1 - (irons === 'flip' ? 0.006 : 0.012);
  const FRONT_Z = (GZ[0] + GZ[1]) / 2;
  ak.receiver({ RZ0, RZ1, port: [RZ0 + 0.072, RZ0 + 0.158], dimple: g.dimple ?? true });
  ak.cover({ z0: RSB[1] - 0.003, z1: RZ1 + 0.005 });
  ak.rearBlock({ z0: RSB[0], z1: RSB[1] });
  if (irons === 'notch') ak.railNotch({ REAR_Z });
  if (irons === 'flip') ak.flipNotch({ REAR_Z });
  // The barrel under the handguards stays; the run ahead of the gas block is the factory
  // barrel (hidden by a fitted barrel).
  tubeZ('barrel', 'barrel', B, RZ0 + 0.01, GZ[1], 0.0086, STEEL, { sides: 8 });
  if (MUZZLE_Z < GZ[0] - 0.004)
    tubeZ('barrel', 'barrel', B, GZ[0] + 0.002, MUZZLE_Z - 0.002, g.BARREL_R ?? 0.0079, STEEL, {
      sides: 8,
      hiddenBy: g.barrelSlot === false ? undefined : 'barrel',
    });
  tubeZ('gas block', 'gas tube', TUBE_Y, RSB[0] + 0.002, GZ[1] + 0.002, 0.0082, STEEL, {
    sides: 8,
  });
  ak.gasBlock({ z0: GZ[0], z1: GZ[1], TUBE_Y, FRONT_Z, front: irons === 'bead' ? 'bead' : 'post' });
  ak.upperHandguard({ z0: GZ[1] + 0.003, z1: RSB[0] - 0.001, TUBE_Y });
  const FG = g.FOREGRIP_Z ?? HZ0 + 0.064; // the foregrip's middle
  const RAIL_Z = g.RAIL_Z ?? HZ0 + 0.043; // the side rail's middle
  const { foregripY, railX } = ak.lowerHandguard({
    z0: HZ0,
    z1: RZ0 - 0.002,
    HW,
    HBOT,
    ribs: g.ribs ?? 0,
    rails: {
      bottom: [FG - 0.046, FG + 0.046],
      side: { y: B - 0.0045, z: [RAIL_Z - 0.021, RAIL_Z + 0.021], sides: g.railSides ?? [1] },
    },
  });
  ak.retainer({ z: HZ0 - 0.004, HW, HBOT });
  const GRIP_Z = RZ0 + 0.177;
  const gripMount = ak.pistolGrip({ z: GRIP_Z });
  ak.triggerGuard({ z0: RZ0 + 0.1, z1: GRIP_Z - 0.001 });
  const mounts = {
    optic: [0, RAIL_TOP, RZ1 - 0.066],
    offsetOptic: [0, RAIL_TOP, RZ0 + 0.075],
    muzzle: [0, B, MUZZLE_Z],
    barrel: [0, B, GZ[0]],
    foregrip: [0, foregripY, FG],
    leftRail: railX[-1] ? [railX[-1], B - 0.0045, RAIL_Z] : undefined,
    rightRail: [railX[1], B - 0.0045, RAIL_Z],
    grip: gripMount,
    magazine: [0, RBOT, RZ0 + 0.063],
    stock: [0, B - 0.008, RZ1],
  };
  return {
    ak,
    RAIL_TOP,
    SIGHT_Y,
    REAR_Z,
    grip: [0, RBOT - 0.046, GRIP_Z + 0.022],
    support: [0, HBOT - 0.001, FG + 0.001],
    sight: [0, SIGHT_Y, REAR_Z],
    mounts,
  };
}

/**
 * Only the mounts the gun has slots for, in slot order, so the model lists no mount for a
 * slot the gun doesn't take.
 */
export function mountsFor(slots, mounts) {
  return Object.fromEntries(slots.filter((s) => mounts[s]).map((s) => [s, mounts[s]]));
}

/**
 * The fold settings already in a gun's model (`stockFold`, `factoryFold`): they're the gun's
 * own hinge, kept when the model is rebuilt.
 */
export function keptFolds(item) {
  const { stockFold, factoryFold } = item.model ?? {};
  return { ...(stockFold && { stockFold }), ...(factoryFold && { factoryFold }) };
}
