// Shared pieces for the bolt-action rifles (GM-6a: awm, sv-98, r93), drawn into a gun kit
// from each gun's own sizes: a round receiver and its rail riser, the bolt shroud and a
// bolt handle with a ball knob, a heavy barrel (fluted or plain), a ported muzzle brake, a
// trigger guard, a butt pad with a spacer, and sling studs. Each gun's script draws its own
// stock, which is what tells the three apart. See docs/guns.md.
//
//   import { BOLT, boltPieces } from './gun-bolt.mjs';
import { r5 } from './gun-kit.mjs';
import { AR } from './gun-ar15.mjs';

/** The house gun colors (two shades plus black), as on every other gun. */
export const BOLT = { ...AR };

/** Pieces drawn into `kit` (from gunParts). */
export function boltPieces(kit) {
  const { add, box, tubeZ, tubeX, extrudeZ } = kit;
  const { REC, SLOT, STEEL, PIN, RUBBER, POLY_HI } = BOLT;

  /**
   * A round action from z0 to z1 on the bore (radius R), its ejection port on the right with
   * the bolt's body showing in it, and a riser under the rail so the flat rail base meets the
   * round top with no gap. Returns the riser's top: the rail base's height.
   */
  function receiver({ B, R, z0, z1, port, railZ, group = 'receiver' }) {
    tubeZ(group, 'receiver', B, z0, z1, R, REC, { sides: 12 });
    // The front ring a hair larger where the barrel threads in.
    tubeZ(group, 'receiver ring', B, z0 - 0.002, z0 + 0.012, R + 0.0008, REC, { sides: 12 });
    box(group, 'ejection port', [R - 0.0035, B + R * 0.45, port[0] / 2 + port[1] / 2], [0.008, R * 0.62, port[1] - port[0]], SLOT);
    tubeZ(group, 'bolt body', B + R * 0.42, port[0] + 0.004, port[1] - 0.004, R * 0.42, STEEL, {
      x: R - 0.0065,
      sides: 8,
    });
    const top = B + R - 0.001;
    extrudeZ(
      group,
      'rail riser',
      [
        [-0.0108, top],
        [0.0108, top],
        [0.0115, B + R * 0.62],
        [-0.0115, B + R * 0.62],
      ],
      railZ[0],
      railZ[1],
      REC,
    );
    return top;
  }

  /**
   * The bolt shroud behind the action, a cocking indicator on its back, and the handle: a
   * stem from the bolt's root on the right, angled down and out to a round knob. `root` is
   * where the stem leaves the receiver [x, y, z]; `knob` the knob's center, at the same z.
   */
  function boltHandle({ B, R, z1, shroud, root, knob, knobR, group = 'bolt' }) {
    tubeZ(group, 'bolt shroud', B, z1 - 0.002, z1 + shroud, R * 0.78, STEEL, { sides: 10 });
    tubeZ(group, 'cocking indicator', B + 0.002, z1 + shroud, z1 + shroud + 0.004, 0.003, PIN, {
      sides: 6,
    });
    tubeX(group, 'bolt root', [root[0] - 0.003, root[1], root[2]], 0.0062, 0.008, STEEL, {
      sides: 8,
    });
    const dx = knob[0] - root[0];
    const dy = knob[1] - root[1];
    box(
      group,
      'bolt handle',
      [(root[0] + knob[0]) / 2, (root[1] + knob[1]) / 2, (root[2] + knob[2]) / 2],
      [Math.hypot(dx, dy) - knobR * 0.6, 0.0058, 0.0058],
      STEEL,
      { roll: r5((Math.atan2(dy, dx) * 180) / Math.PI) },
    );
    // A ball knob: rings up its y, a slight flat on top and bottom.
    const k = knobR;
    add({
      type: 'loft',
      pos: knob.map(r5),
      sides: 10,
      rings: [
        [-k, k * 0.9, k * 0.9],
        [-k * 0.7, k * 1.7, k * 1.7],
        [0, k * 2, k * 2],
        [k * 0.7, k * 1.7, k * 1.7],
        [k, k * 0.9, k * 0.9],
      ].map((r) => r.map(r5)),
      color: STEEL,
      name: 'bolt knob',
      group,
    });
  }

  /**
   * The barrel from the receiver to the muzzle: a shank of radius rShank to zTaper, then the
   * body of radius r. `flutes` cuts dark lines along the body's sides and top.
   */
  function barrel({ B, z0, zTaper, zMuzzle, rShank, r, flutes, group = 'barrel' }) {
    tubeZ(group, 'barrel shank', B, z0, zTaper, rShank, STEEL, { sides: 12 });
    tubeZ(group, 'barrel', B, zTaper + 0.001, zMuzzle, r, STEEL, { sides: 10 });
    if (!flutes) return;
    const [f0, f1] = flutes;
    const len = Math.abs(f1 - f0);
    const zc = (f0 + f1) / 2;
    for (const a of [-60, 0, 60, 120, 180, 240]) {
      if (a === 180 || a === 240 || a === 120) continue; // underneath: nobody sees it
      const rad = (a * Math.PI) / 180;
      for (const s of a === 0 ? [1] : [1, -1]) {
        const x = s * Math.sin(rad) * (r + 0.0001);
        const y = B + Math.cos(rad) * (r + 0.0001);
        box(group, 'barrel flute', [x, y, zc], [0.0024, 0.0006, len], SLOT, {
          roll: r5(-s * a),
        });
      }
    }
    for (const s of [1, -1])
      box(group, 'barrel flute', [s * (r + 0.0001), B, zc], [0.0006, 0.0024, len], SLOT);
  }

  /**
   * A muzzle brake on the bore from z0 forward by `len` (a factory part, hidden by a fitted
   * muzzle device): a body of radius r, rows of side ports, a dark crown.
   */
  function brake({ B, z0, len, r, ports, portH, top = false, group = 'muzzle brake' }) {
    const hide = { hiddenBy: 'muzzle' };
    tubeZ(group, 'muzzle brake', B, z0 + 0.001, z0 - len, r, STEEL, { sides: 12, ...hide });
    tubeZ(group, 'muzzle brake shoulder', B, z0 + 0.002, z0 - 0.008, r + 0.0006, STEEL, {
      sides: 12,
      ...hide,
    });
    for (const [pz, pl] of ports)
      for (const s of [1, -1])
        box(group, 'brake port', [s * (r - 0.0012), B, pz], [0.0036, portH, pl], SLOT, hide);
    if (top)
      for (const [pz] of ports.slice(0, 2))
        box(group, 'brake port', [0, B + r - 0.0012, pz], [0.004, 0.0036, 0.0045], SLOT, hide);
    tubeZ(group, 'muzzle crown', B, z0 - len - 0.0004, z0 - len - 0.0008, r * 0.55, SLOT, {
      sides: 8,
      ...hide,
    });
  }

  /** A trigger guard loop from z0 to z1 under a stock bottom at y0, its bar at depth y1. */
  function triggerGuard({ y0, y1, z0, z1, trigger, color, group = 'trigger' }) {
    box(group, 'trigger guard', [0, y1 + 0.0025, (z0 + z1) / 2], [0.011, 0.005, z1 - z0], color);
    box(group, 'trigger guard front', [0, (y0 + y1) / 2, z0 + 0.003], [0.011, y0 - y1, 0.006], color);
    box(group, 'trigger', [0, y0 - 0.011, trigger], [0.0045, 0.018, 0.005], STEEL, { pitch: -14 });
    box(group, 'trigger slot', [0, y0 - 0.0002, (z0 + z1) / 2 - 0.004], [0.008, 0.001, 0.03], SLOT);
  }

  /**
   * The butt's back: a spacer plate then a rubber pad, from z back, between heights y0 and
   * y1, half width w; `hide` passes hiddenBy.
   */
  function buttPad({ z, y0, y1, w, group = 'stock', hide = {} }) {
    box(group, 'butt spacer', [0, (y0 + y1) / 2, z + 0.003], [w * 2 - 0.002, y1 - y0 - 0.004, 0.006], POLY_HI, hide);
    add({
      type: 'slab',
      pos: [0, r5((y0 + y1) / 2), r5(z + 0.0058 + 0.0075)],
      size: [r5(w * 2), r5(y1 - y0), 0.015],
      corners: [0.004, 0.004, 0.004, 0.004],
      segments: 2,
      color: RUBBER,
      name: 'butt pad',
      group,
      ...hide,
    });
    return z + 0.0058 + 0.015;
  }

  /** A sling stud under a surface at y (a post and a ring lying across the gun). */
  function slingStud({ y, z, group = 'stock', hide = {} }) {
    box(group, 'sling stud', [0, y - 0.003, z], [0.0055, 0.0065, 0.0055], STEEL, hide);
    tubeX(group, 'sling stud ring', [0, y - 0.0065, z], 0.0034, 0.008, PIN, { sides: 6, ...hide });
  }

  return { receiver, boltHandle, barrel, brake, triggerGuard, buttPad, slingStud };
}
