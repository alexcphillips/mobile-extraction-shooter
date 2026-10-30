import {
  ATTACHMENT_SLOTS,
  ammoDef,
  cantSell,
  createWeaponStats,
  itemDef,
  loadedAmmo,
  lootContainerById,
  sellPrice,
  sellTotal,
  stackSize,
  timeToUse,
  weaponStats,
  type Character,
  type GearSlot,
  type Grid,
  type GridName,
  type GridRef,
  type AttachmentSlot,
  type Item,
  type ItemDb,
  type ItemDef,
  type ItemRef,
  type Owner,
  type Rarity,
  type WeaponState,
} from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { refKey, type InventoryController } from './inventory-controller';
import { MapTab } from './map-tab';
import type { RaidContext } from './raid';
import { levelColour, levelOf } from './levels';
import { RaidQuests } from './raid-quests';

type Tab = 'inventory' | 'map' | 'quests';

interface Props {
  inv: InventoryController;
  /** Bumped whenever the state may have changed, to redraw. */
  version: number;
}

/** The in-raid screen: inventory (with looting), map and quests tabs. */
export function RaidScreen({ inv, version, ctx }: Props & { ctx: RaidContext }): ReactNode {
  const [tab, setTab] = useState<Tab>('inventory');
  const close = inv.ctx.close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="raid" role="dialog" aria-label="Raid">
      <header className="raid-tabs">
        {(['inventory', 'map', 'quests'] as const).map((t) => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
        <span className="raid-spacer" />
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

const SELF: Owner = { kind: 'self' };
// In body order, as Tarkov's: head, chest, the guns, then the sidearm and knife side by side.
const MY_SLOTS: readonly GearSlot[] = [
  'helmet',
  'bodyArmour',
  'primary1',
  'primary2',
  'sidearm',
  'knife',
];
const BODY_SLOTS: readonly GearSlot[] = ['helmet', 'bodyArmour', 'primary1', 'primary2', 'sidearm'];
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
/** Gun slots are drawn twice as wide; the helmet and armour have a row each, centred. */
const WIDE: ReadonlySet<GearSlot> = new Set(['primary1', 'primary2']);
const CENTRE: ReadonlySet<GearSlot> = new Set(['helmet', 'bodyArmour']);

/** Your gear and grids, beside what's open (a body, a container, the ground or the stash). */
export function Inventory({ inv, version }: Props): ReactNode {
  useEffect(() => () => inv.drag.cancel(), [inv]);
  inv.followSelection();
  const { ctx, selected } = inv;
  const sel = selected && inv.find(selected);
  return (
    <div className="inv" style={{ ['--cell' as string]: `${inv.cell}px` }} data-version={version}>
      <div className="inv-cols">
        <section className="inv-col inv-gear">
          <h2>Gear</h2>
          <Slots inv={inv} owner={SELF} slots={MY_SLOTS} ch={ctx.player} />
        </section>
        <section className="inv-col">
          <CharacterGrids inv={inv} owner={SELF} ch={ctx.player} vault />
        </section>
        <section className="inv-col inv-loot">
          <Loot inv={inv} />
        </section>
      </div>
      <footer className="inv-bar">
        {inv.selling ? (
          <SellBar inv={inv} />
        ) : selected && sel ? (
          <>
            <span className="inv-bar-name">{sel.def.name}</span>
            <span className="inv-bar-info">{details(ctx.items, sel.item, sel.def)}</span>
            {sel.def.type === 'weapon' && <Parts inv={inv} gun={selected} item={sel.item} />}
            <span className="raid-spacer" />
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
            {ctx.sell && !('ground' in selected) && (
              <SellButton key={refKey(selected)} inv={inv} at={selected} item={sel.item} />
            )}
            {ctx.sell && inv.canPick(selected) && (
              <button onClick={() => inv.startSelling(selected)}>Sell several</button>
            )}
            {!('ground' in selected) && !ctx.stash && (
              <button onClick={() => inv.toGround(selected)}>Drop</button>
            )}
            <button onClick={() => inv.quick(selected)}>
              {quickLabel(selected, inv.quickTo(selected))}
            </button>
          </>
        ) : (
          <>
            <span className="inv-hint">
              {ctx.stash
                ? 'Double-tap to move between your gear and the stash · drag to place · drag a repair kit onto armour to mend it · while dragging, tap with another finger (or press R) to rotate'
                : 'Double-tap to move · drag to place, or onto the ground to drop · drag a repair kit onto armour to mend it · while dragging, tap with another finger (or press R) to rotate'}
            </span>
            {ctx.sell && <button onClick={() => inv.startSelling()}>Select to sell</button>}
          </>
        )}
      </footer>
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
  if (def.type !== 'armour' || armour.owner.kind !== 'self') return null;
  // While anything is being used, the pill at the top shows it (and stops it).
  if (inv.ctx.player.using) return null;
  if ((item.durability ?? 0) >= def.durability) return null;
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
 * The selected gun's attachment slots. Drop an attachment on one to put it on; drag one
 * off to a grid; tap one for a picker of those you can reach that fit; double-tap one to
 * take it off into what you carry.
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
  if (weapon.type !== 'weapon') return null;
  return (
    <div className="inv-parts">
      {ATTACHMENT_SLOTS.filter((s) => weapon.slots?.includes(s)).map((slot) => {
        const part = item.attachments?.[slot] ?? null;
        const def = part === null ? null : itemDef(items, part);
        return (
          <div
            key={slot}
            className={`inv-slot inv-part${inv.picking === slot ? ' open' : ''}`}
            data-drop={JSON.stringify({ gun, slot })}
            onClick={() => {
              if (!part) inv.togglePicker(slot);
            }}
          >
            <span className="inv-slot-name">{PART_NAMES[slot]}</span>
            {def && part ? (
              <div
                className="inv-item"
                style={{ background: tintOf(def), borderColor: colourOf(def) }}
                onPointerDown={(e) =>
                  inv.drag.down(e.nativeEvent, {
                    ref: { gun, slot, part },
                    w: def.size[0],
                    h: def.size[1],
                    rotated: false,
                    grabX: 0,
                    grabY: 0,
                    colour: colourOf(def),
                    label: def.name,
                    el: e.currentTarget,
                  })
                }
              >
                <span className="inv-item-name">{def.name}</span>
              </div>
            ) : (
              <span className="inv-part-empty">none</span>
            )}
          </div>
        );
      })}
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
  const { ctx, target } = inv;
  if (!target) return <Ground inv={inv} />;
  const name = ctx.nameOf(target);
  if (!inv.reach) {
    return (
      <>
        <h2>{name}</h2>
        <p className="raid-note">Out of reach.</p>
      </>
    );
  }
  if (target.kind === 'container') {
    const l = lootContainerById(ctx.sim, target.id)!;
    return (
      <>
        <h2>{name}</h2>
        <GridView inv={inv} gref={{ owner: target, grid: 'loot' }} grid={l.grid} />
      </>
    );
  }
  const id = target.kind === 'body' ? target.id : -1;
  const body = ctx.sim.entities.find((e) => e.id === id)!;
  return (
    <>
      <h2>{name}</h2>
      <Slots inv={inv} owner={target} slots={BODY_SLOTS} ch={body} />
      <CharacterGrids inv={inv} owner={target} ch={body} vault={false} />
    </>
  );
}

const TO_GROUND = JSON.stringify({ owner: { kind: 'ground' } });

/**
 * With nothing open: the items on the ground within reach. Drag one of yours here to drop
 * it; drag or double-tap one of these to take it.
 */
function Ground({ inv }: { inv: InventoryController }): ReactNode {
  const { cell, ctx } = inv;
  const near = inv.nearby();
  return (
    <>
      <h2>On the ground</h2>
      <div className="inv-ground" data-drop={TO_GROUND}>
        {near.map(({ ref, g }) => {
          const def = itemDef(ctx.items, g.item.item);
          return (
            <div
              key={ref.ground}
              className={`inv-item${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}`}
              data-gun={def.type === 'weapon' ? JSON.stringify(ref) : undefined}
              style={{
                width: def.size[0] * cell,
                height: def.size[1] * cell,
                background: tintOf(def),
                borderColor: colourOf(def),
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
                  label: def.name,
                  el: e.currentTarget,
                })
              }
            >
              <ItemLabel items={ctx.items} item={g.item} def={def} />
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
}: {
  inv: InventoryController;
  owner: Owner;
  ch: Character;
  vault: boolean;
}): ReactNode {
  const g = ch.gear;
  // As in Tarkov, the rig and backpack slots sit beside what's in them, not with the
  // rest of the gear: rig, pockets, backpack, then the vault.
  const grids: [string, GridName, Grid | null, GearSlot | null][] = [
    ['Rig', 'rig', g.rig?.grid ?? null, 'rig'],
    ['Pockets', 'pockets', g.pockets, null],
    ['Backpack', 'backpack', g.backpack?.grid ?? null, 'backpack'],
  ];
  if (vault) grids.push(['Vault · kept if you die', 'vault', g.vault, null]);
  return (
    <>
      {grids.map(([label, name, grid, slot]) =>
        slot ? (
          <div key={name} className="inv-section inv-holder">
            <Slots inv={inv} owner={owner} slots={[slot]} ch={ch} />
            {grid && <GridView inv={inv} gref={{ owner, grid: name }} grid={grid} />}
          </div>
        ) : grid ? (
          <div key={name} className="inv-section">
            <h3>{label}</h3>
            <GridView inv={inv} gref={{ owner, grid: name }} grid={grid} />
          </div>
        ) : null,
      )}
    </>
  );
}

function Slots({
  inv,
  owner,
  slots,
  ch,
}: {
  inv: InventoryController;
  owner: Owner;
  slots: readonly GearSlot[];
  ch: Character;
}): ReactNode {
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
            className={`inv-slot${WIDE.has(slot) ? ' wide' : CENTRE.has(slot) ? ' centre' : ''}`}
            data-drop={JSON.stringify({ owner, slot })}
          >
            {/* Named only while empty: the item's own name would show through it. */}
            {!item && <span className="inv-slot-name">{SLOT_NAMES[slot]}</span>}
            {item && def && ref && (
              <div
                className={`inv-item${inHand ? ' in-hand' : ''}${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}`}
                title={inHand ? 'In hand' : undefined}
                data-gun={def.type === 'weapon' ? JSON.stringify(ref) : undefined}
                data-armour={
                  def.type === 'armour' && owner.kind === 'self' ? JSON.stringify(ref) : undefined
                }
                style={{ background: tintOf(def), borderColor: colourOf(def) }}
                onPointerDown={(e) =>
                  inv.drag.down(e.nativeEvent, {
                    ref,
                    w: def.size[0],
                    h: def.size[1],
                    rotated: false,
                    grabX: 0,
                    grabY: 0,
                    colour: colourOf(def),
                    label: def.name,
                    el: e.currentTarget,
                  })
                }
              >
                <ItemLabel items={inv.ctx.items} item={item} def={def} />
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
}: {
  inv: InventoryController;
  gref: GridRef;
  grid: Grid;
}): ReactNode {
  const { cell } = inv;
  return (
    <div
      className="inv-grid"
      data-drop={JSON.stringify(gref)}
      style={{ width: grid.w * cell, height: grid.h * cell }}
    >
      {grid.items.map((g, index) => {
        const def = itemDef(inv.ctx.items, g.item.item);
        const w = g.rotated ? def.size[1] : def.size[0];
        const h = g.rotated ? def.size[0] : def.size[1];
        const ref: ItemRef = { ...gref, index, item: g.item.item };
        return (
          <div
            key={index}
            className={`inv-item${inv.isSelected(ref) ? ' selected' : ''}${inv.isPicked(ref) ? ' picked' : ''}`}
            data-gun={def.type === 'weapon' ? JSON.stringify(ref) : undefined}
            data-armour={
              def.type === 'armour' && gref.owner.kind === 'self' ? JSON.stringify(ref) : undefined
            }
            style={{
              left: g.x * cell,
              top: g.y * cell,
              width: w * cell,
              height: h * cell,
              background: tintOf(def),
              borderColor: colourOf(def),
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
                label: def.name,
                el: e.currentTarget,
              });
            }}
          >
            <ItemLabel items={inv.ctx.items} item={g.item} def={def} />
          </div>
        );
      })}
    </div>
  );
}

function quickLabel(ref: ItemRef, to: Owner): string {
  if (to.kind !== 'self') return 'Put in';
  if (ref.owner.kind !== 'self') return 'Take';
  return 'slot' in ref ? 'Stow' : 'Equip';
}

/** A colour per item type, until the item editor gives items their own icons. */
/** Gray, blue, purple and gold (design.md → Item tiles). */
const RARITY_COLOURS: Record<Rarity, string> = {
  common: '#6f767d',
  rare: '#3d6fb0',
  epic: '#7d4fb3',
  legendary: '#c0962e',
};

/** An item's colour, by its rarity. */
export function colourOf(def: ItemDef): string {
  return RARITY_COLOURS[def.rarity];
}

/** An item tile's background: its colour, see-through. */
function tintOf(def: ItemDef): string {
  return `${RARITY_COLOURS[def.rarity]}66`;
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
          {def.name}
          <span className="inv-item-ammo">{itemDef(items, loadedAmmo(items, item)).name}</span>
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
      <span className="inv-item-name">{def.name}</span>
      {level !== null && (
        <i className="level-tag inv-item-level" style={{ background: levelColour(level) }}>
          {level}
        </i>
      )}
      <span className="inv-item-badge">{badge(item, def)}</span>
    </>
  );
}

/** The small text in an item's corner: a stack's count, rounds loaded, durability… */
function badge(item: Item, def: ItemDef): string {
  switch (def.type) {
    case 'armour':
      return `${Math.ceil(item.durability ?? 0)}/${def.durability}`;
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

/** A line about the selected item. */
function details(items: ItemDb, item: Item, def: ItemDef): string {
  switch (def.type) {
    case 'weapon': {
      const round = ammoDef(items, loadedAmmo(items, item));
      return `${item.mag ?? 0} loaded · ${round.name} · fires ${round.calibre}`;
    }
    case 'armour':
      return `Level ${def.level} · durability ${Math.ceil(item.durability ?? 0)}/${def.durability}`;
    case 'ammo':
      return `Level ${def.level} · ${def.damage} damage${def.pellets ? ` × ${def.pellets}` : ''} · ${def.armourDamage} to armour · ${item.count} / ${def.stack}`;
    case 'med':
      return def.effect === 'heal' ? `${item.left ?? 0} HP left` : `${item.left ?? 1} use(s) left`;
    case 'container':
      return `${def.grid[0]}×${def.grid[1]} inside`;
    case 'key':
      return def.uses === undefined ? 'Never wears out' : `${item.left ?? 0}/${def.uses} uses left`;
    case 'repair':
      return `${Math.floor(item.left ?? 0)}/${def.points} points · select armour and press Repair`;
    default:
      return stackSize(def) > 1 ? `${item.count} / ${stackSize(def)}` : '';
  }
}
