// Shared pieces of the pistols' models (GM-7b): the slide and its nose, side decals
// (serrations, seams, ports: flat panels, so they cost 2 triangles each), the raked grip the
// magazine goes up through, the trigger guard, the dust cover's rail, and the notch and post.
// Each gun's script draws its own slide shape and controls from these. `PISTOL` holds each
// grip's rake and magazine mouth, so mags.mjs builds magazines that fit inside. See
// docs/guns.md.
//
//   import { PISTOL, PC, pistolPieces } from './gun-pistol.mjs';
import { r5, v3 } from './gun-kit.mjs';
import { AR } from './gun-ar15.mjs';
import { roundOutline } from './optic-kit.mjs';

/** Colors: steel slide, a step-lighter frame, black ports and rubber. */
export const PC = {
  SLIDE: '#26282b',
  SLIDE_HI: '#303337',
  FRAME: '#34373b',
  FRAME_LO: '#2b2e31',
  PANEL: '#25272a',
  STEEL: '#3c3f43',
  BARREL: '#4a4d52',
  LEVER: '#1c1d1f',
  SLOT: AR.SLOT,
  PIN: AR.PIN,
  SIGHT: '#1b1c1e',
  LIP: AR.SIGHT_LIP,
  BORE: AR.BORE,
  DOT: '#e8e4d2',
};

/** Heights every pistol shares: the bore, and the sight line clear of a fitted suppressor. */
export const B = 0.012;
export const SIGHT_Y = B + 0.024;

/**
 * Each grip: `t` the rake (z per meter down), `mouth` the magazine well's mouth [y, z] on
 * the grip's axis (the magazine mount), `d` the grip's half depth, `w` its half width.
 * `md` and `mw` are the magazine's half depth and half width, `up` how far it goes up.
 */
export const PISTOL = {
  glock: {
    t: 0.34,
    mouth: [-0.103, 0.041],
    d: 0.0245,
    w: 0.0148,
    md: 0.0175,
    mw: 0.0112,
    up: 0.082,
  },
  m9a3: {
    t: 0.24,
    mouth: [-0.106, 0.035],
    d: 0.0245,
    w: 0.0155,
    md: 0.0175,
    mw: 0.0112,
    up: 0.085,
  },
  p226: {
    t: 0.26,
    mouth: [-0.106, 0.037],
    d: 0.0245,
    w: 0.0155,
    md: 0.0175,
    mw: 0.0112,
    up: 0.085,
  },
  m1911a1: {
    t: 0.3,
    mouth: [-0.102, 0.039],
    d: 0.0235,
    w: 0.0135,
    md: 0.0175,
    mw: 0.0085,
    up: 0.082,
  },
  'five-seven': {
    t: 0.2,
    mouth: [-0.106, 0.036],
    d: 0.0268,
    w: 0.0158,
    md: 0.0215,
    mw: 0.0118,
    up: 0.085,
  },
};

/** Pieces drawn into `kit` (from gunParts). */
export function pistolPieces(kit) {
  const { add, box, tubeZ, prism, extrudeZ } = kit;

  /** A flat mark on the side facing s (1 right, −1 left) at x, through [y, z] points. */
  function decal(group, name, s, x, pts, color, extra = {}) {
    const cy = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    add({
      type: 'panel',
      pos: v3([s * x, cy, cz]),
      roll: -s * 90,
      points: pts.map(([y, z]) => [r5(-s * (y - cy)), r5(z - cz)]),
      color,
      name,
      group,
      ...extra,
    });
  }
  /** The same decal on both sides. */
  const decals = (group, name, x, pts, color) => {
    for (const s of [1, -1]) decal(group, name, s, x, pts, color);
  };
  /** A mark facing the eye (back) or the front (−z), through [x, y] points. */
  function facing(group, name, z, pts, color, back = true, extra = {}) {
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    add({
      type: 'panel',
      pos: v3([cx, cy, z]),
      pitch: back ? 90 : -90,
      points: pts.map(([x, y]) => [r5(x - cx), r5(back ? cy - y : y - cy)]),
      color,
      name,
      group,
      ...extra,
    });
  }
  /** A mark on top: x and z ranges at height y. */
  const onTop = (group, name, y, [x0, x1], [z0, z1], color) =>
    add({
      type: 'panel',
      pos: v3([(x0 + x1) / 2, y, (z0 + z1) / 2]),
      size: [r5(x1 - x0), r5(z1 - z0)],
      color,
      name,
      group,
    });
  const circle = (r, [cx, cy], n = 10) => roundOutline(n)(r).map(([x, y]) => [x + cx, y + cy]);
  const rect = (y0, y1, z0, z1) => [
    [y0, z0],
    [y1, z0],
    [y1, z1],
    [y0, z1],
  ];

  /** The hull between two cross-sections at z0 and z1 (a slide's nose, a tapering frame). */
  function loftZ(group, name, a, z0, b, z1, color, extra = {}) {
    const cz = (z0 + z1) / 2;
    const cy = a.reduce((s, p) => s + p[1], 0) / a.length;
    add({
      type: 'hull',
      pos: v3([0, cy, cz]),
      points: [
        ...a.map(([x, y]) => v3([x, y - cy, z0 - cz])),
        ...b.map(([x, y]) => v3([x, y - cy, z1 - cz])),
      ],
      color,
      name,
      group,
      ...extra,
    });
  }

  /** Slanted grooves down both sides: n from z0, `step` apart, between y0 and y1. */
  function serrations(
    x,
    { z0, n, step = 0.0038, width = 0.0016, y0, y1, lean = 0.002, color = PC.SLOT },
  ) {
    for (let i = 0; i < n; i++) {
      const z = z0 + i * step;
      decals(
        'slide',
        'serration',
        x + 0.0003,
        [
          [y0, z],
          [y1, z - lean],
          [y1, z - lean + width],
          [y0, z + width],
        ],
        color,
      );
    }
  }

  /** A bent strip of quads between an outer and an inner [y, z] path (guard, trigger, hammer). */
  function band(group, name, outer, inner, w, color) {
    for (let i = 0; i + 1 < outer.length; i++)
      prism(
        group,
        name,
        [outer[i], outer[i + 1], inner[i + 1], inner[i]].map(([y, z]) => [y, z, w]),
        color,
      );
  }

  /** The raked grip between heights, chamfered corners: [y, front, back, w, c] stations. */
  function gripBody(stations, color = PC.FRAME) {
    const corners = ([y, f, b, w, c, lift = 0]) =>
      [
        [-w + c, f],
        [w - c, f],
        [w, f + c],
        [w, b - c],
        [w - c, b],
        [-w + c, b],
        [-w, b - c],
        [-w, f + c],
      ].map(([x, z]) => [x, y + lift * ((z - f) / (b - f) - 0.5), z]);
    for (let i = 0; i + 1 < stations.length; i++) {
      const pts = [...corners(stations[i]), ...corners(stations[i + 1])];
      const cy = (stations[i][0] + stations[i + 1][0]) / 2;
      const cz = (stations[i][1] + stations[i][2]) / 2;
      add({
        type: 'hull',
        pos: v3([0, cy, cz]),
        points: pts.map(([x, y, z]) => v3([x, y - cy, z - cz])),
        color,
        name: 'grip',
        group: 'grip',
      });
    }
  }

  /** A point on the grip's axis at height y. */
  const axis = (P, y) => P.mouth[1] + (P.mouth[0] - y) * P.t;

  /**
   * The grip from height `top` down to the mouth, swelling at its back, its side panels
   * textured with `lines` rows, dark or `panel` colored.
   */
  function grip(
    P,
    {
      top,
      swell = 0.0025,
      c = 0.0055,
      color = PC.FRAME,
      panel = PC.PANEL,
      lines = 9,
      panelTop,
      topBack = 0,
      lip = 0.003,
      lineColor = PC.FRAME_LO,
      inset = 0.0075,
    },
  ) {
    const { d, w, mouth } = P;
    const mid = (top + mouth[0]) / 2 - 0.012;
    const z = (y) => axis(P, y);
    gripBody(
      [
        [top, z(top) - d + 0.002, z(top) + d + topBack, w - 0.002, c],
        [mid, z(mid) - d, z(mid) + d + swell, w, c],
        [mouth[0] + 0.001, z(mouth[0]) - d - 0.001, z(mouth[0]) + d, w, c, lip],
      ],
      color,
    );
    const y1 = panelTop ?? top - 0.02;
    const y0 = mouth[0] + 0.011;
    const at = (y, o) => [y, z(y) + o];
    const f = -d + inset;
    const b = d - inset;
    decals(
      'grip',
      'grip panel',
      w + 0.0003,
      [at(y1, f), at(y1 - 0.004, b), at(y0, b), at(y0, f)],
      panel,
    );
    const n = lines;
    for (let i = 0; i < n; i++) {
      const y = y0 + 0.004 + ((y1 - y0 - 0.013) * i) / Math.max(1, n - 1);
      decals(
        'grip',
        'grip texture',
        w + 0.0006,
        [at(y, f + 0.002), at(y + 0.0016, f + 0.002), at(y + 0.0016, b - 0.002), at(y, b - 0.002)],
        lineColor,
      );
    }
  }

  /** The trigger guard from the frame's underside at `top`, its front at z0, back at z1. */
  function guard({ top, bottom, z0, z1, w = 0.0052, th = 0.0042, hook = 0.002, color = PC.FRAME }) {
    const r = 0.009;
    band(
      'frame',
      'trigger guard',
      [
        [top, z0 + 0.0005],
        [bottom + r, z0 - hook],
        [bottom + 0.002, z0 + r * 0.45],
        [bottom, z0 + r + 0.004],
        [bottom, z1 - 0.006],
        [bottom + 0.004, z1 + 0.004],
      ],
      [
        [top, z0 + th + 0.0025],
        [bottom + r + 0.001, z0 + th - hook * 0.5],
        [bottom + th + 0.002, z0 + r * 0.45 + th * 0.7],
        [bottom + th, z0 + r + 0.005],
        [bottom + th, z1 - 0.008],
        [bottom + th + 0.005, z1 + 0.004],
      ],
      w,
      color,
    );
  }

  /** A curved trigger hanging from `top` at z. */
  function trigger({ top, z, len = 0.021, w = 0.0034, color = PC.LEVER, straight = false }) {
    const bow = straight ? 0.0005 : 0.003;
    band(
      'frame',
      'trigger',
      [
        [top, z - 0.003],
        [top - len * 0.55, z - 0.001 + bow],
        [top - len, z - 0.0035],
      ],
      [
        [top, z + 0.005],
        [top - len * 0.55, z + 0.004 + bow],
        [top - len, z - 0.0005],
      ],
      w,
      color,
    );
  }

  /** The dust cover's rail: lips along the underside and cross cuts, from z0 to z1. Returns its bottom. */
  function rail({ y, z0, z1, w = 0.0105, cuts = 3, color = PC.FRAME }) {
    extrudeZ(
      'frame',
      'rail',
      [
        [-w + 0.002, y + 0.0005],
        [w - 0.002, y + 0.0005],
        [w, y - 0.0012],
        [w, y - 0.003],
        [w - 0.0016, y - 0.0045],
        [-w + 0.0016, y - 0.0045],
        [-w, y - 0.003],
        [-w, y - 0.0012],
      ],
      z0,
      z1,
      color,
    );
    const pitch = (z1 - z0) / (cuts + 1);
    for (let i = 1; i <= cuts; i++)
      box(
        'frame',
        'rail cut',
        [0, y - 0.0031, z0 + i * pitch],
        [2 * w + 0.0006, 0.0034, 0.0036],
        PC.SLOT,
      );
    return y - 0.0045;
  }

  /**
   * The irons, on slides' tops at heights `rearBase` and `frontBase`: a one-piece rear with a
   * round-cornered notch, and a post ramped toward the muzzle. `dots`: 'three', 'outline'
   * (a light line round the notch, a dot in front) or 'plain'.
   */
  function irons({
    rearZ,
    rearBase,
    frontZ,
    frontBase,
    dots = 'three',
    W = 0.012,
    foot = W,
    depth = 0.011,
    N = 0.0035,
    ND = 0.006,
    postW = 0.0048,
    postLen = 0.0075,
  }) {
    const IS = 'iron sights';
    const floor = SIGHT_Y - ND;
    const z0 = rearZ - depth / 2;
    const z1 = rearZ + depth / 2;
    // The base under the notch, sloping up from its front edge.
    loftZ(
      IS,
      'rear sight',
      [
        [-foot, rearBase - 0.0006],
        [foot, rearBase - 0.0006],
        [W - 0.002, rearBase + 0.0018],
        [-W + 0.002, rearBase + 0.0018],
      ],
      z0 - 0.005,
      [
        [-foot, rearBase - 0.0006],
        [foot, rearBase - 0.0006],
        [W, floor - 0.0012],
        [W, floor],
        [-W, floor],
        [-W, floor - 0.0012],
      ],
      z1,
      PC.SIGHT,
    );
    for (const s of [1, -1]) {
      // Flat on the sight line, the outer shoulder rounded, the inner edge sharp.
      const top = [
        [N, floor - 0.0006],
        [W - 0.0002, floor - 0.0006],
        [W - 0.0006, SIGHT_Y - 0.0022],
        [W - 0.0012, SIGHT_Y - 0.0007],
        [W - 0.0027, SIGHT_Y],
        [N, SIGHT_Y],
      ].map(([x, y]) => [s * x, y]);
      extrudeZ(
        IS,
        'rear sight ear',
        s > 0 ? top : top.reverse(),
        z0 + 0.002,
        z1 - 0.0002,
        PC.SIGHT,
      );
      // The notch's floor corner, filleted.
      const tri = [
        [s * (N + 0.0002), floor - 0.0002],
        [s * (N + 0.0002), floor + 0.0011],
        [s * (N - 0.0011), floor - 0.0002],
      ];
      extrudeZ(
        IS,
        'rear sight notch',
        s > 0 ? tri : tri.reverse(),
        z0 + 0.003,
        z1 - 0.0004,
        PC.SIGHT,
      );
      if (dots === 'three')
        facing(
          IS,
          'rear sight dot',
          z1 + 0.0003,
          circle(0.0018, [s * (N + (W - N) / 2), SIGHT_Y - 0.0033]),
          PC.DOT,
        );
      if (dots === 'outline')
        facing(
          IS,
          'rear sight outline',
          z1 + 0.0003,
          [
            [s * (N + 0.0007), floor - 0.0007],
            [s * (N + 0.0017), floor - 0.0007],
            [s * (N + 0.0017), SIGHT_Y - 0.0008],
            [s * (N + 0.0007), SIGHT_Y - 0.0008],
          ],
          PC.DOT,
        );
      if (dots === 'plain')
        for (let i = 0; i < 4; i++)
          facing(
            IS,
            'rear sight groove',
            z1 + 0.0003,
            [
              [s * (N + 0.0008), floor + 0.0008 + i * 0.0013],
              [s * (W - 0.0016), floor + 0.0008 + i * 0.0013],
              [s * (W - 0.0016), floor + 0.0013 + i * 0.0013],
              [s * (N + 0.0008), floor + 0.0013 + i * 0.0013],
            ],
            PC.SLIDE_HI,
          );
    }
    if (dots === 'outline')
      facing(
        IS,
        'rear sight outline',
        z1 + 0.0003,
        [
          [-N - 0.0017, floor - 0.0017],
          [N + 0.0017, floor - 0.0017],
          [N + 0.0017, floor - 0.0007],
          [-N - 0.0017, floor - 0.0007],
        ],
        PC.DOT,
      );
    // The front: an upright post facing the eye, its ramp falling away toward the muzzle.
    const h = SIGHT_Y - frontBase + 0.0006;
    box(IS, 'front sight post', [0, SIGHT_Y - h / 2, frontZ], [postW, h, 0.003], PC.SIGHT);
    prism(
      IS,
      'front sight ramp',
      [
        [SIGHT_Y - 0.0005, frontZ - 0.0012],
        [frontBase - 0.0006, frontZ - 0.0012],
        [frontBase - 0.0006, frontZ - postLen - 0.003],
        [frontBase + 0.001, frontZ - postLen - 0.003],
      ].map(([y, z]) => [y, z, postW / 2 + 0.0003]),
      PC.SIGHT,
    );
    if (dots !== 'plain')
      facing(
        IS,
        'front sight dot',
        frontZ + 0.0018,
        circle(0.0019, [0, SIGHT_Y - 0.0029], 12),
        PC.DOT,
      );
  }

  /** The barrel's crown past the slide's front at z0, its bore, and the guide rod under it. */
  function muzzle({ z0, len = 0.004, r = 0.0072, thread = 0, rodY = B - 0.0098, rodR = 0.0036 }) {
    const h = { hiddenBy: 'muzzle' };
    const z = z0 - len;
    tubeZ('barrel', 'barrel crown', B, z0 + 0.004, z, r, PC.BARREL, { sides: 12 });
    let end = z;
    if (thread) {
      end = z - thread;
      tubeZ('barrel', 'thread protector', B, z + 0.0005, end, r - 0.0004, PC.LEVER, {
        sides: 12,
        ...h,
      });
      tubeZ('barrel', 'thread collar', B, z - 0.001, z - 0.0026, r + 0.0005, PC.STEEL, {
        sides: 12,
        ...h,
      });
    }
    facing('barrel', 'bore', end - 0.0003, circle(r - 0.0024, [0, B]), PC.BORE, false, h);
    if (rodR) {
      tubeZ('barrel', 'guide rod', rodY, z0 + 0.002, z0 - 0.0012, rodR, PC.STEEL, { sides: 8 });
      facing(
        'barrel',
        'guide rod bore',
        z0 - 0.0015,
        circle(rodR - 0.0014, [0, rodY], 8),
        PC.BORE,
        false,
      );
    }
    return z;
  }

  /**
   * The ejection port on the top right, the barrel's hood standing in it, lying on the
   * slide's right `profile`: [x, y] points from the port's bottom edge up to the flat top.
   */
  function port({ profile, z0, z1 }) {
    const [tx, ty] = profile[profile.length - 1];
    const run = (name, off, color, [a, b], cut) => {
      for (let i = 0; i + 1 < profile.length; i++) {
        const [x0, y0] = profile[i];
        const [x1, y1] = profile[i + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const n = [(y1 - y0) / len, (x0 - x1) / len];
        // The hood stops short of the port's bottom edge.
        const k = i === 0 ? cut / len : 0;
        add({
          type: 'panel',
          pos: v3([
            (x0 + x1 + (x1 - x0) * k) / 2 + n[0] * off,
            (y0 + y1 + (y1 - y0) * k) / 2 + n[1] * off,
            (a + b) / 2,
          ]),
          roll: r5((Math.atan2(-n[0], n[1]) * 180) / Math.PI),
          size: [r5(len * (1 - k)), r5(b - a)],
          color,
          name,
          group: 'slide',
        });
      }
      onTop('slide', name, ty + off, [-tx + cut * 0.4, tx], [a, b], color);
    };
    run('ejection port', 0.0003, PC.SLOT, [z0, z1], 0);
    run('barrel hood', 0.0006, PC.BARREL, [z0 + 0.001, z1 - 0.007], 0.0015);
    const [x, y] = profile[0];
    decal(
      'slide',
      'extractor',
      1,
      x + 0.0007,
      rect(y + 0.0006, y + 0.0028, z1 - 0.001, z1 + 0.013),
      PC.STEEL,
    );
  }

  /** A hammer behind the slide: a bent spur, or a ring. */
  function hammer({ z, y = B + 0.004, spur = true }) {
    prism(
      'slide',
      'hammer',
      [
        [y - 0.013, z - 0.004],
        [y - 0.013, z + 0.003],
        [y + 0.002, z + 0.007],
        [y + 0.007, z + 0.004],
        [y + 0.007, z - 0.001],
      ].map(([yy, zz]) => [yy, zz, 0.0038]),
      PC.LEVER,
    );
    if (spur)
      prism(
        'slide',
        'hammer spur',
        [
          [y + 0.001, z + 0.003],
          [y + 0.007, z + 0.002],
          [y + 0.0085, z + 0.0115],
          [y + 0.0065, z + 0.0125],
        ].map(([yy, zz]) => [yy, zz, 0.0042]),
        PC.LEVER,
      );
    for (let i = 0; i < 2; i++)
      box(
        'slide',
        'hammer groove',
        [0, y - 0.001 + i * 0.003, z + 0.0068 - i * 0.0012],
        [0.0078, 0.0009, 0.001],
        PC.STEEL,
      );
  }

  /** A pin or screw head flush on both sides. */
  const pin = (group, name, x, y, z, r, color = PC.PIN) => {
    for (const s of [1, -1]) decal(group, name, s, x + 0.0004, circle(r, [y, z], 8), color);
  };

  /** The tang over the hand's web, from the frame's back. */
  function tang(pts, w, color = PC.FRAME, name = 'tang') {
    prism(
      'frame',
      name,
      pts.map(([y, z]) => [y, z, w]),
      color,
    );
  }

  /** The model's points: hands where every pistol is held, and the mounts. */
  const points = (P, { muzzleZ, muzzleEnd, rearZ, railY, railZ }) => ({
    grip: [0, -0.055, 0.005],
    support: [-0.012, -0.065, 0],
    muzzle: [0, B, muzzleEnd],
    sight: [0, SIGHT_Y, rearZ],
    mounts: {
      muzzle: [0, B, muzzleZ],
      magazine: [0, P.mouth[0], P.mouth[1]],
      rightRail: [0, railY - 0.0145, railZ],
    },
  });

  return {
    decal,
    decals,
    facing,
    onTop,
    circle,
    rect,
    loftZ,
    serrations,
    band,
    gripBody,
    axis,
    grip,
    guard,
    trigger,
    rail,
    irons,
    muzzle,
    port,
    hammer,
    pin,
    tang,
    points,
  };
}

/** A pistol magazine in its mount's frame (the well's mouth), raked as its grip is. */
export function pistolMag(
  k,
  P,
  {
    below = 0,
    plate = 0.006,
    extended = false,
    color = '#232528',
    colorPlate = '#303337',
    holes = 5,
  },
) {
  const { t, md, mw, up } = P;
  const p = pistolPieces(k);
  const z = (y) => -y * t;
  const q = (y0, y1, d0, d1, w) => [
    [y1, z(y1) + d0, w],
    [y1, z(y1) + d1, w],
    [y0, z(y0) + d1, w],
    [y0, z(y0) + d0, w],
  ];
  const lo = 0.001 - below;
  k.prism('magazine', 'magazine body', q(lo, up - 0.008, -md, md, mw), color);
  // The body narrows to the single round at its lips.
  k.prism('magazine', 'magazine neck', q(up - 0.0085, up, -md, md - 0.002, mw * 0.62), color);
  const rw = 0.004;
  k.prism('magazine', 'round', q(up - 0.001, up + 0.005, -md + 0.004, md - 0.006, rw), '#b08d4a');
  for (let i = 0; i < holes; i++) {
    const y = 0.014 + (i * (up - 0.034)) / Math.max(1, holes - 1);
    p.decals(
      'magazine',
      'witness hole',
      mw + 0.0003,
      p.circle(0.0016, [y, z(y) + md * 0.45], 6),
      PC.SLOT,
    );
  }
  if (extended)
    for (let y = -0.012; y > -below + 0.008; y -= 0.014)
      p.decals(
        'magazine',
        'magazine rib',
        mw + 0.0003,
        [
          [y, z(y) - md + 0.004],
          [y, z(y) + md - 0.004],
          [y - 0.0022, z(y) + md - 0.004],
          [y - 0.0022, z(y) - md + 0.004],
        ],
        '#34373b',
      );
  k.prism(
    'magazine',
    'base plate',
    [
      [lo, z(lo) - md - 0.0045, mw + 0.0022],
      [lo + 0.002, z(lo) + md + 0.003, mw + 0.0022],
      [lo - plate + 0.002, z(lo) + md + 0.004, mw + 0.0022],
      [lo - plate, z(lo) + md + 0.001, mw + 0.0022],
      [lo - plate - 0.001, z(lo) - md - 0.0035, mw + 0.0022],
    ],
    colorPlate,
  );
}
