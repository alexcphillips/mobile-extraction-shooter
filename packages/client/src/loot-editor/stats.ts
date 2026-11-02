import { type ItemDb, type LootTableDef } from '@mes/shared';

/*
 * What a loot table gives, worked out rather than rolled, for the loot editor: the odds of
 * each item and what a container or a loose spot is worth on average. It follows
 * sim/loot-roll.ts: a container picks `rolls` items (each by weight, with replacement), a
 * loose spot one. What doesn't fit a container is left out in a raid, which this ignores.
 */

export interface EntryStats {
  item: string;
  /** The chance one pick is this item. */
  pick: number;
  /** The chance a container with this table holds at least one. */
  container: number;
  /** How many come in one pick, on average. */
  count: number;
  /** What one pick of it is worth (its value times its count). */
  value: number;
  /** Its share of the table's value per pick. */
  share: number;
}

export interface TableStats {
  entries: EntryStats[];
  /** Items in a container, on average. */
  rolls: number;
  /** What a pick, so a loose spot that rolls, is worth on average. */
  perPick: number;
  /** What a container is worth on average. */
  perContainer: number;
}

/** A table's odds and values. Items not in `items` count as worth nothing. */
export function tableStats(t: LootTableDef, items: ItemDb): TableStats {
  const total = t.items.reduce((sum, e) => sum + e.weight, 0);
  const [lo, hi] = t.rolls;
  const rolls = (lo + hi) / 2;
  const entries = t.items.map((e): EntryStats => {
    const pick = total > 0 ? e.weight / total : 0;
    const def = items.get(e.item);
    // As rollItem: a count of 0 still gives one.
    let count = 1;
    if (e.count) {
      const [a, b] = e.count;
      count = 0;
      for (let n = a; n <= b; n++) count += Math.max(1, n);
      count /= b - a + 1;
    }
    // Each number of rolls from lo to hi is as likely.
    let none = 0;
    for (let n = lo; n <= hi; n++) none += Math.pow(1 - pick, n);
    return {
      item: e.item,
      pick,
      container: 1 - none / (hi - lo + 1),
      count,
      value: (def?.value ?? 0) * count,
      share: 0,
    };
  });
  const perPick = entries.reduce((sum, e) => sum + e.pick * e.value, 0);
  for (const e of entries) e.share = perPick > 0 ? (e.pick * e.value) / perPick : 0;
  return { entries, rolls, perPick, perContainer: perPick * rolls };
}
