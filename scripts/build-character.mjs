// Builds packages/client/public/characters/mannequin.glb from the Universal Animation
// Library's Godot GLB (see packages/client/public/characters/README.md for where to get it):
// keeps only the clips the game plays, drops the UVs, simplifies the mesh and trims the
// keyframes. Run: node scripts/build-character.mjs <AnimationLibrary_Godot_Standard.glb>
import { NodeIO } from '@gltf-transform/core';
import { prune, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const OUT = 'packages/client/public/characters/mannequin.glb';
/** The clips the client's animator uses (render/animator.ts). */
const CLIPS = new Set([
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Crouch_Idle_Loop',
  'Crouch_Fwd_Loop',
  'Jump_Loop',
  'Death01',
  'Hit_Chest',
  'Pistol_Idle_Loop',
  'Pistol_Aim_Neutral',
  'Pistol_Aim_Up',
  'Pistol_Aim_Down',
  'Pistol_Shoot',
  'Pistol_Reload',
]);
/** The share of triangles kept: enough for the silhouette, flat-shaded like the map. */
const KEEP = 0.4;

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/build-character.mjs <source.glb>');

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

for (const anim of root.listAnimations()) {
  if (CLIPS.has(anim.getName())) continue;
  // Disposing a clip leaves its samplers holding their keyframes, which prune then keeps.
  for (const c of anim.listChannels()) c.dispose();
  for (const s of anim.listSamplers()) s.dispose();
  anim.dispose();
}
// Only the hips move; every other bone just turns, and nothing scales.
for (const anim of root.listAnimations())
  for (const c of anim.listChannels()) {
    const path = c.getTargetPath();
    if (
      path === 'scale' ||
      (path === 'translation' && c.getTargetNode()?.getName() !== 'DEF-hips')
    ) {
      c.getSampler()?.dispose();
      c.dispose();
    }
  }
const missing = [...CLIPS].filter((n) => !root.listAnimations().some((a) => a.getName() === n));
if (missing.length) throw new Error(`missing clips: ${missing.join(', ')}`);

// Flat colours: no textures, so no UVs.
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives())
    for (const sem of ['TEXCOORD_0', 'TEXCOORD_1']) prim.setAttribute(sem, null);

await MeshoptSimplifier.ready;
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: KEEP, error: 0.002, lockBorder: true }),
  resample({ tolerance: 1e-4 }),
  prune(),
);

let tris = 0;
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
await io.write(OUT, doc);
console.log(`${OUT}: ${tris} triangles, ${root.listAnimations().length} clips`);
