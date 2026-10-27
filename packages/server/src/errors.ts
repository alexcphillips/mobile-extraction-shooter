import type { Context } from 'hono';
import type { ApiErrorCode } from '@mes/shared';

const STATUS = {
  'bad-request': 400,
  invalid: 422,
  'signed-out': 401,
  'username-taken': 409,
  'wrong-login': 401,
  locked: 429,
  'in-raid': 409,
  'raid-over': 409,
  stale: 409,
  'not-found': 404,
} as const satisfies Record<ApiErrorCode, number>;

/** An ApiError reply with its status. */
export function fail(c: Context, error: ApiErrorCode, message?: string) {
  return c.json(message === undefined ? { error } : { error, message }, STATUS[error]);
}

/** The request's JSON body, or undefined if it isn't JSON. */
export async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    return undefined;
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
