import {
  ARMORED_RIG_WORN,
  WEIGHT,
  canSprint,
  gearWeight,
  EARS_COVERED,
  blocksHeadset,
  armorOf,
  isArmoredRig,
  ATTACHMENT_SLOTS,
  caliberOf,
  cantSell,
  createWeaponStats,
  itemDef,
  itemSize,
  isMagazine,
  packable,
  roundOf,
  carrierOf,
  softZonesOf,
  armorStatsOf,
  stockFolds,
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
  STOMACH,
  stomachBlacked,
  isBleeding,
  isBroken,
} from '@mes/shared';
import { inputMode } from '../input/mode';
import { nightVisionOn } from '../play/night-vision';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { itemPortrait } from '../render/item-portrait';
import { refKey, type InventoryController, type OpenBag } from './inventory-controller';
import { ItemDetails } from './item-details';
import { MapTab } from './map-tab';
import type { RaidContext } from './raid';
import { RaidQuests } from './raid-quests';
import { CATEGORIES, type Category } from './stash-search';
import { CategoryIcon } from './category-icons';
import { favorites, holdsFavorite, toggleFavorite } from './favorites';
import { settings } from '../settings';
import { LOADOUT_SPLIT, sectionBoxes } from './inventory-layout';
import { ZONE_COLORS, zoneColor } from '../hud/vitals';
import { levelColor } from './levels';

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
  /** The stash panel's title and the rest of its header: cells used. */
  title: ReactNode;
  head: ReactNode;
  /** The bar along the stash panel's bottom: sort, and sell (2026-11-09). */
  foot: ReactNode;
  /** The bar along the equipment panel's bottom in the stash: quick equip (2026-11-09). */
  gearFoot: ReactNode;
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
/** Whether a size is square: turning it changes nothing. */
const square = ([w, h]: readonly [number, number]): boolean => w === h;

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
        <PackPill inv={inv} />
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
 * zone in its color (bleeding ones pulse), and chips for bleeding, broken limbs and a
 * blacked stomach; no
 * total, as on the HUD.
 */
function HealthStrip({ c }: { c: Character }): ReactNode {
  const h = c.health;
  if (h.pool !== undefined) return null;
  const fill = (zone: number) => ZONE_COLORS[zoneColor(h.hp[zone]!, HEALTH.maxHp[zone]!)];
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
      title={`Head ${hp(HEAD)} · Chest ${hp(CHEST)} · Stomach ${hp(STOMACH)} · Arms ${hp(LEFT_ARM)}/${hp(RIGHT_ARM)} · Legs ${hp(LEFT_LEG)}/${hp(RIGHT_LEG)}`}
    >
      <svg viewBox="16 0 32 60" width="16" height="28" aria-hidden>
        <circle cx="32" cy="6" r="5" fill={fill(HEAD)} className={bleed(HEAD)} />
        <rect
          x="26"
          y="13"
          width="12"
          height="11.5"
          rx="1.5"
          fill={fill(CHEST)}
          className={bleed(CHEST)}
        />
        <rect
          x="26"
          y="25"
          width="12"
          height="7"
          rx="1.5"
          fill={fill(STOMACH)}
          className={bleed(STOMACH)}
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
      {stomachBlacked(h) && <span className="chip">🤢</span>}
    </span>
  );
}

const SELF: Owner = { kind: 'self' };
const subscribeSettings = (onChange: () => void): (() => void) => settings.subscribe(onChange);
// Head, chest, then the guns: each primary with the sidearm or the knife beside it
// (2026-11-09, the user's call; they were under both primaries before).
const MY_SLOTS: readonly GearSlot[] = [
  'helmet',
  'headset',
  'bodyArmor',
  'primary1',
  'sidearm',
  'primary2',
  'knife',
];
const BODY_SLOTS: readonly GearSlot[] = [
  'helmet',
  'headset',
  'bodyArmor',
  'primary1',
  'sidearm',
  'primary2',
];
/**
 * Not on a PC, where the loadout and what you carry are one column (2026-11-09, the user's
 * call): the guns first, then the helmet and armor side by side, then the rig and the rest.
 */
const PHONE_SLOTS: readonly GearSlot[] = [
  'primary1',
  'sidearm',
  'primary2',
  'knife',
  'helmet',
  'headset',
  'bodyArmor',
];
const SLOT_NAMES: Record<GearSlot, string> = {
  primary1: 'Primary 1',
  primary2: 'Primary 2',
  sidearm: 'Sidearm',
  knife: 'Knife',
  helmet: 'Helmet',
  headset: 'Headset',
  bodyArmor: 'Armor',
  rig: 'Rig',
  backpack: 'Backpack',
};
/**
 * What an empty gear slot shows faintly, so you can tell the slots apart at a glance
 * (2026-11-09): a bare M416 in the gun slots, an M9A3 for the sidearm, and a typical item
 * in each of the rest.
 */
const SLOT_GHOSTS: Partial<Record<GearSlot, string>> = {
  primary1: 'm416',
  primary2: 'm416',
  sidearm: 'm9a3',
  knife: 'knife',
  helmet: 'combat-helmet',
  headset: 'tactical-headset',
  bodyArmor: 'plate-carrier',
  rig: 'chest-rig',
  backpack: 'medium-backpack',
};

/** An empty slot's ghost: its item's picture as a flat light gray shape. */
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

/** Primaries are drawn twice as wide, a small slot beside each; the helmet and armor have a row each, centered. */
const WIDE: ReadonlySet<GearSlot> = new Set(['primary1', 'primary2']);
const CENTER: ReadonlySet<GearSlot> = new Set(['bodyArmor']);
/**
 * GZ-2: on a PC the helmet sits in the middle of its row with the headset to its right; on
 * a phone the helmet, headset and armor share a row, a third each.
 */
const HEAD_SLOTS: Partial<Record<GearSlot, string>> = { helmet: ' head', headset: ' ears' };

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
  const stashSearch = useContext(StashSearchContext);
  // Favoriting changes the settings: redraw for it.
  useSyncExternalStore(subscribeSettings, () => settings.current);
  const favs = favorites();
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
            width={layout.merged ? layout.gear : layout.gear + LOADOUT_SPLIT + layout.carried}
            foot={stashSearch?.gearFoot}
            head={
              <>
                <Worth n={gearWorth(ctx.items, ctx.player.gear)} label="Gear Value" full />
                <Load kg={gearWeight(ctx.items, ctx.player.gear)} />
                <span className="inv-panel-fill" />
                <PackButton inv={inv} />
                {/* Not in the stash (2026-11-09, the user's call); still in a raid. */}
                {!ctx.stash && (
                  <button
                    className={`inv-help-button${help ? ' active' : ''}`}
                    aria-label="How the inventory works"
                    onClick={() => setHelp(!help)}
                  >
                    ?
                  </button>
                )}
              </>
            }
          >
            {layout.merged ? (
              <>
                <Slots
                  inv={inv}
                  owner={SELF}
                  slots={PHONE_SLOTS}
                  ch={ctx.player}
                  centered={false}
                />
                <CharacterGrids inv={inv} owner={SELF} ch={ctx.player} vault />
              </>
            ) : (
              // On a PC, your gear and what you carry are one card, a gap apart, so its
              // Gear Value reads as the whole of it (2026-11-09, the user's call).
              <div className="inv-split" style={{ gap: LOADOUT_SPLIT }}>
                <div style={{ width: layout.gear }}>
                  <Slots inv={inv} owner={SELF} slots={MY_SLOTS} ch={ctx.player} />
                </div>
                <div style={{ width: layout.carried }}>
                  <CharacterGrids inv={inv} owner={SELF} ch={ctx.player} vault />
                </div>
              </div>
            )}
          </Panel>
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
              corner={
                <button
                  className={`item-details-fav${favs.has(sel.def.id) ? ' favorited' : ''}`}
                  aria-pressed={favs.has(sel.def.id)}
                  aria-label="Favorite"
                  title="Favorites are starred, and light up where they turn up in a body, a container or on the ground"
                  onClick={() => toggleFavorite(sel.def.id)}
                >
                  {favs.has(sel.def.id) ? '★' : '☆'}
                </button>
              }
              actions={
                <>
                  {'index' in selected && !square(itemSize(ctx.items, sel.item)) && (
                    <button onClick={() => inv.rotate(selected)}>Rotate</button>
                  )}
                  {(sel.def.type === 'weapon' || isMagazine(sel.def)) &&
                    (sel.item.mag ?? 0) > 0 && (
                      <button onClick={() => inv.unload(selected)}>Unload</button>
                    )}
                  {!ctx.stash &&
                    sel.item.fitted &&
                    itemDef(ctx.items, sel.item.fitted.item).type === 'nightVision' && (
                      <button
                        title="On or off while this helmet is worn (N on a keyboard)"
                        onClick={() => inv.toggleNightVision()}
                      >
                        Night vision {nightVisionOn() ? 'off' : 'on'}
                      </button>
                    )}
                  {(['front', 'back'] as const).map(
                    (side) =>
                      sel.item.plates?.[side] && (
                        <button
                          key={side}
                          onClick={() => inv.unplate(selected, side, sel.item.plates![side]!.item)}
                        >
                          Take out {side} plate
                        </button>
                      ),
                  )}
                  {sel.item.fitted && (
                    <button onClick={() => inv.unmount(selected, sel.item.fitted!.item)}>
                      Take off {tileName(itemDef(ctx.items, sel.item.fitted.item))}
                    </button>
                  )}
                  {stockFolds(ctx.items, sel.item) && (
                    <button
                      title={
                        sel.item.folded
                          ? 'Unfolds the stock: its handling back, and longer in a grid'
                          : 'Folds the stock: shorter, but none of its handling'
                      }
                      onClick={() => inv.fold(selected, !sel.item.folded)}
                    >
                      {sel.item.folded ? 'Unfold' : 'Fold'}
                    </button>
                  )}
                  {sel.def.type === 'weapon' &&
                    ((sel.item.mag ?? 0) > 0 ||
                      Object.values(sel.item.attachments ?? {}).some((a) => a !== null)) && (
                      <button
                        title="Unloads it and takes every attachment off, the magazine too, into your backpack, then rig, then the ground"
                        onClick={() => inv.strip(selected)}
                      >
                        Strip
                      </button>
                    )}
                  {sel.def.type === 'med' && ctx.use && !ctx.player.using && (
                    <button disabled={!inv.medRef(selected)} onClick={() => inv.useMed(selected)}>
                      {inv.medRef(selected) ? 'Use' : 'Nothing to treat'}
                    </button>
                  )}
                  <RepairButton inv={inv} armor={selected} item={sel.item} def={sel.def} />
                  {ctx.sell && !('ground' in selected) && (
                    <SellButton key={refKey(selected)} inv={inv} at={selected} item={sel.item} />
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
      <Bags inv={inv} />
      {help && (
        <div className="inv-help" role="note" onClick={() => setHelp(false)}>
          {inputMode.gamepad
            ? `✕ select · △ details · □ quick move · hold ✕ and move to drag${ctx.stash ? '' : ' (onto the ground to drop)'} · △ while dragging rotates · ○ puts it back · L1/R1 change tab`
            : ctx.stash
              ? 'Tap for details · double-tap to move between your gear and the stash · drag to place · drag a repair kit onto armor to mend it · while dragging, tap with another finger (or press R) to rotate'
              : 'Tap for details · double-tap to move · drag to place, or onto the ground to drop · drag a repair kit onto armor to mend it · while dragging, tap with another finger (or press R) to rotate'}
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
  foot,
  children,
}: {
  className: string;
  width: number;
  title?: ReactNode;
  head?: ReactNode;
  /** A thin bar under the content, that stays put while it scrolls. */
  foot?: ReactNode;
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
      {foot && <footer className="inv-panel-foot">{foot}</footer>}
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

/**
 * What you carry against the weight thresholds (BW-3): against WEIGHT.from while it
 * doesn't slow you, then against WEIGHT.heavy, amber while slowed and red with no sprint.
 */
function Load({ kg }: { kg: number }): ReactNode {
  const level = !canSprint(kg) ? 'over' : kg > WEIGHT.from ? 'slow' : '';
  const limit = kg > WEIGHT.from ? WEIGHT.heavy : WEIGHT.from;
  const title =
    `Weight ${kg.toFixed(1)} kg. Over ${WEIGHT.from} kg you move slower, ` +
    `down to ×${WEIGHT.slowest} at ${WEIGHT.heavy} kg; over ${WEIGHT.heavy} kg you can't sprint.`;
  return (
    <span className={`inv-worth inv-load ${level}`} title={title}>
      Weight <b>{kg.toFixed(1)}</b> / {limit} kg
    </span>
  );
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * What a vendor would pay for everything a character has on them: the gear slots, pockets,
 * rig, backpack and (unless `vault` is false) the vault. The stash's Gear Value and the main
 * menu's loadout card both show this, so they agree (2026-11-09).
 */
export function gearWorth(items: ItemDb, g: Character['gear'], vault = true): number {
  const list: Item[] = [];
  for (const it of [g.primary1, g.primary2, g.sidearm, g.helmet, g.bodyArmor, g.rig, g.backpack])
    if (it) list.push(it);
  // The rig's and backpack's contents come in with them: worth() counts what's inside.
  for (const grid of [g.pockets, vault ? g.vault : null])
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
    <div className="inv-hover" style={{ left, top, borderColor: colorOf(def) }}>
      <b style={{ color: colorOf(def) }}>{def.name}</b>
      <span className="inv-hover-kind">
        {RARITY_NAMES[def.rarity]} {KIND_NAMES[def.type]}
        {item.found ? ' · found in raid' : ''}
        {favorites().has(item.item) ? ' · ★ favorite' : ''}
      </span>
      {state && <span>{hoverState(def, state)}</span>}
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
  armor: 'armor',
  container: 'gear',
  med: 'med',
  repair: 'repair kit',
  key: 'key',
  quest: 'quest item',
  loot: 'loot',
  headset: 'headset',
  visor: 'visor',
  nightVision: 'night vision',
  plate: 'plate',
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
 * Mends the selected armor with a repair kit you have (session 13b): at once in the
 * stash, over the kit's use time in a raid. Dragging a kit onto armor does the same.
 */
function RepairButton({
  inv,
  armor,
  item,
  def,
}: {
  inv: InventoryController;
  armor: ItemRef;
  item: Item;
  def: ItemDef;
}): ReactNode {
  // Armor, or an armored rig (2026-11-11).
  if (!armorOf(def)) return null;
  // While anything is being used, the pill at the top shows it (and stops it).
  if (inv.ctx.player.using) return null;
  if ((item.durability ?? 0) >= maxDurability(inv.ctx.items, item) - 1e-6) return null;
  const kit = inv.kitFor(armor);
  return (
    <button
      disabled={!kit}
      title={kit ? undefined : 'You need a repair kit with points left'}
      onClick={() => inv.repair(armor)}
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
  const label = u.armor
    ? `Repairing ${itemDef(items, u.armor.item).name.toLowerCase()}`
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

/**
 * Pack Mags (MG-2): loose rounds in pockets and rig into the magazines there, the fullest
 * first. A round at a time in a raid (it goes on with the inventory closed), at once in
 * the stash. Hidden while packing: the pill at the top shows it.
 */
function PackButton({ inv }: { inv: InventoryController }): ReactNode {
  const { player, items } = inv.ctx;
  if (player.packing) return null;
  const n = packable(player, items);
  return (
    <button
      className="inv-pack"
      disabled={n === 0}
      title={
        n > 0
          ? `Loads ${n} loose rounds from pockets and rig into the magazines there, fullest first`
          : 'No loose rounds in pockets or rig for a magazine there'
      }
      onClick={() => inv.pack()}
    >
      Pack Mags
    </button>
  );
}

/** Packing or unloading in a raid (MG-2): rounds done of all, a bar; a tap stops it. */
function PackPill({ inv }: { inv: InventoryController }): ReactNode {
  const p = inv.ctx.player.packing;
  if (!p) return null;
  const done = p.total > 0 ? Math.min(1, p.done / p.total) : 1;
  const label = p.kind === 'unload' ? 'Unloading' : 'Packing';
  return (
    <button className="inv-use" aria-label={`${label}: tap to stop`} onClick={() => inv.stopPack()}>
      <span className="inv-use-fill" style={{ width: `${done * 100}%` }} />
      <span className="inv-use-text">
        {label} · {p.done}/{p.total}
      </span>
      <span className="inv-use-stop">✕</span>
    </button>
  );
}

const PART_NAMES: Record<AttachmentSlot, string> = {
  optic: 'Optic',
  muzzle: 'Muzzle',
  magazine: 'Magazine',
  laser: 'Laser',
  stock: 'Stock',
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
  const panel = (
    title: ReactNode,
    body: ReactNode,
    head?: ReactNode,
    foot?: ReactNode,
  ): ReactNode => (
    <Panel
      className={`inv-loot${target && stashPageOf(target) >= 0 ? ' is-stash' : ''}`}
      width={layout.loot}
      title={title}
      head={head}
      foot={foot}
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
      search?.foot,
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
    searching ?? <Worth n={gearWorth(ctx.items, body.gear)} />,
  );
}

/**
 * The kinds of item to show (2026-11-06), down the left of the stash page (2026-11-09,
 * the user's call; they were along the top), on a phone too, as icons: the rest are
 * dimmed. Stays in view while the page scrolls.
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
          aria-label={c.label}
          title={c.label}
          className={c.id === category ? 'active' : undefined}
          onClick={() => setCategory(c.id)}
        >
          <CategoryIcon id={c.id} />
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
 * The rigs and backpacks opened with a tap (the user's call, 2026-11-01), from any grid or
 * from inside another bag (2026-11-11): what's in each, to drag in and out of. Since 2026-11-11 (the
 * user's call) each is a floating window over the whole inventory, up to MAX_BAGS, the
 * newest on top, dragged by its title bar; a touch brings one to the front.
 */
function Bags({ inv }: { inv: InventoryController }): ReactNode {
  return (
    <>
      {inv.openBags().map((b) => (
        <BagWindow key={refKey(b.at)} inv={inv} bag={b} />
      ))}
    </>
  );
}

function BagWindow({ inv, bag }: { inv: InventoryController; bag: OpenBag }): ReactNode {
  const { at, grid, item } = bag;
  const def = itemDef(inv.ctx.items, at.item);
  const el = useRef<HTMLDivElement>(null);
  const grab = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const onDown = (e: ReactPointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { id: e.pointerId, dx: e.clientX - bag.x, dy: e.clientY - bag.y };
  };
  const onMove = (e: ReactPointerEvent): void => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;
    const r = el.current?.getBoundingClientRect();
    inv.moveBag(item, e.clientX - g.dx, e.clientY - g.dy, r?.width ?? 0, r?.height ?? 0);
  };
  const onUp = (e: ReactPointerEvent): void => {
    if (grab.current?.id === e.pointerId) grab.current = null;
  };
  return (
    <div
      ref={el}
      className="inv-bag"
      style={{ borderColor: colorOf(def), left: bag.x, top: bag.y }}
      onPointerDownCapture={() => inv.raiseBag(item)}
    >
      <header
        className="inv-bag-head"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <h3>{def.name}</h3>
        <span className="raid-spacer" />
        <button aria-label="Close" onClick={() => inv.closeBag(item)}>
          ✕
        </button>
      </header>
      <GridView inv={inv} gref={bag.gref} grid={grid} />
    </div>
  );
}

const TO_GROUND = JSON.stringify({ owner: { kind: 'ground' } });

/**
 * With nothing open: the items on the ground within reach. Drag one of yours here to drop
 * it; drag or double-tap one of these to take it.
 */
function Ground({ inv }: { inv: InventoryController }): ReactNode {
  const favs = favorites();
  const { cell, ctx } = inv;
  const near = inv.nearby();
  return (
    <>
      <div className="inv-ground" data-drop={TO_GROUND}>
        {near.map(({ ref, g }) => {
          const def = itemDef(ctx.items, g.item.item);
          const [sw, sh] = itemSize(ctx.items, g.item);
          return (
            <div
              key={ref.ground}
              className={`inv-item${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}${holdsFavorite(g.item, favs) ? ' favorite' : ''}`}
              data-ref={JSON.stringify(ref)}
              data-gun={def.type === 'weapon' || isMagazine(def) ? JSON.stringify(ref) : undefined}
              data-armor={armorOf(def) ? JSON.stringify(ref) : undefined}
              style={{
                width: sw * cell,
                height: sh * cell,
                background: tintOf(def),
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                inv.inspect(ref);
              }}
              onPointerDown={(e) =>
                inv.drag.down(e.nativeEvent, {
                  ref,
                  w: sw,
                  h: sh,
                  rotated: false,
                  grabX: 0,
                  grabY: 0,
                  color: colorOf(def),
                  label: tileName(def),
                  el: e.currentTarget,
                })
              }
            >
              <ItemArt items={ctx.items} item={g.item} def={def} cell={cell} />
              <ItemLabel items={ctx.items} item={g.item} def={def} />
              {g.item.found && <span className="inv-item-found">✓</span>}
              {holdsFavorite(g.item, favs) && <span className="inv-item-star">★</span>}
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
          {/* Not in the stash (2026-11-09, the user's call); still in a raid. */}
          {!inv.ctx.stash && <h3>Kept if you die</h3>}
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
  centered = true,
}: {
  inv: InventoryController;
  owner: Owner;
  slots: readonly GearSlot[];
  ch: Character;
  /** A body being searched: what's been found in its grids (favorite stars count only those). */
  shown?: ReadonlySet<Item> | undefined;
  /** The helmet and armor on a row each, centered (false: side by side, half the row each, as on a phone). */
  centered?: boolean;
}): ReactNode {
  const favs = favorites();
  return (
    <div className={`inv-slots${centered ? '' : ' halves'}`}>
      {slots.map((slot) => {
        const item = (ch.gear as unknown as Record<GearSlot, Item | null>)[slot];
        const def = item && itemDef(inv.ctx.items, item.item);
        const inHand = owner.kind === 'self' && ch.gear.hand === slot && !!item;
        const ref: ItemRef | null = item ? { owner, slot, item: item.item } : null;
        // Shut while an armored rig is worn (2026-11-11): it's the chest armor then; the
        // headset's while the helmet covers the ears (GZ-2).
        const by =
          slot === 'bodyArmor' &&
          !!ch.gear.rig &&
          isArmoredRig(itemDef(inv.ctx.items, ch.gear.rig.item))
            ? ch.gear.rig
            : slot === 'headset' && blocksHeadset(inv.ctx.items, ch.gear.helmet)
              ? ch.gear.helmet
              : null;
        const shut = !item && !!by;
        return (
          <div
            key={slot}
            className={`inv-slot${WIDE.has(slot) ? ' wide' : CENTER.has(slot) && centered ? ' center' : centered ? (HEAD_SLOTS[slot] ?? '') : ''}${shut ? ' shut' : ''}`}
            data-drop={JSON.stringify({ owner, slot })}
            title={shut ? (slot === 'headset' ? EARS_COVERED : ARMORED_RIG_WORN) : undefined}
          >
            {/* Named only while empty: the item's own name would show through it. */}
            {!item && !shut && <span className="inv-slot-name">{SLOT_NAMES[slot]}</span>}
            {!item && !shut && <SlotGhost items={inv.ctx.items} slot={slot} />}
            {shut && (
              <span className="inv-slot-shut">
                {SLOT_NAMES[slot]}
                <small>{tileName(itemDef(inv.ctx.items, by!.item))} worn</small>
              </span>
            )}
            {item && def && ref && (
              <div
                className={`inv-item${inHand ? ' in-hand' : ''}${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}${holdsFavorite(item, favs, shown) ? ' favorite' : ''}`}
                data-ref={JSON.stringify(ref)}
                title={inHand ? 'In hand' : undefined}
                data-gun={
                  def.type === 'weapon' || isMagazine(def) ? JSON.stringify(ref) : undefined
                }
                data-armor={armorOf(def) ? JSON.stringify(ref) : undefined}
                style={{ background: tintOf(def) }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  inv.inspect(ref);
                }}
                onPointerDown={(e) =>
                  inv.drag.down(e.nativeEvent, {
                    ref,
                    w: itemSize(inv.ctx.items, item)[0],
                    h: itemSize(inv.ctx.items, item)[1],
                    rotated: false,
                    grabX: 0,
                    grabY: 0,
                    color: colorOf(def),
                    label: tileName(def),
                    el: e.currentTarget,
                  })
                }
              >
                <ItemArt items={inv.ctx.items} item={item} def={def} />
                <ItemLabel items={inv.ctx.items} item={item} def={def} />
                {item.found && <span className="inv-item-found">✓</span>}
                {holdsFavorite(item, favs, shown) && <span className="inv-item-star">★</span>}
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
  const favs = favorites();
  const { cell } = inv;
  const search = useContext(StashSearchContext);
  // Your own grids aren't searched, only the stash and what's in it.
  const hit = stashPageOf(gref.owner) >= 0 ? search?.hit : null;
  const tile = (g: Grid['items'][number], index: number, ox: number, oy: number) => {
    if (shown && !shown.has(g.item)) {
      const [sw, sh] = itemSize(inv.ctx.items, g.item);
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
    const size = itemSize(inv.ctx.items, g.item);
    const w = g.rotated ? size[1] : size[0];
    const h = g.rotated ? size[0] : size[1];
    const ref: ItemRef = { ...gref, index, item: g.item.item };
    return (
      <div
        key={index}
        className={`inv-item${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}${inv.isOpenBag(ref) ? ' open' : ''}${hit && !hit(g.item) ? ' dimmed' : ''}${holdsFavorite(g.item, favs) ? ' favorite' : ''}`}
        data-ref={JSON.stringify(ref)}
        data-gun={def.type === 'weapon' || isMagazine(def) ? JSON.stringify(ref) : undefined}
        data-armor={armorOf(def) ? JSON.stringify(ref) : undefined}
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
            w: size[0],
            h: size[1],
            rotated: g.rotated,
            grabX: Math.min(w - 1, Math.floor((e.clientX - r.left) / cell)),
            grabY: Math.min(h - 1, Math.floor((e.clientY - r.top) / cell)),
            color: colorOf(def),
            label: tileName(def),
            el: e.currentTarget,
          });
        }}
      >
        <ItemArt items={inv.ctx.items} item={g.item} def={def} cell={cell} rotated={g.rotated} />
        <ItemLabel items={inv.ctx.items} item={g.item} def={def} />
        {g.item.found && <span className="inv-item-found">✓</span>}
        {holdsFavorite(g.item, favs) && <span className="inv-item-star">★</span>}
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
  const { cell } = props;
  const [w, h] = itemSize(props.items, props.item);
  const url = itemPortrait(props.items, props.item, [w, h]);
  if (!url) return null;
  if (cell === undefined)
    return <img className="inv-art inv-art-fit" src={url} alt="" draggable={false} />;
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

/** A color per item type, until the item editor gives items their own icons. */
/** Gray, green, blue, purple, gold and red (design.md → Item tiles). */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#6f767d',
  uncommon: '#5c9a4a',
  rare: '#3d6fb0',
  epic: '#7d4fb3',
  legendary: '#c0962e',
  mythic: '#b8423a',
};

/** An item's color, by its rarity. */
export function colorOf(def: ItemDef): string {
  return RARITY_COLORS[def.rarity];
}

/**
 * An item tile's background: its rarity's color rising from the bottom edge over the dark
 * cell (2026-11-06, the Delta Force look). Translucent all the way, so the grid's lines show
 * through the tile (2026-11-09).
 */
function tintOf(def: ItemDef): string {
  const c = RARITY_COLORS[def.rarity];
  return `linear-gradient(to top, ${c}8c, ${c}40 55%, ${c}26)`;
}

// Scratch for a gun's magazine size with its attachments.
const gunStats = createWeaponStats();

/**
 * What a tile shows: its name, and bottom right a badge (a stack's count, durability…).
 * Every count or amount goes bottom right, in that one badge (the user's rule, 2026-11-09).
 * A gun shows the caliber it takes under its name, without dots (5.56x45 reads 556x45),
 * and loaded/capacity in the corner, larger; rigs and backpacks show only their name.
 */
function ItemLabel({ items, item, def }: { items: ItemDb; item: Item; def: ItemDef }): ReactNode {
  if (def.type === 'weapon') {
    const capacity = weaponStats(items, item as WeaponState, gunStats).magazine;
    return (
      <>
        <span className="inv-item-name">
          {tileName(def)}
          <span className="inv-item-ammo">{caliberOf(items, def).replaceAll('.', '')}</span>
        </span>
        <span className="inv-item-badge inv-item-mag">
          {item.mag ?? 0}/{capacity}
        </span>
      </>
    );
  }
  if (isMagazine(def)) {
    // How full it is (MG-1), and a stripe in its round's tip color (its level's, MG-2), so
    // AP and flesh rounds read at a glance whatever the magazine's own color.
    const round = (item.mag ?? 0) > 0 && item.loaded ? roundOf(items, item.loaded) : null;
    return (
      <>
        {round && (
          <span className="inv-item-stripe" style={{ background: levelColor(round.level) }} />
        )}
        <span className="inv-item-name">{tileName(def)}</span>
        <span className="inv-item-badge inv-item-mag">
          {item.mag ?? 0}/{def.capacity}
        </span>
      </>
    );
  }
  // No level tag on ammo and armor tiles (2026-11-09): the tile's rarity color says it.
  return (
    <>
      <span className="inv-item-name">{tileName(def)}</span>
      <span className={armorOf(def) ? 'inv-item-badge inv-item-light' : 'inv-item-badge'}>
        {carrierBadge(items, item, def) ?? badge(item, def)}
      </span>
    </>
  );
}

/**
 * How many cells a rig or backpack holds (2026-11-09, the user's call, until they have
 * icons): its sections' cells, or its whole grid's.
 */
function cellsInside(def: Extract<ItemDef, { type: 'container' }>): number {
  if (!def.sections) return def.grid[0] * def.grid[1];
  return def.sections.reduce((n, s) => n + s.size[0] * s.size[1], 0);
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

/** A tile's badge in words, for the hover card: "Durability 40/40", "12 cells", "2/2 uses". */
function hoverState(def: ItemDef, state: string): string {
  if (armorOf(def)) return `Durability ${state}`;
  if (def.type === 'container') return `${state} cells`;
  if (def.type === 'med' && def.effect !== 'heal') return `${state} uses`;
  return state;
}

/** What an item's tile says: its short name, or its name (2026-11-06). */
export function tileName(def: ItemDef): string {
  return def.shortName ?? def.name;
}

/** A durability to one decimal place, without a trailing ".0". */
export function tenths(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * The small text in an item's bottom-right corner: a stack's count, durability, a medkit's
 * HP, a med's or key's uses, a rig's cells or a repair kit's points left (whole numbers)…
 */
/**
 * A carrier's tile (GZ-4): its plates' levels front/back ("5/4"), "—" for an empty slot;
 * with no plate slots, its own soft rating's level; null if it isn't a carrier.
 */
function carrierBadge(items: ItemDb, item: Item, def: ItemDef): string | null {
  const carrier = carrierOf(def);
  if (!carrier) return null;
  const level = (p: Item | undefined) => (p ? `${armorStatsOf(items, p.item).level}` : '—');
  if (!carrier.plates?.length) return softZonesOf(carrier).length ? `${armorOf(def)!.level}` : '—';
  return carrier.plates.map((s) => level(item.plates?.[s])).join('/');
}

function badge(item: Item, def: ItemDef): string {
  switch (def.type) {
    case 'plate':
    case 'visor':
      return `${tenths(item.durability ?? 0)}/${tenths(item.max ?? def.durability)}`;
    case 'armor':
      // Out of its max now, which repairs wear down (sim/repair.ts).
      return `${tenths(item.durability ?? 0)}/${tenths(item.max ?? def.durability)}`;
    case 'med':
      // The HP left, whole (a heal spends fractions of it), without "HP"; other meds' uses
      // left out of their total, like 2/2 (2026-11-09).
      return def.effect === 'heal'
        ? `${Math.floor(item.left ?? 0)}`
        : `${item.left ?? def.uses ?? 1}/${def.uses ?? 1}`;
    case 'repair':
      return `${Math.floor(item.left ?? 0)}`;
    case 'key':
      // Uses left out of its total, like 1/3 (2026-11-09), not ×1.
      return def.uses === undefined ? '' : `${item.left ?? def.uses}/${def.uses}`;
    case 'container':
      // How many cells it holds; the vault is never a tile.
      // An armored rig shows its durability, as armor does (2026-11-11).
      if (def.armor)
        return `${tenths(item.durability ?? 0)}/${tenths(item.max ?? def.armor.durability)}`;
      return def.slot === 'vault' ? '' : `${cellsInside(def)}`;
    default:
      return stackSize(def) > 1 || item.count > 1 ? `${item.count}` : '';
  }
}
