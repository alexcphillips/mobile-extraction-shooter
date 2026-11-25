// The shotgun barrels' models (GM-7a), in the barrel mount's frame: origin on the bore at the
// mount, the barrel running toward −z, `muzzle` where a muzzle device threads on. Each
// carries the same vent rib and bead as the guns' factory barrels (gun-shotgun.mjs), so bare
// aiming still has its bead with any barrel on. Replaces only `model` in each item file.
// See docs/guns.md.
//
//   node scripts/barrels-shotgun.mjs [--dry] [id ...]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says a file
// differs, leave that one out (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { SG, barrelNut, shotgunBarrel } from './gun-shotgun.mjs';

const DIR = new URL('../content/items/', import.meta.url).pathname;
const PORT = '#0d0e0f';

const BUILD = {
  // A stub barrel ending in a toothed standoff, for pressing against a door.
  'cqb-breacher-barrel': (k) => {
    const L = 0.042;
    barrelNut(k);
    shotgunBarrel(k, { z0: -L, z1: -0.008 });
    k.tubeZ('barrel', 'standoff', 0, -L, -L - 0.012, SG.BR + 0.0028, SG.BAND, { sides: 8 });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const r = SG.BR + 0.001;
      k.box(
        'barrel',
        'standoff tooth',
        [r * Math.sin(a), r * Math.cos(a), -L - 0.0155],
        [0.0055, 0.004, 0.007],
        SG.BAND,
        {
          roll: -(i * 90 + 45),
        },
      );
    }
    return [0, 0, -L - 0.012];
  },
  // A short barrel with ports cut along its top behind the muzzle.
  'competition-short-barrel': (k) => {
    const L = 0.07;
    barrelNut(k);
    shotgunBarrel(k, { z0: -L, z1: -0.008 });
    for (const s of [1, -1])
      for (const z of [-L + 0.012, -L + 0.022, -L + 0.032])
        k.box('barrel', 'port', [s * 0.0062, 0.0082, z], [0.0034, 0.001, 0.006], PORT, {
          roll: s * -38,
        });
    return [0, 0, -L];
  },
  // A long plain barrel.
  'longbore-barrel': (k) => {
    const L = 0.2;
    barrelNut(k);
    shotgunBarrel(k, { z0: -L, z1: -0.008 });
    return [0, 0, -L];
  },
  // The mp-133's long heavy barrel, its own magazine tube under it for the two more shells,
  // a band holding the tube near its front.
  'mp133-extended-heavy-barrel': (k) => {
    const L = 0.24;
    const R = SG.BR + 0.0008;
    barrelNut(k);
    shotgunBarrel(k, { z0: -L, z1: -0.008, r: R });
    k.tubeZ('barrel', 'magazine tube', SG.TUBE_DY, -0.002, -L + 0.03, 0.0121, SG.STEEL, {
      sides: 8,
    });
    k.tubeZ('barrel', 'tube cap', SG.TUBE_DY, -L + 0.03, -L + 0.022, 0.0127, SG.BAND, {
      sides: 8,
    });
    k.extrudeZ(
      'barrel',
      'barrel band',
      [
        [-0.009, R + 0.002],
        [0.009, R + 0.002],
        [0.0135, 0],
        [0.0135, SG.TUBE_DY],
        [0.009, SG.TUBE_DY - 0.0135],
        [-0.009, SG.TUBE_DY - 0.0135],
        [-0.0135, SG.TUBE_DY],
        [-0.0135, 0],
      ],
      -L + 0.046,
      -L + 0.034,
      SG.BAND,
    );
    return [0, 0, -L];
  },
};
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const id of ids.length ? ids : Object.keys(BUILD)) {
  const k = gunParts();
  const muzzle = BUILD[id](k);
  await writeModel(`${DIR}${id}.json`, { parts: k.parts, muzzle });
  console.log(id, k.parts.length, 'parts');
}
