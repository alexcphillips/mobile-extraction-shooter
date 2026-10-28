import type { Profile } from './profile';
import type { Settings } from './settings';
import type { Gear } from './sim/gear';
import type { ItemRef } from './sim/looting';
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
  /** The settings last saved from any device, or null if none ever were. */
  settings: SavedSettings | null;
}

/** Settings as synced: the newest change wins, wherever it was made. */
export interface SavedSettings {
  settings: Settings;
  /** When they were changed, on the device that changed them (Unix ms). */
  at: number;
}

/** PUT /api/profile: moving things around between raids. */
export interface SaveProfileRequest {
  version: number;
  profile: Profile;
}

/** POST /api/stash/pages: buys the next stash page, if there's money for it. */
export interface BuyPageRequest {
  version: number;
}

/**
 * POST /api/vendors/:id/buy (session 13b): buys one of a vendor's offers, by its index in
 * the vendor's list, into the stash, page `page` (from 0) first.
 */
export interface BuyRequest {
  version: number;
  offer: number;
  page?: number;
}

/**
 * POST /api/vendors/sell (session 13b): sells items from the gear or the stash pages, all
 * or none, by their places as the stash screen sees them (stashOwner for a page).
 */
export interface SellRequest {
  version: number;
  from: ItemRef[];
}

/**
 * Quests (session 14), each naming the profile version read: POST /api/quests/:id/accept,
 * POST /api/quests/:id/hand-over (QuestHandOverRequest: the objective's items from the
 * stash) and POST /api/quests/:id/complete (QuestCompleteRequest: the rewards into the
 * stash, page `page` first).
 */
export interface QuestRequest {
  version: number;
}

export interface QuestHandOverRequest extends QuestRequest {
  objective: string;
}

export interface QuestCompleteRequest extends QuestRequest {
  page?: number;
}

/** POST /api/raids. Starting a raid while one is open counts that one as missing in action. */
export interface StartRaidRequest {
  raid: string;
}

/** PUT /api/settings: saved if newer than what the server has (replies 204 either way). */
export type SaveSettingsRequest = SavedSettings;

export type RaidOutcome = LeaveReason | 'killed';

/**
 * POST /api/raids/:id/end. Sending the same result again is harmless. Money (cash) in
 * what's kept goes into the balance (session 13b).
 */
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
