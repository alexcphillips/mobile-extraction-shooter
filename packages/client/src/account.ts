import type { ApiError, ApiErrorCode, LoginRequest, ProfileResponse } from '@mes/shared';

/*
 * The account on the server (session 12): who's signed in, signing in and out. The
 * session is an HttpOnly cookie, so the client never sees it; it only asks the server.
 * A home-screen app has its own cookies, separate from Safari's, so it signs in on its own.
 */

/** Why a request to the server failed, with a message to show. */
export class AccountError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'offline',
    message: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

const MESSAGES: Partial<Record<ApiErrorCode | 'offline', string>> = {
  'wrong-login': 'Wrong username or password.',
  'username-taken': 'That username is taken.',
  locked: 'Too many wrong passwords. Try again in a few minutes.',
  'signed-out': 'You were signed out. Sign in again.',
  offline: "Can't reach the server. Check your connection.",
};

/** The username signed in, once known; null if signed out or the server couldn't be reached. */
export let username: string | null = null;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    throw new AccountError('offline', MESSAGES.offline!);
  }
  if (res.ok) return res;
  // A proxy or a Worker that isn't running answers with something that isn't an ApiError.
  const err = (await res.json().catch(() => null)) as ApiError | null;
  if (!err?.error) throw new AccountError('offline', MESSAGES.offline!);
  const message = MESSAGES[err.error] ?? sentence(err.message ?? 'Something went wrong.');
  throw new AccountError(err.error, message);
}

/** The server's messages are lower-case fragments ("passwords are 8 to 200 characters"). */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');
}

/**
 * Who's signed in: their profile, or null if no one is. Throws an AccountError (offline)
 * if the server can't be reached.
 */
export async function fetchProfile(): Promise<ProfileResponse | null> {
  try {
    const me = (await (await call('GET', '/profile')).json()) as ProfileResponse;
    username = me.username;
    return me;
  } catch (err) {
    if (err instanceof AccountError && err.code === 'signed-out') return null;
    throw err;
  }
}

/** Signs in, or makes an account and signs in. Throws an AccountError to show. */
export async function signIn(
  mode: 'login' | 'register',
  login: LoginRequest,
): Promise<ProfileResponse> {
  const me = (await (await call('POST', `/${mode}`, login)).json()) as ProfileResponse;
  username = me.username;
  return me;
}

export async function signOut(): Promise<void> {
  await call('POST', '/logout');
  username = null;
}
