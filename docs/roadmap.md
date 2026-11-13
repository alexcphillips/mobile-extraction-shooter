# Roadmap to v1

**v1 =** a solo PvE game that's fun to play on an iPhone:
- one handmade map, built in the map editor;
- the full loop: stash → vendors and quests → raid → extract or die;
- persistence on the server;
- the map and item editors working well enough to make more content.

Co-op, weekly challenges, the flea market and trading are post-v1.

## How to use this file
- Each session below is sized for one Claude Code session. Start a session with "Do session N from docs/roadmap.md", in a fresh conversation (`/clear` between sessions).
- Read only what the session needs: its **Read:** line if it has one; otherwise the indexes [design.md](design.md) and [tech-stack.md](tech-stack.md), then only the topic files the work touches. Don't read whole docs to get your bearings.
- This file holds open work only. Finished sessions and their notes are in [roadmap-done.md](roadmap-done.md); read one there only when you need its history.
- At the end of a session:
  - tick its box and add short notes under it (what was built, anything deferred, decisions made), then move it, with its notes, to the same section in roadmap-done.md and update that section's count here;
  - record decisions in the design or tech topic file they belong to, not only here.
- If a session is too big, split it here before starting rather than leaving it half done.

## Milestone A: foundation and performance gate

- 2 finished sessions in [roadmap-done.md](roadmap-done.md).

## Milestone B: a raid you can play offline (no server)

- 15 finished sessions in [roadmap-done.md](roadmap-done.md).

## Milestone C: the meta loop and server

- 7 finished sessions in [roadmap-done.md](roadmap-done.md).

## Milestone D: editors

- 7 finished sessions in [roadmap-done.md](roadmap-done.md).

## Milestone E: content and release

- 31 finished sessions in [roadmap-done.md](roadmap-done.md).

- [ ] **19b. The first real map.**
  - Claude drafts a one-page brief (points of interest, extractions, routes, key rooms) and a rough first version as data; the user reshapes it in the map editor, and Claude fixes the editor where it gets in the way (the user's call, 2026-10-30).
  - What the map needs that isn't built: enemy spawns kept away from the player's spawn, doors fitted into a wall's gap, **vaulting through standard-height windows** (design.md → Movement; the user's request, 2026-10-30: a simple scripted move, no complicated animation).
- [ ] **19c. The first content set.**
  - Items, prefabs, loot tables, enemies and a boss, quests and vendors, fitted to the map.
- [ ] **20. Polish and v1 release.**
  - Performance pass on the phone, balance pass, bug fixes.
  - Deploy, install from the home screen, play-test with a friend.

## The AI rework: scavs, PMCs and Jug (planned 2026-11-07 with the user)
The design is in design.md → AI → Scavs, PMCs and bosses. Scavs and PMCs first; **Jug last**, since he reuses squads, suppression, grenades, voice lines and the hunt. Every number is a first guess to tune in play, and each session checks the AI in the sim on Northpoint, including the tick cost with everyone present.

- 22 finished sessions in [roadmap-done.md](roadmap-done.md).

**Questions for the user (raised while planning):**
- ~~Does Jug kick open **locked** doors?~~ No: unlocked only (the user's call, 2026-11-08).
- PMC names in the damage log ("Halvorsen (PMC) shot you…"), or just "PMC"? (AI-3 went with "PMC" for now.)
- No medium backpack exists, so PMCs carry a small or a large one (AI-3). Add a medium backpack item?
- ~~How often Jug is in a raid (the yard boss is 60%)?~~ 15% (the user's call, 2026-11-08), then 40% the same day (the user's call).
- An industrial loot table (tools, tape, fuel, bolts) needs new items; worth adding for scavs? (2026-11-11: filled, and scavs roll it at 1.)
- ~~**(AI-4) PMCs don't survive Northpoint's scavs.**~~ The user's call (2026-11-08): they fight scavs only when they meet them (AI-9). **Still open:** every PMC is still dead within about 12 minutes, 40% of them to rival PMC squads in the first 2 minutes (squads start at player spawns and their routes meet). They already ignore each other's gunfire (AI-9), so they meet because their routes cross. **The user's call (2026-11-08): PMC against PMC is fine; routes keep squads apart early** (AI-9).
- ~~**(AI-14) PMCs still kill Jug on his ground**~~ AI-15 and AI-16 (PMC spawns, no blunt damage): Jug lives 3 of 6, PMCs kill each other once in 6 raids.
- ~~**Scavs against armor** (AI-16)~~ Fine as it is (the user's call, 2026-11-08). AI-11 kept too.
- ~~**(AI-18) Without Jug, rival PMC squads kill each other early**~~ AI-19's areas: 3 killed by rivals in the first 5 minutes (12 before).
- **PMCs are all dead by 15–20 minutes** (AI-9's and AI-10's measurements): attrition against scav waves, not the PMC count or squad size. Healing and better cover (AI-10) raised their kills (49 to 60 a 6-raid run) but not their survival: they win about 2.5 to 1, and meet more scavs than that. Sharpening them against scavs doesn't help either: a far harder scav handicap (AI-11) gave the same 15 minutes. Fewer scavs or slower refills, routes that keep PMCs off scav ground, or accept it (you mostly meet them early)?
- **(AI-4) Path-search spikes.** Roaming squads start fights across the map, and the AI's long path searches (50 m+, especially between floors) cost 3–14 ms each on a Mac when they hit the search budget, several times that on a phone. Worth a session for a cheaper long-range pathfinder (a coarse graph over the nav grid's regions) before more AI?
- **(AI-4) Switches:** should PMCs open switch doors (the main shutter's siren, the fire exit's chain) to leave? Today they skip those extractions.
- **(AI-7) PMCs kill Jug early.** In all 4 peaceful raids a PMC squad killed him within 6 minutes (as early as 46 s): bold and charging, he walks out to their gunfire and straight at a squad of 2–4, and his armor is only head and chest. Intended (PMCs thin him out, as they do in Tarkov), or should he leave PMCs be unless they come onto his ground or shoot him, or be tougher against AI?
- ~~**(AI-7) Enemies face −z on their first tick**~~ Fixed 2026-11-08 (AI-8 → Follow-up), with a wider arc search so the roof throw still works.
- ~~**Enemies never treat their wounds**~~ (found 2026-11-08: Jug won against every PMC squad in 3 of 6 Northpoint raids, then bled to death 8–11 minutes in). **The user's call (2026-11-08): no healing.** Jug is meant to be aggressive, not to stop and heal; bleeding out after a big fight is fine.
- [ ] **Boss spawner spawns the map's boss** (the user's request, 2026-11-08). The admin Boss spawner spawns Jug everywhere for now (`content/items/boss-spawner.json`, `spawns: "jug"`). Later it should spawn the boss of the map you're on (Jug on Northpoint, `boss-scav` on the test map and the Mall), e.g. by reading the map's boss wave. `spawns` is one fixed id today, so it needs a way to say "this map's boss".

## Inventory and controls UX (planned 2026-11-08 with the user, from their mobile UI notes)
Cut at the user's call: valuables going to the vault by themselves, item and ammo cases, and extra vaults from quests (design.md → Inventory and UI → Not doing).

- 7 finished sessions in [roadmap-done.md](roadmap-done.md).

## PC controller (planned 2026-11-08 with the user)
A PS4 controller (DualShock 4) on a PC browser: raids **and** every menu and inventory action, with no mouse needed. **PC browsers only for now** (Chrome first, then Edge and Firefox); not the phone, not Safari (the user's call, 2026-11-08). The user accepts a common shooter layout, as long as everything the game needs fits. **Stop and call out problems** (too few buttons for an action, something a pad can't reach) instead of quietly working around them. See design.md → Controls → Controller (PC).

**Button budget (Claude's count, 2026-11-08):** the raid uses 19 actions besides moving and looking: fire, aim, sprint, jump/vault, crouch, prone, lean left and right, reload, use (also held, for zombies' barricades), bag, the four hand slots, heal (tap; hold opens the picker), grenade (the same), detonate C4, put out fire, and settings. The debug keys 7 and 8 stay keyboard-only. A DS4 has 16 usable inputs in the standard mapping, plus touchpad click (button 17 in Chrome). The PS button belongs to the OS. **On macOS, Share takes screenshots** (System Settings → Game Controllers), so it can't be used either. With doubling up (tap/hold, and context: use only when a prompt shows) it **fits with nothing left over.** Any new action (fire mode, flashlight, inspect, a map key) will need a hold-modifier or a radial menu. Raise that when it comes up.

**Layout (the user's OK, 2026-11-08):**
| Input | Raid | Menus (virtual cursor) |
|---|---|---|
| Left stick | move (partial push walks) | move the cursor |
| Right stick | look | scroll the panel under the cursor |
| R2 / L2 | fire / aim (hold or toggle, per the aim setting) | — |
| L3 / R3 | sprint / take out the knife | — |
| ✕ | jump, vault, get up from prone | click (hold and move: drag) |
| ○ | crouch (per the crouch setting); held, prone | back / close (as Esc) |
| □ | use when a prompt shows, else reload; held: keeps using (barricades) | quick move (as a double-click) |
| △ | tap: switch primaries; hold: sidearm | rotate while dragging; else details (as a right-click) |
| R1 / L1 | grenade / heal (tap uses, hold opens the picker; the stick picks) | next / previous tab or stash page |
| D-pad ← / → | lean left / right (per the lean setting) | move the cursor one tile |
| D-pad ↑ / ↓ | detonate C4 / put out fire | move the cursor one tile |
| Options | settings | close the screen |
| Touchpad click | bag | close the bag |

- **The lean problem:** a stick player has no free thumb for leaning. On the D-pad it means letting go of the move stick, which is fine with **toggle** lean (the default: one tap, then back to the stick) and poor with **hold** lean. The other common layout (Siege-style: L3/R3 lean, sprint by pushing the stick to its rim like on touch) frees the D-pad, but at the rim you'd sprint by accident and be heard 35 m away instead of 20. **Decided: D-pad lean** (the user's call, 2026-11-08).

- 3 finished sessions in [roadmap-done.md](roadmap-done.md).

- [ ] **CP-4. Controller not picked up (reported 2026-11-08, Chrome over HTTPS in prod).**
  - Diagnostics added: `input/pad-diagnostics.ts` (pure `diagnose`: no API / blocked by permissions policy or a frame / no pad listed yet / non-standard mapping / ready; `padLog` of connect events, started in main.ts) and `input/pad-test.ts`, a live plain-DOM panel (every pad slot's id, mapping, buttons lit, axes; the input mode and what last switched it; Copy report). Opened from **Settings → Controller → Test controller** (the section now always shows off touch) or `?padtest`. `input/mode.ts` records the cause of each mode switch.
  - New setting `inputPreference` (auto / controller only): with a pad listed, keys and the mouse don't take the mode from it; touch always does, so a phone that synced it stays playable.
  - **Next:** the user's copied report decides the fix (e.g. a fallback map for a non-standard DS4, or a header change).

## Tutorial (planned 2026-11-09 with the user)
See design.md → Tutorial for the flow and the user's calls (offline before sign-in, nothing kept, a barbed-wire crawl and a bandage, a harmless scav who fires back, a key in his pocket, out through an extraction).

- 3 finished sessions in [roadmap-done.md](roadmap-done.md).

## Item editor before the content push (planned 2026-11-09 with the user)
Before building a lot of content and reworking gun and reticle models. Today's guns have 15–28 parts; detailed ones may reach 60–150, and the model tab was built for one part at a time. Sessions 18 and 18b built the editor; see tech-stack.md → Editors.

- 2 finished sessions in [roadmap-done.md](roadmap-done.md).

## The Hangar (planned 2026-11-07 with the user)
The design is [hangar.md](hangar.md). The material items and loot tables are the user's.

- 8 finished sessions in [roadmap-done.md](roadmap-done.md).

- [ ] **Wipe prod before H4 ships** (no users yet): stored pages and vaults are reshaped on load, but a full old stash could fail its check.

## Silver Creek, the starter map (planned 2026-11-09 with the user)
See design/maps/silver-creek.md for the layout and the user's calls (a Customs-style rectangle about 320 × 150 m, spawns at both ends and extracts at the far end, trees kept to the edges, five river crossings, three landmarks). Sketch: https://claude.ai/artifact/9v38f2y7U7tuf5cdKBxc84. As with Northpoint, the user places spawns and loot, and the bones are approved before detail. The sketch still shows a church; it's now the fire lookout, office and sheds (MT-3).

- 12 finished sessions in [roadmap-done.md](roadmap-done.md). v1 of the map is built; it hasn't been played yet.

Later, not counted in v1 of the map:
- [ ] **MT-13. Conditional extracts:** the train (power it at the engine shed; switches already exist), the paid log truck, the raft. Water that slows you and splashes, if wanted then.
  - **Read:** design/raids-and-maps.md (extractions, switches); tech/content-formats.md.

## Map tools (planned 2026-11-12 with the user)
Tools for building many maps together: faster loops, better-measured layouts, less repetition, fewer tokens. MK-1 to MK-4 and MK-6 (the kit) are done. The rest land when a District session needs them. **Kit rule: a generator piece written once lives in its map script; written a second time, it moves to `scripts/mapkit/` with a sim test** (tech/editors.md → Map kit). Tool decisions go in tech/editors.md (editor and board) and level-design.md (the report's measures and yardsticks).

- 5 finished sessions in [roadmap-done.md](roadmap-done.md).

- [ ] **MK-5. Prefab catalog.** `node scripts/prefabs.mjs [query]` lists prefabs with size, height class (low, waist, eye, tall), triangles, collision, loot and which maps use them, from the 213 files, so a session finds one to reuse without reading them; `--sheet` renders a thumbnail sheet (the prefab browser's thumbnails) for the user. Prefabs gain optional `tags` (cover, vehicle, street, store, military, …). Variants rather than copies: a prefab can take a color or part swap from its parent, so "the same car in four colors" is one prefab.
  - **Read:** docs/props.md; tech/editors.md (prefab browser).
- [ ] **MK-7. Plan variants.** For a room or building, generate several plans into a numbered top-down sheet (with each plan's report numbers: entrances, longest line, cover count), the user picks by number, and the pick is written into the map. For District's stores (DS-8) and in-between pieces.
  - **Read:** MK-3 and MK-4's notes.
- [ ] **MK-8. Editor overlays.** The report's heatmaps (long lines, open patches, AI sight coverage) painted on the ground in the map editor, updated after an edit settles, so a problem shows while reshaping. Before DS-5.
  - **Read:** tech/editors.md (navigation overlay); MK-4's notes.
- [ ] **MK-9. Flow runs.** Headless raids (AI-9's runs) with simple player bots (spawn, a POI, an extraction) logging positions, fights and deaths to heatmaps: where fights happen, which routes get used, which areas nobody visits. A pointer, not a verdict: bots don't play like the user. Before DS-15.
  - **Read:** AI-9's notes in roadmap-done.md; design/ai.md.

**Token habits for map sessions** (in force now; CLAUDE.md's lean-token rule applied to maps): query maps and prefabs with scripts (`map-report`, `prefabs.mjs`, a `node -e` over the JSON), never read a map file; read a map's summary in its design file, then search; one report table per check, not logs; roadmap notes a few lines, detail in the map's design file.

## Characters: our own body and animations (planned 2026-11-12 with the user)
Replace the Quaternius mannequin and clips with our own, **before the real armor and equipment models**, so gear is modeled against the final body. The pack is CC0, so this is for fit and look, not licensing. **Claude authors the body, poses and clips; the user only reviews and makes tiny tweaks** in a small editor. Design: design/overview.md → Characters (look target, body plan). Read: that section, tech/client.md (character rendering), [props.md](props.md) → Worn gear.

- [ ] **CH-1. The rigid body.** One faceted piece per bone, in item-model parts (`content/characters/`), on the current skeleton and bone names so today's clips still play. Built around a fixed head volume matching the sim's head zone. Full helmets get `hidesHead` and the head isn't drawn; open helmets show it. Still one merged mesh and one draw call per character. Scavs without armor wear a cheap uniform layer (jacket, chest rig) so the bare body is rarely seen.
- [ ] **CH-2. Fit check and one test kit.** A fit report (`scripts/anim-check.mjs --fit`): for each worn item, how deep body pieces poke through it, worst frame of every clip. Then one helmet (the look target's), one plate carrier and one rig built in the target style. **The user approves the look here** before more gear or animation work.
- [ ] **CH-3. Animation tools for Claude.** Clips as JSON in `content/animations/`: keyed bone rotations in degrees, and lower-body or upper-body layers. Cycles (walk, run, crawl) come from a gait generator with a few numbers (stride, cadence, bounce, arm swing, lean), mirrored left to right. `scripts/anim-shot.mjs <clip>` renders a filmstrip (frames across the clip, side and front, ground line) and foot and hand trails. `anim-check` prints a table: foot slide while planted, feet through the floor, hands off the grip or magazine, joint limits, the jump at the loop seam. The user's editor: pick a clip, play and scrub, speed, the generator's sliders, nudge one bone on one key, all saved to the same JSON.
- [ ] **CH-4. Legs and stance.** Idle, walk, run, sprint; crouch idle and walk; prone idle and crawl; jump; vault; death. Replaces the pack's clips.
- [ ] **CH-5. Upper-body actions,** played over any stance: aim and low ready, reload per gun class, knife ready and slash, grenade throw, each med, packing mags. Recoil, hands on the gun (IK) and turning to the aim stay in code. No animations for searching, levers or anything else that tells another player nothing.
- [ ] **CH-6. Drop the pack.** Remove the mannequin and its clips, and update the docs.

## District (planned 2026-11-12 with the user; "Northpoint v2" while planning)
A new map, **replacing Northpoint (the user's call, 2026-11-12)**: **a suburban commercial district built on a hill, with the mall at its center**, built from scratch by generator script (the Silver Creek way) into `content/maps/district.json`. **Northpoint is not touched**; which one stays is decided after v2 plays. Story: **an evacuation point that was overrun**. Areas, size, in-between rules and building depths: design/maps/district.md (every DS session reads its summary first). As before, the user places spawns and loot.

**Bones first (the user's call):** POIs as boxes, roads and terrain heights are built, walked and discussed before any detail. The layout lives in one table in the generator (POI positions, footprints, levels, gaps), so stretching or squeezing the map after a review is a re-run. Nothing after DS-3 starts until the user approves the bones.

- 2 finished sessions in [roadmap-done.md](roadmap-done.md) (DS-1, the sketch; DS-2, the bones graybox).

- [ ] **DS-3. Bones review with the user.** Measured in the sim: walking and sprinting times between areas and edge to edge, the routes around and through the mall, open crossings over 40 m, lines of 70 m+, AI reach between levels, a first triangle and draw-call count. The user walks it; we discuss the flow and adjust the table (size included). **The user approves the bones here.**
  - **Read:** DS-2's notes (roadmap-done.md) and design/maps/district.md → The bones graybox. Walk it from the raid list in a dev build (District, tagged test) or `/editor?map=district` → Play; `node scripts/map-report.mjs district` and `node scripts/district-probe.mjs` measure it. Change the table on the board (`/layout?map=district`), then `node scripts/gen-district.mjs`.
  - **Read:** level-design.md; MK-4's notes (the report does the measuring).
- [ ] **DS-4. Long-range pathfinding** (AI-4's open question): a coarse graph over the nav grid's regions, so long searches across a district stay cheap on a phone. Before any AI work.
  - **Read:** tech/shared-sim.md (navigation); design/ai.md.
- [ ] **DS-5. The mall's shell and service network.** Floors, the slope's two entry levels, storefront grid, employee halls, stockrooms, electrical, trash and security rooms, staff stairs, locked security doors and breakable access points.
- [ ] **DS-6. The mall court.** The indoor garden, the helicopter crash, the bridges, the checkpoint and field hospital; lines held near 30 m.
- [ ] **DS-7. The department store** (the user's spec: two floors, central opening, stockroom on the service corridor, receiving with a roll-up door, damaged upper floor) **and the cinema wing.**
- [ ] **DS-8. The mall's key stores and shuttered stores.** Each its own plan; generated alternatives for the user to pick from. Props are the user's detail pass.
- [ ] **DS-9. The roof terrace, the parking garage and the glass connector bridge.**
- [ ] **DS-10. The plaza (restaurant court, jeweler, bank, phone repair) and the hotel** (the command post and the boss's ground).
- [ ] **DS-11. The service quarter:** docks, the warehouse, substation, container stacks.
- [ ] **DS-12. The furniture store and the construction site.**
- [ ] **DS-13. The strip row, gas station and surface lot** (the convoy wreck, armored vehicle, abandoned landing zone).
- [ ] **DS-14. The in-between:** the evacuation jam, terraces and stair cascades, the underpass, the culvert, service alleys, small structures, landscaping, evacuation leftovers; the 40 m rule measured. Split in two if it's too big.
- [ ] **DS-15. AI.** Scavs where the story puts them, patrols through the in-between and the mall's upper level, PMC points of interest, the boss at the hotel.
  - **Read:** design/ai-scavs-pmcs-bosses.md.
- [ ] **DS-16. Palette, finish and performance.** Its own palette (the approved mall finishes reused where they fit); triangles and draw calls against Northpoint and Silver Creek; a naming pass so every business name is made up.
- [ ] **DS-17. The freight elevator (2026-11-12; replaces the rotating raid events, which the user scrapped for something consistent):** a switch near the warehouse opens a freight elevator after 10–20 s. Starting it sounds a **local warning buzzer**, heard well around the warehouse, which the AI hears as a loud sound; there are **no long global alarms** (annoying in playtests). The user's design: shallow, a door opening on loose loot, reusing Northpoint's freight elevator and switch; the fighting is in the warehouse. Open: how enemies respond (the user: spawns triggered around the warehouse; Claude: a standing scav guard, the buzzer heard by the AI, and a response squad walking in from out of sight), where the switch is, and whether it needs the substation's power. Details in design/maps/district.md.

Then the user: spawns, extractions, loot, quests. **Open:** whether District replaces Northpoint (quests, server tests and the raid id use `northpoint`) or both stay; raid length (about 25 minutes, to confirm in DS-3).

## Breath, weight and stamina (planned 2026-11-11 with the user)
Aim sway makes careful shots frustrating (design/combat.md → Sights move). **Sprint speed stays 6 m/s** (the user's call). **Weight slows players only, never enemies** (the user's call). Every number below is a first guess.

- 4 finished sessions in [roadmap-done.md](roadmap-done.md).

## Gear stats and hit zones (proposed 2026-11-11 by the user, design to confirm before building)
- All 5 sessions finished, in [roadmap-done.md](roadmap-done.md).

**Every new stat goes into the item editor in the same session that adds it** (the user's note, 2026-11-12), so all of it can be configured there.

## Magazines as items (planned 2026-11-12 with the user)
Reverses "packing rounds into magazines, multiple mags" being out (design/overview.md): the user wants it because it's fun, and it makes rigs worth their slots. Loose rounds stay as what you pack from. Every number below is a first guess. Each session puts its new stats in the item editor.

- 4 finished sessions in [roadmap-done.md](roadmap-done.md); none open.

## Stocks and weapon footprints (planned 2026-11-12 with the user)
A gun's grid size follows its state, and stocks become parts you swap. Each change is set per item in the item editor; many attachments change nothing. **Saved stashes that no longer fit are fine: prod gets wiped** (no players yet; the user's call), so no stash migration.

- 2 finished sessions in [roadmap-done.md](roadmap-done.md); none left.

## Pain and tremors (planned 2026-11-12 with the user)
Painkillers hiding it come with Painkillers and injectors (below).

- 1 finished session in [roadmap-done.md](roadmap-done.md); none open.

**No suppression effects** (near misses blurring or muffling): dropped by the user, 2026-11-12. **Enemies get no headset hearing**: the cough's range does the job (the user's OK).

## Painkillers and injectors (planned 2026-11-12 with the user)
Consumables that give **timed effects**: painkillers hide pain, injectors boost (or cost) something for a while. They go in the sim (`packages/shared`), so co-op hosts agree. The Hangar's rule holds: only items change your character, and only in a raid (hangar.md). Each session puts its new stats in the item editor. Sessions after PK-1 are a first cut; PK-1 may reshape them.

- [ ] **PK-1. Finish the design with the user.** No code. Settle the questions below, write the answers into design/damage-and-health.md (a new Timed effects part) and tech/items-and-inventory.md, then rewrite PK-2 onward to fit.
  - **Read:** design/damage-and-health.md (Limbs, Healing, Feeling hurt); design/combat.md (Sights move); design/movement.md (Stamina); hangar.md (Trauma bay); tech/items-and-inventory.md (meds).
  - **Questions, most important first** (Claude's suggested default in brackets):
    1. **What does a painkiller cost you?** With no downside it just switches PS-1 off. [It lasts a while (about 2–4 minutes), and as it wears off you get a short tremor; no other cost.]
    2. **What does a painkiller hide?** Broken-arm sway and aim time, the low-health tremor and breathing, the pain edge? **Does it quiet the blacked stomach's groans that enemies hear?** That one changes fights. [All of PS-1 and the arms' sway, but not the arms' aim time; groans quieter (half the range), not gone.]
    3. **Which injectors, and what each does.** Candidates: stamina (longer sprint, faster refill), steady aim (longer breath, less sway), regen (slow HP back on non-blacked zones), stop bleeding, carry more weight, faster healing. [4–5 to start, each with one benefit and one side effect (tremor, stamina drain, slower aim, a little HP loss; never hunger or thirst, which the game has none of).]
    4. **Stacking:** the same one twice (refresh, extend or nothing), different ones together, an overdose rule? [Same one refreshes the timer; different ones stack; no overdose.]
    5. **Using them:** use time, can you move or aim while injecting, do they go in the heal picker or their own slot or button? The controller has no buttons left (PC controller notes). [Injectors ~1.5 s, pills ~2 s, walking allowed; they join the heal picker (hold heal), never the tap heal.]
    6. **Do enemies use them?** PMCs popping painkillers and a stim when hurt would make them tougher. [PMCs use painkillers only, later, in an AI session; scavs and Jug don't.]
    7. **HUD:** effect icons with time left, and a tell when one is about to end. [A row of small icons under the body with a ring for time left, blinking the last 10 s.]
    8. **Where they come from:** loot rarity, vendors, quests, Trauma bay crafting (hangar.md). [Painkillers common in medical loot and sold by the medic; injectors rare loot and craftable; none sold early.]
    9. **Duration ticks in the sim, not the client**, and effects end at extraction and death (nothing carries out of a raid). [Yes.] Zombies mode: behind a flag, off by default (zombies-left-alone).
- [ ] **PK-2. Timed effects and painkillers.** A sim system for timed effects on a character (start, tick, end, saved in state, no per-frame allocation), the effect kinds PK-1 settles for painkillers, the hook in `updateSway`, a painkiller item or two, use from the heal picker, item editor fields, tests.
  - **Read:** design/damage-and-health.md (Timed effects); tech/shared-sim.md; tech/items-and-inventory.md; tech/editors.md.
- [ ] **PK-3. Injectors.** The injectors PK-1 picks, their benefits and side effects on the PK-2 system, the HUD effect icons, item models in the house style, item editor fields, tests.
  - **Read:** design/damage-and-health.md (Timed effects); docs/props.md (item models); tech/editors.md.
- [ ] **PK-4. Into the game.** Loot tables, vendor stock, quests if any, and Trauma bay recipes if PK-1 says so.
  - **Read:** design/damage-and-health.md (Timed effects); hangar.md (Trauma bay).

## Replays: death replay and recorded sessions (planned 2026-11-12 with the user)
The sim runs at 30 ticks a second from inputs with seeded random numbers, but **bit-exact determinism was never required** (tech/shared-sim.md: the co-op host is authoritative), so replaying from inputs has to be made exact first, then kept exact by tests.

- [ ] **RP-1. Exact replays.** Find and remove what can make two runs of the same inputs differ (time read from the clock, `Math.random`, iteration over unordered collections, anything the client feeds back into the sim). A test runs raids twice from the same seed and inputs and compares a **state hash every second**. Then **a recording**: the raid's seed, content version and build, a full state snapshot at the start, the inputs per tick (compact: a few bytes a tick, changes only), and a state hash every second so a replay that drifts is caught where it drifts. **Known limit:** JavaScript engines may disagree on `Math.sin`, `Math.exp` and the like in the last bit, so an iPhone (Safari) recording may drift on a PC (Chrome or Node). Replays of iPhone recordings run in WebKit (Playwright), or the recording carries a full snapshot every 30–60 s to re-sync from.
  - **Read:** tech/shared-sim.md; tech/overview.md.
- [ ] **RP-2. Death replay.** When you die, watch the last **10–15 s** again from the killer's eyes (then from yours, a toggle), with the damage log's hits and zones beside it, then the post-raid screen. **It's the same recording as RP-1 and RP-3** (the user's note, 2026-11-12: one recording, the inputs that rebuild the whole match). Replaying from the raid's start would mean re-simulating up to 20 minutes at the moment you die, so the phone also keeps a snapshot every 5 s in a ring buffer as a shortcut to start from, then plays the recording's inputs from there with the same renderer. **Measure the snapshot first:** if it costs more than about 2 ms or allocates a lot on a phone, keep cheaper transform frames (positions, facing, pose, shots for characters near you) instead, which can't drift (a separate, local-only record; the uploaded recording stays inputs). Skippable, and off for zombies (leave zombies alone). In co-op, the host's state is what's replayed (later, with coop.md).
  - **Read:** design/damage-and-health.md (HUD, damage log); tech/client.md; RP-1's notes.
- [ ] **RP-3. Recorded sessions for debugging, monitoring and analytics.** Upload a raid's recording (RP-1) for a whole raid, then replay it on a dev machine to see a reported bug or a crash exactly. Sample a share of raids, plus every raid that hits an error or a slow frame. On the server: store them, an admin list with filters (map, build, device, errors), and a viewer. Analytics come from the same data (where people die, what kills them, how long raids last, extraction rates). **Before real users:** recordings are game inputs only, never the screen (the user's note, 2026-11-12), but they're still tied to an account, so the privacy policy (needed for accounts anyway) says they're kept for debugging and stats, with a retention limit (say 90 days). A consent prompt or opt-out isn't planned; check that's still right if analytics go beyond fixing and balancing the game, or for EU players. Upload size cap: gzip, and 20 minutes of inputs should be well under 1 MB.
  - **Read:** tech/server.md; tech/client.md; RP-1's notes.

## Scav runs (proposed 2026-11-12, design to confirm)
- [ ] **SR-1. Play a raid as a scav.** A random scav kit (from the scav loadouts), on a cooldown, so losing your gear never locks you out and you can learn a map for free. **To decide:** cooldown length; whether scavs treat you as one of them (and what breaks that: shooting a scav); which maps, spawn points and how late in the raid you join; whether PMCs are hostile (yes, as now); what you can take home (all of it to the stash, as in Tarkov); quests and XP on a scav run or not; whether the Hangar can shorten the cooldown. Reuses scav loadouts, spawns and the AI's sides.
  - **Read:** design/ai-scavs-pmcs-bosses.md; design/raids-and-maps.md; hangar.md.

## App Store and monetization (planned 2026-11-12 with the user; just before an App Store release)
The user's brief: **a few dollars** for extra vault squares, an extra stash page or containers, maybe other ideas. **No ads of any kind.** Opt-in ads for a convenience may come once there are a lot of players, **never forced**. Rules: design/overview.md → Monetization.
- [ ] **MZ-1. Settle what's for sale (design with the user, no code).** Write the answers into design/overview.md → Monetization and hangar.md, then rewrite MZ-2 onward to fit. **Conflicts with settled design to settle first:**
  - **Vault squares** are the one thing that survives death. hangar.md makes the Secure locker the most expensive module and "the only lasting advantage", and design/inventory-and-ui.md rules out extra vaults from quests ("the secure locker stays the one way to a bigger vault"). Selling them skips the top of the progression, matters in co-op, and would be pay-to-win in a future PvP mode (where Tarkov drew its worst criticism).
  - **Stash pages** are gated by the Stash module and bought with money, "one path, not two" (hangar.md). Selling one adds a second path.
  - **Containers:** item and ammo cases are ruled out (category pages replace them).
  - **Claude's suggestion:** sell what doesn't touch raids or progression: **cosmetics** (gun colors, outfits, lobby plinth and Hangar decor) and a **supporter pack**, plus at most **one extra stash page beyond the cap** (storage, not power). Keep the vault out of the store.
  - Also decide: prices and how many products; one-time purchases only (no subscriptions or loot boxes); whether the web/PC version sells too (Stripe), and that a purchase on one platform counts on the other.
- [ ] **MZ-2a. API and sign-in that work outside our own origin** (can be done any time; sooner is cheaper). An API base URL in the client, a bearer token for the app beside the web's cookie, CORS for `capacitor://localhost`. tech/overview.md → Platform.
- [ ] **MZ-2b. Client versions.** The client sends its version; the server refuses below a minimum and the app says to update. Decide how many versions content and save formats stay compatible for, and **stop wiping prod** from the first store release (migrations come back).
- [ ] **MZ-2c. The App Store build.** Capacitor with the built client bundled in (never loaded from our URL), landscape lock, status bar and home indicator hidden, safe areas, audio unlock and gamepad checked in WKWebView; Apple developer account, TestFlight. **Apple's rules:** a full game, not a website wrapper (guideline 4.2), no links out to web pages or payments; **account deletion in the app** (5.1.1(v)); a privacy policy and privacy labels (RP-3's recordings included); account recovery (email or Sign in with Apple), since a paid account behind a password with no reset is a support problem. **Read:** tech/overview.md → Platform; tech/server.md.
- [ ] **MZ-3. Purchases on the server.** In-app purchase through StoreKit (required for digital goods on iOS; check the current rules on linking out to web payments). The server checks every transaction with Apple (App Store Server API), handles refunds from Apple's server notifications, and has **Restore purchases**. **Purchases are stored apart from the profile and survive prod wipes** (no migrations for now, but paid items can't be wiped); a wipe gives them back on the fresh profile. Tests for granting, refunds and restore.
- [ ] **MZ-4. The store in the game.** A Store screen in the lobby, the products MZ-1 picks granted from purchases, admin tools to grant or revoke by hand, and a playthrough on TestFlight with sandbox purchases.
- **Later, not scheduled:** opt-in rewarded ads for a convenience (say a shorter Hangar craft or scav cooldown), only once there are a lot of players, never forced, never needed to progress. It would add an ad SDK, Apple's tracking prompt and privacy labels.

## After v1 (not scheduled)
- Co-op vs. AI, phones and PCs together (a player's device hosts, others connect over WebRTC; client movement prediction, shared loot rolls, quest items only for the holder). The plan, session by session, is [coop.md](coop.md).
- Weekly admin challenges (raid configs, publishing from the server without a redeploy).
- NPC flea market (explain it and decide first). Trading with friends.
- Gyro aiming, water slowing movement, more attachment slots.
- Inventory icons drawn from item models (left out of session 18b).

## Open questions
- **Container search time** (session 10): Tarkov reveals a container's items one by one. Not designed; containers open instantly for now.
- **Melee** (raised in session 9; the user's answer, 2026-10-26): there is a Tarkov-style knife attack with good damage, for raids where you bring nothing at all and for close quarters (design.md → Core loop → Knife). Built in session 10b.
- **Saved stashes after item changes** (session 18): shrinking an item can make a saved profile fail the server's checks, and the server then refuses every stash save for it. Before release, decide how to repair profiles when content changes (drop or move what no longer fits on load, say).
- **Silver Creek's PMCs late in the raid** (MT-9; eased 2026-11-11, when the map got edge waves and 3 squads: 0.8 PMCs a raid left at 15 minutes): with weak scavs they mostly lived (20 of 33 at 15 minutes) and leave by the ends' extractions at 75–90% of the raid, so a starter extracting late may meet a geared squad there. Fine as the map's danger, or keep Silver Creek's squads off the ends (their own extraction, or leaving earlier)?
