import type { CompiledMap } from '../content/compile';
import type { EnemyLoot } from '../content/enemies';
import type { ItemDb } from '../content/items';
import type { LootContainerDef } from '../content/loot-containers';
import type { LootTableDef } from '../content/loot-tables';
import type { LootMix } from '../content/schema';
import { addItem, type Item } from '../inventory/grid';
import { byWeight, chance, nextFloat, nextIntIn, type Rng } from '../rng';
import { createItem } from './create-item';
import { stow } from './gear';
import { oneOfPicks } from './spawn-roll';
import type { Character, SimState } from './state';

/*
 * Loot tables rolled when the raid starts (session 11), with the raid's RNG, so a seed
 * gives the same loot. Allocating is fine here: it happens once, at raid start or spawn.
 */

export type LootTables = ReadonlyMap<string, LootTableDef>;
export type LootKinds = ReadonlyMap<string, LootContainerDef>;

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

/** Where a container's loot comes from (2026-11-02). */
export interface ContainerLoot {
  container: string;
  lootTable?: string | undefined;
  mix?: LootMix | undefined;
}

/** A container's mix: its own, its one table, else its kind's; undefined if none. */
export function containerMix(c: ContainerLoot, kinds: LootKinds): LootMix | undefined {
  if (c.mix) return c.mix;
  if (c.lootTable !== undefined) return { tables: { [c.lootTable]: 1 } };
  return kinds.get(c.container)?.loot;
}

/** The empty pick in a mix's options: no table has an empty id. */
const NOTHING = '';

/**
 * A container's items from a mix. Without `each`, one pick (a table or nothing) for the
 * whole container, then that table's rolls; with it, the rolls of a table picked by
 * weight, then a pick for every item, so the empty weight leaves single items out. A
 * mix of one table rolls the same as that table did before mixes.
 */
export function rollMix(items: ItemDb, tables: LootTables, mix: LootMix, rng: Rng): Item[] {
  const options = Object.entries(mix.tables).map(([id, weight]) => ({ id, weight }));
  const all = mix.empty ? [...options, { id: NOTHING, weight: mix.empty }] : options;
  // A mix with every table taken out and no empty weight holds nothing.
  if (!all.length) return [];
  const pick = (): string => (all.length === 1 ? all[0]!.id : byWeight(rng, all).id);
  if (!mix.each) {
    const id = pick();
    return id === NOTHING ? [] : rollTable(items, table(tables, id), rng);
  }
  if (!options.length) return [];
  const t = table(tables, options.length === 1 ? options[0]!.id : byWeight(rng, options).id);
  const out: Item[] = [];
  const n = nextIntIn(rng, t.rolls[0], t.rolls[1]);
  for (let i = 0; i < n; i++) {
    const id = pick();
    if (id !== NOTHING) out.push(rollItem(items, table(tables, id), rng));
  }
  return out;
}

/**
 * Fills every loot container placed from the map (placeLootContainers) from its marker's
 * loot (containerMix). What doesn't fit is left out.
 */
export function fillLootContainers(
  state: SimState,
  map: CompiledMap,
  items: ItemDb,
  tables: LootTables,
  kinds: LootKinds,
): void {
  const mixOf = new Map<string, LootMix>();
  for (const m of map.markers) {
    if (m.type !== 'lootContainer') continue;
    const mix = containerMix(m, kinds);
    if (!mix) throw new Error(`loot container ${m.id}: no loot, and its kind has none`);
    mixOf.set(m.id, mix);
  }
  for (const l of state.loot) {
    const mix = mixOf.get(l.id);
    if (mix === undefined) continue;
    for (const item of rollMix(items, tables, mix, state.rng)) addItem(items, l.grid, item);
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
  const picked = oneOfPicks(state.rng, map.markers, 'lootSpawn');
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
