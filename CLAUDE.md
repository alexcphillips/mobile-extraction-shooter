# mobile-extraction-shooter

A small Tarkov-style PvE extraction shooter that runs as a mobile web game (Add to Home Screen on iOS), with low-poly flat-color art like Unturned. It's a long-term project, not a throwaway experiment.

## Read before working
Read only what the task needs. **Code and `content/` are the source of truth;** docs hold only purpose, rules and the reasons for decisions. Start at [docs/README.md](docs/README.md), which sets what gets written, lists the feature docs, and explains the `docs-archive` tag where the old docs live.
- [docs/features/](docs/features/): one doc per app feature, from the template. If a feature's doc isn't written yet, read the code and search the archive for that topic.
- [docs/roadmap.md](docs/roadmap.md): the open work, session by session. Find your session, read its **Read:** line, do it, then delete it from the roadmap and record any changed rules or decisions in the feature doc.
- [docs/props.md](docs/props.md): how to build props and prefabs in the house style (shapes, colors, collision, frame rules), and item models (frames, triangle budgets, the screenshot script).
- [docs/optics.md](docs/optics.md): how to build optics (sights and scopes) to the bar they need, from the reference build `asp-reflex-sight`. Read it before making or changing an optic.
- [docs/guns.md](docs/guns.md): how to build gun models and their iron sights to the bar they need, from the reference build `m416` and its script `scripts/gun-m416.mjs`: mounts, factory parts, iron sights, the gun kit, and checking every fit at the hip and aimed (`scripts/gun-shot.mjs`). Read it before making or changing a gun model.
- [docs/level-design.md](docs/level-design.md): what we look for in tactical layouts (exposure, lanes, sightlines, what the AI can reach), a review checklist, and how to check movement in the sim. Read it before laying out or reviewing an area. It applies to extraction maps only, not zombies or other modes.
- [docs/hangar.md](docs/hangar.md): the Hangar, the base between raids (modules and upgrades; crafting was removed for vendor barters).
- [docs/coop.md](docs/coop.md): the co-op to-do (friends, party, raid server), in the same session format.

## Standing rules
- **PvE for now; a separate PvP mode may come later.** The user plans PvE and PvP modes one day, not soon (2026-11-05). Until then, co-op against AI with a friend is the most multiplayer there is: don't build PvP, anti-cheat, matchmaking or competitive netcode.
- **The game simulation in `packages/shared` must not depend on rendering or UI.** No three.js, React or DOM in it. It takes inputs and returns state at a fixed tick, so it can run on the co-op host (or a server) without changes.
- **Game content is data.** Maps, items, prefabs, loot tables, quests and vendors are JSON in `content/`, validated by schemas, with a format version number and migrations.
- **Phone performance is a requirement.** Keep draw calls low (merge static geometry by chunk), don't allocate per frame in hot loops, and test on a real iPhone.
- `/Users/acp/code/node/geo-game` is an unrelated project. Don't copy from it or use it as a reference.
- **American spelling** everywhere: code, content, UI text and docs (color, armor, center, meter, caliber, favorite, gray). Moved from British on 2026-11-11 with `scripts/american-spelling.mjs`, which can be re-run to catch strays.
- **A map isn't ready for the user's eyes until the overlap check passes** (the user's rule, 2026-11-14). After making or changing any map, run `node scripts/map-overlaps.mjs <map>` (generators run it themselves) and fix everything it lists: furniture, walls or anything cutting into each other, into a floor, or ground showing through a floor. Don't ask the user to walk, review or approve a map (a bones review, a screenshot, "try it in the editor") while it exits non-zero; fix it first, even if the overlaps are in parts the session didn't touch. If a fix is out of the session's reach, say the map isn't ready and why, rather than handing it over.
- **No fake cover** (the user's rule, 2026-11-17): anything that looks structural collides. `node scripts/map-fake-cover.mjs <map>` lists drawn-only shapes that look like cover (generators print its summary); make them solid or list them, with the reason, in `scripts/mapkit/fake-cover-keep.json`. A report, not a gate like the overlap check.
- **Docs record purpose, rules and decisions, never values or history** (the user's call, 2026-11-17). Follow [docs/README.md](docs/README.md): no stats, prices, levels or weights copied from content; content is named by id, not display name; no dates or "was X". Update a feature doc when its purpose or rules change, not when values change. Run `node scripts/docs-check.mjs` after editing docs and fix its errors.
- **Keep sessions lean on tokens.** Don't read whole docs or big content files (map JSON) to get your bearings: search, or query with a script. Use quiet test output. Keep roadmap notes short and put the detail in the topic docs.
  - **Maps and prefabs:** never read a map or prefab file whole. Query them with the tools (`scripts/map-report.mjs`, `scripts/prefabs.mjs`) or a `node -e` over the JSON. Read a map's summary at the top of its design file, then search the rest. Report a check as one short table, not logs.
