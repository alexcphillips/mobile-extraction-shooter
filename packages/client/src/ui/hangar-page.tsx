import {
  POWER_GRID,
  cantUpgrade,
  itemDef,
  moduleLevel,
  powerNeeded,
  upgradeCost,
  type HangarModuleDef,
  type ItemDb,
  type Profile,
} from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { ROMAN } from './vendors-page';

/*
 * The Hangar page between raids (session H3; design in docs/hangar.md): the modules down
 * the side with their levels, as the vendors page lists vendors, and the one picked beside
 * them: its levels and what they unlock, what the next one costs (have / need) and Upgrade.
 * Upgrading takes items from the stash and asks for a second tap.
 */

/** The modules' colors down the side, in their order (the vendors page's amber first). */
const COLORS = ['#e3a33a', '#c96a5a', '#6a9fc9', '#6cc98a', '#b08ad0', '#c9b25a', '#5ab8b0'];

export function HangarPage({
  modules,
  start,
  items,
  profile,
  notice,
  onBack,
  onStash,
  onUpgrade,
}: {
  modules: readonly HangarModuleDef[];
  /** The module to show first (its id), or null for the first one. */
  start?: string | null;
  items: ItemDb;
  profile: Profile;
  notice: string | null;
  onBack: () => void;
  onStash: () => void;
  /** Resolves when done or refused. */
  onUpgrade: (module: HangarModuleDef) => Promise<void>;
}): ReactNode {
  const [shown, setShown] = useState(() =>
    Math.max(
      0,
      modules.findIndex((m) => m.id === start),
    ),
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  const module = modules[shown];
  if (!module) return null;
  const color = COLORS[shown % COLORS.length]!;
  return (
    <div className="raid stash vendors hangar" role="dialog" aria-label="Hangar">
      <header className="raid-tabs">
        <button onClick={onBack}>Back</button>
        <span className="stash-title">Hangar</span>
        <span className="raid-spacer" />
        <button onClick={onStash}>Stash</button>
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      <div className="vendors-layout">
        <nav className="vendors-list" role="tablist" aria-label="Modules">
          {modules.map((m, i) => (
            <ModuleCard
              key={m.id}
              module={m}
              color={COLORS[i % COLORS.length]!}
              level={moduleLevel(profile, m.id)}
              active={i === shown}
              onClick={() => setShown(i)}
            />
          ))}
        </nav>
        <section className="vendors-main" style={{ ['--vendor' as string]: color }}>
          <ModuleHead
            key={module.id}
            module={module}
            items={items}
            profile={profile}
            onUpgrade={() => onUpgrade(module)}
          />
          <p className="raid-note">
            Upgrades take plain items from your stash pages and the rigs and backpacks on them,
            never your worn gear.
          </p>
        </section>
      </div>
    </div>
  );
}

/** A module in the list down the side: its initial, name and level. */
function ModuleCard({
  module,
  color,
  level,
  active,
  onClick,
}: {
  module: HangarModuleDef;
  color: string;
  level: number;
  active: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      className={`vendors-card${active ? ' active' : ''}${level ? '' : ' unbuilt'}`}
      style={{ ['--vendor' as string]: color }}
      role="tab"
      aria-selected={active}
      onClick={onClick}
    >
      <span className="vendors-portrait" aria-hidden>
        {module.name[0]}
      </span>
      <span className="vendors-card-text">
        <b>{module.name}</b>
        <span className="vendors-ll" aria-label={level ? `level ${level}` : 'not built'}>
          {level ? ROMAN[level] : 'Not built'}
        </span>
      </span>
    </button>
  );
}

/**
 * The module picked: its name, level and blurb; each level and what it unlocks; and the
 * next level's cost (have / need), the Power grid it needs, and Upgrade (a second tap).
 */
function ModuleHead({
  module,
  items,
  profile,
  onUpgrade,
}: {
  module: HangarModuleDef;
  items: ItemDb;
  profile: Profile;
  onUpgrade: () => Promise<void>;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const level = moduleLevel(profile, module.id);
  const cost = upgradeCost(profile, module);
  const bad = cantUpgrade(profile, module);
  const power = level < module.levels.length ? powerNeeded(module, level + 1) : 0;
  const grid = moduleLevel(profile, POWER_GRID);
  const upgrade = (): void => {
    if (busy) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setBusy(true);
    void onUpgrade().finally(() => setBusy(false));
  };
  return (
    <header className="vendors-head">
      <div className="vendors-title">
        <h2>{module.name}</h2>
        <span className="vendors-ll big">{level ? `Level ${ROMAN[level]}` : 'Not built'}</span>
      </div>
      <p className="vendors-blurb">{module.blurb}</p>
      <ol className="hangar-levels">
        {module.levels.map((l, i) => (
          <li key={i} className={i < level ? 'done' : i === level ? 'next' : undefined}>
            <b>{ROMAN[i + 1]}</b> {l.unlocks}
          </li>
        ))}
      </ol>
      {cost ? (
        <div className="hangar-upgrade">
          <span>{level ? `To level ${ROMAN[level + 1]}:` : 'To build it:'}</span>
          {cost.map((c) => (
            <Need key={c.item} items={items} item={c.item} have={c.have} need={c.need} />
          ))}
          {power > 0 && (
            <span className={`hangar-need${grid >= power ? ' met' : ''}`}>
              Power grid {ROMAN[power]}
            </span>
          )}
          <button
            className={`primary${confirming ? ' confirm' : ''}`}
            disabled={busy || !!bad}
            title={bad ?? undefined}
            onBlur={() => setConfirming(false)}
            onClick={upgrade}
          >
            {busy
              ? 'Upgrading…'
              : confirming
                ? 'Use these items?'
                : level
                  ? `Upgrade to ${ROMAN[level + 1]}`
                  : 'Build'}
          </button>
          {bad && <span className="hangar-why">{sentence(bad)}</span>}
        </div>
      ) : (
        <p className="vendors-progress">Top level: everything it has is yours.</p>
      )}
    </header>
  );
}

/** A rule's reason as a sentence: "it needs …" to "It needs …." */
function sentence(why: string): string {
  return `${why[0]!.toUpperCase()}${why.slice(1)}.`;
}

/** An item a cost takes: its name and have / need, green once there are enough. */
function Need({
  items,
  item,
  have,
  need,
}: {
  items: ItemDb;
  item: string;
  have: number;
  need: number;
}): ReactNode {
  const name = itemDef(items, item).name;
  return (
    <span
      className={`hangar-need${have >= need ? ' met' : ''}`}
      aria-label={`${name}: ${have} of ${need}`}
    >
      {name} <b>{Math.min(have, 9999)}</b>/{need}
    </span>
  );
}
