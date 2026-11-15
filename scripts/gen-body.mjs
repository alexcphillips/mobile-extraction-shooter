// Builds our character's skeleton and body from one proportions table (CH-3b, 2026-11-13):
// content/characters/skeleton.json's bone offsets and content/characters/body.json's parts.
// Change the numbers in P and re-run; the head, chest, neck and shoulder joints should stay
// put (the sim's head and arm zones are fitted to them), and every head vertex must stay
// inside the skeleton's head volume (body-model.test.ts checks it).
//
//   node scripts/gen-body.mjs && npx prettier --write content/characters
//
// Rest pose: a T-pose facing −z, x right, feet at y = 0. Parts are lofts (rings up the
// part's y) and hulls (docs/props.md → The body). The left side is the right mirrored.
import { readFileSync, writeFileSync } from 'node:fs';

/** Proportions, meters. Joints are where the bones start. */
const P = {
  hips: 0.91, // the root, in the pelvis
  hipJointX: 0.1,
  hipJoint: 0.85, // legs about 48% of 1.78 m
  knee: 0.465,
  ankle: 0.075,
  spine: 1.1,
  chest: 1.28,
  neck: 1.48,
  head: 1.56,
  shoulderX: 0.19,
  shoulder: 1.43,
  upperArm: 0.3,
  forearm: 0.26,
};

// Colors as authored (the default soldier outfit); the game tints each slot per channel.
const SKIN = '#c99a78';
const SKIN_D = '#a67b5c';
const HAIR = '#3a2e26';
const EYES = '#1e1a18';
const SHIRT = '#5e6650'; // top
const SHIRT_D = '#4c533f';
const PANTS = '#545a46'; // bottom
const PANTS_D = '#434837';
const BELT = '#2a2c27';
const GLOVE = '#2b2d2f'; // hands
const GLOVE_D = '#1f2123';
const BOOT = '#3a3229'; // feet
const SOLE = '#211d18';

const r3 = (n) => Math.round(n * 1000) / 1000 || 0;
const clean = (p) => {
  const out = { name: p.name, group: p.group, type: p.type, pos: p.pos.map(r3) };
  for (const k of ['yaw', 'pitch', 'roll']) if (p[k]) out[k] = p[k];
  if (p.sides && p.sides !== 8) out.sides = p.sides;
  if (p.rings) out.rings = p.rings.map((r) => r.map(r3));
  if (p.points) out.points = p.points.map((q) => q.map(r3));
  if (p.size) out.size = p.size.map(r3);
  out.color = p.color;
  return out;
};
const loft = (name, group, pos, rings, color, extra = {}) => ({
  name,
  group,
  type: 'loft',
  pos,
  rings,
  color,
  ...extra,
});
const hull = (name, group, pos, points, color, extra = {}) => ({
  name,
  group,
  type: 'hull',
  pos,
  points,
  color,
  ...extra,
});
const box = (name, group, pos, size, color, extra = {}) => ({
  name,
  group,
  type: 'box',
  pos,
  size,
  color,
  ...extra,
});
/** A part on the right side, and its mirror on the left. */
const both = (p) => {
  const m = structuredClone(p);
  m.name = p.name.replace(/ R$/, ' L').replace(/([a-z])R$/, '$1L');
  m.group = p.group.replace(/R$/, 'L');
  m.pos = [-p.pos[0], p.pos[1], p.pos[2]];
  if (m.yaw) m.yaw = -m.yaw;
  if (m.roll) m.roll = -m.roll;
  if (m.rings) m.rings = m.rings.map(([y, w, d, dx = 0, dz = 0]) => [y, w, d, -dx, dz]);
  if (m.points) m.points = m.points.map(([x, y, z]) => [-x, y, z]);
  return [p, m];
};
/** Points mirrored across x = 0 in a part's own frame, for symmetric hulls. */
const sym = (pts) =>
  pts.flatMap(([x, y, z]) =>
    x
      ? [
          [x, y, z],
          [-x, y, z],
        ]
      : [[x, y, z]],
  );

const parts = [];
const add = (...ps) => parts.push(...ps.flat());

// --- Pelvis and belt (hips). Pants up to the waist; the shirt tucks in under the belt.
add(
  loft(
    'pelvis',
    'hips',
    [0, 0, 0.005],
    [
      [0.78, 0.16, 0.15],
      [0.84, 0.3, 0.2],
      [0.93, 0.33, 0.215, 0, 0.005],
      [1.0, 0.315, 0.205],
      [1.06, 0.3, 0.195],
    ],
    PANTS,
  ),
  loft(
    'belt',
    'hips',
    [0, 0, 0.005],
    [
      [1.025, 0.31, 0.203],
      [1.06, 0.308, 0.2],
    ],
    BELT,
  ),
  box('buckle', 'hips', [0, 1.043, -0.098], [0.045, 0.03, 0.01], PANTS_D),
);

// --- Belly (spine) and chest: narrow at the armpits so hanging arms clear the ribs, broad
// across the upper chest, a sloped top to the shoulders.
add(
  loft(
    'belly',
    'spine',
    [0, 0, 0],
    [
      [1.04, 0.295, 0.19],
      [1.16, 0.3, 0.195],
      [1.28, 0.31, 0.205],
    ],
    SHIRT,
  ),
  loft(
    'ribs',
    'chest',
    [0, 0, 0],
    [
      [1.25, 0.305, 0.205],
      [1.33, 0.315, 0.22, 0, -0.005],
      [1.41, 0.33, 0.215, 0, -0.005],
      [1.47, 0.31, 0.185],
      [1.51, 0.2, 0.13],
    ],
    SHIRT,
  ),
  loft(
    'collar',
    'chest',
    [0, 0, 0],
    [
      [1.49, 0.135, 0.13, 0, 0.005],
      [1.525, 0.125, 0.12, 0, 0.005],
    ],
    SHIRT_D,
  ),
);

// --- Neck and head (inside the head volume).
add(
  loft(
    'neck',
    'neck',
    [0, 0, -0.005],
    [
      [1.45, 0.11, 0.11],
      [1.57, 0.095, 0.1],
    ],
    SKIN,
    { sides: 6 },
  ),
  loft(
    'skull',
    'head',
    [0, 0, -0.03],
    [
      [1.54, 0.065, 0.07, 0, -0.04],
      [1.575, 0.125, 0.145, 0, -0.008],
      [1.63, 0.15, 0.18],
      [1.69, 0.158, 0.188],
      [1.735, 0.132, 0.155, 0, -0.004],
      [1.755, 0.075, 0.095, 0, -0.005],
    ],
    SKIN,
  ),
  loft(
    'hair',
    'head',
    [0, 0, -0.03],
    [
      [1.705, 0.161, 0.19, 0, 0.003],
      [1.74, 0.14, 0.158, 0, -0.004],
      [1.762, 0.07, 0.09, 0, -0.005],
    ],
    HAIR,
  ),
  // A brow ridge and a short nose, low on the face; the eyes a dark band set in under it.
  hull(
    'brow',
    'head',
    [0, 0, 0],
    sym([
      [0.066, 1.671, -0.108],
      [0.066, 1.686, -0.106],
      [0.03, 1.671, -0.121],
      [0.03, 1.689, -0.119],
      [0, 1.671, -0.123],
      [0, 1.69, -0.121],
    ]),
    SKIN_D,
  ),
  hull(
    'nose',
    'head',
    [0, 0, 0],
    sym([
      [0.008, 1.668, -0.117],
      [0.016, 1.612, -0.116],
      [0.008, 1.612, -0.132],
    ]).concat([[0, 1.618, -0.134]]),
    SKIN_D,
  ),
  box('eyes', 'head', [0, 1.655, -0.112], [0.105, 0.014, 0.012], EYES),
  ...both(
    hull(
      'ear R',
      'head',
      [0, 0, 0],
      [
        [0.078, 1.6, -0.015],
        [0.078, 1.665, -0.025],
        [0.078, 1.66, 0.012],
        [0.093, 1.605, -0.008],
        [0.093, 1.655, -0.012],
        [0.093, 1.652, 0.01],
      ],
      SKIN_D,
    ),
  ),
);

// --- Arms (rolled so the loft runs out along +x). Ring w is up and down, d front to back.
const arm = (group, at, rings, color, extra = {}) =>
  loft(group, group, at, rings, color, { roll: -90, ...extra });
add(
  ...both(
    arm(
      'upperArmR',
      [P.shoulderX, P.shoulder, 0],
      [
        [-0.035, 0.1, 0.11],
        [0.03, 0.118, 0.12],
        [0.17, 0.095, 0.094],
        [0.3, 0.08, 0.08],
      ],
      SHIRT,
    ),
  ),
  // A flag patch on the shoulder (velcro), facing out and back as the arm hangs.
  ...both(
    box(
      'patch R',
      'upperArmR',
      [P.shoulderX + 0.09, P.shoulder + 0.052, 0.005],
      [0.07, 0.008, 0.05],
      SHIRT_D,
      { roll: -8 },
    ),
  ),
  ...both(
    arm(
      'forearmR',
      [P.shoulderX + P.upperArm, P.shoulder, 0],
      [
        [-0.02, 0.085, 0.085],
        [0.06, 0.09, 0.094],
        [0.17, 0.07, 0.075],
        [0.235, 0.064, 0.068],
      ],
      SHIRT,
    ),
  ),
  ...both(
    arm(
      'cuff R',
      [P.shoulderX + P.upperArm, P.shoulder, 0],
      [
        [0.215, 0.072, 0.076],
        [0.255, 0.07, 0.074],
      ],
      SHIRT_D,
      { group: 'forearmR' },
    ),
  ),
);
// Gloved hands: palm down, fingers out along x, thumb forward (−z).
const wrist = P.shoulderX + P.upperArm + P.forearm;
add(
  ...both(
    arm(
      'handR',
      [wrist, P.shoulder, 0],
      [
        [-0.015, 0.048, 0.07],
        [0.05, 0.04, 0.088],
        [0.1, 0.032, 0.085],
        [0.165, 0.022, 0.07],
      ],
      GLOVE,
      { sides: 6 },
    ),
  ),
  ...both(
    hull(
      'knuckles R',
      'handR',
      [0, 0, 0],
      [
        [wrist + 0.06, P.shoulder + 0.018, -0.04],
        [wrist + 0.06, P.shoulder + 0.018, 0.04],
        [wrist + 0.1, P.shoulder + 0.02, -0.04],
        [wrist + 0.1, P.shoulder + 0.02, 0.04],
        [wrist + 0.08, P.shoulder + 0.03, 0],
        [wrist + 0.07, P.shoulder + 0.01, 0],
      ],
      GLOVE_D,
    ),
  ),
  ...both(
    loft(
      'thumb R',
      'handR',
      [wrist + 0.03, P.shoulder - 0.008, -0.035],
      [
        [0, 0.026, 0.028],
        [0.07, 0.02, 0.02],
      ],
      GLOVE,
      { sides: 6, roll: -90, yaw: 40 },
    ),
  ),
);

// --- Legs: thighs and shins hang straight down from the hip joints.
const hx = P.hipJointX;
add(
  ...both(
    loft(
      'thighR',
      'thighR',
      [hx, P.hipJoint, 0],
      [
        [-0.39, 0.112, 0.118],
        [-0.3, 0.135, 0.14],
        [-0.15, 0.16, 0.168],
        [-0.02, 0.175, 0.185, -0.005, 0.005],
        [0.05, 0.165, 0.175, -0.015, 0.005],
      ],
      PANTS,
    ),
  ),
  // Cargo pocket on the outside of the thigh, with its flap.
  ...both(
    box('cargo R', 'thighR', [hx + 0.083, P.hipJoint - 0.21, 0.0], [0.022, 0.13, 0.11], PANTS, {
      roll: 3,
    }),
  ),
  ...both(
    box(
      'cargo flap R',
      'thighR',
      [hx + 0.086, P.hipJoint - 0.15, 0.0],
      [0.024, 0.03, 0.115],
      PANTS_D,
      { roll: 3 },
    ),
  ),
  ...both(
    loft(
      'shinR',
      'shinR',
      [hx, P.knee, 0],
      [
        [-0.33, 0.09, 0.095],
        [-0.17, 0.112, 0.125, 0, 0.012],
        [-0.02, 0.112, 0.118],
        [0.04, 0.105, 0.11],
      ],
      PANTS,
    ),
  ),
  // Knee pads: a faceted cap over the front of the knee, darker.
  ...both(
    hull(
      'knee pad R',
      'shinR',
      [hx, P.knee, 0],
      sym([
        [0.045, 0.06, -0.045],
        [0.045, -0.06, -0.045],
        [0.035, 0.05, -0.068],
        [0.035, -0.05, -0.068],
        [0, 0.07, -0.062],
        [0, -0.07, -0.062],
        [0, 0.045, -0.078],
        [0, -0.045, -0.078],
      ]),
      PANTS_D,
    ),
  ),
);

// --- Boots (foot bone, from the ankle): a shaft round the ankle, the upper with a toe, a sole.
add(
  ...both(
    loft(
      'boot shaft R',
      'footR',
      [hx, 0, 0.005],
      [
        [0.04, 0.1, 0.115],
        [0.14, 0.1, 0.11],
        [0.175, 0.098, 0.106],
      ],
      BOOT,
    ),
  ),
  ...both(
    hull(
      'boot R',
      'footR',
      [hx, 0, 0],
      sym([
        [0.05, 0.022, 0.065],
        [0.052, 0.022, -0.1],
        [0.038, 0.022, -0.18],
        [0.046, 0.11, 0.06],
        [0.047, 0.1, -0.03],
        [0.04, 0.065, -0.13],
        [0.03, 0.048, -0.178],
      ]),
      BOOT,
    ),
  ),
  ...both(
    hull(
      'sole R',
      'footR',
      [hx, 0, 0],
      sym([
        [0.054, 0, 0.07],
        [0.056, 0, -0.1],
        [0.04, 0, -0.188],
        [0.054, 0.025, 0.07],
        [0.056, 0.025, -0.1],
        [0.04, 0.025, -0.186],
      ]),
      SOLE,
    ),
  ),
);

// --- Write the skeleton's offsets and the body's parts.
const skeletonFile = 'content/characters/skeleton.json';
const sk = JSON.parse(readFileSync(skeletonFile, 'utf8'));
const OFFSETS = {
  hips: [0, P.hips, 0],
  spine: [0, P.spine - P.hips, 0],
  chest: [0, P.chest - P.spine, 0],
  neck: [0, P.neck - P.chest, 0],
  head: [0, P.head - P.neck, 0],
  upperArmL: [-P.shoulderX, P.shoulder - P.chest, 0],
  forearmL: [-P.upperArm, 0, 0],
  handL: [-P.forearm, 0, 0],
  upperArmR: [P.shoulderX, P.shoulder - P.chest, 0],
  forearmR: [P.upperArm, 0, 0],
  handR: [P.forearm, 0, 0],
  thighL: [-P.hipJointX, P.hipJoint - P.hips, 0],
  shinL: [0, P.knee - P.hipJoint, 0],
  footL: [0, P.ankle - P.knee, 0],
  thighR: [P.hipJointX, P.hipJoint - P.hips, 0],
  shinR: [0, P.knee - P.hipJoint, 0],
  footR: [0, P.ankle - P.knee, 0],
};
for (const b of sk.bones) b.offset = OFFSETS[b.name].map(r3);
writeFileSync(skeletonFile, JSON.stringify(sk, null, 2) + '\n');

const bodyFile = 'content/characters/body.json';
const body = JSON.parse(readFileSync(bodyFile, 'utf8'));
body.colors = { skin: SKIN, top: SHIRT, bottom: PANTS, hands: GLOVE, feet: BOOT };
body.model = { parts: parts.map(clean) };
writeFileSync(bodyFile, JSON.stringify(body, null, 2) + '\n');
console.log(`${parts.length} parts`);
