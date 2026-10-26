# Character assets

`mannequin.glb`: the mannequin and animations from **Universal Animation Library (Standard)** by [Quaternius](https://quaternius.com), **CC0 1.0**. Downloaded 2026-10-26 from [OpenGameArt](https://opengameart.org/content/universal-animation-library) (`universal_animation_librarystandard.zip`, files dated March 2025), whose `License.txt` reads "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication".

Quaternius's site has since moved new downloads to its own licence (QAL v1.0, August 2026), which allows use in games but not redistributing the files themselves. This copy predates that and stays CC0. If you add Quaternius assets downloaded later, check which licence they came under before committing them to a public repo.

The file here is built from the zip's `Godot/AnimationLibrary_Godot_Standard.glb` by `node scripts/build-character.mjs <that file>`. The script keeps only the clips the game plays, drops UVs, simplifies the mesh to about 5.8k triangles and keeps only rotation tracks (plus the hips' translation). The client recolours it by body part and draws it unlit (`packages/client/src/render/character.ts`).
