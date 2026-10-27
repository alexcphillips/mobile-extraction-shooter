import { Hono } from 'hono';
import { checkGear, keptGear, parseGear, restGear, type EndRaidRequest } from '@mes/shared';
import type { AppEnv } from './auth';
import { loadItems, raidDef } from './content';
import { body, fail, isObject } from './errors';
import { AT_VERSION, profileResponse, writeProfile } from './profiles';

/*
 * Starting and ending raids (session 12). Solo raids run on the phone; the server only
 * sees the start and the result. While a raid is open the profile's gear is in it: the
 * profile can't be edited, and a result replaces the gear with what the outcome keeps.
 * See design.md → Raids and maps → Saving raids.
 */

export const RAIDS = {
  /** A result may report this many seconds over the raid's timer (late ticks, slow phones). */
  slackSeconds: 60,
  maxKills: 1000,
  maxDetail: 100,
};

const OUTCOMES = new Set<string>(['extracted', 'killed', 'mia']);

function parseEnd(raw: unknown): EndRaidRequest | string {
  if (!isObject(raw)) return 'a result is required';
  const { how, seconds, kills, detail } = raw;
  if (typeof how !== 'string' || !OUTCOMES.has(how)) return 'how is extracted, killed or mia';
  if (typeof seconds !== 'number' || !(seconds >= 0)) return 'seconds must be 0 or more';
  if (!Number.isInteger(kills) || (kills as number) < 0) return 'kills must be a whole number';
  if (detail !== undefined && typeof detail !== 'string') return 'detail must be a string';
  const gear = parseGear(raw.gear);
  if (!gear) return 'gear is malformed';
  return {
    how: how as EndRaidRequest['how'],
    gear,
    seconds,
    kills: kills as number,
    ...(detail !== undefined ? { detail } : {}),
  };
}

export const raids = new Hono<AppEnv>();

/**
 * Starts a raid with the profile's gear. A raid still open (its result never came) is
 * counted as missing in action first: the gear it took in is lost but for the knife and
 * the vault as they went in.
 */
raids.post('/', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.raid !== 'string')
    return fail(c, 'bad-request', 'raid is required');
  if (!raidDef(raw.raid)) return fail(c, 'invalid', `no raid "${raw.raid}"`);
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  const { version, profile } = current;
  const now = Date.now();

  const stmts: D1PreparedStatement[] = [];
  if (current.raid) {
    profile.gear = keptGear(profile.gear, false);
    stmts.push(
      db
        .prepare(
          `UPDATE raids SET ended_at = ?, outcome = 'mia' WHERE id = ? AND ended_at IS NULL AND ${AT_VERSION}`,
        )
        .bind(now, current.raid.id, account, version),
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO raids (id, account_id, raid, started_at) SELECT ?, ?, ?, ? WHERE ${AT_VERSION}`,
      )
      .bind(crypto.randomUUID(), account, raw.raid, now, account, version),
    writeProfile(db, account, version, profile),
  );
  const results = await db.batch(stmts);
  if (!results.at(-1)?.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account), 201);
});

/**
 * Ends a raid: the profile's gear becomes what the player kept (everything if they
 * extracted; otherwise the knife and the vault). Sanity limits: the kept gear is
 * well-formed and the time and kills are plausible. The same result sent again (a retry
 * whose reply was lost) gets the profile; a different one for an ended raid is raid-over.
 */
raids.post('/:id/end', async (c) => {
  const end = parseEnd(await body(c));
  if (typeof end === 'string') return fail(c, 'bad-request', end);
  const db = c.env.DB;
  const account = c.var.account;
  const id = c.req.param('id');
  const row = await db
    .prepare('SELECT raid, ended_at, outcome, result FROM raids WHERE id = ? AND account_id = ?')
    .bind(id, account)
    .first<{ raid: string; ended_at: number | null; outcome: string; result: string | null }>();
  if (!row) return fail(c, 'not-found');
  const result = JSON.stringify(end);
  if (row.ended_at !== null) {
    if (row.result === result) return c.json(await profileResponse(db, account));
    return fail(c, 'raid-over', `that raid already ended (${row.outcome})`);
  }

  const duration = raidDef(row.raid)?.duration;
  if (duration !== undefined && end.seconds > duration + RAIDS.slackSeconds)
    return fail(c, 'invalid', `${end.seconds} s is longer than the raid`);
  if (end.kills > RAIDS.maxKills) return fail(c, 'invalid', `${end.kills} kills is too many`);
  if ((end.detail?.length ?? 0) > RAIDS.maxDetail) return fail(c, 'invalid', 'detail is too long');

  const current = await profileResponse(db, account);
  const { version, profile } = current;
  const gear = keptGear(end.gear, end.how === 'extracted', profile.gear.knife);
  restGear(gear);
  const bad = checkGear(loadItems(), gear);
  if (bad) return fail(c, 'invalid', bad);
  profile.gear = gear;

  const results = await db.batch([
    db
      .prepare(
        `UPDATE raids SET ended_at = ?, outcome = ?, result = ? WHERE id = ? AND ended_at IS NULL AND ${AT_VERSION}`,
      )
      .bind(Date.now(), end.how, result, id, account, version),
    writeProfile(db, account, version, profile),
  ]);
  if (!results.at(-1)?.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
});
