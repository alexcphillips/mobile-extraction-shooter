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

## Combat
- **Hitscan** (bullets travel instantly, as a raycast). No bullet travel time or drop.
- **Collision** is simple: boxes (which may be rotated), the terrain height grid, and ramps for stairs. No physics engine.
- **Weapon attachments** use fixed slots, like Battlefield 4 or Black Ops 2: **optic, muzzle, magazine**, with underbarrel or laser possible later. Each gun defines its slots and where they sit on the model; each attachment says which slot type it fits.
- **Magazines:** one magazine attachment per gun (for example, "extended mag" raises capacity). Reloading takes from the ammo you carry. No individual mags, no loading rounds.
- **Suppressors** reduce a shot's hearing radius (see AI).
- **Laser:** a short see-through red line plus stat changes. No collision, and the AI doesn't notice it.
- **Aiming:** magnified scopes use full-screen zoom (narrower field of view, a scope mask and a reticle), like other mobile shooters. Red dots (Coyote-style) have no zoom, just a reticle. Reticles and zoom levels are set in the item editor. Each gun model defines a sight line so the reticle lines up with the camera when aiming.

## Damage, armour and health
- **Hit zones:** head, chest, left arm, right arm, left leg, right leg. Each has its own HP pool and damage multiplier.
- **Armour:** helmets cover the head, chest armour covers the chest. Armour **absorbs a percentage** of damage (set per armour piece) and loses durability as it does; at 0 durability it absorbs nothing. Armour can be repaired with armour repair kits.
- **A limb at 0 HP is "broken"** (there's only one state):
  - Legs: slower movement.
  - Arms: more weapon sway and slower aiming.
  - **Damage to a broken limb spills over to the chest** at a reduced amount (about 70%, tunable).
- **Head or chest at 0 HP = death.**
- **Bleeding:** heavy hits can cause bleeding, which slowly drains HP until a bandage stops it.
- **Treatment items:**
  - Splint: fast and cheap. It removes the broken effect, but the limb stays at 0 HP and spillover still applies.
  - Surgery kit: slow and rare. It brings a broken limb back to 1 HP.
  - Medkit: has an HP pool and heals HP.
  - Bandage: single use, stops bleeding.
  - Items target limbs in a **fixed priority order: head, chest, left leg, right leg, left arm, right arm.** There's no body diagram.
- **Using meds:** there are 2–4 quick-use slots on the HUD. Tap to start; a progress ring shows the timer. You can walk slowly while healing; firing or sprinting cancels it. The use time, HP pool and effects are set per item in the item editor.
- **HUD:** one overall health bar (sum of all limbs) plus status icons for broken limbs and bleeding. Armour icons change colour by durability: **yellow** when damaged, **orange** when low, **red** when broken.
- **AI uses the same hit zones and limb system**, with only the leg effect (broken legs slow it down).

## AI
- **Awareness states:** unaware → suspicious (heard or glimpsed something) → alert (knows where you are) → lost track (searches, then goes back to patrolling).
- **Hearing:** each shot has a hearing radius; suppressors shrink it.
- **Unreachable player** (alert, but there's no path to you): take cover out of your line of sight, hold angles on the ways down, patrol nearby, and give up after a while. No grenades for now; if they're added later, one grenade "token" is shared across all AI in the area so many don't throw at once, and AI can't damage itself.
- **Bosses** are enemy types with stronger stats and loadouts.
- **Enemy spawn points** (set in the editor) define the enemy type, a loadout roll, and loot table weighting (for example, a lab boss drops more rare science and medical loot).
- **Navigation** is generated automatically from the map data (see the editor's navigation overlay).

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
- **Aim assist:** aim slows slightly when passing over an enemy. It's a setting, defaulting to low.
- **Landscape only:** a "rotate your phone (and turn off rotation lock)" overlay shows whenever the phone is in portrait, and the game pauses.
- **Safari workarounds:** unlock audio on the first tap, run in standalone mode from the home screen (no browser UI), and disable pinch and double-tap zoom with CSS and the viewport settings.

## Art direction
- Unturned-like: low-poly, solid flat colours, **no real lighting**.
- For readability, each face direction gets a slightly different shade (tops lighter, sides darker), plus **distance fog** (which also lets far-away objects go undrawn).
- Items and props are built from simple shapes (boxes, cylinders) in the editors.

## Trust model
A sandbox. The client is trusted. The server only applies sanity limits (for example, money can't jump from 20 to 9 trillion; item counts and values stay within reasonable bounds). No raid replay or loot validation. Revisit only if ranked challenges or friend trading get abused.

## Characters (proposed 2026-10-26, waiting for the user's confirmation)
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
