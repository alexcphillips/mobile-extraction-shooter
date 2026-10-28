import { Hono } from 'hono';
import { acceptQuest, completeQuest, handOver, type Profile, type QuestDef } from '@mes/shared';
import type { AppEnv } from './auth';
import { loadItems, questDef } from './content';
import { body, fail, isObject } from './errors';
import { profileResponse, writeProfile } from './profiles';

/*
 * Quests between raids (session 14): accepting one, handing items over from the stash,
 * and claiming the rewards. Each names the profile version the client read, like buying,
 * so a retry can't hand over or claim twice. Refused while the gear is in a raid. See
 * shared quests.ts for the rules. PUT /api/profile refuses any change to quests.
 */

export const quests = new Hono<AppEnv>();

/** How each route changes the profile: why it can't, or null. */
const ACTIONS: Record<
  string,
  (profile: Profile, quest: QuestDef, raw: Record<string, unknown>) => string | null
> = {
  accept: (profile, quest) => acceptQuest(profile, quest),
  'hand-over': (profile, quest, raw) =>
    typeof raw.objective === 'string'
      ? handOver(profile, quest, raw.objective)
      : 'objective is required',
  complete: (profile, quest, raw) => {
    const page = raw.page ?? 0;
    if (!Number.isInteger(page) || (page as number) < 0) return 'page must be a whole number';
    const last = profile.stash.length - 1;
    return completeQuest(profile, loadItems(), quest, Math.min(page as number, last));
  },
};

quests.post('/:id/:action', async (c) => {
  const change = Object.hasOwn(ACTIONS, c.req.param('action'))
    ? ACTIONS[c.req.param('action')]!
    : null;
  const quest = questDef(c.req.param('id'));
  if (!change || !quest) return fail(c, 'not-found');
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.version !== 'number')
    return fail(c, 'bad-request', 'version is required');
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  if (current.raid) return fail(c, 'in-raid');
  if (current.version !== raw.version) return fail(c, 'stale');
  const bad = change(current.profile, quest, raw);
  if (bad) return fail(c, 'invalid', bad);
  const res = await writeProfile(db, account, current.version, current.profile).run();
  if (!res.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
});
