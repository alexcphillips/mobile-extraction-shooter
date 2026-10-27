import { Hono } from 'hono';
import {
  PROFILE_FORMAT,
  checkProfile,
  itemGained,
  loadContent,
  loadSettings,
  restGear,
  type Profile,
  type ProfileResponse,
} from '@mes/shared';
import type { AppEnv } from './auth';
import { loadItems } from './content';
import { body, fail, isObject } from './errors';

/** A stored profile, loaded through its format's migrations. */
export function parseProfile(data: string): Profile {
  return loadContent(PROFILE_FORMAT, JSON.parse(data), 'profile');
}

/** An account's profile, its version and its open raid, as the API sends them. */
export async function profileResponse(db: D1Database, account: string): Promise<ProfileResponse> {
  const [row, raid] = await Promise.all([
    db
      .prepare(
        'SELECT a.username, a.settings, a.settings_at, p.version, p.data FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE p.account_id = ?',
      )
      .bind(account)
      .first<{
        username: string;
        settings: string | null;
        settings_at: number;
        version: number;
        data: string;
      }>(),
    db
      .prepare('SELECT id, raid, started_at FROM raids WHERE account_id = ? AND ended_at IS NULL')
      .bind(account)
      .first<{ id: string; raid: string; started_at: number }>(),
  ]);
  if (!row) throw new Error(`account ${account} has no profile`);
  return {
    username: row.username,
    version: row.version,
    profile: parseProfile(row.data),
    raid: raid ? { id: raid.id, raid: raid.raid, startedAt: raid.started_at } : null,
    settings: row.settings
      ? { settings: loadSettings(JSON.parse(row.settings)), at: row.settings_at }
      : null,
  };
}

/**
 * The statement that writes a profile if it's still at version, bumping it. Run it last
 * in a batch, and check meta.changes: 0 means someone else wrote first (stale).
 */
export function writeProfile(db: D1Database, account: string, version: number, p: Profile) {
  return db
    .prepare(
      'UPDATE profiles SET version = version + 1, data = ?, updated_at = ? WHERE account_id = ? AND version = ?',
    )
    .bind(JSON.stringify(p), Date.now(), account, version);
}

/** A SQL condition, true while the account's profile is still at a version (2 binds). */
export const AT_VERSION = '(SELECT version FROM profiles WHERE account_id = ?) = ?';

export const profiles = new Hono<AppEnv>();

profiles.get('/', async (c) => c.json(await profileResponse(c.env.DB, c.var.account)));

/**
 * Saves a profile edited between raids (session 13's stash). Sanity limits: well-formed,
 * the same money (only vendors change it, on the server), and no item there's more of
 * than before. Refused while the gear is in a raid.
 */
profiles.put('/', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.version !== 'number')
    return fail(c, 'bad-request', 'version and profile are required');
  let next: Profile;
  try {
    next = loadContent(PROFILE_FORMAT, raw.profile, 'profile');
  } catch (err) {
    return fail(c, 'bad-request', String(err));
  }
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  if (current.raid) return fail(c, 'in-raid');
  if (current.version !== raw.version) return fail(c, 'stale');
  const items = loadItems();
  const bad = checkProfile(items, next);
  if (bad) return fail(c, 'invalid', bad);
  if (next.money !== current.profile.money)
    return fail(c, 'invalid', 'money only changes through vendors');
  const gained = itemGained(current.profile, next);
  if (gained) return fail(c, 'invalid', `more "${gained}" than before`);

  restGear(next.gear);
  const res = await writeProfile(db, account, raw.version, next).run();
  if (!res.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
});

/** The most a settings document may be, as JSON. */
const MAX_SETTINGS = 16_000;

export const settingsRoute = new Hono<AppEnv>();

/**
 * Saves the settings if they're newer than the stored ones (by when they were changed),
 * so an old device coming online doesn't undo a newer change. Unknown or bad fields fall
 * back to their defaults, as on the client.
 */
settingsRoute.put('/', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.at !== 'number' || !Number.isFinite(raw.at))
    return fail(c, 'bad-request', 'settings and at are required');
  const json = JSON.stringify(loadSettings(raw.settings));
  if (json.length > MAX_SETTINGS) return fail(c, 'invalid', 'settings are too big');
  await c.env.DB.prepare(
    'UPDATE accounts SET settings = ?, settings_at = ? WHERE id = ? AND settings_at < ?',
  )
    .bind(json, raw.at, c.var.account, raw.at)
    .run();
  return c.body(null, 204);
});
