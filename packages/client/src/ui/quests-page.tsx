import {
  handOverCount,
  newStashItem,
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
import { useState, type ReactNode } from 'react';
import { ItemTile } from './item-tile';

/*
 * Quests between raids (session 14): each vendor's quests, in a chain. Accept
 * one, hand items over from the stash (a second tap confirms, as they're gone), and claim
 * the rewards into the stash once every objective is done. Progress in raids comes with
 * the raid's result (14b). Reworked 2026-11-06 after Tarkov's tasks: the vendors who give
 * quests down the side with a count ready to hand in, tabs for active, available, done or
 * all, and each quest a card with its objectives' progress bars and its rewards as tiles.
 * Since 2026-11-10 there's no page of its own: it's the Quests tab of a vendor's page.
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

/** How many quests are ready to claim, active, and new (taken from the menu's Quests button). */
export function questCounts(
  quests: readonly QuestDef[],
  me: ProfileResponse,
): { ready: number; active: number; fresh: number } {
  const out = { ready: 0, active: 0, fresh: 0 };
  for (const q of quests) {
    const s = questStatus(me.profile, q);
    if (s === 'ready') out.ready++;
    else if (s === 'active') out.active++;
    else if (s === 'available') out.fresh++;
  }
  return out;
}

/** The Quests button's line: ready to claim, then active. New ones get a badge (UX-5). */
export function questsLine(quests: readonly QuestDef[], me: ProfileResponse): string {
  const { ready, active, fresh } = questCounts(quests, me);
  const parts = [ready && `${ready} ready`, active && `${active} active`].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return fresh ? 'New quests to take' : quests.length ? 'Nothing new' : 'None yet';
}

/** A quest's rewards: money and rep as chips, items as tiles. */
function Rewards({ items, q }: { items: ItemDb; q: QuestDef }): ReactNode {
  const { money, rep } = q.rewards;
  const none = !money && !rep && !q.rewards.items.length;
  return (
    <div className="quests-rewards">
      <span className="quests-rewards-label">Rewards</span>
      {none && <span className="quests-chip">Nothing</span>}
      {money > 0 && <span className="quests-chip money">{money.toLocaleString()} money</span>}
      {rep > 0 && <span className="quests-chip rep">+{rep.toFixed(2)} rep</span>}
      {q.rewards.items.map((r, i) => (
        <ItemTile
          key={i}
          items={items}
          item={newStashItem(items, { item: r.item, count: r.count ?? 1 })}
          count={r.count ?? 1}
        />
      ))}
    </div>
  );
}

/** Which quests the page shows (2026-11-06, as Tarkov's task tabs). */
type Show = 'open' | 'available' | 'done' | 'all';
const SHOWS: readonly [Show, string][] = [
  ['open', 'Active'],
  ['available', 'Available'],
  ['done', 'Done'],
  ['all', 'All'],
];
const SHOWN: Record<Show, (s: QuestStatus) => boolean> = {
  open: (s) => s === 'active' || s === 'ready',
  available: (s) => s === 'available' || s === 'locked',
  done: (s) => s === 'done',
  all: () => true,
};

/** A vendor's quests by how they stand: ready to hand in, new, active, done, all. */
export function vendorQuestCounts(
  quests: readonly QuestDef[],
  profile: ProfileResponse['profile'],
  vendor: string,
): { ready: number; fresh: number; active: number; done: number; all: number } {
  const out = { ready: 0, fresh: 0, active: 0, done: 0, all: 0 };
  for (const q of quests) {
    if (q.vendor !== vendor) continue;
    out.all++;
    const s = questStatus(profile, q);
    if (s === 'ready') out.ready++;
    else if (s === 'available') out.fresh++;
    else if (s === 'active') out.active++;
    else if (s === 'done') out.done++;
  }
  return out;
}

/**
 * A vendor's quests, as the Quests tab of its page (2026-11-10, the user's call: quests
 * live inside the vendors, as Tarkov's trader screen has them). Tabs for active,
 * available, done or all, and each quest a card with its objectives' progress bars and
 * its rewards as tiles.
 */
export function TraderQuests({
  vendor,
  quests,
  items,
  me,
  onAccept,
  onHandOver,
  onComplete,
}: {
  vendor: VendorDef;
  quests: readonly QuestDef[];
  items: ItemDb;
  me: ProfileResponse;
  /** Each resolves when done or refused. */
  onAccept: (q: QuestDef) => Promise<void>;
  onHandOver: (q: QuestDef, objective: string) => Promise<void>;
  onComplete: (q: QuestDef) => Promise<void>;
}): ReactNode {
  const p = me.profile;
  const [show, setShow] = useState<Show>('all');
  // Handing over asks for a second tap on the same objective: `${quest}/${objective}`.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, fn: () => Promise<void>): void => {
    if (busy) return;
    setConfirming(null);
    setBusy(key);
    void fn().finally(() => setBusy(null));
  };
  const all = quests
    .filter((q) => q.vendor === vendor.id)
    .map((q) => ({ q, status: questStatus(p, q) }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const list = all.filter((x) => SHOWN[show](x.status));
  if (!all.length) {
    return <p className="raid-note trader-empty">{vendor.name} has no work for you.</p>;
  }
  return (
    <>
      <div className="vendors-tools" role="tablist" aria-label="Show">
        {SHOWS.map(([s, label]) => {
          const n = all.filter((x) => SHOWN[s](x.status)).length;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={s === show}
              className={s === show ? 'active' : undefined}
              onClick={() => setShow(s)}
            >
              {label} <span className="quests-tab-count">{n}</span>
            </button>
          );
        })}
        <span className="raid-spacer" />
        <span className="vendors-tag">
          {all.filter((x) => x.status === 'done').length} / {all.length} done
        </span>
      </div>
      <ul className="quests-list">
        {list.map(({ q, status }) => {
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
                <p className="quests-text">🔒 After {before.join(' and ')}.</p>
              ) : (
                <>
                  <p className="quests-text">{q.description}</p>
                  <ul className="quests-objectives">
                    {q.objectives.map((o) => {
                      const goal = objectiveGoal(o);
                      const got = Math.min(goal, objectiveProgress(p, q, o));
                      const key = `${q.id}/${o.id}`;
                      const have = o.type === 'handOver' ? handOverCount(p, o) : 0;
                      const give = Math.min(have, goal - got);
                      return [
                        o.type === 'extract' && o.find && (
                          <li key={`${o.id}/find`} className={got >= goal ? 'done' : ''}>
                            <span className="quests-tick">{got >= goal ? '✓' : '○'}</span>
                            <span className="quests-objective">{o.find}</span>
                          </li>
                        ),
                        <li key={o.id} className={got >= goal ? 'done' : ''}>
                          <span className="quests-tick">{got >= goal ? '✓' : '○'}</span>
                          <span className="quests-objective">
                            {objectiveText(items, o)}
                            {status !== 'available' && (
                              <span className="quests-progress">
                                <span className="vendors-bar-track">
                                  <span
                                    className="vendors-bar-fill"
                                    style={{ transform: `scaleX(${goal ? got / goal : 1})` }}
                                  />
                                </span>
                                {got} / {goal}
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
                        </li>,
                      ];
                    })}
                  </ul>
                </>
              )}
              <div className="quests-foot">
                <Rewards items={items} q={q} />
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
        {!list.length && <li className="raid-note">Nothing here.</li>}
      </ul>
      <p className="raid-note">
        Items are handed over from your stash, not from what you wear or carry. Rewards go into
        your stash, and rep counts toward {vendor.name}'s level.
      </p>
    </>
  );
}
