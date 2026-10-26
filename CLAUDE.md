# mobile-extraction-shooter

A small Tarkov-style PvE extraction shooter that runs as a mobile web game (Add to Home Screen on iOS), with low-poly flat-colour art like Unturned. It's a long-term project, not a throwaway experiment.

## Read before working
- [docs/design.md](docs/design.md): game design decisions. These are settled, so don't re-argue them without a new reason.
- [docs/tech-stack.md](docs/tech-stack.md): architecture and technology choices.
- [docs/roadmap.md](docs/roadmap.md): v1 scope and the plan, session by session. Find your session, do it, then tick it off and record anything you decided.

## Standing rules
- **PvE only, never PvP.** Co-op against AI with a friend is the most multiplayer there will be. Don't build anti-cheat, matchmaking or competitive netcode.
- **The game simulation in `packages/shared` must not depend on rendering or UI.** No three.js, React or DOM in it. It takes inputs and returns state at a fixed tick, so it can run on the server for co-op later without changes.
- **Game content is data.** Maps, items, prefabs, loot tables, quests and vendors are JSON in `content/`, validated by schemas, with a format version number and migrations.
- **Phone performance is a requirement.** Keep draw calls low (merge static geometry by chunk), don't allocate per frame in hot loops, and test on a real iPhone.
- `/Users/acp/code/node/geo-game` is an unrelated project. Don't copy from it or use it as a reference.
- Record new decisions in the docs above as you make them, not only in chat.
