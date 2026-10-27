import type { CompiledMap } from '../content/compile';
import type { EnemyLoot } from '../content/enemies';
import type { ItemDb } from '../content/items';
import type { LootTableDef } from '../content/loot-tables';
import { addItem, type Item } from '../inventory/grid';
import { byWeight, nextIntIn, type Rng } from '../rng';
import { createItem } from './create-item';
import { stow } from './gear';
import type { Character, SimState } from './state';

/*
 * Loot tables rolled when the raid starts (session 11), with the raid's RNG, so a seed
 * gives the same loot. Allocating is fine here: it happens once, at raid start or spawn.
 */

export type LootTables = ReadonlyMap<string, LootTableDef>;

function table(tables: LootTables, id: string): LootTableDef {
  const t = tables.get(id);
  if (!t) throw new Error(`no loot table "${id}"`);
  return t;
}

/** One item from a table, picked by weight, with its count rolled. */
export function rollItem(items: ItemDb, t: LootTableDef, rng: Rng): Item {
  const e = byWeight(rng, t.items);
  const count = e.count ? nextIntIn(rng, e.count[0], e.count[1]) : 1;
  return createItem(items, e.item, Math.max(1, count));
}

/** A table's items for one container: `rolls` of them. */
export function rollTable(items: ItemDb, t: LootTableDef, rng: Rng): Item[] {
  const out: Item[] = [];
  const n = nextIntIn(rng, t.rolls[0], t.rolls[1]);
  for (let i = 0; i < n; i++) out.push(rollItem(items, t, rng));
  return out;
}

/**
 * Fills every loot container placed from the map (placeLootContainers) from its marker's
 * loot table. What doesn't fit is left out.
 */
export function fillLootContainers(
  state: SimState,
  map: CompiledMap,
  items: ItemDb,
  tables: LootTables,
): void {
  const tableOf = new Map<string, string>();
  for (const m of map.markers) if (m.type === 'lootContainer') tableOf.set(m.id, m.lootTable);
  for (const l of state.loot) {
    const id = tableOf.get(l.id);
    if (id === undefined) continue;
    for (const item of rollTable(items, table(tables, id), state.rng)) {
      addItem(items, l.grid, item);
    }
  }
}

/**
 * Stows an enemy's loot in its pockets, rig and backpack: `rolls` items, each from a table
 * picked by its weight times the spawn's lootWeights for it (1 if not given). What doesn't
 * fit is left out. Call after its loadout, which gives it the rig and backpack.
 */
export function rollEnemyLoot(
  c: Character,
  items: ItemDb,
  tables: LootTables,
  loot: EnemyLoot | undefined,
  weights: Readonly<Record<string, number>> | undefined,
  rng: Rng,
): void {
  if (!loot) return;
  const options: { id: string; weight: number }[] = [];
  for (const [id, w] of Object.entries(loot.tables)) {
    const weight = w * (weights?.[id] ?? 1);
    if (weight > 0) options.push({ id, weight });
  }
  if (!options.length) return;
  const n = nextIntIn(rng, loot.rolls[0], loot.rolls[1]);
  for (let i = 0; i < n; i++) {
    stow(c, items, rollItem(items, table(tables, byWeight(rng, options).id), rng));
  }
}
