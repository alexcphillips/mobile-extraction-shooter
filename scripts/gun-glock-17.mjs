// The Glock 17's model (GM-7b): the platform's body (gun-glock.mjs) as it comes, plain slide.
//
//   node scripts/gun-glock-17.mjs [--dry]
//
// The JSON is the model once anyone edits it: run with --dry first, and if it says the file
// differs, don't run it (it would undo the edit).
import { gunParts, writeModel } from './gun-kit.mjs';
import { G, glockBody, glockPoints } from './gun-glock.mjs';

const FILE = new URL('../content/items/glock-17.json', import.meta.url).pathname;
const kit = gunParts();
const { p, railBottom } = glockBody(kit);
const muzzleZ = p.muzzle({ z0: G.Z0, len: 0.0025 });
await writeModel(FILE, { parts: kit.parts, ...glockPoints(p, railBottom, muzzleZ) });
console.log(kit.parts.length, 'parts');
