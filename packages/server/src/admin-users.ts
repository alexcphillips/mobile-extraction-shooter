import type { ProfileResponse } from '@mes/shared';
import type { Env } from './env';

/*
 * Admin accounts in the live game (2026-11-09, the user's call): they see admin UI, so
 * far the stats overlay. Unlike the admin routes (admin.ts), this grants nothing on the
 * server, so a username list is enough.
 */

/** Whether an account sees admin UI: everyone on the dev server, else those in ADMIN_USERS. */
export function isAdminUser(env: Env, username: string): boolean {
  if (env.ADMIN === '1') return true;
  return (env.ADMIN_USERS ?? '')
    .split(',')
    .map((u) => u.trim())
    .includes(username);
}

/** A profile reply that says whether the account is an admin. */
export function withAdmin(env: Env, res: ProfileResponse): ProfileResponse {
  return { ...res, admin: isAdminUser(env, res.username) };
}
