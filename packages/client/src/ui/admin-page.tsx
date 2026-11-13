import { createItem, stackSize, type ItemDb, type ItemDef } from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { readCheats, saveCheats, type Cheats } from '../admin-cheats';
import type { GameMode } from './last-raid';
import { itemPortrait } from '../render/item-portrait';
import { colorOf } from './raid-screen';

/*
 * The admin page between raids (dev builds only, 2026-10-30): every item, given into the
 * stash free, for testing. The server only allows it under `wrangler dev`. The Admin tab
 * has the admin-only items (spawner guns, the admin backpack); the Cheats tab turns on testing aids for your
 * next raids (see admin-cheats.ts).
 */

/**
 * An admin item: a spawner gun (WeaponDef.spawns), or a container for testing (admin).
 * These get their own tab.
 */
const isAdminItem = (d: ItemDef): boolean =>
  (d.type === 'weapon' && d.spawns !== undefined) || (d.type === 'container' && !!d.admin);

const TABS: readonly { label: string; shows: (d: ItemDef) => boolean }[] = [
  {
    label: 'Weapons',
    shows: (d) =>
      (d.type === 'weapon' || d.type === 'melee' || d.type === 'grenade') && !isAdminItem(d),
  },
  { label: 'Ammo', shows: (d) => d.type === 'ammo' },
  { label: 'Attachments', shows: (d) => d.type === 'attachment' },
  { label: 'Meds', shows: (d) => d.type === 'med' || d.type === 'repair' },
  {
    label: 'Gear',
    // Not the vault, which is never an item to give (VAULT_ITEM).
    shows: (d) =>
      (d.type === 'armor' || (d.type === 'container' && d.slot !== 'vault')) && !isAdminItem(d),
  },
  { label: 'Other', shows: (d) => d.type === 'key' || d.type === 'quest' || d.type === 'loot' },
  { label: 'Admin', shows: isAdminItem },
];

const CHEATS: readonly {
  key: keyof Cheats;
  label: string;
  hint: string;
}[] = [
  {
    key: 'infiniteHealth',
    label: 'Infinite health',
    hint: 'Hits do nothing; no bleeding, no falls.',
  },
  {
    key: 'infiniteAmmo',
    label: 'Infinite ammo',
    hint: 'Firing uses no rounds; an empty gun reloads without spare ammo.',
  },
  {
    key: 'infiniteConsumables',
    label: 'Infinite consumables',
    hint: 'Meds and repair kits work but are never used up.',
  },
  {
    key: 'keepGear',
    label: 'Keep inventory on death',
    hint: 'Dying or going missing keeps everything, as if you extracted.',
  },
  {
    key: 'peaceful',
    label: 'Peaceful',
    hint: 'Enemies never notice you, even when you shoot them. Same as ?peaceful.',
  },
  {
    key: 'enemyHealth',
    label: 'Enemy health bars',
    hint: 'A health bar over every living enemy, seen through walls.',
  },
];

/** The cheat toggles, saved on this device as they change; they apply from the next raid. */
function CheatsTab(): ReactNode {
  const [cheats, setCheats] = useState(readCheats);
  const set = (key: keyof Cheats, on: boolean): void => {
    const next = { ...cheats, [key]: on };
    saveCheats(next);
    setCheats(next);
  };
  return (
    <div className="admin-cheats">
      {CHEATS.map((c) => (
        <label key={c.key} className="toggle">
          <input
            type="checkbox"
            checked={cheats[c.key]}
            onChange={(e) => set(c.key, e.target.checked)}
          />
          <span>
            {c.label}
            <span className="raid-note"> · {c.hint}</span>
          </span>
        </label>
      ))}
      <p className="raid-note">Kept on this device. They apply from your next raid.</p>
    </div>
  );
}

/** A tab: items to give, or a page of cheats. */
type Tab = { label: string; shows: (d: ItemDef) => boolean } | { label: string; page: 'cheats' };

/** Each mode's tabs: extraction's items and cheats. */
const MODE_TABS: Record<GameMode, readonly Tab[]> = {
  extraction: [...TABS, { label: 'Cheats', page: 'cheats' }],
};

export function AdminPage({
  mode,
  items,
  notice,
  onBack,
  onStash,
  onGive,
}: {
  /** The mode whose menu opened it, which picks the tabs. */
  mode: GameMode;
  items: ItemDb;
  notice: string | null;
  onBack: () => void;
  onStash: () => void;
  /** Gives `count` of an item; resolves when given or refused. */
  onGive: (def: ItemDef, count: number) => Promise<void>;
}): ReactNode {
  const [shown, setShown] = useState(0);
  const [giving, setGiving] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  const tabs = MODE_TABS[mode];
  const tab = tabs[shown] ?? tabs[0]!;
  const list = [...items.values()]
    .filter((d) => 'shows' in tab && tab.shows(d))
    .sort((a, b) => a.name.localeCompare(b.name));
  const give = (def: ItemDef, count: number): void => {
    if (giving) return;
    setGiving(def.id);
    void onGive(def, count).finally(() => setGiving(null));
  };
  return (
    <div className="raid stash vendors" role="dialog" aria-label="Admin">
      <header className="raid-tabs">
        <button onClick={onBack}>Back</button>
        {tabs.map((t, i) => (
          <button key={t.label} className={t === tab ? 'active' : ''} onClick={() => setShown(i)}>
            {t.label}
          </button>
        ))}
        <span className="raid-spacer" />
        {mode === 'extraction' && <button onClick={onStash}>Stash</button>}
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      {'page' in tab ? (
        <div className="vendors-body">
          <CheatsTab />
        </div>
      ) : (
        <div className="vendors-body">
          {/* As cards, like a vendor's goods (2026-11-06). */}
          <ul className="vendors-grid">
            {list.map((def) => {
              const stack = stackSize(def);
              const url = itemPortrait(items, createItem(items, def.id), def.size);
              return (
                <li
                  key={def.id}
                  className="admin-card"
                  style={{ ['--rarity' as string]: colorOf(def) }}
                >
                  <span className="vendors-offer-art">
                    {url && <img src={url} alt="" draggable={false} />}
                  </span>
                  <span className="vendors-offer-name">{def.name}</span>
                  <span className="admin-give">
                    <button disabled={giving !== null} onClick={() => give(def, 1)}>
                      {giving === def.id ? '…' : 'Give 1'}
                    </button>
                    {stack > 1 && (
                      <button disabled={giving !== null} onClick={() => give(def, stack)}>
                        ×{stack}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="raid-note">
            Dev server only. Items go into your stash, free.
            {tab.label === 'Admin' &&
              ' Spawner guns put an enemy wherever a shot lands; they harm no one and need no ammo.'}
          </p>
        </div>
      )}
    </div>
  );
}
