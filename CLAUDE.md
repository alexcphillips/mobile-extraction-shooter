# mobile-extraction-shooter

A small Tarkov-style PvE extraction shooter that runs as a mobile web game (Add to Home Screen on iOS), with low-poly flat-color art like Unturned. It's a long-term project, not a throwaway experiment.

## Read before working
Read only what the task needs. The big docs are split by topic; open an index, then only the topic files the work touches.
- [docs/design.md](docs/design.md): index of game design decisions (topic files in `docs/design/`). These are settled, so don't re-argue them without a new reason.
- [docs/tech-stack.md](docs/tech-stack.md): index of architecture and technology choices (topic files in `docs/tech/`).
- [docs/roadmap.md](docs/roadmap.md): v1 scope and the open work, session by session. Find your session, read its **Read:** line, do it, then tick it off, record anything you decided, and move it to [docs/roadmap-done.md](docs/roadmap-done.md) (the finished sessions, for history only).
- [docs/props.md](docs/props.md): how to build props and prefabs in the house style (shapes, colors, collision, frame rules), and item models (frames, triangle budgets, the screenshot script).
- [docs/level-design.md](docs/level-design.md): what we look for in tactical layouts (exposure, lanes, sightlines, what the AI can reach), a review checklist, and how to check movement in the sim. Read it before laying out or reviewing an area. It applies to extraction maps only, not zombies or other modes.
- [docs/hangar.md](docs/hangar.md): the Hangar, the base between raids (modules, upgrades, crafting).
- [docs/coop.md](docs/coop.md): the co-op to-do (friends, party, raid server), in the same session format.

## Standing rules
- **PvE for now; a separate PvP mode may come later.** The user plans PvE and PvP modes one day, not soon (2026-11-05). Until then, co-op against AI with a friend is the most multiplayer there is: don't build PvP, anti-cheat, matchmaking or competitive netcode.
- **The game simulation in `packages/shared` must not depend on rendering or UI.** No three.js, React or DOM in it. It takes inputs and returns state at a fixed tick, so it can run on the co-op host (or a server) without changes.
- **Game content is data.** Maps, items, prefabs, loot tables, quests and vendors are JSON in `content/`, validated by schemas, with a format version number and migrations.
- **Phone performance is a requirement.** Keep draw calls low (merge static geometry by chunk), don't allocate per frame in hot loops, and test on a real iPhone.
- `/Users/acp/code/node/geo-game` is an unrelated project. Don't copy from it or use it as a reference.
- **American spelling** everywhere: code, content, UI text and docs (color, armor, center, meter, caliber, favorite, gray). Moved from British on 2026-11-11 with `scripts/american-spelling.mjs`, which can be re-run to catch strays.
- Record new decisions in the docs above as you make them, not only in chat, in the topic file they belong to.
- **Keep sessions lean on tokens.** Don't read whole docs or big content files (map JSON) to get your bearings: search, or query with a script. Use quiet test output. Keep roadmap notes short and put the detail in the topic docs.
