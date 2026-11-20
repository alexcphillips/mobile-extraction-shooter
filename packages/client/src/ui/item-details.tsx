import {
  caliberOf,
  fits,
  type WeaponDef,
  condition,
  createWeaponStats,
  drawTimeAt,
  firesRound,
  grenadeEffect,
  jumpAt,
  swayAt,
  aimMoveAt,
  raiseTimeAt,
  isMoney,
  itemDef,
  itemWeight,
  loadedAmmo,
  objectiveText,
  roundOf,
  sellParts,
  weaponStats,
  GUN_STATS,
  type GunStat,
  type WeaponStats,
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
  ATTACHMENT_SLOTS,
  type AttachmentKind,
} from '@mes/shared';
import { useEffect, useMemo, type ReactNode } from 'react';
import { hangarContent, itemOrigins, loadVendors } from '../content';
import { itemPortrait } from '../render/item-portrait';
import { levelColor } from './levels';
import { colorOf, tenths } from './raid-screen';
import { signedShare, STAT_NAMES, StatChange, StatScore } from './stat-bars';

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

/** A label and its value; a sub row is indented under the one above (Handling's parts). */
type Row = [label: string, value: ReactNode, sub?: true];

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
      attachments && ATTACHMENT_SLOTS.map((s) => attachments[s]).join(' '),
      item.folded,
    ],
  );
  const uses = useMemo(
    () => itemUsage(quests ?? [], def.id, hangarContent(), loadVendors().values()),
    [quests, def.id],
  );
  const usage = uses.quests;
  const upgrades = uses.upgrades.length > 0;
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
          {rows(items, item, def).map(([label, value, sub]) => (
            <div key={label} className={sub ? 'sub' : undefined}>
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
        {uses.barters.length > 0 && (
          <section className="item-details-more">
            <h3>Barters</h3>
            {uses.barters.map((b) => (
              <p key={`${b.vendor}:${b.item}`}>
                <b>
                  {b.vendor} {ROMAN[b.level]}
                </b>{' '}
                · {b.count} for {itemDef(items, b.item).name}
              </p>
            ))}
          </section>
        )}
        {upgrades && (
          <section className="item-details-more">
            <h3>Hangar</h3>
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
  const sold = s.vendors.filter((v) => !v.barter);
  const traded = s.vendors.filter((v) => v.barter);
  if (sold.length)
    lines.push(['Sold by', sold.map((v) => `${v.vendor} ${ROMAN[v.level]}`).join(', ')]);
  if (traded.length)
    lines.push(['Barter at', traded.map((v) => `${v.vendor} ${ROMAN[v.level]}`).join(', ')]);
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

/** What each kind of attachment is called in its details. */
const KIND_NAMES: Record<AttachmentKind, string> = {
  optic: 'Optic',
  offsetOptic: 'Offset optic',
  muzzle: 'Muzzle device',
  barrel: 'Barrel',
  foregrip: 'Foregrip',
  rail: 'Rail device',
  grip: 'Grip',
  magazine: 'Magazine',
  stock: 'Stock',
};

function kindOf(def: ItemDef): string {
  switch (def.type) {
    case 'weapon':
      return 'Gun';
    case 'ammo':
      return 'Ammo';
    case 'armor':
      return def.slot === 'helmet' ? 'Helmet' : 'Body armor';
    case 'attachment':
      return KIND_NAMES[def.slot];
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

/** What a gun stat's points come to, for its bar's title. */
function statTitle(s: WeaponStats, stat: GunStat): string {
  switch (stat) {
    case 'recoilUp':
      return `Kick ${+s.recoilUp.toFixed(2)}° up per shot`;
    case 'recoilSide':
      return `Kick up to ${+s.recoilSide.toFixed(2)}° sideways per shot`;
    case 'stability':
      return `View and gun jump ×${+jumpAt(s.points.stability).toFixed(2)} per shot`;
    case 'handling':
      return `Aim ${seconds(s.aimTime)} · draw ${seconds(drawTimeAt(s.points.handling))}`;
    case 'hipFire':
      return `${+s.hipSpread.toFixed(1)}° from the hip`;
    case 'accuracy':
      return `${+s.aimSpread.toFixed(2)}° aimed`;
    case 'range':
      return `Shots stop at ${Math.round(s.range)} m`;
    case 'loudness':
      return `Heard from ${Math.round(s.loudness)} m`;
  }
}

const percent = (f: number): string => `${Math.round(f * 100)}%`;

/** Handling's parts for a gun as built (features/weapon-stats.md → Handling). */
function handlingRows(s: WeaponStats): Row[] {
  const sway = swayAt(s.points.handling);
  return [
    ['Aim', seconds(s.aimTime), true],
    ['Draw', seconds(drawTimeAt(s.points.handling)), true],
    ['Aimed sway', sway === 1 ? 'normal' : signedShare(sway), true],
    ['Reload', seconds(s.reloadTime), true],
    ['Sprint to fire', seconds(raiseTimeAt(s.points.handling)), true],
    ['Moving aimed', `${Math.round(aimMoveAt(s.points.handling) * 100)}% speed`, true],
  ];
}

/** What worn gear costs (GZ-1): aim time and move speed, as "+10%" and "−12%". */
function burdenRows(def: { aimTime?: number | undefined; moveSpeed?: number | undefined }): Row[] {
  const out: Row[] = [];
  if (def.aimTime && def.aimTime !== 1) out.push(['Aim time', signedShare(def.aimTime)]);
  if (def.moveSpeed && def.moveSpeed !== 1) out.push(['Move speed', signedShare(def.moveSpeed)]);
  return out;
}

function modRows(mods: AttachmentMods): Row[] {
  const out: Row[] = [];
  if (mods.magazine) out.push(['Magazine', `+${mods.magazine} rounds`]);
  for (const stat of GUN_STATS) {
    const n = mods[stat];
    if (n) out.push([STAT_NAMES[stat], <StatChange key={stat} stat={stat} by={n} />]);
  }
  // The exceptions to handling it names: more time is worse.
  for (const [label, m] of [
    ['Aim time', mods.aimTime],
    ['Reload time', mods.reloadTime],
  ] as const)
    if (m && m !== 1)
      out.push([
        label,
        <span key={label} className={m < 1 ? 'stat-good' : 'stat-bad'}>
          {signedShare(m)}
        </span>,
      ]);
  return out;
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
          <>
            <Level level={round.level} />
            {round.damage}
            {round.pellets ? ` × ${round.pellets}` : ''} · {round.armorDamage} to armor
          </>,
        ],
        ...GUN_STATS.flatMap((stat): Row[] => [
          [
            STAT_NAMES[stat],
            <StatScore key={stat} value={s.points[stat]} title={statTitle(s, stat)} />,
          ],
          // What Handling works out to, under its bar (WS-3).
          ...(stat === 'handling' ? handlingRows(s) : []),
        ]),
        ['Shots stop at', `${Math.round(s.range)} m`],
        ...(round.falloff
          ? ([['Full damage to', `${Math.round(round.falloff.from * s.rangeScale)} m`]] as Row[])
          : []),
        ['Heard from', `${Math.round(s.loudness)} m`],
      ];
    }
    case 'ammo': {
      const guns = [...items.values()].filter(
        (g) => g.type === 'weapon' && !g.spawns && firesRound(items, g, def.id),
      );
      return [
        ['Caliber', def.caliber],
        ['Penetration', <Level key="l" level={def.level} />],
        ['Damage', `${def.damage}${def.pellets ? ` × ${def.pellets} pellets` : ''}`],
        ['Armor damage', `${def.armorDamage}`],
        ['Bleed chance', percent(def.bleedChance)],
        ...(def.falloff
          ? ([
              [
                'Damage falloff',
                `full to ${def.falloff.from} m · ${percent(def.falloff.floor)} from ${def.falloff.to} m`,
              ],
            ] as Row[])
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
        ...(def.coversFace ? [['Face', 'covered, visor or not'] as Row] : []),
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
      // By name, the guns its lists come to (a platform's, AT-1), or any with its slot.
      const fitsGuns =
        def.weapons || def.platforms
          ? [...items.values()]
              .filter((g): g is WeaponDef => g.type === 'weapon' && fits(items, g, def))
              .map((g) => g.name)
              .join(', ')
          : `any gun with a ${def.slot} slot`;
      const out: Row[] = [['Fits', fitsGuns]];
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
        ['Fuse', seconds(def.fuse)],
        ['Heard from', `${def.loudness} m`],
      ];
      if (effect === 'smoke')
        return [
          ['Effect', 'A cloud enemies can’t see through'],
          ['Cloud', `${def.radius} m · ${seconds(def.smokeTime ?? 0)}`],
          ...end,
        ];
      return [
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
