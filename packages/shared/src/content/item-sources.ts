import { questsFor } from '../quests';
import { containerMix, spotMix } from '../sim/loot-roll';
import type { CompiledMarker } from './compile';
import type { EnemyDef, LoadoutDef } from './enemies';
import type { HangarModuleDef } from './hangar';
import type { LootContainerDef } from './loot-containers';
import type { LootTableDef } from './loot-tables';
import type { QuestDef, QuestObjective } from './quests';
import type { VendorDef } from './vendors';
import type { ItemDb } from './items';

/*
 * Where an item comes from and what wants it (UX-2, 2026-11-08), for its details: worked
 * out from content, never written by hand, so it can't go stale. Hangar upgrade costs go in
 * its uses.
 */

/** The Hangar's content, for the upgrades an item is in. */
export interface HangarContent {
  modules: ReadonlyMap<string, HangarModuleDef>;
}

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
  /** Vendors that sell it, at the level they sell it from; `barter` if traded for items. */
  vendors: { vendor: string; level: number; barter?: true }[];
  /** Quests that give it as a reward. */
  rewards: string[];
  /** Quest items: the maps they lie on, for which quest. */
  questSpots: { map: string; quest: string }[];
}

export interface ItemUsage {
  /** Quest objectives that want it (to hand over, or bring out). */
  quests: { quest: QuestDef; objective: QuestObjective }[];
  /** Vendor barters that take it: the vendor's name, its level, what it gives and how many it takes. */
  barters: { vendor: string; level: number; item: string; count: number }[];
  /** Hangar upgrades that cost it: each module's name with how many each level takes. */
  upgrades: { module: string; levels: { level: number; count: number }[] }[];
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
        for (const i of Object.keys(spotMix(m).tables).flatMap(tableItems)) {
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
    for (const list of [l?.helmets, l?.headsets, l?.bodyArmor, l?.rigs, l?.backpacks, l?.grenades])
      for (const o of list ?? []) if (o.item) has.add(o.item);
    for (const group of l?.meds ?? []) for (const o of group) if (o.item) has.add(o.item);
    for (const i of has) of(i).enemies.push(e.name);
  }

  for (const v of c.vendors)
    for (const o of v.sells)
      of(o.item).vendors.push({
        vendor: v.name,
        level: o.level ?? 1,
        ...(o.barter && { barter: true as const }),
      });

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

/** What wants an item: quests, and vendors' barters and the Hangar's upgrades if given. */
export function itemUsage(
  quests: readonly QuestDef[],
  item: string,
  hangar?: HangarContent,
  vendors: Iterable<VendorDef> = [],
): ItemUsage {
  const barters: ItemUsage['barters'] = [];
  for (const v of vendors)
    for (const o of v.sells) {
      const b = o.barter?.find((x) => x.item === item);
      if (b) barters.push({ vendor: v.name, level: o.level ?? 1, item: o.item, count: b.count });
    }
  const upgrades: ItemUsage['upgrades'] = [];
  if (hangar) {
    for (const m of hangar.modules.values()) {
      const levels: { level: number; count: number }[] = [];
      m.levels.forEach((l, i) => {
        const c = l.cost.find((x) => x.item === item);
        if (c) levels.push({ level: i + 1, count: c.count });
      });
      if (levels.length) upgrades.push({ module: m.name, levels });
    }
  }
  return { quests: questsFor(quests, item), barters, upgrades };
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
