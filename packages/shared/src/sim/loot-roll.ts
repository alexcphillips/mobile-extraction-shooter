import type { CompiledMap } from '../content/compile';
import type { EnemyLoot } from '../content/enemies';
import { caliberOf, itemDef, weaponDef, type ItemDb } from '../content/items';
import type { LootContainerDef } from '../content/loot-containers';
import type { LootTableDef } from '../content/loot-tables';
import type { LootMix } from '../content/schema';
import { addItem, type Item } from '../inventory/grid';
import { byWeight, chance, nextFloat, nextInt, nextIntIn, type Rng } from '../rng';
import { createItem } from './create-item';
import { createWeapon, type WeaponState } from './weapons';
import { stow } from './gear';
import { oneOfPicks, unitOf } from './spawn-roll';
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

/** A found gun's rounds: ammo of level LOOT_GUN_MAX_LEVEL or lower, common or uncommon. */
export const LOOT_GUN_MAX_LEVEL = 2;
const LOOT_GUN_RARITIES: ReadonlySet<string> = new Set(['common', 'uncommon']);

// The rounds a found gun can be loaded with, by caliber, per item database.
const lootRoundsCache = new WeakMap<ItemDb, Map<string, string[]>>();

/** The rounds a found gun of this caliber can come loaded with (see LOOT_GUN_MAX_LEVEL). */
export function lootRounds(items: ItemDb, caliber: string): readonly string[] {
  let by = lootRoundsCache.get(items);
  if (!by) {
    by = new Map();
    for (const def of items.values()) {
      if (def.type !== 'ammo' || def.level > LOOT_GUN_MAX_LEVEL) continue;
      if (!LOOT_GUN_RARITIES.has(def.rarity)) continue;
      const list = by.get(def.caliber);
      if (list) list.push(def.id);
      else by.set(def.caliber, [def.id]);
    }
    lootRoundsCache.set(items, by);
  }
  return by.get(caliber) ?? [];
}

/**
 * A gun found in a raid (2026-11-09): one full magazine of a round picked at random from
 * lootRounds for its caliber, whatever its own round is; empty if its caliber has none.
 */
export function createLootGun(items: ItemDb, id: string, rng: Rng): WeaponState {
  const rounds = lootRounds(items, caliberOf(items, weaponDef(items, id)));
  if (!rounds.length) {
    const gun = createWeapon(items, id);
    gun.mag = 0;
    return gun;
  }
  return createWeapon(items, id, [], rounds[nextInt(rng, rounds.length)]);
}

/** One item from a table, picked by weight, with its count rolled. A gun: createLootGun. */
export function rollItem(items: ItemDb, t: LootTableDef, rng: Rng): Item {
  const e = byWeight(rng, t.items);
  if (itemDef(items, e.item).type === 'weapon') return createLootGun(items, e.item, rng);
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

/** A loose spot's loot as a mix: its own, or its one table as a mix of one. */
export function spotMix(m: { lootTable?: string | undefined; mix?: LootMix | undefined }): LootMix {
  return m.mix ?? { tables: m.lootTable === undefined ? {} : { [m.lootTable]: 1 } };
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
 * item from its table, or from a table its mix picks (a loose spot ignores the table's
 * rolls), lying at a random turn. Of the spots and grouped copies sharing a `oneOf` name,
 * only the map's `lootGroups` pick of them (one if not given) are used.
 */
export function rollLootSpawns(
  state: SimState,
  map: CompiledMap,
  items: ItemDb,
  tables: LootTables,
): void {
  const picked = oneOfPicks(state.rng, map.markers, 'lootSpawn', map.lootGroups);
  for (const m of map.markers) {
    if (m.type !== 'lootSpawn') continue;
    if (m.oneOf !== undefined && !picked.has(unitOf(m))) continue;
    if (!chance(state.rng, m.chance ?? 1)) continue;
    const id = m.lootTable ?? spotTable(m.mix!, state.rng);
    if (id === NOTHING) continue;
    state.ground.push({
      item: rollItem(items, table(tables, id), state.rng),
      x: m.x,
      y: m.y,
      z: m.z,
      yaw: nextFloat(state.rng) * Math.PI * 2,
    });
  }
}

/** The table a loose spot's mix picks by weight, or NOTHING for its empty weight. */
function spotTable(mix: LootMix, rng: Rng): string {
  const options = Object.entries(mix.tables).map(([id, weight]) => ({ id, weight }));
  if (mix.empty) options.push({ id: NOTHING, weight: mix.empty });
  if (!options.length) return NOTHING;
  return options.length === 1 ? options[0]!.id : byWeight(rng, options).id;
}
