// The Glock 18C's model (GM-7b): the platform's body (gun-glock.mjs) with what marks the
// automatic: the selector at the slide's rear left, the long cut in the slide's top with the
// barrel's compensator slots in it, and a barrel reaching past the slide.
//
//   node scripts/gun-g18c.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { B, PC } from './gun-pistol.mjs';
import { G, glockBody, glockPoints } from './gun-glock.mjs';

const FILE = new URL('../content/items/g18c.json', import.meta.url).pathname;
const kit = gunParts();
const { p, railBottom } = glockBody(kit);
const { W, ST, SB, Z0, Z1 } = G;
// The slide's top cut, the barrel in it and its four slots, lengthening toward the port.
p.onTop('slide', 'compensator cut', ST + 0.0003, [-0.0062, 0.0062], [-0.128, -0.064], PC.SLOT);
p.onTop(
  'barrel',
  'barrel in the cut',
  ST + 0.0006,
  [-0.0048, 0.0048],
  [-0.1265, -0.0655],
  PC.BARREL,
);
for (let i = 0; i < 4; i++)
  for (const s of [1, -1])
    p.onTop(
      'barrel',
      'compensator slot',
      ST + 0.0009,
      [s * 0.0022 - 0.0017, s * 0.0022 + 0.0017],
      [-0.122 + i * 0.0135, -0.1165 + i * 0.0135],
      PC.BORE,
    );
p.serrations(W, { z0: Z0 + 0.012, n: 4, y0: SB + 0.003, y1: ST - 0.005, lean: 0 });
// The selector: a disc on the slide's rear left with its lever, an index line either side.
kit.tubeX('slide', 'selector', [-(W + 0.0012), B + 0.003, Z1 - 0.011], 0.0062, 0.0026, PC.LEVER, {
  sides: 12,
});
kit.box(
  'slide',
  'selector lever',
  [-(W + 0.0031), B + 0.003, Z1 - 0.014],
  [0.0016, 0.0032, 0.0125],
  PC.STEEL,
);
const muzzleZ = p.muzzle({ z0: G.Z0, len: 0.009 });
await writeModel(FILE, { parts: kit.parts, ...glockPoints(p, railBottom, muzzleZ) });
console.log(kit.parts.length, 'parts');
