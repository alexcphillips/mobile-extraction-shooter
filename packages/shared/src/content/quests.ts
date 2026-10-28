import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { stackSize, type ItemDb } from './items';
import { idSchema } from './schema';
import type { VendorDef } from './vendors';

/*
 * Quests (content/quests/<id>.json), from session 14. Each is given by a vendor, is
 * accepted from the menu between raids, and opens once the quests it requires are done:
 * a chain per vendor (the user's call, 2026-10-27). Objectives:
 * - investigate: go to a quest marker on a map and tap Investigate (in raids, 14b). It
 *   counts even if you die afterwards.
 * - handOver: give the vendor some of a normal item, from the stash, between raids.
 * - extract: get out of a raid with a quest item (14b), which spawns only while the
 *   quest is active.
 * Rewards are money and items, claimed into the stash once every objective is done.
 */

export const QUEST_FORMAT_VERSION = 1;

const common = {
  /** Unique within the quest: progress is kept by it. */
  id: idSchema,
  /** What it says on the quests page; each type has a default. */
  text: z.string().min(1).optional(),
};

const investigateSchema = z.strictObject({
  ...common,
  type: z.literal('investigate'),
  map: idSchema,
  /** A questMarker's path id on that map. */
  marker: z.string().min(1),
  /** Investigate objectives need to say what's there. */
  text: z.string().min(1),
});

const handOverSchema = z.strictObject({
  ...common,
  type: z.literal('handOver'),
  item: idSchema,
  count: z.int().min(1).default(1),
});

const extractSchema = z.strictObject({
  ...common,
  type: z.literal('extract'),
  /** A quest item. */
  item: idSchema,
});

const objectiveSchema = z.discriminatedUnion('type', [
  investigateSchema,
  handOverSchema,
  extractSchema,
]);

const stackOf = z.strictObject({
  item: idSchema,
  /** For items that stack; defaults to 1. */
  count: z.int().min(1).optional(),
});

export const questSchema = z.strictObject({
  formatVersion: z.literal(QUEST_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** The vendor who gives it. */
  vendor: idSchema,
  /** What the vendor says about it. */
  description: z.string().min(1),
  /** Quests that must be done first. */
  requires: z.array(idSchema).default([]),
  objectives: z.array(objectiveSchema).min(1),
  rewards: z
    .strictObject({
      money: z.int().min(0).default(0),
      /** Into the stash, in this order. */
      items: z.array(stackOf).default([]),
    })
    .default({ money: 0, items: [] }),
});

export type QuestDef = z.infer<typeof questSchema>;
export type QuestObjective = z.infer<typeof objectiveSchema>;

export const QUEST_FORMAT: ContentFormat<QuestDef> = {
  kind: 'quest',
  version: QUEST_FORMAT_VERSION,
  schema: questSchema,
  migrations: {},
};

/**
 * Checks quests against the vendors and items: a vendor that exists, unique objective
 * ids, hand-overs of normal items with a value, extracts of quest items, required quests
 * that exist without a loop, and rewards that exist in whole stacks. Quest markers are
 * checked against the maps where maps are compiled (the client's content tests).
 */
export function checkQuests(
  quests: ReadonlyMap<string, QuestDef>,
  vendors: ReadonlyMap<string, VendorDef>,
  items: ItemDb,
): void {
  for (const q of quests.values()) {
    const source = `content/quests/${q.id}.json`;
    if (!vendors.has(q.vendor)) throw new ContentError(source, `no vendor "${q.vendor}"`);
    const ids = new Set<string>();
    for (const o of q.objectives) {
      if (ids.has(o.id)) throw new ContentError(source, `two objectives are "${o.id}"`);
      ids.add(o.id);
      if (o.type === 'investigate') continue;
      const def = items.get(o.item);
      if (!def) throw new ContentError(source, `no item "${o.item}"`);
      if (o.type === 'extract' && def.type !== 'quest')
        throw new ContentError(source, `"${o.item}" to extract with must be a quest item`);
      if (o.type === 'handOver' && (def.type === 'quest' || def.type === 'melee'))
        throw new ContentError(source, `"${o.item}" can't be handed over`);
    }
    for (const r of q.requires) {
      if (!quests.has(r)) throw new ContentError(source, `requires "${r}", which doesn't exist`);
    }
    for (const r of q.rewards.items) {
      const def = items.get(r.item);
      if (!def) throw new ContentError(source, `no reward item "${r.item}"`);
      if (def.type === 'quest') throw new ContentError(source, `rewards a quest item`);
      if ((r.count ?? 1) > stackSize(def))
        throw new ContentError(source, `${r.count} "${r.item}" is more than a stack`);
    }
  }
  // No quest may require itself, however far down.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting')
      throw new ContentError(`content/quests/${id}.json`, 'its requirements go round in a loop');
    state.set(id, 'visiting');
    for (const r of quests.get(id)!.requires) visit(r);
    state.set(id, 'done');
  };
  for (const id of quests.keys()) visit(id);
}
