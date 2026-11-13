import {
  caliberOf,
  condition,
  createWeaponStats,
  firesRound,
  grenadeEffect,
  isMoney,
  itemDef,
  itemWeight,
  loadedAmmo,
  objectiveText,
  roundOf,
  sellParts,
  weaponStats,
  type BurnStats,
  type AttachmentMods,
  type Item,
  type ItemDb,
  type ArmorStats,
  type ItemDef,
  type QuestDef,
  type WeaponState,
  repairLossOf,
  hasSource,
  itemUsage,
  type ItemSource,
  armorOf,
  softZonesOf,
  CARRIER,
  type CarrierDef,
} from '@mes/shared';
import { useEffect, useMemo, type ReactNode } from 'react';
import { hangarContent, itemOrigins } from '../content';
import { itemPortrait } from '../render/item-portrait';
import { levelColor } from './levels';
import { colorOf, tenths } from './raid-screen';

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
const NO_DESCRIPTION: ReadonlySet<ItemDef['type']> = new Set(['weapon', 'armor', 'container']);

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
  corner,
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
  /** In the picture's top right corner: the favorite star. */
  corner?: ReactNode;
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
    [
      items,
      item.item,
      attachments?.optic,
      attachments?.muzzle,
      attachments?.magazine,
      attachments?.laser,
      attachments?.stock,
      item.folded,
    ],
  );
  const uses = useMemo(() => itemUsage(quests ?? [], def.id, hangarContent()), [quests, def.id]);
  const usage = uses.quests;
  const crafting = uses.recipes.length > 0 || uses.upgrades.length > 0;
  const source = itemOrigins().get(def.id);
  const card = (
    <div
      className={`item-details${panel ? ' panel' : ''}`}
      role="dialog"
      aria-label={def.name}
      style={{ borderTopColor: colorOf(def) }}
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
            style={{ background: `${colorOf(def)}33`, borderColor: colorOf(def) }}
          >
            {picture && <img src={picture} alt="" draggable={false} />}
            {corner}
          </div>
          <div className="item-details-info">
            {!NO_DESCRIPTION.has(def.type) && <p className="item-details-desc">{DESCRIPTION}</p>}
            <Value items={items} item={item} buyFor={buyFor} />
          </div>
        </div>
        <dl className="item-details-stats">
          <div>
            <dt>Weight</dt>
            <dd>{weightText(items, item, def.weight)}</dd>
          </div>
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
        {crafting && (
          <section className="item-details-more">
            <h3>Hangar</h3>
            {uses.recipes.map(({ recipe, module }) => (
              <p key={recipe.id}>
                <b>
                  {module} {ROMAN[recipe.level]}
                </b>{' '}
                · {recipe.inputs.find((i) => i.item === def.id)!.count} to{' '}
                {recipe.output ? (
                  <>
                    craft {itemDef(items, recipe.output.item).name}
                    {(recipe.output.count ?? 1) > 1 && ` ×${recipe.output.count}`}
                  </>
                ) : (
                  'decrypt'
                )}
              </p>
            ))}
            {uses.upgrades.map(({ module, levels }) => (
              <p key={module}>
                <b>{module}</b> · upgrade:{' '}
                {levels.map((l) => `${l.count} for ${ROMAN[l.level]}`).join(', ')}
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
  if (s.crafted.length)
    lines.push(['Crafted at', s.crafted.map((c) => `${c.module} ${ROMAN[c.level]}`).join(', ')]);
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

/** Kg to three significant figures: "0.012 kg", "2.6 kg", "18.4 kg". */
export function kgText(kg: number): string {
  return `${Number(kg.toPrecision(3))} kg`;
}

/**
 * An item's weight (BW-3) with what's on and in it: a stack's per one, and a gun's,
 * bag's or carrier's bare weight when its parts or contents add to it.
 */
function weightText(items: ItemDb, item: Item, each: number): string {
  const total = itemWeight(items, item);
  if (item.count > 1) return `${kgText(total)} (${kgText(each)} each)`;
  if (total - each > 1e-6) return `${kgText(total)} (${kgText(each)} bare)`;
  return kgText(total);
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
    case 'armor':
      return def.slot === 'helmet' ? 'Helmet' : 'Body armor';
    case 'attachment':
      return {
        optic: 'Optic',
        muzzle: 'Muzzle device',
        magazine: 'Magazine',
        laser: 'Laser',
        stock: 'Stock',
      }[def.slot];
    case 'med':
      return 'Medical';
    case 'container':
      return def.slot === 'rig' ? (def.armor ? 'Armored rig' : 'Rig') : 'Backpack';
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
      // guns, armor and the rest show their kind.
      if (def.money) return 'Money';
      return def.category ?? 'Loot';
    case 'repair':
      return 'Repair kit';
    case 'headset':
      return 'Headset';
    case 'visor':
      return 'Visor';
    case 'nightVision':
      return 'Night vision';
    case 'plate':
      return def.material
        ? `${def.material[0]!.toUpperCase()}${def.material.slice(1)} plate`
        : 'Plate';
  }
}

/**
 * A carrier's rows (GZ-4): the chassis (slots, what its plates and own rating cover, bulk,
 * noise, swap time), then each plate in it.
 */
function carrierRows(items: ItemDb, item: Item, carrier: CarrierDef): Row[] {
  const zones = (z: readonly string[]) => (z.length ? z.join(' and ') : 'nothing');
  const out: Row[] = [];
  if (carrier.plates?.length) {
    out.push(['Plate slots', carrier.plates.join(' and ')]);
    out.push(['Plates cover', zones(carrier.plateZones ?? ['thorax'])]);
  }
  out.push(['Soft armor covers', zones(softZonesOf(carrier))]);
  if (carrier.blocksRig) out.push(['Bulky', 'no chest rig over it']);
  if (carrier.noise && carrier.noise !== 1)
    out.push(['Footsteps', `heard ${Math.round((carrier.noise - 1) * 100)}% further`]);
  if (carrier.plates?.length)
    out.push(['Plate swap', seconds(carrier.swapTime ?? CARRIER.swapTime)]);
  for (const side of carrier.plates ?? []) {
    const p = item.plates?.[side];
    const def = p && armorOf(itemDef(items, p.item));
    out.push([
      `${side[0]!.toUpperCase()}${side.slice(1)} plate`,
      p && def ? (
        <>
          <Level level={def.level} />
          {itemDef(items, p.item).name} · {tenths(p.durability ?? 0)}/
          {tenths(p.max ?? def.durability)}
        </>
      ) : (
        'empty'
      ),
    ]);
  }
  return out;
}

/** A hearing share as a signed percentage: "+20%", "−15%" (GZ-2). */
const hearingText = (h: number): string =>
  `${h > 0 ? '+' : '−'}${Math.round(Math.abs(h) * 100)}% range and loudness`;

function Level({ level }: { level: number }): ReactNode {
  return (
    <i className="level-tag" style={{ background: levelColor(level) }}>
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

/** What worn gear costs (GZ-1): aim time and move speed, as "+10%" and "−12%". */
function burdenRows(def: { aimTime?: number | undefined; moveSpeed?: number | undefined }): Row[] {
  const out: Row[] = [];
  if (def.aimTime && def.aimTime !== 1) out.push(['Aim time', change(def.aimTime)]);
  if (def.moveSpeed && def.moveSpeed !== 1) out.push(['Move speed', change(def.moveSpeed)]);
  return out;
}

function modRows(mods: AttachmentMods): Row[] {
  const out: Row[] = [];
  if (mods.magazine) out.push(['Magazine', `+${mods.magazine} rounds`]);
  if (mods.spread) out.push(['Spread', change(mods.spread)]);
  if (mods.hipSpread) out.push(['Hip-fire spread', change(mods.hipSpread)]);
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
  `sets alight · ${f.burnDamage} a second to every limb, past armor, for ${seconds(f.burnTime)}`;

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
        ['Caliber', caliberOf(items, def)],
        ['Loaded', `${item.mag ?? 0}/${s.magazine} · ${round.name}`],
        [
          'Damage',
          round.type === 'grenade' ? (
            round.damage > 0 ? (
              <>
                <Level level={round.level} />
                {round.damage} at the center · {round.radius} m radius
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
              {round.pellets ? ` × ${round.pellets}` : ''} · {round.armorDamage} to armor
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
          ['Caliber', def.caliber],
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
        ['Caliber', def.caliber],
        ['Penetration', <Level key="l" level={def.level} />],
        ['Damage', `${def.damage}${def.pellets ? ` × ${def.pellets} pellets` : ''}`],
        ['Armor damage', `${def.armorDamage}`],
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
    case 'armor':
      return [
        ...(def.carrier ? carrierRows(items, item, def.carrier) : []),
        ...(def.carrier && !softZonesOf(def.carrier).length ? [] : armorRows(item, def)),
        ...burdenRows(def),
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
        // GZ-5: its mounts, and what's fitted.
        ...(def.visor || def.nightVision
          ? [
              [
                'Mounts',
                [def.visor && 'visor', def.nightVision && 'night vision']
                  .filter(Boolean)
                  .join(' or '),
              ] as Row,
            ]
          : []),
        ...(item.fitted
          ? [
              [
                'Fitted',
                `${itemDef(items, item.fitted.item).name}${item.fitted.durability !== undefined ? ` · ${Math.ceil(item.fitted.durability)} durability` : ''}`,
              ] as Row,
            ]
          : []),
        // GZ-2: hearing, the ears covered, what it takes of the view.
        ...(def.hearing ? [['Hearing', hearingText(def.hearing)] as Row] : []),
        ...(def.blocksHeadset ? [['Ears', 'covered: no headset with it'] as Row] : []),
        ...(def.vision?.shape || def.vision?.vignette
          ? [
              [
                'View',
                def.vision.shape === 'slit'
                  ? 'a narrow visor slit'
                  : def.vision.shape === 'cheeks'
                    ? 'cheek guards at the bottom corners'
                    : `${Math.round((def.vision.vignette ?? 0) * 100)}% darker at the edges`,
              ] as Row,
            ]
          : []),
      ];
    case 'headset':
      return [['Hearing', hearingText(def.hearing)]];
    case 'visor':
      return [...armorRows(item, def), ['Covers', 'the face: head hits from the front']];
    case 'plate':
      return [...armorRows(item, def), ['Fits', 'any carrier with a front or back slot']];
    case 'nightVision':
      return [
        ['Fits', 'helmets with a night vision mount'],
        ['Brightness', `${def.gain}×`],
        ['View', def.shape === 'dual' ? 'two tubes' : 'one tube'],
      ];
    case 'attachment': {
      const fits = def.weapons
        ? def.weapons.map((id) => itemDef(items, id).name).join(', ')
        : `any gun with a ${def.slot} slot`;
      const out: Row[] = [['Fits', fits]];
      if (def.optic) out.push(['Zoom', `${def.optic.zoom}×`]);
      // A magazine (MG-1): what it holds, and what's in it.
      if (def.capacity !== undefined) {
        const round = item.loaded ? roundOf(items, item.loaded) : null;
        out.push(['Caliber', def.caliber ?? '']);
        out.push(['Loaded', `${item.mag ?? 0}/${def.capacity}${round ? ` · ${round.name}` : ''}`]);
      }
      if (def.stock) {
        out.push([
          'Adds',
          `${def.stock.length} cell${def.stock.length === 1 ? '' : 's'} to the gun's length${def.stock.foldedLength ? ` (${def.stock.foldedLength} folded)` : ''}`,
        ]);
      }
      // WF-2: what it adds to the gun's size in a grid.
      if (def.rows) out.push(['Adds', `${def.rows} row${def.rows === 1 ? '' : 's'} under the gun`]);
      if (def.columns)
        out.push([
          'Adds',
          `${def.columns} cell${def.columns === 1 ? '' : 's'} to the gun's length`,
        ]);
      return [...out, ...modRows(def.mods ?? {})];
    }
    case 'med': {
      const out: Row[] = [['Does', MED_EFFECTS[def.effect]]];
      if (def.bleedCost !== undefined) out.push(['Stops bleeding', `${def.bleedCost} HP each`]);
      if (def.effect === 'heal') out.push(['HP left', `${Math.floor(item.left ?? 0)} / ${def.hp}`]);
      else out.push(['Uses left', `${item.left ?? 1} / ${def.uses ?? 1}`]);
      out.push(['Use time', seconds(def.useTime)]);
      return out;
    }
    case 'container':
      return [
        // An armored rig's armor (2026-11-11): the chest, as body armor.
        ...(def.armor
          ? [...armorRows(item, def.armor), ['Covers', 'Chest; no body armor with it'] as Row]
          : []),
        ...burdenRows(def),
        [
          'Inside',
          def.sections ? sectionsText(def.sections) : `${def.grid[0]} × ${def.grid[1]} cells`,
        ],
      ];
    case 'melee':
      return [
        [
          'Damage',
          <>
            <Level level={def.level} />
            {def.damage} · {def.armorDamage} to armor
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
            {def.damage} at the center · {def.armorDamage} to armor
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
        ['Does', 'Restores durability to armor.'],
        ['Points left', `${Math.floor(item.left ?? 0)} / ${def.points}`],
        ['Use time', `${seconds(def.useTime)} in a raid, at once in the stash`],
      ];
    case 'loot':
      return def.stack ? [['Stack', `${item.count} / ${def.stack}`]] : [];
    case 'quest':
      return [];
  }
}

/**
 * A rig's or backpack's sections, by size, biggest first (2026-11-11): "4 of 1 × 2",
 * "6 × 4, 2 of 1 × 2".
 */
function sectionsText(sections: readonly { size: readonly [number, number] }[]): string {
  const counts = new Map<string, { n: number; cells: number }>();
  for (const {
    size: [w, h],
  } of sections) {
    const k = `${w} × ${h}`;
    const c = counts.get(k) ?? { n: 0, cells: w * h };
    c.n++;
    counts.set(k, c);
  }
  return [...counts]
    .sort((a, b) => b[1].cells - a[1].cells)
    .map(([k, { n }]) => (n === 1 ? k : `${n} of ${k}`))
    .join(', ');
}

/** Armor's rows, or an armored rig's: level, durability, what repairs wore off, repair loss. */
function armorRows(item: Item, a: ArmorStats): Row[] {
  return [
    ['Protection', <Level key="l" level={a.level} />],
    ['Durability', `${tenths(item.durability ?? 0)} / ${tenths(item.max ?? a.durability)}`],
    // Repairs wear the max down (sim/repair.ts).
    ...(item.max !== undefined
      ? [['Max durability', `${tenths(item.max)} of ${a.durability}`] as Row]
      : []),
    ['Repair loss', `${Math.round(repairLossOf(a) * 100)}% of what's mended`],
  ];
}
