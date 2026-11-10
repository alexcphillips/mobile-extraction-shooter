import {
  calibreOf,
  condition,
  createWeaponStats,
  firesRound,
  grenadeEffect,
  isMoney,
  itemDef,
  loadedAmmo,
  objectiveText,
  roundOf,
  sellParts,
  weaponStats,
  type BurnStats,
  type AttachmentMods,
  type Item,
  type ItemDb,
  type ItemDef,
  type QuestDef,
  type WeaponState,
  repairLossOf,
  hasSource,
  itemUsage,
  type ItemSource,
} from '@mes/shared';
import { useEffect, useMemo, type ReactNode } from 'react';
import { itemOrigins } from '../content';
import { itemPortrait } from '../render/item-portrait';
import { levelColour } from './levels';
import { colourOf, tenths } from './raid-screen';

/*
 * The item details (2026-10-30, after Delta Force): a tap on any item, in a raid or
 * between raids, opens a card with its picture, name, description, what it does, what a
 * vendor pays for it, where it comes from and what wants it; the item's actions go along
 * the bottom. In the inventory it's a panel over your gear and what you carry (UX-2), with
 * no backdrop, so the stash, body or container stays in view and usable beside it.
 */

/** Every item's description, until items have their own. */
const DESCRIPTION = 'Placeholder';

/** Kinds whose stats say what they are, so they have no description (UX-2, the user's call). */
const NO_DESCRIPTION: ReadonlySet<ItemDef['type']> = new Set(['weapon', 'armour', 'container']);

/** Vendor levels as the vendors page writes them. */
const ROMAN = ['', 'I', 'II', 'III', 'IV'];

/** At most this many container kinds are named; the rest are counted. */
const MOST_CONTAINERS = 6;

const MED_EFFECTS: Record<string, string> = {
  heal: "Restores HP to limbs that aren't broken, from its pool.",
  bandage: 'Stops a limb bleeding.',
  splint: "Takes away a broken limb's effects. The limb stays at 0 HP.",
  surgery: 'Brings a broken limb back to 1 HP.',
};

type Row = [label: string, value: ReactNode];

// Scratch for a gun's stats with its attachments.
const stats = createWeaponStats();

export function ItemDetails({
  items,
  item,
  quests,
  buyFor,
  extra,
  actions,
  panel = false,
  onClose,
}: {
  items: ItemDb;
  item: Item;
  /** To show the quests that want it. */
  quests?: readonly QuestDef[] | undefined;
  /** On a vendor's offer: what it costs. */
  buyFor?: number | undefined;
  /** Under the details: a gun's attachment slots. */
  extra?: ReactNode;
  /** Buttons along the bottom. */
  actions?: ReactNode;
  /** A panel placed by its parent, with no backdrop (the inventory's), not a card over everything. */
  panel?: boolean;
  onClose: () => void;
}): ReactNode {
  const def = itemDef(items, item.item);
  useEffect(() => {
    // Before a page's own Escape (which would go back, on the main menu's pages).
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const attachments = item.attachments;
  const picture = useMemo(
    () => itemPortrait(items, item),
    // A gun's picture changes with its attachments; nothing else changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, item.item, attachments?.optic, attachments?.muzzle, attachments?.magazine],
  );
  const usage = quests ? itemUsage(quests, def.id).quests : [];
  const source = itemOrigins().get(def.id);
  const card = (
    <div
      className={`item-details${panel ? ' panel' : ''}`}
      role="dialog"
      aria-label={def.name}
      style={{ borderTopColor: colourOf(def) }}
    >
      <header className="item-details-head">
        <h2>{def.name}</h2>
        <span className="item-details-kind">
          {kindOf(def)} · {def.rarity[0]!.toUpperCase() + def.rarity.slice(1)}
        </span>
        <span className="raid-spacer" />
        <button className="item-details-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="item-details-scroll">
        <div className="item-details-body">
          <div
            className="item-details-pic"
            style={{ background: `${colourOf(def)}33`, borderColor: colourOf(def) }}
          >
            {picture && <img src={picture} alt="" draggable={false} />}
          </div>
          <div className="item-details-info">
            {!NO_DESCRIPTION.has(def.type) && <p className="item-details-desc">{DESCRIPTION}</p>}
            <Value items={items} item={item} buyFor={buyFor} />
          </div>
        </div>
        <dl className="item-details-stats">
          {item.found && (
            <div>
              <dt>Found in raid</dt>
              <dd>Yes</dd>
            </div>
          )}
          {rows(items, item, def).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {extra}
        {usage.length > 0 && (
          <section className="item-details-more">
            <h3>{def.type === 'quest' ? 'Quest item for' : 'Usage'}</h3>
            {usage.map(({ quest, objective }) => (
              <p key={`${quest.id} ${objective.id}`}>
                <b>{quest.name}</b> · {objectiveText(items, objective)}
              </p>
            ))}
          </section>
        )}
        {hasSource(source) && <Source source={source} />}
      </div>
      {actions && <footer className="item-details-actions">{actions}</footer>}
    </div>
  );
  if (panel) return card;
  return (
    <div
      className="item-details-back"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {card}
    </div>
  );
}

/** Where it comes from (UX-2): containers, loose spots, enemies, vendors and quests. */
function Source({ source: s }: { source: ItemSource }): ReactNode {
  const lines: Row[] = [];
  if (s.containers.length) {
    const named = s.containers.slice(0, MOST_CONTAINERS).join(', ');
    const more = s.containers.length - MOST_CONTAINERS;
    lines.push(['Containers', more > 0 ? `${named} and ${more} more` : named]);
  }
  if (s.loose.length) lines.push(['Lying loose', s.loose.join(', ')]);
  if (s.enemies.length) lines.push(['On enemies', s.enemies.join(', ')]);
  if (s.vendors.length)
    lines.push(['Sold by', s.vendors.map((v) => `${v.vendor} ${ROMAN[v.level]}`).join(', ')]);
  if (s.rewards.length) lines.push(['Quest reward', s.rewards.join(', ')]);
  for (const q of s.questSpots) lines.push(['Quest spot', `${q.map} (${q.quest})`]);
  return (
    <section className="item-details-more">
      <h3>Source</h3>
      <dl className="item-details-list">
        {lines.map(([label, value]) => (
          <div key={label + String(value)}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** What a vendor pays for it, part by part for a gun with attachments or rounds in it. */
function Value({
  items,
  item,
  buyFor,
}: {
  items: ItemDb;
  item: Item;
  buyFor?: number | undefined;
}): ReactNode {
  const def = itemDef(items, item.item);
  const parts = sellParts(items, item);
  const total = parts.reduce((n, p) => n + p.price, 0);
  const money = isMoney(items, def.id);
  const worn = condition(items, item) < 1;
  return (
    <div className="item-details-value">
      {buyFor !== undefined && (
        <div className="item-details-total">
          <span>Costs</span>
          <b>{buyFor.toLocaleString()}</b>
        </div>
      )}
      {total > 0 && (
        <div className="item-details-total">
          <span>{money ? 'Worth' : 'Vendors pay'}</span>
          <b>{total.toLocaleString()}</b>
        </div>
      )}
      {total > 0 && parts.length > 1 && (
        <ul className="item-details-parts">
          {parts.map((p) => (
            <li key={p.id}>
              <span>
                {itemDef(items, p.id).name}
                {p.count > 1 && ` × ${p.count}`}
              </span>
              <span>{p.price.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      {total > 0 && worn && <p className="raid-note">Less than new: it's worn or part-used.</p>}
      {money && (
        <p className="raid-note">Goes into your money at its full value when you get out.</p>
      )}
    </div>
  );
}

function kindOf(def: ItemDef): string {
  switch (def.type) {
    case 'weapon':
      return 'Gun';
    case 'ammo':
      return 'Ammo';
    case 'armour':
      return def.slot === 'helmet' ? 'Helmet' : 'Body armour';
    case 'attachment':
      return { optic: 'Optic', muzzle: 'Muzzle device', magazine: 'Magazine' }[def.slot];
    case 'med':
      return 'Medical';
    case 'container':
      return def.slot === 'rig' ? 'Rig' : 'Backpack';
    case 'melee':
      return 'Melee';
    case 'grenade':
      return 'Grenade';
    case 'key':
      return 'Key';
    case 'quest':
      return 'Quest item';
    case 'loot':
      // Only loot has a category (2026-11-09), shown as written ("Industrial"); keys,
      // guns, armour and the rest show their kind.
      if (def.money) return 'Money';
      return def.category ?? 'Loot';
    case 'repair':
      return 'Repair kit';
  }
}

function Level({ level }: { level: number }): ReactNode {
  return (
    <i className="level-tag" style={{ background: levelColour(level) }}>
      {level}
    </i>
  );
}

const seconds = (s: number): string => `${+s.toFixed(2)} s`;
const percent = (f: number): string => `${Math.round(f * 100)}%`;

/** An attachment's change to a stat, as a percentage: "−20%". */
function change(m: number): string {
  const p = Math.round((m - 1) * 100);
  return p > 0 ? `+${p}%` : `−${-p}%`;
}

function modRows(mods: AttachmentMods): Row[] {
  const out: Row[] = [];
  if (mods.magazine) out.push(['Magazine', `+${mods.magazine} rounds`]);
  if (mods.spread) out.push(['Spread', change(mods.spread)]);
  if (mods.recoil) out.push(['Recoil', change(mods.recoil)]);
  if (mods.recoilUp) out.push(['Vertical recoil', change(mods.recoilUp)]);
  if (mods.recoilSide) out.push(['Horizontal recoil', change(mods.recoilSide)]);
  if (mods.ergonomics) out.push(['Ergonomics', change(mods.ergonomics)]);
  if (mods.aimTime) out.push(['Aim time', change(mods.aimTime)]);
  if (mods.reloadTime) out.push(['Reload time', change(mods.reloadTime)]);
  if (mods.loudness) out.push(['Loudness', change(mods.loudness)]);
  return out;
}

/** What flamethrower fuel's burning does to whoever it sets alight. */
const burns = (f: BurnStats): string =>
  `sets alight · ${f.burnDamage} a second to every limb, past armour, for ${seconds(f.burnTime)}`;

/** A launcher's impact fuse, for after its launch speed. */
const impact = (arm: number | undefined): string =>
  arm === undefined ? '' : ` · goes off on impact past ${arm} m`;

/** A grenade's launchers, if any gun fires it. */
function launchers(items: ItemDb, id: string): Row[] {
  const guns = [...items.values()].filter(
    (g) => g.type === 'weapon' && !g.spawns && firesRound(items, g, id),
  );
  return guns.length ? [['Fired by', guns.map((g) => g.name).join(', ')]] : [];
}

/** The stats that matter for each kind of item. */
function rows(items: ItemDb, item: Item, def: ItemDef): Row[] {
  switch (def.type) {
    case 'weapon': {
      const s = weaponStats(items, item as WeaponState, stats);
      const round = roundOf(items, loadedAmmo(items, item))!;
      return [
        ['Fire rate', `${def.rpm} rpm · ${def.fireMode === 'auto' ? 'auto' : 'semi'}`],
        ['Calibre', calibreOf(items, def)],
        ['Loaded', `${item.mag ?? 0}/${s.magazine} · ${round.name}`],
        [
          'Damage',
          round.type === 'grenade' ? (
            round.damage > 0 ? (
              <>
                <Level level={round.level} />
                {round.damage} at the centre · {round.radius} m radius
              </>
            ) : (
              `none · ${grenadeEffect(round)}, ${round.radius} m radius`
            )
          ) : round.flame ? (
            burns(round.flame)
          ) : (
            <>
              <Level level={round.level} />
              {round.damage}
              {round.pellets ? ` × ${round.pellets}` : ''} · {round.armourDamage} to armour
              {round.incendiary ? ` · ${percent(round.incendiary.chance)} to set alight` : ''}
            </>
          ),
        ],
        ['Reload', seconds(s.reloadTime)],
        ['Aim time', seconds(s.aimTime)],
        [
          'Recoil',
          `${+s.recoilUp.toFixed(2)}° up · ${+s.recoilSide.toFixed(2)}° side · recovers ${+s.recoilRecovery.toFixed(2)}/s` +
            (s.recoilAngle
              ? ` · drifts ${Math.abs(s.recoilAngle)}° ${s.recoilAngle > 0 ? 'right' : 'left'}`
              : '') +
            (s.recoilStableAfter ? ` · steadies after ${s.recoilStableAfter} rounds` : ''),
        ],
        ['Spread', `${+s.hipSpread.toFixed(2)}° hip · ${+s.aimSpread.toFixed(2)}° aimed`],
        def.launchSpeed
          ? ['Launch speed', `${def.launchSpeed} m/s${impact(def.armDistance)}`]
          : round.type === 'ammo' && round.flame
            ? ['Range', `${def.range} m · flames fly at ${round.flame.speed} m/s`]
            : ['Range', `${def.range} m`],
        ['Heard from', `${Math.round(s.loudness)} m`],
      ];
    }
    case 'ammo': {
      const guns = [...items.values()].filter(
        (g) => g.type === 'weapon' && !g.spawns && firesRound(items, g, def.id),
      );
      if (def.flame) {
        return [
          ['Calibre', def.calibre],
          ['Damage', burns(def.flame)],
          [
            'Fire',
            `burns ${seconds(def.flame.fireTime)} where it lands, lighting whoever touches it`,
          ],
          ['Stack', `${item.count} / ${def.stack}`],
          ['Fired by', guns.length ? guns.map((g) => g.name).join(', ') : 'no gun yet'],
        ];
      }
      return [
        ['Calibre', def.calibre],
        ['Penetration', <Level key="l" level={def.level} />],
        ['Damage', `${def.damage}${def.pellets ? ` × ${def.pellets} pellets` : ''}`],
        ['Armour damage', `${def.armourDamage}`],
        ['Bleed chance', percent(def.bleedChance)],
        ...(def.incendiary
          ? [
              [
                'Incendiary',
                `${percent(def.incendiary.chance)} a hit · ${burns(def.incendiary)}`,
              ] as Row,
            ]
          : []),
        ['Stack', `${item.count} / ${def.stack}`],
        ['Fired by', guns.length ? guns.map((g) => g.name).join(', ') : 'no gun yet'],
      ];
    }
    case 'armour':
      return [
        ['Protection', <Level key="l" level={def.level} />],
        ['Durability', `${tenths(item.durability ?? 0)} / ${tenths(item.max ?? def.durability)}`],
        // Repairs wear the max down (sim/repair.ts).
        ...(item.max !== undefined
          ? [['Max durability', `${tenths(item.max)} of ${def.durability}`] as Row]
          : []),
        ['Repair loss', `${Math.round(repairLossOf(def) * 100)}% of what's mended`],
        // A face mask's cost (AI-7, Jug's).
        ...(def.mask?.edge || def.mask?.muffle
          ? [
              [
                'Mask',
                [
                  def.mask.edge
                    ? `hides ${Math.round(def.mask.edge * 100)}% of the view each side`
                    : '',
                  def.mask.muffle ? 'muffles sound' : '',
                ]
                  .filter(Boolean)
                  .join(', '),
              ] as Row,
            ]
          : []),
      ];
    case 'attachment': {
      const fits = def.weapons
        ? def.weapons.map((id) => itemDef(items, id).name).join(', ')
        : `any gun with a ${def.slot} slot`;
      const out: Row[] = [['Fits', fits]];
      if (def.optic) out.push(['Zoom', `${def.optic.zoom}×`]);
      return [...out, ...modRows(def.mods ?? {})];
    }
    case 'med': {
      const out: Row[] = [['Does', MED_EFFECTS[def.effect]]];
      if (def.effect === 'heal') out.push(['HP left', `${Math.floor(item.left ?? 0)} / ${def.hp}`]);
      else out.push(['Uses left', `${item.left ?? 1} / ${def.uses ?? 1}`]);
      out.push(['Use time', seconds(def.useTime)]);
      return out;
    }
    case 'container':
      return [
        [
          'Inside',
          `${def.grid[0]} × ${def.grid[1]} cells${def.sections ? ` in ${def.sections.length} sections` : ''}`,
        ],
      ];
    case 'melee':
      return [
        [
          'Damage',
          <>
            <Level level={def.level} />
            {def.damage} · {def.armourDamage} to armour
          </>,
        ],
        ['Bleed chance', percent(def.bleedChance)],
        ['Swing time', seconds(def.swingTime)],
        ['Reach', `${def.reach} m`],
      ];
    case 'grenade': {
      const effect = grenadeEffect(def);
      const end: Row[] = [
        ['Fuse', effect === 'c4' ? `${seconds(def.fuse)} after the detonator` : seconds(def.fuse)],
        ['Heard from', `${def.loudness} m`],
        ...launchers(items, def.id),
      ];
      if (effect === 'flash')
        return [
          ['Effect', 'Blinds whoever is looking at it'],
          ['Radius', `${def.radius} m`],
          ['Blinds for', `up to ${seconds(def.blindTime ?? 0)}`],
          ...end,
        ];
      if (effect === 'smoke')
        return [
          ['Effect', 'A cloud enemies can’t see through'],
          ['Cloud', `${def.radius} m · ${seconds(def.smokeTime ?? 0)}`],
          ...end,
        ];
      if (effect === 'molotov' && def.fire)
        return [
          ['Effect', 'Breaks where it lands and spills fire; can’t be fired from a launcher'],
          ['Fire', `${def.radius} m across · burns ${seconds(def.fire.fireTime)}`],
          ['Damage', burns(def.fire)],
          ['Heard from', `${def.loudness} m`],
        ];
      return [
        ...(effect === 'c4'
          ? [['Effect', 'Sticks where it lands; set it off with the detonator'] as Row]
          : []),
        [
          'Damage',
          <>
            <Level level={def.level} />
            {def.damage} at the centre · {def.armourDamage} to armour
          </>,
        ],
        ['Radius', `${def.radius} m`],
        ['Bleed chance', percent(def.bleedChance)],
        ...end,
      ];
    }
    case 'key':
      return [
        [
          'Uses',
          def.uses === undefined ? 'Never wears out' : `${item.left ?? 0} / ${def.uses} left`,
        ],
      ];
    case 'repair':
      return [
        ['Does', 'Restores durability to armour.'],
        ['Points left', `${Math.floor(item.left ?? 0)} / ${def.points}`],
        ['Use time', `${seconds(def.useTime)} in a raid, at once in the stash`],
      ];
    case 'loot':
      return def.stack ? [['Stack', `${item.count} / ${def.stack}`]] : [];
    case 'quest':
      return [];
  }
}
