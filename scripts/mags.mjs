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

const DIR = new URL('../content/items/', import.meta.url).pathname;
const BODY = '#232528'; // stamped steel body
const RIB = '#2d3034'; // pressed ribs, a shade lighter so they read
const PLATE = '#303337'; // the base plate, lighter again
const SLOT = '#161719'; // the catch notch

/** Side outlines are [y, z] points; `w` is the half width. */
const at = (pts, w) => pts.map(([y, z]) => [y, z, w]);

const BUILD = {
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
