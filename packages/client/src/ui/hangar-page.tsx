import {
  INTEL_DESK,
  POWER_GRID,
  cantCraft,
  cantUpgrade,
  craftDuration,
  craftLeft,
  itemDef,
  moduleCraft,
  moduleLevel,
  newStashItem,
  powerNeeded,
  recipeCost,
  rollsResult,
  upgradeCost,
  type ContractDef,
  type Craft,
  type HangarModuleDef,
  type Item,
  type ItemDb,
  type Profile,
  type ProfileResponse,
  type QuestDef,
  type RecipeDef,
} from '@mes/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { itemPortrait } from '../render/item-portrait';
import { Contracts, type ContractActions } from './hangar-contracts';
import { ItemDetails } from './item-details';
import { colourOf } from './raid-screen';
import { craftTime, resultChances, resultText, timeLeft, type Names } from './hangar-text';
import { ROMAN } from './vendors-page';

/*
 * The Hangar page between raids (session H3; design in docs/hangar.md): the modules down
 * the side with their levels, as the vendors page lists vendors, and the one picked beside
 * them: its levels and what they unlock, what the next one costs (have / need) and Upgrade,
 * the craft running with its time left or Collect, and its recipes with Craft. Upgrading
 * and crafting take items from the stash and ask for a second tap. Time left is on the
 * server's clock (the reply's `now`), not the phone's.
 */

/** The modules' colours down the side, in their order (the vendors page's amber first). */
const COLOURS = ['#e3a33a', '#c96a5a', '#6a9fc9', '#6cc98a', '#b08ad0', '#c9b25a', '#5ab8b0'];

/** How far the server's clock is ahead of this device's, from a reply. */
function skewOf(me: ProfileResponse): number {
  return me.now - Date.now();
}

export function HangarPage({
  modules,
  recipes,
  items,
  quests,
  contracts,
  names,
  mapName,
  me,
  notice,
  onBack,
  onStash,
  onUpgrade,
  onCraft,
  onCollect,
  contractActions,
}: {
  modules: readonly HangarModuleDef[];
  /** Every recipe, in their order. */
  recipes: readonly RecipeDef[];
  items: ItemDb;
  quests: readonly QuestDef[];
  /** The Intel desk's contracts (H6), by id. */
  contracts: ReadonlyMap<string, ContractDef>;
  names: Names;
  mapName: (id: string) => string;
  me: ProfileResponse;
  notice: string | null;
  onBack: () => void;
  onStash: () => void;
  /** Each resolves when done or refused. */
  onUpgrade: (module: HangarModuleDef) => Promise<void>;
  onCraft: (module: HangarModuleDef, recipe: RecipeDef) => Promise<void>;
  onCollect: (module: HangarModuleDef) => Promise<void>;
  contractActions: ContractActions;
}): ReactNode {
  const [shown, setShown] = useState(0);
  const [inspecting, setInspecting] = useState<Item | null>(null);
  const profile = me.profile;
  // The server's time, ticking each second while something is crafting, or on the Intel
  // desk (a contract's time left, the board's next day).
  const skew = useMemo(() => skewOf(me), [me]);
  const [now, setNow] = useState(() => Date.now() + skew);
  const running =
    Object.values(profile.crafts).some((c) => craftLeft(c, now) > 0) ||
    modules[shown]?.id === INTEL_DESK;
  // A new reply (a craft started) is caught up within the second.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(t);
  }, [skew, running]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape' && !inspecting) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, inspecting]);
  const module = modules[shown];
  if (!module) return null;
  const colour = COLOURS[shown % COLOURS.length]!;
  const own = recipes.filter((r) => r.module === module.id);
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
              colour={COLOURS[i % COLOURS.length]!}
              level={moduleLevel(profile, m.id)}
              craft={moduleCraft(profile, m.id)}
              now={now}
              active={i === shown}
              onClick={() => {
                setInspecting(null);
                setShown(i);
              }}
            />
          ))}
        </nav>
        <section className="vendors-main" style={{ ['--vendor' as string]: colour }}>
          <ModuleHead
            key={module.id}
            module={module}
            items={items}
            profile={profile}
            onUpgrade={() => onUpgrade(module)}
          />
          <CraftSlot
            items={items}
            module={module}
            recipes={recipes}
            craft={moduleCraft(profile, module.id)}
            now={now}
            onInspect={setInspecting}
            onCollect={() => onCollect(module)}
          />
          {module.id === INTEL_DESK && (
            <Contracts
              contracts={contracts}
              profile={profile}
              names={names}
              mapName={mapName}
              now={now}
              actions={contractActions}
            />
          )}
          {own.length > 0 && (
            <>
              <h3 className="hangar-heading">
                {module.id === INTEL_DESK ? 'Decryption' : 'Recipes'}
              </h3>
              <ul className="hangar-recipes">
                {own.map((r) => (
                  <RecipeCard
                    key={r.id}
                    items={items}
                    module={module}
                    recipe={r}
                    profile={profile}
                    names={names}
                    onInspect={setInspecting}
                    onCraft={() => onCraft(module, r)}
                  />
                ))}
              </ul>
            </>
          )}
          <p className="raid-note">
            Upgrades and crafts take plain items from your stash pages and the rigs and backpacks on
            them, never your worn gear. Crafts run while the game is closed, one at a time per
            module; a finished one waits here until you collect it.
          </p>
        </section>
      </div>
      {inspecting && (
        <ItemDetails
          items={items}
          item={inspecting}
          quests={quests}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}

/** A module in the list down the side: its initial, name and level, and a craft's state. */
function ModuleCard({
  module,
  colour,
  level,
  craft,
  now,
  active,
  onClick,
}: {
  module: HangarModuleDef;
  colour: string;
  level: number;
  craft: Craft | null;
  now: number;
  active: boolean;
  onClick: () => void;
}): ReactNode {
  const left = craft ? craftLeft(craft, now) : 0;
  return (
    <button
      className={`vendors-card${active ? ' active' : ''}${level ? '' : ' unbuilt'}`}
      style={{ ['--vendor' as string]: colour }}
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
          {craft && (
            <span className={`hangar-card-craft${left ? '' : ' ready'}`}>
              {left ? ` · ${timeLeft(left)}` : ' · Ready'}
            </span>
          )}
        </span>
      </span>
      {craft && !left ? <span className="vendors-badge">✓</span> : null}
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

/** A recipe's output as a new item, to draw and inspect. */
function useOutput(items: ItemDb, item: string, count: number): Item {
  return useMemo(() => newStashItem(items, { item, count }), [items, item, count]);
}

/** The craft in the module: running with its time left, or done with Collect. */
function CraftSlot({
  items,
  module,
  recipes,
  craft,
  now,
  onInspect,
  onCollect,
}: {
  items: ItemDb;
  module: HangarModuleDef;
  recipes: readonly RecipeDef[];
  craft: Craft | null;
  now: number;
  onInspect: (item: Item) => void;
  onCollect: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  if (!craft) return null;
  const left = craftLeft(craft, now);
  // A rolled recipe (a decryption, H5) keeps what it gives hidden until collected.
  const recipe = recipes.find((r) => r.id === craft.recipe);
  const rolled = !recipe || rollsResult(recipe) || craft.item === undefined;
  const shown = rolled ? recipe?.inputs[0]?.item : craft.item;
  return (
    <div className={`hangar-craft${left ? '' : ' ready'}`}>
      {shown && items.has(shown) ? (
        <CraftOutput
          items={items}
          item={shown}
          count={rolled ? 1 : craft.count!}
          label={rolled ? recipe?.name : undefined}
          onInspect={onInspect}
        />
      ) : (
        <span className="hangar-recipe-name">{recipe?.name ?? craft.recipe}</span>
      )}
      <span className="hangar-craft-state">
        {left ? (
          <>
            {rolled ? 'Decrypting' : 'Crafting'} · <b>{timeLeft(left)}</b> left
          </>
        ) : (
          <b>Ready</b>
        )}
      </span>
      <button
        className="primary"
        disabled={busy || left > 0}
        aria-label={`Collect from the ${module.name}`}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          void onCollect().finally(() => setBusy(false));
        }}
      >
        {busy ? 'Collecting…' : 'Collect'}
      </button>
    </div>
  );
}

/** A recipe's output: its picture on its rarity, name and count; a tap opens its details. */
function CraftOutput({
  items,
  item,
  count,
  label,
  onInspect,
}: {
  items: ItemDb;
  item: string;
  count: number;
  /** In place of the item's name (a rolled recipe's name). */
  label?: string | undefined;
  onInspect: (item: Item) => void;
}): ReactNode {
  const out = useOutput(items, item, count);
  const def = itemDef(items, item);
  const url = itemPortrait(items, out, def.size);
  return (
    <button
      className="hangar-output"
      style={{ ['--rarity' as string]: colourOf(def) }}
      aria-label={`${label ?? def.name}${count > 1 ? ` ×${count}` : ''}: details`}
      onClick={() => onInspect(out)}
    >
      <span className="vendors-offer-art">{url && <img src={url} alt="" draggable={false} />}</span>
      <span className="hangar-recipe-name">
        {label ?? def.name}
        {count > 1 && <span> ×{count}</span>}
      </span>
    </button>
  );
}

/** A recipe: its output, time, inputs (have / need) and Craft, which asks for a second tap. */
function RecipeCard({
  items,
  module,
  recipe,
  profile,
  names,
  onInspect,
  onCraft,
}: {
  items: ItemDb;
  module: HangarModuleDef;
  recipe: RecipeDef;
  profile: Profile;
  names: Names;
  onInspect: (item: Item) => void;
  onCraft: () => Promise<void>;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = moduleLevel(profile, module.id) < recipe.level;
  const bad = cantCraft(profile, module, recipe);
  const craft = (): void => {
    if (busy) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setBusy(true);
    void onCraft().finally(() => setBusy(false));
  };
  return (
    <li className={`hangar-recipe${locked ? ' locked' : ''}`}>
      {recipe.output ? (
        <CraftOutput
          items={items}
          item={recipe.output.item}
          count={recipe.output.count ?? 1}
          label={recipe.name}
          onInspect={onInspect}
        />
      ) : (
        <CraftOutput
          items={items}
          item={recipe.inputs[0]!.item}
          count={1}
          label={recipe.name ?? `Decrypt ${names.item(recipe.inputs[0]!.item)}`}
          onInspect={onInspect}
        />
      )}
      <div className="hangar-recipe-body">
        <span className="hangar-recipe-meta">
          {craftTime(craftDuration(profile, module, recipe) / 60_000)}
          {locked && ` · 🔒 level ${ROMAN[recipe.level]}`}
        </span>
        {rollsResult(recipe) && (
          <span className="hangar-results">
            One of:
            {resultChances(recipe).map(({ result, percent }, i) => (
              <span key={i} className="hangar-result">
                <span>{resultText(names, result)}</span>
                <b>{percent}%</b>
              </span>
            ))}
          </span>
        )}
        <span className="hangar-inputs">
          {recipeCost(profile, recipe).map((c) => (
            <Need key={c.item} items={items} item={c.item} have={c.have} need={c.need} />
          ))}
        </span>
        <button
          className={`primary${confirming ? ' confirm' : ''}`}
          disabled={busy || !!bad}
          title={bad ?? undefined}
          onBlur={() => setConfirming(false)}
          onClick={craft}
        >
          {busy
            ? 'Starting…'
            : confirming
              ? 'Use these items?'
              : rollsResult(recipe)
                ? 'Decrypt'
                : 'Craft'}
        </button>
      </div>
    </li>
  );
}
