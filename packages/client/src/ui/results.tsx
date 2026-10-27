import { itemDef, type Item, type ItemDb, type LeaveReason } from '@mes/shared';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clock } from '../hud/raid-hud';
import type { SaveStatus } from '../raids';

/** How the raid ended for you, and what you came out with. */
export interface RaidResult {
  how: LeaveReason | 'killed';
  /** Where you extracted ("at North gate"), what killed you, or why you went missing. */
  detail: string;
  /** Time in the raid. */
  seconds: number;
  kills: number;
  kept: Item[];
  lost: Item[];
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
          <h2>{survived ? 'You brought out' : 'You kept (vault and knife)'}</h2>
          <ItemList items={items} list={result.kept} empty="Nothing" />
        </section>
        {!survived && (
          <section>
            <h2>You lost</h2>
            <ItemList items={items} list={result.lost} empty="Nothing" />
          </section>
        )}
      </div>
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
