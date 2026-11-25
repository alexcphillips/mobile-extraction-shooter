// Magazine models (GM-5a): each in the magazine mount's frame, origin at the well's mouth
// (the top of what shows below the gun), hanging down −y, the front toward −z. Bodies are
// hulls from the real magazine's side outline, with pressed ribs, a base plate and the catch
// notch. A magazine also counts in its gun's fully built budget, so keep it lean.
// Replaces only `model` in each item file. See docs/guns.md.
//
//   node scripts/mags.mjs [--dry] [id ...]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says a file
// differs, leave that one out (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { PISTOL, pistolMag, pistolPieces } from './gun-pistol.mjs';

const DIR = new URL('../content/items/', import.meta.url).pathname;
const BODY = '#232528'; // stamped steel body
const RIB = '#2d3034'; // pressed ribs, a shade lighter so they read
const PLATE = '#303337'; // the base plate, lighter again
const SLOT = '#161719'; // the catch notch

/** Side outlines are [y, z] points; `w` is the half width. */
const at = (pts, w) => pts.map(([y, z]) => [y, z, w]);

const BUILD = {
  // The pistols': a full box that goes up inside the raked grip, so only its base plate (and
  // an extended one's lower body) shows on the gun.
  'g18c-mag': (k) => pistolMag(k, PISTOL.glock, { color: '#1b1c1e', colorPlate: '#1f2123' }),
  'mag-glock-33': (k) =>
    pistolMag(k, PISTOL.glock, { below: 0.07, extended: true, color: '#1b1c1e' }),
  'm9a3-mag': (k) => pistolMag(k, PISTOL.m9a3, {}),
  'mag-9mm-24': (k) => pistolMag(k, PISTOL.m9a3, { below: 0.033, extended: true }),
  'p226-mag': (k) => pistolMag(k, PISTOL.p226, {}),
  'mag-p226-20': (k) => pistolMag(k, PISTOL.p226, { below: 0.024, extended: true, holes: 4 }),
  'm1911-mag': (k) => pistolMag(k, PISTOL.m1911a1, { plate: 0.0035, holes: 4 }),
  'five-seven-mag': (k) => pistolMag(k, PISTOL['five-seven'], { holes: 5, color: '#1b1c1e' }),
  // The MPX's: a long smoky polymer box curving forward, leaning as its well does.
  'mpx-mag': (k) => mpxMag(k, 0.125),
  'mag-mpx-41': (k) => mpxMag(k, 0.17),
  // The UMP45's: a long straight box leaning forward, its witness slot down the side.
  'ump45-mag': (k) => {
    const W = 0.0135;
    const D = 0.155;
    const z = (y) => y * 0.17;
    const run = (y0, y1, a, b) => [
      [y0, z(y0) + a],
      [y0, z(y0) + b],
      [y1, z(y1) + b],
      [y1, z(y1) + a],
    ];
    const { decals, circle } = pistolPieces(k);
    k.prism('magazine', 'magazine body', at(run(0.004, -D, -0.0235, 0.0235), W), '#2b2e31');
    k.prism('magazine', 'magazine spine', at(run(0, -D + 0.002, 0.012, 0.0245), W + 0.0008), BODY);
    decals('magazine', 'witness slot', W + 0.0003, run(-0.02, -0.108, -0.006, -0.0015), SLOT);
    for (let i = 0; i < 6; i++) {
      const y = -0.028 - i * 0.0145;
      decals(
        'magazine',
        'witness round',
        W + 0.0006,
        circle(0.0016, [y, z(y) - 0.0037], 6),
        '#a8884a',
      );
    }
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-D + 0.003, z(-D) - 0.0265],
          [-D + 0.003, z(-D) + 0.027],
          [-D - 0.009, z(-D) + 0.0265],
          [-D - 0.009, z(-D) - 0.03],
        ],
        W + 0.0022,
      ),
      PLATE,
    );
  },
  // The G3's: a long steel 20-rounder curving gently forward toward its foot, two pressed
  // ribs down each side, a flat base plate.
  'g3-mag': (k) => {
    const W = 0.014;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0, -0.033],
          [0, 0.033],
          [-0.08, 0.029],
          [-0.08, -0.037],
        ],
        W,
      ),
      BODY,
    );
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [-0.0795, -0.037],
          [-0.0795, 0.029],
          [-0.148, 0.018],
          [-0.148, -0.046],
        ],
        W,
      ),
      BODY,
    );
    for (const s of [1, -1])
      for (const z of [-0.016, 0.012])
        k.prism(
          'magazine',
          'magazine rib',
          at(
            [
              [-0.012, z - 0.0025],
              [-0.012, z + 0.0025],
              [-0.138, z - 0.0125],
              [-0.138, z - 0.0175],
            ],
            0.0005,
          ),
          RIB,
          { x: s * (W + 0.0003) },
        );
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-0.147, -0.048],
          [-0.147, 0.02],
          [-0.155, 0.021],
          [-0.155, -0.049],
        ],
        W + 0.0015,
      ),
      PLATE,
    );
    k.box('magazine', 'catch notch', [0, -0.014, 0.0333], [0.012, 0.007, 0.001], SLOT);
  },
  // The SCAR-H's: a short, nearly straight steel 20-rounder, one wide pressed rib down each
  // side and a base plate a step proud.
  'scar-h-mag': (k) => {
    const W = 0.014;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0, -0.033],
          [0, 0.033],
          [-0.09, 0.03],
          [-0.09, -0.037],
        ],
        W,
      ),
      BODY,
    );
    for (const s of [1, -1])
      k.prism(
        'magazine',
        'magazine rib',
        at(
          [
            [-0.01, -0.012],
            [-0.01, 0.008],
            [-0.082, 0.005],
            [-0.082, -0.015],
          ],
          0.0005,
        ),
        RIB,
        { x: s * (W + 0.0003) },
      );
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-0.089, -0.039],
          [-0.089, 0.032],
          [-0.097, 0.032],
          [-0.097, -0.04],
        ],
        W + 0.0015,
      ),
      PLATE,
    );
    k.box('magazine', 'catch notch', [0, -0.012, 0.0333], [0.012, 0.007, 0.001], SLOT);
  },
  // The AWM's: a short single-column box for the big round, showing a little under the
  // stock, its front raked, a thick base plate with a finger lip at the front.
  'awm-mag': (k) => {
    const W = 0.0115;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0.002, -0.05],
          [0.002, 0.05],
          [-0.018, 0.049],
          [-0.018, -0.047],
        ],
        W,
      ),
      BODY,
    );
    for (const s of [1, -1])
      k.box('magazine', 'magazine rib', [s * (W + 0.0003), -0.008, 0], [0.0008, 0.005, 0.08], RIB);
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-0.0175, -0.049],
          [-0.0175, 0.051],
          [-0.025, 0.051],
          [-0.025, -0.054],
          [-0.021, -0.056],
        ],
        W + 0.001,
      ),
      PLATE,
    );
  },
  // The SV-98's: a double-column ten for the rimmed round, raked forward as the rims stack,
  // a pressed rib down each side and a base plate.
  'sv-98-mag': (k) => {
    const W = 0.0135;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0.002, -0.044],
          [0.002, 0.042],
          [-0.044, 0.036],
          [-0.044, -0.052],
        ],
        W,
      ),
      BODY,
    );
    for (const s of [1, -1])
      k.prism(
        'magazine',
        'magazine rib',
        at(
          [
            [-0.006, -0.01],
            [-0.006, 0.006],
            [-0.036, 0.002],
            [-0.036, -0.014],
          ],
          0.0004,
        ),
        RIB,
        { x: s * (W + 0.0002) },
      );
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-0.0435, -0.053],
          [-0.0435, 0.037],
          [-0.05, 0.036],
          [-0.05, -0.054],
        ],
        W + 0.001,
      ),
      PLATE,
    );
    k.box('magazine', 'catch notch', [0, -0.004, 0.0425], [0.01, 0.005, 0.001], SLOT);
  },
  // The R93's: a slim polymer box that sits nearly flush in the stock, a wide grip ledge
  // at its foot.
  'r93-mag': (k) => {
    const W = 0.012;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0.002, -0.042],
          [0.002, 0.042],
          [-0.012, 0.042],
          [-0.012, -0.042],
        ],
        W,
      ),
      BODY,
    );
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-0.0115, -0.044],
          [-0.0115, 0.044],
          [-0.019, 0.042],
          [-0.019, -0.046],
        ],
        W + 0.0015,
      ),
      PLATE,
    );
    k.box('magazine', 'base plate grip', [0, -0.0192, 0], [0.018, 0.001, 0.06], SLOT);
  },
  // The SVT-40's: a ten for the rimmed round, raked forward as the rims stack, narrower at
  // the front, a pressed rib down each side and a base plate.
  'svt-mag': (k) => {
    const W = 0.013;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0.002, -0.047],
          [0.002, 0.042],
          [-0.046, 0.034],
          [-0.046, -0.056],
        ],
        W,
      ),
      BODY,
    );
    for (const s of [1, -1])
      k.prism(
        'magazine',
        'magazine rib',
        at(
          [
            [-0.008, -0.022],
            [-0.008, 0.016],
            [-0.038, 0.01],
            [-0.038, -0.028],
          ],
          0.0004,
        ),
        RIB,
        { x: s * (W + 0.0002) },
      );
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-0.0455, -0.057],
          [-0.0455, 0.035],
          [-0.052, 0.034],
          [-0.052, -0.059],
        ],
        W + 0.001,
      ),
      PLATE,
    );
    k.box('magazine', 'catch notch', [0, -0.005, 0.0415], [0.01, 0.005, 0.001], SLOT);
  },
  // The AS Val's: a twenty for the long subsonic round, nearly straight, its foot swept a
  // little forward, two pressed ribs down each side and a base plate.
  'as-val-mag': (k) => valMag(k, 0.112),
  // The VSS's: the same body cut down to ten.
  'vss-mag': (k) => valMag(k, 0.062),
  // The `uzi` platform's: a straight double-column box up through the grip, its lower end
  // showing under the grip's heel with a pressed rib down each side and a base plate. The
  // Uzi's thirty-two, the short twenty, and the Uzi Pro's own thirty-two.
  'uzi-mag': (k) => uziMag(k, 0.205),
  'uzi-pro-mag': (k) => uziMag(k, 0.148),
  'mag-uzi-pro-32': (k) => uziMag(k, 0.205),
  // The P90's: it lies along the top of the gun, not under it, so it's built up from its
  // mount (its underside's middle) toward the muzzle (−z): a long smoked body, its front
  // rounded down, a feed ridge along its top, the rounds a darker band down each side, the
  // latch at its back.
  // The PKM's 100-round box: a steel can hanging under the receiver, a touch to the right
  // where the belt goes up into the feed, a lid with its hinge and latch, pressed ribs round
  // the sides, a wire handle folded on the left.
  'pkm-mag': (k) => {
    const W = 0.033;
    const X = 0.006;
    const D = 0.112;
    k.prism(
      'magazine',
      'box',
      at(
        [
          [-0.012, -0.066],
          [-0.012, 0.066],
          [-D + 0.006, 0.066],
          [-D, 0.06],
          [-D, -0.06],
          [-D + 0.006, -0.066],
        ],
        W,
      ),
      BODY,
      { x: X },
    );
    // The lid: a lighter cap over the top, the belt's exit slot on its right edge.
    k.prism(
      'magazine',
      'lid',
      at(
        [
          [-0.001, -0.064],
          [-0.001, 0.064],
          [-0.013, 0.0675],
          [-0.013, -0.0675],
        ],
        W + 0.0012,
      ),
      PLATE,
      { x: X },
    );
    k.box('magazine', 'belt exit', [X + W - 0.008, -0.0008, -0.01], [0.014, 0.001, 0.06], SLOT);
    k.tubeZ('magazine', 'lid hinge', -0.013, 0.06, 0.068, 0.0028, RIB, { x: X, sides: 6 });
    k.box('magazine', 'latch', [X, -0.02, -0.0685], [0.016, 0.014, 0.003], RIB);
    for (const s of [1, -1])
      k.box('magazine', 'box rib', [X + s * (W + 0.0004), -0.062, 0], [0.0008, 0.006, 0.118], RIB);
    k.box('magazine', 'handle', [X - W - 0.0018, -0.03, 0], [0.002, 0.004, 0.08], PLATE);
    for (const z of [-0.04, 0.04])
      k.box('magazine', 'handle', [X - W - 0.0012, -0.026, z], [0.0018, 0.008, 0.004], PLATE);
  },
  // The M250's belt pouch: a soft box hanging under the receiver's front on the left (the
  // belt goes up into the left of the feed), its flap over the top, a strap and buckle
  // down the outside.
  'm250-mag': (k) => {
    const X = -0.012;
    const W = 0.03;
    const D = 0.104;
    k.add({
      type: 'slab',
      pos: [X, -D / 2 - 0.004, 0],
      size: [2 * W, D, 0.098],
      corners: [0.008, 0.008, 0.008, 0.008],
      segments: 2,
      color: BODY,
      name: 'pouch',
      group: 'magazine',
    });
    k.add({
      type: 'slab',
      pos: [X, -0.012, 0],
      size: [2 * W + 0.003, 0.018, 0.101],
      corners: [0.004, 0.004, 0.004, 0.004],
      segments: 1,
      color: PLATE,
      name: 'flap',
      group: 'magazine',
    });
    k.box('magazine', 'feed chute', [X + 0.012, -0.0015, 0], [0.024, 0.003, 0.05], SLOT);
    k.box('magazine', 'strap', [X - W - 0.0006, -0.05, 0.018], [0.0014, 0.08, 0.014], RIB);
    k.box('magazine', 'buckle', [X - W - 0.0016, -0.03, 0.018], [0.0016, 0.008, 0.018], SLOT);
    k.box('magazine', 'seam', [X, -D - 0.0042, 0], [2 * W - 0.012, 0.0008, 0.084], SLOT);
  },
  // The AUG's 30-rounder: a straight top in the well curving forward toward its foot, ribs
  // down the sides, a flat base plate.
  'aug-a3-mag': (k) => {
    const W = 0.0128;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0, -0.033],
          [0, 0.033],
          [-0.075, 0.03],
          [-0.075, -0.034],
        ],
        W,
      ),
      BODY,
    );
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [-0.074, -0.034],
          [-0.074, 0.03],
          [-0.14, 0.016],
          [-0.138, -0.05],
        ],
        W,
      ),
      BODY,
    );
    for (const s of [1, -1])
      k.prism(
        'magazine',
        'magazine rib',
        at(
          [
            [-0.012, -0.012],
            [-0.012, 0.008],
            [-0.128, -0.006],
            [-0.128, -0.026],
          ],
          0.0005,
        ),
        RIB,
        { x: s * (W + 0.0003) },
      );
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-0.1385, -0.052],
          [-0.1405, 0.017],
          [-0.148, 0.0155],
          [-0.146, -0.054],
        ],
        W + 0.0015,
      ),
      PLATE,
    );
    k.box('magazine', 'catch notch', [0, -0.012, 0.0333], [0.012, 0.007, 0.001], SLOT);
  },
  // The MP-133's tube extension, in the tube's own frame (the mount is the tube's front on
  // its axis): a length of tube going on forward, the cap at its end.
  'mag-mp133-8': (k) => {
    k.tubeZ('magazine', 'tube extension', 0, 0.001, -0.09, 0.0108, '#1b1c1e', { sides: 10 });
    k.tubeZ('magazine', 'joint', 0, -0.004, -0.009, 0.0113, RIB, { sides: 10 });
    k.tubeZ('magazine', 'tube cap', 0, -0.09, -0.101, 0.0116, '#2a2c2f', { sides: 10 });
  },
  // The AA-12's 8-round box: wide and deep for the shells, straight, ribbed, a base plate.
  'aa-12-mag': (k) => {
    const W = 0.0195;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0, -0.043],
          [0, 0.043],
          [-0.118, 0.04],
          [-0.118, -0.046],
        ],
        W,
      ),
      BODY,
    );
    for (const s of [1, -1])
      k.prism(
        'magazine',
        'magazine rib',
        at(
          [
            [-0.012, -0.022],
            [-0.012, 0.018],
            [-0.11, 0.016],
            [-0.11, -0.024],
          ],
          0.0005,
        ),
        RIB,
        {
          x: s * (W + 0.0003),
        },
      );
    k.prism(
      'magazine',
      'base plate',
      at(
        [
          [-0.117, -0.048],
          [-0.117, 0.042],
          [-0.126, 0.042],
          [-0.126, -0.048],
        ],
        W + 0.0015,
      ),
      PLATE,
    );
    k.box('magazine', 'catch notch', [0, -0.008, 0.0433], [0.014, 0.007, 0.001], SLOT);
  },
  // The AA-12's 20-round drum: a short neck into the well and a big round drum under it,
  // its axis across the gun, a lighter cover on each face and a winding knob.
  'mag-aa12-20': (k) => {
    const R = 0.068;
    const CY = -0.03 - R;
    k.prism(
      'magazine',
      'drum neck',
      at(
        [
          [0, -0.042],
          [0, 0.042],
          [-0.034, 0.042],
          [-0.034, -0.042],
        ],
        0.019,
      ),
      BODY,
    );
    k.tubeX('magazine', 'drum', [0, CY, 0], R, 0.074, BODY, { sides: 16 });
    for (const s of [1, -1]) {
      k.tubeX('magazine', 'drum cover', [s * 0.0372, CY, 0], R - 0.008, 0.0012, PLATE, {
        sides: 16,
      });
      k.tubeX('magazine', 'drum hub', [s * 0.0384, CY, 0], 0.016, 0.0016, RIB, { sides: 10 });
    }
    k.tubeX('magazine', 'winding knob', [0.041, CY, 0], 0.008, 0.005, SLOT, { sides: 8 });
  },
  'p90-mag': (k) => {
    const W = 0.021;
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [0.0005, -0.13],
          [0.0005, 0.128],
          [0.026, 0.128],
          [0.03, 0.118],
          [0.03, -0.112],
          [0.025, -0.13],
        ],
        W,
      ),
      '#3b4146',
    );
    for (const s of [1, -1])
      k.box('magazine', 'rounds', [s * (W + 0.0002), 0.013, -0.005], [0.0006, 0.012, 0.21], BODY);
    k.box('magazine', 'feed ridge', [0, 0.0312, -0.004], [0.012, 0.0026, 0.21], RIB);
    k.box('magazine', 'magazine latch', [0, 0.016, 0.1305], [0.02, 0.016, 0.005], PLATE);
  },
};

/** The MPX's magazine, `depth` below its well's mouth, its curve in three straight runs. */
function mpxMag(k, depth) {
  const W = 0.0122;
  // The middle of the body at a depth, and its half depth: the curve steepens going down.
  const mid = (y) => y * 0.2 - y * y * 1.3;
  const HD = 0.0195;
  const ys = [0.004, -depth * 0.36, -depth * 0.7, -depth];
  const SMOKE = '#43474b';
  for (let i = 0; i < 3; i++)
    k.prism(
      'magazine',
      'magazine body',
      at(
        [
          [ys[i] + (i ? 0.0004 : 0), mid(ys[i]) - HD],
          [ys[i] + (i ? 0.0004 : 0), mid(ys[i]) + HD],
          [ys[i + 1], mid(ys[i + 1]) + HD],
          [ys[i + 1], mid(ys[i + 1]) - HD],
        ],
        W,
      ),
      SMOKE,
    );
  // Dark seams down each side, following the curve: panels, 2 triangles each.
  const { decals } = pistolPieces(k);
  for (const dz of [-0.0085, 0.0075])
    for (let i = 0; i < 3; i++) {
      const y0 = i ? ys[i] : -0.002;
      const y1 = i === 2 ? -depth + 0.006 : ys[i + 1];
      const at4 = [
        [y0, mid(y0) + dz - 0.0012],
        [y0, mid(y0) + dz + 0.0012],
        [y1, mid(y1) + dz + 0.0012],
        [y1, mid(y1) + dz - 0.0012],
      ];
      decals('magazine', 'magazine seam', W + 0.0004, at4, RIB);
    }
  const z = mid(-depth);
  k.prism(
    'magazine',
    'base plate',
    at(
      [
        [-depth + 0.004, z - HD - 0.002],
        [-depth - 0.002, z + HD + 0.0025],
        [-depth - 0.0095, z + HD - 0.0005],
        [-depth - 0.0065, z - HD - 0.0045],
      ],
      W + 0.0016,
    ),
    BODY,
  );
}

/** An `uzi` magazine, `depth` below its mount at the receiver's bottom. */
function uziMag(k, depth) {
  const W = 0.0108;
  k.prism(
    'magazine',
    'magazine body',
    at(
      [
        [0, -0.0155],
        [0, 0.0155],
        [-depth, 0.0155],
        [-depth, -0.0155],
      ],
      W,
    ),
    BODY,
  );
  for (const s of [1, -1])
    k.box(
      'magazine',
      'magazine rib',
      [s * (W + 0.0003), -0.117 - (depth - 0.117) / 2, 0],
      [0.0006, depth - 0.125, 0.008],
      RIB,
    );
  k.prism(
    'magazine',
    'base plate',
    at(
      [
        [-depth + 0.0005, -0.017],
        [-depth + 0.0005, 0.0175],
        [-depth - 0.005, 0.0175],
        [-depth - 0.005, -0.0185],
      ],
      W + 0.0012,
    ),
    PLATE,
  );
}

/** The `as-val` platform's magazine, `depth` below the well's mouth. */
function valMag(k, depth) {
  const W = 0.0125;
  const lean = depth * 0.12; // how far forward the foot sits
  k.prism(
    'magazine',
    'magazine body',
    at(
      [
        [0.002, -0.031],
        [0.002, 0.029],
        [-depth, 0.027 - lean],
        [-depth, -0.033 - lean],
      ],
      W,
    ),
    BODY,
  );
  for (const s of [1, -1])
    for (const dz of [-0.012, 0.01])
      k.prism(
        'magazine',
        'magazine rib',
        at(
          [
            [-0.008, dz - 0.003],
            [-0.008, dz + 0.003],
            [-depth + 0.012, dz + 0.003 - lean * 0.85],
            [-depth + 0.012, dz - 0.003 - lean * 0.85],
          ],
          0.0004,
        ),
        RIB,
        { x: s * (W + 0.0002) },
      );
  k.prism(
    'magazine',
    'base plate',
    at(
      [
        [-depth + 0.0005, -0.034 - lean],
        [-depth + 0.0005, 0.028 - lean],
        [-depth - 0.006, 0.027 - lean],
        [-depth - 0.006, -0.035 - lean],
      ],
      W + 0.0012,
    ),
    PLATE,
  );
  k.box('magazine', 'catch notch', [0, -0.006, 0.0293], [0.01, 0.005, 0.001], SLOT);
}

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const id of ids.length ? ids : Object.keys(BUILD)) {
  const k = gunParts();
  BUILD[id](k);
  await writeModel(`${DIR}${id}.json`, { parts: k.parts });
  console.log(id, k.parts.length, 'parts');
}
