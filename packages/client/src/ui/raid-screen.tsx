import {
  itemDef,
  lootContainerById,
  stackSize,
  type Character,
  type GearSlot,
  type Grid,
  type GridName,
  type GridRef,
  type Item,
  type ItemDb,
  type ItemDef,
  type ItemRef,
  type Owner,
} from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';
import type { InventoryController } from './inventory-controller';

type Tab = 'inventory' | 'map' | 'quests';

interface Props {
  inv: InventoryController;
  /** Bumped whenever the state may have changed, to redraw. */
  version: number;
}

/** The in-raid screen: inventory (with looting), map and quests tabs. */
export function RaidScreen({ inv, version }: Props): ReactNode {
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
        <button className="primary" onClick={close}>
          Close
        </button>
      </header>
      {tab === 'inventory' ? (
        <Inventory inv={inv} version={version} />
      ) : (
        <div className="raid-empty">
          {tab === 'map'
            ? 'The map comes with the raid lifecycle (session 11).'
            : 'Quests come in session 14.'}
        </div>
      )}
    </div>
  );
}

const SELF: Owner = { kind: 'self' };
const MY_SLOTS: readonly GearSlot[] = [
  'primary1',
  'primary2',
  'sidearm',
  'knife',
  'helmet',
  'bodyArmour',
  'rig',
  'backpack',
];
const BODY_SLOTS: readonly GearSlot[] = [
  'primary1',
  'primary2',
  'sidearm',
  'helmet',
  'bodyArmour',
  'rig',
  'backpack',
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
/** Gun slots are drawn twice as wide. */
const WIDE: ReadonlySet<GearSlot> = new Set(['primary1', 'primary2']);

function Inventory({ inv, version }: Props): ReactNode {
  const { ctx, selected } = inv;
  useEffect(() => () => inv.drag.cancel(), [inv]);
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
        {selected && sel ? (
          <>
            <span className="inv-bar-name">{sel.def.name}</span>
            <span className="inv-bar-info">{details(ctx.items, sel.item, sel.def)}</span>
            <span className="raid-spacer" />
            {'index' in selected && sel.def.size[0] !== sel.def.size[1] && (
              <button onClick={() => inv.rotate(selected)}>Rotate</button>
            )}
            <button onClick={() => inv.quick(selected)}>
              {quickLabel(selected, inv.quickTo(selected))}
            </button>
          </>
        ) : (
          <span className="inv-hint">
            Double-tap to move · drag to place · while dragging, tap with another finger (or press
            R) to rotate
          </span>
        )}
      </footer>
    </div>
  );
}

function Loot({ inv }: { inv: InventoryController }): ReactNode {
  const { ctx, target } = inv;
  if (!target) {
    return (
      <p className="raid-note">
        Nothing open. Walk up to a container or a body and press <b>loot</b>.
      </p>
    );
  }
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
  const grids: [string, GridName, Grid | null][] = [
    ['Pockets', 'pockets', g.pockets],
    ['Rig', 'rig', g.rig?.grid ?? null],
    ['Backpack', 'backpack', g.backpack?.grid ?? null],
  ];
  if (vault) grids.push(['Vault · kept if you die', 'vault', g.vault]);
  return (
    <>
      {grids.map(([label, name, grid]) =>
        grid ? (
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
            className={`inv-slot${WIDE.has(slot) ? ' wide' : ''}`}
            data-drop={JSON.stringify({ owner, slot })}
          >
            <span className="inv-slot-name">
              {SLOT_NAMES[slot]}
              {inHand ? ' · in hand' : ''}
            </span>
            {item && def && ref && (
              <div
                className={`inv-item${inv.isSelected(ref) ? ' selected' : ''}`}
                style={{ background: colourOf(def) }}
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
                <span className="inv-item-name">{def.name}</span>
                <span className="inv-item-badge">{badge(item, def)}</span>
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
            className={`inv-item${inv.isSelected(ref) ? ' selected' : ''}`}
            style={{
              left: g.x * cell,
              top: g.y * cell,
              width: w * cell,
              height: h * cell,
              background: colourOf(def),
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
            <span className="inv-item-name">{def.name}</span>
            <span className="inv-item-badge">{badge(g.item, def)}</span>
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
const TYPE_COLOURS: Record<ItemDef['type'], string> = {
  weapon: '#56653f',
  ammo: '#7d6a2e',
  armour: '#3f5266',
  attachment: '#5a4870',
  med: '#7a3434',
  container: '#4c5a36',
  melee: '#4e4e4e',
  key: '#8a6a22',
  quest: '#6b3a6b',
  loot: '#6e5f30',
  repair: '#2f6363',
};

function colourOf(def: ItemDef): string {
  return TYPE_COLOURS[def.type];
}

/** The small text in an item's corner: a stack's count, rounds loaded, durability… */
function badge(item: Item, def: ItemDef): string {
  switch (def.type) {
    case 'weapon':
      return `${item.mag ?? 0}`;
    case 'armour':
      return `${Math.ceil(item.durability ?? 0)}/${def.durability}`;
    case 'med':
      if (def.effect === 'heal') return `${item.left ?? 0} HP`;
      return (def.uses ?? 1) > 1 ? `×${item.left ?? 0}` : '';
    case 'repair':
      return `${item.left ?? 0}`;
    case 'container': {
      const n = item.grid?.items.length ?? 0;
      return n ? `${n} in` : '';
    }
    default:
      return stackSize(def) > 1 || item.count > 1 ? `${item.count}` : '';
  }
}

/** A line about the selected item. */
function details(items: ItemDb, item: Item, def: ItemDef): string {
  switch (def.type) {
    case 'weapon': {
      const ammo = itemDef(items, def.ammo).name;
      const on = Object.values(item.attachments ?? {}).filter((a): a is string => !!a);
      const names = on.map((a) => itemDef(items, a).name).join(', ');
      return `${item.mag ?? 0} loaded · ${ammo}${names ? ` · ${names}` : ''}`;
    }
    case 'armour':
      return `Durability ${Math.ceil(item.durability ?? 0)}/${def.durability} · absorbs ${Math.round(def.absorb * 100)}%`;
    case 'med':
      return def.effect === 'heal' ? `${item.left ?? 0} HP left` : `${item.left ?? 1} use(s) left`;
    case 'container':
      return `${def.grid[0]}×${def.grid[1]} inside`;
    default:
      return stackSize(def) > 1 ? `${item.count} / ${stackSize(def)}` : '';
  }
}
