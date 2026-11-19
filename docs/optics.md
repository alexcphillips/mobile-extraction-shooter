# Making optics

Optics are the most looked-at thing in the game: every aimed second is spent through one. So each sight is built to a higher bar than other items, from a real-world reference, and checked aimed, not just in the item picture *(user's call)*. `asp-reflex-sight` is the reference build: when in doubt, open it in the item editor and do what it does.

## The process

1. **Start from a reference.** A photo or a game screenshot of the real sight, from the front (aimed) and the side. Note what makes it read as itself: the window's shape, how it joins the base, the controls, the reticle. Give it our own name, never a product's or another game's *(user's call)*.
2. **Build it from a generator script** in the scratchpad (helpers for box, cylinder, slab, hull, loft, panel), so positions are computed and a change is a re-run. Keep every size that other parts hang off as one named constant (the housing's half width, the window's radius, the seat's top), and place attached parts from it, so resizing one keeps the rest attached.
3. **Once the user edits the JSON, the JSON is the model.** Never re-run an old script over a hand edit (the user tunes the sight point and other values by eye). Make later changes in the JSON or the item editor.
4. **Check it three ways**, every round: `node scripts/item-shot.mjs <id> --view 3D --view front --aimed --on <gun>` saves the item pictures, the 3D and front views and the aimed view; the item editor's reticle panel shows the reticle at its real units; and the content tests (`npx vitest run`) validate the model. Look at every picture before handing it over, and say what wasn't checked.

## Frame

The item-model frame from [props.md](props.md) → Item models: meters, the front at −z, y up, a part's `pos` is its **center** (not its base, unlike map shapes). The origin is the gun's optic mount: the bottom middle of the sight's base. **Nothing goes below y = 0**: it would sink into the gun's receiver.

The **sight point** (`model.sight`) is where the eye lines up: the middle of the window as seen. Where a base cuts off the window's bottom, that's lower than the window's own center by eye; the user sets the final height by eye in the aimed view.

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

`optic.lens` is the window's clear radius and `optic.fill` how much of the screen it fills aimed (both in [items.ts](../packages/shared/src/content/items.ts)). A sight without `fill` sits where iron sights do; with it, it's held that close to the eye, as `asp-reflex-sight` holds its hoop up like a classic hoop sight. Scopes always use them: see [props.md](props.md) → Item models for how scopes are built to be looked through (`scopedHidden`, the eyepiece rim), and no two scopes share a rim.

## Reticles

Units are % of the screen height from the aim point, y down (the item editor's reticle panel says how big one unit is on a phone). For a sight without zoom the reticle is drawn at those units; a scope's is fitted to its lens.
- **Lit reticles glow** (`reticle.glow`): the halo is drawn only under the shapes in the reticle's own color, so etched shapes with their own color (black stadia under a red chevron) stay sharp.
- **Build it from the reference's shapes**, line by line. A T made of three lines that stop short of a gap at the aim point reads very differently from a solid T.
- **Expect to tune line width, length and gaps** with the user over a few rounds: they're the most visible numbers in the game. Keep them as named values in the script while building, so each round is one change.
