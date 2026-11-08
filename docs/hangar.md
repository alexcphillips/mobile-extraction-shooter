# The Hangar

The player's base between raids: modules you upgrade with loot, which then craft gear over real time. Designed with the user on 2026-11-07, after Delta Force's Black Site and Tarkov's Hideout, under our own name and rules. The sessions to build it are in [roadmap.md](roadmap.md) → The Hangar.

## Why it exists
- **Every item has a use.** Without it, players learn to ignore most loot and hunt only cash and high-value gear. The Hangar turns low-tier items (bulbs, wires, tape, scrap, bolts) into upgrade milestones and crafting inputs.
- **Progress through bad runs.** Five deaths in a row still feel like progress if one early extract brought out the bolts the Power grid needed.
- **A reason to check in.** Crafts run in real time, also while the app is closed, which suits a phone.

## Rules (the user's calls, 2026-11-07)
- **The Hangar never changes your character, only what you can own.** There are no stats (stamina, strength and so on) and nothing from outside a raid boosts one. Everyone is on an even footing; only items such as future booster injectors change how you play, and those are lost like any other item. Storage and vault size are the only lasting advantages.
- **Loot into gear, never money from nothing.** Recipes turn loot into items, never into money directly, and there's no passive income module (no "Bitcoin farm").
- **Inputs are things vendors don't sell.** Upgrade costs and recipe inputs are loot that no vendor offers (the user will not have vendors sell the industrial or household tables). A content test checks no input is on any vendor's list, so a vendor rework can't quietly make a recipe a money pump. Vendors' current offers aren't a guide: the user is reworking them.
- **A page of module cards, not a 3D space.** The Hangar is a menu page like the vendors page. A static low-poly diorama you tap into (modular and industrial, in the props style) can come later.
- **Built after the AI rework**, before co-op.
- **Crafting:** minutes up to about 8 hours each; **one craft at a time per module**; finished output **waits in the module until collected**, so it's never lost to a full stash. **Upgrades are instant** (no build timer).
- **Few modules, 3 levels each** to start. More only when something needs them (the pillar "short and readable").

## The modules
| Module | What it does |
|---|---|
| **Power grid** | The spine: its level caps every other module's level. No fuel to top up. |
| **Munitions bench** | Loot into higher-level rounds, magazines and weapon attachments. |
| **Armour bench** | Armour, rigs and backpacks, and better repair kits (ones that wear the max down less: design.md → Armour repair kits). |
| **Trauma bay** | Medkits and surgery kits from medical loot. Stimulants once boosters (temporary effects) exist. |
| **Intel desk** | Decrypts flash drives and hard drives found in raids, over real time, into keycards or door codes, vendor reputation, or blueprints. Contracts come here later. |
| **Quarters** | Stash space. Its level unlocks the right to **buy** the next stash page (still paid for with money, so pages stay a money sink; one path, not two). Later levels unlock **category pages** (ammo, meds, weapons) in place of Tarkov-style cases. |
| **Secure locker** | The vault: **1×2 at the start (1 tall, 2 wide), up to 3×3**. Its upgrades are the most expensive of every module; the user will balance them. |

**Starting sizes shrink (the user's plan):** the vault goes from 2×2 to 1×2, and the starting stash shrinks too, with Quarters growing it. Exact sizes are the user's to balance. Prod will be wiped before this ships (no users yet), so there's no migration for pages already bought.

## Deferred
- **Contracts** (Intel desk): "intercept a supply drop within 3 hours" style missions with heavy rewards. **The timer starts when you press Get contract** (the user's fix), so nobody misses a window for being away. Ones that reuse what exists ("kill N PMCs on Northpoint") can come with the Intel desk; ones needing new raid events (supply drops) come later.
- **Trophy wall:** display only, no perks. Counters from raid results (PMC kills, boss kills, special doors opened) and a slot per red-tier item given up to it. No player kills until PvP exists.
- **Shooting range:** only once the Hangar is 3D.
- **Bio lab and hazard zones:** wait for a map that wants them. The idea: a named zone gets a hazard (radiation, or gas in a mall: a burst chemical store, a flooded basement); inside it you build up a dose that lowers your max HP until anti-rad meds clear it; a respirator or suit (an item, not a stat) slows it; the best loot sits behind it. The bio lab would craft filters and anti-rad meds.
- **Stimulants** (Trauma bay): wait for boosters.

## Still open (first guesses, settle in the sessions)
- Whether upgrades cost money as well as items (first guess: items, plus some money as a sink).
- **Blueprints:** first guess, handing one in unlocks its recipe for good (a loot purpose for rare finds), not consumed per craft.
- Category pages: what a double-tap into the stash does when a category page exists (first guess: the matching category page, then the general pages).
- Material item names and loot tables: the user's (2026-11-07).
