import {
  isMoney,
  itemDef,
  raidGains,
  sellPrice,
  TICK_RATE,
  type Character,
  type Item,
  type ItemDb,
  type LeaveReason,
} from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { clock } from '../hud/raid-hud';
import {
  describeFightHit,
  describeSource,
  type DamageLog,
  type FightHit,
} from '../play/damage-log';
import { ItemTile, tallied } from './item-tile';
import { CharacterStage, lobbyLook } from './lobby';

/** A list of rows with bullets: opens a breakdown sheet. */
function RowsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="5" cy="6" r="1.6" />
        <circle cx="5" cy="12" r="1.6" />
        <circle cx="5" cy="18" r="1.6" />
      </g>
      <path
        d="M9.5 6H20M9.5 12H20M9.5 18H20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Someone you killed, and the tick they died on. */
export interface RaidKill {
  name: string;
  tick: number;
}

/** How the raid ended for you, and what you came out with. */
export interface RaidResult {
  how: LeaveReason | 'killed';
  /** Where you extracted ("at North gate"), what killed you, or why you went missing. */
  detail: string;
  /** Time in the raid. */
  seconds: number;
  kills: number;
  /** Who you killed, the latest first (2026-11-11). Missing in zombies and the tutorial. */
  killList?: RaidKill[];
  /** The raid's name, for the victory screen. */
  map?: string;
  /** The extraction point you left by, if you did. */
  place?: string;
  /** You as you came out (a copy), for the victory screen's character. */
  player?: Character;
  /** Without quest items, which the server takes (session 14b). */
  kept: Item[];
  lost: Item[];
  /** Quest objectives the raid finished, as the server will count them. */
  quests: { quest: string; text: string }[];
  /** What hurt you during the raid, shown after a death. */
  taken: DamageLog;
  /** The fight with the enemy that killed you, newest hit first, if one did (2026-11-10). */
  fight?: { name: string; hits: FightHit[] } | undefined;
  /** Everything kept: extracted, or the keep-gear admin cheat. */
  keptAll: boolean;
  /** A zombies game (2026-11-04): how far you got. Nothing is kept or lost in one. */
  zombies?: { mode: string; round: number; points: number };
  /** The tutorial (TU-3): nothing is kept or lost in it either. */
  tutorial?: true;
}

/** The fight with your killer, hit by hit both ways, the latest at the top. */
function FightRows({ fight }: { fight: NonNullable<RaidResult['fight']> }) {
  return (
    <ol className="results-fight">
      {fight.hits.map((h, i) => (
        <li key={i} className={`${h.dealt ? 'dealt' : 'taken'}${h.killing ? ' killer' : ''}`}>
          <span className="results-count">{clock(h.tick / TICK_RATE)}</span>{' '}
          {describeFightHit(h, fight.name)}
          {h.killing && <span className="results-count"> · killing blow</span>}
        </li>
      ))}
    </ol>
  );
}

const TITLES: Record<RaidResult['how'], string> = {
  extracted: 'Extracted',
  killed: 'Killed in action',
  mia: 'Missing in action',
};

/** Items as tiles, a tile per kind with its count, dearest first; or a line if there are none. */
function Tiles({
  items,
  list,
  empty,
  lost = false,
}: {
  items: ItemDb;
  list: readonly Item[];
  empty: string;
  lost?: boolean;
}) {
  const rows = tallied(list, (i) => sellPrice(items, i));
  if (!rows.length) return <p className="results-empty">{empty}</p>;
  return (
    <div className="results-tiles">
      {rows.map((r) => (
        <ItemTile key={r.item.item} items={items} item={r.item} count={r.count} lost={lost} />
      ))}
    </div>
  );
}

/** A panel of the results screen: a title bar and what's in it. */
function Panel({
  title,
  aside,
  className = '',
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`results-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** The items you found and kept, at vendor prices, line by line, and their sum: 0 if nothing's new. */
function Gain({ items, result }: { items: ItemDb; result: RaidResult }) {
  const gains = raidGains(items, result.kept);
  const total = gains.reduce((n, g) => n + g.price, 0);
  return (
    <Panel
      title="Raid gain"
      className="results-gain"
      aside={<b className="results-gain-total">{total.toLocaleString()}</b>}
    >
      {gains.length > 0 ? (
        <ul>
          {gains.map((g) => (
            <li key={g.id}>
              <span>
                {itemDef(items, g.id).name}
                {g.count > 1 && <span className="results-count"> ×{g.count}</span>}
              </span>
              <span>{g.price.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="results-empty">Nothing found in this raid came out with you.</p>
      )}
      <p className="results-note">Found in raid, at vendor prices (cash at its full value).</p>
    </Panel>
  );
}

/** A zombies game's end: the round reached, kills and points, and what got you. */
function ZombiesResults({
  result,
  zombies,
  onNext,
}: {
  result: RaidResult;
  zombies: NonNullable<RaidResult['zombies']>;
  onNext: () => void;
}) {
  return (
    <div className="results killed">
      <header>
        <h1>Game over</h1>
        <p>
          {zombies.mode} · round {zombies.round}
        </p>
        <p className="results-stats">
          {clock(result.seconds)} survived · {result.kills} {result.kills === 1 ? 'kill' : 'kills'}{' '}
          · {zombies.points.toLocaleString()} points left
        </p>
        <p className="results-save test">Zombies: nothing from your stash goes in or comes out.</p>
      </header>
      {result.fight && (
        <section className="results-damage">
          <h2>Fight with {result.fight.name}</h2>
          <FightRows fight={result.fight} />
        </section>
      )}
      {result.taken.length > 0 && (
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
      <button className="primary" onClick={onNext}>
        Continue
      </button>
    </div>
  );
}

/**
 * The tutorial's end (TU-3): what extracting means, then on to the account (or the menu,
 * played again). Killed, it offers another go.
 */
function TutorialResults({ result, onNext }: { result: RaidResult; onNext: () => void }) {
  const out = result.how === 'extracted';
  return (
    <div className={`results ${result.how}`}>
      <header>
        <h1>{out ? 'Extracted' : TITLES[result.how]}</h1>
        <p className="results-stats">
          Tutorial · {clock(result.seconds)} · {result.kills}{' '}
          {result.kills === 1 ? 'kill' : 'kills'}
        </p>
        <p>
          {out
            ? "That's a raid: go in with your gear, take what you find, and get out alive. Die in a real raid and you lose everything you carried in."
            : 'Die in a real raid and you lose everything you carried in. Nothing was at stake here.'}
        </p>
      </header>
      {!out && <button onClick={() => location.reload()}>Try again</button>}
      <button className="primary" onClick={onNext}>
        Continue
      </button>
    </div>
  );
}

/** The victory screen's pop-up list: the value's breakdown or the kills. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="victory-backdrop" onClick={onClose}>
      <section
        className="victory-sheet"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button className="victory-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

const money = (n: number): string => `$${n.toLocaleString()}`;

/**
 * A successful extract (2026-11-11): a thin bar with the map, extraction point and time;
 * then what you came out with that you didn't bring in, in big numbers, and your kills,
 * each with a list behind a button; you, on the menu's plinth, on the right.
 */
function Victory({
  result,
  player,
  items,
  onNext,
}: {
  result: RaidResult;
  player: Character;
  items: ItemDb;
  onNext: () => void;
}) {
  const [sheet, setSheet] = useState<'value' | 'kills' | null>(null);
  const [gains] = useState(() => raidGains(items, result.kept).sort((a, b) => b.price - a.price));
  const [look] = useState(() => lobbyLook(player));
  const total = gains.reduce((n, g) => n + g.price, 0);
  const kills = result.killList ?? [];
  const close = (): void => setSheet(null);
  return (
    <div className="results extracted victory">
      <header className="victory-bar">
        <h1>Extracted</h1>
        <dl className="victory-facts">
          <div>
            <dt>Map</dt>
            <dd>{result.map ?? '—'}</dd>
          </div>
          <div>
            <dt>Extraction</dt>
            <dd>{result.place ?? '—'}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{clock(result.seconds)}</dd>
          </div>
        </dl>
      </header>
      <div className="victory-main">
        <div className="victory-stats">
          <section className="victory-stat">
            <span className="victory-label">Extracted value</span>
            <div className="victory-row">
              <b className="victory-big gain">{money(total)}</b>
              <button
                className="victory-more"
                disabled={!gains.length}
                aria-label={gains.length ? 'View details' : 'Nothing found in raid'}
                title={gains.length ? 'View details' : 'Nothing found in raid'}
                onClick={() => setSheet('value')}
              >
                <RowsIcon />
              </button>
            </div>
          </section>
          <section className="victory-stat">
            <span className="victory-label">Kills</span>
            <div className="victory-row">
              <b className="victory-big">{result.kills}</b>
              <button
                className="victory-more"
                disabled={!kills.length}
                aria-label={kills.length ? 'View kills' : 'No kills'}
                title={kills.length ? 'View kills' : 'No kills'}
                onClick={() => setSheet('kills')}
              >
                <RowsIcon />
              </button>
            </div>
          </section>
          {result.quests.length > 0 && (
            <ul className="victory-quests">
              {result.quests.map((q, i) => (
                <li key={i}>
                  ✓ {q.text} <span className="results-count">· {q.quest}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="victory-character">
          <CharacterStage items={items} character={look} accent={0x4fd06a} />
        </div>
      </div>
      <footer className="victory-foot">
        <button className="primary results-continue" onClick={onNext}>
          Continue
        </button>
      </footer>
      {sheet === 'value' && (
        <Sheet title={`Extracted value · ${money(total)}`} onClose={close}>
          <ul className="victory-list">
            {gains.map((g) => (
              <li key={g.id}>
                <span>
                  {itemDef(items, g.id).name}
                  {g.count > 1 && !isMoney(items, g.id) && (
                    <span className="results-count"> ×{g.count}</span>
                  )}
                </span>
                <span className="gain">{money(g.price)}</span>
              </li>
            ))}
          </ul>
          <p className="results-note">Found in raid, at vendor prices (cash at its full value).</p>
        </Sheet>
      )}
      {sheet === 'kills' && (
        <Sheet title={`Kills · ${kills.length}`} onClose={close}>
          <ol className="victory-list">
            {kills.map((k, i) => (
              <li key={i}>
                <span>{k.name}</span>
                <span className="results-count">{clock(k.tick / TICK_RATE)}</span>
              </li>
            ))}
          </ol>
        </Sheet>
      )}
    </div>
  );
}

function Results({
  result,
  items,
  onNext,
}: {
  result: RaidResult;
  items: ItemDb;
  onNext: () => void;
}) {
  if (result.zombies)
    return <ZombiesResults result={result} zombies={result.zombies} onNext={onNext} />;
  if (result.tutorial) return <TutorialResults result={result} onNext={onNext} />;
  if (result.how === 'extracted' && result.player)
    return <Victory result={result} player={result.player} items={items} onNext={onNext} />;
  const survived = result.how === 'extracted';
  // Cash you kept goes into your money when the server has the result (session 13b).
  const cash = result.kept.reduce(
    (n, i) => n + (isMoney(items, i.item) ? sellPrice(items, i) : 0),
    0,
  );
  const gain = raidGains(items, result.kept).reduce((n, g) => n + g.price, 0);
  const lost = result.lost.reduce((n, i) => n + sellPrice(items, i), 0);
  return (
    <div className={`results ${result.how}`}>
      <header className="results-banner">
        <div>
          <h1>{TITLES[result.how]}</h1>
          <p className="results-detail">{result.detail}</p>
        </div>
        <dl className="results-stats">
          <div>
            <dt>Time</dt>
            <dd>{clock(result.seconds)}</dd>
          </div>
          <div>
            <dt>Kills</dt>
            <dd>{result.kills}</dd>
          </div>
          <div>
            <dt>Raid gain</dt>
            <dd className="gain">{gain.toLocaleString()}</dd>
          </div>
          {!result.keptAll && lost > 0 && (
            <div>
              <dt>Lost</dt>
              <dd className="loss">{lost.toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </header>
      <div className="results-grid">
        <Panel
          title={
            survived
              ? 'You brought out'
              : result.keptAll
                ? 'You kept everything (admin cheat)'
                : 'You kept (vault and knife)'
          }
        >
          <Tiles items={items} list={result.kept} empty="Nothing" />
          {cash > 0 && (
            <p className="results-cash">{cash.toLocaleString()} cash goes into your money.</p>
          )}
        </Panel>
        {!result.keptAll && (
          <Panel title="You lost" className="results-lost">
            <Tiles items={items} list={result.lost} empty="Nothing" lost />
          </Panel>
        )}
        <Gain items={items} result={result} />
        {result.how === 'killed' && result.fight && (
          <Panel title={`Fight with ${result.fight.name}`} className="results-damage">
            <FightRows fight={result.fight} />
          </Panel>
        )}
        {result.how === 'killed' && result.taken.length > 0 && (
          <Panel title="What hit you" className="results-damage">
            <ul>
              {result.taken.map((s) => (
                <li key={s.key} className={s.killed ? 'killer' : undefined}>
                  {describeSource(s)}
                  {s.killed && <span className="results-count"> · killing blow</span>}
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {result.quests.length > 0 && (
          <Panel title="Quests" className="results-quests">
            <ul>
              {result.quests.map((q, i) => (
                <li key={i}>
                  ✓ {q.text} <span className="results-count">· {q.quest}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <button className="primary results-continue" onClick={onNext}>
        Continue
      </button>
    </div>
  );
}

/**
 * The results screen over the game when the raid ends for you: how it ended, time and
 * kills, and what you keep. Loaded lazily, like the raid
 * screen. The button goes back to the main menu (by reloading the page).
 */
export function showResults(
  container: HTMLElement,
  result: RaidResult,
  items: ItemDb,
  onNext: () => void,
): void {
  container.hidden = false;
  createRoot(container).render(<Results result={result} items={items} onNext={onNext} />);
}
