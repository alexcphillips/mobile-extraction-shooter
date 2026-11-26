# Docs: what we write and how

Docs hold what the code and content can't tell you: **what a feature is for, the rules it must keep, and why we chose it.** They don't mirror the code or content. Anything that can be read from `content/` or the code is left out, so it can't go stale.

## Where each kind of fact lives

| Fact | Lives in | Not in docs |
|---|---|---|
| Names, stats, prices, levels, weights, timings, who sells what | `content/` JSON | never copied into docs |
| How a system works in detail | the code and its tests | point to the file instead |
| Values you want to see as a table | a script that reads content (e.g. `scripts/map-report.mjs`) | generate it, don't write it |
| History (what it was, when it changed) | `git log` | no dates, no "was X" |
| Open work | [roadmap.md](roadmap.md) | finished sessions are deleted, not archived |
| Purpose, rules, decisions and their reasons | `docs/features/<feature>.md` | — |

## Writing rules for feature docs

1. **One feature per file**, written from [features/_template.md](features/_template.md). Keep it short: about 1,000 words at most. If it's longer, split the feature.
2. **No values from content or code.** No stats, prices, vendor levels, loot weights or timings. One exception: when the number *is* the decision ("no more than one fitted at a time"). Then name the file or constant that holds it.
3. **Refer to content by id, in backticks** (`attachments-vendor`, `laser-sight`), never by display name. Display names get renamed; ids are checked.
4. **No history.** No dates, "was", "renamed", "until", or "the user's request on…". State the decision as it stands now.
5. **Mark settled calls** with *(user's call)* so they aren't re-argued. Give the reason when it isn't obvious.
6. **Point to code by file path**, never by line number.
7. **Update the doc in the same session that changes a feature's purpose or rules.** A change that only moves values (tuning, new items, renames) doesn't touch docs.

## The check

`node scripts/docs-check.mjs` checks every doc and `CLAUDE.md`. Run it after editing docs; it exits non-zero on errors.
- **Everywhere:** dead links and file paths, and backticked ids that exist nowhere in content or code.
- **Feature docs also:** vendor display names (use the id), dates and history wording, and the template's required sections. It warns on number-heavy lines and long files.

## Features

Each feature doc gets written in its own session: read the code for that feature, then ask the user the "why"s. Before asking, search the archive (below) for that one topic. Status: ☐ not written · ◐ started · ☑ written.

- ☐ **combat**: guns, attachments, recoil, aiming, grenades, melee
- ☑ [weapon-stats](features/weapon-stats.md): the shown gun stats, points, and what attachments may change (split from combat)
- ☐ **damage-and-health**: hit zones, armor and plates, limbs, meds, timed effects
- ☐ **movement-and-controls**: movement, stamina, touch/keyboard/pad input
- ☐ **ai**: enemy types, squads, tactics, bosses, hearing
- ☐ **inventory-and-gear**: grids, worn gear and rigs, weight, packing, item details
- ◐ [looting](features/looting.md): loot tables, containers, rolls, item sources (started: only the rules settled so far)
- ☐ **raids**: raid flow, spawns, waves, zones, extraction, switches, doors
- ☑ [vendors-and-quests](features/vendors-and-quests.md): vendors, barters, rep and levels, quests, XP
- ☐ **hangar**: the base between raids
- ☐ **profile-and-server**: accounts, saves, wipes, social, admin
- ☐ **coop**: host, sync, party
- ☐ **hud-and-ui**: HUD, menus, stash screens
- ☐ **rendering-and-performance**: rendering, chunk merging, the phone budget
- ☐ **audio**
- ☐ **tutorial**
- ☐ **editors**: map, item, loot, quest, sound editors, layout board
- ☐ **content-pipeline**: formats, schemas, compile, bundling
- ☐ **maps/<map>**: one per playable map, covering its layout intent and areas
  - ◐ [maps/port](features/maps/port.md): the six-party harbor map (bones built)

## Other docs (older format, to be trimmed)

These come from before this system. They are kept because no code holds what's in them, but they still carry values and history. Trim them to the rules above when a session touches one.
- [roadmap.md](roadmap.md): open work.
- [props.md](props.md): the house style for props and item models.
- [optics.md](optics.md): how to build optics to the bar they need (the reference build, anatomy, budget, aimed checks, reticles).
- [level-design.md](level-design.md): what we look for in tactical layouts.
- [coop.md](coop.md): the co-op plan.
- [hangar.md](hangar.md): the Hangar plan. Partly stale (crafting was removed for barters).

## The archive

The old docs (the design and tech folders, roadmap-done, the two indexes and the map docs) were deleted and are kept under the git tag `docs-archive`. Search them for one topic at a time, never in bulk; they're often out of date, so check what they say against the code:

```sh
git grep -n -i "<topic>" docs-archive -- docs
git show docs-archive:docs/design/combat.md | grep -n -i -A3 "<topic>"
```

A roadmap **Read:** line that names an old doc (`design/…`, `tech/…`) means that file in the archive, until the feature doc exists.
