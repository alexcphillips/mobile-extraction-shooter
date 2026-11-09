/** The Worker's bindings (wrangler.jsonc) and secrets. */
export interface Env {
  DB: D1Database;
  /** "1" on the dev server only (`wrangler dev --var`): turns on the admin routes. */
  ADMIN?: string;
  /**
   * Comma-separated usernames that are admins in the live game (2026-11-09, a secret:
   * `wrangler secret put ADMIN_USERS`). It only shows them admin UI (the stats overlay);
   * the admin routes and cheats still need ADMIN. On the dev server everyone is an admin.
   */
  ADMIN_USERS?: string;
  /**
   * Cloudflare Realtime TURN key (secrets: `wrangler secret put`), for the relay co-op
   * falls back on when two devices can't connect directly. Without them, STUN only.
   */
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}
