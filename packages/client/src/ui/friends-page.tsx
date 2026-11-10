import {
  SOCIAL,
  type Friend,
  type FriendsResponse,
  type Party,
  type PartyResponse,
} from '@mes/shared';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AccountError } from '../account';
import { acceptFriend, askFriend, declineFriend, inviteFriend, unfriend } from '../social';
import { Avatar, friendLine, useFriends } from './friends';

/*
 * The friends page between raids (docs/coop.md, C1–C2): your friends with what they're
 * doing, requests either way, and adding someone by username. From here a friend can be
 * invited to your party (C3), as from the party drawer, which lists the friends online
 * (2026-11-10). Refreshed every SOCIAL.heartbeatMs while open.
 */

export function FriendsPage({
  party,
  onBack,
  onParty,
}: {
  /** Your party, to show who's in it already. */
  party: Party | null;
  onBack: () => void;
  /** A party route's reply: the menu shows it at once. */
  onParty: (p: PartyResponse) => void;
}): ReactNode {
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useFriends(setNotice);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // Unfriending asks for a second tap.
  const [confirming, setConfirming] = useState<string | null>(null);

  /** Runs a friends route, showing its reply, or why it was refused. */
  const run = useCallback(async (what: Promise<FriendsResponse>, done?: string) => {
    setBusy(true);
    try {
      setData(await what);
      setNotice(done ?? null);
      return true;
    } catch (err) {
      if (!(err instanceof AccountError)) throw err;
      setNotice(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [setData]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape' && !(e.target instanceof HTMLInputElement)) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const add = (e: FormEvent): void => {
    e.preventDefault();
    const username = name.trim();
    if (!username || busy) return;
    void run(askFriend(username), `Asked ${username}.`).then((ok) => ok && setName(''));
  };

  const invite = (f: Friend): void => {
    setBusy(true);
    inviteFriend(f.id)
      .then(
        (p) => {
          onParty(p);
          setNotice(`Invited ${f.username}. The invite lasts 5 minutes.`);
        },
        (err: unknown) => {
          if (!(err instanceof AccountError)) throw err;
          setNotice(err.message);
        },
      )
      .finally(() => setBusy(false));
  };

  const remove = (f: Friend): void => {
    if (confirming !== f.id) {
      setConfirming(f.id);
      return;
    }
    setConfirming(null);
    void run(unfriend(f.id), `${f.username} is no longer a friend.`);
  };

  const inMyParty = (id: string): boolean => !!party?.members.some((m) => m.id === id);
  const full = (party?.members.length ?? 1) >= SOCIAL.maxParty;

  return (
    <div className="raid stash friends" role="dialog" aria-label="Friends">
      <header className="raid-tabs">
        <button onClick={onBack}>Back</button>
        <span className="stash-title">Friends</span>
        <span className="raid-spacer" />
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      {/* Two panels (2026-11-06): adding and requests, and your friends. */}
      <div className="friends-layout">
        <section className="friends-panel">
          <h2 className="friends-head">Add a friend</h2>
          <form className="friends-add" onSubmit={add}>
            <input
              type="text"
              value={name}
              placeholder="Their username"
              aria-label="Username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary" type="submit" disabled={busy || !name.trim()}>
              Add
            </button>
          </form>
          <p className="raid-note">
            Or send them your party's invite link from the Party button on the menu.
          </p>
          {data && data.incoming.length > 0 && (
            <>
              <h3 className="friends-sub">Asking to be your friend</h3>
              <ul className="friends-list">
                {data.incoming.map((r) => (
                  <li key={r.id}>
                    <Avatar name={r.username} />
                    <span className="vendors-name">{r.username}</span>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void run(acceptFriend(r.id), `${r.username} is a friend now.`)}
                    >
                      Accept
                    </button>
                    <button disabled={busy} onClick={() => void run(declineFriend(r.id))}>
                      Decline
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data && data.outgoing.length > 0 && (
            <>
              <h3 className="friends-sub">Waiting for an answer</h3>
              <ul className="friends-list">
                {data.outgoing.map((r) => (
                  <li key={r.id}>
                    <Avatar name={r.username} />
                    <span className="vendors-name">{r.username}</span>
                    <button disabled={busy} onClick={() => void run(declineFriend(r.id))}>
                      Take back
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="friends-panel">
          <h2 className="friends-head">
            Friends{data && data.friends.length > 0 && <span> · {data.friends.length}</span>}
          </h2>
          {!data && <p className="raid-note">Loading…</p>}
          {data && data.friends.length === 0 && (
            <p className="raid-note">No friends yet. Add one by their username.</p>
          )}
          {data && data.friends.length > 0 && (
            <ul className="friends-list">
              {data.friends.map((f) => (
                <li key={f.id} className={`friends-${f.activity}`}>
                  <Avatar name={f.username} activity={f.activity} />
                  <span className="vendors-name">
                    {f.username}
                    <span className="friends-line">{friendLine(f, party)}</span>
                  </span>
                  {!inMyParty(f.id) && (
                    <button className="primary" disabled={busy || full} onClick={() => invite(f)}>
                      Invite
                    </button>
                  )}
                  <button
                    className={confirming === f.id ? 'confirm' : ''}
                    disabled={busy}
                    onBlur={() => setConfirming((c) => (c === f.id ? null : c))}
                    onClick={() => remove(f)}
                  >
                    {confirming === f.id ? 'Remove?' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
