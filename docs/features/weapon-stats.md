# Weapon stats

What a gun is like to fight with, and how attachments change it. Players compare guns and parts on a phone screen, so a few stats stand for everything, each one readable as a bar. Every gun should feel different, and every part should be a trade-off you can read before you fit it.

## The stats

Shown on every gun and part, in this order:

| Stat | What it drives |
|---|---|
| Vertical recoil | How hard each shot kicks up |
| Horizontal recoil | How hard each shot kicks sideways |
| Stability | How much the view and gun jump per shot, on both axes |
| Handling | ADS speed, draw time, aimed sway, sprint-to-fire, ADS move speed and reload speed |
| Hip-fire | Spread when not aimed |
| Accuracy | Spread when aimed: precision, mostly a trait of the gun and its barrel |
| Range | How far its round keeps its damage, and where shots stop |
| Loudness | How far its shots are heard (AI hearing) |

## Rules

- **Every shown stat is points on 0–100** *(user's call)*. A gun's are its `stats`; attachments add or subtract points, they don't multiply, and the total is clamped to 0–100. The sim turns points into values through a curve per stat, so the curve and not the content decides what a point is worth.
- **Recoil, hip-fire, accuracy, range and loudness curves change by the same share per point** *(user's call)*, and every curve covers the same spread of values. A part's points then do the same to a light gun as a heavy one, and a point is worth the same on every one of these bars.
- **Bars read as named** *(user's call)*: more vertical recoil, horizontal recoil or loudness means more kick or noise. Hip-fire, accuracy, range, stability and handling read higher-is-better. The UI colors a part's +/- by whether it helps.
- **A part's change is shown on the gun it would go on.** In a gun's part picker, each choice (and taking the part off) lists what it does to that gun as it is: the change in points after the clamp, against the part it replaces. A part's own details show its points as they are.
- **Range points move where shots stop and stretch the round's falloff by the same share.** A gun's `barrelRange` (its own barrel against the round's reference) stays hidden; a fitted barrel's range points move it from there, so a barrel's points are relative to the gun's own barrel.
- **The gun's hidden traits stay per gun** and aren't shown: recoil recovery, kick angle and snap, stable-after round, fire rate. Points scale the kick; nothing changes these *(user's call: attachments don't touch recovery)*.
- **Handling is one number that drives all of its parts together** through fixed curves. A part that's "handier" makes ADS, draw, sway, sprint-to-fire, ADS move speed and reloads all better.
- **Draw time and aimed sway are Handling's** *(user's call)*. Sway moves where shots land, and Stability never does.
- **Reload time is the gun's own at its own handling.** Only handling points from attachments move it, so a gun's content reload time is what it reloads in bare.
- **Exceptions to Handling are named on the part** and shown as their own line in its details: a magnified optic's slower ADS (`aimTime`), a large magazine's slower reload. A heavy part that's otherwise ordinary (a foregrip, a drum's weight, a suppressor's front weight) costs handling points instead. Use one only when the part really is special in one way. If most parts start needing exceptions, revisit the aggregate.
- **Movement speed isn't Handling's job, except aimed.** Walking and sprint speed come from weight and gear burden, so a heavy gun isn't penalized twice; Handling only sets how much aiming slows you.
- **ADS move speed has a floor** *(user's call)* (`HANDLING.minAimMove`), so the heaviest builds can still strafe.
- **After a sprint the gun must come up before it fires.** A held trigger fires the moment it's up, and the view model shows it lowered until then.
- **A gun's own points and recovery are set for it as it comes**, with its factory parts. A part's points are relative to the factory part it replaces, so a part with no points is as good as the factory one.
- **A gun comes with its magazine and nothing else** *(user's call)*. Every other slot starts empty, and the gun's model draws its factory parts (stock, barrel, grip) until a part fills the slot. Factory parts aren't items: they have no points, are never found or sold, and can't come off. This keeps the inventory free of factory parts when a new gun is built out. Compact stocks are separate parts that trade control for handling.
- **A factory stock is in the gun's size and value.** A fitted stock's cells take the place of the factory stock's, and taking a fitted stock off puts the factory one back.
- **Stocks tame recoil with recoil and stability points.** A light stock trades some of that for handling.
- **Accuracy moves mainly with barrels.** Long or heavy barrels add accuracy and range and cost handling; short barrels do the reverse *(user's call)*. Barrels don't move hip-fire. Grips, stocks and foregrips don't touch accuracy; a few muzzles (chokes, a precision compensator) add a little.
- **Stability is one stat for both axes** *(user's call)*. It moves the view and the gun, not where the shot goes.
- **A folded stock and a laser switched off count as not fitted**: none of their points apply.
- **Any folded stock applies the fold change** *(user's call)* (`FOLDED_STOCK`): some extra mobility and a shorter gun, at a significant cost in recoil and stability that hurts mid-range fights. It's the same on every gun, factory stock or fitted. Compact stocks are a real alternative: more mobile than folding without its full loss of control. A factory stock folds on the gun's folding mount or its own fold. A stock going on or off unfolds the gun.
- **What a part fits** (`fitsIn`): the gun has a slot of its kind, and the gun is on the part's lists: a gun named in `weapons`, a gun whose `platform` is in `platforms`, or a gun whose `class` is in `classes`. With no list the part is universal. A magazine fits only a magazine-fed gun of its caliber, so one magazine can name a platform that mixes calibers.
- **A platform is a family whose parts swap** (`ar15`, `ak`), named on the gun. Parts for a family list the platform, so a new gun on it takes them all. Parts sorted by role, like optics kept off bolt-action rifles, list their guns, since a platform doesn't say what a gun is for. A gun doesn't need a platform.
- **A part never lists a gun its platforms or classes already cover**, and every platform or class it names must bring it at least one gun (`checkItems`).
- **Muzzles fit by class** *(user's call)*: rifle muzzles fit every long gun but shotguns, shotgun muzzles fit only shotguns, and pistols take only the suppressors meant for them.
- **A suppressor is a full cut in loudness, the same on every can** *(user's call)*: its other stats set it apart. A cut a few points deep wouldn't change what the AI hears. The shot sounds suppressed by that cut alone, whatever the part.
- **Muzzle brakes are louder** *(user's call)*: a brake gets one more step of control than a compensator or flash hider like it, paid for in loudness, so brakes are the most control and the loudest.
- **Accuracy points tighten a shotgun's pellets** *(user's call)*: a pellet round's spread scales by the same share as aimed spread, from `PELLET_SPREAD_AT`, so a choke's accuracy works on the pellets, which are far wider than any gun's aimed spread.
- **AI shoots under the same stats** as players, with its own recoil control on top (`sim/ai.ts`).
- **Every stat is editable in the item editor**, in the same session that adds it.

## Decisions

- **Points over multipliers**: a percentage per part can't be compared at a glance or added up on a phone card. Points add up, so the bar shows the gun as built, and the clamp keeps stacking in bounds. On a same-share curve, points stack exactly as multipliers did; the gain is readability, not less compounding.
- **Same share per point over linear curves**: guns' values are many times apart, so a fixed amount per point would barely touch a heavy gun and swamp a light one.
- **Handling is kept rather than split into its parts** *(user's call)*: one setting to tune instead of four per part across every attachment, and one bar on the card. Item details list what it works out to (seconds, %).
- **Parts meant for ADS speed or ADS move speed get handling points** *(user's call)*, not an exception of their own.
- **Recovery isn't shown or moddable** *(user's call)*: it's part of a gun's character. Parts meant to tame recoil over a burst use stability points instead.
- **Accuracy stays a stat** *(user's call)*: without aimed spread every gun's first aimed shot lands on the dot, and a DMR's edge at distance would come only from range. It's kept coarse enough to see at this game's distances.
- **The AR-15 platform is wide** *(user's call)*: every gun that takes an AR stock, not only true AR-15s. Its stocks fit all of them; barrels that don't fit every one list their guns.
- **ADS move speed and sprint-to-fire are mechanics, not only numbers**: they change how fights feel on a thumbstick, so they're tuned in play with the AI, not in content alone.

## Where it lives

- Code: `packages/shared/src/sim/weapons.ts` (`weaponStats`: a gun's stats with its parts), `packages/shared/src/content/items.ts` (schemas, `GUN_STATS`, `STAT_CURVES`, `HANDLING` and `STABILITY` curves, `statAt`, `pointsOf`), `packages/shared/src/sim/recoil.ts`, `packages/shared/src/sim/movement.ts`
- Content: `content/items/` (weapon and attachment items)
- UI: `packages/client/src/ui/stat-bars.tsx` (the bars and +/-, shared), `packages/client/src/ui/item-details.tsx`, the part picker in `packages/client/src/ui/raid-screen.tsx` (`PartChanges`), `packages/client/src/item-editor/panel.tsx`
- Review: `node scripts/weapon-stats.mjs [gun ...] [--against <dir|git-ref>]` prints every gun with its default parts, or what changed against other content
- Tests: `packages/shared/src/sim/points.test.ts` (curves, stacking), `packages/shared/src/sim/handling.test.ts`, `packages/shared/src/sim/weapons.test.ts`, `packages/shared/src/sim/recoil.test.ts`

## Open questions

- Perfect accuracy isn't reachable: 100 points is the curve's tightest, not zero. Fine for real guns; the admin spawner guns get a sliver of spread.
