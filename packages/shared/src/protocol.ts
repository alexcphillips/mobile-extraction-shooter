import type { Profile } from './profile';
import type { Gear } from './sim/gear';
import type { LeaveReason } from './sim/raid';

/** Bumped when the client/server API changes incompatibly. */
export const PROTOCOL_VERSION = 1;

export interface HelloResponse {
  message: string;
  protocolVersion: number;
  tickRate: number;
}

/*
 * The account and raid API (session 12). Every route is under /api and speaks JSON. A
 * session is an HttpOnly cookie set by register and login. Errors are an ApiError with
 * a 4xx status.
 */

export const ACCOUNT = {
  /** Usernames: letters, digits, _ and -, unique ignoring case. */
  username: /^[A-Za-z0-9_-]{3,20}$/,
  minPassword: 8,
  maxPassword: 200,
} as const;

/** POST /api/register and POST /api/login. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** A raid the server has started and not yet had the result of. */
export interface OpenRaid {
  id: string;
  /** The raid config's id. */
  raid: string;
  /** Unix time in milliseconds. */
  startedAt: number;
}

/** GET /api/profile, and the reply to everything that changes it. */
export interface ProfileResponse {
  username: string;
  /** Goes up by one with every change; PUT /api/profile must name the one it read. */
  version: number;
  profile: Profile;
  /** While set, the gear is in the raid and the profile can't be edited. */
  raid: OpenRaid | null;
}

/** PUT /api/profile: moving things around between raids. */
export interface SaveProfileRequest {
  version: number;
  profile: Profile;
}

/** POST /api/raids. Starting a raid while one is open counts that one as missing in action. */
export interface StartRaidRequest {
  raid: string;
}

export type RaidOutcome = LeaveReason | 'killed';

/** POST /api/raids/:id/end. Sending the same result again is harmless. */
export interface EndRaidRequest {
  how: RaidOutcome;
  /** Everything the player had when the raid ended. The server keeps what the outcome allows. */
  gear: Gear;
  /** Seconds in the raid. */
  seconds: number;
  kills: number;
  /** Where they extracted, or what killed them. */
  detail?: string;
}

export type ApiErrorCode =
  /** Malformed JSON or fields. */
  | 'bad-request'
  /** Well-formed, but over a sanity limit or not possible (message says which). */
  | 'invalid'
  /** No session, or it has expired. */
  | 'signed-out'
  | 'username-taken'
  | 'wrong-login'
  /** Too many wrong passwords; try again later. */
  | 'locked'
  /** The gear is in a raid. */
  | 'in-raid'
  /** That raid has already ended differently (for example counted as missing). */
  | 'raid-over'
  /** The profile changed since it was read; read it again. */
  | 'stale'
  | 'not-found';

export interface ApiError {
  error: ApiErrorCode;
  message?: string;
}
