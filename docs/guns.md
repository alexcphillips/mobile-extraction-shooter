# Making guns

Guns are what players look at most: in first person every second of a raid, and in the stash while building one out. So each gun is built to a higher bar than other items, from a real-world reference, with every slot's mount placed and checked with the parts that fit it *(user's call)*. Iron sights get the same care as optics. `m416` is the reference build and [gun-m416.mjs](../scripts/gun-m416.mjs) the script that made it: when in doubt, do what they do.

## Where to look

Read only the part you need; search these by name rather than reading them whole.
- **Part shapes and their fields:** `partSchema` in [models.ts](../packages/shared/src/content/models.ts); a gun model's points, mounts and folds are `weaponModelSchema` there.
- **Gun fields** (`slots`, `defaults`, `stock`): the weapon schema in [items.ts](../packages/shared/src/content/items.ts).
- **How a gun is drawn with its parts** (mounts, parts hidden by a slot, a barrel moving the muzzle, the factory stock folding, the butt the aimed hold uses): `gunModel` in [gun-model.ts](../packages/client/src/render/gun-model.ts).
- **How it's held in first person:** `HIP` and `BUTT_BEHIND_EYE` in [viewmodel.ts](../packages/client/src/render/viewmodel.ts); the world and gun fields of view (`FOV`, `AIM_FOV`, `GUN_FOV`) in [optic.ts](../packages/client/src/hud/optic.ts).
- **Triangle budget:** `budgetOf` in [budget.ts](../packages/client/src/item-editor/budget.ts). It counts the gun with what's fitted.
- **Generator helpers:** [gun-kit.mjs](../scripts/gun-kit.mjs) (`gunParts`: boxes, tubes, side-profile prisms, cross-section extrusions; `octagon`, `teeth`, `writeModel`) and, for round and rounded parts, [optic-kit.mjs](../scripts/optic-kit.mjs) (`coreOutline`, `roundOutline`, `ringFaces`, `edgeFaces`). Read their headers and signatures, not more.
- **The worked example:** [gun-m416.mjs](../scripts/gun-m416.mjs). Search it by section (`Rails`, `Handguard`, `Iron sights`, `Rear:`, `Front:`, `Points and mounts`) rather than reading it whole.
- **Pictures:** the header comments of [gun-shot.mjs](../scripts/gun-shot.mjs) (close-ups, hip and aimed, parts fitted, the budget line) and [item-shot.mjs](../scripts/item-shot.mjs) (the inventory pictures). Both need the dev server.

## The process

1. **Start from a reference**: photos of the real gun from the side and from behind (the aimed view), and of its real sights. Note what makes it read as itself: the receiver's outline, the handguard, the stock, the sights. The user may send pictures, some from other games: use them for the real object's shape, never copy another game's model *(user's call)*. The gun keeps its game name; give new parts our own names, never a product's.
2. **Build it from a generator script**: copy [gun-m416.mjs](../scripts/gun-m416.mjs) to the scratchpad, point its imports at the kits by absolute path, and rework it. Keep every size that other parts hang off as one named constant (the bore height, the rail top, the handguard's half width, the magazine well's mouth, the sight line), and place attached parts and mounts from them, so moving one keeps the rest attached.
3. **Once the user edits the JSON, the JSON is the model.** Run a generator with `--dry` first; if it says the file differs, make changes in the JSON or the item editor instead.
4. **Check it**, every round, and look at every picture before handing it over:
   - `node scripts/gun-shot.mjs <id> <out> --view side --zoom 4` and `--view 3D --zoom 3 --orbit 160,0` (from the right side): the build, close.
   - `--hip` and `--aimed`: the gun as the game holds it. These matter most; the user judges the gun here.
   - Every part that fits each slot, with `--fit`, from the side and aimed through each optic. A part sitting in air, sunk into the gun or covering a mount is a mount to move.
   - The budget fully built: the heaviest optic, a suppressor, a foregrip and a laser together (the line `gun-shot` prints).
   - `node scripts/item-shot.mjs <id>` for the inventory pictures, and `npx vitest run`: the content tests validate the model and check the irons line up.
   - Say what wasn't checked (in-game lighting, a raid on the phone).
5. **If a rifle-hold gun's `grip` or `support` moves and it's one the arm pose is fit to** (`posesFor` in `render/skeleton-pose.test.ts`), refit the sim's arm hit zones: run that test with `FIT_ZONES=1` and paste the printed rifle lines into `ARM_CAPSULES` in `sim/hit-zones.ts`.

## Frame

The item-model frame from [props.md](props.md) → Item models: meters, the muzzle toward **−z**, y up, a part's `pos` is its center. The bore runs along z at one height; the sight line (`sight`) is above it at the irons' height.

## Anatomy: mounts and factory parts

Every slot in `slots` has a mount, the point where the fitted part's origin goes. A gun's own parts that a slot replaces are its **factory parts**, `hiddenBy` that slot; they aren't items and have no points ([features/weapon-stats.md](features/weapon-stats.md)). What stays (receivers, handguard, buffer tube) is never hidden.

| Slot | Mount | Factory parts hidden by it |
|---|---|---|
| `optic`, `offsetOptic` | On the top rail's teeth, centered | The rear sight only: the front sight is part of the gun and stays *(user's call)*, showing low in an optic's window |
| `muzzle` | On the bore at the barrel's end | The flash hider: it rides on the end of whichever barrel is fitted |
| `barrel` | On the bore at the handguard's front | The exposed barrel |
| `foregrip` | On the bottom rail's teeth | None: a hand holds the handguard (`support`) |
| `leftRail`, `rightRail` | Outboard of the side rail section by half a rail item's width (rail items are centered on their own axis) | None |
| `grip` | Where the grip's top front meets the lower receiver | The pistol grip |
| `magazine` | The magazine well's mouth | None: a gun always comes with its magazine item |
| `stock` | On the buffer tube's axis, where a stock's front sits | The stock (the gun's `stock` section; `model.factoryFold` if it folds) |

Rules that keep fits right:
- **Rails only where a slot mounts.** A full top rail (it's in view all the time), short side and bottom sections where the rail items and foregrip go. Other faces get slots or texture, not rail.
- **Hulls for profiles.** Receivers, magazine wells, grips, stocks and handguards are `prism`s and `extrudeZ`s from their real outlines, not stacked boxes; a hull of millimeter-sized parts is fine.

## Iron sights

Aimed down irons the rear sight fills the middle of the screen, so it's the most looked-at part of a gun without an optic *(user's call: something great, not boxes, a circle and lines)*.

**What the eye sees.** Aimed, the gun is held by its butt, so on a carbine the rear sight is about a hand's width from the eye and the front sight several times further out. Every millimeter of the rear sight looks big and every millimeter of the front looks small. So the rear sight is built slim and the front sight's parts thick enough to read at their distance: a front part as thin as a rear one shows as a line. Judge both in `--aimed`, not in the editor views.

**Shape, from the real sight:**
- **Silhouettes from the reference, as whole pieces.** A rear sight is one housing with its protective ears or hood part of it, not a ring on a stalk between separate posts. Avoid full-height poles, bare wedges and loose sticks: they read as crude *(user's call)*.
- **Rounded and bevelled outlines.** An `optic-kit` `coreOutline` grown by a small radius, extruded with `extrudeZ`: shoulders, ears and blades get soft corners, and inner edges of a hood a chamfer.
- **A peep is a real round hole**, built from panels: `ringFaces` for the faces and `edgeFaces` for the outer skin and a dark bore, at 20 to 24 segments. A thin lighter lip round the hole catches the light.
- **A ghost ring, not a donut** *(user's call)*: the hole large and the ring round it thin, so the front sight sits in the hole with clear air round it. A thick ring with a small hole buries the front sight.
- **Hardware the real one has, small:** a hinge pin, a cross-bolt, an index mark on the face toward the eye, a recessed panel. Not a big knob where the reference has none worth showing.
- **The `m416`'s are the reference** (`Rear:` and `Front:` in the script): a diopter rear, one wide housing whose top corners rise into a U-shaped hood with the aperture low between them, set back from the hood's face; and a hooded front post, a flat flip-up blade with a hinge knuckle and a hole, topped by a ring open at the top with the post rising to its center, so aimed the front hood sits centered in the rear ring. A gun with another kind of sight (an AK's notch and post, a tangent sight) gets its own reference and the same care.

**Colors.** A sight body a step from the receiver, protective parts and the rim one step lighter, lips and index marks lighter again, the bore near black: two shades plus highlights, as for the rest of the gun.

**Height and optics.** Iron sights sit at about the real gun's height over the rail, under the lowest optic's sight point, so the front sight never covers a dot. Optics are zeroed on their own: the front sight may sit anywhere low in an optic's window. The front sight stays fitted under an optic, so its triangles count in the fully built budget; the rear sight is hidden and doesn't.

**Names the content test reads.** A peep is named `rear sight ring` and centered on `sight` (its face panels' pos is the center, or a `ring` of boxes); the front post, named `front sight post`, has its top on the sight line (a box, or an upright 4-sided cylinder).

## Detail on a budget

- **Spend triangles where they're seen.** Picatinny teeth at the real 10 mm pitch on the top rail read in every aimed second and are worth their cost, and so are the irons; the underside, the stock's inside and the faces of parts nobody sees aren't.
- **When fully built runs over, trim sides off what barely shows** (a flash hider's or barrel's cylinder, caps, knuckles, a sling cup, a hole's back face) before touching what's in view.
- **Two shades plus black.** Receivers dark, the furniture (handguard, grip, stock) one step lighter, black for slots, ports, rubber and rail bases between teeth, so the teeth read. No tan or other colored furniture *(user's call)*: guns tell apart by shape. Small pins and screws a step lighter again catch the light.
- **Slots and ports are dark boxes a fraction of a millimeter proud**, never cut; a real hole is built from panels, as a peep's is.
- **No two parts share a face plane where both show** ([props.md](props.md) → Item models): step stacked parts by at least half a millimeter. Parts of one piece in one color may share a plane (a sight's hood and its housing).

## Proportions

Build to real dimensions. A gun that's chunkier than real looks toy-like in first person, where it fills the bottom of the screen.
- **The stock sets the aimed hold.** Aimed down irons, the back of the model (its factory stock) sits a fixed distance behind the eye (`BUTT_BEHIND_EYE`), so the stock's real length is what puts the rear sight at the right distance. A wrong stock length shows up as irons too close or too far.
- **The rail's height over the bore sets where every optic sits**, and the sight line should match the real gun's, so aimed views of optics and irons line up the way players expect.
- **The gun has its own narrow field of view from the hip** (`GUN_FOV`), like a long lens, so it looks big and flat rather than slanting hard to the middle of the screen. Judge size at the hip in `--hip`, not in the editor views.
