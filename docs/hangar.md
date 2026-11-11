# The Hangar

The player's base between raids: modules you upgrade with loot, which then craft gear over real time. Designed with the user on 2026-11-07, after Delta Force's Black Site and Tarkov's Hideout, under our own name and rules. The sessions to build it are in [roadmap.md](roadmap.md) → The Hangar.

## Why it exists
- **Every item has a use.** Without it, players learn to ignore most loot and hunt only cash and high-value gear. The Hangar turns low-tier items (bulbs, wires, tape, scrap, bolts) into upgrade milestones and crafting inputs.
- **Progress through bad runs.** Five deaths in a row still feel like progress if one early extract brought out the bolts the Power grid needed.
- **A reason to check in.** Crafts run in real time, also while the app is closed, which suits a phone.

## Rules (the user's calls, 2026-11-07)
- **The Hangar never changes your character, only what you can own.** There are no stats (stamina, strength and so on) and nothing from outside a raid boosts one. Everyone is on an even footing; only items such as future booster injectors change how you play, and those are lost like any other item. Storage and vault size are the only lasting advantages.
- **The Hangar doesn't print money.** Its workshop and crafting stations turn looted items into gear; no recipe outputs money, and there's no passive income module (no "Bitcoin farm"). (Clarified by the user, 2026-11-10.)
- **Inputs can be anything, vendor stock included** (the user, 2026-11-10, replacing the earlier "nothing vendors sell" rule and its content test).
- **Upgrades cost items; money may be added later** (the user, 2026-11-10): we start with items only.
- **Placeholder costs:** every upgrade costs one bandage until the user hand-crafts the costs (2026-11-10). The four recipes in `content/recipes/` (H2) are placeholders too, from items that exist.
- **A page of module cards, not a 3D space.** The Hangar is a menu page like the vendors page. A static low-poly diorama you tap into (modular and industrial, in the props style) can come later.
- **Crafting:** minutes up to about 8 hours each; **one craft at a time per module**; finished output **waits in the module until collected**, so it's never lost to a full stash. **Upgrades are instant** (no build timer).
- **Few modules, 3 levels each** to start. More only when something needs them (the pillar "short and readable").

## The modules
| Module | What it does |
|---|---|
| **Power grid** | The spine: its level caps every other module's level. No fuel to top up. |
| **Munitions bench** | Loot into higher-level rounds, magazines and weapon attachments. |
| **Armour bench** | Armour, rigs and backpacks, and better repair kits (ones that wear the max down less: design.md → Armour repair kits). |
| **Trauma bay** | Medkits and surgery kits from medical loot. Stimulants once boosters (temporary effects) exist. |
| **Quarters** | Stash space. Its level unlocks the right to **buy** the next stash page (still paid for with money, so pages stay a money sink; one path, not two). Later levels unlock **category pages** (ammo, meds, weapons) in place of Tarkov-style cases. |
| **Secure locker** | The vault: **1×2 at the start (1 tall, 2 wide), up to 3×3**. Its upgrades are the most expensive of every module; the user will balance them. |

**Starting sizes shrink (the user's plan):** the vault goes from 2×2 to 1×2, and the starting stash shrinks too, with Quarters growing it. Exact sizes are the user's to balance. Prod will be wiped before this ships (no users yet), so there's no migration for pages already bought.

**Built in H4 (2026-11-10), Claude's placeholders until the user balances them** (all in `PROFILE`, shared `profile.ts`):
- Every bought stash page is **10×20** (was 10×30). Quarters level n lets you buy page n + 1 (prices unchanged: 100k, 250k, 500k), so level 3 allows the 4th and last page.
- Quarters level 3 also gives the three **category pages, Guns, Ammo and Meds, 10×10 each**, free, all at once. They hold only their kinds (the stash chips' kinds: Guns takes guns, melee and attachments; Ammo takes rounds and grenades; Meds takes meds and repair kits) and no bags.
- **Auto sort on close:** leaving the stash moves loose items from the bought pages onto their category page where there's room. Nothing else is placed there by itself.
- Vault by Secure locker level: **2 wide × 1 tall**, then 2×2, 3 wide × 2 tall, 3×3.

**Deleted on 2026-11-11 (the user's call): the Intel desk**, built in H5 and H6, with its contracts, its drive decryption and the Flash drive and Hard drive items. The user's reasons, so it isn't proposed again in another form:
- **Contracts were just quests from a different menu.** Timed jobs for a vendor with kill and hand-over objectives add nothing quests don't already do.
- **Decrypting drives was too shallow:** put an item in, wait, get a key or some rep.
- **Unlocking knowledge or map information** (the other idea for the desk) **goes against an even playing field** and isn't wanted, in the spirit of the first rule above.

Saved profiles lose its level, a decryption in it, the contracts, and any flash or hard drives (profile format 16). The Encrypted USB drive was always plain loot and stays.

## Deferred
- **Trophy wall:** display only, no perks. Counters from raid results (PMC kills, boss kills, special doors opened) and a slot per red-tier item given up to it. No player kills until PvP exists.
- **Shooting range:** only once the Hangar is 3D.
- **Bio lab and hazard zones:** wait for a map that wants them. The idea: a named zone gets a hazard (radiation, or gas in a mall: a burst chemical store, a flooded basement); inside it you build up a dose that lowers your max HP until anti-rad meds clear it; a respirator or suit (an item, not a stat) slows it; the best loot sits behind it. The bio lab would craft filters and anti-rad meds.
- **Stimulants** (Trauma bay): wait for boosters.

- **Door codes** (deferred 2026-11-10, H5): codes need a mechanic (a code learned in the profile opening a coded door) and a map with a coded door.
- **Blueprints** (deferred 2026-11-10). First guess when they come: handing one in unlocks its recipe for good, not consumed per craft.
- **Where a double-tap into the stash goes once category pages exist:** auto sort on close handles it (the user, 2026-11-10); the specifics later.

## Still open
- Material item names and loot tables: the user's (2026-11-07).
