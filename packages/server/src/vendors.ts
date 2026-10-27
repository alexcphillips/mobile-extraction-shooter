import { Hono } from 'hono';
import { GEAR_SLOTS, MAX_SELL, buyOffer, sellItems, type ItemRef, type Owner } from '@mes/shared';
import type { AppEnv } from './auth';
import { loadItems, vendorDef } from './content';
import { body, fail, isObject } from './errors';
import { profileResponse, writeProfile } from './profiles';

/*
 * Buying from and selling to vendors (session 13b): the only edits between raids that
 * change money. Each names the profile version the client read, like buying a stash page,
 * so a retry can't buy or sell twice. Refused while the gear is in a raid. See shared
 * vendors.ts for the rules and prices.
 */

const GRIDS = new Set(['pockets', 'rig', 'backpack', 'vault', 'loot']);
const SLOTS = new Set<string>(GEAR_SLOTS);

function parseOwner(raw: unknown): Owner | null {
  if (!isObject(raw)) return null;
  if (raw.kind === 'self') return { kind: 'self' };
  if (raw.kind === 'container' && typeof raw.id === 'string')
    return { kind: 'container', id: raw.id };
  return null;
}

/** An item's place in the gear or stash, or null if it's malformed. */
function parseRef(raw: unknown): ItemRef | null {
  if (!isObject(raw) || typeof raw.item !== 'string') return null;
  const owner = parseOwner(raw.owner);
  if (!owner) return null;
  if (typeof raw.slot === 'string' && SLOTS.has(raw.slot))
    return { owner, slot: raw.slot as (typeof GEAR_SLOTS)[number], item: raw.item };
  if (typeof raw.grid === 'string' && GRIDS.has(raw.grid) && Number.isInteger(raw.index))
    return {
      owner,
      grid: raw.grid as 'pockets',
      index: raw.index as number,
      item: raw.item,
    };
  return null;
}

export const vendors = new Hono<AppEnv>();

/** Sells a list of items, all or none (session 13b). */
vendors.post('/sell', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.version !== 'number' || !Array.isArray(raw.from))
    return fail(c, 'bad-request', 'version and from are required');
  if (raw.from.length > MAX_SELL) return fail(c, 'invalid', `at most ${MAX_SELL} items at once`);
  const from: ItemRef[] = [];
  for (const r of raw.from as unknown[]) {
    const ref = parseRef(r);
    if (!ref) return fail(c, 'bad-request', 'from is malformed');
    from.push(ref);
  }
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  if (current.raid) return fail(c, 'in-raid');
  if (current.version !== raw.version) return fail(c, 'stale');
  const bad = sellItems(current.profile, loadItems(), from);
  if (bad) return fail(c, 'invalid', bad);
  const res = await writeProfile(db, account, current.version, current.profile).run();
  if (!res.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
});

vendors.post('/:id/buy', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.version !== 'number' || !Number.isInteger(raw.offer))
    return fail(c, 'bad-request', 'version and offer are required');
  const page = raw.page ?? 0;
  if (!Number.isInteger(page) || (page as number) < 0)
    return fail(c, 'bad-request', 'page must be a whole number');
  const vendor = vendorDef(c.req.param('id'));
  if (!vendor) return fail(c, 'not-found');
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  if (current.raid) return fail(c, 'in-raid');
  if (current.version !== raw.version) return fail(c, 'stale');
  const { profile } = current;
  const bad = buyOffer(
    profile,
    loadItems(),
    vendor,
    raw.offer as number,
    Math.min(page as number, profile.stash.length - 1),
  );
  if (bad) return fail(c, 'invalid', bad);
  const res = await writeProfile(db, account, current.version, profile).run();
  if (!res.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
});
