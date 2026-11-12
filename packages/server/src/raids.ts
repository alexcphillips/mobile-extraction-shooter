import { Hono } from 'hono';
import {
  checkGear,
  vaultSize,
  depositInto,
  keptGear,
  parseGear,
  raidProgress,
  raidXp,
  restGear,
  settleBags,
  settleFits,
  settleGuns,
  settlePockets,
  type EndRaidRequest,
  type ProfileResponse,
  type RaidKillXp,
} from '@mes/shared';
import type { AppEnv } from './auth';
import { loadEnemies, loadItems, loadQuests, raidDef } from './content';
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
  /** Quest markers investigated in one raid. */
  maxInvestigated: 50,
  /** Containers searched in one raid. */
  maxSearched: 1000,
};

/** A result's `killed`: up to as many as its kills, each an enemy id and maybe a headshot. */
function parseKilled(raw: unknown, kills: number): RaidKillXp[] | string {
  if (!Array.isArray(raw) || raw.length > kills) return 'killed must list at most the kills';
  const out: RaidKillXp[] = [];
  for (const k of raw) {
    if (!isObject(k) || typeof k.enemy !== 'string' || (k.head !== undefined && k.head !== true))
      return 'each killed is { enemy, head? }';
    out.push(k.head ? { enemy: k.enemy, head: true } : { enemy: k.enemy });
  }
  return out;
}

const OUTCOMES = new Set<string>(['extracted', 'killed', 'mia']);

function parseEnd(raw: unknown): EndRaidRequest | string {
  if (!isObject(raw)) return 'a result is required';
  const { how, seconds, kills, detail, investigated, searched } = raw;
  if (typeof how !== 'string' || !OUTCOMES.has(how)) return 'how is extracted, killed or mia';
  if (typeof seconds !== 'number' || !(seconds >= 0)) return 'seconds must be 0 or more';
  if (!Number.isInteger(kills) || (kills as number) < 0) return 'kills must be a whole number';
  if (detail !== undefined && typeof detail !== 'string') return 'detail must be a string';
  const gear = parseGear(raw.gear);
  if (!gear) return 'gear is malformed';
  if (
    investigated !== undefined &&
    !(
      Array.isArray(investigated) &&
      investigated.length <= RAIDS.maxInvestigated &&
      investigated.every((m) => typeof m === 'string')
    )
  )
    return 'investigated must be a list of marker ids';
  const killed = raw.killed === undefined ? undefined : parseKilled(raw.killed, kills as number);
  if (typeof killed === 'string') return killed;
  if (
    searched !== undefined &&
    (!Number.isInteger(searched) ||
      (searched as number) < 0 ||
      (searched as number) > RAIDS.maxSearched)
  )
    return `searched must be a whole number up to ${RAIDS.maxSearched}`;
  return {
    how: how as EndRaidRequest['how'],
    gear,
    seconds,
    kills: kills as number,
    ...(detail !== undefined ? { detail } : {}),
    ...(investigated !== undefined ? { investigated: investigated as string[] } : {}),
    ...(killed !== undefined ? { killed } : {}),
    ...(searched !== undefined ? { searched: searched as number } : {}),
    ...(raw.keepGear === true ? { keepGear: true } : {}),
  };
}

/**
 * Counts a profile's open raid as missing in action: its gear becomes the knife and the
 * vault as they went in, and money in the vault goes into the balance (changed in place,
 * for the caller to write in the same batch).
 */
function endAsMissing(db: D1Database, account: string, current: ProfileResponse, now: number) {
  current.profile.gear = keptGear(current.profile.gear, false);
  depositInto(current.profile, loadItems());
  return db
    .prepare(
      `UPDATE raids SET ended_at = ?, outcome = 'mia' WHERE id = ? AND ended_at IS NULL AND ${AT_VERSION}`,
    )
    .bind(now, current.raid!.id, account, current.version);
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
  // An offline raid (the tutorial's, TU-2) is never played on the server.
  if (!raidDef(raw.raid) || raidDef(raw.raid)!.offline)
    return fail(c, 'invalid', `no raid "${raw.raid}"`);
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  const { version, profile } = current;
  const now = Date.now();

  const stmts: D1PreparedStatement[] = [];
  if (current.raid) stmts.push(endAsMissing(db, account, current, now));
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
 * Counts a raid that never reported as missing in action now, rather than when the next
 * raid starts, so the stash can be edited (session 13: the game opens on the main menu).
 * The client asks after telling the player. A raid already ended gets the profile as it is.
 */
raids.post('/:id/abandon', async (c) => {
  const db = c.env.DB;
  const account = c.var.account;
  const current = await profileResponse(db, account);
  if (current.raid?.id !== c.req.param('id')) {
    const row = await db
      .prepare('SELECT 1 FROM raids WHERE id = ? AND account_id = ?')
      .bind(c.req.param('id'), account)
      .first();
    return row ? c.json(current) : fail(c, 'not-found');
  }
  const results = await db.batch([
    endAsMissing(db, account, current, Date.now()),
    writeProfile(db, account, current.version, current.profile),
  ]);
  if (!results.at(-1)?.meta.changes) return fail(c, 'stale');
  return c.json(await profileResponse(db, account));
});

/**
 * Ends a raid: the profile's gear becomes what the player kept (everything if they
 * extracted; otherwise the knife and the vault), and the money (cash) in it goes into
 * the balance (session 13b). Quests (session 14b): markers investigated on the raid's map
 * count whatever the outcome, and quest items in the kept gear are taken, counting for an
 * active quest that wanted them. PMC XP from the kills and searches reported. Sanity limits: the kept gear is
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
    .prepare(
      'SELECT raid, started_at, ended_at, outcome, result FROM raids WHERE id = ? AND account_id = ?',
    )
    .bind(id, account)
    .first<{
      raid: string;
      started_at: number;
      ended_at: number | null;
      outcome: string;
      result: string | null;
    }>();
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
  // Keeping your gear after a death is an admin cheat: only on the dev server (see admin.ts).
  const keepAll = end.how === 'extracted' || (end.keepGear === true && c.env.ADMIN === '1');
  const gear = keptGear(end.gear, keepAll, profile.gear.knife);
  restGear(gear);
  const items = loadItems();
  // A raid started before pistols left the primary slots, pockets were five slots or bags
  // had sections. The vault must come back the size it went in (no settling: that would
  // move a forged bigger vault's extra into the stash).
  settleGuns(items, gear, profile.stash);
  settlePockets(items, gear, profile.stash);
  settleBags(items, gear, profile.stash);
  // Items that grew since; only when everything's kept anyway (see settleFits).
  if (keepAll) settleFits(items, gear, profile.stash);
  const bad = checkGear(items, gear, vaultSize(profile));
  if (bad) return fail(c, 'invalid', bad);
  const map = raidDef(row.raid)?.map;
  if (map) raidProgress(profile, loadQuests().values(), items, map, end.investigated ?? [], gear);
  profile.gear = gear;
  depositInto(profile, items);
  // PMC XP (2026-11-11): from the kills and searches reported, by the shared rules.
  profile.xp += raidXp(
    end.how,
    end.seconds,
    end.killed ?? [],
    end.searched ?? 0,
    loadEnemies(),
  ).total;

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
