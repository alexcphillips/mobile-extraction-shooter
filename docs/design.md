# Game design

These decisions were made in design sessions on 2026-10-25 and 2026-10-26. Update this file when a decision changes, and give the date and reason.

## Vision
A simplified mobile extraction shooter: the risk/reward loop of Tarkov without its complexity. You gear up, go into a short raid on a small map, loot and fight AI, then either extract with what you found or die and lose it.

**Pillars**
1. **Risk vs. reward.** Whatever you bring into a raid can be lost. That tension is the game.
2. **Short and readable.** Raids are about 10–15 minutes of thorough exploration (Tarkov and Delta Force are around 45), the art is simple, and the systems are simple.
3. **Phone-first.** Every system must be usable with thumbs and run well on an iPhone.
4. **Easy to author.** Maps and items are built in in-game editors and stored as data.

## Scope
| In | Out (deliberately) | Deferred |
|---|---|---|
| Extraction points, loot, stash, vault | PvP of any kind | Co-op vs. AI (designed for from day one) |
| NPC vendors, quests | Player auction house | Weekly admin challenges |
| AI enemies and bosses | Attachments on attachments, taking guns apart | NPC-driven "flea market" (still to be explained and decided) |
| Hit zones, limb health, armour durability | Area-specific helmets and visors | Trading with friends |
| Healing that takes time, key rooms | Weather, day/night cycle | Grenades for AI (see AI) |
| Fixed weapon attachment slots | Packing rounds into magazines, multiple mags | Gyro aiming |
| Map editor, item editor (desktop) | Insurance | Water slowing movement |
| | Vibration | |

## Core loop and progression
- **Before a raid:** manage your stash, buy and sell with vendors, accept quests, and pick your loadout.
- **In the raid:** loot, fight AI, do quest objectives, and reach an extraction point.
- **Death:** you lose everything you brought or found, **except what's in your 2×3 vault** and **your knife**. Cash found in the raid is a physical item: lost on death unless it's in your vault. Your account balance is never at risk.
- **No insurance.** The safety net is starting equipment, weapons spawning in raids, the free knife, and the "go in with nothing, vault loot, sell it" strategy.
- **Knife:** always carried and never lost. Running is slightly faster with it out.

## Raids and maps
- Small maps, roughly 10–15 minutes to explore thoroughly.
- **Raid timer: 15 minutes by default**, set in the raid config. It's deliberately a little shorter than exploring the whole map, so you have to choose where to go and can't clear every corner.
- **Player spawns:** the editor places several possible spawn points, and one is picked at random each raid. Co-op players spawn together at the same point. Enemy spawns near player spawns should be avoided (a minimum distance).
- **A raid is a data config:** map + playable area + starting loadout rules + objectives + enemy spawns. Normal raids and future weekly challenges use the same format.
- Terrain is a **height grid** (smooth hills, Unturned-style). Water is a flat see-through surface with no collision; you walk on the ground under it.
- On slopes, buildings sit on a concrete base that fills the gap down to the ground.
- **Stairs and ladders** work for players. AI uses stairs and slopes, but never ladders.
- **Key rooms:** locked doors that open with key items.
- **Named zones** (for example "Science lab" or "Gas station") are drawn in the editor and used for map labels and loot weighting.
- **Loot:** containers (backpacks, desks, cabinets…) and loose item spawn points each reference a loot table ("household", "academic", "medical", "military", …). Everything is rolled once when the raid starts.
- **Quest items** spawn only for a player who has that quest accepted (in co-op, only for the quest holder).

## Movement (decided 2026-10-26, session 3)
- **Walk, sprint, crouch, jump and ladders.** Sprinting only works forwards, and it stands you up. You can't jump while crouched.
- **Crouching** lowers the capsule from 1.8 m to 1.2 m (eye 1.6 → 1.0 m) and slows you down. You can't stand up under something low.
- **Steps up to 0.45 m** are walked onto (kerbs, single stairs). A jump (0.6 m) plus that step lets you **mantle onto ledges about 1 m high**. Taller walls need stairs or a ladder. The editor's "unreachable spot" overlay must count jump-and-mantle as player movement.
- **Little air control:** you can speed up along the stick in the air, up to running speed, but never brake, so sprint jumps keep their momentum.
- **Ladders:** push towards the wall to climb up and away from it to climb down, whichever way you're looking. You grab one by walking into it, or by walking off its top edge. At the top you step over onto the surface behind it. Jump lets go.
- **Steep terrain** (over 45°) can't be walked up, but you can walk down it.
- Speeds: walk 3.5, sprint 6, crouch 1.8 and climb 2 m/s. All the tuning is in `MOVEMENT` in `packages/shared/src/sim/movement.ts`.

## Combat
- **Hitscan** (bullets travel instantly, as a raycast). No bullet travel time or drop.
- **Collision** is simple: boxes (rotated about the vertical axis only), the terrain height grid, and ramps for stairs. No physics engine.
- **Weapon attachments** use fixed slots, like Battlefield 4 or Black Ops 2: **optic, muzzle, magazine**, with underbarrel or laser possible later. Each gun defines its slots and where they sit on the model; each attachment says which slot type it fits.
  - **Fit (decided 2026-10-26, session 6b):** an attachment fits every gun with its slot, unless it lists the guns it fits. Optics and muzzles usually fit anything; magazines list their gun (a 45-round 5.56 mag fits only the rifle).
  - **Stat changes** multiply the gun's spread (hip and aimed), recoil, aim time, reload time and loudness; a magazine adds rounds. All the attachments' changes stack.
  - **Changing the magazine** puts rounds that no longer fit back with your spare ammo, and stops a reload in progress.
- **Magazines:** one magazine attachment per gun (for example, "extended mag" raises capacity). Reloading takes from the ammo you carry. No individual mags, no loading rounds.
- **Suppressors** reduce a shot's hearing radius (see AI). Session 6b: every gun has a `loudness` (how far away a shot is heard, in metres; rifle 180, pistol 120), and each shot carries it for AI hearing. The suppressor multiplies it by 0.3 and hides the muzzle flash. A muzzle brake is the opposite trade: 30% less recoil, 20% louder.
- **Laser:** a short see-through red line plus stat changes. No collision, and the AI doesn't notice it.
- **Firing (session 6):** weapons are `auto` (fire while held) or `semi` (once per pull), with a rate in rounds per minute. Shots stray randomly within a cone: wide from the hip, tight when aimed; aiming in takes the gun's aim time. Each shot kicks the view up (and a random bit sideways), and the view settles back by itself; the kick is the simulation's, so co-op sees the same. **Firing or aiming stops a sprint**, and firing ends sprint lock as aiming does. You can't fire on a ladder or while reloading. Pulling the trigger on an empty gun starts a reload. All weapon stats are in the item files (`content/items`).
- **Aiming:** magnified scopes use full-screen zoom (narrower field of view, a scope mask and a reticle), like other mobile shooters. Red dots (Coyote-style) have no zoom, just a reticle. Reticles and zoom levels are set in the item editor. Each gun model defines a sight line so the reticle lines up with the camera when aiming.
  - Session 6b: a scope's view **snaps to its zoom behind the mask at 90% aimed** (before that it zooms like iron sights), and the gun is hidden. Looking turns the view more slowly by the same factor, so it moves as fast on the screen. A red dot's reticle shows at 95% aimed, when its frame has come up to the eye. Behind a reticle the crosshair dot hides but still flashes for hit markers.
  - Reticles are drawn on the screen, not in 3D, so they stay sharp and readable at any distance. Their size is in % of the screen height, not angles: a real 2 MOA dot would be a fraction of a pixel on a phone.

## Damage, armour and health
- **Hit zones:** head, chest, left arm, right arm, left leg, right leg. Each has its own HP pool and damage multiplier. Session 6 values: HP 35, 85, 60, 60, 65, 65 (370 in all); shot multipliers 1.5, 1, 0.7, 0.7, 0.75, 0.75. Damage per shot is the ammo's. All tuning is in `HEALTH` in `packages/shared/src/sim/health.ts`.
- **Hit zones are a fixed capsule layout** (decided 2026-10-26, session 6), worked out from the character's position, yaw and crouch, not attached to animated bones. That keeps hits in the simulation, the same on a co-op server with no renderer. The drawn body (session 8b) is posed to match.
- **Armour:** helmets cover the head, chest armour covers the chest. Armour **absorbs a percentage** of damage (set per armour piece) and loses durability as it does; at 0 durability it absorbs nothing. Armour can be repaired with armour repair kits.
  - Session 6: it absorbs its **full percentage until it breaks** (no falloff as it wears), and loses durability equal to what it absorbed times the ammo's `armourDamage`. Simple and readable: the colour warns you it's close to breaking.
- **A limb at 0 HP is "broken"** (there's only one state):
  - Legs: slower movement.
  - Arms: more weapon sway and slower aiming.
  - **Damage to a broken limb spills over to the chest** at a reduced amount (about 70%, tunable).
  - **So does the rest of the hit that breaks it** (session 6): a 40 damage hit on a leg with 10 HP left breaks it and sends 30 × 70% to the chest. Without this, huge hits and falls to the legs could never kill.
  - Session 6 values: each broken leg multiplies speed by 0.75; each broken arm multiplies spread by 1.6 and aim time by 1.5.
- **Head or chest at 0 HP = death.**
- **Bleeding:** heavy hits can cause bleeding, which slowly drains HP until a bandage stops it.
  - Session 6: each ammo type has a **bleed chance** per hit that gets through armour. A bleeding zone loses 1 HP per second (through the same spillover rules), so bleeding out of a broken limb drains the chest.
- **Fall damage** (session 6, retuned 2026-10-26 because the user found it hurt too soon): landing faster than 12.5 m/s (a drop of about 4 m, so one-storey roofs are safe) hurts both legs by 15 per m/s over that, each. About 5 m bruises, about 7 m breaks both legs, and above about 11 m the spillover kills. A jump never hurts. (It was 10 m/s and 12 per m/s: hurt from about 2.5 m.)
- **Treatment items:**
  - Splint: fast and cheap. It removes the broken effect, but the limb stays at 0 HP and spillover still applies.
  - Surgery kit: slow and rare. It brings a broken limb back to 1 HP.
  - Medkit: has an HP pool and heals HP.
  - Bandage: single use, stops bleeding.
  - Items target limbs in a **fixed priority order: head, chest, left leg, right leg, left arm, right arm.** There's no body diagram.
- **Using meds:** there are 2–4 quick-use slots on the HUD. Tap to start; a progress ring shows the timer. You can walk slowly while healing; firing or sprinting cancels it. The use time, HP pool and effects are set per item in the item editor.
- **HUD:** one overall health bar (sum of all limbs) plus status icons for broken limbs and bleeding. Armour icons change colour by durability: **yellow** when damaged, **orange** when low, **red** when broken.
  - Session 6: damaged is below 75% durability, low below 35%. The health bar, armour icons and status chips are at the top centre, the ammo count (with a reload bar) at the top right. The crosshair flashes red on a hit and grows on a kill; the screen edges flash red when you're hurt.
- **AI uses the same hit zones and limb system**, with only the leg effect (broken legs slow it down).

## AI
- **Awareness states:** unaware → suspicious (heard or glimpsed something) → alert (knows where you are) → lost track (searches, then goes back to patrolling).
- **Hearing:** each shot has a hearing radius; suppressors shrink it.
- **Unreachable player** (alert, but there's no path to you): take cover out of your line of sight, hold angles on the ways down, patrol nearby, and give up after a while. No grenades for now; if they're added later, one grenade "token" is shared across all AI in the area so many don't throw at once, and AI can't damage itself.
- **Bosses** are enemy types with stronger stats and loadouts.
- **Enemy spawn points** (set in the editor) define the enemy type, a loadout roll, and loot table weighting (for example, a lab boss drops more rare science and medical loot).
- **Navigation** is generated automatically from the map data (see the editor's navigation overlay).

**Session 7 decisions (2026-10-26).** All the tuning is in `AI` in `packages/shared/src/sim/ai.ts`; the numbers are first guesses to tune in play.
- **Patrols** (chosen by the user): a `patrol` node in a map or prefab is a named route, and an enemy spawn names one with `patrol`. A spawn without one **guards**: it stands at its spawn and looks a new way every few seconds, within 70° of the spawn's direction.
  - **The route is authored, not the shortest path** (asked for by the user): a point is either a **stop** (stand and look around for its own `wait`, 3 s by default) or a plain position the enemy **walks through** without slowing. Between consecutive points it takes the shortest way, so through-points shape the route (round the back of a house rather than across the yard).
  - **Areas, not spots:** a stop can have a `radius`, and each visit goes to a random walkable spot within it; an enemy spawn can have a `radius` too. The same patrol looks different from raid to raid.
  - **Way in, then repeat:** points before `repeatFrom` are walked once from the spawn; the rest repeat, in a loop or back and forth. For example: spawn in an area, walk a set route to area B, wait, walk on to area C, wait, then go back and forth between B and C.
  - After an alarm it picks the patrol up again at the nearest point.
- **Sight:** a 120° field of view out to 70 m, blocked by walls; you're seen if your head or the middle of your body is. Noticing builds up over time rather than being instant. Someone standing in the open within 8 m is noticed in about half a second, and it gets slower with distance (about 6 s at 70 m) and towards the edge of view. Crouching (×0.6) and standing still (×0.7) make you harder to notice, sprinting easier (×1.3), and an enemy already on edge notices faster (×1.6). Inside 2.5 m in view it's instant. A glimpse (30% noticed) makes it suspicious; full makes it alert.
- **Hearing shots, tiered** (chosen by the user, because the rifle is heard 180 m away on a 192 m map): within the shot's loudness, an enemy is suspicious and turns to look; within half of it, it walks over to investigate; within 15%, it's alert. Suppressors shrink every tier. A bullet passing or landing within 3 m, or a hit, makes it alert to the shooter wherever they are. A heard noise is placed with an error of up to 10% of its distance (at most 8 m).
- **Footsteps** (chosen by the user): sprinting is heard 15 m away and walking 6 m; crouch-walking and standing still are silent. Footsteps make an enemy suspicious, never alert on their own.
- **Awareness in practice:** suspicious → turns to look for 1.5 s, then walks over if it's worth checking (a glimpse, a nearby shot or footsteps), looks around there for 5 s, and goes back to its patrol. Alert → knows where you are while it can see you, and for 1 s after losing sight (it saw which way you went); then it fights as in session 8 below, and when it has lost you it's **searching**: it goes to where it last saw you, then checks 3 random spots within 12 m, and calms down. An unarmed enemy faces you, closes to 10 m and holds.
- Enemies' own shots: see session 8 below.
- **Bodies push each other apart** (player and enemies alike); the dead don't.

**Session 8 decisions (2026-10-26): combat.** Tuning is in `AI` and in the enemy type files; the numbers are first guesses to tune in play.
- **Enemy types are data** (`content/enemies/<id>.json`): a name, a default loadout, and a **skill**: reaction time, how far its aim wanders when it first sees you and once settled, how fast it settles, and how likely it is to hold an angle rather than push. Bosses are types with better skill and a better loadout, not more HP (the HUD and healing assume the same zone HP for everyone). The scav reacts in 0.7 s and settles to 0.7°; the yard boss reacts in 0.4 s, settles to 0.35° and holds angles more.
- **Loadouts** (`content/loadouts/<id>.json`) are rolled when an enemy spawns: the weapon, helmet and body armour are each picked by weight on their own, with a spare-rounds range, attachments that each go on by chance, and armour that can be worn (a condition range). An enemy spawn's `loadout` replaces its type's. Scavs carry a pistol or a rifle, sometimes a helmet or plate carrier, worn; the boss always has a rifle with a red dot or scope, helmet and plates.
- **Aim (chosen by the user: "settling aim error"):** an enemy waits its reaction time before its first shot, then its aim wanders around you (smoothly, not random per shot) by an error that shrinks the longer it watches you. A target moving fast and its own movement keep the error up, and being hit makes it flinch (+3°). Seeing you again **where it last saw you** takes only a 0.15 s reaction; seeing you **somewhere else** (2 m or more) after over a second takes its full reaction, with its aim off by about how far you went. So popping back out of the same cover is dangerous, and repositioning is how you win. It aims at your chest, or at your head when only that shows over cover, and pulls down half its recoil.
- **Firing:** automatics in bursts (3–6 rounds close, 2–3 beyond 15 m), semi-automatics in single shots, with pauses between that grow with distance. It aims down the sights beyond 12 m. **It never fires when another enemy is in the line of fire**; if its spread hits one anyway, that does damage but doesn't turn them on each other.
- **Fighting in the open:** it closes in until within 30% of its gun's range (at most 45 m), then sidesteps left and right at half pace. After 3–6 s in the open, when it's hit, or when its magazine is empty, it looks for **cover**: a reachable spot within 10 m where you can't see it crouched (with a 0.4 m margin either side), at least 4 m from you, not taken by another enemy. It reloads there. Over **low cover** it crouches and peeks by standing up; behind full cover it peeks by walking back to where it was fighting from. If you can see it in its cover, it gives up on that cover.
- **Losing sight (reachable):** it either **pushes** to where it last saw you or **holds the angle** (by its type's chance, and only if it can see that spot), then searches: after 4 s pushing or 8 s holding.
- **Out of reach** (you're somewhere it can't walk to, like a roof reached by ladder): while it sees you it fights as usual. Once it loses sight it finds the **way up** (the closest spot it can reach), moves to a spot within 10 m that's hidden from you and watches the way up, aimed, for 8 s, then moves to another spot within 8 m of it and holds again. **It gives up after 45 s without seeing you** and goes back to its patrol.
- **Allies' shots (chosen by the user: "join the fight"):** an enemy that hears another enemy firing joins in: within 15% of the shot's loudness it's alert to whoever its ally is fighting; within half it walks over to investigate there. Further away, or a shot from an enemy that isn't fighting anyone, it ignores. Suppressed enemies pull in fewer friends.
- **The dead stay down** (bodies for session 11's looting). The test page's `?respawn` brings them back for testing.
- **Looting bodies and loot weighting moved to session 11** (the user's call): they need items, inventory and loot tables (sessions 9–11).

- **Doors (decided 2026-10-26, for session 11):** AI opens doors. A door is **open or closed in the simulation, with nothing in between**: opening one changes its collision at once, for players and AI alike, and the renderer animates the swing (about 0.2 s) for looks only, so nothing can get caught on a half-open door, and co-op only syncs one flag per door. A closed, unlocked door stays a link in the navigation grid, so paths go through it and an enemy opens it when it gets there. **Opening a door makes no noise** for AI, for now (the user's call). **Enemies never open locked doors**, even carrying the key (the user's call, 2026-10-26). But **unlocking is for the rest of the raid**: once a player unlocks a door, it's an ordinary door that anyone can open, enemies included. So a key room is safe only until you open it; after that, enemies can follow you in.

## Inventory and UI
- **A grid inventory with item sizes** (Tarkov-style), designed for touch:
  - Auto-placement puts an item in the first free space. Items can be rotated.
  - **Double-tap** moves an item between your inventory and the open container (or stash), fitting it automatically.
- Backpacks and rigs have their own grids. **No containers inside containers.**
- **The in-raid screen has tabs:**
  - **Inventory:** includes looting containers and bodies, plus the attachment manager.
  - **Map:** a simple SVG generated from map data, showing building outlines, named zones and **your own position**.
  - **Quests.**
- **Weapon attachments** can be managed both in the main-menu stash and during a raid.
- The inventory UI's usability on a phone is an explicit design goal. Prototype it on a real phone before polishing.

## Quests and vendors
- **Quest types:**
  - **Investigate:** a marker visible through walls, with a live distance readout. Go to it and tap "Investigate".
  - **Extract with an item:** a normal item, or a quest item that spawns only while the quest is accepted.
  - More types can be added as data.
- **Vendors** buy and sell, always stock cheap basic gear, give quests, and sell armour repair kits.

## Controls and platform behaviour
- A standard twin-stick touch layout. **The layout can be adjusted in settings and is saved.**
- **Aim and fire behaviour** are chosen in settings (hold vs. toggle to aim, fire options). Default: hold, with automatic fire.
  - **"Automatic fire" means auto-fire on target** (clarified 2026-10-26, session 5): the gun fires by itself while the crosshair is on an enemy, like CoD Mobile's simple mode. The other option is "fire button only". The fire button works in both modes.
  - Session 6: "on an enemy" means the crosshair ray (with recoil) hits a living character's hit zone within the gun's range, with no wall in the way. With a semi-automatic gun, auto-fire pulls the trigger as fast as the gun allows.
- **Aim assist:** aim slows slightly when passing over an enemy. It's a setting, defaulting to low. Session 6: look speed × 0.8 (low), 0.6 (medium) or 0.45 (high) while the crosshair is on an enemy.
- **Touch layout (session 5):** the move stick floats where the left thumb lands on the left half; dragging on the right half looks. **The fire button also looks:** dragging the thumb on it turns the view, so you can track a target while shooting. Buttons: fire, aim, reload, use (interact), jump, crouch (toggle) and quick slots 1–4.
- **Sprint (decided 2026-10-26, session 5):** pushing the stick to its rim (forwards) sprints. Dragging on up into the "sprint" zone above the stick **locks sprinting**, so the thumb can let go; with a thumb on the stick while locked, left and right steer. **It unlocks** when you pull the stick back, tap the left half, aim, crouch, or jump off a ladder. Aiming stops sprinting, and sprinting turns crouch off.
- **Landscape only:** a "rotate your phone (and turn off rotation lock)" overlay shows whenever the phone is in portrait, and the game pauses.
- **Safari workarounds:** unlock audio on the first tap, run in standalone mode from the home screen (no browser UI), and disable pinch and double-tap zoom with CSS and the viewport settings. **Zoom (2026-10-26):** iOS ignores `user-scalable=no` and a double tap still zoomed the game on the phone, so `app/no-zoom.ts` also cancels Safari's pinch gesture events and a second `touchend` within 350 ms. It blocks nothing while the page is zoomed in, so you can always pinch back out.

## Art direction
- Unturned-like: low-poly, solid flat colours, **no real lighting**.
- For readability, each face direction gets a slightly different shade (tops lighter, sides darker), plus **distance fog** (which also lets far-away objects go undrawn).
- Items and props are built from simple shapes (boxes, cylinders) in the editors.

## Trust model
A sandbox. The client is trusted. The server only applies sanity limits (for example, money can't jump from 20 to 9 trillion; item counts and values stay within reasonable bounds). No raid replay or loot validation. Revisit only if ranked challenges or friend trading get abused.

## Characters (confirmed 2026-10-26)
- **No blocky cube people.** The base body is a rigged, animated **low-poly humanoid from a CC0 asset pack** (for example Quaternius), recoloured to flat colours to match the art style. No 3D modelling is needed from the user.
- **What you see on an enemy is what they carry:** helmets, armour, backpacks and weapons are the same models built in the item editor, attached to the body. You can read how dangerous an enemy is, and roughly what they'll drop, before you engage.
- **Factions and bosses** are told apart by uniform colours and gear, and bosses also by size or a distinctive item.
- **The player in first person** sees only arms and the gun. The full body is the same character system, which a co-op partner sees.
- **Animations** come from the pack: idle, walk, run, aim, shoot, reload, death. No ragdolls.

## Editors (admin only, desktop browser)
The editors run on the Mac in a desktop browser and save to JSON files in the repo. The game itself is played on iOS.

**Map editor**
- **Snapping:** adjustable grid snap (coarse for buildings, fine for props, or off). Rotation at any angle, with adjustable angle snapping and **"match the rotation of the selected object"**.
- **Placement:** objects **snap down onto the surface** below (a chair onto the floor, a lamp onto a table). Overlapping props get a **red warning** but are allowed; **buildings can't overlap other buildings**.
- **Prefabs** (cars, trees, trash cans, mailboxes, whole buildings) are placed by reference, so editing a prefab updates every copy. Individual copies can be recoloured.
- **Editing safety:** a placed prefab or building is selected and deleted as **one object**, and you can enter it to edit its parts. Full **undo/redo**. **The ground layer is locked** against accidental deletion.
- **Terrain:** raise and lower brushes, water level, and automatic concrete bases under buildings.
- **Gameplay markers:** random player spawns, enemy spawns (type, loadout roll, loot weighting), loot containers and spawn points (loot table), extraction points, quest markers, doors and keys, named zones.
- **Navigation overlay:** shows where AI can walk, and **highlights spots where a player can stand but AI can't reach them or shoot them**, so you can fix them while building.
- A **play-test** button.

**Item editor**
- Stats for every item type: weapons (stats, ammo type, attachment slots and their mount points, sight line), ammo, attachments (stat changes; for optics, the reticle design and zoom level), medical items (use time, HP pool, what they fix), armour (absorption %, durability), containers (grid size), keys, quest items.
- A model builder that makes items from simple shapes.
- Grid size in the inventory for every item.

## Future (designed for now, built later)
- **Co-op vs. AI:** a raid runs on the server (Cloudflare Durable Object) using the same simulation code; each phone predicts its own movement. See [tech-stack.md](tech-stack.md).
- **Weekly admin challenges:** a raid config that limits play to part of an existing map, sets an objective, and starts you with no items.
- **NPC flea market:** simulated listings with prices that move with supply and demand. Still to be explained and decided.
