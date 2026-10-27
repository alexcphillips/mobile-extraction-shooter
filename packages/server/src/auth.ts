import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ACCOUNT, newProfile, type LoginRequest } from '@mes/shared';
import { loadItems, startingKit } from './content';
import type { Env } from './env';
import { body, fail, isObject } from './errors';
import { profileResponse } from './profiles';

/*
 * Accounts and sessions (session 12): a username and password. See tech-stack.md →
 * Server → Accounts.
 */

export type AppEnv = { Bindings: Env; Variables: { account: string } };

export const AUTH = {
  /**
   * PBKDF2-SHA256 rounds for new hashes. 100k takes about 12 ms of CPU, over the free
   * plan's 10 ms a request; 50k is about 6 ms. Each hash stores its own count, so this
   * can go up later without breaking old ones.
   */
  iterations: 50_000,
  sessionDays: 180,
  /** Wrong passwords in a row before the account locks for lockMinutes. */
  maxFailures: 10,
  lockMinutes: 5,
  cookie: 'mes_session',
};

const DAY = 24 * 60 * 60 * 1000;
const enc = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** A stored hash: pbkdf2-sha256$<iterations>$<salt>$<hash>. */
export async function hashPassword(password: string, iterations = AUTH.iterations) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !iterations || !salt || !hash) return false;
  const want = fromBase64(hash);
  const got = await pbkdf2(password, fromBase64(salt), Number(iterations));
  // Compared in full, so the time taken doesn't say how much matched.
  let diff = want.length ^ got.length;
  for (let i = 0; i < want.length; i++) diff |= want[i]! ^ (got[i] ?? 0);
  return diff === 0;
}

async function sha256(s: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sets the session cookie: HttpOnly, for /api only, Secure over HTTPS (not plain-http dev). */
function setSessionCookie(c: Context, token: string, expires: number) {
  setCookie(c, AUTH.cookie, token, {
    path: '/api',
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: Math.floor((expires - Date.now()) / 1000),
  });
}

/** The SQL statement that makes a session, and sets its cookie. */
async function startSession(c: Context<AppEnv>, account: string) {
  const token = newToken();
  const expires = Date.now() + AUTH.sessionDays * DAY;
  setSessionCookie(c, token, expires);
  return c.env.DB.prepare(
    'INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)',
  ).bind(await sha256(token), account, expires);
}

/** The username and password from a request body, checked against the rules. */
function parseLogin(raw: unknown): LoginRequest | string {
  if (!isObject(raw) || typeof raw.username !== 'string' || typeof raw.password !== 'string')
    return 'username and password are required';
  if (!ACCOUNT.username.test(raw.username)) return 'usernames are 3 to 20 letters, digits, _ or -';
  if (raw.password.length < ACCOUNT.minPassword || raw.password.length > ACCOUNT.maxPassword)
    return `passwords are ${ACCOUNT.minPassword} to ${ACCOUNT.maxPassword} characters`;
  return { username: raw.username, password: raw.password };
}

/**
 * Lets the request through with c.var.account set if it has a live session, else 401
 * signed-out. A session past half its life is extended, with a new cookie expiry.
 */
export const signedIn: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, AUTH.cookie);
  if (!token) return fail(c, 'signed-out');
  const hash = await sha256(token);
  const row = await c.env.DB.prepare(
    'SELECT account_id, expires_at FROM sessions WHERE token_hash = ?',
  )
    .bind(hash)
    .first<{ account_id: string; expires_at: number }>();
  const now = Date.now();
  if (!row || row.expires_at <= now) return fail(c, 'signed-out');
  if (row.expires_at - now < (AUTH.sessionDays / 2) * DAY) {
    const expires = now + AUTH.sessionDays * DAY;
    await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(expires, hash)
      .run();
    setSessionCookie(c, token, expires);
  }
  c.set('account', row.account_id);
  await next();
};

export const auth = new Hono<AppEnv>();

/** Makes an account with the new-player kit, signs in, and replies with the profile. */
auth.post('/register', async (c) => {
  const login = parseLogin(await body(c));
  if (typeof login === 'string') return fail(c, 'bad-request', login);
  const db = c.env.DB;
  const taken = await db
    .prepare('SELECT 1 FROM accounts WHERE username = ?')
    .bind(login.username)
    .first();
  if (taken) return fail(c, 'username-taken');

  const id = crypto.randomUUID();
  const now = Date.now();
  const profile = newProfile(loadItems(), startingKit('new-player'));
  try {
    await db.batch([
      db
        .prepare('INSERT INTO accounts (id, username, password, created_at) VALUES (?, ?, ?, ?)')
        .bind(id, login.username, await hashPassword(login.password), now),
      db
        .prepare('INSERT INTO profiles (account_id, version, data, updated_at) VALUES (?, 1, ?, ?)')
        .bind(id, JSON.stringify(profile), now),
      await startSession(c, id),
    ]);
  } catch (err) {
    // Two registering the same name at once: the second loses on the unique index.
    if (String(err).includes('UNIQUE')) return fail(c, 'username-taken');
    throw err;
  }
  return c.json(await profileResponse(db, id), 201);
});

auth.post('/login', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.username !== 'string' || typeof raw.password !== 'string')
    return fail(c, 'bad-request', 'username and password are required');
  const db = c.env.DB;
  const account = await db
    .prepare('SELECT id, password, failed_logins, locked_until FROM accounts WHERE username = ?')
    .bind(raw.username)
    .first<{ id: string; password: string; failed_logins: number; locked_until: number }>();
  if (!account) return fail(c, 'wrong-login');
  const now = Date.now();
  if (account.locked_until > now) return fail(c, 'locked');

  if (!(await verifyPassword(raw.password, account.password))) {
    const failures = account.failed_logins + 1;
    const locked = failures >= AUTH.maxFailures;
    await db
      .prepare('UPDATE accounts SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(locked ? 0 : failures, locked ? now + AUTH.lockMinutes * 60_000 : 0, account.id)
      .run();
    return fail(c, locked ? 'locked' : 'wrong-login');
  }
  await db.batch([
    db.prepare('UPDATE accounts SET failed_logins = 0 WHERE id = ?').bind(account.id),
    db
      .prepare('DELETE FROM sessions WHERE account_id = ? AND expires_at <= ?')
      .bind(account.id, now),
    await startSession(c, account.id),
  ]);
  return c.json(await profileResponse(db, account.id));
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, AUTH.cookie);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run();
  }
  deleteCookie(c, AUTH.cookie, { path: '/api' });
  return c.body(null, 204);
});
