import { SOCIAL, type Friend, type FriendsResponse, type PartyResponse } from '@mes/shared';
import { useState, type ReactNode } from 'react';
import { AccountError } from '../account';
import {
  acceptFriend,
  acceptInvite,
  declineFriend,
  declineInvite,
  deviceKind,
  inviteFriend,
  joinLink,
  kickMember,
  leaveParty,
  makeParty,
} from '../social';
import { Avatar, friendLine, useFriends } from './friends';

/*
 * The party on the main menu (docs/coop.md, C3): invites to you, the members with their
 * ready ticks, the invite link, leave, and the leader's remove (ready is the raid button). Each action's reply
 * is the party as it is now, shown at once. Under it (2026-11-10), your friends online with a
 * + to invite each, and friend requests to answer, so inviting needs no trip to the friends page.
 */

/** Online before in a raid, then by name. */
const RANK: Record<Friend['activity'], number> = { menu: 0, raid: 1, offline: 2 };


/**
 * Shares the link: the share sheet on a phone, else copied (a PC often has no share sheet).
 * Resolves with what to tell the player.
 */
async function shareLink(url: string): Promise<string> {
  if (deviceKind() === 'phone' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Join my party', url });
      return 'Invite link sent.';
    } catch (err) {
      // Closing the share sheet isn't a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return '';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'Invite link copied. Send it to a friend: it joins your party once they sign in.';
  } catch {
    // No clipboard outside HTTPS (a phone on the dev server over the LAN): show it.
    return `Send a friend this link: ${url}`;
  }
}

export function PartyStrip({
  party: res,
  me,
  onParty,
  onNotice,
  onTest,
  onFriends,
}: {
  party: PartyResponse | null;
  /** Your username (unique, so it finds you among the members). */
  me: string;
  onParty: (p: PartyResponse) => void;
  onNotice: (text: string | null) => void;
  /** Starts the connection test with the rest of the party (C4). */
  onTest: () => void;
  /** Opens the friends page, to add or remove friends. */
  onFriends: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [friends, setFriends] = useFriends(onNotice);
  // Who you've invited while the drawer's been open, so their + reads "Invited".
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const party = res?.party ?? null;
  const invites = res?.invites ?? [];
  const mine = party?.members.find((m) => m.username === me);
  const leader = !!party && !!mine && party.leader === mine.id;

  const act = (what: () => Promise<PartyResponse>, done?: string): void => {
    if (busy) return;
    setBusy(true);
    what()
      .then(
        (p) => {
          onParty(p);
          if (done !== undefined) onNotice(done);
        },
        (err: unknown) => {
          if (!(err instanceof AccountError)) throw err;
          onNotice(err.message);
        },
      )
      .finally(() => setBusy(false));
  };

  const invite = (): void => {
    if (busy) return;
    setBusy(true);
    (party ? Promise.resolve(res!) : makeParty())
      .then(async (p) => {
        onParty(p);
        const text = await shareLink(joinLink(p.party!.code));
        if (text) onNotice(text);
      })
      .catch((err: unknown) => {
        if (!(err instanceof AccountError)) throw err;
        onNotice(err.message);
      })
      .finally(() => setBusy(false));
  };

  const inviteOne = (f: Friend): void => {
    if (busy) return;
    setBusy(true);
    inviteFriend(f.id)
      .then(
        (p) => {
          onParty(p);
          setInvited((s) => new Set(s).add(f.id));
          onNotice(`Invited ${f.username}. The invite lasts 5 minutes.`);
        },
        (err: unknown) => {
          if (!(err instanceof AccountError)) throw err;
          onNotice(err.message);
        },
      )
      .finally(() => setBusy(false));
  };

  const answer = (what: () => Promise<FriendsResponse>, done?: string): void => {
    if (busy) return;
    setBusy(true);
    what()
      .then(
        (r) => {
          setFriends(r);
          if (done) onNotice(done);
        },
        (err: unknown) => {
          if (!(err instanceof AccountError)) throw err;
          onNotice(err.message);
        },
      )
      .finally(() => setBusy(false));
  };

  const inParty = (id: string): boolean => !!party?.members.some((m) => m.id === id);
  const full = (party?.members.length ?? 1) >= SOCIAL.maxParty;
  const others = (friends?.friends ?? []).filter((f) => !inParty(f.id));
  const online = others
    .filter((f) => f.activity !== 'offline')
    .sort((a, b) => RANK[a.activity] - RANK[b.activity] || a.username.localeCompare(b.username));
  const offline = others.length - online.length;
  const requests = friends?.incoming ?? [];

  return (
    <div className="party">
      {invites.map((i) => (
        <div key={i.id} className="party-invite" role="alert">
          <span>
            <b>{i.username}</b> invited you to their party
            {i.size > 1 ? ` (${i.size} in it)` : ''}.
          </span>
          <button
            className="primary"
            disabled={busy}
            onClick={() => act(() => acceptInvite(i.id), `You're in ${i.username}'s party.`)}
          >
            Join
          </button>
          <button disabled={busy} onClick={() => act(() => declineInvite(i.id))}>
            Decline
          </button>
        </div>
      ))}
      <div className="party-row">
        {party ? (
          <ul className="party-members" aria-label="Party">
            {party.members.map((m) => (
              <li key={m.id} className={m.online ? '' : 'offline'}>
                <span className="party-name">
                  {m.id === party.leader && <span title="Leader">★ </span>}
                  {m.username}
                </span>
                <span className="party-state">
                  {m.ready ? '✓ Ready' : m.online ? 'Not ready' : 'Away'}
                  {m.device && ` · ${m.device === 'pc' ? 'PC' : 'phone'}`}
                </span>
                {leader && m.username !== me && (
                  <button
                    className="party-kick"
                    aria-label={`Remove ${m.username}`}
                    disabled={busy}
                    onClick={() => act(() => kickMember(m.id))}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <span className="party-alone">
            Playing alone. Invite a friend below, or send anyone the invite link; Test connection
            shows up once they've joined.
          </span>
        )}
        <span className="raid-spacer" />
        {party && party.members.length > 1 && (
          <button disabled={busy} onClick={onTest}>
            Test connection
          </button>
        )}
        <button disabled={busy} onClick={invite}>
          Invite link
        </button>
        {party && (
          <button disabled={busy} onClick={() => act(leaveParty, 'You left the party.')}>
            Leave
          </button>
        )}
      </div>
      <section className="party-friends" aria-label="Friends">
        <h3 className="friends-sub">
          Friends online{friends && <span> · {online.length}</span>}
        </h3>
        {requests.length > 0 && (
          <ul className="friends-list">
            {requests.map((r) => (
              <li key={r.id}>
                <Avatar name={r.username} />
                <span className="vendors-name">
                  {r.username}
                  <span className="friends-line">Wants to be your friend</span>
                </span>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => answer(() => acceptFriend(r.id), `${r.username} is a friend now.`)}
                >
                  Accept
                </button>
                <button disabled={busy} onClick={() => answer(() => declineFriend(r.id))}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
        )}
        {!friends && <p className="raid-note">Loading…</p>}
        {friends && online.length > 0 && (
          <ul className="friends-list">
            {online.map((f) => (
              <li key={f.id} className={`friends-${f.activity}`}>
                <Avatar name={f.username} activity={f.activity} />
                <span className="vendors-name">
                  {f.username}
                  <span className="friends-line">{friendLine(f, party)}</span>
                </span>
                {invited.has(f.id) ? (
                  <span className="party-state">Invited</span>
                ) : (
                  <button
                    className="primary party-add"
                    aria-label={`Invite ${f.username}`}
                    title={full ? 'Your party is full' : `Invite ${f.username}`}
                    disabled={busy || full}
                    onClick={() => inviteOne(f)}
                  >
                    +
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {friends && online.length === 0 && (
          <p className="raid-note">
            {friends.friends.length
              ? 'None of your friends are online.'
              : 'No friends yet. Add one by their username.'}
          </p>
        )}
        <div className="party-row">
          {offline > 0 && <span className="party-state">{offline} offline</span>}
          <span className="raid-spacer" />
          <button disabled={busy} onClick={onFriends}>
            Add or manage friends
          </button>
        </div>
      </section>
    </div>
  );
}
