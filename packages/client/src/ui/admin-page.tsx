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
import type { GameMode } from './last-raid';
import { colourOf } from './raid-screen';

/*
 * The admin page between raids (dev builds only, 2026-10-30): every item, given into the
 * stash free, for testing. The server only allows it under `wrangler dev`. The Admin tab
 * has the admin-only items (spawner guns, the admin backpack); the Cheats tab turns on testing aids for your
 * next raids (see admin-cheats.ts), and the Zombies tab zombies mode's (2026-11-04).
 * Opened from zombies' menu it shows only what zombies uses (2026-11-04, the user's call):
 * no items, as nothing from the stash goes in, and only the cheats a zombies game reads.
 */

/**
 * An admin item: a spawner gun (WeaponDef.spawns), or a container for testing (admin).
 * These get their own tab.
 */
const isAdminItem = (d: ItemDef): boolean =>
  (d.type === 'weapon' && d.spawns !== undefined) || (d.type === 'container' && !!d.admin);

/**
 * Items only zombies mode uses (the user's call, 2026-11-04), left out of extraction's tabs:
 * any mode's box guns, death machine and zombie claws worth nothing to sell (so not ones
 * also found in raids), and those guns' own ammo.
 */
function zombiesOnly(items: ItemDb): Set<string> {
  const ids = new Set<string>();
  for (const id of zombiesIds()) {
    const def = loadZombies(id);
    for (const item of [...def.box.map((o) => o.item), def.powerups.minigun, def.zombie.claws]) {
      const d = items.get(item);
      if (!d || d.value > 0) continue;
      ids.add(item);
      if (d.type === 'weapon' && items.get(d.ammo)?.value === 0) ids.add(d.ammo);
    }
  }
  return ids;
}

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
      (d.type === 'armour' || (d.type === 'container' && d.slot !== 'vault')) && !isAdminItem(d),
  },
  { label: 'Other', shows: (d) => d.type === 'key' || d.type === 'quest' || d.type === 'loot' },
  { label: 'Admin', shows: isAdminItem },
];

const CHEATS: readonly {
  key: keyof Cheats;
  label: string;
  hint: string;
  /** Extraction only: zombies has no meds to use up and no gear to keep. */
  extractionOnly?: boolean;
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
    extractionOnly: true,
  },
  {
    key: 'keepGear',
    label: 'Keep inventory on death',
    hint: 'Dying or going missing keeps everything, as if you extracted.',
    extractionOnly: true,
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
function CheatsTab({ mode }: { mode: GameMode }): ReactNode {
  const [cheats, setCheats] = useState(readCheats);
  const set = (key: keyof Cheats, on: boolean): void => {
    const next = { ...cheats, [key]: on };
    saveCheats(next);
    setCheats(next);
  };
  return (
    <div className="admin-cheats">
      {CHEATS.filter((c) => mode === 'extraction' || !c.extractionOnly).map((c) => (
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
      <p className="raid-note">
        Kept on this device, for both modes. They apply from your next{' '}
        {mode === 'zombies' ? 'game' : 'raid'}.
      </p>
    </div>
  );
}

/**
 * Zombies mode's cheats: infinite points, every kill dropping a power-up, and guns to start each game with: every gun any
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
      <label className="toggle">
        <input
          type="checkbox"
          checked={cheats.alwaysDrop}
          onChange={(e) => save({ ...cheats, alwaysDrop: e.target.checked })}
        />
        <span>
          Every kill drops a power-up
          <span className="raid-note"> · Past the 4-a-round limit too.</span>
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

/** A tab: items to give, or a page of cheats. */
type Tab =
  { label: string; shows: (d: ItemDef) => boolean } | { label: string; page: 'cheats' | 'zombies' };

/** Each mode's tabs: extraction's items and cheats, or zombies' own and the cheats it reads. */
const MODE_TABS: Record<GameMode, readonly Tab[]> = {
  extraction: [...TABS, { label: 'Cheats', page: 'cheats' }],
  zombies: [
    { label: 'Zombies', page: 'zombies' },
    { label: 'Cheats', page: 'cheats' },
  ],
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
  const [hidden] = useState(() => zombiesOnly(items));
  const list = [...items.values()]
    .filter((d) => 'shows' in tab && tab.shows(d) && !hidden.has(d.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const give = (def: ItemDef, count: number): void => {
    if (giving) return;
    setGiving(def.id);
    void onGive(def, count).finally(() => setGiving(null));
  };
  return (
    <div
      className={`raid stash vendors${mode === 'zombies' ? ' zombies' : ''}`}
      role="dialog"
      aria-label="Admin"
    >
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
          {tab.page === 'zombies' ? <ZombiesTab items={items} /> : <CheatsTab mode={mode} />}
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
