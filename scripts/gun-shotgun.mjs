// Shared pieces of the shotguns' models (GM-7a): the barrel run with its vent rib and bead,
// drawn the same way on a gun (its factory barrel) and on a fitted barrel item, so the rib
// and bead line up whichever barrel is on. Heights are from the bore, which is y = 0 in a
// barrel item's frame and the gun's bore height on a gun (pass `y`). See docs/guns.md.
//
//   import { SG, shotgunBarrel } from './gun-shotgun.mjs';
import { v3 } from './gun-kit.mjs';
import { roundOutline } from './optic-kit.mjs';

export const SG = {
  BR: 0.0105, // a 12-gauge barrel's outside radius
  RIB_Y: 0.029, // the vent rib's center over the bore: raised, so the bead clears a rail on the receiver
  RIB_H: 0.0032,
  RIB_W: 0.0072,
  BEAD_H: 0.0045, // the bead's height on the rib: big enough to pick up at its distance
  TUBE_DY: -0.0265, // the magazine tube's axis under the bore
  STEEL: '#1b1c1e',
  RIB: '#26282b',
  BAND: '#2a2c2f',
  BEAD: '#c9c3b4', // a pale bead that reads against anything
  BORE: '#0d0e0f',
};
/** The bead's top over the bore: the shotguns' sight line sits here. */
export const BEAD_TOP = SG.RIB_Y + SG.RIB_H / 2 + SG.BEAD_H;

/**
 * A barrel run from z0 back to z1 (z1 > z0, the muzzle at z0) on the bore at height y: the
 * tube, a vent rib on posts, the bead near the muzzle (`bead: false` leaves it off) and the
 * dark bore at the muzzle. `extra` goes on every part (hiddenBy on a gun's factory run).
 */
export function shotgunBarrel(kit, o) {
  const { tubeZ, box, add } = kit;
  const { z0, z1, y = 0, r = SG.BR, group = 'barrel', extra = {} } = o;
  tubeZ(group, 'barrel', y, z1, z0, r, SG.STEEL, { sides: 10, ...extra });
  if (o.rib !== false) {
    const rz0 = z0 + 0.004;
    const rz1 = z1 - (o.ribGap ?? 0.002);
    box(
      group,
      'vent rib',
      [0, y + SG.RIB_Y, (rz0 + rz1) / 2],
      [SG.RIB_W, SG.RIB_H, rz1 - rz0],
      SG.RIB,
      extra,
    );
    // A solid web under the rib, so it reads as one raised rib (posts with open gaps read
    // as a ladder at the hip); the vents are dark cuts along the web's sides.
    const webH = SG.RIB_Y - SG.RIB_H / 2 - r + 0.001;
    const webY = y + r - 0.001 + webH / 2;
    box(group, 'rib web', [0, webY, (rz0 + rz1) / 2], [0.0028, webH, rz1 - rz0], SG.RIB, extra);
    const n = Math.floor((rz1 - rz0 - 0.008) / 0.03);
    for (let i = 0; i < n; i++) {
      const z = rz0 + 0.019 + i * 0.03;
      box(group, 'rib vent', [0, webY + 0.0005, z], [0.0031, webH - 0.005, 0.014], SG.BORE, extra);
    }
  }
  if (o.bead !== false) {
    add({
      type: 'cylinder',
      pos: v3([0, y + SG.RIB_Y + SG.RIB_H / 2 + SG.BEAD_H / 2, z0 + 0.008]),
      radius: 0.0026,
      radiusTop: 0.0018,
      height: SG.BEAD_H,
      sides: 8,
      color: SG.BEAD,
      name: 'front sight post',
      group: 'iron sights',
      ...extra,
    });
  }
  add({
    type: 'panel',
    pos: v3([0, y, z0 - 0.0003]),
    pitch: 90,
    points: roundOutline(10)(r - 0.0028).map(v3),
    color: SG.BORE,
    name: 'muzzle bore',
    group,
    ...extra,
  });
}

/** The barrel's nut at a fitted barrel's back, round the bore at its mount. */
export function barrelNut(kit, y = 0, group = 'barrel') {
  kit.tubeZ(group, 'barrel nut', y, 0, -0.009, SG.BR + 0.0035, SG.BAND, { sides: 10 });
}
