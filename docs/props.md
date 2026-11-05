# Building props and prefabs

How the forklift, pallets, office chair, clipboard and hanging jacket were made (2026-11-03), so new props match them. The user liked this style; keep to it.

## Style
- **Silhouette first, then two or three telling details.** Get the outline right in a few big parts, then add only the details that say what it is: a pallet's fork gaps, a chair's five casters, a clipboard's clip lever. Drop any detail that costs parts without changing how it reads.
- **Low-poly, always.** A small prop is about 10–25 parts (a part is ~12 triangles); a vehicle-sized one up to ~30. No curves beyond 6–12-sided cylinders. Bulge and taper change outlines; they never add smoothness.
- **Real sizes** for furniture, vehicles and anything that fits with the player or other props (a pallet 1.2 × 1.0 × 0.144 m, a seat top at 0.5 m). Buildings are about 1.25× real (see design.md → Art direction).
- **Size big props from what they handle:** the gantry crane is measured from the shipping container (8 × 2.8 × 3 m), and it hangs the real container prefab, so the scale can't drift. A prop this big can pass the part budget: the crane is 57.
- **Container truck fit:** `container-truck` (2026-11-04) has its origin on the floor under the middle of its deck, not of the whole truck, and faces +z. The deck is 8 × 3 m, a shipping container's footprint, with its top at y = 1.3 and no container built in, so each placed truck can carry a different one or none. Containers go on in the map, not in the prefab, as editing the prefab changes every truck; group the two so they move together. Every shipping container prefab shares one frame (fixed 2026-11-04): centred, floor at y = 0, long along z, closed end at +z. So any of them goes at [0, 1.3, 0] in the truck's frame, yaw 0 for the closed end towards the cab.The cab is its own prefab, `semi-tractor` (origin under the fifth wheel), so a regular truck can share it.
- **Shipping container detail** (2026-11-04): corrugation is 9 ribs a side, sitting inside the 8 × 2.8 × 3 m outline so deck and stacking fit stays exact, over a dark wall in a `-shade` slot. A recolour must pass that slot too (the crane does). The roof has 6 thin shade strips, under the rails' top so a stacked container hides them. Rails, posts and castings are drawn only; floor, roof and walls collide. About 50 parts each. The four are `closed-end` (open at −z), `open-no-doors` (open at both ends), `closed-doors` (working doors at −z) and `sealed` (no way in).
- **Desk fit:** the desk (1.6 × 0.76 × 0.75 m, sitter on +z) has 0.73 m clear under it and 1.51 m between its end panels. It takes the chair (arms 0.71 m high, 0.61 m wide) and the gaming PC (0.61 m high, 0.33 × 0.63 m) side by side, so a future tower must stay within those. The gaming PC has a built-in yaw of 30, so its map yaw is the wanted direction minus 30.
- **Table and chairs** (2026-11-04): `table-and-chairs` is a 1.4 × 0.8 m table, top at 0.75 m, with chairs on its long sides, one pulled out askew. The chairs are nested `wooden-chair` prefabs (seat top 0.5 m, 0.86 m high), so a chair can also be placed alone. The set is about 45 parts, over a small prop's budget.
- **Small lootable containers run about 1.3× real or a bit more.** True to life, a hand-carried case looks undersized in the game and is a small target to aim at. Use the settled sizes as the yardstick, width × height × depth: suitcase 0.6 × 0.8 × 0.4 m (standing), briefcase 0.6 × 0.15 × 0.4 m (flat). Size a new one against these, not against its real measurements.
- **Flat colours, two shades per material.** Use a darker shade for the parts that separate others (pallet blocks, sleeves, folds, a gap down an open jacket) so shapes read without lighting. Alternate shades on repeated parts (stacked boxes) so they read as separate.
- **Colour slots named by material** (`wood`, `wood-dark`, `fabric`, `plastic`, `metal`, `paper`, `ink`), 2–5 per prop, so a variant is only a colour override.
- **Thin details are thin boxes** (1–6 mm), set at least 1 mm above the surface they sit on so they don't flicker into it.
- **Paper needs print on what's seen,** or it reads as blank stock, not documents (the user, on the first paper stacks). Vary it so pieces differ: a letter (heading, text lines, signature), a form (dark header bar, ruled rows), a folder (label, red stamp).
- **Hanging, soft things obey gravity:** narrow, pinched at the hook, folds as strips at slightly different depths, angles and shades, uneven hems (the jacket after the user's reference shot).

## Collision
- Only the main masses collide: a chair's seat and back, a forklift's body and mast, a pallet's boards.
- Small details (`collide: false`): wheels, casters, columns, arm rests, handles, clips, text lines, wrap film.
- Pure decoration (a clipboard) collides with nothing. **Don't make anything a loot container or an item unless asked.**
- Bulge, taper, lean and stair `sides` are drawn only: the part collides as its plain box or ramp.

## Containers and searched looks
Only when the user asks for a container (see Collision). A container is a node with `loot`, usually a group, and it needs at least one part that collides, to aim at. The kind lives in `content/loot-containers`; if it's new and the user hasn't given a table, use a placeholder and say so.
- **A searched look is a second prefab**, named by `loot: { container, searched: "<prefab id>" }`, and drawn in place of that container's own parts once it's searched, for the rest of the raid. It's the open state: a drawer pulled out, a bag unzipped (`duffle-bag-open`, `filing-cabinet-bottom-drawer-open`).
- **Same frame as the container, parts only.** Author it at the same origin and yaw, with no `loot`, and never place it on a map. An open-looking copy that's placed would pass for a different kind of container, so there are no decoration-only versions.
- **One look per container, not per combination.** Split furniture into one container per searchable part (a cabinet's two drawers are two groups), each with its own look. States then add up on their own; never make a prefab for each combination.
- **Check that looks fit together:** pieces of one prefab mustn't overlap when all are open (compare their height ranges).
- **Show what changed.** Make the open state read at a glance: a different outline (wider, slumped, pulled out), a dark inside and visible contents. Contents can be stuffed in up to about 35 parts, since only searched containers show them.
- **Drawn only:** give every part `collide: false`. The look doesn't block walking or shots. You aim at it by the bounds of its shapes, so the lootable area grows with it by itself.
- **Reuse the container's colour slot names:** slots it shares follow a recoloured container. Contents get their own.
- An `instanced` prefab holding a container with a searched look quietly stops being instanced, since those copies are one mesh: it works, but its copies are drawn one by one.

## Frame and shape rules (they're easy to get backwards)
- A prefab's origin is the **floor under its middle** (or the surface it sits on, or the point it hangs from), and it **faces +z**. JSON has no comments, so say which origin you used when you hand it over.
- A map shape's `pos` is the **middle of its base**, not its centre. Pitch and roll turn it about its centre. A cylinder on its side (`roll: 90`) needs `pos.y = radius − height / 2` to sit on the floor.
- `yaw` turns local +z to world (sin yaw, cos yaw): **yaw 90 points +z along +x**, −90 along −x. A wall with yaw 90 runs along z, and its openings' `along` is measured along **−z**.
- Positive `pitch` tips a part's top **towards +z**; use negative to lean a backrest back.
- Ramps (wedges) and stairs **rise towards local +z**.
- Box extras: `bulge` `[−x, +x, bottom, top, −z, +z]` pushes each face's middle out (padding, sacks, rounded backs); `top` `[w, d]` sizes the top face (pinch, flare, a tapered leg); `lean` `[x, z]` moves the top over. Stairs: `sides` for solid sloped side walls.
- Groups take `name` (shown in the editor), not `id`.

## Process
1. Write the prefab with a short Python generator in the scratchpad (helpers `box`, `cyl`, `wall`), so positions are computed (radial legs, rows of slats) and a change is a re-run. Comment each part in the script, not the JSON.
2. `npx prettier --write` the JSON; run `npx vitest run` under Node 22 (`nvm use 22`). The content test validates every prefab and map.
3. Place one near the player spawn in northpoint, on clear ground (list the nodes within a few metres first), so the user can find it. Tell them the map may be open in their editor: if it saves over the file, the placement goes, the prefab stays.
4. Check the user's existing prefabs before making one: they may already have a version (empty-pallet) or a convention to keep (a colour slot the map passes down).
5. Say what wasn't seen: these are built from numbers, so ask for a screenshot and fix from it.
