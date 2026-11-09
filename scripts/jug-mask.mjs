// Rebuilds the parts of content/items/jug-mask.json (2026-11-08): a faceted visor and its
// sprayed smiley, laid out flat and wrapped onto the facets. Run from the repo root:
// node scripts/jug-mask.mjs content/items/jug-mask.json && npx prettier --write content/items/jug-mask.json
import fs from 'node:fs';
const file = process.argv[2];
const item = JSON.parse(fs.readFileSync(file, 'utf8'));
const r3 = (n) => Math.round(n * 1000) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;
const D = Math.PI / 180;

const R = 0.155; // visor radius from the head's centre (outside the dome's 0.142)
const STEP = 32; // degrees per facet
const ANGLES = [-64, -32, 0, 32, 64];
const SHIELD = '#262b30';
const PAINT = '#39ff6a';
const W = 2 * R * Math.tan((STEP / 2) * D) + 0.003;
const UP = { y0: 1.575, y1: 1.765 };
const upH = UP.y1 - UP.y0;
const upY = (UP.y0 + UP.y1) / 2;

const parts = [
  // Helmet shell, crest, ear plates, back strap (kept from before).
  {
    type: 'cylinder',
    pos: [0, 1.719, 0],
    radius: 0.142,
    radiusTop: 0.116,
    height: 0.122,
    sides: 10,
    colour: '#55595d',
  },
  {
    type: 'cylinder',
    pos: [0, 1.795, 0],
    radius: 0.116,
    radiusTop: 0.06,
    height: 0.036,
    sides: 10,
    colour: '#4a4e52',
  },
  { type: 'box', pos: [0, 1.735, 0.02], size: [0.03, 0.11, 0.27], colour: '#3d4145' },
  // Ear plates sit back a little so the visor's side facets cover their fronts.
  { type: 'box', pos: [0.128, 1.67, 0.03], size: [0.034, 0.12, 0.13], colour: '#4a4636' },
  { type: 'box', pos: [-0.128, 1.67, 0.03], size: [0.034, 0.12, 0.13], colour: '#4a4636' },
  { type: 'box', pos: [0, 1.62, 0.11], size: [0.24, 0.12, 0.05], colour: '#4a4636' },
  // Visor pivots on the ear plates.
  {
    type: 'cylinder',
    pos: [0.152, 1.7, 0.012],
    radius: 0.018,
    height: 0.016,
    sides: 8,
    roll: 90,
    colour: '#55595d',
  },
  {
    type: 'cylinder',
    pos: [-0.152, 1.7, 0.012],
    radius: 0.018,
    height: 0.016,
    sides: 8,
    roll: 90,
    colour: '#55595d',
  },
];

// The visor: an upright band of flat facets round the face, and a chin row tucked in under it.
const CHIN_H = 0.075;
const CHIN_PITCH = -30;
const s = Math.sin(-CHIN_PITCH * D);
const c = Math.cos(-CHIN_PITCH * D);
const chinR = R - (CHIN_H / 2) * s;
const chinY = UP.y0 - (CHIN_H / 2) * c;
for (const a of ANGLES) {
  parts.push({
    type: 'box',
    pos: [r3(R * Math.sin(a * D)), r3(upY), r3(-R * Math.cos(a * D))],
    size: [r3(W), r3(upH), 0.016],
    yaw: -a,
    colour: SHIELD,
  });
}
for (const a of ANGLES) {
  parts.push({
    type: 'box',
    pos: [r3(chinR * Math.sin(a * D)), r3(chinY), r3(-chinR * Math.cos(a * D))],
    size: [r3(W - 0.004), CHIN_H, 0.014],
    yaw: -a,
    pitch: CHIN_PITCH,
    colour: SHIELD,
  });
}

// Paint, laid out flat (s along the curve in metres, y up), then put on the facet under it.
const A = R + 0.008 + 0.0012 + 0.002; // facet face + 1.2 mm + half the paint's depth
function paint(sv, y, len, thick, roll) {
  const b = sv / R;
  const a = Math.round(b / D / STEP) * STEP;
  const d = A / Math.cos(b - a * D);
  parts.push({
    type: 'box',
    pos: [r3(d * Math.sin(b)), r3(y), r3(-d * Math.cos(b))],
    size: [r3(len), r3(thick), 0.004],
    yaw: -a,
    roll: r1(roll),
    colour: PAINT,
  });
}
function drip(sv, yTop, len, blob) {
  paint(sv, yTop - len / 2, 0.005, len, 0);
  if (blob) paint(sv, yTop - len + 0.002, 0.009, 0.009, 45);
}

// Eyes: round-ish sprayed blobs (a square and a square turned 45°), lopsided, each
// running from its lower edge.
function eye(sv, y, size, lump, lumpAt, run) {
  paint(sv, y, size, size, 0);
  paint(sv, y, size * 0.95, size * 0.95, 45);
  paint(sv + lumpAt[0], y + lumpAt[1], lump, lump, 30);
  drip(sv + run[0], y - size * 0.45, run[1], true);
}
eye(-0.048, 1.716, 0.03, 0.016, [-0.012, 0.009], [0.007, 0.03]);
eye(0.05, 1.713, 0.034, 0.014, [0.013, -0.008], [-0.006, 0.019]);

// The grin: a wide arc in short, uneven strokes.
const CX = 0,
  CY = 1.684,
  RAD = 0.066;
const N = 8,
  T0 = 186,
  T1 = 354;
const thick = [0.011, 0.014, 0.017, 0.015, 0.018, 0.016, 0.014, 0.01];
const jitter = [7, -4, 3, -6, 4, -3, 5, -6];
const seg = (T1 - T0) / N;
for (let i = 0; i < N; i++) {
  const t0 = (T0 + i * seg) * D,
    t1 = (T0 + (i + 1) * seg) * D;
  const x0 = CX + RAD * Math.cos(t0),
    y0 = CY + RAD * Math.sin(t0);
  const x1 = CX + RAD * Math.cos(t1),
    y1 = CY + RAD * Math.sin(t1);
  const len = Math.hypot(x1 - x0, y1 - y0) + 0.007;
  paint((x0 + x1) / 2, (y0 + y1) / 2, len, thick[i], Math.atan2(y1 - y0, x1 - x0) / D + jitter[i]);
}
// Runs off the bottom of the grin, one long one.
drip(-0.026, 1.624, 0.026, true);
drip(0.005, 1.62, 0.042, true);
drip(0.037, 1.627, 0.018, true);

item.model.parts = parts;
fs.writeFileSync(file, JSON.stringify(item, null, 2) + '\n');
console.log(parts.length, 'parts');
