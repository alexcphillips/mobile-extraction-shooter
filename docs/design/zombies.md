# Game design: Zombies (archived)

Part of the [design.md index](../design.md).

**Zombies mode was moved off the main line on 2026-11-13** (the user's call): it was hard to keep working while the rest of the game kept growing, and its developer hasn't worked on it since building it. All of its code, content and docs as they were then are on the **`zombies` branch** (pushed to origin, at commit `44927a4`, the merge of PR #24). Look there for anything about it; nothing on `main` builds or runs it.

What went with it, from the extraction game too (the user's call, same day): the zombies sim, rounds, points, wall guns, the mystery box, power-ups, barricades and door costs; and the items only it really used, with their systems: the crossbow, flamethrower, grenade launcher, Gale Cannon, Death Machine, ion blaster, zombie claws, molotov, flash grenade, C4, and incendiary rounds. With them went **fire** (burning, putting yourself out, fire on the map), **flash blindness**, **C4's detonator**, **guns that fire grenades** and the **one health bar**. Frag and smoke grenades stay.

If zombies comes back, start from that branch and bring it up to date with `main`; expect real work, since the shared sim has moved on.
