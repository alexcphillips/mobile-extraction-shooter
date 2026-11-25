// HK-style iron sights shared by the roller-delayed and polymer SMGs (GM-4: mp5, g3; the ump45 takes the ring): the
// drum rear sight and the front post in a full ring hood. Aimed, the ring sits centered in
// the drum's peep with air round it (a ghost ring, docs/guns.md → Iron sights).
//
//   import { hkSights } from './gun-hk.mjs';
//   const hk = hkSights(gunParts());
//   hk.drumRear({ SIGHT_Y, REAR_Z, BASE_Y });
//   hk.ringFront({ SIGHT_Y, FRONT_Z, BASE_Y });
import { v3 } from './gun-kit.mjs';
import { AR } from './gun-ar15.mjs';
import { coreOutline, edgeFaces, ringFaces, roundOutline } from './optic-kit.mjs';

const { REC, PIN, SIGHT_BODY, SIGHT_LIP, BORE } = AR;

/** A closed ring round the sight line at z, its faces and both skins, from panels. */
function fullRing(add, { center, z, rOut, rIn, half, segments, color, name, group, extra = {} }) {
  const outline = roundOutline(segments);
  const part = (p) => add({ ...p, name, group, color, ...extra });
  ringFaces(part, { outline, rOut, rIn, center, z: z + half, back: true, color });
  ringFaces(part, { outline, rOut, rIn, center, z: z - half, back: false, color });
  edgeFaces(part, { outline, r: rOut, center, z0: z - half, z1: z + half, outward: true, color });
  edgeFaces(part, { outline, r: rIn, center, z0: z - half, z1: z + half, outward: false, color });
}

export function hkSights(kit) {
  const { add, box, tubeX, extrudeZ } = kit;
  const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);

  /**
   * The front sight at FRONT_Z: a tower rising from BASE_Y (the top it stands on) into a
   * full ring hood, the post standing on the ring's bottom up to the sight line. Part of the
   * gun: it stays under an optic. `scale` grows the hood and post for a longer sight radius,
   * so the ring fills as much of the peep aimed (the g3's).
   */
  function ringFront({ SIGHT_Y, FRONT_Z, BASE_Y, scale = 1, group = 'iron sights' }) {
    const HOOD = { rOut: 0.0088 * scale, rIn: 0.0068 * scale, half: 0.003 };
    extrudeZ(
      group,
      'front sight tower',
      rounded(
        [
          [-0.0075, BASE_Y],
          [0.0075, BASE_Y],
          [0.0042, SIGHT_Y - HOOD.rOut + 0.001],
          [-0.0042, SIGHT_Y - HOOD.rOut + 0.001],
        ],
        0.0008,
      ),
      FRONT_Z - 0.0042,
      FRONT_Z + 0.0042,
      REC,
    );
    fullRing(add, {
      center: [0, SIGHT_Y],
      z: FRONT_Z,
      ...HOOD,
      segments: 20,
      color: SIGHT_BODY,
      name: 'front sight hood',
      group,
    });
    box(
      group,
      'front sight post foot',
      [0, SIGHT_Y - HOOD.rIn + 0.0012, FRONT_Z],
      [0.0044 * scale, 0.003, 0.0036],
      SIGHT_BODY,
    );
    box(
      group,
      'front sight post',
      [0, (SIGHT_Y - HOOD.rIn + 0.002 + SIGHT_Y) / 2, FRONT_Z],
      [0.0021 * scale, HOOD.rIn - 0.002, 0.0026],
      SIGHT_BODY,
    );
  }

  /**
   * The drum rear sight at REAR_Z, hidden by an optic: two discs lying across the gun either
   * side of the peep (they guard it like ears), on a cradle from BASE_Y; a web below the peep
   * with an index mark toward the eye; the peep a thin ring with a large hole.
   */
  function drumRear({ SIGHT_Y, REAR_Z, BASE_Y, group = 'iron sights' }) {
    const hide = { hiddenBy: 'optic' };
    const DRUM_R = 0.0088;
    const DRUM_HALF = 0.0042; // each disc's half width
    const GAP = 0.0052; // from the sight line to each disc's inner face
    const DRUM_X = GAP + DRUM_HALF;
    extrudeZ(
      group,
      'rear sight cradle',
      rounded(
        [
          [-0.0105, BASE_Y],
          [0.0105, BASE_Y],
          [0.0098, SIGHT_Y - 0.005],
          [-0.0098, SIGHT_Y - 0.005],
        ],
        0.0008,
      ),
      REAR_Z - 0.008,
      REAR_Z + 0.008,
      REC,
      hide,
    );
    for (const s of [1, -1]) {
      tubeX(
        group,
        'rear sight drum',
        [s * DRUM_X, SIGHT_Y, REAR_Z],
        DRUM_R,
        2 * DRUM_HALF,
        SIGHT_BODY,
        {
          sides: 12,
          ...hide,
        },
      );
      // A smaller raised ring and a lighter hub on each disc's outer end.
      tubeX(
        group,
        'rear sight drum rim',
        [s * (DRUM_X + DRUM_HALF + 0.0002), SIGHT_Y, REAR_Z],
        DRUM_R - 0.0016,
        0.0008,
        '#2f3236',
        { sides: 12, ...hide },
      );
      tubeX(
        group,
        'rear sight drum hub',
        [s * (DRUM_X + DRUM_HALF + 0.0007), SIGHT_Y, REAR_Z],
        0.0026,
        0.0008,
        PIN,
        { sides: 8, ...hide },
      );
    }
    box(
      group,
      'rear sight web',
      [0, SIGHT_Y - 0.0062, REAR_Z],
      [2 * GAP + 0.001, 0.005, 0.008],
      SIGHT_BODY,
      hide,
    );
    add({
      type: 'panel',
      pos: v3([0, SIGHT_Y - 0.0068, REAR_Z + 0.0042]),
      pitch: 90,
      size: [0.0008, 0.0022],
      color: SIGHT_LIP,
      name: 'rear sight index',
      group,
      ...hide,
    });
    // The peep: every face panel's pos is the sight point (the content test checks it).
    const A = {
      rOut: 0.0049,
      rHole: 0.0037,
      rLip: 0.004,
      z0: REAR_Z - 0.0035,
      z1: REAR_Z + 0.0035,
    };
    const ring = roundOutline(24);
    const part = (color) => (p) => add({ ...p, name: 'rear sight ring', group, color, ...hide });
    const c = [0, SIGHT_Y];
    ringFaces(part(SIGHT_BODY), {
      outline: ring,
      rOut: A.rOut,
      rIn: A.rLip,
      center: c,
      z: A.z1,
      back: true,
      color: SIGHT_BODY,
    });
    ringFaces(part(SIGHT_LIP), {
      outline: ring,
      rOut: A.rLip,
      rIn: A.rHole,
      center: c,
      z: A.z1 + 0.0002,
      back: true,
      color: SIGHT_LIP,
    });
    ringFaces(part(SIGHT_BODY), {
      outline: ring,
      rOut: A.rOut,
      rIn: A.rHole,
      center: c,
      z: A.z0,
      back: false,
      color: SIGHT_BODY,
    });
    edgeFaces(part(SIGHT_BODY), {
      outline: ring,
      r: A.rOut,
      center: c,
      z0: A.z0,
      z1: A.z1,
      outward: true,
      color: SIGHT_BODY,
    });
    edgeFaces(part(BORE), {
      outline: ring,
      r: A.rHole,
      center: c,
      z0: A.z0,
      z1: A.z1 + 0.0002,
      outward: false,
      color: BORE,
    });
  }

  return { ringFront, drumRear };
}
