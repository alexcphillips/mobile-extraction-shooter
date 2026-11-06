import { newProfile, type Profile } from '@mes/shared';
import { loadItems, startingKit } from './content';

/*
 * Wiping accounts back to a new player's progress (scripts/wipe-accounts.mjs runs this
 * through wrangler; the Worker never imports it, so no route can reach it). The login,
 * friends, party and settings stay.
 */

/** Who to wipe: everyone, or these usernames (ignoring case, as the column does). */
export type WipeTarget = 'all' | string[];

function quote(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

/** A subquery of the target's account ids. */
function accountIds(target: WipeTarget): string {
  if (target === 'all') return 'SELECT id FROM accounts';
  return `SELECT id FROM accounts WHERE username IN (${target.map(quote).join(', ')})`;
}

/** What each target has now, for checking before and after a wipe. */
export function wipeTargetsSql(target: WipeTarget): string {
  return `SELECT a.username, p.version,
      json_extract(p.data, '$.money') AS money,
      json_array_length(p.data, '$.stash') AS stash_pages,
      (SELECT count(*) FROM json_each(p.data, '$.quests')) AS quests,
      (SELECT count(*) FROM raids r WHERE r.account_id = a.id AND r.ended_at IS NULL) AS open_raids
    FROM accounts a JOIN profiles p ON p.account_id = a.id
    WHERE a.id IN (${accountIds(target)})
    ORDER BY a.username`;
}

/** The profile a wiped account gets: what registering gives. */
export function wipedProfile(): Profile {
  return newProfile(loadItems(), startingKit('new-player'));
}

/**
 * The wipe, as statements to run in one transaction (values inline: they go in a .sql
 * file, which can't bind). Three things a simpler reset would get wrong:
 * - An open raid is closed, not deleted or left open. Left open, its result would put the
 *   old gear back; closed, a device still playing it (or sending a queued result) gets
 *   raid-over and nothing is saved. Raid history stays; nothing reads it for progress.
 * - The version goes up, never back to 1, so a device holding the old profile gets stale
 *   and reloads instead of writing it over the wipe.
 * - A party raid just started is called off, or its members would still join it.
 */
export function wipeSql(target: WipeTarget, now: number): string[] {
  const ids = accountIds(target);
  const data = quote(JSON.stringify(wipedProfile()));
  return [
    `UPDATE raids SET ended_at = ${now}, outcome = 'wiped' WHERE ended_at IS NULL AND account_id IN (${ids})`,
    `UPDATE parties SET started_at = NULL, session = NULL, host = NULL
      WHERE started_at IS NOT NULL
        AND id IN (SELECT party_id FROM party_members WHERE account_id IN (${ids}))`,
    `UPDATE profiles SET version = version + 1, data = ${data}, updated_at = ${now} WHERE account_id IN (${ids})`,
  ];
}
