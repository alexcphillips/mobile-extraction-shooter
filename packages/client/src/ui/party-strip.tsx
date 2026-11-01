import { type PartyResponse } from '@mes/shared';
import { useState, type ReactNode } from 'react';
import { AccountError } from '../account';
import {
  acceptInvite,
  declineInvite,
  deviceKind,
  joinLink,
  kickMember,
  leaveParty,
  makeParty,
  setReady,
} from '../social';

/*
 * The party on the main menu (docs/coop.md, C3): invites to you, the members with their
 * ready ticks, the invite link, ready, leave, and the leader's remove. Each action's reply
 * is the party as it is now, shown at once.
 */

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
}: {
  party: PartyResponse | null;
  /** Your username (unique, so it finds you among the members). */
  me: string;
  onParty: (p: PartyResponse) => void;
  onNotice: (text: string | null) => void;
  /** Starts the connection test with the rest of the party (C4). */
  onTest: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
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
            Playing alone. Send a friend the invite link to play together; Test connection shows up
            once they've joined.
          </span>
        )}
        <span className="raid-spacer" />
        {party && party.members.length > 1 && mine && (
          <button
            className={mine.ready ? 'primary' : ''}
            disabled={busy}
            onClick={() => act(() => setReady(!mine.ready))}
          >
            {mine.ready ? 'Ready ✓' : 'Ready?'}
          </button>
        )}
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
    </div>
  );
}
