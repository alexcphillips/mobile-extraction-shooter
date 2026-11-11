import { Hono, type Context } from 'hono';
import {
  claimContract,
  dropContract,
  handOverContract,
  takeContract,
  type Profile,
} from '@mes/shared';
import type { AppEnv } from './auth';
import { loadContracts, loadItems } from './content';
import { body, fail, isObject } from './errors';
import { profileResponse, writeProfile } from './profiles';

/*
 * The Intel desk's contracts (session H6): taking one from the day's board, handing
 * found-in-raid items over, claiming the rewards and dropping it. Each names the profile
 * version the client read, like buying, so a retry can't act twice; each is refused in a
 * raid; all run on the server's clock. Kills count at a raid's end (raids.ts). PUT
 * /api/profile refuses any change to contracts. See shared contracts.ts for the rules.
 */

export const contracts = new Hono<AppEnv>();

/**
 * The shared steps: the body's version, not in a raid, not stale; then `edit` changes the
 * profile (returning why it can't, or null) and it's written at that version. The rules
 * settle the state first (a new day, a contract out of time); a refusal writes nothing.
 */
async function change(
  c: Context<AppEnv>,
  edit: (profile: Profile, raw: Record<string, unknown>, now: number) => string | null,
) {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.version !== 'number')
    return fail(c, 'bad-request', 'version is required');
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  if (current.raid) return fail(c, 'in-raid');
  if (current.version !== raw.version) return fail(c, 'stale');
  const now = Date.now();
  const bad = edit(current.profile, raw, now);
  if (bad) return fail(c, 'invalid', bad);
  const res = await writeProfile(db, account, current.version, current.profile).run();
  if (!res.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
}

contracts.post('/:id/take', (c) =>
  change(c, (profile, _raw, now) => {
    const all = loadContracts();
    const def = all.get(c.req.param('id'));
    if (!def) return 'no such contract';
    return takeContract(profile, all, def, now);
  }),
);

/** Body: `{ version, objective }`. */
contracts.post('/hand-over', (c) =>
  change(c, (profile, raw, now) =>
    typeof raw.objective === 'string'
      ? handOverContract(profile, loadContracts(), raw.objective, now)
      : 'objective is required',
  ),
);

/** Body: `{ version, page? }`: the stash page to put the rewards on first. */
contracts.post('/claim', (c) =>
  change(c, (profile, raw, now) => {
    const page = raw.page ?? 0;
    if (!Number.isInteger(page) || (page as number) < 0) return 'page must be a whole number';
    const last = profile.stash.length - 1;
    return claimContract(
      profile,
      loadItems(),
      loadContracts(),
      now,
      Math.min(page as number, last),
    );
  }),
);

contracts.post('/drop', (c) =>
  change(c, (profile, _raw, now) => dropContract(profile, loadContracts(), now)),
);
