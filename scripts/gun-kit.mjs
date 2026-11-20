// Shared helpers for gun-model generators (GM sessions): parts in the item-model frame,
// side-profile prisms, cross-section extrusions, Picatinny teeth, aperture rings, and writing
// only `model` into a gun's item file in the editor's layout. See docs/guns.md.
//
//   import { gunParts, writeModel } from '/abs/path/to/scripts/gun-kit.mjs';
//
// A generator lives in the scratchpad and imports this by absolute path. Run it with --dry
// first: it reports whether the item file differs from what it would write (a difference
// means someone has hand-edited the model, and from then on the JSON is the model).

import fs from 'node:fs';
import * as prettier from 'prettier';
import { layout } from '../packages/client/editor-save.mjs';

export const r5 = (n) => Math.round(n * 1e5) / 1e5;
export const v3 = (a) => a.map(r5);

/**
 * A part list with builders. Every builder takes the part's group and name first (the item
 * editor lists parts by them) and `extra` last: hiddenBy, sides, yaw/pitch/roll, or `x` to
 * move a part sideways where a builder centers it on x = 0.
 */
export function gunParts() {
  const parts = [];
  const add = (p) => {
    for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
    parts.push(p);
    return p;
  };
  const shiftX = (p, x) => {
    if (x) p.pos = v3([p.pos[0] + x, p.pos[1], p.pos[2]]);
    return p;
  };
  const split = (extra) => {
    const { x = 0, ...rest } = extra;
    return [x, rest];
  };
  return {
    parts,
    add,
    /** A box centered at pos. */
    box: (group, name, pos, size, color, extra = {}) =>
      add({ type: 'box', pos: v3(pos), size: v3(size), color, name, group, ...extra }),
    /** A cylinder along z (pitch 90) between z0 and z1, its axis at height y. */
    tubeZ: (group, name, y, z0, z1, radius, color, extra = {}) => {
      const [x, rest] = split(extra);
      return add({
        type: 'cylinder',
        pos: v3([x, y, (z0 + z1) / 2]),
        pitch: 90,
        radius: r5(radius),
        height: r5(Math.abs(z1 - z0)),
        color,
        name,
        group,
        ...rest,
      });
    },
    /** A cylinder along x (roll 90), centered at pos: pins, knobs, sling cups. */
    tubeX: (group, name, pos, radius, length, color, extra = {}) =>
      add({
        type: 'cylinder',
        pos: v3(pos),
        roll: 90,
        radius: r5(radius),
        height: r5(length),
        color,
        name,
        group,
        ...extra,
      }),
    /**
     * A prism from a side profile, mirrored in x: [y, z, halfWidth] points, convex in y-z
     * (a receiver, a magazine well, a grip, a stock). Its pos is the profile's center.
     */
    prism: (group, name, profile, color, extra = {}) => {
      const [x, rest] = split(extra);
      const cy = profile.reduce((s, p) => s + p[0], 0) / profile.length;
      const cz = profile.reduce((s, p) => s + p[1], 0) / profile.length;
      const points = profile.flatMap(([y, z, w]) => [
        v3([w, y - cy, z - cz]),
        v3([-w, y - cy, z - cz]),
      ]);
      return shiftX(
        add({ type: 'hull', pos: v3([0, cy, cz]), points, color, name, group, ...rest }),
        x,
      );
    },
    /** A prism along z from a convex cross-section of [x, y] points (a handguard, an upper). */
    extrudeZ: (group, name, section, z0, z1, color, extra = {}) => {
      const cz = (z0 + z1) / 2;
      const cx = section.reduce((s, p) => s + p[0], 0) / section.length;
      const cy = section.reduce((s, p) => s + p[1], 0) / section.length;
      const points = section.flatMap(([x, y]) => [
        v3([x - cx, y - cy, z0 - cz]),
        v3([x - cx, y - cy, z1 - cz]),
      ]);
      return add({ type: 'hull', pos: v3([cx, cy, cz]), points, color, name, group, ...extra });
    },
  };
}

/** An octagon cross-section: half width w, top and bottom y, corners cut by c. */
export const octagon = (w, top, bot, c) => [
  [-w + c, top],
  [w - c, top],
  [w, top - c],
  [w, bot + c],
  [w - c, bot],
  [-w + c, bot],
  [-w, bot + c],
  [-w, top - c],
];

/**
 * Picatinny teeth from z0 to z1 at the standard 10 mm pitch, centered in the run: calls
 * place(z, i) for each tooth's center.
 */
export function teeth(z0, z1, place) {
  const n = Math.floor((z1 - z0 - 0.0053) / 0.01) + 1;
  const start = (z0 + z1) / 2 - ((n - 1) * 0.01) / 2;
  for (let i = 0; i < n; i++) place(start + i * 0.01, i);
}

/**
 * A ring of n boxes rolled round a circle in the xy plane, centered at `center` (a peep
 * aperture): its boxes' mean position is the center, which the iron-sight test checks.
 */
export function ring(box, group, name, center, rOut, rIn, depth, n, color, extra = {}) {
  const r = (rOut + rIn) / 2;
  const len = 2 * rOut * Math.tan(Math.PI / n);
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n;
    const rad = (a * Math.PI) / 180;
    box(
      group,
      name,
      [center[0] + r * Math.sin(rad), center[1] + r * Math.cos(rad), center[2]],
      [len, rOut - rIn, depth],
      color,
      { roll: r5(-a), ...extra },
    );
  }
}

/**
 * Writes `model` into the item file, leaving the rest of the item alone, in the layout the
 * item editor saves (so a later editor save doesn't reformat it). Points are rounded.
 * With --dry, only reports whether the file would change.
 */
export async function writeModel(file, model) {
  for (const k of ['grip', 'support', 'muzzle', 'sight']) if (model[k]) model[k] = v3(model[k]);
  for (const k of Object.keys(model.mounts ?? {})) model.mounts[k] = v3(model.mounts[k]);
  const before = fs.readFileSync(file, 'utf8');
  const item = JSON.parse(before);
  item.model = model;
  const options = (await prettier.resolveConfig(file)) ?? {};
  const after = await prettier.format(layout(item), { ...options, filepath: file });
  if (process.argv.includes('--dry'))
    console.log(after === before ? `${file}: matches the generator` : `${file}: differs`);
  else if (after !== before) fs.writeFileSync(file, after);
  return after !== before;
}
