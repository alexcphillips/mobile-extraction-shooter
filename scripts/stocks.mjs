// The stocks and stock kits from the user's list (AT-7a, AT-7b): every one's item file,
// model and all. Models are in the stock mount's frame (origin where the stock's front
// sits, +z back toward the shoulder, y up): `ar15` stocks slide on the buffer tube's axis,
// `ak` ones bolt to the receiver's back, SMG plates and pads sit on the gun's own mount. A
// stock kit's foregrip is in the gun's foregrip mount's frame (models.ts → foregrip).
//
//   node scripts/stocks.mjs [--dry] [id ...]
//
// The JSON is the item once anyone edits it: run with --dry first, and if it says a file
// differs, leave that one out (it would undo the edit). Points are converted from the list
// by docs/reference/attachment-list.md; tune them in the item editor, not here.
import fs from 'node:fs';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';
import { gunParts, r5, v3 } from './gun-kit.mjs';

const DIR = new URL('../content/items/', import.meta.url).pathname;
const FORMAT = 13;

const POLY = '#3a3d41'; // stock polymer, a step lighter than receivers
const POLY_HI = '#45494e'; // edges and risers that catch the light
const DARK = '#2a2c2f'; // metal adapters and rails
const SLOT = '#161719'; // slots, levers, rail bases
const STEEL = '#202123'; // rods and tubes
const RUBBER = '#18191a'; // butt pads, grip caps
const PIN = '#55585d'; // pins and screws

const G = 'stock';

/** Moves parts by [dy, dz] (every part's pos is its center, so this moves all of it). */
function shift(parts, from, dy, dz) {
  for (const p of parts.slice(from)) p.pos = v3([p.pos[0], p.pos[1] + dy, p.pos[2] + dz]);
}

/** A rubber butt pad on the back of a butt from `top` down to `toe`, its back at z. */
function pad(P, z, top, toe, halfW, extra = {}) {
  P.add({
    type: 'slab',
    pos: v3([0, (top + toe) / 2, z - 0.0075]),
    size: v3([halfW * 2 + 0.003, top - toe, 0.015]),
    corners: [0.004, 0.004, 0.004, 0.004],
    segments: 2,
    color: RUBBER,
    name: 'butt pad',
    group: G,
    ...extra,
  });
}

/**
 * The AR buffer tube a stock brings with it (a gun draws its own only with its factory
 * stock): the castle nut against the receiver, TUBE_BACK in front of the stock's origin, and
 * the tube back to z1, inside the butt.
 */
const TUBE_BACK = 0.056; // every `ar15` gun's receiver back sits this far ahead of its mount
function arTube(P, z1) {
  // Lighter than a gun's own (no end plate, fewer sides): it counts in the stock's budget.
  P.tubeZ(G, 'castle nut', 0, -TUBE_BACK + 0.002, -TUBE_BACK + 0.012, 0.0175, SLOT, { sides: 6 });
  P.tubeZ(G, 'buffer tube', 0, -TUBE_BACK + 0.006, z1, 0.0148, STEEL, { sides: 8 });
}

/**
 * An AR-pattern stock on the buffer tube's axis (y = 0), its butt's back at `len` with the
 * pad behind it. `kind`: 'solid' (a web down to the toe), 'skeleton' (open: a short
 * sleeve, a top bar and a toe strut), 'slim' (a light sleeve and a strut). It brings its
 * buffer tube (`tube: false` leaves it out).
 */
function arStock(P, o) {
  const { box, tubeZ, tubeX, prism, extrudeZ } = P;
  const kind = o.kind ?? 'solid';
  const L = o.len ?? 0.12;
  const w = o.w ?? (kind === 'slim' ? 0.0145 : 0.017);
  const top = o.top ?? (kind === 'slim' ? 0.023 : 0.029);
  const toe = o.toe ?? (kind === 'slim' ? -0.062 : -0.075);
  const heel = top + 0.005;
  const bw = o.bw ?? w + 0.0015;
  const sleeveEnd = kind === 'skeleton' ? 0.055 : L - 0.03;
  const section = [
    [-(w - 0.0045), -0.006],
    [w - 0.0045, -0.006],
    [w, -0.0015],
    [w, top - 0.005],
    [w - 0.005, top],
    [-(w - 0.005), top],
    [-w, top - 0.005],
    [-w, -0.0015],
  ];
  // Its own tube, unless it rides one it brings some other way (an AK adapter's).
  if (o.tube !== false) arTube(P, Math.min(0.122, L - 0.004));
  extrudeZ(G, 'sleeve', section, 0, sleeveEnd, POLY);
  if (kind === 'skeleton') {
    // The open frame: a bar along the top to the butt, and the toe strut below.
    prism(
      G,
      'top bar',
      [
        [top, 0.05],
        [top, L - 0.008],
        [top - 0.009, L - 0.008],
        [top - 0.009, 0.05],
      ].map(([y, z]) => [y, z, 0.0065]),
      POLY,
    );
  }
  // The butt: a deep plate, its front edge raked (a thin plate on a skeleton).
  const thin = kind === 'skeleton' ? 0.012 : kind === 'slim' ? 0.022 : 0.038;
  prism(
    G,
    'butt',
    [
      [heel - 0.002, L - thin],
      [heel, L],
      [toe, L],
      [toe + 0.002, L - Math.min(thin, 0.018)],
      ...(kind === 'skeleton' ? [] : [[-0.02, L - thin + 0.004]]),
    ].map(([y, z]) => [y, z, bw]),
    POLY,
  );
  // Under the sleeve down to the toe: a strut, or a web on a solid stock.
  const web = kind === 'solid' ? 0.012 : 0.0055;
  prism(
    G,
    kind === 'solid' ? 'web' : 'toe strut',
    [
      [-0.004, 0.018],
      [-0.004, kind === 'solid' ? L - 0.04 : 0.034],
      [toe + 0.004, L - 0.012],
      [toe + 0.002, L - 0.026],
    ].map(([y, z]) => [y, z, web]),
    kind === 'solid' ? POLY : POLY_HI,
  );
  pad(P, L + 0.015, heel, toe, bw);
  box(G, 'adjustment lever', [0, -0.008, 0.02], [0.008, 0.005, 0.028], SLOT);
  tubeX(G, 'sling loop', [0, toe + 0.007, L - 0.012], 0.0032, bw * 2 + 0.004, STEEL);
  if (o.cheek) {
    // A raised cheek rest for a steadier, higher head.
    box(G, 'cheek riser', [0, top + 0.005, L * 0.58], [w * 1.4, 0.01, L * 0.62], POLY_HI);
  }
  if (o.rail) {
    // A short accessory rail along the top of the sleeve.
    box(G, 'rail base', [0, top + 0.002, 0.045], [0.014, 0.004, 0.05], SLOT);
    for (let i = 0; i < 5; i++)
      box(G, 'rail tooth', [0, top + 0.0055, 0.025 + i * 0.01], [0.016, 0.003, 0.005], DARK);
  }
  if (o.tubes) {
    // Storage tubes along both sides, with dark end caps.
    for (const s of [1, -1]) {
      tubeZ(G, 'storage tube', -0.0155, 0.044, L - 0.001, 0.0085, POLY_HI, {
        x: s * (w - 0.003),
        sides: 8,
      });
      tubeZ(G, 'storage tube cap', -0.0155, 0.039, 0.0445, 0.0072, RUBBER, {
        x: s * (w - 0.003),
        sides: 5,
      });
    }
  }
  if (o.plates) {
    // Steel side plates on a reinforced stock.
    for (const s of [1, -1])
      box(
        G,
        'side plate',
        [s * (w + 0.0006), top * 0.45, L * 0.4],
        [0.0012, top * 0.6, L * 0.5],
        DARK,
      );
  }
}

/** An AK's receiver adapter: a block on the back of the receiver the stock bolts to. */
function akAdapter(P, h = 0.05) {
  P.box(G, 'receiver adapter', [0, 0.004, 0.012], [0.03, h, 0.024], DARK);
  for (const s of [1, -1]) P.tubeX(G, 'pin', [0, 0.004 + (s * h) / 4, 0.012], 0.0022, 0.032, PIN);
}

// ================= The stocks. `control` is both recoil stats down; stock length is a cell
// unless given, and size 2 × 1.
const control = (n) => ({ recoilUp: -n, recoilSide: -n });
const AR = { platforms: ['ar15'] };
const AK = { platforms: ['ak'] };

const STOCKS = [
  {
    id: 'standard-tactical-stock',
    name: 'Standard tactical stock',
    shortName: 'Std tactical',
    fits: AR,
    mods: { ...control(6), handling: -2 },
    value: 3000,
    weight: 0.35,
    build: (P) => arStock(P, { kind: 'solid' }),
  },
  {
    id: 'reinforced-rail-stock',
    name: 'Reinforced rail stock',
    shortName: 'Rail',
    fits: AR,
    mods: { ...control(6), stability: 9, handling: -3 },
    value: 6500,
    weight: 0.48,
    build: (P) => arStock(P, { kind: 'solid', rail: true, plates: true }),
  },
  {
    id: 'precision-support-stock',
    name: 'Precision support stock',
    shortName: 'Precision',
    fits: AR,
    mods: { ...control(6), stability: 6, handling: -1 },
    value: 5500,
    weight: 0.42,
    build: (P) => arStock(P, { kind: 'solid', cheek: true, len: 0.128 }),
  },
  {
    id: 'enhanced-combat-stock',
    name: 'Enhanced combat stock',
    shortName: 'Combat',
    fits: AR,
    mods: { ...control(3), handling: 6, stability: 3 },
    value: 5000,
    weight: 0.3,
    build: (P) => arStock(P, { kind: 'slim', toe: -0.068, cheek: true, len: 0.11 }),
  },
  {
    id: 'lightweight-buffer-stock',
    name: 'Lightweight buffer stock',
    shortName: 'Light buffer',
    fits: AR,
    mods: { ...control(3), handling: 12, stability: -9 },
    value: 6000,
    weight: 0.22,
    build: (P) => arStock(P, { kind: 'slim', len: 0.1 }),
  },
  {
    id: 'heavy-duty-tactical-stock',
    name: 'Heavy duty tactical stock',
    shortName: 'Heavy duty',
    fits: AR,
    mods: { ...control(9), stability: 6, handling: -6 },
    value: 7000,
    weight: 0.6,
    build: (P) => arStock(P, { kind: 'solid', w: 0.019, bw: 0.021, toe: -0.08, tubes: true }),
  },
  {
    id: 'skeleton-precision-stock',
    name: 'Skeleton precision stock',
    shortName: 'Skel precision',
    fits: AR,
    mods: { handling: 9, stability: 9, ...control(-6) },
    value: 7500,
    weight: 0.26,
    build: (P) => arStock(P, { kind: 'skeleton', cheek: true, len: 0.13 }),
  },
  {
    id: 'stability-core-stock',
    name: 'Stability core stock',
    shortName: 'Stab core',
    fits: AR,
    mods: { ...control(6), stability: 12, handling: -9 },
    value: 8000,
    weight: 0.62,
    build: (P) =>
      arStock(P, { kind: 'solid', w: 0.019, bw: 0.021, toe: -0.082, cheek: true, plates: true }),
  },
  {
    id: 'lightweight-skeleton-stock',
    name: 'Lightweight skeleton stock',
    shortName: 'Light skel',
    fits: AR,
    mods: { ...control(9), handling: 9, stability: -9 },
    value: 8500,
    weight: 0.2,
    build: (P) => arStock(P, { kind: 'skeleton', toe: -0.066, len: 0.115 }),
  },
  {
    id: 'rapid-response-stock',
    name: 'Rapid response stock',
    shortName: 'Rapid',
    fits: AR,
    mods: { ...control(6), handling: 9, stability: -3 },
    value: 8000,
    weight: 0.28,
    build: (P) => arStock(P, { kind: 'slim', rail: true, len: 0.108 }),
  },
  {
    id: 'reinforced-core-stock',
    name: 'Reinforced core stock',
    shortName: 'Reinforced',
    fits: AR,
    mods: { ...control(9), handling: -3 },
    value: 5500,
    weight: 0.5,
    build: (P) => arStock(P, { kind: 'solid', plates: true, toe: -0.078 }),
  },
  {
    id: 'extended-buffer-stock',
    name: 'Extended buffer stock',
    shortName: 'Ext buffer',
    fits: AR,
    mods: { handling: 12, ...control(-9), stability: -6 },
    value: 4500,
    weight: 0.18,
    build: (P) => arStock(P, { kind: 'slim', w: 0.013, top: 0.019, toe: -0.055, len: 0.09 }),
  },
  {
    id: 'compact-mobility-stock',
    name: 'Compact mobility stock',
    shortName: 'Compact',
    fits: AR,
    mods: { handling: 6, stability: -3 },
    stock: { length: 0 },
    size: [1, 1],
    value: 4000,
    weight: 0.16,
    build: (P) => arStock(P, { kind: 'slim', w: 0.0135, top: 0.02, toe: -0.055, len: 0.06 }),
  },
  // The m416's bare buffer tube: no stock at all, the lightest thing on its mount. It fits
  // only the m416 (the user's call: tubes are per gun, not per platform).
  {
    id: 'm416-buffer-tube',
    name: 'M416 buffer tube',
    shortName: 'Tube',
    fits: { weapons: ['m416'] },
    mods: { handling: 12, ...control(-12), stability: -15 },
    stock: { length: 0 },
    size: [1, 1],
    value: 1500,
    weight: 0.1,
    build: (P) => {
      arTube(P, 0.118);
      P.tubeZ(G, 'tube cap', 0, 0.118, 0.124, 0.0156, RUBBER, { sides: 10 });
      P.tubeX(G, 'sling plate', [0, 0, -TUBE_BACK + 0.0145], 0.0045, 0.04, DARK, { sides: 6 });
    },
  },
  // Seen on the AN-94: the `ak` platform.
  {
    id: 'rapid-adjust-stock',
    name: 'Rapid adjust stock',
    shortName: 'Rapid adjust',
    fits: AK,
    mods: { handling: 12, stability: -9 },
    value: 6500,
    weight: 0.34,
    build: (P) => {
      // An adapter on the receiver, a tube from it, and a slim stock sliding on the tube.
      akAdapter(P, 0.056);
      P.tubeZ(G, 'buffer tube', 0.016, 0.024, 0.205, 0.0148, STEEL, { sides: 10 });
      const from = P.parts.length;
      arStock(P, { kind: 'slim', len: 0.11, tube: false });
      shift(P.parts, from, 0.016, 0.09);
    },
  },
  {
    id: 'ak-lightweight-skeleton-stock',
    name: 'AK lightweight skeleton stock',
    shortName: 'AK skel',
    fits: AK,
    mods: { handling: 12, ...control(-6), stability: -6 },
    value: 6000,
    weight: 0.24,
    build: (P) => {
      akAdapter(P);
      // A triangle frame: a bar along the top, one down to the toe, and a plate at the back.
      P.prism(
        G,
        'top bar',
        [
          [0.03, 0.02],
          [0.019, 0.02],
          [0.003, 0.24],
          [0.014, 0.24],
        ].map(([y, z]) => [y, z, 0.0065]),
        POLY,
      );
      P.prism(
        G,
        'lower bar',
        [
          [-0.012, 0.02],
          [-0.022, 0.02],
          [-0.084, 0.236],
          [-0.072, 0.24],
        ].map(([y, z]) => [y, z, 0.0065]),
        POLY,
      );
      P.prism(
        G,
        'butt',
        [
          [0.016, 0.228],
          [0.017, 0.25],
          [-0.088, 0.25],
          [-0.086, 0.232],
        ].map(([y, z]) => [y, z, 0.0165]),
        POLY,
      );
      pad(P, 0.265, 0.017, -0.088, 0.0165);
      P.tubeX(G, 'sling loop', [0, -0.08, 0.215], 0.0032, 0.02, STEEL);
    },
  },
  {
    id: 'standard-core-stock',
    name: 'Standard core stock',
    shortName: 'Core',
    fits: AK,
    mods: { ...control(3), stability: 3, handling: -2 },
    value: 3000,
    weight: 0.4,
    build: (P) => {
      akAdapter(P);
      // A solid fixed stock tapering down to the butt, with a dark sling slot through it.
      P.add({
        type: 'hull',
        pos: v3([0, -0.03, 0.13]),
        points: [
          [0.0155, 0.032, 0.02],
          [-0.0155, 0.032, 0.02],
          [0.0155, -0.024, 0.02],
          [-0.0155, -0.024, 0.02],
          [0.0185, 0.014, 0.25],
          [-0.0185, 0.014, 0.25],
          [0.0185, -0.09, 0.25],
          [-0.0185, -0.09, 0.25],
        ].map(([x, y, z]) => v3([x, y + 0.03, z - 0.13])),
        color: POLY,
        name: 'stock body',
        group: G,
      });
      P.box(G, 'comb', [0, 0.026, 0.13], [0.026, 0.006, 0.19], POLY_HI, { pitch: 5.5 });
      P.box(G, 'sling slot', [0, -0.045, 0.185], [0.039, 0.008, 0.03], SLOT);
      pad(P, 0.265, 0.014, -0.09, 0.0185);
    },
  },
  // The MP7 (not the k10: its stocks ride a buffer tube, GM-2).
  {
    id: 'compact-end-plate',
    name: 'Compact end plate',
    shortName: 'End plate',
    fits: { weapons: ['mp7'] },
    mods: { handling: 12, ...control(-12), stability: -6 },
    size: [1, 1],
    value: 4000,
    weight: 0.12,
    build: (P) => {
      P.box(G, 'adapter', [0, -0.004, 0.008], [0.036, 0.024, 0.016], DARK);
      for (const s of [1, -1])
        P.tubeZ(G, 'rod', -0.004, 0.016, 0.112, 0.0035, STEEL, { x: s * 0.0125, sides: 6 });
      P.prism(
        G,
        'end plate',
        [
          [0.012, 0.11],
          [0.012, 0.12],
          [-0.058, 0.12],
          [-0.056, 0.11],
        ].map(([y, z]) => [y, z, 0.0165]),
        POLY,
      );
      pad(P, 0.133, 0.012, -0.058, 0.0165);
    },
  },
  // Every SMG with a stock slot and no buffer tube (GM-2): close to no stock at all.
  {
    id: 'reinforced-end-pad',
    name: 'Reinforced end pad',
    shortName: 'End pad',
    fits: { weapons: ['mp5', 'mp7', 'ump45', 'uzi', 'uzi-pro'] },
    mods: { handling: 9, ...control(-12), stability: -18 },
    stock: { length: 0 },
    size: [1, 1],
    value: 2500,
    weight: 0.08,
    build: (P) => {
      P.box(G, 'adapter', [0, -0.008, 0.01], [0.03, 0.036, 0.02], DARK);
      P.box(G, 'backing plate', [0, -0.022, 0.023], [0.04, 0.084, 0.006], POLY);
      pad(P, 0.042, 0.02, -0.066, 0.0185);
    },
  },
  // The P90's own (GM-4b, the user's call): a deep rubber recoil pad sized to its butt, in
  // place of the thin factory plate. A little steadier, a little slower.
  {
    id: 'p90-recoil-pad',
    name: 'P90 recoil pad',
    shortName: 'Recoil pad',
    fits: { weapons: ['p90'] },
    mods: { ...control(9), handling: -6 },
    stock: { length: 0 },
    size: [1, 1],
    value: 3000,
    weight: 0.12,
    build: (P) => {
      // The p90's butt runs from 0.057 above its mount to 0.057 below it, 0.05 wide.
      P.box(G, 'spacer', [0, 0, 0.003], [0.048, 0.11, 0.006], POLY);
      P.add({
        type: 'slab',
        pos: v3([0, 0, 0.0155]),
        size: v3([0.05, 0.112, 0.019]),
        corners: [0.006, 0.006, 0.006, 0.006],
        segments: 2,
        color: RUBBER,
        name: 'recoil pad',
        group: G,
      });
      for (const y of [-0.036, -0.012, 0.012, 0.036])
        P.box(G, 'pad rib', [0, y, 0.0252], [0.038, 0.002, 0.0006], SLOT);
    },
  },
];

// ================= Stock kits (AT-7b): a stock with its own foregrip, on `ar15`.
/** A kit's foregrip, in the foregrip mount's frame: a rail clamp and a grip under it. */
function kitForegrip(o) {
  const F = gunParts();
  const g = 'foregrip';
  F.add({
    type: 'slab',
    pos: [0, -0.003, 0],
    size: v3([0.02, 0.006, o.clamp]),
    color: SLOT,
    corners: [0.0015, 0.0015, 0.0015, 0.0015],
    segments: 1,
    name: 'rail clamp',
    group: g,
  });
  F.box(g, 'clamp screw', [0.0105, -0.004, 0], [0.002, 0.004, 0.01], PIN);
  F.add({
    type: 'cylinder',
    pos: v3([0, -0.006 - o.len / 2, o.rake / 2]),
    radius: r5(o.r),
    radiusTop: r5(o.r + 0.0015),
    height: r5(Math.hypot(o.len, o.rake)),
    pitch: r5((-Math.atan2(o.rake, o.len) * 180) / Math.PI),
    color: POLY,
    sides: 8,
    yaw: 22.5,
    name: 'grip',
    group: g,
  });
  F.add({
    type: 'cylinder',
    pos: v3([0, -0.008 - o.len, o.rake]),
    radius: r5(o.r + 0.001),
    height: 0.004,
    pitch: r5((-Math.atan2(o.rake, o.len) * 180) / Math.PI),
    color: RUBBER,
    sides: 8,
    yaw: 22.5,
    name: 'end cap',
    group: g,
  });
  return { parts: F.parts, support: v3([0, -0.034, o.rake * 0.45]) };
}

STOCKS.push(
  {
    id: 'integrated-precision-stock',
    name: 'Integrated precision stock',
    shortName: 'Int precision',
    fits: AR,
    mods: { ...control(12), handling: 12, stability: -9 },
    value: 14000,
    weight: 0.55,
    build: (P) => arStock(P, { kind: 'slim', cheek: true, len: 0.112 }),
    foregrip: kitForegrip({ clamp: 0.03, len: 0.05, rake: 0.012, r: 0.0098 }),
  },
  {
    id: 'heavy-integrated-stock',
    name: 'Heavy integrated stock',
    shortName: 'Heavy int',
    fits: AR,
    mods: { ...control(12), stability: 12, handling: -9 },
    value: 15000,
    weight: 0.85,
    build: (P) =>
      arStock(P, { kind: 'solid', w: 0.019, bw: 0.021, toe: -0.082, tubes: true, plates: true }),
    foregrip: kitForegrip({ clamp: 0.036, len: 0.062, rake: 0, r: 0.012 }),
  },
);

// ================= Write
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry');
for (const s of STOCKS) {
  if (only.length && !only.includes(s.id)) continue;
  const P = gunParts();
  s.build(P);
  const model = { parts: P.parts, ...(s.foregrip && { foregrip: s.foregrip }) };
  const item = {
    formatVersion: FORMAT,
    id: s.id,
    name: s.name,
    shortName: s.shortName,
    type: 'attachment',
    size: s.size ?? [2, 1],
    value: s.value,
    weight: s.weight,
    rarity: 'common',
    slot: 'stock',
    ...s.fits,
    stock: s.stock ?? { length: 1 },
    mods: s.mods,
    model,
  };
  const file = `${DIR}${s.id}.json`;
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const options = (await prettier.resolveConfig(file)) ?? {};
  const after = await prettier.format(layout(item), { ...options, filepath: file });
  if (dry)
    console.log(`${s.id}: ${before === null ? 'new' : before === after ? 'matches' : 'differs'}`);
  else if (after !== before) fs.writeFileSync(file, after);
}
