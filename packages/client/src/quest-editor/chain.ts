/*
 * The quest editor's rules for quest chains (2026-11-11), kept apart from the page so they
 * can be tested. Quests name each other only by id (`requires`), and players' progress is
 * kept by quest id and objective id, so:
 * - ids are made once, at random, and never shown to be typed or changed. A name is only
 *   what the quests page says, so it can change freely. A deleted id is never made again
 *   (random, not counted up), so a player's leftover progress on it can't wake up on a
 *   new quest.
 * - deleting a quest that others require passes its own requirements on to them, so
 *   A → B → C becomes A → C, and the chain still opens in the same order.
 */

/** What these rules need of a quest. */
export interface ChainQuest {
  id: string;
  vendor: string;
  requires?: readonly string[];
}

const hex = (digits: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(digits / 2)));
  return [...bytes]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, digits);
};

/** A new quest id, such as "q-3fa1c2", not one of `taken`. */
export function newQuestId(taken: (id: string) => boolean): string {
  for (;;) {
    const id = `q-${hex(6)}`;
    if (!taken(id)) return id;
  }
}

/** A new objective id, such as "o-9b2e", unique within its quest. */
export function newObjectiveId(taken: readonly string[]): string {
  for (;;) {
    const id = `o-${hex(4)}`;
    if (!taken.includes(id)) return id;
  }
}

/** Every quest that `id` requires, however far back (not itself). */
export function ancestors(quests: ReadonlyMap<string, ChainQuest>, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (q: string): void => {
    for (const r of quests.get(q)?.requires ?? []) {
      if (out.has(r)) continue;
      out.add(r);
      walk(r);
    }
  };
  walk(id);
  return out;
}

/** The quests that require `id` directly. */
export function unlocks(quests: ReadonlyMap<string, ChainQuest>, id: string): string[] {
  return [...quests.values()].filter((q) => q.requires?.includes(id)).map((q) => q.id);
}

/** Every quest that requires `id`, however far on (not itself). */
export function descendants(quests: ReadonlyMap<string, ChainQuest>, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (q: string): void => {
    for (const d of unlocks(quests, q)) {
      if (out.has(d)) continue;
      out.add(d);
      walk(d);
    }
  };
  walk(id);
  return out;
}

/** Whether `quest` may require `other`: not itself, not already, and no loop. */
export function canRequire(
  quests: ReadonlyMap<string, ChainQuest>,
  quest: string,
  other: string,
): boolean {
  if (quest === other || !quests.has(other)) return false;
  if (quests.get(quest)?.requires?.includes(other)) return false;
  return !ancestors(quests, other).has(quest);
}

/**
 * What deleting `id` does to the quests that required it: each, by id, with its new
 * requirements (the deleted one's in its place, without repeats or ones it already has
 * further back).
 */
export function rewireForDelete(
  quests: ReadonlyMap<string, ChainQuest>,
  id: string,
): Map<string, string[]> {
  const gone = quests.get(id);
  const out = new Map<string, string[]>();
  for (const d of unlocks(quests, id)) {
    const own = (quests.get(d)!.requires ?? []).filter((r) => r !== id);
    const next = [...own];
    for (const r of gone?.requires ?? []) if (!next.includes(r)) next.push(r);
    out.set(d, next);
  }
  return out;
}

/** Where a quest's card goes: its column (how deep in its chain) and row. */
export interface Placed {
  id: string;
  col: number;
  row: number;
}

export interface ChainLayout {
  cards: Placed[];
  /** Each vendor's lane, in vendor order: its first row and how many rows it has. */
  lanes: { vendor: string; row: number; rows: number }[];
  cols: number;
  rows: number;
}

/**
 * Lays the quests out as a lane per vendor (rows), in the order given, with each quest in
 * the column one past its deepest requirement, so every arrow points right. Quests in the
 * same lane and column stack, ordered by their first requirement's row, then name, so
 * chains stay level where they can. A lane has at least one row, for its + button.
 */
export function layoutChains(
  quests: ReadonlyMap<string, ChainQuest & { name?: string }>,
  vendors: readonly string[],
): ChainLayout {
  const depth = new Map<string, number>();
  const deep = (id: string, seen: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    // A loop (the save refuses those) or a missing quest stops here.
    if (seen.has(id)) return 0;
    seen.add(id);
    let d = 0;
    for (const r of quests.get(id)?.requires ?? []) {
      if (quests.has(r)) d = Math.max(d, deep(r, seen) + 1);
    }
    seen.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of quests.keys()) deep(id, new Set());

  // A vendor not in the list (a typo) gets a lane of its own at the end.
  const lanes = [...vendors];
  for (const q of quests.values()) if (!lanes.includes(q.vendor)) lanes.push(q.vendor);

  const cards: Placed[] = [];
  const rowOf = new Map<string, number>();
  const out: ChainLayout['lanes'] = [];
  let row = 0;
  // Lanes in order, columns left to right, so a quest's requirements in earlier lanes and
  // earlier columns already have rows when it's placed.
  for (const vendor of lanes) {
    const mine = [...quests.values()].filter((q) => q.vendor === vendor);
    const used = new Map<number, number>();
    const cols = [...new Set(mine.map((q) => depth.get(q.id)!))].sort((a, b) => a - b);
    for (const col of cols) {
      const here = mine
        .filter((q) => depth.get(q.id) === col)
        .map((q) => {
          const reqRows = (q.requires ?? [])
            .map((r) => rowOf.get(r))
            .filter((r): r is number => r !== undefined);
          return { q, key: reqRows.length ? Math.min(...reqRows) : Infinity };
        })
        .sort((a, b) => a.key - b.key || (a.q.name ?? a.q.id).localeCompare(b.q.name ?? b.q.id));
      for (const { q } of here) {
        const n = used.get(col) ?? 0;
        used.set(col, n + 1);
        rowOf.set(q.id, row + n);
        cards.push({ id: q.id, col, row: row + n });
      }
    }
    const rows = Math.max(1, ...used.values());
    out.push({ vendor, row, rows });
    row += rows;
  }
  const cols = Math.max(1, ...cards.map((c) => c.col + 1));
  return { cards, lanes: out, cols, rows: row };
}
