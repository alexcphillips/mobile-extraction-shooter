# Making optics

Optics are the most looked-at thing in the game: every aimed second is spent through one. So each sight is built to a higher bar than other items, from a real-world reference, and checked aimed, not just in the item picture *(user's call)*. `asp-reflex-sight` is the reference build: when in doubt, open it in the item editor and do what it does.

## Where to look

Read only the part you need; search these by name rather than reading them whole.
- **Part shapes and their fields:** `partSchema` in [models.ts](../packages/shared/src/content/models.ts).
- **Optic fields** (`zoom`, `lens`, `fill`, `reticle`, `glow`): the `optic` object in [items.ts](../packages/shared/src/content/items.ts).
- **Triangle budget:** `budgetOf` in [budget.ts](../packages/client/src/item-editor/budget.ts).
- **Hull and loft geometry** (the flatness check, how loft rings are placed): `convexHull` and `loftRing` in [hull.ts](../packages/shared/src/content/hull.ts).
- **Generator helpers:** [optic-kit.mjs](../scripts/optic-kit.mjs): `coreOutline` and `roundOutline` (window shapes), `ringFaces` and `edgeFaces` (a frame's faces), `writeItem` (writes the model prettier-formatted; `--dry` checks for hand edits). Read its header and signatures, not more.
- **Pictures:** the header comment of [item-shot.mjs](../scripts/item-shot.mjs). Needs the dev server.
- **The reference build:** query `asp-reflex-sight` with a `node -e` over its JSON, grouping parts by `group`/`name`/`type`; don't read it whole.

## The process

1. **Start from a reference.** A photo or a game screenshot of the real sight, from the front (aimed) and the side. Note what makes it read as itself: the window's shape, how it joins the base, the controls, the reticle. Give it our own name, never a product's or another game's *(user's call)*. A gun's own optic may carry the gun's name, as `aug-optic` does *(user's call)*.
2. **Build it from a generator script** in the scratchpad that imports [optic-kit.mjs](../scripts/optic-kit.mjs) by path (window outlines, frame faces, writing the item), so positions are computed and a change is a re-run. Keep every size that other parts hang off as one named constant (the housing's half width, the window's radius, the seat's top), and place attached parts from it, so resizing one keeps the rest attached.
3. **Once the user edits the JSON, the JSON is the model.** Never re-run an old script over a hand edit (the user tunes the sight point and other values by eye). Make later changes in the JSON or the item editor.
4. **Check it three ways**, every round: `node scripts/item-shot.mjs <id> --view 3D --view front --aimed --on <gun>` saves the item pictures, the 3D and front views and the aimed view; the item editor's reticle panel shows the reticle at its real units; and the content tests (`npx vitest run`) validate the model. Look at every picture before handing it over, and say what wasn't checked.

## Frame

The item-model frame from [props.md](props.md) → Item models: meters, the front at −z, y up, a part's `pos` is its **center** (not its base, unlike map shapes). The origin is the gun's optic mount: the bottom middle of the sight's base. **Nothing goes below y = 0**: it would sink into the gun's receiver.

The **sight point** (`model.sight`) is where the eye lines up: the middle of the window as seen. Where a base cuts off the window's bottom, that's lower than the window's own center by eye; the user sets the final height by eye in the aimed view.

## Part shapes: how they behave

### Panels: which way they face
A panel faces up its own +y and is drawn from that side only; its `points` are `[x, z]` in its own frame. Rotation is yaw, pitch, roll (order YXZ).
- **Facing the front (−z):** `pitch: -90`. Its local z becomes world +y, so points are `[x, y]` from `pos`.
- **Facing the eye (+z):** `pitch: 90`. Its local z becomes world −y, so points are `[x, −y]`.
- **A face along an edge** (a frame's inner or outer side): `roll` alone, `size: [edge length, depth]`. With roll θ the panel's normal is (−sin θ, cos θ, 0), so for a wanted normal (nx, ny), θ = atan2(ny, nx) − 90°.
- `points` must go round a convex shape in order. A frame is built as one quad per segment, never one ring polygon.

### Window outlines: a core grown by a radius
Draw a non-round window as a convex core polygon grown outward by a radius (each corner becomes an arc): `coreOutline` in the kit, or `roundOutline` for a hoop. Sample every outline at the **same normal angles**: the outer edge, the inner edge, the glass edge and any lip are then concentric, the frame is the same thickness all the way round, and each quad between two outlines is convex. Changing the core's corner points reshapes the window without touching the rest.

### Small solids: lofts, not hulls
The hull's flatness check uses fixed thresholds, so a hull smaller than a couple of centimeters fails as "points are all on a plane". Use a loft: with `sides: 4` each ring is a `w × d` rectangle (moved by `dx, dz`), so two rings make a box that tapers or leans (a jaw, an emitter hump).

### Generated parts and hand edits
Before re-running a generator over an item, run it with `--dry` (`writeItem` then writes nothing and says whether the file would change). If it differs, the user has edited it; work in the JSON from then on.

## Anatomy: what a sight needs

A sight reads as a real object when it has the parts the real one has. Work through these, from the reference:
- **Base:** a rail base with its cross-bolts underneath, or the sight's own clamp (a side bracket, a throw lever with a knob, a tension nut).
- **Housing:** never a plain box. A hull with flat sides and bevelled top edges and ends; flutes or seams along the sides.
- **Window or tube:** the part the eye looks through, and how it joins the housing (a hoop sunk into a raised seat, a hood, a tube on rings). It's what the player sees most, so it gets the most care.
- **Illumination:** the emitter housing, its dark lens facing the window.
- **Controls:** a brightness dial with knurling, a raised cap, an index line and setting marks; turrets on scopes.
- **Hardware:** a battery cap with a coin slot, screws, a serial plate with text lines.

## Detail on a budget

The optic budget is the number in `budgetOf` ([budget.ts](../packages/client/src/item-editor/budget.ts)), set high because optics are looked at most *(user's call)*; a long gun's budget counts its fitted optic, so stay well inside it. Spend triangles where the eye goes (the window first), and save them everywhere else:
- **Round frames are panels, not boxes.** A panel face is 2 triangles where a box is 12: a hoop's front, back, inner and outer faces as panels at 24 segments is smooth and cheap.
- **Don't draw what's hidden.** Faces wholly inside another part (a hoop's foot inside its seat) are skipped.
- **Small flared shapes are lofts.** A hull only a few millimeters across fails the content check as flat; a loft (stacked rings) works and rounds it too.
- **Edges catch light.** A lighter, slightly proud lip on a frame's front edge, and two shades of the body color (as for all item models), are what make it read at a glance.
- **Details sit 1 mm proud** of the surface they're on, so they don't flicker into it.

## Proportions

- **Parts that meet should look joined.** A seat or mount is only as wide as what it holds needs; the user turned down a seat much wider than its housing. Derive such widths from the parts they hold.
- **When a part is resized, move what's attached to it** (knobs on a post, caps on a side), and check the front view: floating parts show there first.
- **Check proportions against the reference** in the front and side views, not just the 3D one.

## Aimed: how big the window looks

`optic.lens` is the window's clear radius and `optic.fill` how much of the screen it fills aimed (both in [items.ts](../packages/shared/src/content/items.ts)). A sight without `fill` sits where iron sights do; with it, it's held that close to the eye, as `asp-reflex-sight` holds its hoop up like a classic hoop sight. **Tube sights tunnel:** with `fill` set the eye is only a few centimeters behind the rear face, so a tube's far end looks much smaller than its near end and its dark inside eats the view. Keep an unmagnified tube short with a thin wall, so the clear view stays wide round the dot (`red-dot`). A hood in front of a window is the same: keep it shallow and wider inside than the window, so aimed it hides behind the window's frame (`holographic-sight`). Scopes always use them: see [props.md](props.md) → Item models for how scopes are built to be looked through (`scopedHidden`, the eyepiece rim), and no two scopes share a rim. Details that sit on a `scopedHidden` part (seams, panels, bands, ring screws) are `scopedHidden` too: left drawn, they float in view at the edges of the lens while looking through.

## Reticles

Units are % of the screen height from the aim point, y down (the item editor's reticle panel says how big one unit is on a phone). For a sight without zoom the reticle is drawn at those units; a scope's is fitted to its lens.
- **Lit reticles glow** (`reticle.glow`, `true` or a strength below 1 for a softer halo, set by eye): the halo is drawn only under the shapes in the reticle's own color, so etched shapes with their own color (black stadia under a red chevron) stay sharp.
- **Build it from the reference's shapes**, line by line. A T made of three lines that stop short of a gap at the aim point reads very differently from a solid T.
- **Expect to tune line width, length and gaps** with the user over a few rounds: they're the most visible numbers in the game. Keep them as named values in the script while building, so each round is one change.

## More than one sight on a gun

A gun can have more than one sight, and the player switches between them while aimed. The sight button appears only then and says which sight a tap goes to; on PC it's V, on a gamepad D-pad up.
- **The list is the one source:** `sightsOf` in [items.ts](../packages/shared/src/content/items.ts) gives a gun's sights in the order the button steps through them, and the gun stores which one it's on (`sight`, an index). The gun view, the HUD reticle, the HUD button and the item editor all read the list, so a new kind of sight is added there and nowhere else.
- **A second sight on the same optic** (a red dot riding on a scope) is its `optic.alt`: zoom, reticle, lens and fill like the optic's own, plus its own sight point in the model. `tandem-combo-sight` is the reference. Keep its `fill` small: a big one pulls it so close that the scope behind it passes the eye and the sight fills the view (a test in gun-model.test.ts checks the eyepiece stays ahead).
- **Offset (canted) optics** are their own slot: a small sight on an arm round the rail, whose `optic.cant` is how far the gun rolls (its top to the left) to bring it up level. It joins the list after the main optic's sights; the gun rolls about the sight point as it comes up, so the sight stays on the line ahead of the eye. `offset-reflex-sight` is the reference.
- **Changing the optic resets the choice** to the first sight, so a gun never stays on a sight it no longer has.
- **On a two-sight optic, the second sight's top may show above the scope's rim while looking through it.** That can be its rim mark. Parts in the line of sight are still `scopedHidden`.
- **Check every sight aimed:** `item-shot.mjs --aimed --alt` looks through the second one, and the editor's aimed view has a sight button that steps through them.
