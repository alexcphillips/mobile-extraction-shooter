import type { CompiledMap } from '../content/compile';
import type { EnemyLoot } from '../content/enemies';
import type { ItemDb } from '../content/items';
import type { LootTableDef } from '../content/loot-tables';
import { addItem, type Item } from '../inventory/grid';
import { byWeight, chance, nextFloat, nextIntIn, type Rng } from '../rng';
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

/**
 * Puts a loose item on the ground at every lootSpawn marker that rolls its chance: one
 * item from its table (a loose spot ignores the table's rolls), lying at a random turn.
 * Of the spots sharing a `oneOf` name, only one picked at random is used.
 */
export function rollLootSpawns(
  state: SimState,
  map: CompiledMap,
  items: ItemDb,
  tables: LootTables,
): void {
  const groups = new Map<string, string[]>();
  for (const m of map.markers) {
    if (m.type !== 'lootSpawn' || m.oneOf === undefined) continue;
    const ids = groups.get(m.oneOf);
    if (ids) ids.push(m.id);
    else groups.set(m.oneOf, [m.id]);
  }
  const picked = new Set<string>();
  for (const ids of groups.values()) picked.add(ids[nextIntIn(state.rng, 0, ids.length - 1)]!);
  for (const m of map.markers) {
    if (m.type !== 'lootSpawn') continue;
    if (m.oneOf !== undefined && !picked.has(m.id)) continue;
    if (!chance(state.rng, m.chance ?? 1)) continue;
    state.ground.push({
      item: rollItem(items, table(tables, m.lootTable), state.rng),
      x: m.x,
      y: m.y,
      z: m.z,
      yaw: nextFloat(state.rng) * Math.PI * 2,
    });
  }
}
