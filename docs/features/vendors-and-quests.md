# Vendors and quests

Between raids, vendors are where loot turns into gear: you sell what you brought out, buy or barter for what you'll take in, and take quests that send you back into raids with a purpose. Progress with a vendor (its level) is the main thing that opens better gear, so a player's kit grows with how much they've done for each vendor, not just how much money they have. It follows Tarkov's traders.

## Rules

**Money and selling**
- Every item has a value, in its item file. Buying costs the value (times a vendor's markup); selling pays a fixed share of it, scaled down by condition (armor durability, med uses, kit points, key uses). A gun sells with its attachments and loaded rounds.
- **Nothing can be bought and sold back at a profit.** A bought gun, or one given as a reward, comes empty: its own magazine, no rounds, no attachments. Selling always pays less than buying.
- Selling is done from the stash, at one price whichever vendor buys. The knife can't be sold, nor a rig or backpack with anything in it that isn't being sold too.
- Cash from a raid goes straight into the balance at full value.

**Stock and levels**
- Stock is unlimited: money (or barter items) is the only limit.
- Each vendor has levels I to IV per account, everyone starting at I. Each level needs both **reputation** with that vendor (from its quests) and **money spent** with it, plus the levels before. A barter counts toward spending as if bought at its price.
- Each offer unlocks at a level. Offers above yours show locked, with the level, so you can see what's coming.
- **An item's rarity sets the level it unlocks at:** common at I, uncommon at II, rare at III, epic at IV. Legendary gear is sold only by `fence`, at IV; mythic gear is loot-only. A few exceptions are set by hand in the vendor files.
- `fence` marks its prices up and shows only part of its list at a time, a new pick on a fixed schedule, the same for everyone.

**Barters**
- An offer can cost items from the stash instead of money.
- Level I is always cash, so a broke player can always kit out. Better gear is bartered, and also sold for cash at the same level at full value; the barter stays the cheaper way. **Guns are the exception** *(user's call)*: only level I guns (the basic and scav guns) are sold for cash; every gun from level II up is barter-only.
- A barter only asks for items that are easy enough to get: in at least three loot tables, or sold for cash. Money, quest items and the item itself can't be inputs.
- **What a barter asks for** *(user's call)*: prefer multiples of one item over a mix (two RAM sticks rather than a RAM stick and a telescope). Prefer two kinds of item; three or four is fine; never more than four. **No filler:** every input should matter to the trade. Don't top up a valuable barter with a few cheap bits (duct tape, gear sets, screws) to get near the value; use more of a real input instead. Rare inputs can be asked for more than once. A barter's items are worth a bit less than the item, up to about its price; when loot is repriced, barters are re-fitted to match. The content test enforces the kind limit, the filler rule and the value range (`FILLER` and `BARTER_VALUE` in `packages/client/src/content.test.ts`).

**Quests**
- Each quest is given by a vendor and lives on that vendor's page (a Quests tab beside the Shop). There's no separate quests page.
- A quest opens once the quests it requires are done, which makes a chain per vendor. A quest can need a PMC level. Until both the level and the required quests are met, it shows locked and says what it's waiting for, so you can see what's coming, as with vendor offers.
- Objectives today:
  - **Investigate** a marker on a map. It counts even if you die later in that raid.
  - **Hand over** items from the stash between raids, optionally found-in-raid only.
  - **Extract** with a quest item. It spawns only while the quest is active, only for its holder, at one of its spots, picked each raid. Every quest item leaves the gear at the end of a raid, wanted or not, so none reaches the stash. The optional "find" step isn't saved: dying means finding it again.
- Rewards (money, items, reputation, XP) are claimed into the stash all at once, or not at all if there's no room.
- The server does all buying, selling, standing and quest progress; the client only shows it. A stash edit that changes standing is refused.

**PMC level**
- One XP total per account. Quests give the most XP; raids give some for kills and first searches, more for getting out, much less for a run-through.
- The PMC level only gates quests. Vendor levels go by reputation and spending alone.

## Decisions

- **Unlimited stock** *(user's call)*, for simplicity and stability.
- **One sell price for every vendor, selling from the stash** *(user's call)*, so there's no learning which vendor buys what: time between raids stays short and simple. When an auction house comes (with PvP, later), the vendor sell price becomes the minimum price there.
- **Vendor levels need reputation and spending, not a player level** *(user's call)*. The PMC level came later, for gating quests only.
- **One vendor per kind of gear**, so each vendor's id says what it sells *(user's call)*: `guns-ammo-vendor` (every gun, rounds, grenades), `attachments-vendor` (attachments, each gun's own magazine and stock, extended magazines), `armorer` (armor, helmets, plates, visors, headsets, night vision, rigs, backpacks), `medic` (meds), `fence` (loot, keys, rare finds, the top gear).
- **Guns are expensive** *(user's call)*: a gun's value scales with how good it is and how rare it is in loot, so the rarer and better a gun, the steeper its price rises. The commonest guns start around 10,000. `mcx-spear` is the most expensive gun, bartered for two gold watches, military binoculars and a waterjet head.
- **Barters replace crafting** *(user's call)*. They take any mix of items, not only loot for loot, and inputs needn't match what the barter gives. The sets are themed by hand anyway: armor takes framing and fiber, electronics go to optics and headsets, guns mostly take two of one valuable item.
- **Barter inputs can be any category, for any vendor** *(user's call)*. **A barter is a trade, not a recipe:** you're paying the vendor in goods, not building the item at the counter. So inputs don't have to match what's being sold: a gun can take craftwork or electronics rather than gun parts, and `medic` takes electronics on purpose because they're high value.
- **Hand-overs come from the stash**, not from extracting with the item *(user's call)*, so loot you already own counts.
- **Locked quests show**, with the level or quests they wait on *(user's call)*: seeing what's ahead is a reason to keep going.
- **Run-throughs are punished** as in Tarkov: getting out very early with little done halves XP and nothing comes out found-in-raid.

## Where it lives

- Code: `packages/shared/src/vendors.ts` (prices, levels, stock, barters, selling), `packages/shared/src/quests.ts` (quest status, hand-overs, rewards, raid progress), `packages/shared/src/xp.ts` (PMC level), `packages/shared/src/content/vendors.ts` and `packages/shared/src/content/quests.ts` (formats and content checks), `packages/server/src/vendors.ts`, `packages/server/src/quests.ts`.
- UI: `packages/client/src/ui/vendors-page.tsx`, `packages/client/src/ui/quests-page.tsx`, `packages/client/src/ui/raid-quests.tsx`.
- Content: `content/vendors/`, `content/quests/`. Item values and rarities are in `content/items/`.
- Tests: `packages/shared/src/vendors.test.ts`, `packages/shared/src/quests.test.ts`, `packages/client/src/content.test.ts` (barter inputs, kinds, filler and value, level I is cash).
- Tools: the quest editor (`packages/client/src/quest-editor/`).

## Planned: the quest objectives overhaul

This is the user's brief for the roadmap's QO sessions. QO-1 settles it with the user and then rewrites this section into rules.
- A quest becomes ordered **steps**, each step one or more objectives, and any objective can carry **conditions** (AND only).
- Objective kinds: **eliminate** (target, count, and conditions such as map or zone, weapon, attachments, worn gear, range, hit zone, own status); **hand over** (found-in-raid, any source, or money); **quest items** in a quest inventory they can't leave, used up by extracting or placing them; **discover** a zone, optionally surviving the raid; **place, mark or interact** (vendor-given items never lost on death, timed hold-to-use interactions); **weapon build** (stat thresholds and named attachments); **extract** by a given exit or with enough found-in-raid value; **progression** (reach a vendor level; quests can take reputation from another vendor); **search a place** (an alarmed room, a breached vault).
- Dying strips found-in-raid from everything gained that raid, the vault included. An item brought in already found-in-raid keeps it.
- **No refetching across maps** *(user's rule)*: in a chain across maps, getting the item out of the first map is a checkpoint, and dying on the second never sends you back. Refetching causes burnout.
