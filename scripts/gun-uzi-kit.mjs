// Shared pieces of the `uzi` platform's models (GM-4b: uzi, uzi-pro), drawn into a gun kit
// from each gun's own sizes: the barrel and its nut, the pistol grip the magazine goes up
// through (part of the gun: neither has a grip slot) with its grip safety, the rear sight (a
// ghost-ring peep on a blade between two guards) and the front post between ears (the ak
// kit's tower, on the receiver's top). Each gun's script draws its receiver, lower and stock.
// See docs/guns.md.
//
//   import { UZI, uziPieces } from './gun-uzi-kit.mjs';
import { r5, v3 } from './gun-kit.mjs';
import { AK, akPieces } from './gun-ak.mjs';
import { coreOutline, edgeFaces, ringFaces, roundOutline } from './optic-kit.mjs';

export const UZI = { ...AK };

/** Pieces drawn into `kit` (from gunParts), from the gun's bore B, sight line and widths. */
export function uziPieces(kit, g) {
  const { add, box, tubeZ, tubeX, prism, extrudeZ } = kit;
  const { B, RW, RTOP, RBOT, SIGHT_Y } = g;
  const { STEEL, SLOT, PIN, POLY, RUBBER, REC, SIGHT_BODY, SIGHT_LIP, BORE } = UZI;
  const rounded = (core, r) => coreOutline(core, { step: Math.PI / 4 })(r);
  const ak = akPieces(kit, { B, RW, RTOP, RBOT, SIGHT_Y });

  /** The barrel from the receiver's front z0 to the muzzle, its knurled nut at z0. */
  function barrel({ z0, MUZZLE_Z, r = 0.0078, nutR = 0.0175 }) {
    tubeZ('barrel', 'barrel', B, z0 + 0.004, MUZZLE_Z - 0.0015, r, STEEL, { sides: 8 });
    tubeZ('barrel', 'barrel nut', B, z0 - 0.014, z0 + 0.003, nutR, STEEL, { sides: 12 });
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 + 30) * (Math.PI / 180);
      box('barrel', 'nut notch', [Math.sin(a) * (nutR - 0.001), B + Math.cos(a) * (nutR - 0.001), z0 - 0.0055], [0.004, 0.0024, 0.017], SLOT, { roll: r5(-(i * 60 + 30)) });
    }
  }

  /**
   * The pistol grip from its top at [top, z] (z its front), raked by `rake`, `depth` deep,
   * the magazine going up through it: a hull, a dark seam where the halves meet, the grip
   * safety down its back, a heel at its foot round the magazine's mouth. Returns the foot's y.
   */
  function grip({ top, z, depth, rake, len = 0.044, w = 0.0145, color = POLY }) {
    const foot = top - depth;
    prism(
      'grip',
      'pistol grip',
      [
        [top, z],
        [top, z + len],
        [foot + 0.004, z + len + rake],
        [foot, z + len + rake - 0.004],
        [foot, z + rake],
        [foot + 0.004, z + rake - 0.002],
      ].map(([y, zz]) => [y, zz, w]),
      color,
    );
    for (const s of [1, -1])
      box('grip', 'grip panel', [s * (w + 0.0002), top - depth * 0.5, z + len / 2 + rake / 2], [0.0006, depth * 0.62, len * 0.62], '#323539', {
        pitch: r5((-Math.atan2(rake, depth) * 180) / Math.PI),
      });
    // The grip safety, a lever down the back.
    prism(
      'grip',
      'grip safety',
      [
        [top - 0.006, z + len + 0.0005],
        [top - 0.006, z + len + 0.006],
        [top - depth * 0.62, z + len + rake * 0.62 + 0.006],
        [top - depth * 0.62, z + len + rake * 0.62 + 0.0005],
      ].map(([y, zz]) => [y, zz, w - 0.004]),
      STEEL,
    );
    box('grip', 'magazine heel', [0, foot - 0.002, z + rake + len / 2], [2 * w + 0.002, 0.004, len + 0.004], REC);
    return foot - 0.004;
  }

  /**
   * The rear sight (hidden by an optic when `hide`): a ghost-ring peep on a thin blade at
   * REAR_Z, between two guards rising from a base on `base` (the surface under it).
   */
  function peepRear({ REAR_Z, base, hide = false, W = 0.0118 }) {
    const h = hide ? { hiddenBy: 'optic' } : {};
    const IS = 'iron sights';
    const A = { rOut: 0.0066, rLip: 0.0058, rHole: 0.0054 };
    extrudeZ(
      IS,
      'rear sight base',
      rounded(
        [
          [-W, base - 0.0005],
          [W, base - 0.0005],
          [W - 0.001, base + 0.004],
          [-W + 0.001, base + 0.004],
        ],
        0.001,
      ),
      REAR_Z - 0.008,
      REAR_Z + 0.006,
      SIGHT_BODY,
      h,
    );
    // The guards: tall, their inner faces upright, outer faces drawn in to rounded tops.
    for (const s of [1, -1]) {
      const core = [
        [0.0078, base + 0.003],
        [W - 0.0012, base + 0.003],
        [W - 0.0026, SIGHT_Y + 0.003],
        [0.0078, SIGHT_Y + 0.003],
      ].map(([x, y]) => [s * x, y]);
      extrudeZ(IS, 'rear sight guard', rounded(s > 0 ? core : [...core].reverse(), 0.0009), REAR_Z - 0.006, REAR_Z + 0.004, SIGHT_BODY, h);
    }
    // The blade up to the ring, and its hinge across the base.
    extrudeZ(
      IS,
      'rear sight blade',
      rounded(
        [
          [-0.0032, base + 0.003],
          [0.0032, base + 0.003],
          [0.0028, SIGHT_Y - A.rOut + 0.001],
          [-0.0028, SIGHT_Y - A.rOut + 0.001],
        ],
        0.0006,
      ),
      REAR_Z - 0.0012,
      REAR_Z + 0.0012,
      SIGHT_BODY,
      h,
    );
    tubeX(IS, 'rear sight hinge', [0, base + 0.0045, REAR_Z], 0.0022, 0.012, STEEL, { sides: 8, ...h });
    const ringPart = (name, color) => (p) => add({ ...p, name, group: IS, color, ...h });
    const c = [0, SIGHT_Y];
    const ring = roundOutline(20);
    const z0 = REAR_Z - 0.0012;
    const z1 = REAR_Z + 0.0012;
    ringFaces(ringPart('rear sight ring', SIGHT_BODY), { outline: ring, rOut: A.rOut, rIn: A.rLip, center: c, z: z1, back: true, color: SIGHT_BODY });
    ringFaces(ringPart('rear sight ring', SIGHT_LIP), { outline: ring, rOut: A.rLip, rIn: A.rHole, center: c, z: z1 + 0.0002, back: true, color: SIGHT_LIP });
    ringFaces(ringPart('rear sight ring', SIGHT_BODY), { outline: ring, rOut: A.rOut, rIn: A.rHole, center: c, z: z0, back: false, color: SIGHT_BODY });
    edgeFaces(ringPart('rear sight ring', SIGHT_BODY), { outline: ring, r: A.rOut, center: c, z0, z1, outward: true, color: SIGHT_BODY });
    edgeFaces(ringPart('rear sight ring', BORE), { outline: ring, r: A.rHole, center: c, z0, z1: z1 + 0.0002, outward: false, color: BORE });
  }

  /**
   * The front post between ears on the receiver's top at FRONT_Z: the ak kit's tower, its
   * base sunk into a surface at `base`. It stays under an optic.
   */
  function frontPost({ FRONT_Z, base }) {
    ak.gasBlock({ z0: FRONT_Z - 0.008, z1: FRONT_Z + 0.008, TUBE_Y: base - 0.0096 + 0.0004, FRONT_Z });
  }

  /** The ribbed cocking knob standing on the top cover at z. */
  function cockingKnob({ z, top }) {
    add({
      type: 'cylinder',
      pos: v3([0, top + 0.006, z]),
      radius: 0.0062,
      height: 0.012,
      sides: 12,
      color: STEEL,
      name: 'cocking knob',
      group: 'receiver',
    });
    add({
      type: 'cylinder',
      pos: v3([0, top + 0.0065, z]),
      radius: 0.0064,
      height: 0.0014,
      sides: 12,
      color: SLOT,
      name: 'knob groove',
      group: 'receiver',
    });
    add({
      type: 'cylinder',
      pos: v3([0, top + 0.0125, z]),
      radius: 0.0052,
      height: 0.001,
      sides: 12,
      color: PIN,
      name: 'knob cap',
      group: 'receiver',
    });
  }

  return { ak, barrel, grip, peepRear, frontPost, cockingKnob, RUBBER };
}
