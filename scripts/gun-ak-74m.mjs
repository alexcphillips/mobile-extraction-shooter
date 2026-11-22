// The AK-74M's model (GM-3), on the `ak` family's shared body in gun-ak.mjs (receiver, railed
// dust cover, notch and post irons, gas system, handguards, grip): the AKM's layout with the
// 74's ribbed handguard. Its own parts here: the two-chamber brake, the solid polymer stock,
// the points and mounts. Replaces only `model` in its item file. See docs/guns.md.
//
//   node scripts/gun-ak-74m.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import fs from 'node:fs';
import { gunParts, v3, writeModel } from './gun-kit.mjs';
import { AK, akRifle, keptFolds, mountsFor } from './gun-ak.mjs';
import { roundOutline } from './optic-kit.mjs';

const FILE = new URL('../content/items/ak-74m.json', import.meta.url).pathname;
const ITEM = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { SLOT, POLY, POLY_HI, STEEL, PIN, RUBBER, BORE, BAND } = AK;

// ---- Key sizes everything hangs off (the rest of the layout is the family's, in akRifle)
const B = 0.012; // bore height
const RW = 0.0145; // receiver half width
const RTOP = B + 0.01; // receiver walls' top, under the cover
const RBOT = B - 0.034; // receiver bottom: the magazine's mouth
const RZ0 = -0.105; // receiver front
const RZ1 = 0.13; // receiver rear: the stock's front
const GZ = [-0.352, -0.322]; // gas block [front, rear]: the front sight on it
const HZ0 = -0.28; // lower handguard front
const HW = 0.0225; // lower handguard half width
const HBOT = B - 0.027;
const MUZZLE_Z = -0.482; // where a muzzle device threads on

const kit = gunParts();
const { parts, add, box, tubeZ, tubeX, prism } = kit;
const body = akRifle(kit, { B, RW, RTOP, RBOT, RZ0, RZ1, GZ, HZ0, HW, HBOT, MUZZLE_Z, ribs: 3 });

// ================= The two-chamber brake (factory, hidden by a muzzle device): a collar, the
// body with its top vents, and a wider front chamber with a big window each side.
const M = { hiddenBy: 'muzzle' };
const BRAKE_END = MUZZLE_Z - 0.066;
tubeZ('muzzle', 'brake collar', B, MUZZLE_Z + 0.003, MUZZLE_Z - 0.008, 0.0092, SLOT, {
  sides: 10,
  ...M,
});
tubeZ('muzzle', 'brake', B, MUZZLE_Z - 0.008, MUZZLE_Z - 0.049, 0.0104, STEEL, { sides: 10, ...M });
tubeZ('muzzle', 'brake chamber', B, MUZZLE_Z - 0.049, BRAKE_END, 0.0112, STEEL, {
  sides: 10,
  ...M,
});
for (const s of [1, -1])
  box(
    'muzzle',
    'brake window',
    [s * 0.0113, B, MUZZLE_Z - 0.0575],
    [0.0006, 0.0095, 0.0115],
    BORE,
    M,
  );
for (const z of [MUZZLE_Z - 0.019, MUZZLE_Z - 0.029, MUZZLE_Z - 0.039])
  box('muzzle', 'brake vent', [0, B + 0.0103, z], [0.004, 0.0006, 0.0036], BORE, M);
add({
  type: 'panel',
  pos: v3([0, B, BRAKE_END - 0.0003]),
  pitch: 90,
  points: roundOutline(8)(0.0052).map(v3),
  color: BORE,
  name: 'muzzle bore',
  group: 'muzzle',
  ...M,
});
tubeX('muzzle', 'brake detent', [0, B - 0.0092, MUZZLE_Z - 0.003], 0.0012, 0.008, PIN, {
  sides: 6,
  ...M,
});

// ================= The solid polymer stock (factory, hidden by a fitted stock): a level
// comb, the toe falling steeply then running straight to a tall butt, a lightening groove
// down each side, the folding hinge block on the left and a ridged rubber pad.
const ST = 'stock';
const hide = { hiddenBy: 'stock' };
const SZ1 = 0.37; // the pad's front
const sw = (z) => 0.0128 + ((z - RZ1) / (SZ1 - RZ1)) * 0.0062;
prism(
  ST,
  'stock',
  [
    [RTOP - 0.002, RZ1 + 0.001, sw(RZ1)],
    [B - 0.002, SZ1, sw(SZ1)],
    [B - 0.126, SZ1, sw(SZ1)],
    [B - 0.112, SZ1 - 0.075, sw(SZ1 - 0.075)],
    [RBOT + 0.002, RZ1 + 0.001, sw(RZ1)],
  ],
  POLY,
  hide,
);
prism(
  ST,
  'stock comb',
  [
    [RTOP - 0.0012, RZ1 + 0.03],
    [B - 0.0012, SZ1 - 0.004],
    [B - 0.0052, SZ1 - 0.004],
    [RTOP - 0.0052, RZ1 + 0.03],
  ].map(([y, z]) => [y, z, sw(z) + 0.0002]),
  POLY_HI,
  hide,
);
prism(
  ST,
  'stock groove',
  [
    [B - 0.026, RZ1 + 0.06],
    [B - 0.03, SZ1 - 0.028],
    [B - 0.037, SZ1 - 0.028],
    [B - 0.033, RZ1 + 0.06],
  ].map(([y, z]) => [y, z, sw(z) + 0.0003]),
  SLOT,
  hide,
);
box(ST, 'hinge block', [-(RW + 0.002), B - 0.012, RZ1 + 0.012], [0.004, 0.03, 0.022], BAND, hide);
tubeX(ST, 'hinge pin', [-(RW + 0.0042), B - 0.012, RZ1 + 0.012], 0.0024, 0.026, PIN, {
  sides: 8,
  roll: 0,
  ...hide,
});
box(ST, 'stock latch', [0, RTOP + 0.002, RZ1 + 0.004], [0.009, 0.004, 0.008], STEEL, hide);
add({
  type: 'slab',
  pos: v3([0, B - 0.064, SZ1 + 0.0055]),
  size: v3([2 * sw(SZ1) + 0.001, 0.127, 0.011]),
  corners: [0.004, 0.004, 0.004, 0.004],
  segments: 2,
  color: RUBBER,
  name: 'butt pad',
  group: ST,
  ...hide,
});
for (let i = 0; i < 4; i++)
  box(
    ST,
    'butt pad ridge',
    [0, B - 0.03 - i * 0.022, SZ1 + 0.0113],
    [2 * sw(SZ1) - 0.006, 0.003, 0.001],
    SLOT,
    hide,
  );
box(ST, 'sling slot', [0, B - 0.016, SZ1 - 0.022], [2 * sw(SZ1) + 0.0004, 0.006, 0.02], SLOT, hide);

// ---- Points and mounts
const model = {
  parts,
  grip: body.grip,
  support: body.support,
  muzzle: [0, B, BRAKE_END],
  sight: body.sight,
  ...keptFolds(ITEM),
  mounts: mountsFor(ITEM.slots, body.mounts),
};
await writeModel(FILE, model);
console.log(parts.length, 'parts');
