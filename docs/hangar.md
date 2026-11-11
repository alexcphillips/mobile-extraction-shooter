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
| **Intel desk** | Decrypts flash drives and hard drives found in raids, over real time, into keycards or door codes, or vendor reputation (blueprints are deferred). Contracts come here later. |
| **Quarters** | Stash space. Its level unlocks the right to **buy** the next stash page (still paid for with money, so pages stay a money sink; one path, not two). Later levels unlock **category pages** (ammo, meds, weapons) in place of Tarkov-style cases. |
| **Secure locker** | The vault: **1×2 at the start (1 tall, 2 wide), up to 3×3**. Its upgrades are the most expensive of every module; the user will balance them. |

**Starting sizes shrink (the user's plan):** the vault goes from 2×2 to 1×2, and the starting stash shrinks too, with Quarters growing it. Exact sizes are the user's to balance. Prod will be wiped before this ships (no users yet), so there's no migration for pages already bought.

**Built in H4 (2026-11-10), Claude's placeholders until the user balances them** (all in `PROFILE`, shared `profile.ts`):
- Every bought stash page is **10×20** (was 10×30). Quarters level n lets you buy page n + 1 (prices unchanged: 100k, 250k, 500k), so level 3 allows the 4th and last page.
- Quarters level 3 also gives the three **category pages, Guns, Ammo and Meds, 10×10 each**, free, all at once. They hold only their kinds (the stash chips' kinds: Guns takes guns, melee and attachments; Ammo takes rounds and grenades; Meds takes meds and repair kits) and no bags.
- **Auto sort on close:** leaving the stash moves loose items from the bought pages onto their category page where there's room. Nothing else is placed there by itself.
- Vault by Secure locker level: **2 wide × 1 tall**, then 2×2, 3 wide × 2 tall, 3×3.

**Built in H5 (2026-11-10), placeholders until the user balances them:**
- Two new drives, both loot in Electronics: **Flash drive** (uncommon, 2,500) and **Hard drive** (rare, 6,000). The older Encrypted drive stays plain loot. Drop weights added: flash drive in `electronics` (2) and `mall-office` (1), hard drive in `electronics` (0.5) and `pc-parts` (1).
- **Decrypt a flash drive** (Intel I, 1 h): kiln key 30%, music store key 15%, Quartermaster +0.05 rep 30%, Fence +0.05 rep 25%. **Decrypt a hard drive** (Intel II, 3 h): staff keycard 25%, clinic key 15%, key shop key 15%, Armourer +0.10 rep 25%, Gunsmith +0.10 rep 20%. Intel III halves decryption time.
- The user's calls: keys and keycards only (no door codes yet), rep set per recipe, contracts in their own session. The result is rolled when decryption starts and shown when collected.

**Built in H6 (2026-11-10): the Intel desk's contracts.** Timed jobs for a vendor. **The timer starts when you press Get contract** (the user's fix), so nobody misses a window for being away. The user's calls:
- **Rewards are items and rep** with the contract's vendor, never money (the Hangar doesn't print money).
- **A board of 3 a day, one running at a time.** The board is picked by the UTC day from what the desk's level allows, the same for everyone; a contract taken stays off it until the next day. Desk I, II and III each add harder ones.
- **Objectives:** kill N of a faction (scavs, PMCs or bosses), on one map or any; and hand over N of an item, **found in raid only**.
- **Out of time unfinished, it's lost with no penalty.** A raid that started inside the window counts even if it ends after. A finished contract never expires; it waits to be claimed.
- Claude's placeholders for the user to balance: six contracts (2–6 h windows, rewards of a few items and 0.05–0.15 rep), the board size, and the day boundary at UTC midnight.

## Deferred
- **More contracts:** ones needing new raid events ("intercept a supply drop within 3 hours") come with those events; extract objectives ("get out of Silver Creek twice") if wanted.
- **Trophy wall:** display only, no perks. Counters from raid results (PMC kills, boss kills, special doors opened) and a slot per red-tier item given up to it. No player kills until PvP exists.
- **Shooting range:** only once the Hangar is 3D.
- **Bio lab and hazard zones:** wait for a map that wants them. The idea: a named zone gets a hazard (radiation, or gas in a mall: a burst chemical store, a flooded basement); inside it you build up a dose that lowers your max HP until anti-rad meds clear it; a respirator or suit (an item, not a stat) slows it; the best loot sits behind it. The bio lab would craft filters and anti-rad meds.
- **Stimulants** (Trauma bay): wait for boosters.

- **Door codes** (deferred 2026-11-10, H5): the Intel desk gives keys and keycards for now. Codes need a mechanic (a code learned in the profile opening a coded door) and a map with a coded door.
- **Blueprints** (deferred 2026-11-10). First guess when they come: handing one in unlocks its recipe for good, not consumed per craft.
- **Where a double-tap into the stash goes once category pages exist:** auto sort on close handles it (the user, 2026-11-10); the specifics later.

## Still open
- Material item names and loot tables: the user's (2026-11-07).
