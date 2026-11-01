/** The Worker's bindings (wrangler.jsonc) and secrets. */
export interface Env {
  DB: D1Database;
  /** "1" on the dev server only (`wrangler dev --var`): turns on the admin routes. */
  ADMIN?: string;
  /**
   * Cloudflare Realtime TURN key (secrets: `wrangler secret put`), for the relay co-op
   * falls back on when two devices can't connect directly. Without them, STUN only.
   */
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}
