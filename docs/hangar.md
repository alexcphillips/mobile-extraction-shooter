# The Hangar

The player's base between raids: modules you upgrade with loot, which then craft gear over real time. Designed with the user on 2026-11-07, after Delta Force's Black Site and Tarkov's Hideout, under our own name and rules. The sessions to build it are in [roadmap.md](roadmap.md) → The Hangar.

## Why it exists
- **Every item has a use.** Without it, players learn to ignore most loot and hunt only cash and high-value gear. The Hangar turns low-tier items (bulbs, wires, tape, scrap, bolts) into upgrade milestones and crafting inputs.
- **Progress through bad runs.** Five deaths in a row still feel like progress if one early extract brought out the bolts the Power grid needed.
- **A reason to check in.** Crafts run in real time, also while the app is closed, which suits a phone.

## Rules (the user's calls)
- **The Hangar never changes your character, only what you can own.** No stats (stamina, strength and so on), and nothing from outside a raid boosts one. Only items such as future booster injectors change how you play, and those are lost like any other item. Storage and vault size are the only lasting advantages.
- **The Hangar doesn't print money.** No recipe outputs money, and there's no passive income module (no "Bitcoin farm").
- **Inputs can be anything, vendor stock included.**
- **Upgrades cost items; money may be added later.**
- **Placeholder costs:** every upgrade costs one bandage until the user hand-crafts the costs. The recipes in `content/recipes/` are placeholders too, from items that exist.
- **A page of module cards, not a 3D space**, like the vendors page. A static low-poly diorama you tap into (modular and industrial, in the props style) can come later.
- **Crafting:** minutes up to about 8 hours each; **one craft at a time per module**; finished output **waits in the module until collected**, so it's never lost to a full stash. **Upgrades are instant** (no build timer).
- **Few modules, 3 levels each** to start. More only when something needs them (the pillar "short and readable").

## Where required items come from
So a quest or an upgrade never stalls on one unlucky item (the user's ask, 2026-11-16; Claude's rule, the user to confirm when costs are set):
- **Every item a quest or a hangar upgrade or recipe needs is in at least 3 loot tables, on at least 2 maps, or is sold or crafted somewhere.** Check it when setting costs, and when writing quests (roadmap QO-11).
- **Rare items (loot weight about 1 or less) aren't required in quantity.** A table like `electrical` (15 items, 1–3 rolls) gives a weight-1 item in roughly 1 container in 25, so asking for two is a grind however many places hold it. Rare items speed things up or are asked for one at a time.
- **Each kind of loot has places spread by risk** on a map: one rich, contested place and smaller low-risk spots near the spawns (Silver Creek: design/maps/silver-creek.md → Electrical places).
- Today: `electrical-tape` is the only electrical item a recipe uses. `military-circuit-board` and `ev-battery` are in only two tables each.

## The modules
| Module | What it does |
|---|---|
| **Power grid** | The spine: its level caps every other module's level. No fuel to top up. |
| **Munitions bench** | Loot into higher-level rounds. Only ammo: guns and attachments are the Gun workshop's. |
| **Gun workshop** (`gun-workshop`) | Loot into guns, weapon attachments and magazines (magazines are attachments). Crafted guns come out empty, as vendors sell them. |
| **Armor bench** | Armor, rigs and backpacks, and better repair kits (ones that wear the max down less: design.md → Armor repair kits). |
| **Trauma bay** | Medkits and surgery kits from medical loot. Stimulants once boosters (temporary effects) exist. |
| **Stash** (`stash`) | Stash space. Its level unlocks the right to **buy** the next stash page (still paid for with money, so pages stay a money sink). Later levels unlock **category pages** in place of Tarkov-style cases. |
| **Secure locker** | The vault, **1×2 at the start (1 tall, 2 wide), up to 3×3**. Its upgrades are the most expensive of every module; the user will balance them. |

## Sizes (Claude's placeholders until the user balances them)
All in `PROFILE` (shared `profile.ts`). The starting stash and vault are small on purpose, and the modules grow them.
- Every bought stash page is **10×20**. Stash module level n lets you buy page n + 1 (100k, 250k, 500k), so level 3 allows the 4th and last page.
- Stash module level 3 also gives three **category pages, Guns, Ammo and Meds, 10×10 each**, free. They hold only their kinds (Guns: guns, melee and attachments; Ammo: rounds and grenades; Meds: meds and repair kits) and no bags.
- **Auto sort on close:** leaving the stash moves loose items from the bought pages onto their category page where there's room.
- Vault by Secure locker level: **2 wide × 1 tall**, then 2×2, 3 wide × 2 tall, 3×3.

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
- **Stimulants** (Trauma bay): wait for boosters.
- **Door codes:** need a mechanic (a code learned in the profile opening a coded door) and a map with a coded door.
- **Blueprints.** First guess: handing one in unlocks its recipe for good, not consumed per craft.

## Still open
- Material item names and loot tables: the user's.
- Upgrade costs: the user's, checked against "Where required items come from".
