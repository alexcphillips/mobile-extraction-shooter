import { Hono, type Context } from 'hono';
import { collectCraft, startCraft, upgradeModule, type Profile } from '@mes/shared';
import type { AppEnv } from './auth';
import { hangarModule, loadItems, recipeDef } from './content';
import { body, fail, isObject } from './errors';
import { profileResponse, writeProfile } from './profiles';

/*
 * The Hangar between raids (session H1): upgrading a module a level, paid for with plain
 * items from the stash. Names the profile version the client read, like buying, so a
 * retry can't upgrade twice. Refused while the gear is in a raid. PUT /api/profile
 * refuses any change to the Hangar. See shared hangar.ts for the rules.
 *
 * Crafting (H2): POST /:id/craft starts a recipe, POST /:id/collect takes its output once
 * done. Both run on the server's clock (Date.now()), so the client can't hurry a craft.
 */

export const hangar = new Hono<AppEnv>();

/**
 * The Hangar routes' shared steps: the module, the body's version (and the rest of the
 * body for `change`), not in a raid, not stale; then `change` edits the profile (returning
 * why it can't, or null) and the profile is written at that version.
 */
async function change(
  c: Context<AppEnv>,
  edit: (profile: Profile, raw: Record<string, unknown>, now: number) => string | null,
) {
  const module = hangarModule(c.req.param('id') ?? '');
  if (!module) return fail(c, 'not-found');
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.version !== 'number')
    return fail(c, 'bad-request', 'version is required');
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  if (current.raid) return fail(c, 'in-raid');
  if (current.version !== raw.version) return fail(c, 'stale');
  const bad = edit(current.profile, raw, Date.now());
  if (bad) return fail(c, 'invalid', bad);
  const res = await writeProfile(db, account, current.version, current.profile).run();
  if (!res.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
}

hangar.post('/:id/upgrade', (c) =>
  change(c, (profile) => upgradeModule(profile, loadItems(), hangarModule(c.req.param('id'))!)),
);

/** Body: `{ version, recipe }`. */
hangar.post('/:id/craft', (c) =>
  change(c, (profile, raw, now) => {
    const recipe = typeof raw.recipe === 'string' ? recipeDef(raw.recipe) : undefined;
    if (!recipe) return 'no such recipe';
    return startCraft(profile, hangarModule(c.req.param('id'))!, recipe, now);
  }),
);

/** Body: `{ version, page? }`: the stash page to put it on first. */
hangar.post('/:id/collect', (c) =>
  change(c, (profile, raw, now) => {
    const page = raw.page ?? 0;
    if (!Number.isInteger(page) || (page as number) < 0) return 'page must be a whole number';
    const last = profile.stash.length - 1;
    const module = hangarModule(c.req.param('id'))!;
    return collectCraft(profile, loadItems(), module, now, Math.min(page as number, last));
  }),
);
