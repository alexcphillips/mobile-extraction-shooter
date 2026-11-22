// Shared pieces for the wood-stocked military rifles (GM-6b: sks, svt-40), drawn into a gun
// kit from each gun's own sizes: the straight wrist and the butt behind it (a lighter strip
// down the comb, a darker inset panel, a steel butt plate with its trap door, a sling slot),
// and steel bands round a forend. The stock is gray like every gun's furniture (no wood
// color, the user's call: guns tell apart by shape). The railed cover, notch and front post
// come from the ak kit (gun-ak.mjs), as the user chose for these two. See docs/guns.md.
//
//   import { woodPieces } from './gun-wood.mjs';
import { AK } from './gun-ak.mjs';

const PANEL = '#323539'; // an inset panel a step darker than the furniture

/** Pieces drawn into `kit` (from gunParts). */
export function woodPieces(kit) {
  const { box, tubeX, prism, extrudeZ } = kit;
  const { SLOT, POLY, POLY_HI, STEEL, RUBBER } = AK;

  /**
   * The wrist from WZ0 to WZ1 and the butt from WZ1 to the plate at BZ, as two hulls so the
   * wrist stays slimmer than the butt. `top` and `bot` are each [y at WZ0, y at WZ1, y at BZ]:
   * the comb line and the underside. `w` is the half width [wrist, butt]. Only the butt is
   * the factory stock (hidden by a fitted one): the wrist is where the hand holds. Returns
   * the back of the plate.
   */
  function wristButt({ WZ0, WZ1, BZ, top, bot, w, group = 'stock' }) {
    const hide = { hiddenBy: 'stock' };
    prism(
      group,
      'wrist',
      [
        [top[0], WZ0, w[0] - 0.001],
        [top[1], WZ1 + 0.002, w[0]],
        [bot[1], WZ1 + 0.002, w[0]],
        [bot[0], WZ0, w[0] - 0.001],
      ],
      POLY,
    );
    prism(
      group,
      'butt',
      [
        [top[1] - 0.0005, WZ1, w[0] + 0.0005],
        [top[2], BZ, w[1]],
        [bot[2], BZ, w[1]],
        [bot[1] - 0.0005, WZ1, w[0] + 0.0005],
      ],
      POLY,
      hide,
    );
    // A lighter strip down the comb, so the stock reads in two shades.
    const at = (a, b, z) => a + ((b - a) * (z - WZ1)) / (BZ - WZ1);
    const sw = (z) => at(w[0], w[1], z);
    prism(
      group,
      'stock comb',
      [
        [at(top[1], top[2], WZ1 + 0.02) + 0.0008, WZ1 + 0.02],
        [top[2] + 0.0008, BZ - 0.004],
        [top[2] - 0.0035, BZ - 0.004],
        [at(top[1], top[2], WZ1 + 0.02) - 0.0035, WZ1 + 0.02],
      ].map(([y, z]) => [y, z, sw(z) - 0.0035]),
      POLY_HI,
      hide,
    );
    // An inset panel down each side, following the taper.
    const z0 = WZ1 + 0.04;
    const z1 = BZ - 0.03;
    const mid = (z, f) => at(top[1], top[2], z) + (at(bot[1], bot[2], z) - at(top[1], top[2], z)) * f;
    prism(
      group,
      'stock panel',
      [
        [mid(z0, 0.2), z0],
        [mid(z1, 0.18), z1],
        [mid(z1, 0.72), z1],
        [mid(z0, 0.75), z0],
      ].map(([y, z]) => [y, z, sw(z) + 0.0003]),
      PANEL,
      hide,
    );
    // Steel butt plate, a hair larger than the stock's end, with its trap door.
    const W = w[1] + 0.0008;
    extrudeZ(
      group,
      'butt plate',
      [
        [-W, top[2] + 0.0005],
        [W, top[2] + 0.0005],
        [W, bot[2] - 0.0005],
        [-W, bot[2] - 0.0005],
      ],
      BZ,
      BZ + 0.006,
      STEEL,
      hide,
    );
    box(group, 'butt trap', [0, top[2] - 0.028, BZ + 0.0062], [0.02, 0.03, 0.0008], RUBBER, hide);
    // A sling slot through the butt, the left side's showing.
    box(group, 'sling slot', [-(sw(BZ - 0.07) + 0.0002), mid(BZ - 0.07, 0.62), BZ - 0.07], [0.0006, 0.006, 0.026], SLOT, hide);
    return BZ + 0.006;
  }

  /**
   * A steel band round a forend at z: an octagonal ring over half width hw from bot to top,
   * `len` long. A sling swivel on its left if `swivel`.
   */
  function band({ z, len, hw, top, bot, swivel = false, group = 'stock' }) {
    const c = Math.min(0.006, (top - bot) / 3);
    const w = hw + 0.0007;
    extrudeZ(
      group,
      'band',
      [
        [-w + c, top + 0.0007],
        [w - c, top + 0.0007],
        [w, top - c],
        [w, bot + c],
        [w - c, bot - 0.0007],
        [-w + c, bot - 0.0007],
        [-w, bot + c],
        [-w, top - c],
      ],
      z - len / 2,
      z + len / 2,
      STEEL,
    );
    if (swivel)
      tubeX(group, 'sling swivel', [-(w + 0.002), bot + 0.004, z], 0.005, 0.0024, STEEL, {
        sides: 8,
      });
  }

  return { wristButt, band };
}
