import { questsFor } from '../quests';
import { containerMix } from '../sim/loot-roll';
import type { CompiledMarker } from './compile';
import type { EnemyDef, LoadoutDef } from './enemies';
import type { LootContainerDef } from './loot-containers';
import type { LootTableDef } from './loot-tables';
import type { QuestDef, QuestObjective } from './quests';
import type { VendorDef } from './vendors';
import type { ItemDb } from './items';

/*
 * Where an item comes from and what wants it (UX-2, 2026-11-08), for its details: worked
 * out from content, never written by hand, so it can't go stale. Later, Hangar recipes go
 * in both (hangar.md).
 */

/** What the index reads. `maps` are the raids' maps, by their raid's name. */
export interface SourceContent {
  items: ItemDb;
  lootTables: ReadonlyMap<string, LootTableDef>;
  lootContainers: ReadonlyMap<string, LootContainerDef>;
  enemies: ReadonlyMap<string, EnemyDef>;
  loadouts: ReadonlyMap<string, LoadoutDef>;
  vendors: Iterable<VendorDef>;
  quests: readonly QuestDef[];
  maps: readonly { id: string; name: string; markers: readonly CompiledMarker[] }[];
}

export interface ItemSource {
  /** Container kinds' names it can roll in, most placed first. */
  containers: string[];
  /** The maps it can lie loose on. */
  loose: string[];
  /** Enemy types that can wear or carry it. */
  enemies: string[];
  /** Vendors that sell it, at the level they sell it from. */
  vendors: { vendor: string; level: number }[];
  /** Quests that give it as a reward. */
  rewards: string[];
  /** Quest items: the maps they lie on, for which quest. */
  questSpots: { map: string; quest: string }[];
}

export interface ItemUsage {
  /** Quest objectives that want it (to hand over, or bring out). */
  quests: { quest: QuestDef; objective: QuestObjective }[];
}

const empty = (): ItemSource => ({
  containers: [],
  loose: [],
  enemies: [],
  vendors: [],
  rewards: [],
  questSpots: [],
});

/** Every item's sources at once (each item with none is left out). */
export function sourceIndex(c: SourceContent): ReadonlyMap<string, ItemSource> {
  const out = new Map<string, ItemSource>();
  const of = (item: string): ItemSource => {
    let s = out.get(item);
    if (!s) out.set(item, (s = empty()));
    return s;
  };
  const tableItems = (id: string): readonly string[] =>
    c.lootTables.get(id)?.items.map((e) => e.item) ?? [];

  // Containers: how many of each kind could roll each item, to list the commonest first.
  const placed = new Map<string, Map<string, number>>();
  const loose = new Map<string, Set<string>>();
  for (const map of c.maps) {
    for (const m of map.markers) {
      if (m.type === 'lootContainer') {
        const kind = c.lootContainers.get(m.container);
        const mix = containerMix(m, c.lootContainers);
        if (!kind || !mix) continue;
        const seen = new Set<string>();
        for (const t of Object.keys(mix.tables)) for (const i of tableItems(t)) seen.add(i);
        for (const i of seen) {
          let kinds = placed.get(i);
          if (!kinds) placed.set(i, (kinds = new Map()));
          kinds.set(kind.name, (kinds.get(kind.name) ?? 0) + 1);
        }
      } else if (m.type === 'lootSpawn') {
        for (const i of tableItems(m.lootTable)) {
          let maps = loose.get(i);
          if (!maps) loose.set(i, (maps = new Set()));
          maps.add(map.name);
        }
      }
    }
  }
  for (const [i, kinds] of placed)
    of(i).containers = [...kinds].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  for (const [i, maps] of loose) of(i).loose = [...maps];

  for (const e of c.enemies.values()) {
    const has = new Set<string>();
    for (const [t, w] of Object.entries(e.loot?.tables ?? {}))
      if (w > 0) for (const i of tableItems(t)) has.add(i);
    const l = c.loadouts.get(e.loadout);
    for (const w of l?.weapons ?? []) {
      has.add(w.item);
      const gun = c.items.get(w.item);
      if (w.ammo) for (const a of w.ammo) has.add(a.item);
      else if (gun?.type === 'weapon') has.add(gun.ammo);
      for (const a of w.attachments ?? []) has.add(a.item);
    }
    for (const list of [l?.helmets, l?.bodyArmour, l?.rigs, l?.backpacks, l?.grenades])
      for (const o of list ?? []) if (o.item) has.add(o.item);
    for (const group of l?.meds ?? []) for (const o of group) if (o.item) has.add(o.item);
    for (const i of has) of(i).enemies.push(e.name);
  }

  for (const v of c.vendors)
    for (const o of v.sells) of(o.item).vendors.push({ vendor: v.name, level: o.level ?? 1 });

  for (const q of c.quests) {
    for (const r of q.rewards.items) {
      const rewards = of(r.item).rewards;
      if (!rewards.includes(q.name)) rewards.push(q.name);
    }
    for (const o of q.objectives) {
      if (o.type !== 'extract') continue;
      const map = c.maps.find((m) => m.id === o.map)?.name ?? o.map;
      of(o.item).questSpots.push({ map, quest: q.name });
    }
  }
  // Content checks already refuse unknown ids; this keeps a half-loaded editor safe.
  for (const i of out.keys()) if (!c.items.has(i)) out.delete(i);
  return out;
}

/** What wants an item. */
export function itemUsage(quests: readonly QuestDef[], item: string): ItemUsage {
  return { quests: questsFor(quests, item) };
}

/** Whether a source has anything in it. */
export function hasSource(s: ItemSource | undefined): s is ItemSource {
  return (
    !!s &&
    (s.containers.length > 0 ||
      s.loose.length > 0 ||
      s.enemies.length > 0 ||
      s.vendors.length > 0 ||
      s.rewards.length > 0 ||
      s.questSpots.length > 0)
  );
}
