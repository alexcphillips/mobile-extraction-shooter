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
- **No part beaten outright:** where converting leaves a part worse in every stat than another for the same guns (usually once its accuracy is dropped), nudge one of them a step so each is a trade-off.
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

Guns named in the list stand for a type of gun, not that gun *(user's call)*: AR, AK, SMG or shotgun parts fit that type (the `ar15` or `ak` platform, or a class). Where a single gun is meant: Ci19 and K416 are standard ARs, so the `ar15` platform with the m416 as their gun; M7 is the mcx-spear; AN-94 is the `ak` platform; Vector is the k10.
