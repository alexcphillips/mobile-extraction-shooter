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
  questsFor,
  roundOf,
  sellParts,
  weaponStats,
  type AttachmentMods,
  type Item,
  type ItemDb,
  type ItemDef,
  type QuestDef,
  type WeaponState,
} from '@mes/shared';
import { useEffect, useMemo, type ReactNode } from 'react';
import { itemPortrait } from '../render/item-portrait';
import { levelColour } from './levels';
import { colourOf } from './raid-screen';

/*
 * The item details (2026-10-30, after Delta Force): a tap on any item, in a raid or
 * between raids, opens a card with its picture, name, description, what it does, what a
 * vendor pays for it and the quests that want it; the item's actions go along the bottom.
 */

/** Every item's description, until items have their own. */
const DESCRIPTION = 'Placeholder';

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
  const wanted = quests ? questsFor(quests, def.id) : [];
  return (
    <div
      className="item-details-back"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="item-details"
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
        <div className="item-details-body">
          <div
            className="item-details-pic"
            style={{ background: `${colourOf(def)}33`, borderColor: colourOf(def) }}
          >
            {picture && <img src={picture} alt="" draggable={false} />}
          </div>
          <div className="item-details-info">
            <p className="item-details-desc">{DESCRIPTION}</p>
            <dl className="item-details-stats">
              {rows(items, item, def).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {wanted.length > 0 && (
              <div className="item-details-quests">
                <h3>{def.type === 'quest' ? 'Quest item for' : 'Needed for'}</h3>
                {wanted.map(({ quest, objective }) => (
                  <p key={`${quest.id} ${objective.id}`}>
                    <b>{quest.name}</b> · {objectiveText(items, objective)}
                  </p>
                ))}
              </div>
            )}
            <Value items={items} item={item} buyFor={buyFor} />
          </div>
        </div>
        {extra}
        {actions && <footer className="item-details-actions">{actions}</footer>}
      </div>
    </div>
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
      return def.money ? 'Money' : 'Loot';
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
  if (mods.aimTime) out.push(['Aim time', change(mods.aimTime)]);
  if (mods.reloadTime) out.push(['Reload time', change(mods.reloadTime)]);
  if (mods.loudness) out.push(['Loudness', change(mods.loudness)]);
  return out;
}

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
          ) : (
            <>
              <Level level={round.level} />
              {round.damage}
              {round.pellets ? ` × ${round.pellets}` : ''} · {round.armourDamage} to armour
            </>
          ),
        ],
        ['Reload', seconds(s.reloadTime)],
        ['Aim time', seconds(s.aimTime)],
        ['Recoil', `${+s.recoilUp.toFixed(2)}° up · ${+s.recoilSide.toFixed(2)}° side`],
        ['Spread', `${+s.hipSpread.toFixed(2)}° hip · ${+s.aimSpread.toFixed(2)}° aimed`],
        def.launchSpeed
          ? ['Launch speed', `${def.launchSpeed} m/s${impact(def.armDistance)}`]
          : ['Range', `${def.range} m`],
        ['Heard from', `${Math.round(s.loudness)} m`],
      ];
    }
    case 'ammo': {
      const guns = [...items.values()].filter(
        (g) => g.type === 'weapon' && !g.spawns && firesRound(items, g, def.id),
      );
      return [
        ['Calibre', def.calibre],
        ['Penetration', <Level key="l" level={def.level} />],
        ['Damage', `${def.damage}${def.pellets ? ` × ${def.pellets} pellets` : ''}`],
        ['Armour damage', `${def.armourDamage}`],
        ['Bleed chance', percent(def.bleedChance)],
        ['Stack', `${item.count} / ${def.stack}`],
        ['Fired by', guns.length ? guns.map((g) => g.name).join(', ') : 'no gun yet'],
      ];
    }
    case 'armour':
      return [
        ['Protection', <Level key="l" level={def.level} />],
        ['Durability', `${Math.ceil(item.durability ?? 0)} / ${def.durability}`],
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
      if (def.effect === 'heal') out.push(['HP left', `${item.left ?? 0} / ${def.hp}`]);
      else out.push(['Uses left', `${item.left ?? 1} / ${def.uses ?? 1}`]);
      out.push(['Use time', seconds(def.useTime)]);
      return out;
    }
    case 'container':
      return [['Inside', `${def.grid[0]} × ${def.grid[1]} cells`]];
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
