import {
  handOverCount,
  itemDef,
  objectiveGoal,
  objectiveProgress,
  objectiveText,
  questStatus,
  type ItemDb,
  type ProfileResponse,
  type QuestDef,
  type QuestStatus,
  type VendorDef,
} from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';

/*
 * The quests page between raids (session 14): each vendor's quests, in a chain. Accept
 * one, hand items over from the stash (a second tap confirms, as they're gone), and claim
 * the rewards into the stash once every objective is done. Progress in raids comes with
 * the raid's result (14b).
 */

/** The order quests are listed in: what needs doing first, done ones last. */
const ORDER: Record<QuestStatus, number> = {
  ready: 0,
  active: 1,
  available: 2,
  locked: 3,
  done: 4,
};

const STATUS_TEXT: Record<QuestStatus, string> = {
  ready: 'Ready to hand in',
  active: 'Active',
  available: 'New',
  locked: 'Locked',
  done: 'Done',
};

/** What a vendor has for the player: quests ready to claim, then new ones. */
export function questsLine(quests: readonly QuestDef[], me: ProfileResponse): string {
  const n = (s: QuestStatus) => quests.filter((q) => questStatus(me.profile, q) === s).length;
  const parts = [
    n('ready') && `${n('ready')} ready`,
    n('active') && `${n('active')} active`,
    n('available') && `${n('available')} new`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : quests.length ? 'Nothing new' : 'None yet';
}

function rewardsText(items: ItemDb, q: QuestDef): string {
  const parts = q.rewards.items.map((r) => {
    const name = itemDef(items, r.item).name;
    return (r.count ?? 1) > 1 ? `${name} ×${r.count}` : name;
  });
  if (q.rewards.money) parts.unshift(`${q.rewards.money.toLocaleString()} money`);
  return parts.join(', ') || 'Nothing';
}

export function QuestsPage({
  vendors,
  quests,
  items,
  me,
  notice,
  onBack,
  onStash,
  onAccept,
  onHandOver,
  onComplete,
}: {
  vendors: readonly VendorDef[];
  quests: readonly QuestDef[];
  items: ItemDb;
  me: ProfileResponse;
  notice: string | null;
  onBack: () => void;
  onStash: () => void;
  /** Each resolves when done or refused. */
  onAccept: (q: QuestDef) => Promise<void>;
  onHandOver: (q: QuestDef, objective: string) => Promise<void>;
  onComplete: (q: QuestDef) => Promise<void>;
}): ReactNode {
  const givers = vendors.filter((v) => quests.some((q) => q.vendor === v.id));
  const [shown, setShown] = useState(0);
  // Handing over asks for a second tap on the same objective: `${quest}/${objective}`.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const vendor = givers[shown];
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  const run = (key: string, fn: () => Promise<void>): void => {
    if (busy) return;
    setConfirming(null);
    setBusy(key);
    void fn().finally(() => setBusy(null));
  };
  const p = me.profile;
  const list = quests
    .filter((q) => q.vendor === vendor?.id)
    .map((q) => ({ q, status: questStatus(p, q) }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const done = list.filter((x) => x.status === 'done');
  const open = list.filter((x) => x.status !== 'done');
  return (
    <div className="raid stash vendors quests" role="dialog" aria-label="Quests">
      <header className="raid-tabs">
        <button onClick={onBack}>Back</button>
        {givers.map((v, i) => {
          const ready = quests.filter((q) => q.vendor === v.id && questStatus(p, q) === 'ready');
          return (
            <button
              key={v.id}
              className={i === shown ? 'active' : ''}
              onClick={() => {
                setConfirming(null);
                setShown(i);
              }}
            >
              {v.name}
              {ready.length > 0 && <span className="quests-badge">{ready.length}</span>}
            </button>
          );
        })}
        <span className="raid-spacer" />
        <span className="vendors-money">
          <b>{p.money.toLocaleString()}</b> money
        </span>
        <button onClick={onStash}>Stash</button>
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      <div className="vendors-body">
        {!vendor && <p className="raid-note">No quests yet.</p>}
        <ul className="quests-list">
          {open.map(({ q, status }) => {
            const locked = status === 'locked';
            const before = q.requires
              .filter((r) => p.quests[r]?.status !== 'done')
              .map((r) => quests.find((x) => x.id === r)?.name ?? r);
            return (
              <li key={q.id} className={`quests-quest ${status}`}>
                <div className="quests-head">
                  <span className="quests-name">{q.name}</span>
                  <span className={`quests-status ${status}`}>{STATUS_TEXT[status]}</span>
                </div>
                {locked ? (
                  <p className="quests-text">After {before.join(' and ')}.</p>
                ) : (
                  <>
                    <p className="quests-text">{q.description}</p>
                    <ul className="quests-objectives">
                      {q.objectives.map((o) => {
                        const goal = objectiveGoal(o);
                        const got = objectiveProgress(p, q, o);
                        const key = `${q.id}/${o.id}`;
                        const have = o.type === 'handOver' ? handOverCount(p, o.item) : 0;
                        const give = Math.min(have, goal - got);
                        return (
                          <li key={o.id} className={got >= goal ? 'done' : ''}>
                            <span className="quests-tick">{got >= goal ? '✓' : '○'}</span>
                            <span className="quests-objective">
                              {objectiveText(items, o)}
                              {goal > 1 && (
                                <span>
                                  {' '}
                                  · {got} / {goal}
                                </span>
                              )}
                            </span>
                            {o.type === 'handOver' && status === 'active' && got < goal && (
                              <button
                                className={confirming === key ? 'confirm' : ''}
                                disabled={!give || busy !== null}
                                onBlur={() => setConfirming((c) => (c === key ? null : c))}
                                onClick={() =>
                                  confirming === key
                                    ? run(key, () => onHandOver(q, o.id))
                                    : setConfirming(key)
                                }
                              >
                                {busy === key
                                  ? 'Handing over…'
                                  : confirming === key
                                    ? `Hand over ${give}?`
                                    : have
                                      ? `Hand over · ${have} in stash`
                                      : 'None in stash'}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <div className="quests-foot">
                  <span className="quests-rewards">
                    Rewards: <b>{rewardsText(items, q)}</b>
                  </span>
                  {status === 'available' && (
                    <button
                      className="primary"
                      disabled={busy !== null}
                      onClick={() => run(q.id, () => onAccept(q))}
                    >
                      {busy === q.id ? 'Accepting…' : 'Accept'}
                    </button>
                  )}
                  {status === 'ready' && (
                    <button
                      className="primary"
                      disabled={busy !== null}
                      onClick={() => run(q.id, () => onComplete(q))}
                    >
                      {busy === q.id ? 'Handing in…' : 'Hand in'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {done.length > 0 && (
          <p className="raid-note">Done: {done.map((x) => x.q.name).join(', ')}.</p>
        )}
        {vendor && !open.length && !done.length && <p className="raid-note">No quests yet.</p>}
        <p className="raid-note">
          Items are handed over from your stash, not from what you wear or carry. Rewards go into
          your stash.
        </p>
      </div>
    </div>
  );
}
