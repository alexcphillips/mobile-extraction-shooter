import {
  ATTACHMENT_SLOTS,
  cantSell,
  createWeaponStats,
  itemDef,
  loadedAmmo,
  lootContainerById,
  revealed,
  sellPrice,
  sellTotal,
  stackSize,
  stashPageOf,
  timeToUse,
  weaponStats,
  type Character,
  type GearSlot,
  type Grid,
  type GridName,
  type GridRef,
  type InGrid,
  type AttachmentSlot,
  type Item,
  type ItemDb,
  type ItemDef,
  type ItemRef,
  type Owner,
  type Rarity,
  type WeaponState,
  VAULT_ITEM,
  maxDurability,
  CHEST,
  HEAD,
  HEALTH,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_ARM,
  RIGHT_LEG,
  isBleeding,
  isBroken,
} from '@mes/shared';
import { inputMode } from '../input/mode';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { itemPortrait } from '../render/item-portrait';
import { refKey, type InventoryController } from './inventory-controller';
import { ItemDetails } from './item-details';
import { MapTab } from './map-tab';
import type { RaidContext } from './raid';
import { levelColour, levelOf } from './levels';
import { RaidQuests } from './raid-quests';
import { CATEGORIES, type Category } from './stash-search';
import { favourites, holdsFavourite, toggleFavourite } from './favourites';
import { settings } from '../settings';
import { sectionBoxes } from './inventory-layout';
import { ZONE_COLOURS, zoneColour } from '../hud/vitals';

type Tab = 'inventory' | 'map' | 'quests';

/** Searching the stash, for the page shown (ui/stash-search.ts). Null anywhere else. */
export interface StashSearch {
  query: string;
  setQuery: (query: string) => void;
  category: Category;
  setCategory: (category: Category) => void;
  /** Is this item one being looked for? Null with nothing typed and no category. */
  hit: ((item: Item) => boolean) | null;
  /** How many items are found on every page. */
  found: number;
  /** The stash panel's title and the rest of its header: cells used, sort. */
  title: ReactNode;
  head: ReactNode;
  /** The page tabs and buying a page, down the right of the grid (UX-3, 2026-11-08). */
  tabs: ReactNode;
}

export const StashSearchContext = createContext<StashSearch | null>(null);

interface Props {
  inv: InventoryController;
  /** Bumped whenever the state may have changed, to redraw. */
  version: number;
}

/** The in-raid screen: inventory (with looting), map and quests tabs. */
export function RaidScreen({ inv, version, ctx }: Props & { ctx: RaidContext }): ReactNode {
  const [tab, setTab] = useState<Tab>('inventory');
  // Not Esc (2026-10-30): browsers won't capture the mouse again from it. Tab or Close.
  const close = inv.ctx.close;
  return (
    <div className="raid" role="dialog" aria-label="Raid">
      <header className="raid-tabs">
        <span className="raid-tab-strip" role="tablist" aria-label="Raid screen">
          {(['inventory', 'map', 'quests'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tab}
              className={t === tab ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </span>
        <span className="raid-spacer" />
        <HealthStrip c={ctx.player} />
        <UsePill inv={inv} />
        <button className="primary" onClick={close}>
          Close
        </button>
      </header>
      {tab === 'inventory' ? (
        <Inventory inv={inv} version={version} />
      ) : tab === 'map' ? (
        <MapTab map={ctx.map} sim={ctx.sim} player={ctx.player} version={version} />
      ) : (
        <RaidQuests
          items={ctx.items}
          profile={ctx.profile}
          quests={ctx.quests}
          sim={ctx.sim}
          player={ctx.player}
          map={ctx.map.id}
        />
      )}
    </div>
  );
}

/**
 * Your health while the raid screen is open (2026-11-06): the HUD's body is too tall for
 * the top bar on a phone, so it hides, and this small one sits in the bar instead. Each
 * zone in its colour (bleeding ones pulse), and chips for bleeding and broken limbs; no
 * total, as on the HUD.
 */
function HealthStrip({ c }: { c: Character }): ReactNode {
  const h = c.health;
  if (h.pool !== undefined) return null;
  const fill = (zone: number) => ZONE_COLOURS[zoneColour(h.hp[zone]!, HEALTH.maxHp[zone]!)];
  const bleed = (zone: number) => (h.bleeding[zone] ? 'bleed' : undefined);
  const broken = ([LEFT_ARM, RIGHT_ARM, LEFT_LEG, RIGHT_LEG] as const).filter((z) =>
    isBroken(h, z),
  ).length;
  const hp = (zone: number) => Math.ceil(h.hp[zone]!);
  return (
    <span
      className="raid-health"
      role="img"
      aria-label={`Head ${hp(HEAD)}, chest ${hp(CHEST)}${isBleeding(h) ? ', bleeding' : ''}${broken ? `, ${broken} broken` : ''}`}
      title={`Head ${hp(HEAD)} · Chest ${hp(CHEST)} · Arms ${hp(LEFT_ARM)}/${hp(RIGHT_ARM)} · Legs ${hp(LEFT_LEG)}/${hp(RIGHT_LEG)}`}
    >
      <svg viewBox="16 0 32 60" width="16" height="28" aria-hidden>
        <circle cx="32" cy="6" r="5" fill={fill(HEAD)} className={bleed(HEAD)} />
        <rect
          x="26"
          y="13"
          width="12"
          height="19"
          rx="1.5"
          fill={fill(CHEST)}
          className={bleed(CHEST)}
        />
        <rect
          x="39.5"
          y="13"
          width="4.5"
          height="19"
          rx="1.5"
          fill={fill(LEFT_ARM)}
          className={bleed(LEFT_ARM)}
        />
        <rect
          x="20"
          y="13"
          width="4.5"
          height="19"
          rx="1.5"
          fill={fill(RIGHT_ARM)}
          className={bleed(RIGHT_ARM)}
        />
        <rect
          x="32.5"
          y="33.5"
          width="5.5"
          height="26"
          rx="1.5"
          fill={fill(LEFT_LEG)}
          className={bleed(LEFT_LEG)}
        />
        <rect
          x="26"
          y="33.5"
          width="5.5"
          height="26"
          rx="1.5"
          fill={fill(RIGHT_LEG)}
          className={bleed(RIGHT_LEG)}
        />
      </svg>
      <span className="raid-health-hp">
        {hp(HEAD)}
        <small> head</small> {hp(CHEST)}
        <small> chest</small>
      </span>
      {isBleeding(h) && <span className="chip bleed">🩸</span>}
      {broken > 0 && <span className="chip">🦴{broken > 1 ? ` ×${broken}` : ''}</span>}
    </span>
  );
}

const SELF: Owner = { kind: 'self' };
const subscribeSettings = (onChange: () => void): (() => void) => settings.subscribe(onChange);
// Head, chest, then the guns: each primary with the sidearm or the knife beside it
// (2026-11-09, the user's call; they were under both primaries before).
const MY_SLOTS: readonly GearSlot[] = [
  'helmet',
  'bodyArmour',
  'primary1',
  'sidearm',
  'primary2',
  'knife',
];
const BODY_SLOTS: readonly GearSlot[] = ['helmet', 'bodyArmour', 'primary1', 'sidearm', 'primary2'];
/**
 * Not on a PC, where the loadout and what you carry are one column (2026-11-09, the user's
 * call): the guns first, then the helmet and armour side by side, then the rig and the rest.
 */
const PHONE_SLOTS: readonly GearSlot[] = [
  'primary1',
  'sidearm',
  'primary2',
  'knife',
  'helmet',
  'bodyArmour',
];
const SLOT_NAMES: Record<GearSlot, string> = {
  primary1: 'Primary 1',
  primary2: 'Primary 2',
  sidearm: 'Sidearm',
  knife: 'Knife',
  helmet: 'Helmet',
  bodyArmour: 'Armour',
  rig: 'Rig',
  backpack: 'Backpack',
};
/**
 * What an empty gear slot shows faintly, so you can tell the slots apart at a glance
 * (2026-11-09): a bare M416 in the gun slots. The others to follow.
 */
const SLOT_GHOSTS: Partial<Record<GearSlot, string>> = { primary1: 'm416', primary2: 'm416' };

/** An empty slot's ghost: its item's picture as a flat light grey shape. */
function SlotGhost({ items, slot }: { items: ItemDb; slot: GearSlot }): ReactNode {
  const id = SLOT_GHOSTS[slot];
  const def = id ? items.get(id) : undefined;
  if (!def) return null;
  const url = itemPortrait(items, { item: def.id, count: 1 }, def.size);
  if (!url) return null;
  return (
    <span
      className="inv-slot-ghost"
      style={{ maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` }}
    />
  );
}

/** Primaries are drawn twice as wide, a small slot beside each; the helmet and armour have a row each, centred. */
const WIDE: ReadonlySet<GearSlot> = new Set(['primary1', 'primary2']);
const CENTRE: ReadonlySet<GearSlot> = new Set(['helmet', 'bodyArmour']);

/** Your gear and grids, beside what's open (a body, a container, the ground or the stash). */
export function Inventory({ inv, version }: Props): ReactNode {
  useEffect(
    () => () => {
      inv.drag.cancel();
      inv.cancelOpen();
    },
    [inv],
  );
  inv.followSelection();
  const { ctx, selected, layout } = inv;
  const sel = selected && inv.find(selected);
  const [help, setHelp] = useState(false);
  // Favouriting changes the settings: redraw for it.
  useSyncExternalStore(subscribeSettings, () => settings.current);
  const favs = favourites();
  const [hover, setHover] = useState<Hover | null>(null);
  // The hover card is for a mouse: on a phone a tap opens the details.
  const onPointerMove = (e: ReactPointerEvent): void => {
    if (e.pointerType !== 'mouse' || inv.drag.busy) return setHover(null);
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ref]');
    setHover(el ? { ref: el.dataset.ref!, x: e.clientX, y: e.clientY } : null);
  };
  return (
    <div
      className="inv"
      style={{ ['--cell' as string]: `${inv.cell}px` }}
      data-version={version}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onPointerDown={() => setHover(null)}
    >
      <div
        className="inv-cols"
        onClick={(e) => {
          // With no backdrop, a tap on nothing in particular closes the details (UX-2).
          const t = e.target as HTMLElement;
          if (inv.selected && !t.closest(BLANK_TAP_SKIPS)) inv.select(null);
        }}
      >
        <div className="inv-left">
          <Panel
            className="inv-gear"
            width={layout.gear}
            head={
              <>
                <Worth n={gearWorth(ctx.items, ctx.player)} label="Gear Value" full />
                <span className="inv-panel-fill" />
                <button
                  className={`inv-help-button${help ? ' active' : ''}`}
                  aria-label="How the inventory works"
                  onClick={() => setHelp(!help)}
                >
                  ?
                </button>
              </>
            }
          >
            {layout.merged ? (
              <>
                <Slots inv={inv} owner={SELF} slots={PHONE_SLOTS} ch={ctx.player} centred={false} />
                <CharacterGrids inv={inv} owner={SELF} ch={ctx.player} vault />
              </>
            ) : (
              <Slots inv={inv} owner={SELF} slots={MY_SLOTS} ch={ctx.player} />
            )}
          </Panel>
          {!layout.merged && (
            <Panel className="inv-carried" width={layout.carried}>
              <CharacterGrids inv={inv} owner={SELF} ch={ctx.player} vault />
            </Panel>
          )}
          {!inv.selling && selected && sel && (
            <ItemDetails
              panel
              items={ctx.items}
              item={sel.item}
              quests={ctx.quests}
              onClose={() => inv.select(null)}
              extra={
                sel.def.type === 'weapon' && <Parts inv={inv} gun={selected} item={sel.item} />
              }
              actions={
                <>
                  {'index' in selected && sel.def.size[0] !== sel.def.size[1] && (
                    <button onClick={() => inv.rotate(selected)}>Rotate</button>
                  )}
                  {sel.def.type === 'weapon' && (sel.item.mag ?? 0) > 0 && (
                    <button onClick={() => inv.unload(selected)}>Unload</button>
                  )}
                  {sel.def.type === 'med' && ctx.use && !ctx.player.using && (
                    <button disabled={!inv.medRef(selected)} onClick={() => inv.useMed(selected)}>
                      {inv.medRef(selected) ? 'Use' : 'Nothing to treat'}
                    </button>
                  )}
                  <RepairButton inv={inv} armour={selected} item={sel.item} def={sel.def} />
                  <button
                    className={favs.has(sel.def.id) ? 'favourited' : undefined}
                    aria-pressed={favs.has(sel.def.id)}
                    title="Favourites are starred, and light up where they turn up in a body, a container or on the ground"
                    onClick={() => toggleFavourite(sel.def.id)}
                  >
                    {favs.has(sel.def.id) ? '★ Favourite' : '☆ Favourite'}
                  </button>
                  {ctx.sell && !('ground' in selected) && (
                    <SellButton key={refKey(selected)} inv={inv} at={selected} item={sel.item} />
                  )}
                  {ctx.sell && inv.canPick(selected) && (
                    <button onClick={() => inv.startSelling(selected)}>Sell several</button>
                  )}
                  {!('ground' in selected) && !ctx.stash && (
                    <button onClick={() => inv.toGround(selected)}>Drop</button>
                  )}
                  {'index' in selected && sel.item.count > 1 && (
                    <Split key={refKey(selected)} inv={inv} at={selected} item={sel.item} />
                  )}
                  <button className="primary" onClick={() => inv.quick(selected)}>
                    {quickLabel(selected, inv.quickTo(selected))}
                  </button>
                </>
              }
            />
          )}
        </div>
        <div className="inv-spacer" />
        <Loot inv={inv} />
      </div>
      {help && (
        <div className="inv-help" role="note" onClick={() => setHelp(false)}>
          {inputMode.gamepad
            ? `✕ select · △ details · □ quick move · hold ✕ and move to drag${ctx.stash ? '' : ' (onto the ground to drop)'} · △ while dragging rotates · ○ puts it back · L1/R1 change tab`
            : ctx.stash
              ? 'Tap for details · double-tap to move between your gear and the stash · drag to place · drag a repair kit onto armour to mend it · while dragging, tap with another finger (or press R) to rotate'
              : 'Tap for details · double-tap to move · drag to place, or onto the ground to drop · drag a repair kit onto armour to mend it · while dragging, tap with another finger (or press R) to rotate'}
        </div>
      )}
      {inv.selling && (
        <footer className="inv-bar">
          <SellBar inv={inv} />
        </footer>
      )}
      {hover && !sel && <HoverCard inv={inv} hover={hover} />}
    </div>
  );
}

/** What a tap closing the details ignores: items, controls, and the details themselves. */
const BLANK_TAP_SKIPS = '[data-ref], button, input, select, label, a, .item-details, .inv-bag';

/** What's under the mouse: an item's ref (refKey's JSON) and where the pointer is. */
interface Hover {
  ref: string;
  x: number;
  y: number;
}

/**
 * A framed column with a title bar (2026-11-06, the Delta Force look): its content is
 * `width` wide however full it is, so the columns beside it never move; it scrolls down.
 * With no title and nothing for the bar, it has no bar (Loadout and Carried, 2026-11-09).
 */
function Panel({
  className,
  width,
  title,
  head,
  children,
}: {
  className: string;
  width: number;
  title?: ReactNode;
  head?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className={`inv-panel ${className}`}>
      {(title || head) && (
        <header className="inv-panel-head">
          {title && <h2>{title}</h2>}
          {head}
        </header>
      )}
      <div className="inv-panel-body" style={{ width }}>
        {children}
      </div>
    </section>
  );
}

/** Money as a vendor would pay it, short (12.3k), with the whole sum on hover. */
export function Worth({
  n,
  label = 'Worth',
  full = false,
}: {
  n: number;
  label?: string;
  /** The whole number with commas (1,234,567), not shortened (1.2M). */
  full?: boolean;
}): ReactNode {
  return (
    <span className="inv-worth" title={`${label} ${n.toLocaleString()}`}>
      {label} <b>{full ? n.toLocaleString('en') : COMPACT.format(n)}</b>
    </span>
  );
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** What a vendor would pay for everything a character has on them, vault included. */
function gearWorth(items: ItemDb, c: Character): number {
  const g = c.gear;
  const list: Item[] = [];
  for (const it of [g.primary1, g.primary2, g.sidearm, g.helmet, g.bodyArmour, g.rig, g.backpack])
    if (it) list.push(it);
  for (const grid of [g.pockets, g.rig?.grid, g.backpack?.grid, g.vault])
    for (const gi of grid?.items ?? []) list.push(gi.item);
  return worth(items, list);
}

/** What a vendor would pay for these items (and what's in them), leaving out what none buys. */
export function worth(items: ItemDb, list: readonly Item[]): number {
  let n = 0;
  for (const item of list) {
    n += sellPrice(items, item);
    for (const gi of item.grid?.items ?? []) n += worth(items, [gi.item]);
  }
  return n;
}

/** The small card beside the mouse over an item (2026-11-06): name, kind, condition, price. */
function HoverCard({ inv, hover }: { inv: InventoryController; hover: Hover }): ReactNode {
  const ref = JSON.parse(hover.ref) as ItemRef;
  const found = inv.find(ref);
  if (!found) return null;
  const { item, def } = found;
  const items = inv.ctx.items;
  const no = cantSell(items, item);
  const state = badge(item, def);
  const left = hover.x + 240 > window.innerWidth ? hover.x - 236 : hover.x + 16;
  const top = Math.min(hover.y + 16, window.innerHeight - 110);
  return (
    <div className="inv-hover" style={{ left, top, borderColor: colourOf(def) }}>
      <b style={{ color: colourOf(def) }}>{def.name}</b>
      <span className="inv-hover-kind">
        {RARITY_NAMES[def.rarity]} {KIND_NAMES[def.type]}
        {item.found ? ' · found in raid' : ''}
        {favourites().has(item.item) ? ' · ★ favourite' : ''}
      </span>
      {state && <span>{def.type === 'armour' ? `Durability ${state}` : state}</span>}
      <span>
        {no && item.grid?.items.length
          ? `Sells for ${sellPrice(items, item).toLocaleString()} once empty`
          : (no ?? `Sells for ${sellPrice(items, item).toLocaleString()}`)}
      </span>
    </div>
  );
}

const RARITY_NAMES: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
};

const KIND_NAMES: Record<ItemDef['type'], string> = {
  weapon: 'gun',
  melee: 'knife',
  attachment: 'attachment',
  ammo: 'ammo',
  grenade: 'grenade',
  armour: 'armour',
  container: 'gear',
  med: 'med',
  repair: 'repair kit',
  key: 'key',
  quest: 'quest item',
  loot: 'loot',
};

/** The parts of a stack the split's quick buttons take. */
const SPLIT_PARTS: readonly [label: string, part: number][] = [
  ['¼', 1 / 4],
  ['½', 1 / 2],
  ['¾', 3 / 4],
];

/**
 * Splitting a stack (2026-11-01): pick how many (a quarter, half, three quarters, or any
 * number on the slider), then split them off into a new stack in the same grid, or send
 * just that many where a double-tap would (out of a full vault, say).
 */
function Split({ inv, at, item }: { inv: InventoryController; at: InGrid; item: Item }): ReactNode {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(() => Math.floor(item.count / 2));
  if (!open) return <button onClick={() => setOpen(true)}>Split</button>;
  const most = item.count - 1;
  const count = Math.min(n, most);
  return (
    <div className="item-split">
      {SPLIT_PARTS.map(([label, part]) => (
        <button key={label} onClick={() => setN(Math.max(1, Math.round(item.count * part)))}>
          {label}
        </button>
      ))}
      <input
        type="range"
        min={1}
        max={most}
        value={count}
        aria-label="How many"
        onChange={(e) => setN(Number(e.target.value))}
      />
      <span className="item-split-count">
        {count} / {item.count}
      </span>
      <button onClick={() => setOpen(false)}>Cancel</button>
      <button disabled={!inv.canSplit(at)} onClick={() => inv.split(at, count)}>
        {inv.canSplit(at) ? 'Split here' : 'No room here'}
      </button>
      <button className="primary" onClick={() => inv.quick(at, count)}>
        {/* A part of a stack is never equipped: from your own grid it moves to another. */}
        {quickLabel(at, inv.quickTo(at)).replace('Equip', 'Move')} {count}
      </button>
    </div>
  );
}

/**
 * Mends the selected armour with a repair kit you have (session 13b): at once in the
 * stash, over the kit's use time in a raid. Dragging a kit onto armour does the same.
 */
function RepairButton({
  inv,
  armour,
  item,
  def,
}: {
  inv: InventoryController;
  armour: ItemRef;
  item: Item;
  def: ItemDef;
}): ReactNode {
  if (def.type !== 'armour') return null;
  // While anything is being used, the pill at the top shows it (and stops it).
  if (inv.ctx.player.using) return null;
  if ((item.durability ?? 0) >= maxDurability(inv.ctx.items, item) - 1e-6) return null;
  const kit = inv.kitFor(armour);
  return (
    <button
      disabled={!kit}
      title={kit ? undefined : 'You need a repair kit with points left'}
      onClick={() => inv.repair(armour)}
    >
      Repair
    </button>
  );
}

/** A button that asks for a second tap, then runs an action that resolves when done. */
function ConfirmButton({
  label,
  confirm,
  busyLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  confirm: string;
  busyLabel: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={confirming ? 'confirm' : ''}
      disabled={busy || disabled}
      onBlur={() => setConfirming(false)}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        setBusy(true);
        void onConfirm().finally(() => setBusy(false));
      }}
    >
      {busy ? busyLabel : confirming ? confirm : label}
    </button>
  );
}

/** Sells the selected item between raids, for its price: a second tap confirms. */
function SellButton({ inv, at, item }: { inv: InventoryController; at: ItemRef; item: Item }) {
  const { items, sell } = inv.ctx;
  const why = 'slot' in at && at.slot === 'knife' ? 'Always kept' : cantSell(items, item);
  if (why) return <span className="inv-bar-info">{why}</span>;
  const price = sellPrice(items, item).toLocaleString();
  return (
    <ConfirmButton
      label={`Sell · ${price}`}
      confirm={`Sell for ${price}?`}
      busyLabel="Selling…"
      onConfirm={() => sell!([at])}
    />
  );
}

/**
 * Picking several items to sell at once (session 13b): taps pick and unpick, and Sell
 * sells them all, or none if one can't be (a backpack must go with everything in it).
 */
function SellBar({ inv }: { inv: InventoryController }): ReactNode {
  const { items, sell } = inv.ctx;
  const picked = inv.picked();
  const total = sellTotal(items, picked).toLocaleString();
  const n = picked.length;
  return (
    <>
      <span className="inv-bar-name">
        {n ? `${n} item${n === 1 ? '' : 's'} · ${total}` : 'Tap items to sell'}
      </span>
      <span className="inv-bar-info">
        {n ? 'Tap one again to take it off' : 'Not the knife; a backpack goes with what is in it'}
      </span>
      <span className="raid-spacer" />
      <button onClick={() => inv.stopSelling()}>Cancel</button>
      <ConfirmButton
        label={n ? `Sell ${n}` : 'Sell'}
        confirm={`Sell ${n} for ${total}?`}
        busyLabel="Selling…"
        disabled={!n}
        onConfirm={() => sell!([...inv.selling!])}
      />
    </>
  );
}

/**
 * The med or repair kit being used in a raid (session 13b): its name, time left and a
 * bar filling up. A tap stops it, like the heal button.
 */
function UsePill({ inv }: { inv: InventoryController }): ReactNode {
  const { player, items } = inv.ctx;
  const u = player.using;
  if (!u) return null;
  const total = timeToUse(items, u.item);
  const done = total > 0 ? Math.min(1, 1 - u.left / total) : 1;
  const label = u.armour
    ? `Repairing ${itemDef(items, u.armour.item).name.toLowerCase()}`
    : itemDef(items, u.item).name;
  return (
    <button className="inv-use" aria-label={`${label}: tap to stop`} onClick={() => inv.stopUse()}>
      <span className="inv-use-fill" style={{ width: `${done * 100}%` }} />
      <span className="inv-use-text">
        {label} · {Math.ceil(u.left)} s
      </span>
      <span className="inv-use-stop">✕</span>
    </button>
  );
}

const PART_NAMES: Record<AttachmentSlot, string> = {
  optic: 'Optic',
  muzzle: 'Muzzle',
  magazine: 'Magazine',
};

/**
 * The open gun's attachment slots, in its details: tap one for a picker of those you can
 * reach that fit, and to take its attachment off. Dragging an attachment onto the gun's
 * tile puts it on, too.
 */
function Parts({
  inv,
  gun,
  item,
}: {
  inv: InventoryController;
  gun: ItemRef;
  item: Item;
}): ReactNode {
  const { items } = inv.ctx;
  const weapon = itemDef(items, item.item);
  if (weapon.type !== 'weapon' || !weapon.slots?.length) return null;
  return (
    <div className="inv-parts">
      <div className="inv-parts-slots">
        {ATTACHMENT_SLOTS.filter((s) => weapon.slots?.includes(s)).map((slot) => {
          const part = item.attachments?.[slot] ?? null;
          const def = part === null ? null : itemDef(items, part);
          return (
            <button
              key={slot}
              className={`inv-part${inv.picking === slot ? ' open' : ''}`}
              style={def ? { background: tintOf(def) } : undefined}
              onClick={() => inv.togglePicker(slot)}
            >
              <span className="inv-part-slot">{PART_NAMES[slot]}</span>
              <span className={def ? 'inv-part-name' : 'inv-part-empty'}>
                {def ? def.name : 'none'}
              </span>
            </button>
          );
        })}
      </div>
      {inv.picking && <Picker inv={inv} gun={item} slot={inv.picking} gunRef={gun} />}
    </div>
  );
}

const GRID_LABELS: Record<GridName, string> = {
  pockets: 'pockets',
  rig: 'rig',
  backpack: 'backpack',
  vault: 'vault',
  loot: '',
};

/** What can go in one of the selected gun's attachment slots, above the bar. */
function Picker({
  inv,
  gun,
  gunRef,
  slot,
}: {
  inv: InventoryController;
  gun: Item;
  gunRef: ItemRef;
  slot: AttachmentSlot;
}): ReactNode {
  const part = gun.attachments?.[slot] ?? null;
  const choices = inv.partChoices(gun, slot);
  return (
    <div className="inv-picker" role="menu">
      {part && (
        <button onClick={() => inv.detach({ gun: gunRef, slot, part })}>
          Take off <span>into your pockets, rig or backpack</span>
        </button>
      )}
      {choices.map((c) => (
        <button key={c.def.id} onClick={() => inv.attach(c.ref)}>
          {c.def.name}
          <span>
            {c.owner.kind === 'self' ? `your ${GRID_LABELS[c.where]}` : inv.ctx.nameOf(c.owner)}
          </span>
        </button>
      ))}
      {!choices.length && (
        <p className="raid-note">
          {part ? 'Nothing else you can reach fits.' : 'Nothing you can reach fits.'}
        </p>
      )}
    </div>
  );
}

function Loot({ inv }: { inv: InventoryController }): ReactNode {
  const { ctx, target, layout } = inv;
  const search = useContext(StashSearchContext);
  const panel = (title: ReactNode, body: ReactNode, head?: ReactNode): ReactNode => (
    <Panel
      className={`inv-loot${target && stashPageOf(target) >= 0 ? ' is-stash' : ''}`}
      width={layout.loot}
      title={title}
      head={head}
    >
      {body}
    </Panel>
  );
  if (!target) return panel('On the ground', <Ground inv={inv} />);
  const name = ctx.nameOf(target);
  if (!inv.reach) return panel(name, <p className="raid-note">Out of reach.</p>);
  // Searching it (search.ts): what's not found yet shows as "?", and the header counts.
  const found = ctx.stash ? null : revealed(ctx.sim, ctx.player, target);
  const searching =
    found && found.found < found.total ? (
      <span className="inv-searching" role="status">
        Searching… {found.found}/{found.total}
      </span>
    ) : null;
  if (target.kind === 'container') {
    const l = lootContainerById(ctx.sim, target.id)!;
    // The stash page's header (sort and cells used) and tabs come from the stash screen.
    return panel(
      search?.title ?? name,
      <>
        {/* The search box is off for now (2026-11-09, the user's call); see SearchBox. */}
        <div className="inv-open">
          <Bag inv={inv} />
          {search ? (
            <div className="stash-paged">
              <StashChips />
              <GridView inv={inv} gref={{ owner: target, grid: 'loot' }} grid={l.grid} />
              {search.tabs}
            </div>
          ) : (
            <GridView
              inv={inv}
              gref={{ owner: target, grid: 'loot' }}
              grid={l.grid}
              shown={found?.shown}
            />
          )}
        </div>
      </>,
      search?.head ?? searching,
    );
  }
  const id = target.kind === 'body' ? target.id : -1;
  const body = ctx.sim.entities.find((e) => e.id === id)!;
  // Its gear, then its grids under it: the column is a stash page wide.
  return panel(
    name,
    <div className="inv-body">
      <Slots inv={inv} owner={target} slots={BODY_SLOTS} ch={body} />
      <CharacterGrids inv={inv} owner={target} ch={body} vault={false} shown={found?.shown} />
    </div>,
    searching ?? <Worth n={gearWorth(ctx.items, body)} />,
  );
}

/**
 * The kinds of item to show (2026-11-06), down the left of the stash page (2026-11-09,
 * the user's call; they were along the top): the rest are dimmed. On a phone, a row
 * along the top instead (2026-11-09, style.css). Stays in view while the page scrolls.
 */
function StashChips(): ReactNode {
  const search = useContext(StashSearchContext);
  if (!search) return null;
  const { category, setCategory } = search;
  return (
    <div className="stash-kinds" role="radiogroup" aria-label="Show">
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          role="radio"
          aria-checked={c.id === category}
          className={c.id === category ? 'active' : undefined}
          onClick={() => setCategory(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The stash's search box (2026-11-05). In the stash's column, not on the top bar, which
 * has no room left on a phone; it stays in view while the stash scrolls under it.
 * Not shown since 2026-11-09 (the user's call, may come back): Loot no longer renders it,
 * and the query stays empty. Its kinds of item moved to StashChips.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SearchBox(): ReactNode {
  const search = useContext(StashSearchContext);
  if (!search) return null;
  const { query, setQuery, setCategory, hit, found } = search;
  return (
    <div className="stash-search">
      <div className="stash-search-row">
        <input
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Search"
          aria-label="Search the stash"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Esc clears the search first, rather than leaving the stash.
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              setQuery('');
            }
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {hit && (
          <>
            {/* How many are found shows on the page tabs; here, on the clear button. */}
            <button
              title={found ? `${found} found` : 'None found'}
              aria-label="Clear the search"
              onClick={() => {
                setQuery('');
                setCategory('all');
              }}
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The rig or backpack opened with a tap from the open container or stash page (the
 * user's call, 2026-11-01): what's in it, to drag in and out of, with its details a
 * button away. Beside the container where there's room, else above it; it stays in view
 * while the container scrolls.
 */
function Bag({ inv }: { inv: InventoryController }): ReactNode {
  const open = inv.openBag();
  if (!open) return null;
  const { at, grid } = open;
  const def = itemDef(inv.ctx.items, at.item);
  return (
    <div className="inv-bag" style={{ borderColor: colourOf(def) }}>
      <header className="inv-bag-head">
        <h3>{def.name}</h3>
        <span className="raid-spacer" />
        <button onClick={() => inv.select(at)}>Details</button>
        <button aria-label="Close" onClick={() => inv.closeBag()}>
          ✕
        </button>
      </header>
      <GridView
        inv={inv}
        gref={{ owner: at.owner, grid: at.grid, inside: { index: at.index, item: at.item } }}
        grid={grid}
      />
    </div>
  );
}

const TO_GROUND = JSON.stringify({ owner: { kind: 'ground' } });

/**
 * With nothing open: the items on the ground within reach. Drag one of yours here to drop
 * it; drag or double-tap one of these to take it.
 */
function Ground({ inv }: { inv: InventoryController }): ReactNode {
  const favs = favourites();
  const { cell, ctx } = inv;
  const near = inv.nearby();
  return (
    <>
      <div className="inv-ground" data-drop={TO_GROUND}>
        {near.map(({ ref, g }) => {
          const def = itemDef(ctx.items, g.item.item);
          return (
            <div
              key={ref.ground}
              className={`inv-item${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}${holdsFavourite(g.item, favs) ? ' favourite' : ''}`}
              data-ref={JSON.stringify(ref)}
              data-gun={def.type === 'weapon' ? JSON.stringify(ref) : undefined}
              data-armour={def.type === 'armour' ? JSON.stringify(ref) : undefined}
              style={{
                width: def.size[0] * cell,
                height: def.size[1] * cell,
                background: tintOf(def),
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                inv.inspect(ref);
              }}
              onPointerDown={(e) =>
                inv.drag.down(e.nativeEvent, {
                  ref,
                  w: def.size[0],
                  h: def.size[1],
                  rotated: false,
                  grabX: 0,
                  grabY: 0,
                  colour: colourOf(def),
                  label: tileName(def),
                  el: e.currentTarget,
                })
              }
            >
              <ItemArt items={ctx.items} item={g.item} def={def} cell={cell} />
              <ItemLabel items={ctx.items} item={g.item} def={def} />
              {g.item.found && <span className="inv-item-found">✓</span>}
              {holdsFavourite(g.item, favs) && <span className="inv-item-star">★</span>}
            </div>
          );
        })}
        {!near.length && (
          <p className="raid-note">
            Nothing here. Drag an item here to drop it, or walk up to a container or a body and
            press <b>loot</b>.
          </p>
        )}
      </div>
    </>
  );
}

function CharacterGrids({
  inv,
  owner,
  ch,
  vault,
  shown,
}: {
  inv: InventoryController;
  owner: Owner;
  ch: Character;
  vault: boolean;
  /** For a body being searched: what's been found in its grids (the rest shows as "?"). */
  shown?: ReadonlySet<Item> | undefined;
}): ReactNode {
  const g = ch.gear;
  // As in Tarkov, the rig and backpack slots sit beside what's in them, not with the
  // rest of the gear: rig, pockets, backpack, then the vault.
  const grids: [string, GridName, Grid | null, GearSlot | null][] = [
    ['Rig', 'rig', g.rig?.grid ?? null, 'rig'],
    ['Pockets', 'pockets', g.pockets, null],
    ['Backpack', 'backpack', g.backpack?.grid ?? null, 'backpack'],
  ];
  return (
    <>
      {grids.map(([label, name, grid, slot]) =>
        slot ? (
          <div key={name} className="inv-section inv-holder">
            <Slots inv={inv} owner={owner} slots={[slot]} ch={ch} shown={shown} />
            {grid && <GridView inv={inv} gref={{ owner, grid: name }} grid={grid} shown={shown} />}
          </div>
        ) : grid ? (
          <div key={name} className="inv-section">
            <h3>{label}</h3>
            <GridView inv={inv} gref={{ owner, grid: name }} grid={grid} shown={shown} />
          </div>
        ) : null,
      )}
      {vault && g.vault && (
        <div className="inv-section">
          <h3>Kept if you die</h3>
          <div className="inv-holder">
            <VaultSlot items={inv.ctx.items} />
            <GridView inv={inv} gref={{ owner, grid: 'vault' }} grid={g.vault} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The vault, shown as VAULT_ITEM equipped beside its grid (the user's call, 2026-11-06).
 * Only shown: it has no ref, so it can't be dragged, selected, sold or taken off.
 */
function VaultSlot({ items }: { items: ItemDb }): ReactNode {
  const item: Item = { item: VAULT_ITEM, count: 1 };
  const def = itemDef(items, VAULT_ITEM);
  return (
    <div className="inv-slots">
      <div className="inv-slot">
        <div
          className="inv-item"
          title="Your vault: always equipped"
          style={{ background: tintOf(def) }}
        >
          <ItemArt items={items} item={item} def={def} />
          <ItemLabel items={items} item={item} def={def} />
        </div>
      </div>
    </div>
  );
}

function Slots({
  inv,
  owner,
  slots,
  ch,
  shown,
  centred = true,
}: {
  inv: InventoryController;
  owner: Owner;
  slots: readonly GearSlot[];
  ch: Character;
  /** A body being searched: what's been found in its grids (favourite stars count only those). */
  shown?: ReadonlySet<Item> | undefined;
  /** The helmet and armour on a row each, centred (false: side by side, as on a phone). */
  centred?: boolean;
}): ReactNode {
  const favs = favourites();
  return (
    <div className="inv-slots">
      {slots.map((slot) => {
        const item = (ch.gear as unknown as Record<GearSlot, Item | null>)[slot];
        const def = item && itemDef(inv.ctx.items, item.item);
        const inHand = owner.kind === 'self' && ch.gear.hand === slot && !!item;
        const ref: ItemRef | null = item ? { owner, slot, item: item.item } : null;
        return (
          <div
            key={slot}
            className={`inv-slot${WIDE.has(slot) ? ' wide' : centred && CENTRE.has(slot) ? ' centre' : ''}`}
            data-drop={JSON.stringify({ owner, slot })}
          >
            {/* Named only while empty: the item's own name would show through it. */}
            {!item && <span className="inv-slot-name">{SLOT_NAMES[slot]}</span>}
            {!item && <SlotGhost items={inv.ctx.items} slot={slot} />}
            {item && def && ref && (
              <div
                className={`inv-item${inHand ? ' in-hand' : ''}${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}${holdsFavourite(item, favs, shown) ? ' favourite' : ''}`}
                data-ref={JSON.stringify(ref)}
                title={inHand ? 'In hand' : undefined}
                data-gun={def.type === 'weapon' ? JSON.stringify(ref) : undefined}
                data-armour={def.type === 'armour' ? JSON.stringify(ref) : undefined}
                style={{ background: tintOf(def) }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  inv.inspect(ref);
                }}
                onPointerDown={(e) =>
                  inv.drag.down(e.nativeEvent, {
                    ref,
                    w: def.size[0],
                    h: def.size[1],
                    rotated: false,
                    grabX: 0,
                    grabY: 0,
                    colour: colourOf(def),
                    label: tileName(def),
                    el: e.currentTarget,
                  })
                }
              >
                <ItemArt items={inv.ctx.items} item={item} def={def} />
                <ItemLabel items={inv.ctx.items} item={item} def={def} />
                {item.found && <span className="inv-item-found">✓</span>}
                {holdsFavourite(item, favs, shown) && <span className="inv-item-star">★</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GridView({
  inv,
  gref,
  grid,
  shown,
}: {
  inv: InventoryController;
  gref: GridRef;
  grid: Grid;
  /** Being searched: what's been found; the rest shows as "?" and can't be touched. */
  shown?: ReadonlySet<Item> | undefined;
}): ReactNode {
  const favs = favourites();
  const { cell } = inv;
  const search = useContext(StashSearchContext);
  // Your own grids aren't searched, only the stash and what's in it.
  const hit = stashPageOf(gref.owner) >= 0 ? search?.hit : null;
  const tile = (g: Grid['items'][number], index: number, ox: number, oy: number) => {
    if (shown && !shown.has(g.item)) {
      const [sw, sh] = itemDef(inv.ctx.items, g.item.item).size;
      return (
        <div
          key={index}
          className="inv-item inv-unsearched"
          aria-label="Not searched yet"
          style={{
            left: (g.x - ox) * cell,
            top: (g.y - oy) * cell,
            width: (g.rotated ? sh : sw) * cell,
            height: (g.rotated ? sw : sh) * cell,
          }}
        >
          ?
        </div>
      );
    }
    const def = itemDef(inv.ctx.items, g.item.item);
    const w = g.rotated ? def.size[1] : def.size[0];
    const h = g.rotated ? def.size[0] : def.size[1];
    const ref: ItemRef = { ...gref, index, item: g.item.item };
    return (
      <div
        key={index}
        className={`inv-item${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}${inv.isOpenBag(ref) ? ' open' : ''}${hit && !hit(g.item) ? ' dimmed' : ''}${holdsFavourite(g.item, favs) ? ' favourite' : ''}`}
        data-ref={JSON.stringify(ref)}
        data-gun={def.type === 'weapon' ? JSON.stringify(ref) : undefined}
        data-armour={def.type === 'armour' ? JSON.stringify(ref) : undefined}
        style={{
          left: (g.x - ox) * cell,
          top: (g.y - oy) * cell,
          width: w * cell,
          height: h * cell,
          background: tintOf(def),
          ['--lines' as string]: nameLines(h, cell),
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          inv.inspect(ref);
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          inv.drag.down(e.nativeEvent, {
            ref,
            w: def.size[0],
            h: def.size[1],
            rotated: g.rotated,
            grabX: Math.min(w - 1, Math.floor((e.clientX - r.left) / cell)),
            grabY: Math.min(h - 1, Math.floor((e.clientY - r.top) / cell)),
            colour: colourOf(def),
            label: tileName(def),
            el: e.currentTarget,
          });
        }}
      >
        <ItemArt items={inv.ctx.items} item={g.item} def={def} cell={cell} rotated={g.rotated} />
        <ItemLabel items={inv.ctx.items} item={g.item} def={def} />
        {g.item.found && <span className="inv-item-found">✓</span>}
        {holdsFavourite(g.item, favs) && <span className="inv-item-star">★</span>}
      </div>
    );
  };
  if (!grid.sections) {
    return (
      <div
        className="inv-grid"
        data-drop={JSON.stringify(gref)}
        data-cell={cell}
        style={{ width: grid.w * cell, height: grid.h * cell }}
      >
        {grid.items.map((g, index) => tile(g, index, 0, 0))}
      </div>
    );
  }
  // A rig's or backpack's sections (2026-11-06): each its own box, SECTION_GAP apart. Each
  // is a drop target of its own, and data-at says where its top-left cell is in the grid.
  const boxes = sectionBoxes(grid.sections, cell);
  return (
    <div
      className="inv-sections"
      style={{
        width: Math.max(...boxes.map((b) => b.left + b.s.w * cell)),
        height: Math.max(...boxes.map((b) => b.top + b.s.h * cell)),
      }}
    >
      {boxes.map(({ s, left, top }, i) => (
        <div
          key={i}
          className="inv-grid"
          data-drop={JSON.stringify(gref)}
          data-at={`${s.x},${s.y}`}
          data-cell={cell}
          style={{ left, top, width: s.w * cell, height: s.h * cell }}
        >
          {grid.items.map((g, index) =>
            g.x >= s.x && g.y >= s.y && g.x < s.x + s.w && g.y < s.y + s.h
              ? tile(g, index, s.x, s.y)
              : null,
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * An item's picture on its tile (2026-11-02), drawn at its unrotated shape and turned with
 * the tile; in a slot (no cell), fitted to the slot. Nothing where WebGL can't draw it.
 */
function ItemArt(props: {
  items: ItemDb;
  item: Item;
  def: ItemDef;
  cell?: number;
  rotated?: boolean;
}): ReactNode {
  const { def, cell } = props;
  const url = itemPortrait(props.items, props.item, def.size);
  if (!url) return null;
  if (cell === undefined)
    return <img className="inv-art inv-art-fit" src={url} alt="" draggable={false} />;
  const [w, h] = def.size;
  return (
    <img
      className="inv-art"
      src={url}
      alt=""
      draggable={false}
      style={{
        width: w * cell,
        height: h * cell,
        transform: `translate(-50%, -50%)${props.rotated ? ' rotate(90deg)' : ''}`,
      }}
    />
  );
}

function quickLabel(ref: ItemRef, to: Owner): string {
  if (to.kind !== 'self') return 'Put in';
  if (ref.owner.kind !== 'self') return 'Take';
  return 'slot' in ref ? 'Stow' : 'Equip';
}

/** A colour per item type, until the item editor gives items their own icons. */
/** Gray, green, blue, purple, gold and red (design.md → Item tiles). */
const RARITY_COLOURS: Record<Rarity, string> = {
  common: '#6f767d',
  uncommon: '#5c9a4a',
  rare: '#3d6fb0',
  epic: '#7d4fb3',
  legendary: '#c0962e',
  mythic: '#b8423a',
};

/** An item's colour, by its rarity. */
export function colourOf(def: ItemDef): string {
  return RARITY_COLOURS[def.rarity];
}

/**
 * An item tile's background: its rarity's colour rising from the bottom edge over the dark
 * cell (2026-11-06, the Delta Force look). Translucent all the way, so the grid's lines show
 * through the tile (2026-11-09).
 */
function tintOf(def: ItemDef): string {
  const c = RARITY_COLOURS[def.rarity];
  return `linear-gradient(to top, ${c}8c, ${c}40 55%, ${c}26)`;
}

// Scratch for a gun's magazine size with its attachments.
const gunStats = createWeaponStats();

/**
 * What a tile shows: its name, and in the corner a badge (a stack's count, durability…).
 * A gun shows its rounds under its name and loaded/capacity in the corner, the rounds
 * loaded larger; rigs and backpacks show only their name.
 */
function ItemLabel({ items, item, def }: { items: ItemDb; item: Item; def: ItemDef }): ReactNode {
  if (def.type === 'weapon') {
    const capacity = weaponStats(items, item as WeaponState, gunStats).magazine;
    return (
      <>
        <span className="inv-item-name">
          {tileName(def)}
          <span className="inv-item-ammo">{tileName(itemDef(items, loadedAmmo(items, item)))}</span>
        </span>
        <span className="inv-item-badge">
          <span className="inv-item-loaded">{item.mag ?? 0}</span>/{capacity}
        </span>
      </>
    );
  }
  const level = levelOf(def);
  return (
    <>
      <span className="inv-item-name">{tileName(def)}</span>
      {level !== null && (
        <i className="level-tag inv-item-level" style={{ background: levelColour(level) }}>
          {level}
        </i>
      )}
      <span className="inv-item-badge">{badge(item, def)}</span>
    </>
  );
}

/**
 * How many whole lines of its name a tile this many cells tall has room for above its
 * badges, so a line is never half hidden (fonts as in style.css, by the cell size).
 */
function nameLines(cellsHigh: number, cell: number): number {
  const line = Math.min(9, cell * 0.26) * 1.1;
  const badges = Math.min(10, cell * 0.27) + 1;
  return Math.max(1, Math.floor((cellsHigh * cell - 2 - badges) / line));
}

/** What an item's tile says: its short name, or its name (2026-11-06). */
export function tileName(def: ItemDef): string {
  return def.shortName ?? def.name;
}

/** A durability to one decimal place, without a trailing ".0". */
export function tenths(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** The small text in an item's corner: a stack's count, rounds loaded, durability… */
function badge(item: Item, def: ItemDef): string {
  switch (def.type) {
    case 'armour':
      // Out of its max now, which repairs wear down (sim/repair.ts).
      return `${tenths(item.durability ?? 0)}/${tenths(item.max ?? def.durability)}`;
    case 'med':
      if (def.effect === 'heal') return `${item.left ?? 0} HP`;
      return (def.uses ?? 1) > 1 ? `×${item.left ?? 0}` : '';
    case 'repair':
      return `${Math.floor(item.left ?? 0)}`;
    case 'key':
      return def.uses === undefined ? '' : `×${item.left ?? 0}`;
    case 'container':
      return '';
    default:
      return stackSize(def) > 1 || item.count > 1 ? `${item.count}` : '';
  }
}
