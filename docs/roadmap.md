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
See design.md → Raids and maps → Silver Creek for the layout and the user's calls (a Customs-style rectangle about 320 × 150 m, spawns at both ends and extracts at the far end, trees kept to the edges, five river crossings, three landmarks). Sketch: https://claude.ai/artifact/9v38f2y7U7tuf5cdKBxc84. As with Northpoint, the user places spawns and loot, and the bones are approved before detail. The sketch still shows a church; it's now the fire lookout, office and sheds (MT-3).

- 12 finished sessions in [roadmap-done.md](roadmap-done.md). v1 of the map is built; it hasn't been played yet.

Later, not counted in v1 of the map:
- [ ] **MT-13. Conditional extracts:** the train (power it at the engine shed; switches already exist), the paid log truck, the raft. Water that slows you and splashes, if wanted then.
  - **Read:** design/raids-and-maps.md (extractions, switches); tech/content-formats.md.

## After v1 (not scheduled)
- Co-op vs. AI, phones and PCs together (a player's device hosts, others connect over WebRTC; client movement prediction, shared loot rolls, quest items only for the holder). The plan, session by session, is [coop.md](coop.md).
- Weekly admin challenges (raid configs, publishing from the server without a redeploy).
- NPC flea market (explain it and decide first). Trading with friends.
- Gyro aiming, water slowing movement, more attachment slots.
- Inventory icons drawn from item models (left out of session 18b).

## Open questions
- **Container search time** (session 10): Tarkov reveals a container's items one by one. Not designed; containers open instantly for now.
- **Melee** (raised in session 9; the user's answer, 2026-10-26): there is a Tarkov-style knife attack with good damage, for raids where you bring nothing at all and for close quarters (design.md → Core loop → Knife). Built in session 10b.
- **Temporary effects** (the user wants them, 2026-10-26): painkillers and similar. Not scheduled.
- **Saved stashes after item changes** (session 18): shrinking an item can make a saved profile fail the server's checks, and the server then refuses every stash save for it. Before release, decide how to repair profiles when content changes (drop or move what no longer fits on load, say).
- **Silver Creek's PMCs late in the raid** (MT-9): with weak scavs they mostly live (20 of 33 at 15 minutes) and leave by the ends' extractions at 75–90% of the raid, so a starter extracting late may meet a geared squad there. Fine as the map's danger, or keep Silver Creek's squads off the ends (their own extraction, or leaving earlier)?
