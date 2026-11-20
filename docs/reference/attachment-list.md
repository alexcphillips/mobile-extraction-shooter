# Attachment list (design input)

The user's list of attachments to build, by slot, for the AT sessions in [roadmap.md](../roadmap.md). The marks are relative intent, not values: convert them with the rules below, then content is the source of truth. Delete each slot's section once its session has built it.

## Converting the marks

- **Points:** + is 3, ++ is 6, +++ is 9, ++++ is 12; − the same taken off. Tune from there in play.
- **Control** is recoil: vertical and horizontal recoil both down by the points (more control is fewer recoil points). V control is vertical recoil only, H control horizontal.
- **Stability, firing stability and camera stability** are all Stability (one stat). Where a part lists more than one, use the largest, not the sum.
- **ADS speed and ADS move speed** are Handling (the user's call: folded in, no exception). Where a part lists handling too, use the largest.
- **Hip accuracy** is Hip-fire. **Aiming spread** is Accuracy; where a part lists both accuracy and aiming spread, use the largest. **Suppression** is a suppressor's full cut in loudness (features/weapon-stats.md), not points per +.
- **Accuracy follows the barrel rule** (features/weapon-stats.md), not the list: long and heavy barrels add accuracy, short ones take it off. Stocks, grips and foregrips don't touch accuracy, so drop theirs.
- **Dropped, no mechanic:** hide muzzle flash, movement speed, jumping accuracy.
- **Extended mag capacity** is the `magazine` mod (extra rounds).
- **No free upgrades:** a part with only pluses gets a small cost (a few handling or stability points), so each part is a trade-off. Parts that convert to the same points are merged into one.
- **Compatibility:** universal fits any gun with the slot; platform-specific fits a platform; weapon-specific lists its gun.

| Slot | Compatibility |
|---|---|
| Optics | Mostly universal |
| Muzzles | Mostly universal, some platform-specific |
| Foregrips | Mostly universal |
| Barrels | Mostly weapon- or platform-specific |
| Stocks | Mostly platform-specific |
| Stock kits | Platform-specific |
| Rear grips | Mostly universal, some platform-specific |

Guns named in the list that aren't in the game stand for ours *(user's call)*: Ci19 and K416 are standard ARs, so the `ar15` platform with the m416 as their gun; M7 is the mcx-spear; AN-94 is the `ak` platform; Vector is the k10.

## Barrels

Ci19:

- CQB Assault Barrel: ++ control, +++ handling, ++ accuracy, −−− stability
- Field Standard Barrel: +++ range, +++ control
- Precision Long Barrel: +++ range, +++ control, ++ stability, −−− handling, −− accuracy
- Lightweight Carbon Barrel: +++ range, +++ control, −−− handling, −− accuracy

MP5:

- Recon Extended Barrel: +++ range, +++ control
- CQB Lightweight Barrel: ++ control, ++++ handling, ++ accuracy, −−− stability
- Tactical Balanced Barrel: + control, + range, + handling, + stability

AN-94:

- Rapid Assault Barrel: ++ control, ++++ handling, + accuracy, −−− stability
- Heavy Precision Barrel: ++++ range, ++++ control, ++ stability, −−− handling, −− accuracy

MP7:

- Chromeline Extended Barrel: ++++ range, +++ control, +++ stability, ++ movement speed, −− jumping accuracy penalty
- Featherweight Barrel: ++ control, ++++ handling, ++ accuracy, −−− stability
- Longstrike Barrel: ++++ range, ++++ control, ++ stability, −−−− handling, −− accuracy
- Standard Reinforced Barrel: + range, ++ control

Shotgun:

- Extended Heavy Barrel: ++++ range, ++ accuracy, ++++ extended mag capacity, −−−− handling

Better shotguns:

- CQB Breacher Barrel: ++++ control, +++ handling, −− accuracy
- Longbore Barrel: ++++ control, + accuracy, −− handling
- Competition Short Barrel: ++++ control, + handling, + accuracy, −− aiming spread

K416:

- Heavy Precision Barrel (a second one by this name: rename it): + range, ++ control
- Compact Assault Barrel: ++ control, ++++ handling, ++ accuracy, −−− stability
- Tactical Extended Barrel: +++ range, +++ control
- Heavy Long Barrel: ++++ range, ++++ control, ++ stability, −−−− handling, −− accuracy

## Stocks

M416:

- Standard Tactical Stock: ++ control
- Reinforced Rail Stock: ++ control, +++ stability, − handling
- Precision Support Stock: ++ control, ++ stability, ++ accuracy, − handling
- Enhanced Combat Stock: + control, +++ handling, + stability, + ADS move speed, − accuracy
- Lightweight Buffer Stock: + control, +++ handling, + accuracy, ++ ADS move speed, −−− stability
- Heavy Duty Tactical Stock: +++ control, ++ stability, −− handling
- Skeleton Precision Stock: +++ handling, +++ stability, −− control, −− accuracy
- Stability Core Stock: ++ control, +++ stability, −−− handling
- Lightweight Skeleton Stock: +++ control, +++ handling, −−− stability
- Rapid Response Stock: ++ control, +++ ADS move speed
- Reinforced Core Stock: +++ control
- M4 Extended Buffer Stock: ++++ handling, ++ accuracy, −−− control, −− stability
- Compact Mobility Stock: ++ ADS move speed
- Field Tactical Stock: ++ control

Seen on the AN-94:

- Rapid Adjust Stock: ++++ handling, +++ ADS move speed, −−− stability
- AK Lightweight Skeleton Stock: ++++ handling, −− control, −− stability
- Standard Core Stock: + control, + stability

MP7, Vector:

- Compact End Plate: ++++ handling, ++ accuracy, −−−− control, −− stability

P90:

- Reinforced End Pad: ++++ control, ++ handling

## Stock kits

A stock with a built-in foregrip: fitted, the foregrip slot can't be used.

- Integrated Precision Stock: ++++ control, + accuracy, ++ ADS move speed, ++++ ADS speed, −−− stability
- Heavy Integrated Stock: ++++ control, ++++ stability, −−− handling

## Rear grips

Ci19:

- Ergonomic Precision Grip: + handling, ++++ firing camera stability, ++++ firing stability
- Heavy Duty Combat Grip: +++ control, +++ stability, −− handling
- Lightweight Combat Grip: ++ control, ++++ handling, −− stability

M7 battle rifle:

- Reinforced Battle Grip: ++ control, ++ handling
- Modular Tactical Grip: + control, + handling
- Heavy Support Grip: + control, + handling, + stability
- Ergonomic Combat Grip: ++ control, ++++ handling, −− stability
- Standard MOE Grip: ++ control, ++ stability
- Lightweight Ergonomic Grip: ++ handling

AN-94:

- Heavy Recoil Grip: ++++ control
- Ribbed Tactical Grip: ++ control, ++ handling
- AK Lightweight Grip: ++ control, ++++ handling, −− stability
- AK Standard Grip: ++ control
- AK Precision Grip: ++ stability

MP7:

- Reinforced Stability Grip: +++ control, +++ stability, −− handling
- Balanced Tactical Grip: + control, + stability, + handling
