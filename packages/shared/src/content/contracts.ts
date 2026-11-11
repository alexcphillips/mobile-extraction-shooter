import { z } from 'zod';
import { FACTIONS } from './enemies';
import { ContentError, type ContentFormat } from './format';
import { MODULE_LEVELS } from './hangar';
import { stackSize, type ItemDb } from './items';
import { idSchema } from './schema';
import type { VendorDef } from './vendors';

/*
 * The Intel desk's contracts (content/contracts/<id>.json, session H6; design in
 * docs/hangar.md → The Intel desk's contracts). A contract is a short timed job from a
 * vendor: taken from the desk's board, it has `hours` from Get contract to be done in.
 * Objectives reuse what exists: kills of a faction (on one map, or any), counted from
 * raid results, and hand-overs of items found in raid (always: the user's call,
 * 2026-11-10). Rewards are items and reputation with its vendor, never money (the Hangar
 * doesn't print money). The desk's level gates the harder ones.
 */

export const CONTRACT_FORMAT_VERSION = 1;

/** The longest a contract's window can be. */
export const MAX_CONTRACT_HOURS = 24;

const common = {
  /** Unique within the contract: progress is kept by it. */
  id: idSchema,
  /** What it says on the desk; each type has a default. */
  text: z.string().min(1).optional(),
};

const killSchema = z.strictObject({
  ...common,
  type: z.literal('kill'),
  faction: z.enum(FACTIONS),
  /** Only kills on this map count; any map's if left out. */
  map: idSchema.optional(),
  count: z.int().min(1),
});

const handOverSchema = z.strictObject({
  ...common,
  type: z.literal('handOver'),
  /** Found in raid only. */
  item: idSchema,
  count: z.int().min(1).default(1),
});

const objectiveSchema = z.discriminatedUnion('type', [killSchema, handOverSchema]);

export const contractSchema = z.strictObject({
  formatVersion: z.literal(CONTRACT_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** Who it's for: the reputation goes to them. */
  vendor: idSchema,
  description: z.string().min(1),
  /** The Intel desk level it needs. */
  level: z.int().min(1).max(MODULE_LEVELS),
  /** How long it has from Get contract, in real hours. */
  hours: z.number().positive().max(MAX_CONTRACT_HOURS),
  objectives: z.array(objectiveSchema).min(1),
  rewards: z.strictObject({
    /** Into the stash, in this order. */
    items: z
      .array(z.strictObject({ item: idSchema, count: z.int().min(1).optional() }))
      .default([]),
    /** Reputation with its vendor. */
    rep: z.number().min(0).default(0),
  }),
});

export type ContractDef = z.infer<typeof contractSchema>;
export type ContractObjective = z.infer<typeof objectiveSchema>;
export type KillObjective = z.infer<typeof killSchema>;

export const CONTRACT_FORMAT: ContentFormat<ContractDef> = {
  kind: 'contract',
  version: CONTRACT_FORMAT_VERSION,
  schema: contractSchema,
  migrations: {},
};

/**
 * Checks contracts: a vendor that exists, unique objective ids, kill maps that exist
 * (when `maps` is given), hand-overs of real items that aren't quest items, money or the
 * knife, and some reward: items that exist in whole stacks and aren't money, or rep.
 */
export function checkContracts(
  contracts: ReadonlyMap<string, ContractDef>,
  vendors: ReadonlyMap<string, VendorDef>,
  items: ItemDb,
  maps?: ReadonlySet<string>,
): void {
  for (const c of contracts.values()) {
    const source = `content/contracts/${c.id}.json`;
    if (!vendors.has(c.vendor)) throw new ContentError(source, `no vendor "${c.vendor}"`);
    const ids = new Set<string>();
    for (const o of c.objectives) {
      if (ids.has(o.id)) throw new ContentError(source, `two objectives are "${o.id}"`);
      ids.add(o.id);
      if (o.type === 'kill') {
        if (o.map && maps && !maps.has(o.map)) throw new ContentError(source, `no map "${o.map}"`);
        continue;
      }
      const def = items.get(o.item);
      if (!def) throw new ContentError(source, `no item "${o.item}"`);
      if (def.type === 'quest' || def.type === 'melee' || (def.type === 'loot' && def.money))
        throw new ContentError(source, `"${o.item}" can't be handed over`);
    }
    if (c.rewards.items.length === 0 && c.rewards.rep === 0)
      throw new ContentError(source, 'gives nothing');
    for (const r of c.rewards.items) {
      const def = items.get(r.item);
      if (!def) throw new ContentError(source, `no item "${r.item}"`);
      if (def.type === 'quest') throw new ContentError(source, 'gives a quest item');
      if (def.type === 'loot' && def.money) throw new ContentError(source, 'gives money');
      if ((r.count ?? 1) > stackSize(def))
        throw new ContentError(source, `gives more "${r.item}" than a stack`);
    }
  }
}
