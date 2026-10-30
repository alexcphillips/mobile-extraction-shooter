import { Hono, type MiddlewareHandler } from 'hono';
import { addToStash, itemDef, stackSize } from '@mes/shared';
import type { AppEnv } from './auth';
import { loadItems } from './content';
import { body, fail, isObject } from './errors';
import { profileResponse, writeProfile } from './profiles';

/*
 * Admin tools for testing (2026-10-30, the user's call): only on the dev server, like the
 * editors. `wrangler dev` sets ADMIN (package.json's dev script); the deployed Worker
 * never has it, so there every admin route is not found.
 */

/** The most stacks given in one go. */
export const MAX_GIVE_STACKS = 50;

/** Lets admin routes through on the dev server; first, so nothing tells they're there. */
export const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.ADMIN !== '1') return fail(c, 'not-found');
  await next();
};

export const admin = new Hono<AppEnv>();

/**
 * Gives new items into the stash, page `page` first, free: as many stacks as `count` needs.
 * Names the profile version read, like buying. Refused while the gear is in a raid.
 */
admin.post('/give', async (c) => {
  const raw = await body(c);
  if (
    !isObject(raw) ||
    typeof raw.version !== 'number' ||
    typeof raw.item !== 'string' ||
    !Number.isInteger(raw.count) ||
    (raw.count as number) < 1
  )
    return fail(c, 'bad-request', 'version, item and count are required');
  const page = raw.page ?? 0;
  if (!Number.isInteger(page) || (page as number) < 0)
    return fail(c, 'bad-request', 'page must be a whole number');
  const items = loadItems();
  if (!items.has(raw.item)) return fail(c, 'not-found', `no item "${raw.item}"`);
  const stack = stackSize(itemDef(items, raw.item));
  const count = raw.count as number;
  if (Math.ceil(count / stack) > MAX_GIVE_STACKS)
    return fail(c, 'invalid', `at most ${MAX_GIVE_STACKS * stack} at once`);
  const stacks = [];
  for (let left = count; left > 0; left -= stack)
    stacks.push({ item: raw.item, count: Math.min(left, stack) });

  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  if (current.raid) return fail(c, 'in-raid');
  if (current.version !== raw.version) return fail(c, 'stale');
  const { profile } = current;
  if (!addToStash(profile, items, stacks, Math.min(page as number, profile.stash.length - 1)))
    return fail(c, 'invalid', 'there is no room in your stash');
  const res = await writeProfile(db, account, current.version, profile).run();
  if (!res.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
});
