import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { stackSize, type ItemDb } from './items';
import { idSchema } from './schema';

/*
 * Vendors (content/vendors/<id>.json), from session 13b: what each one sells, from the
 * main menu between raids. Stock is unlimited (the user's call, 2026-10-27): money is the
 * only limit. Every vendor buys anything with a value, for VENDOR.sellShare of it, so
 * selling is done from the stash, not from a vendor.
 */

export const VENDOR_FORMAT_VERSION = 1;

const offerSchema = z.strictObject({
  item: idSchema,
  /** How many come in one purchase, for items that stack (rounds). Defaults to 1. */
  count: z.int().min(1).optional(),
});

export const vendorSchema = z.strictObject({
  formatVersion: z.literal(VENDOR_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** A line under the name. */
  blurb: z.string().optional(),
  /** What it sells, in the order shown, always new and at full value. */
  sells: z.array(offerSchema).min(1),
});

export type VendorDef = z.infer<typeof vendorSchema>;
export type VendorOffer = z.infer<typeof offerSchema>;

export const VENDOR_FORMAT: ContentFormat<VendorDef> = {
  kind: 'vendor',
  version: VENDOR_FORMAT_VERSION,
  schema: vendorSchema,
  migrations: {},
};

/**
 * Checks that every offer names an item with a value, in a count that fits one stack, and
 * that no vendor sells money.
 */
export function checkVendors(vendors: ReadonlyMap<string, VendorDef>, items: ItemDb): void {
  for (const v of vendors.values()) {
    const source = `content/vendors/${v.id}.json`;
    for (const o of v.sells) {
      const def = items.get(o.item);
      if (!def) throw new ContentError(source, `no item "${o.item}"`);
      if (def.value <= 0) throw new ContentError(source, `"${o.item}" has no value`);
      if (def.type === 'loot' && def.money) throw new ContentError(source, 'sells money');
      if ((o.count ?? 1) > stackSize(def))
        throw new ContentError(source, `${o.count} "${o.item}" is more than a stack`);
    }
  }
}
