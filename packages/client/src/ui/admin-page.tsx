import { stackSize, type ItemDb, type ItemDef } from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';
import {
  readCheats,
  readZombieCheats,
  saveCheats,
  saveZombieCheats,
  type Cheats,
  type ZombieCheats,
} from '../admin-cheats';
import { loadZombies, zombiesIds } from '../content';
import { colourOf } from './raid-screen';

/*
 * The admin page between raids (dev builds only, 2026-10-30): every item, given into the
 * stash free, for testing. The server only allows it under `wrangler dev`. The Admin tab
 * has the admin-only items (spawner guns, the admin backpack); the Cheats tab turns on testing aids for your
 * next raids (see admin-cheats.ts), and the Zombies tab zombies mode's (2026-11-04).
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
    shows: (d) => (d.type === 'armour' || d.type === 'container') && !isAdminItem(d),
  },
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

/**
 * Zombies mode's cheats: infinite points, and guns to start each game with: every gun any
 * mode's mystery box or death machine gives, those found only in zombies first.
 */
function ZombiesTab({ items }: { items: ItemDb }): ReactNode {
  const [cheats, setCheats] = useState(readZombieCheats);
  const save = (next: ZombieCheats): void => {
    saveZombieCheats(next);
    setCheats(next);
  };
  const guns = new Set<string>();
  for (const id of zombiesIds()) {
    const def = loadZombies(id);
    guns.add(def.powerups.minigun);
    for (const o of def.box) guns.add(o.item);
  }
  // Zombies-only guns are worth nothing to sell.
  const list = [...guns]
    .map((id) => items.get(id))
    .filter((d): d is ItemDef => d?.type === 'weapon')
    .sort((a, b) => Number(a.value > 0) - Number(b.value > 0) || a.name.localeCompare(b.name));
  const toggle = (id: string, on: boolean): void =>
    save({ ...cheats, guns: on ? [...cheats.guns, id] : cheats.guns.filter((g) => g !== id) });
  return (
    <div className="admin-cheats">
      <label className="toggle">
        <input
          type="checkbox"
          checked={cheats.infinitePoints}
          onChange={(e) => save({ ...cheats, infinitePoints: e.target.checked })}
        />
        <span>
          Infinite points
          <span className="raid-note"> · Doors, couches, wall guns and the box cost nothing.</span>
        </span>
      </label>
      <h3>Start with</h3>
      {list.map((d) => (
        <label key={d.id} className="toggle">
          <input
            type="checkbox"
            checked={cheats.guns.includes(d.id)}
            onChange={(e) => toggle(d.id, e.target.checked)}
          />
          <span>
            {d.name}
            {d.value === 0 && <span className="raid-note"> · zombies only</span>}
          </span>
        </label>
      ))}
      <p className="raid-note">
        Kept on this device; they apply from your next zombies game. Guns go in as bought ones do (a
        pistol in the sidearm slot, others in the two primaries), so a third rifle replaces one. In
        a game, the Admin button (or K) gives power-ups, points and guns.
      </p>
    </div>
  );
}

/** The Cheats and Zombies tabs come after the item tabs. */
const CHEATS_TAB = TABS.length;
const ZOMBIES_TAB = TABS.length + 1;

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
        <button
          className={shown === ZOMBIES_TAB ? 'active' : ''}
          onClick={() => setShown(ZOMBIES_TAB)}
        >
          Zombies
        </button>
        <span className="raid-spacer" />
        <button onClick={onStash}>Stash</button>
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      {!tab ? (
        <div className="vendors-body">
          {shown === ZOMBIES_TAB ? <ZombiesTab items={items} /> : <CheatsTab />}
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
