# The Hangar

The player's base between raids: modules you upgrade with loot for stash and vault space. **It doesn't craft** (crafting was deleted on 2026-11-17: Removed: crafting, below). Designed with the user on 2026-11-07, after Delta Force's Black Site and Tarkov's Hideout, under our own name and rules. The sessions to build it are in [roadmap.md](roadmap.md) → The Hangar.

## Why it exists
- **Every item has a use.** Without it, players learn to ignore most loot and hunt only cash and high-value gear. The Hangar turns low-tier items (bulbs, wires, tape, scrap, bolts) into upgrade milestones; vendor barters (design/quests-and-vendors.md → Barters) turn loot into gear.
- **Progress through bad runs.** Five deaths in a row still feel like progress if one early extract brought out the bolts the Power grid needed.

## Rules (the user's calls)
- **The Hangar never changes your character, only what you can own.** No stats (stamina, strength and so on), and nothing from outside a raid boosts one. Only items such as future booster injectors change how you play, and those are lost like any other item. Storage and vault size are the only lasting advantages.
- **The Hangar doesn't print money.** There's no passive income module (no "Bitcoin farm").
- **Inputs can be anything, vendor stock included.**
- **Upgrades cost items; money may be added later.**
- **Placeholder costs:** every upgrade costs one bandage until the user hand-crafts the costs.
- **A page of module cards, not a 3D space**, like the vendors page. A static low-poly diorama you tap into (modular and industrial, in the props style) can come later.
- **Upgrades are instant** (no build timer).
- **Few modules, 3 levels each** to start. More only when something needs them (the pillar "short and readable").

## Where required items come from
So a quest or an upgrade never stalls on one unlucky item (the user's ask, 2026-11-16; Claude's rule, the user to confirm when costs are set):
- **Every item a quest, a hangar upgrade or a barter needs is in at least 3 loot tables, on at least 2 maps, or is sold somewhere.** Check it when setting costs, and when writing quests (roadmap QO-11).
- **Rare items (loot weight about 1 or less) aren't required in quantity.** A table like `electrical` (15 items, 1–3 rolls) gives a weight-1 item in roughly 1 container in 25, so asking for two is a grind however many places hold it. Rare items speed things up or are asked for one at a time.
- **Each kind of loot has places spread by risk** on a map: one rich, contested place and smaller low-risk spots near the spawns (Silver Creek: design/maps/silver-creek.md → Electrical places).
- `military-circuit-board` and `ev-battery` are in only two tables each.

## The modules
| Module | What it does |
|---|---|
| **Power grid** | The spine: its level caps every other module's level. No fuel to top up. |
| **Stash** (`stash`) | Stash space. Each level **gives** the next stash page with the upgrade (no separate purchase; the user's call). The stash's + next to its page tabs opens the Hangar on this module. Later levels unlock **category pages** in place of Tarkov-style cases. |
| **Secure locker** | The vault, **1×2 at the start (1 tall, 2 wide), up to 3×3**. Its upgrades are the most expensive of every module; the user will balance them. |

## Sizes (Claude's placeholders until the user balances them)
All in `PROFILE` (shared `profile.ts`). The starting stash and vault are small on purpose, and the modules grow them.
- Every plain stash page is **10×20**. Stash module level n gives page n + 1, so level 3 gives the 4th and last page. A profile always has exactly the pages its level gives: the server adds missing ones when it loads or upgrades a profile, and refuses a save with more or fewer.
- Stash module level 3 also gives three **category pages, Guns, Ammo and Meds, 10×10 each**, free. They hold only their kinds (Guns: guns, melee and attachments; Ammo: rounds and grenades; Meds: meds and repair kits) and no bags.
- **Auto sort on close:** leaving the stash moves loose items from the plain pages onto their category page where there's room.
- Vault by Secure locker level: **2 wide × 1 tall**, then 2×2, 3 wide × 2 tall, 3×3.

## Removed: crafting (the user's call, 2026-11-17)
The Gun workshop, Armor bench, Trauma bay and Munitions bench are gone, with recipes and crafting (profile format 23 drops `crafts` and their levels). The reason, so it isn't proposed again in another form: **it duplicated the vendors.** Every recipe made something a vendor sold, and turning loot into gear is the job of vendor barters (design/quests-and-vendors.md → Barters). Better repair kits, stimulants and higher-level rounds come from barters or loot.

## Removed: the Intel desk (the user's call, 2026-11-11)
Its contracts, drive decryption and the Flash drive and Hard drive items are gone. The reasons, so it isn't proposed again in another form:
- **Contracts were just quests from a different menu.**
- **Decrypting drives was too shallow:** put an item in, wait, get a key or some rep.
- **Unlocking knowledge or map information goes against an even playing field.**

The Encrypted USB drive is plain loot and stays.

## Deferred
- **Trophy wall:** display only, no perks. Counters from raid results (PMC kills, boss kills, special doors opened) and a slot per red-tier item given up to it. No player kills until PvP exists.
- **Shooting range:** only once the Hangar is 3D.
- **Bio lab and hazard zones:** wait for a map that wants them. A named zone gets a hazard (radiation, or gas in a mall); inside it a dose builds that lowers your max HP until anti-rad meds clear it; a respirator or suit (an item, not a stat) slows it; the best loot sits behind it. The bio lab would craft filters and anti-rad meds.
- **Door codes:** need a mechanic (a code learned in the profile opening a coded door) and a map with a coded door.

## Still open
- Material item names and loot tables: the user's.
- Upgrade costs: the user's, checked against "Where required items come from".
