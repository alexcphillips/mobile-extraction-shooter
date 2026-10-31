import { stackSize, type ItemDb, type ItemDef } from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { readCheats, saveCheats, type Cheats } from '../admin-cheats';
import { colourOf } from './raid-screen';

/*
 * The admin page between raids (dev builds only, 2026-10-30): every item, given into the
 * stash free, for testing. The server only allows it under `wrangler dev`. The Admin tab
 * has the admin-only items (spawner guns); the Cheats tab turns on testing aids for your
 * next raids (see admin-cheats.ts).
 */

/** An admin item: a spawner gun (WeaponDef.spawns). These get their own tab. */
const isAdminItem = (d: ItemDef): boolean => d.type === 'weapon' && d.spawns !== undefined;

const TABS: readonly { label: string; shows: (d: ItemDef) => boolean }[] = [
  {
    label: 'Weapons',
    shows: (d) =>
      (d.type === 'weapon' || d.type === 'melee' || d.type === 'grenade') && !isAdminItem(d),
  },
  { label: 'Ammo', shows: (d) => d.type === 'ammo' },
  { label: 'Attachments', shows: (d) => d.type === 'attachment' },
  { label: 'Meds', shows: (d) => d.type === 'med' || d.type === 'repair' },
  { label: 'Gear', shows: (d) => d.type === 'armour' || d.type === 'container' },
  { label: 'Other', shows: (d) => d.type === 'key' || d.type === 'quest' || d.type === 'loot' },
  { label: 'Admin', shows: isAdminItem },
];

const CHEATS: readonly { key: keyof Cheats; label: string; hint: string }[] = [
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

/** The Cheats tab comes after the item tabs. */
const CHEATS_TAB = TABS.length;

export function AdminPage({
  items,
  notice,
  onBack,
  onStash,
  onGive,
}: {
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
  const tab = TABS[shown];
  const list = [...items.values()]
    .filter((d) => tab?.shows(d))
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
        {TABS.map((t, i) => (
          <button key={t.label} className={i === shown ? 'active' : ''} onClick={() => setShown(i)}>
            {t.label}
          </button>
        ))}
        <button
          className={shown === CHEATS_TAB ? 'active' : ''}
          onClick={() => setShown(CHEATS_TAB)}
        >
          Cheats
        </button>
        <span className="raid-spacer" />
        <button onClick={onStash}>Stash</button>
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      {!tab ? (
        <div className="vendors-body">
          <CheatsTab />
        </div>
      ) : (
        <div className="vendors-body">
          <ul className="vendors-offers">
            {list.map((def) => {
              const stack = stackSize(def);
              return (
                <li key={def.id}>
                  <span
                    className="vendors-icon"
                    style={{
                      background: colourOf(def),
                      aspectRatio: `${def.size[0]} / ${def.size[1]}`,
                    }}
                  />
                  <span className="vendors-name">{def.name}</span>
                  <button disabled={giving !== null} onClick={() => give(def, 1)}>
                    {giving === def.id ? 'Giving…' : 'Give 1'}
                  </button>
                  {stack > 1 && (
                    <button disabled={giving !== null} onClick={() => give(def, stack)}>
                      Give {stack}
                    </button>
                  )}
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
