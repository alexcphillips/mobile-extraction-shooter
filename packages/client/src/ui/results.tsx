import {
  HEAD,
  isMoney,
  itemDef,
  levelProgress,
  raidGains,
  sellPrice,
  TICK_RATE,
  type Character,
  type Item,
  type ItemDb,
  type LeaveReason,
  type RaidXp,
  ZONE_NAMES,
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
  /**
   * After a death (2026-11-11): the latest fight, everyone in it both ways, newest hit
   * first, each with the other's name; and what killed you ("Scav", "Bled out").
   */
  combat?: (FightHit & { name: string })[];
  killedBy?: string;
  /** The fight with the enemy that killed you, newest hit first, if one did (2026-11-10). */
  fight?: { name: string; hits: FightHit[] } | undefined;
  /** Everything kept: extracted, or the keep-gear admin cheat. */
  keptAll: boolean;
  /** A zombies game (2026-11-04): how far you got. Nothing is kept or lost in one. */
  zombies?: { mode: string; round: number; points: number };
  /** The tutorial (TU-3): nothing is kept or lost in it either. */
  tutorial?: true;
  /** PMC XP the raid gave, line by line, and the XP before it (2026-11-11). Not in zombies or the tutorial. */
  xp?: RaidXp & { before: number };
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

/** A big number with its label, and beside it the button for its list (none: grayed). */
function BigStat({
  label,
  value,
  className = '',
  more,
  none,
  onMore,
}: {
  label: string;
  value: ReactNode;
  className?: string;
  more: string;
  none: string;
  onMore: (() => void) | null;
}) {
  return (
    <section className="victory-stat">
      <span className="victory-label">{label}</span>
      <div className="victory-row">
        <b className={`victory-big ${className}`}>{value}</b>
        <button
          className="victory-more"
          disabled={!onMore}
          aria-label={onMore ? more : none}
          title={onMore ? more : none}
          onClick={onMore ?? undefined}
        >
          <RowsIcon />
        </button>
      </div>
    </section>
  );
}

/** The value sheet: found-in-raid items you kept, dearest first. */
function ValueSheet({
  title,
  items,
  gains,
  total,
  onClose,
}: {
  title: string;
  items: ItemDb;
  gains: ReturnType<typeof raidGains>;
  total: number;
  onClose: () => void;
}) {
  return (
    <Sheet title={`${title} · ${money(total)}`} onClose={onClose}>
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
  );
}

/** The XP sheet: each line, the multiplier, and the level before and after. */
function XpSheet({ xp, onClose }: { xp: NonNullable<RaidResult['xp']>; onClose: () => void }) {
  const lines: [string, number][] = [
    ['Kills', xp.kills],
    ['Headshot bonus', xp.headshots],
    ['Searching', xp.searching],
  ];
  const mult = xp.runThrough ? 'Run-through' : xp.multiplier > 1 ? 'Survived' : 'Did not survive';
  return (
    <Sheet title={`PMC XP · +${xp.total.toLocaleString()}`} onClose={onClose}>
      <ul className="victory-list">
        {lines.map(([label, n]) => (
          <li key={label}>
            <span>{label}</span>
            <span>{n.toLocaleString()}</span>
          </li>
        ))}
        <li>
          <span>{mult}</span>
          <span className="results-count">×{xp.multiplier}</span>
        </li>
      </ul>
      <LevelLine xp={xp} />
      {xp.runThrough && (
        <p className="results-note">
          Run-through: out too soon with too little done, so XP is halved and nothing new is found
          in raid.
        </p>
      )}
    </Sheet>
  );
}

/** The PMC level after the raid, with a bar, and a level-up if there was one. */
function LevelLine({ xp }: { xp: NonNullable<RaidResult['xp']> }) {
  const was = levelProgress(xp.before).level;
  const now = levelProgress(xp.before + xp.total);
  return (
    <div className="results-level">
      <span>
        PMC level {now.level}
        {now.level > was && <b className="gain"> · level up!</b>}
      </span>
      {now.need !== null && (
        <>
          <span className="level-bar" aria-hidden>
            <span style={{ width: `${(100 * now.into) / now.need}%` }} />
          </span>
          <span className="results-count">
            {now.into.toLocaleString()} / {now.need.toLocaleString()} XP
          </span>
        </>
      )}
    </div>
  );
}

/** The kills sheet: who, and when in the raid. */
function KillsSheet({ kills, onClose }: { kills: RaidKill[]; onClose: () => void }) {
  return (
    <Sheet title={`Kills · ${kills.length}`} onClose={onClose}>
      <ol className="victory-list">
        {kills.map((k, i) => (
          <li key={i}>
            <span>{k.name}</span>
            <span className="results-count">{clock(k.tick / TICK_RATE)}</span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

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
  const [sheet, setSheet] = useState<'value' | 'kills' | 'xp' | null>(null);
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
          <BigStat
            label="Extracted value"
            value={money(total)}
            className="gain"
            more="View details"
            none="Nothing found in raid"
            onMore={gains.length ? () => setSheet('value') : null}
          />
          <BigStat
            label="Kills"
            value={result.kills}
            more="View kills"
            none="No kills"
            onMore={kills.length ? () => setSheet('kills') : null}
          />
          {result.xp && (
            <BigStat
              label={result.xp.runThrough ? 'PMC XP · run-through' : 'PMC XP'}
              value={`+${result.xp.total.toLocaleString()}`}
              more="View XP"
              none="No XP"
              onMore={() => setSheet('xp')}
            />
          )}
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
        <ValueSheet
          title="Extracted value"
          items={items}
          gains={gains}
          total={total}
          onClose={close}
        />
      )}
      {sheet === 'kills' && <KillsSheet kills={kills} onClose={close} />}
      {sheet === 'xp' && result.xp && <XpSheet xp={result.xp} onClose={close} />}
    </div>
  );
}

const HELMET_PATH = 'M3 15a9 9 0 0 1 18 0v2H3z M2 17h20v2H2z';
const VEST_PATH = 'M7 2h3l2 3 2-3h3l2 4v15H5V6z';

/**
 * A front-on body, one shape per zone in Health's order, facing you (its left on your
 * right), as the HUD's: the zones a hit landed on lit.
 */
function Ghost({ zones }: { zones: readonly string[] }) {
  const on = (z: number): string => (zones.includes(ZONE_NAMES[z]!) ? 'on' : '');
  return (
    <svg className="combat-ghost" viewBox="16 0 32 60" aria-hidden="true">
      <circle className={on(0)} cx="32" cy="6" r="5" />
      <rect className={on(1)} x="26" y="13" width="12" height="19" rx="1.5" />
      <rect className={on(2)} x="39.5" y="13" width="4.5" height="19" rx="1.5" />
      <rect className={on(3)} x="20" y="13" width="4.5" height="19" rx="1.5" />
      <rect className={on(4)} x="32.5" y="33.5" width="5.5" height="26" rx="1.5" />
      <rect className={on(5)} x="26" y="33.5" width="5.5" height="26" rx="1.5" />
    </svg>
  );
}

/**
 * One hit of the last fight (2026-11-11). Taken (red): the body you were hit on, the HP and
 * what armor took on the left; who, from how far (and, the fatal one, with what) on the
 * right. Dealt (gray): mirrored, with who you hit and from how far on the left.
 */
function CombatRow({ hit, items }: { hit: FightHit & { name: string }; items: ItemDb }) {
  const meters = hit.distance === undefined ? '—' : `${Math.round(hit.distance)}m`;
  const helmet = hit.zones.length === 1 && hit.zones[0] === ZONE_NAMES[HEAD];
  const name = (id: string | undefined): string | null =>
    id && items.has(id) ? itemDef(items, id).name : null;
  const gun = hit.killing ? name(hit.weapon) : null;
  const round = hit.killing ? name(hit.ammo) : null;
  return (
    <li className={`combat-row ${hit.dealt ? 'dealt' : 'taken'}${hit.killing ? ' killing' : ''}`}>
      <div className="combat-body">
        <Ghost zones={hit.zones} />
        <div className="combat-damage">
          <b>
            −{Math.round(hit.damage)}
            {hit.hits > 1 && <small> ×{hit.hits}</small>}
          </b>
          {hit.absorbed >= 1 && (
            <span className="combat-armor" title={helmet ? 'Helmet' : 'Armor'}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d={helmet ? HELMET_PATH : VEST_PATH} />
              </svg>
              −{Math.round(hit.absorbed)}
            </span>
          )}
        </div>
      </div>
      <div className="combat-who">
        <b className="combat-name">
          {hit.name}
          {hit.killing && <span className="combat-fatal"> · fatal</span>}
        </b>
        {gun && (
          <span className="combat-with">
            With: {gun}
            {round && ` | ${round}`}
          </span>
        )}
        <span className="combat-from">
          {hit.dealt ? 'Hits' : 'From'}: {meters}
        </span>
      </div>
    </li>
  );
}

/**
 * A death in a raid (2026-11-11): a red bar with the map, what killed you and the time;
 * what you found and kept (the vault's), in big numbers, and your kills, each with a list
 * behind a button; beside them the last fight, hit by hit both ways, the fatal one first.
 */
function Defeat({
  result,
  items,
  onNext,
}: {
  result: RaidResult;
  items: ItemDb;
  onNext: () => void;
}) {
  const [sheet, setSheet] = useState<'value' | 'kills' | 'xp' | null>(null);
  const [gains] = useState(() => raidGains(items, result.kept).sort((a, b) => b.price - a.price));
  const total = gains.reduce((n, g) => n + g.price, 0);
  const kills = result.killList ?? [];
  const combat = result.combat ?? [];
  const close = (): void => setSheet(null);
  return (
    <div className="results killed victory defeat">
      <header className="victory-bar">
        <h1>Extraction failed</h1>
        <dl className="victory-facts">
          <div>
            <dt>Map</dt>
            <dd>{result.map ?? '—'}</dd>
          </div>
          <div>
            <dt>Killed by</dt>
            <dd>{result.killedBy ?? result.detail}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{clock(result.seconds)}</dd>
          </div>
        </dl>
      </header>
      <div className="victory-main">
        <div className="victory-stats">
          <BigStat
            label="Match total"
            value={money(total)}
            className="gain"
            more="View details"
            none="Nothing found in raid kept"
            onMore={gains.length ? () => setSheet('value') : null}
          />
          <BigStat
            label="Kills"
            value={result.kills}
            more="View kills"
            none="No kills"
            onMore={kills.length ? () => setSheet('kills') : null}
          />
          {result.xp && (
            <BigStat
              label={result.xp.runThrough ? 'PMC XP · run-through' : 'PMC XP'}
              value={`+${result.xp.total.toLocaleString()}`}
              more="View XP"
              none="No XP"
              onMore={() => setSheet('xp')}
            />
          )}
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
        <section className="defeat-combat" aria-label="Last fight">
          <span className="victory-label">Last fight</span>
          {combat.length ? (
            <ol>
              {combat.map((h, i) => (
                <CombatRow key={i} hit={h} items={items} />
              ))}
            </ol>
          ) : (
            <p className="results-empty">No one hit you, and you hit no one.</p>
          )}
        </section>
      </div>
      <footer className="victory-foot">
        <button className="primary results-continue" onClick={onNext}>
          Continue
        </button>
      </footer>
      {sheet === 'value' && (
        <ValueSheet title="Match total" items={items} gains={gains} total={total} onClose={close} />
      )}
      {sheet === 'kills' && <KillsSheet kills={kills} onClose={close} />}
      {sheet === 'xp' && result.xp && <XpSheet xp={result.xp} onClose={close} />}
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
  if (result.how === 'killed' && result.combat)
    return <Defeat result={result} items={items} onNext={onNext} />;
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
          {result.xp && (
            <div>
              <dt>XP</dt>
              <dd>+{result.xp.total.toLocaleString()}</dd>
            </div>
          )}
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
        {result.xp && (
          <Panel title="PMC XP" className="results-quests">
            <LevelLine xp={result.xp} />
          </Panel>
        )}
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
