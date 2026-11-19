// Shared helpers for optic (and other item-model) generators: window outlines built from a
// core polygon, the panel faces of a frame round them, and writing the model into an item
// file prettier-formatted. See docs/optics.md → Part shapes for why they work this way.
//
//   import { r5, coreOutline, roundOutline, ringFaces, edgeFaces, writeItem } from '../../scripts/optic-kit.mjs';
//
// A generator lives in the scratchpad and imports this by path. Run it with --dry first:
// it reports whether the item file differs from what it would write (a difference means the
// user has hand-edited the JSON, and from then on the JSON is the model).

import fs from 'node:fs';
import * as prettier from 'prettier';

const DEG = 180 / Math.PI;

/** Rounds to 0.01 mm, so the JSON stays short. */
export const r5 = (n) => Math.round(n * 1e5) / 1e5;

/**
 * A window outline: the convex `core` polygon ([x, y] points, counter-clockwise, in the
 * window's own frame) grown outward by a radius. Returns `outline(r)`, the outline's points
 * at radius r. Every radius is sampled at the same normal angles, so outlines at different
 * radii are concentric, a frame between two of them is the same thickness all the way
 * round, and each quad between them is convex. `step` is the largest turn per arc segment.
 */
export function coreOutline(core, { step = Math.PI / 8 } = {}) {
  const normal = (a, b) => Math.atan2(-(b[0] - a[0]), b[1] - a[1]); // outward, for CCW
  const samples = [];
  for (let i = 0; i < core.length; i++) {
    const prev = core[(i + core.length - 1) % core.length];
    const next = core[(i + 1) % core.length];
    const a0 = normal(prev, core[i]);
    let a1 = normal(core[i], next);
    while (a1 < a0) a1 += Math.PI * 2;
    const steps = Math.max(1, Math.ceil((a1 - a0) / step));
    for (let k = 0; k <= steps; k++) samples.push([i, a0 + ((a1 - a0) * k) / steps]);
  }
  return (r) =>
    samples.map(([i, a]) => [core[i][0] + r * Math.cos(a), core[i][1] + r * Math.sin(a)]);
}

/** A round window's outline (a hoop): `segments` points round a circle, counter-clockwise. */
export function roundOutline(segments = 24) {
  return (r) =>
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
}

/**
 * The flat face between two outlines (radii rOut and rIn) at depth z, as one panel per
 * segment: facing the eye (+z) when `back`, else the front (−z). `center` is the window's
 * [x, y]. `skip(quad)` leaves out segments that are hidden (quad points window-local).
 */
export function ringFaces(add, { outline, rOut, rIn, center, z, back, color, name, group, skip }) {
  const o = outline(rOut);
  const n = outline(rIn);
  for (let i = 0; i < o.length; i++) {
    const j = (i + 1) % o.length;
    if (Math.hypot(o[j][0] - o[i][0], o[j][1] - o[i][1]) < 1e-6) continue;
    const quad = [o[i], o[j], n[j], n[i]];
    if (skip?.(quad)) continue;
    add({
      type: 'panel',
      pos: [r5(center[0]), r5(center[1]), r5(z)],
      color,
      // pitch 90: local z is world −y; pitch −90: local z is world +y.
      pitch: back ? 90 : -90,
      points: quad.map(([x, y]) => [r5(x), r5(back ? -y : y)]),
      name,
      group,
    });
  }
}

/**
 * The faces along an outline at radius r, from depth z0 to z1: the outer skin of a frame
 * (`outward`) or its inner skin (facing the window's middle). `skip(a, b)` leaves out
 * hidden segments (points window-local).
 */
export function edgeFaces(add, { outline, r, center, z0, z1, outward, color, name, group, skip }) {
  const o = outline(r);
  for (let i = 0; i < o.length; i++) {
    const a = o[i];
    const b = o[(i + 1) % o.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6 || skip?.(a, b)) continue;
    const s = outward ? 1 : -1;
    const nx = (s * (b[1] - a[1])) / len;
    const ny = (-s * (b[0] - a[0])) / len;
    add({
      type: 'panel',
      pos: [
        r5(center[0] + (a[0] + b[0]) / 2),
        r5(center[1] + (a[1] + b[1]) / 2),
        r5((z0 + z1) / 2),
      ],
      color,
      // A panel rolled θ has its normal at (−sin θ, cos θ).
      roll: Math.round((Math.atan2(ny, nx) * DEG - 90) * 100) / 100,
      size: [r5(len), r5(Math.abs(z1 - z0))],
      name,
      group,
    });
  }
}

/**
 * Reads the item file, lets `apply(item)` change it (set model, optic), and writes it
 * prettier-formatted as the repo's files are. With --dry on the command line, writes nothing
 * and says whether the file would change. Returns true when it would change or did.
 */
export async function writeItem(file, apply) {
  const before = fs.readFileSync(file, 'utf8');
  const item = JSON.parse(before);
  apply(item);
  const config = (await prettier.resolveConfig(file)) ?? {};
  const after = await prettier.format(JSON.stringify(item, null, 2), { ...config, filepath: file });
  const changed = after !== before;
  if (process.argv.includes('--dry'))
    console.log(
      changed
        ? `${file}: differs from the generator (hand-edited?)`
        : `${file}: matches the generator`,
    );
  else if (changed) fs.writeFileSync(file, after);
  return changed;
}
