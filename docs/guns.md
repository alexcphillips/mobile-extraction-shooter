# Making guns

Guns are what players look at most: in first person every second of a raid, and in the stash while building one out. So each gun is built to a higher bar than other items, from a real-world reference, with every slot's mount placed and checked with the parts that fit it *(user's call)*. Iron sights get the same care as optics. `m416` is the reference build and [gun-m416.mjs](../scripts/gun-m416.mjs) the script that made it: when in doubt, do what they do.

## Where to look

Read only the part you need; search these by name rather than reading them whole.
- **Part shapes and their fields:** `partSchema` in [models.ts](../packages/shared/src/content/models.ts); a gun model's points, mounts and folds are `weaponModelSchema` there.
- **Gun fields** (`slots`, `defaults`, `stock`): the weapon schema in [items.ts](../packages/shared/src/content/items.ts).
- **How a gun is drawn with its parts** (mounts, parts hidden by a slot, a barrel moving the muzzle, the factory stock folding, the butt the aimed hold uses): `gunModel` in [gun-model.ts](../packages/client/src/render/gun-model.ts).
- **How it's held in first person:** `HIP` and `BUTT_BEHIND_EYE` in [viewmodel.ts](../packages/client/src/render/viewmodel.ts); the world and gun fields of view (`FOV`, `AIM_FOV`, `GUN_FOV`) in [optic.ts](../packages/client/src/hud/optic.ts).
- **Triangle budget:** `budgetOf` in [budget.ts](../packages/client/src/item-editor/budget.ts). It counts the gun with what's fitted.
- **Generator helpers:** [gun-kit.mjs](../scripts/gun-kit.mjs) (`gunParts`: boxes, tubes, side-profile prisms, cross-section extrusions; `octagon`, `teeth`, `writeModel`) and, for round and rounded parts, [optic-kit.mjs](../scripts/optic-kit.mjs) (`coreOutline`, `roundOutline`, `ringFaces`, `edgeFaces`). For an `ar15` gun, [gun-ar15.mjs](../scripts/gun-ar15.mjs) draws the family's shared parts (upper, lower, pistol grip, buffer tube, rail runs, birdcage, the flip-up irons) from the gun's own sizes; for an `ak` gun, [gun-ak.mjs](../scripts/gun-ak.mjs) draws the whole body (`akRifle`: receiver, railed cover, notch and post, gas system, handguards, grip), and the gun's script adds its muzzle device and stock; [gun-hk.mjs](../scripts/gun-hk.mjs) draws the HK drum rear sight and ring front sight (`mp5`; the `ump45` takes the ring). [gun-bolt.mjs](../scripts/gun-bolt.mjs) draws the bolt-action rifles' shared pieces (round action and rail riser, bolt handle, barrel, brake, trigger guard, butt pad); each gun's script draws its own stock, which is what tells them apart. [gun-wood.mjs](../scripts/gun-wood.mjs) draws the wood-stocked military rifles' wrist, butt and bands (`sks`, `svt-40`). [gun-val.mjs](../scripts/gun-val.mjs) draws the `as-val` platform's shared body (receiver, railed cover, notch, integral suppressor with the front post, trigger guard); each gun's script adds its furniture. [gun-uzi-kit.mjs](../scripts/gun-uzi-kit.mjs) draws the `uzi` platform's barrel and nut, the grip the magazine goes up through, the ghost-ring peep between guards and the post between ears. Read their headers and signatures, not more.
- **The worked examples:** [gun-m416.mjs](../scripts/gun-m416.mjs); [gun-akm.mjs](../scripts/gun-akm.mjs), the `ak` family's reference; and on the `ar15` kit `gun-adar.mjs` (its own A2-style front sight base), `gun-mpx.mjs`, `gun-mcx-spear.mjs`, `gun-k10.mjs` and `gun-mp7.mjs` (bodies unlike an AR's); `gun-mp5.mjs` (a claw-mount rail and a barrel slot on a gun with no handguard rail system); `gun-g3.mjs` (the mp5's build at rifle size, a grip slot on its trigger housing); `gun-scar-h.mjs` (its own upper on the `ar15` kit's lower, grip and irons, and a folding stock on a hinge block); `gun-awm.mjs`, `gun-sv-98.mjs` and `gun-r93.mjs` (bolt actions in thumbhole stocks); `gun-sks.mjs` and `gun-svt-40.mjs` (the ak kit's cover, notch and post on bodies of their own); `gun-as-val.mjs` and `gun-vss.mjs` (one body, two sets of furniture); `gun-uzi.mjs`, `gun-uzi-pro.mjs` and `gun-p90.mjs` (SMGs with the magazine in the grip or on top); `gun-pkm.mjs` and `gun-m250.mjs` (belt-fed guns, the belt's box or pouch as the magazine); `gun-aug-a3.mjs` (a bullpup); `gun-mp-133.mjs` and `gun-aa-12.mjs` (shotguns, their barrels built by `barrels-shotgun.mjs`); `gun-m9a3.mjs` (a pistol, on [gun-pistol.mjs](../scripts/gun-pistol.mjs), the kit every pistol shares; `gun-glock.mjs` is the `glock` platform's body). Search them by section (`Rails`, `Handguard`, `Iron sights`, `Points and mounts`) rather than reading them whole; the irons' build is in gun-ar15.mjs (`flipRear`, `flipFront`).
- **Magazines:** [mags.mjs](../scripts/mags.mjs) builds them in the magazine mount's frame. A magazine counts in its gun's fully built budget, so keep it lean.
- **Pictures:** the header comments of [gun-shot.mjs](../scripts/gun-shot.mjs) (close-ups, hip and aimed, parts fitted, the budget line) [gun-fits.mjs](../scripts/gun-fits.mjs) (every part that fits one slot, fitted in turn, on one labeled sheet with each budget line) and [item-shot.mjs](../scripts/item-shot.mjs) (the inventory pictures). All need the dev server.

## The process

1. **Start from a reference**: photos of the real gun from the side and from behind (the aimed view), and of its real sights. Note what makes it read as itself: the receiver's outline, the handguard, the stock, the sights. The user may send pictures, some from other games: use them for the real object's shape, never copy another game's model *(user's call)*. The gun keeps its game name; give new parts our own names, never a product's.
2. **Build it from a generator script** in `scripts/` (`gun-<id>.mjs`): copy the nearest worked example and rework it; an `ar15` or `ak` gun takes its shared parts from its family's kit rather than copying them. Keep every size that other parts hang off as one named constant (the bore height, the rail top, the handguard's half width, the magazine well's mouth, the sight line), and place attached parts and mounts from them, so moving one keeps the rest attached.
3. **Once the user edits the JSON, the JSON is the model.** Run a generator with `--dry` first; if it says the file differs, make changes in the JSON or the item editor instead.
4. **Check it**, every round, and look at every picture before handing it over:
   - `node scripts/gun-shot.mjs <id> <out> --view side --zoom 4` and `--view 3D --zoom 3 --orbit 160,0` (from the right side): the build, close.
   - `--hip` and `--aimed`: the gun as the game holds it. These matter most; the user judges the gun here.
   - Every part that fits each slot, from the side and aimed through each optic: `gun-fits.mjs` puts a slot's parts on one sheet. A part sitting in air, sunk into the gun or covering a mount is a mount to move.
   - The budget fully built: the heaviest optic, a suppressor, a foregrip and a laser together (the line `gun-shot` prints).
   - `node scripts/item-shot.mjs <id>` for the inventory pictures, and `npx vitest run`: the content tests validate the model and check the irons line up.
   - Say what wasn't checked (in-game lighting, a raid on the phone).
5. **If a rifle-hold gun's `grip` or `support` moves and it's one the arm pose is fit to** (`posesFor` in `render/skeleton-pose.test.ts`), refit the sim's arm hit zones: run that test with `FIT_ZONES=1` and paste the printed rifle lines into `ARM_CAPSULES` in `sim/hit-zones.ts`.

## Frame

The item-model frame from [props.md](props.md) → Item models: meters, the muzzle toward **−z**, y up, a part's `pos` is its center. The bore runs along z at one height; the sight line (`sight`) is above it at the irons' height.

## Anatomy: mounts and factory parts

Every slot in `slots` has a mount, the point where the fitted part's origin goes. A gun's own parts that a slot replaces are its **factory parts**, `hiddenBy` that slot; they aren't items and have no points ([features/weapon-stats.md](features/weapon-stats.md)). What stays (receivers, handguard) is never hidden.

| Slot | Mount | Factory parts hidden by it |
|---|---|---|
| `optic`, `offsetOptic` | On the top rail's teeth, centered | The rear sight only: the front sight is part of the gun and stays *(user's call)*, showing low in an optic's window |
| `muzzle` | On the bore at the barrel's end | The flash hider: it rides on the end of whichever barrel is fitted |
| `barrel` | On the bore at the handguard's front | The exposed barrel |
| `foregrip` | On the bottom rail's teeth | None: a hand holds the handguard (`support`) |
| `leftRail`, `rightRail` | Outboard of the side rail section by half a rail item's width (rail items are centered on their own axis) | None |
| `grip` | Where the grip's top front meets the lower receiver | The pistol grip. Where the magazine goes up the grip (the `mp7`, `model.magwellGrip`), the grip shell is the factory part, the mount is the well's top center, and the standard well inside it (`MAGWELL_WELL`) stays |
| `foregrip` on a gun with a folding grip (the `mp7`) | Under the folding grip's hinge | The folding grip |
| `magazine` | The magazine well's mouth | None: a gun always comes with its magazine item |
| `stock` | On the buffer tube's axis, where a stock's front sits | The stock (the gun's `stock` section; `model.factoryFold` if it folds), and on an `ar15` gun its buffer tube: every AR stock brings its own (`arTube` in [stocks.mjs](../scripts/stocks.mjs)), starting at the receiver's back, the same distance ahead of the mount on every such gun |

The `ak` family *(user's call)*: optics go on a railed dust cover, since the engine draws no side mount. A barrel mounts at the gas block's front, and the factory barrel is the run ahead of it. The front sight is on the gas block, so a barrel of any length leaves it in place.

The `mp5` the same way: a barrel mounts at the front sight base, the factory barrel and its locking lugs are the run ahead of it, and the front sight stays. Its optics go on a claw-mount rail bridging the receiver between the sights.

The `g3` is built the mp5's way at rifle size. It has no barrel slot and no stock slot, and its front ring is grown (`ringFront`'s `scale`) so that aimed it fills the peep as the mp5's does at the longer sight radius.

The `scar-h`'s stock mount is a hinge block that stays at the back of the upper, on the bore's line where a buffer tube would be. An AR stock goes on it in place of the factory stock, and the front of the tube it brings sits hidden inside the block. The factory stock is shaped like the real side-folder but doesn't fold ([features/weapon-stats.md](features/weapon-stats.md)).

The bolt-action rifles (`awm`, `sv-98`, `r93`): the grip is the front of a thumbhole stock, so a stock slot hides only the butt behind it (comb, back, bottom bar, cheek piece, pad), and the mount sits behind the grip on the bore's line. A rifle without irons (below) still sets `sight`, high enough over the rail that the eye looks down it past the cheek piece.

The `sks` and `svt-40` take optics and irons the `ak` family's way *(user's call)*: the `sks` on a railed dust cover, the `svt-40`, whose receiver is open on top, on a rail bridging it on two feet. Both have the family's flat notch at the rail's back and a post between ears at the muzzle, which stays under an optic. They have no grip slot, so the wrist stays and a stock slot hides only the butt behind it.

The `as-val` platform (`as-val`, `vss`) the same way *(user's call, as for the `sks`)*: the real guns' side dovetail isn't drawn, so optics go on a railed cover, with the notch at its back. The suppressor is part of the gun, so there's no muzzle slot, and the front post stands on a clamp near its front. The `vss`'s grip is part of its thumbhole stock and stays when a stock is fitted.

The `uzi` and `uzi-pro` have no grip slot: the grip is part of the gun and the magazine goes up through it, its mount at the receiver's bottom inside the grip. The `uzi` has no optic slot, so its peep never hides; the `uzi-pro`'s peep sits on its rail and hides under an optic like any other.

The `p90` *(user's call)*: its magazine lies along the top, under a bridge that carries a short rail and the built-in sight housing. A bare `p90` aims with the housing's backup irons, a notch and a post on its top edges. An optic replaces the whole housing on that rail, so here the front post hides too, the one exception to the front sight staying. Its factory stock is the rubber butt plate; its stock slot takes only its own pad (`p90-recoil-pad`), sized to its butt.

The `mpx` *(user's call, from their picture)* keeps AR grips and stocks on a body of its own, so it doesn't read as the `ump45`: a toothed handguard with slanted vents, a well leaning forward over a long curved magazine, and a thin two-rod stock on a block that hides with it, the fitted stock bringing its tube. Its well leans, so its magazines are built to that lean.

The `ump45` *(user's call, from their picture)* is one shade all over, with a short rail on the back half of the gun only. Its rear sight is a peep in a hump behind that rail: an optic hides the hump but not its low foot, so optics sit clear ahead of it.

The belt-fed guns (`pkm`, `m250`): the magazine slot holds the belt's box or pouch, its mount under the receiver's front where the belt goes up into the feed. The `pkm` takes optics the `ak` family's way *(user's call)*: a rail on the feed cover, the family's notch on a clamp at the rail's back, and the post between ears on a tower near the muzzle, which stays under an optic. It has no stock slot, since no stock fits it, so its skeletal stock is part of the gun. The `m250` takes AR grips and stocks by name ([features/weapon-stats.md](features/weapon-stats.md)): its lower is the AR lower's outline with no magazine well, so an AR grip mounts where it does on an AR, and its stock mount is a hinge block at the receiver's back like the `scar-h`'s.

The `aug-a3` is a bullpup: the magazine goes in behind the grip, and the grip, trigger guard and folding vertical foregrip are part of the gun, so it has no grip or foregrip slot. The real A3 has no irons; bare it aims with the family's flip-ups on its receiver rail *(user's call)*, on a short sight radius.

The shotguns (`mp-133`, `aa-12`): neither has a stock slot, since no stock fits them, so their stocks are part of the gun. A barrel mounts where the exposed barrel starts (the `mp-133`'s tube band, the `aa-12`'s shroud front), and the factory barrel is the run ahead of it. Every shotgun barrel, factory or fitted, carries the same raised vent rib and bead from [gun-shotgun.mjs](../scripts/gun-shotgun.mjs), so the bead keeps its height whichever barrel is on. The `mp-133` takes optics on a low saddle rail on its receiver and bare aims along the rail and rib to the bead *(user's call)*, as the `saiga-12` does; the rib is raised so the bead clears that rail. Its magazine slot takes a tube extension in the tube cap's place; the cap sits behind the barrel band, so an extension runs on through the band and ends under even the shortest barrel. The `aa-12` aims with the family's flip-ups, the front on a short rail section on a riser at the shroud's front, so it stays with any barrel.

The pistols share the bore's height, the sight line and the hand points, so the arm pose fits them all. The pose reads `sight` too, and the pistol arm hit zones are fit to the `m9a3`, so keep its points. The magazine mount is the well's mouth at the grip's foot, and the magazine goes up inside the grip, so each grip's rake and mouth live in one table (`PISTOL` in gun-pistol.mjs) that the magazines are built from too. The sight line is raised so a fitted suppressor stays under it: check `--aimed` with one after changing either. The rail slot's mount is under a railed dust cover, ahead of the guard; the `m1911a1`, whose real dust cover has none, gets a short one. Side marks (serrations, ports, checkering) are flat panels, which cost 2 triangles where a box costs 12.

**Grips on a magazine-well gun** *(user's call)*: grips stay one item per platform or class, with the same stats on every gun. On a gun whose grip wraps the magazine well, a fitted grip draws its `magwell` look instead, a shell round the well built from its normal look by [grip-magwell.mjs](../scripts/grip-magwell.mjs). Re-run that script after changing a grip's normal look or adding a grip that fits such a gun; the content check refuses a grip that fits one and has no `magwell` look.

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
- **The `m416`'s are the reference** (`Rear:` and `Front:` in the script): a diopter rear, one wide housing whose top corners rise into a U-shaped hood with the aperture low between them, set back from the hood's face; and a hooded front post, a flat flip-up blade with a hinge knuckle and a hole, topped by a ring open at the top with the post rising to its center, so aimed the front hood sits centered in the rear ring. A gun with another kind of sight gets its own reference and the same care; the `akm`'s notch and post are the reference for that kind (below).

**The `ak` family's irons** *(user's call)*: a notch on a clamp at the back of the cover's rail, near the eye like the m416's peep, not the real tangent leaf ahead of the cover. Aimed, the leaf sits too far from the eye to read on a phone. It's flat like the real leaf *(user's call)*: a low ramp rising to a wide, thin plate, flat across the top on the sight line, with no wings. The notch is wide enough that the front sight's ears sit inside it with air round them. The post stands between protective ears on a tower on the gas block, so it stays with any barrel and under an optic. Two guns differ *(user's call)*: the `aks-74u` has a flip-up L at the very back of the rail, its notch wider for close quarters; the `saiga-12` has no rear sight, just a large bead on the gas block, aimed along the cover's rail as a shotgun's rib.

**The HK drum and ring** (`mp5`, `g3`): the rear is two discs lying across the gun either side of a thin ghost-ring peep, the discs guarding it like ears; the front is a post in a full ring. Aimed, the ring sits in the peep with air round it. Both come from gun-hk.mjs.

**The `mp7`'s flip-ups** *(user's call, from their reference)*: not the AR's. The rear is a thin ring on a tall flat stem over a clamp with a big knurled knob on its left; the front is a flat blade with two tall thin ears rising past a post between them. Built in gun-mp7.mjs.

**The bolt-action rifles' irons** *(user's call: true to the real ones)*: the `awm` and `r93` have none, so bare they aim along the rail and push the player to a scope. The `sv-98` has a target diopter on the action behind the rail, a thin ring over a narrow housing with knurled knobs either side, and a globe over a post at the muzzle. The diopter sits further from the eye than a carbine's peep, so its ring is grown to read as large aimed.

**The pistols' notch and post:** a one-piece rear with a wide notch, the post wide enough to read at its distance with air either side. The markings tell them apart: an outlined notch on the `glock` platform, three dots on most, none on the `m1911a1`. Aimed, a pistol is held nearer than arm's length (`PISTOL_AIMED_Z` in viewmodel.ts), so the sights read on a phone.

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
