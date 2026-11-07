import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { fits, stackSize, type ItemDb } from './items';
import { idSchema } from './schema';

/*
 * Vendors (content/vendors/<id>.json), from session 13b: what each one sells, from the
 * main menu between raids. Stock is unlimited (the user's call, 2026-10-27, kept on
 * 2026-11-06): money is the only limit. Every vendor buys anything with a value, for
 * VENDOR.sellShare of it, so selling is done from the stash, not from a vendor.
 *
 * Levels (format 2, 2026-11-06, the user's call, as Tarkov's loyalty levels without a
 * player level): every vendor starts at level 1; levels 2 to 4 each need some reputation
 * with it (from its quests) and some money spent with it. Each offer is unlocked at a
 * level. A vendor can mark its prices up, and show only some of its offers at a time,
 * a different few every so many hours (the Fence).
 */

export const VENDOR_FORMAT_VERSION = 2;

/** The most a vendor's level goes to. */
export const VENDOR_LEVELS = 4;

const offerSchema = z.strictObject({
  item: idSchema,
  /** How many come in one purchase, for items that stack (rounds). Defaults to 1. */
  count: z.int().min(1).optional(),
  /** Attachments a gun comes fitted with (the AUG A3's 1.5× optic), priced in. */
  attachments: z.array(idSchema).min(1).optional(),
  /** The vendor's level it's sold from; 1 if left out. */
  level: z.int().min(1).max(VENDOR_LEVELS).optional(),
});

/** What reaching a level needs: reputation (from quests) and money spent with the vendor. */
const levelSchema = z.strictObject({
  rep: z.number().min(0),
  spent: z.int().min(0),
});

export const vendorSchema = z.strictObject({
  formatVersion: z.literal(VENDOR_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** A line under the name. */
  blurb: z.string().optional(),
  /** Where it comes in the vendors page's list, lowest first; 0 if left out. */
  order: z.int().optional(),
  /** Its card's colour on the vendors page. */
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** What levels 2, 3 and 4 need, in that order, each at least as much as the one before. */
  levels: z.array(levelSchema).length(VENDOR_LEVELS - 1),
  /** Prices are the items' values times this (at least 1); 1 if left out. */
  markup: z.number().min(1).optional(),
  /**
   * Shows only `shown` of its offers at a time (locked ones too, at their level), a
   * different few every `hours`, the same for everyone (vendorStock, vendors.ts).
   */
  rotation: z.strictObject({ shown: z.int().min(1), hours: z.number().positive() }).optional(),
  /** What it sells, in the order shown, always new. */
  sells: z.array(offerSchema).min(1),
});

export type VendorDef = z.infer<typeof vendorSchema>;
export type VendorOffer = z.infer<typeof offerSchema>;

export const VENDOR_FORMAT: ContentFormat<VendorDef> = {
  kind: 'vendor',
  version: VENDOR_FORMAT_VERSION,
  schema: vendorSchema,
  migrations: {
    // 2026-11-06: levels. A vendor from before sells everything at level 1, which needs nothing.
    1: (doc) => ({ ...doc, levels: [0, 0, 0].map(() => ({ rep: 0, spent: 0 })) }),
  },
};

/**
 * Checks that every offer names an item with a value, in a count that fits one stack, and
 * that no vendor sells money; and that a gun's attachments fit it, one to a slot.
 */
export function checkVendors(vendors: ReadonlyMap<string, VendorDef>, items: ItemDb): void {
  for (const v of vendors.values()) {
    const source = `content/vendors/${v.id}.json`;
    for (let i = 1; i < v.levels.length; i++) {
      const [a, b] = [v.levels[i - 1]!, v.levels[i]!];
      if (b.rep < a.rep || b.spent < a.spent)
        throw new ContentError(source, `level ${i + 2} needs less than level ${i + 1}`);
    }
    if (v.rotation && v.rotation.shown > v.sells.length)
      throw new ContentError(source, `shows ${v.rotation.shown} of ${v.sells.length} offers`);
    for (const o of v.sells) {
      const def = items.get(o.item);
      if (!def) throw new ContentError(source, `no item "${o.item}"`);
      if (def.value <= 0) throw new ContentError(source, `"${o.item}" has no value`);
      if (def.type === 'loot' && def.money) throw new ContentError(source, 'sells money');
      if ((o.count ?? 1) > stackSize(def))
        throw new ContentError(source, `${o.count} "${o.item}" is more than a stack`);
      const slots = new Set<string>();
      for (const id of o.attachments ?? []) {
        const a = items.get(id);
        if (def.type !== 'weapon' || a?.type !== 'attachment' || !fits(def, a) || slots.has(a.slot))
          throw new ContentError(source, `"${id}" doesn't fit "${o.item}"`);
        slots.add(a.slot);
      }
    }
  }
}
