import { questsFor } from '../quests';
import { containerMix, spotMix } from '../sim/loot-roll';
import type { CompiledMarker } from './compile';
import type { EnemyDef, LoadoutDef } from './enemies';
import type { HangarModuleDef } from './hangar';
import type { LootContainerDef } from './loot-containers';
import type { LootTableDef } from './loot-tables';
import type { QuestDef, QuestObjective } from './quests';
import type { RecipeDef } from './recipes';
import type { VendorDef } from './vendors';
import type { ItemDb } from './items';

/*
 * Where an item comes from and what wants it (UX-2, 2026-11-08), for its details: worked
 * out from content, never written by hand, so it can't go stale. Hangar recipes go in both
 * (H3), and upgrade costs in its uses.
 */

/** The Hangar's content, for the recipes and upgrades an item is in. */
export interface HangarContent {
  modules: ReadonlyMap<string, HangarModuleDef>;
  recipes: readonly RecipeDef[];
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
  /** Left out (an editor), nothing is crafted. */
  hangar?: HangarContent;
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
  /** Hangar modules that craft it, by name, at the module level it needs. */
  crafted: { module: string; level: number }[];
}

export interface ItemUsage {
  /** Quest objectives that want it (to hand over, or bring out). */
  quests: { quest: QuestDef; objective: QuestObjective }[];
  /** Recipes that take it, with their module's name. */
  recipes: { recipe: RecipeDef; module: string }[];
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
  crafted: [],
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
  if (c.hangar)
    for (const r of c.hangar.recipes) {
      const module = c.hangar.modules.get(r.module)?.name ?? r.module;
      // One line per module, at the lowest level any of its recipes for it needs.
      const crafted = of(r.output.item).crafted;
      const has = crafted.find((y) => y.module === module);
      if (has) has.level = Math.min(has.level, r.level);
      else crafted.push({ module, level: r.level });
    }

  // Content checks already refuse unknown ids; this keeps a half-loaded editor safe.
  for (const i of out.keys()) if (!c.items.has(i)) out.delete(i);
  return out;
}

/** What wants an item: quests, and the Hangar's recipes and upgrades if given. */
export function itemUsage(
  quests: readonly QuestDef[],
  item: string,
  hangar?: HangarContent,
): ItemUsage {
  const recipes: ItemUsage['recipes'] = [];
  const upgrades: ItemUsage['upgrades'] = [];
  if (hangar) {
    for (const recipe of hangar.recipes)
      if (recipe.inputs.some((i) => i.item === item))
        recipes.push({ recipe, module: hangar.modules.get(recipe.module)?.name ?? recipe.module });
    for (const m of hangar.modules.values()) {
      const levels: { level: number; count: number }[] = [];
      m.levels.forEach((l, i) => {
        const c = l.cost.find((x) => x.item === item);
        if (c) levels.push({ level: i + 1, count: c.count });
      });
      if (levels.length) upgrades.push({ module: m.name, levels });
    }
  }
  return { quests: questsFor(quests, item), recipes, upgrades };
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
      s.questSpots.length > 0 ||
      s.crafted.length > 0)
  );
}
