import { isMoney, itemDef, sellPrice, type Item, type ItemDb, type LeaveReason } from '@mes/shared';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clock } from '../hud/raid-hud';
import { describeSource, type DamageLog } from '../play/damage-log';
import type { SaveStatus } from '../raids';

/** How the raid ended for you, and what you came out with. */
export interface RaidResult {
  how: LeaveReason | 'killed';
  /** Where you extracted ("at North gate"), what killed you, or why you went missing. */
  detail: string;
  /** Time in the raid. */
  seconds: number;
  kills: number;
  /** Without quest items, which the server takes (session 14b). */
  kept: Item[];
  lost: Item[];
  /** Quest objectives the raid finished, as the server will count them. */
  quests: { quest: string; text: string }[];
  /** What hurt you during the raid, shown after a death. */
  taken: DamageLog;
  /** Everything kept: extracted, or the keep-gear admin cheat. */
  keptAll: boolean;
}

const TITLES: Record<RaidResult['how'], string> = {
  extracted: 'Extracted',
  killed: 'Killed in action',
  mia: 'Missing in action',
};

/** Items by name, with stacks and copies added up, in the order first seen. */
function tally(items: ItemDb, list: readonly Item[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const i of list) {
    const name = itemDef(items, i.item).name;
    counts.set(name, (counts.get(name) ?? 0) + i.count);
  }
  return [...counts];
}

function ItemList({ items, list, empty }: { items: ItemDb; list: Item[]; empty: string }) {
  const rows = tally(items, list);
  if (!rows.length) return <p className="results-empty">{empty}</p>;
  return (
    <ul>
      {rows.map(([name, n]) => (
        <li key={name}>
          {name}
          {n > 1 && <span className="results-count"> ×{n}</span>}
        </li>
      ))}
    </ul>
  );
}

const SAVE_TEXT: Record<SaveStatus['kind'] | 'saving', string> = {
  saving: 'Saving…',
  saved: 'Saved',
  queued:
    "Not saved yet: can't reach the server. It's kept on this phone and sent before your next raid.",
  refused: '',
  test: 'Play-test: nothing is saved. Continue plays it again.',
};

/** Whether the server has the result yet. */
function SaveLine({ saving }: { saving: Promise<SaveStatus> }) {
  const [status, setStatus] = useState<SaveStatus | null>(null);
  useEffect(() => {
    let live = true;
    saving
      .then((s) => live && setStatus(s))
      .catch(
        (err: unknown) =>
          live && setStatus({ kind: 'refused', message: `Not saved: ${String(err)}` }),
      );
    return () => {
      live = false;
    };
  }, [saving]);
  const kind = status?.kind ?? 'saving';
  return (
    <p className={`results-save ${kind}`}>
      {status?.kind === 'refused' ? status.message : SAVE_TEXT[kind]}
    </p>
  );
}

function Results({
  result,
  items,
  saving,
  onNext,
}: {
  result: RaidResult;
  items: ItemDb;
  saving: Promise<SaveStatus>;
  onNext: () => void;
}) {
  const survived = result.how === 'extracted';
  // Cash you kept goes into your money when the server has the result (session 13b).
  const cash = result.kept.reduce(
    (n, i) => n + (isMoney(items, i.item) ? sellPrice(items, i) : 0),
    0,
  );
  return (
    <div className={`results ${result.how}`}>
      <header>
        <h1>{TITLES[result.how]}</h1>
        <p>{result.detail}</p>
        <p className="results-stats">
          {clock(result.seconds)} in raid · {result.kills} {result.kills === 1 ? 'kill' : 'kills'}
        </p>
        <SaveLine saving={saving} />
      </header>
      <div className="results-cols">
        <section>
          <h2>
            {survived
              ? 'You brought out'
              : result.keptAll
                ? 'You kept everything (admin cheat)'
                : 'You kept (vault and knife)'}
          </h2>
          <ItemList items={items} list={result.kept} empty="Nothing" />
          {cash > 0 && (
            <p className="results-cash">{cash.toLocaleString()} cash goes into your money.</p>
          )}
        </section>
        {!result.keptAll && (
          <section>
            <h2>You lost</h2>
            <ItemList items={items} list={result.lost} empty="Nothing" />
          </section>
        )}
      </div>
      {result.how === 'killed' && result.taken.length > 0 && (
        <section className="results-damage">
          <h2>What hit you</h2>
          <ul>
            {result.taken.map((s) => (
              <li key={s.key} className={s.killed ? 'killer' : undefined}>
                {describeSource(s)}
                {s.killed && <span className="results-count"> · killing blow</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.quests.length > 0 && (
        <section className="results-quests">
          <h2>Quests</h2>
          <ul>
            {result.quests.map((q, i) => (
              <li key={i}>
                ✓ {q.text} <span className="results-count">· {q.quest}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button className="primary" onClick={onNext}>
        Continue
      </button>
    </div>
  );
}

/**
 * The results screen over the game when the raid ends for you: how it ended, time and
 * kills, what you keep, and whether the server has it yet. Loaded lazily, like the raid
 * screen. The button goes back to the main menu (by reloading the page).
 */
export function showResults(
  container: HTMLElement,
  result: RaidResult,
  items: ItemDb,
  saving: Promise<SaveStatus>,
  onNext: () => void,
): void {
  container.hidden = false;
  createRoot(container).render(
    <Results result={result} items={items} saving={saving} onNext={onNext} />,
  );
}
