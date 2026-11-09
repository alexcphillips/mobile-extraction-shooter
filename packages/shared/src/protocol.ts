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
  /**
   * Admin cheat (infinite consumables): repairs needn't spend kit points. Ignored except
   * on the dev server.
   */
  freeRepairs?: boolean;
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
  /** How many of the offer (1 to MAX_BUY); 1 if left out. */
  times?: number;
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

/**
 * POST /api/admin/give: puts `count` new items into the stash, page `page` first, free.
 * Only on the dev server (`wrangler dev` sets ADMIN); elsewhere the route isn't there.
 */
export interface AdminGiveRequest {
  version: number;
  item: string;
  count: number;
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
  /** The quest markers they investigated (session 14b), by path id; counted even if they died. */
  investigated?: string[];
  /** Admin cheat: keep everything whatever the outcome. Ignored except on the dev server. */
  keepGear?: boolean;
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

/*
 * Friends, presence and the party (docs/coop.md, C1–C3). Accounts are named by their id;
 * usernames are only for showing and for asking someone by name.
 */

export const SOCIAL = {
  maxFriends: 100,
  /** Friend requests you've sent that haven't been answered. */
  maxOutgoing: 20,
  /** Seen within this long counts as online (ms): the menu says it's there every 10 s. */
  onlineMs: 60_000,
  /** How often the menu says it's there, and picks up the party and invites (ms). */
  heartbeatMs: 10_000,
  maxParty: 4,
  /** A party invite not answered in this long lapses (ms). */
  inviteMs: 5 * 60_000,
  /** An open raid started within this long shows its player as in a raid (ms). */
  raidMs: 20 * 60_000,
  /** How long a started raid stays on offer to the members (ms). */
  startMs: 60_000,
  /** A party's join code: letters and digits without look-alikes (0/O, 1/I/L). */
  code: /^[A-HJKMNP-Z2-9]{8}$/,
} as const;

/** The kind of device someone plays on: it decides who hosts a co-op raid (a PC first). */
export type Device = 'phone' | 'pc';

/** What a friend is doing now. */
export type Activity = 'offline' | 'menu' | 'raid';

export interface Friend {
  /** The friend's account id. */
  id: string;
  username: string;
  activity: Activity;
  /** The device they were last seen on, or null if never. */
  device: Device | null;
  /** Whether they're in a party with anyone (yours or another). */
  inParty: boolean;
}

/** A friend request, either way round. */
export interface FriendRequest {
  id: string;
  /** The other account: who sent it (incoming) or who it's to (outgoing). */
  account: string;
  username: string;
  /** Unix ms. */
  at: number;
}

/** GET /api/friends, and the reply to every friends route. */
export interface FriendsResponse {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

/**
 * POST /api/friends/requests: asks someone by username. If they've already asked you,
 * this accepts theirs. POST /api/friends/requests/:id/accept and /decline answer one
 * (decline also takes back one you sent); DELETE /api/friends/:account unfriends.
 */
export interface FriendRequestRequest {
  username: string;
}

/** POST /api/presence: the menu is showing, on this kind of device. Replies with the party. */
export interface PresenceRequest {
  device: Device;
}

export interface PartyMember {
  id: string;
  username: string;
  ready: boolean;
  device: Device | null;
  online: boolean;
}

export interface Party {
  id: string;
  /** For the invite link, /join/<code>. */
  code: string;
  /** The leader's account id: they pick the raid and start it. */
  leader: string;
  /** The raid config the leader picked, or null for none yet. */
  raid: string | null;
  /** In the order they joined; the leader first. */
  members: PartyMember[];
  /** A raid the leader started in the last SOCIAL.startMs, which every member joins. */
  start: PartyStart | null;
}

/** POST /api/party/start: the leader starts the party's raid (C5). */
export interface PartyStart {
  /** Names this raid: the devices find each other by it. */
  session: string;
  /** The raid config. */
  raid: string;
  /** Whose device hosts it (pickHost when it started). */
  host: string;
  /** Unix ms. */
  at: number;
}

/** An invite to someone's party, from a friend. */
export interface PartyInvite {
  id: string;
  from: string;
  username: string;
  /** How many are in that party now. */
  size: number;
  /** Unix ms; it lapses SOCIAL.inviteMs after. */
  at: number;
}

/**
 * GET /api/party, POST /api/presence, and the reply to every party route. On your own
 * you're in no party (null): the first invite or POST /api/party makes one, you leading.
 */
export interface PartyResponse {
  party: Party | null;
  invites: PartyInvite[];
  /** Connection signals waiting for you (GET /api/party/signals takes them): someone's calling. */
  signals: number;
  /** Your friends, and how many are online (in the menu or a raid, as FriendsResponse has it), for the menu's Friends button (UX-5). */
  friendCount: number;
  friendsOnline: number;
  /** Friend requests to you, not yet answered. */
  friendRequests: number;
}

/**
 * Party routes: POST /api/party (make one, for its link), POST /api/party/invites
 * (PartyInviteRequest), POST /api/party/invites/:id/accept and /decline, POST
 * /api/party/join (PartyJoinRequest, by link), POST /api/party/leave, POST
 * /api/party/kick (PartyKickRequest, the leader), POST /api/party/ready
 * (PartyReadyRequest), POST /api/party/raid (PartyRaidRequest, the leader).
 */
export interface PartyInviteRequest {
  /** A friend's account id. */
  friend: string;
}

export interface PartyJoinRequest {
  code: string;
}

export interface PartyKickRequest {
  account: string;
}

export interface PartyReadyRequest {
  ready: boolean;
}

export interface PartyRaidRequest {
  raid: string;
}

/*
 * Connecting party members' devices directly (docs/coop.md, C4): WebRTC, with the offer
 * and answer passed through the server. Each is the whole session description with every
 * ICE candidate in it (no trickle), so one each way connects.
 */

export const SIGNAL = {
  /** A signal not picked up in this long is dropped (ms). */
  lifeMs: 2 * 60_000,
  /** The longest session description accepted (characters). */
  maxSdp: 20_000,
  /** How often a device waiting for an answer asks for it (ms). */
  pollMs: 1_000,
} as const;

export type SignalKind = 'offer' | 'answer';

/** POST /api/party/signal: to another member of your party. */
export interface SignalRequest {
  /** Their account id. */
  to: string;
  /** Names one attempt, so an answer is matched to its offer. */
  session: string;
  kind: SignalKind;
  sdp: string;
}

export interface Signal {
  from: string;
  session: string;
  kind: SignalKind;
  sdp: string;
  /** Unix ms. */
  at: number;
}

/** GET /api/party/signals: the signals to you, which are then gone from the server. */
export interface SignalsResponse {
  signals: Signal[];
}

/**
 * POST /api/party/ice: the STUN and TURN servers to connect with. The TURN credentials
 * are short-lived, made by the Worker from its TURN key; without one, STUN only.
 */
export interface IceResponse {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  /** Whether a relay is included, for when a direct connection can't be made. */
  relay: boolean;
}
