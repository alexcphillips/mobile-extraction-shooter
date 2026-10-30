/** The Worker's bindings (wrangler.jsonc) and secrets. */
export interface Env {
  DB: D1Database;
  /** "1" on the dev server only (`wrangler dev --var`): turns on the admin routes. */
  ADMIN?: string;
}
