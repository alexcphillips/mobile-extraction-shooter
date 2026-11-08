# Northpoint second-floor stores

Directory for the user's review (2026-11-06). Every store is a normal, working place, furnished, with no loot except the laser tag prize crate. Pick stores here to rework into gun, jewellery and other high-value shops. Reworked so far: upper-s2 (gun store), upper-s4 (jewellery) and outer-store-9 (bank vault); see design.md → High-value stores.

In the map, each store's fittings are a group named `shop-<id>-<type>` inside `second-floor-shops`, so a rework can delete that one group and refit the room. Laser tag is its own group, `laser-tag-arena`.

**Shuttered and locked (2026-11-07, the user's call with 20-minute raids):** 16 of the 55 stores are shuttered and 3 more are locked, leaving 36 open to everyone. Shutters are plain boxes in `second-floor-shutters` over every door and window of the unit; a sealed unit's fittings group is deleted. A side door from a sealed unit into a neighbour gets a `chained-fire-door` instead. See design.md → Shuttered and locked stores.

| Store id | Type | Size (m) | Area | Position |
|---|---|---|---|---|
| laser-tag-arena | laser tag | 23 × 35 | 813 m² | east, outer edge |
| upper-s5 | department fashion | 22 × 18 | 380 m² | south east, above the ground floor stores |
| outer-store-11 | gym | 22 × 15 | 325 m² | north middle, outer edge |
| upper-s2 | gun store (reworked 2026-11-07, with a stock room behind) | 20 × 12 | 236 m² | south west, above the ground floor stores |
| outer-store-3 | music and games, locked: front shuttered, west alley door takes the music store key | 15 × 15 | 225 m² | west, outer edge |
| outer-store-14 | kids clothing | 12 × 18 | 221 m² | north east, outer edge |
| upper-s3 | medical clinic, locked: front shuttered, back door from the upper service hall takes the clinic key | 13 × 16 | 214 m² | south middle, above the ground floor stores |
| outer-store-1 | lighting and furniture | 13 × 15 | 195 m² | north west, outer edge |
| outer-store-12 | home goods | 14 × 14 | 193 m² | north east, outer edge |
| outer-store-9 | bank vault (reworked 2026-11-07) | 15 × 13 | 192 m² | north west, outer edge |
| outer-store-19 | shuttered (was grocery, 2026-11-07) | 17 × 11 | 191 m² | south west, outer edge |
| gap-store-3 | bookshop | 13 × 15 | 191 m² | south west, between ring and outer walkway |
| outer-store-7 | department fashion | 16 × 11 | 180 m² | north west, outer edge |
| outer-store-4 | sports store | 12 × 15 | 180 m² | west, outer edge |
| outer-store-25 | grocery | 13 × 13 | 175 m² | south east, outer edge |
| gap-store-2 | stationery | 11 × 16 | 174 m² | south west, between ring and outer walkway |
| outer-store-22 | menswear | 14 × 12 | 171 m² | south middle, outer edge |
| outer-store-20 | shoe store | 16 × 10 | 164 m² | south west, outer edge |
| store1-north | pet shop | 13 × 13 | 163 m² | west, between ring and outer walkway |
| outer-store-6 | gift shop | 13 × 12 | 160 m² | south west, outer edge |
| upper-s1 | mall management offices | 9 × 18 | 158 m² | south west, above the ground floor stores |
| gap-store-7 | shuttered | 13 × 12 | 156 m² | east, between ring and outer walkway |
| gap-store-21 | shuttered (was teen fashion, 2026-11-07) | 19 × 8 | 155 m² | north east, between ring and outer walkway |
| gap-store-4 | bank branch | 13 × 12 | 153 m² | east, between ring and outer walkway |
| outer-store-13 | shuttered (was coffee place, 2026-11-07) | 19 × 8 | 153 m² | north east, outer edge |
| outer-store-17 | travel agent | 9 × 16 | 149 m² | east, outer edge |
| upper-n1 | photo shop | 15 × 9 | 137 m² | north west, above the ground floor stores |
| upper-n3 | security office | 15 × 9 | 137 m² | north middle, above the ground floor stores |
| outer-store-23 | shuttered | 14 × 9 | 129 m² | south middle, outer edge |
| gap-store-12 | opticians | 14 × 9 | 126 m² | south west, between ring and outer walkway |
| gap-store-13 | shuttered (was sports bar, 2026-11-07) | 14 × 9 | 126 m² | south west, between ring and outer walkway |
| gap-store-15 | womenswear | 14 × 9 | 126 m² | south east, between ring and outer walkway |
| gap-store-8 | shuttered | 6 × 20 | 120 m² | south east, between ring and outer walkway |
| upper-n4 | cafe | 21 × 6 | 118 m² | north east, above the ground floor stores |
| gap-store-6 | cocktail bar | 10 × 11 | 116 m² | east, between ring and outer walkway |
| outer-store-24 | pizza place | 14 × 8 | 115 m² | south east, outer edge |
| upper-n2 | shuttered (was menswear, 2026-11-07) | 17 × 7 | 112 m² | north west, above the ground floor stores |
| gap-store-9 | beauty store | 12 × 9 | 109 m² | north west, between ring and outer walkway |
| gap-store-5 | pharmacy | 11 × 10 | 109 m² | east, between ring and outer walkway |
| gap-store-11 | shuttered (was gift shop, 2026-11-07) | 11 × 9 | 100 m² | north middle, between ring and outer walkway |
| gap-store-20 | bakery | 13 × 8 | 99 m² | north west, between ring and outer walkway |
| outer-store-10 | shuttered | 11 × 9 | 97 m² | north middle, outer edge |
| outer-store-5 | liquor store | 7 × 13 | 91 m² | south west, outer edge |
| store1-south | shuttered (was vacant, 2026-11-07) | 13 × 6 | 83 m² | west, between ring and outer walkway |
| outer-store-18 | key cutting and repairs, locked: front shuttered, side door from outer-store-17 takes the key cutter's key | 6 × 13 | 82 m² | south east, outer edge |
| gap-store-16 | shuttered (was florist, 2026-11-07) | 9 × 9 | 81 m² | west, between ring and outer walkway |
| gap-store-18 | barber | 9 × 9 | 81 m² | south east, between ring and outer walkway |
| gap-store-19 | shuttered | 9 × 9 | 81 m² | south east, between ring and outer walkway |
| upper-s4 | jewellery (reworked 2026-11-07) | 11 × 7 | 79 m² | south middle, above the ground floor stores |
| outer-store-21 | sushi place | 12 × 6 | 75 m² | south west, outer edge |
| outer-store-8 | juice bar | 11 × 7 | 75 m² | north west, outer edge |
| outer-store-26 | shuttered | 10 × 7 | 70 m² | south east, outer edge |
| outer-store-2 | shuttered | 7 × 10 | 70 m² | west, outer edge |
| gap-store-10 | watch boutique | 11 × 6 | 69 m² | north middle, between ring and outer walkway |
| gap-store-17 | shuttered | 6 × 9 | 58 m² | south west, between ring and outer walkway |
