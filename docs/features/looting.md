# Looting

What you find in a raid is the point of going in. Loot tables decide what each container, stash and body can hold, so a search should feel like it belongs to the place (a fridge has food, a server room has PC parts) and good finds should feel earned.

_Started from a few settled rules; the rest of this feature gets written in its own session (docs/README.md → Features)._

## Rules

- **Rarity is a value tier, not a drop chance.** A table picks by weight alone. Rarity says roughly what an item is worth; its value says where it sits inside that tier. Within one rarity in a table, a pricier item is never likelier than a cheaper one. Across rarities nothing is implied: a top epic can drop less often than a legendary beside it (`graphics-card`).
- A loot item's value sits inside its rarity's value band (`LOOT_VALUE_BANDS`, checked when content loads).
- Every loot item drops somewhere: it's in at least one loot table, or it's a quest or vendor-only item on purpose.
- Tables hold what belongs to the place. Cash is not electronics loot.
- **Mythic valuables, and legendary and mythic paintings, are loose loot only** *(user's call)*: never in a container or on a body. Epic and lower paintings may roll in containers.
- Common items are the floor, not the bulk: a category doesn't need many of them.
- **No more than 3 filing cabinets in one room** *(user's call)*, unless there's a good reason and the user has approved it. Drawer after drawer of documents makes searching dull and floods a map with one kind of loot.
- **Weapon crates go only in key high-risk places** *(user's call)*: places that are contested or held by the AI, never on a spawn's doorstep. Ammo crates can be spread more widely, at places where someone would keep rounds (a hunter's cabin, a scav post, a sniper's perch).

## Decisions

- **Weights scale with value inside a rarity** *(user's call)*. A rare, wanted item should be a real find even inside its tier, and two items of one rarity aren't equally likely just because they share it. Gear (guns, ammo, armor, attachments) is left out: its rarity sets vendor levels, and its weights are set by hand.
- **The top tiers serve separate pools** *(user's call)*: some legendary electronics are PC and computing parts and some are military, so moving legendaries down a tier would thin out either the PC containers or the military ones.
- **Medical containers mix consumables with medical loot items** *(user's call)*: a medical crate, cabinet or cart holds medkits and the like as well as the medical valuables, through a mix with `each`, so one search can turn up both. Each kind has its own table for what belongs to the place (a wall cabinet holds pills and small kit, an EMS bag field kit, a crash cart ward equipment).
- **Grid electrical is not office electrical** *(user's call)*: a substation or switch room rolls the `substation` table (relays, breakers, conduit, cords, insulation, inverter boards, rarely a traction battery), not `electrical`, whose PC and appliance boards belong in offices, shops and homes. Computer parts at a grid site need a reason.
- **Backpacks and rigs have separate rarity scales** *(user's call)*: the item editor fills in a bag's rarity from the cells it holds, and a backpack holds far more than a rig, so one scale made a mid-size pack mythic. `BACKPACK_RARITY_CELLS` and `BAG_RARITY_CELLS` in `items.ts`. The smallest backpack holds 6 cells *(user's call)*.

## Where it lives

- Code: `packages/shared/src/content/loot-tables.ts` (table format), `packages/shared/src/sim/loot-roll.ts` (rolling), `packages/shared/src/content/items.ts` (`LOOT_VALUE_BANDS`), `packages/shared/src/content/item-sources.ts` (where an item can come from).
- Content: `content/loot-tables/`, `content/loot-containers/`, item rarities and values in `content/items/`.
- Tests: `packages/shared/src/sim/loot-roll.test.ts`, `packages/client/src/content.test.ts` (weights fall with value inside a rarity), `scripts/mapkit/loot-rules.test.mjs` (what may never roll in a container or on a body).
