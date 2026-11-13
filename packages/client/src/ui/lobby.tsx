import {
  gearConflict,
  MOVEMENT,
  createGear,
  createHealth,
  createItem,
  equip,
  fitsSlot,
  giveWeapon,
  itemDef,
  wearArmor,
  type Character,
  type CompiledMap,
  type GearSlot,
  type Item,
  type ItemDb,
} from '@mes/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { itemPortrait } from '../render/item-portrait';
import { LobbyCharacter } from '../render/lobby-character';
import { MapOverview } from './map-overview';
import { colorOf, tileName } from './raid-screen';
import { RegionMap, type RegionSpot } from './region-map';

/*
 * The main menu as a lobby (2026-11-09, the user's request): your character in the middle
 * in the gear you're wearing, small buttons down the left, your loadout and Deploy on the
 * right, the mode switch top left. Deploy opens the map screen: pick a map, see it from
 * above with its extractions, then go. The menu's state and actions stay in main-menu.tsx;
 * these are the pieces it's drawn with.
 */

/** The mode's color, in CSS and for the plinth's ring. */
export const ACCENT = { extraction: 0xe3a33a, zombies: 0x8fc25a } as const;

// ---------------------------------------------------------------------------------------
// Icons: 24-unit line drawings in the text color.

const ICONS = {
  stash: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  vendors: 'M4 5h16l-1.5 9H6zM4 5L3 2H1M8 19a1.5 1.5 0 1 0 0.01 0M17 19a1.5 1.5 0 1 0 0.01 0',
  quests: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  hangar: 'M2 20V11a10 7 0 0 1 20 0v9M2 20h20M7 20v-6h10v6M12 14v6',
  friends:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  admin: 'M14.5 5.5a4 4 0 0 0-5 5L3 17l4 4 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-3-1-1-3z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.2a7 7 0 0 1-2-1.2l-1.9.8-2-3.5 1.6-1.2a7 7 0 0 1 0-2.4L4.6 10l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.2a7 7 0 0 1 2 1.2l1.9-.8 2 3.5-1.6 1.2a7 7 0 0 1 0 2.4z',
  party: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M18 8v6M15 11h6',
  modes: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  back: 'M19 12H5M11 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  exit: 'M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10',
  skull: 'M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14zM9 12h.01M15 12h.01M10 20v-2M14 20v-2',
  squad: 'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 22v-4a6 6 0 0 1 12 0v4',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }): ReactNode {
  return (
    <svg
      className="lobby-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------
// The character on its plinth.

/** A character standing still, for the lobby to show in some gear. */
function standing(gear: Character['gear']): Character {
  return {
    id: 1,
    kind: 'character',
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    mode: 'ground',
    height: MOVEMENT.standHeight,
    ladder: -1,
    vaulting: null,
    jumpHeld: false,
    landingSpeed: 0,
    health: createHealth(),
    gear,
    marked: false,
    aim: 0,
    draw: 0,
    swing: 0,
    using: null,
    extracting: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    ai: null,
  };
}

/**
 * You as the lobby shows you: your gear as it is, but with something in your hands if
 * the slot in hand is empty (the first gun you carry, else the knife), as you'd go in.
 */
export function lobbyLook(player: Character): Character {
  const g = player.gear;
  const hand =
    g.hand !== 'knife' && !g[g.hand]
      ? ((['primary1', 'primary2', 'sidearm'] as const).find((s) => g[s]) ?? 'knife')
      : g.hand;
  return standing({ ...g, hand });
}

/** Someone in a zombies mode's starting kit, the knife besides. */
export function kitLook(items: ItemDb, kit: readonly string[]): Character {
  const c = standing(createGear(false));
  for (const id of kit) {
    const def = itemDef(items, id);
    if (def.type === 'weapon') {
      giveWeapon(c, items, id);
    } else if (def.type === 'armor') {
      wearArmor(c, items, id);
    } else {
      const item = createItem(items, id);
      const slot = (['rig', 'backpack', 'knife'] as const).find((s) => fitsSlot(items, s, item));
      if (slot && !gearConflict(items, c.gear, slot, item)) equip(c, items, slot, item);
    }
  }
  return c;
}

export function CharacterStage({
  items,
  character,
  accent,
}: {
  items: ItemDb;
  character: Character;
  accent: number;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<LobbyCharacter | null>(null);
  useEffect(() => {
    const v = new LobbyCharacter(canvasRef.current!, items, accent);
    view.current = v;
    return () => {
      v.dispose();
      view.current = null;
    };
    // The accent and character are passed on below; a new view only for new items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  useEffect(() => view.current?.show(character), [character]);
  useEffect(() => view.current?.setAccent(accent), [accent]);
  return (
    <div className="lobby-stage" aria-hidden="true">
      <canvas ref={canvasRef} className="lobby-canvas" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// The buttons down the left.

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  /** A count in a red pill (new quests, friend requests). */
  badge?: number;
  /** Shown but not ready yet: a lock and a "Soon" tag (the Hangar). */
  soon?: boolean;
  disabled?: boolean;
  title?: string;
}

export function LobbyNav({ items }: { items: readonly NavItem[] }): ReactNode {
  return (
    <nav className="lobby-nav" aria-label="Menu">
      {items.map((n) => (
        <button
          key={n.id}
          data-nav={n.id}
          className={n.soon ? 'soon' : undefined}
          disabled={n.disabled}
          title={n.title}
          onClick={n.onClick}
        >
          <Icon name={n.icon} />
          <span className="lobby-nav-label">{n.label}</span>
          {n.soon && (
            <span className="lobby-soon">
              <Icon name="lock" size={11} /> Soon
            </span>
          )}
          {!!n.badge && <b className="lobby-badge">{n.badge}</b>}
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------------------
// The loadout card: what you're taking in, by slot.

const LOADOUT: readonly { slot: GearSlot; label: string; wide?: boolean }[] = [
  { slot: 'primary1', label: 'Primary', wide: true },
  { slot: 'helmet', label: 'Helmet' },
  { slot: 'primary2', label: 'Secondary', wide: true },
  { slot: 'bodyArmor', label: 'Armor' },
  { slot: 'sidearm', label: 'Sidearm' },
  { slot: 'rig', label: 'Rig' },
  { slot: 'backpack', label: 'Backpack' },
];

function LoadoutSlot({
  items,
  item,
  label,
  wide,
}: {
  items: ItemDb;
  item: Item | null;
  label: string;
  wide?: boolean | undefined;
}): ReactNode {
  if (!item) {
    return (
      <span className={`lobby-slot empty${wide ? ' wide' : ''}`}>
        <span className="lobby-slot-name">{label}</span>
      </span>
    );
  }
  const def = itemDef(items, item.item);
  const url = itemPortrait(items, item, wide ? [2, 1] : [1, 1]);
  return (
    <span
      className={`lobby-slot${wide ? ' wide' : ''}`}
      style={{ ['--rarity' as string]: colorOf(def) }}
      title={def.name}
    >
      {url && <img src={url} alt="" draggable={false} />}
      <span className="lobby-slot-name">{tileName(def)}</span>
    </span>
  );
}

export function LoadoutCard({
  items,
  player,
  worth,
  onOpen,
}: {
  items: ItemDb;
  player: Character;
  /** What it would all sell for. */
  worth: number;
  onOpen: () => void;
}): ReactNode {
  const gear = player.gear as unknown as Record<GearSlot, Item | null>;
  return (
    <button className="lobby-card lobby-loadout" onClick={onOpen} aria-label="Loadout: open stash">
      <span className="lobby-card-head">
        <span>Loadout</span>
        <span className="lobby-worth">${shortMoney(worth)}</span>
      </span>
      <span className="lobby-slots">
        {LOADOUT.map((s) => (
          <LoadoutSlot
            key={s.slot}
            items={items}
            item={gear[s.slot]}
            label={s.label}
            wide={s.wide}
          />
        ))}
      </span>
    </button>
  );
}

/** 1,234 → "1,234"; 12,345 → "12.3K"; 1,234,567 → "1.23M". */
export function shortMoney(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------------------
// Drawers (modes, party) and the deploy screen.

export function Drawer({
  side,
  title,
  onClose,
  children,
}: {
  side: 'left' | 'right';
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  useEscape(onClose);
  return (
    <div
      className="lobby-drawer-wrap"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className={`lobby-drawer ${side}`} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <span className="raid-spacer" />
          <button className="lobby-icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="lobby-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function useEscape(onClose: () => void): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** A mode in the mode drawer. */
export interface ModeCard {
  id: string;
  name: string;
  line: string;
  tags: string[];
}

export function ModeList({
  modes,
  current,
  disabled,
  onPick,
}: {
  modes: readonly ModeCard[];
  current: string;
  disabled: boolean;
  onPick: (id: string) => void;
}): ReactNode {
  return (
    <div className="lobby-modes" role="radiogroup" aria-label="Game mode">
      {modes.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={m.id === current}
          data-mode={m.id}
          className={m.id === current ? 'active' : undefined}
          disabled={disabled}
          onClick={() => onPick(m.id)}
        >
          <span className="lobby-mode-name">{m.name}</span>
          <span className="lobby-mode-line">{m.line}</span>
          <span className="lobby-mode-tags">
            {m.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A map (or zombies mode) on the deploy screen's list. */
export interface DeployEntry {
  id: string;
  name: string;
  /** Under the name: "20 min", "Solo · endless". */
  line: string;
  /** Beside the line: "starter". */
  tags?: readonly string[] | undefined;
  /** Its spot on the region map; with every entry placed, the region map stands in for the list. */
  at?: { x: number; y: number } | undefined;
  /** Why it can't be picked yet ("Level 2"), or null. */
  needs?: string | null | undefined;
}

/** The button that goes in: the raid button from main-menu.tsx. */
export interface DeployAction {
  label: string;
  primary: boolean;
  disabled: boolean;
  onClick: () => void;
  /** Under it: who's ready, or why it's off. */
  status?: string | undefined;
}

export function DeployScreen({
  title,
  entries,
  selected,
  onSelect,
  locked,
  map,
  info,
  action,
  onClose,
}: {
  title: string;
  entries: readonly DeployEntry[];
  selected: string;
  onSelect: (id: string) => void;
  /** Why the pick can't change (in someone else's party), or null. */
  locked: string | null;
  map: CompiledMap | null;
  info: ReactNode;
  action: DeployAction;
  onClose: () => void;
}): ReactNode {
  useEscape(onClose);
  // The region map (2026-11-11) when every entry has a spot on it; Layout shows the picked
  // map from above (its extracts), as the middle pane did before.
  const spots: RegionSpot[] | null = entries.every((e) => e.at)
    ? entries.map((e) => ({
        id: e.id,
        name: e.name,
        line: [e.line, ...(e.tags ?? [])].join(' · '),
        x: e.at!.x,
        y: e.at!.y,
        needs: e.needs ?? null,
      }))
    : null;
  const [view, setView] = useState<'region' | 'layout'>('region');
  const overview = map ? (
    <MapOverview map={map} />
  ) : (
    <p className="lobby-no-map">No overview yet</p>
  );
  return (
    <div className="lobby-deploy" role="dialog" aria-label={title}>
      <header className="lobby-deploy-top">
        <button className="lobby-back" aria-label="Back" onClick={onClose}>
          <Icon name="back" size={22} />
        </button>
        <h2>{title}</h2>
        <span className="raid-spacer" />
        {locked && <span className="lobby-locked">{locked}</span>}
      </header>
      <div className="lobby-deploy-body">
        {spots ? (
          <div className="lobby-overview lobby-region">
            {view === 'region' ? (
              <RegionMap spots={spots} selected={selected} onSelect={onSelect} frozen={!!locked} />
            ) : (
              overview
            )}
            <div className="lobby-view-toggle" role="radiogroup" aria-label="View">
              {(['region', 'layout'] as const).map((v) => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={view === v}
                  className={view === v ? 'on' : undefined}
                  onClick={() => setView(v)}
                >
                  {v === 'region' ? 'Region' : 'Layout'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="lobby-maps" role="radiogroup" aria-label="Map">
              {entries.map((e, i) => (
                <button
                  key={e.id}
                  role="radio"
                  aria-checked={e.id === selected}
                  className={e.id === selected ? 'active' : undefined}
                  disabled={(!!locked && e.id !== selected) || !!e.needs}
                  onClick={() => onSelect(e.id)}
                >
                  <span className="lobby-map-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lobby-map-name">{e.name}</span>
                  <span className="lobby-map-line">
                    {e.line}
                    {e.tags?.map((t) => (
                      <span key={t} className="lobby-map-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
            <div className="lobby-overview">{overview}</div>
          </>
        )}
        <div className="lobby-deploy-side">
          <div className="lobby-intel">{info}</div>
          <button
            className={`lobby-go${action.primary ? ' primary' : ''}`}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
          {action.status && <p className="lobby-go-status">{action.status}</p>}
        </div>
      </div>
    </div>
  );
}

/** A line of the deploy screen's intel: an icon, a label and its value. */
export function Fact({
  icon,
  label,
  block = false,
  children,
}: {
  icon: IconName;
  label: string;
  /** A long value (a list of guns): on its own line under the label. */
  block?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={`lobby-fact${block ? ' block' : ''}`}>
      <Icon name={icon} size={15} />
      <span className="lobby-fact-label">{label}</span>
      <span className="lobby-fact-value">{children}</span>
    </div>
  );
}
