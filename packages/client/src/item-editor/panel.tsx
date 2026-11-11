import {
  ATTACHMENT_SLOTS,
  bagCells,
  FIRE,
  GRENADE_EFFECTS,
  MED_EFFECTS,
  ITEM_VIEWS,
  type ItemView,
  VENDOR,
  firesRound,
  fits,
  roundOf,
  idSchema,
  type AttachmentDef,
  type ContainerDef,
  type ItemDb,
  type ItemDef,
  type WeaponDef,
} from '@mes/shared';
import {
  Fragment,
  useMemo,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { sounds } from '../audio/sounds';
import { itemUses, soundSources } from '../content';
import { C, N, P, put, type Bound, type Path } from '../editor/bound-fields';
import { Text, Toggle } from '../editor/fields';
import { previewPortrait, viewOf } from '../render/item-portrait';
import { colorOf, tileName } from '../ui/raid-screen';
import { sectionBoxes } from '../ui/inventory-layout';
import type { Doc, ItemEditor, ItemEditorState } from './editor';
import { fitPointsToSlot, setSlots } from './model-edit';
import { FitsPage, type OpenFit } from './fits-panel';
import { Group, Labeled, RarityPicker, S, Segmented, T, Tick } from './form';
import { ModelTab } from './model-panel';
import { ReticleDesigner } from './reticle';
import { BLANK_OPTIC, ITEM_TYPES, type ItemType } from './templates';

/*
 * The item editor's page (session 18): the list of items down the left, the open item's
 * fields, and beside them what it looks like in a grid, what it works out to, what names
 * it, and for optics the reticle designer.
 */

export function ItemEditorPanel({ editor }: { editor: ItemEditor }) {
  const s = useSyncExternalStore(editor.subscribe, editor.getState);
  const [making, setMaking] = useState<'new' | 'copy' | null>(null);
  const [tab, setTab] = useState<'stats' | 'model' | 'fits'>('stats');
  /** A fit picked on the fits page, for the model tab to show; n tells repeats apart. */
  const [fit, setFit] = useState<(OpenFit & { n: number }) | null>(null);
  const openFit = (f: OpenFit): void => {
    editor.select(f.gun);
    setFit((was) => ({ ...f, n: (was?.n ?? 0) + 1 }));
    setTab('model');
  };
  const def = s.items.get(s.current);
  const status = s.message ?? (s.problem ? `Problem: ${s.problem}` : null);
  return (
    <div className="ie">
      {making && (
        <NewItem editor={editor} state={s} copy={making === 'copy'} close={() => setMaking(null)} />
      )}
      <aside className="ie-list">
        <div className="ed-actions">
          <button
            className={s.unsaved.length ? 'ed-save ed-dirty' : 'ed-save'}
            disabled={s.saving}
            onClick={() => void editor.save()}
            title={s.unsaved.length ? `⌘S: ${s.unsaved.join(', ')}` : '⌘S'}
          >
            {s.saving
              ? 'Saving…'
              : s.unsaved.length > 1
                ? `Save ${s.unsaved.length} items`
                : s.unsaved.length
                  ? 'Save'
                  : 'Saved'}
          </button>
          <button onClick={() => editor.undo()} disabled={!s.canUndo} title="⌘Z">
            Undo
          </button>
          <button onClick={() => editor.redo()} disabled={!s.canRedo} title="⇧⌘Z">
            Redo
          </button>
          <button onClick={() => setMaking('new')} title="Make a new item">
            New…
          </button>
          <button onClick={() => setMaking('copy')} disabled={!def} title="Copy this item">
            Copy…
          </button>
        </div>
        <div className="ed-row ie-tabs">
          {(['stats', 'model', 'fits'] as const).map((t) => (
            <Toggle key={t} on={tab === t} onClick={() => setTab(t)}>
              {t}
            </Toggle>
          ))}
        </div>
        <ItemList state={s} editor={editor} />
        <a className="ie-link" href="/editor">
          Map editor
        </a>
      </aside>
      {!def ? (
        <main />
      ) : tab === 'fits' ? (
        <FitsPage state={s} def={def} open={openFit} />
      ) : tab === 'model' ? (
        <ModelTab
          editor={editor}
          state={s}
          def={def}
          request={fit && fit.gun === def.id ? fit : null}
        />
      ) : (
        <ItemPage key={s.current} editor={editor} state={s} def={def} />
      )}
      <div className={s.problem && !s.message ? 'ed-status ed-problem' : 'ed-status'}>
        {status ?? 'Fields change when you press Enter or leave them. ⌘S saves every changed item.'}
      </div>
    </div>
  );
}

/** The item list's open types, kept per browser (2026-11-09): a convenience, so it may be lost. */
const OPEN_TYPES_KEY = 'item-editor-open-types';

function loadOpenTypes(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_TYPES_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((t) => typeof t === 'string') : []);
  } catch {
    return new Set();
  }
}

function ItemList({ state: s, editor }: { state: ItemEditorState; editor: ItemEditor }) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(loadOpenTypes);
  const setOpenTypes = (next: Set<string>): void => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_TYPES_KEY, JSON.stringify([...next]));
    } catch {
      // Storage blocked: it just won't be remembered.
    }
  };
  const toggle = (type: string): void => {
    const next = new Set(open);
    if (!next.delete(type)) next.add(type);
    setOpenTypes(next);
  };
  // Opening an item (from the list, a fit, New or Copy) opens its type, so it can be seen.
  // Only when the open item's type (or loot category) changes, so closing that type afterwards sticks.
  // Loot also opens its category, keyed 'loot/<category>' ('loot/' for none).
  const cur = s.items.get(s.current);
  const currentType = cur?.type;
  const currentGroup = cur?.type === 'loot' ? `loot/${cur.category ?? ''}` : currentType;
  const [seenGroup, setSeenGroup] = useState<string | undefined>(undefined);
  if (currentGroup !== seenGroup) {
    setSeenGroup(currentGroup);
    const want = [currentType, currentGroup].filter((k): k is string => !!k && !open.has(k));
    if (want.length) setOpen(new Set([...open, ...want]));
  }
  const f = filter.trim().toLowerCase();
  const all = [...s.items.values()].filter(
    (d) => !f || d.id.includes(f) || d.name.toLowerCase().includes(f),
  );
  return (
    <>
      <input
        className="ie-filter"
        placeholder="Find an item"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="ie-items">
        {ITEM_TYPES.map((type) => {
          const of = all.filter((d) => d.type === type).sort((a, b) => a.id.localeCompare(b.id));
          if (!of.length) return null;
          return (
            <ItemGroup
              key={type}
              label={type}
              of={of}
              state={s}
              // A search shows every match, whatever is closed.
              shown={!!f || open.has(type)}
              searching={!!f}
              onToggle={() => toggle(type)}
            >
              {type === 'loot' ? (
                // Loot is long, so it's split by loot category, each opening on its own.
                <div className="ie-sub">
                  {lootGroups(of).map(([category, items]) => {
                    const key = `loot/${category}`;
                    return (
                      <ItemGroup
                        key={key}
                        label={category || 'no category'}
                        of={items}
                        state={s}
                        shown={!!f || open.has(key)}
                        searching={!!f}
                        onToggle={() => toggle(key)}
                      >
                        <ItemRows of={items} state={s} editor={editor} />
                      </ItemGroup>
                    );
                  })}
                </div>
              ) : (
                <ItemRows of={of} state={s} editor={editor} />
              )}
            </ItemGroup>
          );
        })}
      </div>
    </>
  );
}

/** Loot by its category, A to Z, with uncategorized loot ('') last. */
function lootGroups(of: readonly ItemDef[]): [string, ItemDef[]][] {
  const by = new Map<string, ItemDef[]>();
  for (const d of of) {
    const c = (d.type === 'loot' && d.category) || '';
    by.set(c, [...(by.get(c) ?? []), d]);
  }
  return [...by].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
}

/** A heading that opens and closes a group of the item list, with its count and marks. */
function ItemGroup(props: {
  label: string;
  of: readonly ItemDef[];
  state: ItemEditorState;
  shown: boolean;
  searching: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { label, of, state: s, shown } = props;
  return (
    <div>
      <h4>
        <button
          className="ie-type"
          aria-expanded={shown}
          disabled={props.searching}
          onClick={props.onToggle}
        >
          <span className="ie-caret">{shown ? '▾' : '▸'}</span>
          {label} <span className="ie-count">{of.length}</span>
          {of.some((d) => s.unsaved.includes(d.id)) && <span className="ie-dot"> ●</span>}
          {of.some((d) => s.problems.has(d.id)) && <span className="ed-problem"> !</span>}
        </button>
      </h4>
      {shown && props.children}
    </div>
  );
}

function ItemRows({
  of,
  state: s,
  editor,
}: {
  of: readonly ItemDef[];
  state: ItemEditorState;
  editor: ItemEditor;
}) {
  return (
    <ul className="ed-list">
      {of.map((d) => (
        <li
          key={d.id}
          className={d.id === s.current ? 'ed-on' : undefined}
          onClick={() => editor.select(d.id)}
          title={s.problems.get(d.id) ?? d.id}
        >
          <span className="ie-swatch" style={{ background: colorOf(d) }} />
          {d.name}
          {s.unsaved.includes(d.id) && <span className="ie-dot"> ●</span>}
          {s.problems.has(d.id) && <span className="ed-problem"> !</span>}
        </li>
      ))}
    </ul>
  );
}

function ItemPage(props: { editor: ItemEditor; state: ItemEditorState; def: ItemDef }) {
  const { editor, state: s, def } = props;
  const doc = def as unknown as Doc;
  const b: Bound = { doc, edit: (change) => editor.edit(change) };
  const problem = s.problems.get(def.id);
  const risks = s.risks.get(def.id);
  const optic = def.type === 'attachment' && def.optic ? def.optic : null;
  return (
    <main className="ie-main">
      <section className="ie-form">
        <header className="ie-head">
          <div className="ie-head-name">
            <h3>{def.name}</h3>
            <span className="ed-note">content/items/{def.id}.json</span>
          </div>
          <select
            className="ie-type-pick"
            value={def.type}
            title="Change its type: keeps its name, size, value, rarity and model; the rest starts from the new type's blank"
            onChange={(e) => editor.changeType(e.target.value as ItemType)}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </header>
        {problem && <p className="ed-problem ie-alert">{problem}</p>}
        {risks && (
          <div className="ie-risk">
            <strong>Saved stashes may break:</strong>
            <ul>
              {risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            The server refuses a stash it can&apos;t check, so a player holding one couldn&apos;t
            save until it&apos;s fixed by hand.
          </div>
        )}
        <Group title="Item">
          <Text
            label="Name"
            value={def.name}
            onChange={(v) => b.edit((d) => put(d, ['name'], v))}
          />
          <span title="What its inventory tile says">
            <Text
              label="Short name"
              value={def.shortName ?? ''}
              placeholder={def.name}
              onChange={(v) => b.edit((d) => put(d, ['shortName'], v.trim() ? v : undefined))}
            />
          </span>
          <div className="ie-grid">
            <N {...b} path={['size', 0]} label="Width" min={1} hint="Cells it takes up" />
            <N {...b} path={['size', 1]} label="Height" min={1} hint="Cells it takes up" />
            <N
              {...b}
              path={['value']}
              label="Value"
              min={0}
              hint="What vendors sell it for new; they buy it for a share of this"
            />
          </div>
          <RarityPicker {...b} def={def} />
        </Group>
        <TypeFields {...b} def={def} items={s.items} />
        <SoundFields {...b} def={def} />
        <ViewPicker {...b} def={def} />
      </section>
      <section className="ie-side">
        <SizePreview def={def} />
        {s.db && <Facts def={def} db={s.db} />}
        <UsedBy id={def.id} items={s.db ?? s.items} />
        {optic && (
          <ReticleDesigner
            optic={optic}
            edit={(change, gesture) =>
              editor.edit((d) => change((d as { optic: typeof optic }).optic), gesture)
            }
            gesture={(on) => (on ? editor.beginGesture() : editor.endGesture())}
          />
        )}
      </section>
    </main>
  );
}

/** The loot categories items use, A to Z: the category picker's list. */
function categories(items: ReadonlyMap<string, ItemDef>): string[] {
  const used = new Set<string>();
  for (const d of items.values()) if (d.type === 'loot' && d.category) used.add(d.category);
  return [...used].sort();
}

/** Toggle chips for a set of names: each on or off. */
function Chips(props: {
  options: readonly string[];
  on: (o: string) => boolean;
  toggle: (o: string, on: boolean) => void;
}) {
  return (
    <div className="ie-chips">
      {props.options.map((o) => {
        const on = props.on(o);
        return (
          <button
            key={o}
            className={on ? 'ed-on' : undefined}
            aria-pressed={on}
            onClick={() => props.toggle(o, !on)}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

const FUEL = { speed: 18, burnTime: 8, burnDamage: 1.5, fireTime: 7 };
const INCENDIARY = { chance: 0.25, burnTime: 4, burnDamage: 1.5 };
type AmmoKind = 'bullet' | 'incendiary' | 'fuel';

function TypeFields(props: Bound & { def: ItemDef; items: ReadonlyMap<string, ItemDef> }) {
  const { def, items, ...b } = props;
  const ofType = (t: ItemType): string[] =>
    [...items.values()].filter((d) => d.type === t).map((d) => d.id);
  switch (def.type) {
    case 'weapon':
      return (
        <>
          <Group title="Gun">
            <P
              {...b}
              path={['ammo']}
              label="Ammo"
              options={[
                ...ofType('ammo'),
                // Not C4: it's placed by hand, never launched.
                ...ofType('grenade').filter((id) => roundOf(items, id)),
              ]}
            />
            {items.get(def.ammo)?.type === 'grenade' && (
              <div className="ie-grid">
                <N
                  {...b}
                  path={['launchSpeed']}
                  label="Launch speed (m/s)"
                  min={0}
                  hint="How fast a grenade leaves the barrel"
                />
                <N
                  {...b}
                  path={['armDistance']}
                  label="Arms after (m)"
                  min={0}
                  placeholder="fuse only"
                  hint="Goes off on impact once it's flown this far; blank keeps only the fuse"
                />
              </div>
            )}
            <div className="ie-grid">
              <S
                {...b}
                path={['hold']}
                label="Held as"
                options={['rifle', 'pistol']}
                fallback="rifle"
              />
              <S {...b} path={['fireMode']} label="Fire mode" options={['auto', 'semi']} />
            </div>
            <div className="ie-grid">
              <N {...b} path={['rpm']} label="Rounds/min" min={0} />
              <N {...b} path={['magazine']} label="Magazine" min={1} />
              <N {...b} path={['range']} label="Range (m)" min={0} />
            </div>
            <div className="ie-grid">
              <N {...b} path={['reloadTime']} label="Reload (s)" min={0} />
              <N {...b} path={['aimTime']} label="Aim (s)" min={0} />
              <N {...b} path={['drawTime']} label="Draw (s)" min={0} />
            </div>
            <div className="ie-grid">
              <N
                {...b}
                path={['loudness']}
                label="Heard to (m)"
                min={0}
                hint="How far away enemies hear a shot"
              />
            </div>
          </Group>
          <Group title="Accuracy" aside={<span className="ed-note">degrees</span>}>
            <div className="ie-grid">
              <N {...b} path={['hipSpread']} label="Hip spread" min={0} />
              <N {...b} path={['aimSpread']} label="Aimed spread" min={0} />
            </div>
            <div className="ie-grid">
              <N {...b} path={['recoil', 'up']} label="Kick up" min={0} />
              <N {...b} path={['recoil', 'side']} label="Kick sideways" min={0} />
            </div>
            <div className="ie-grid">
              <N
                {...b}
                path={['recoil', 'snap']}
                label="Snap (/s)"
                min={0}
                hint="How fast each kick lands: higher is snappier (about 40)"
              />
              <N
                {...b}
                path={['recoil', 'recovery']}
                label="Recovers (/s)"
                min={0}
                hint="How fast the kick wears off: higher settles sooner (about 3)"
              />
            </div>
            <div className="ie-grid">
              <N
                {...b}
                path={['recoil', 'angle']}
                label="Kick angle (°)"
                placeholder="straight up"
                hint="Which way it climbs, off straight up: + right, − left, up to 45"
              />
              <N
                {...b}
                path={['recoil', 'stableAfter']}
                label="Steadies after"
                min={1}
                placeholder="never"
                hint="Rounds: past this round of a burst it stops climbing. Blank: climbs until recovery catches up"
              />
            </div>
          </Group>
          <Group title="Attachment slots">
            <Chips
              options={ATTACHMENT_SLOTS}
              on={(slot) => !!def.slots?.includes(slot as (typeof ATTACHMENT_SLOTS)[number])}
              toggle={(slot, on) =>
                b.edit((d) => {
                  const was = (d.slots as string[] | undefined) ?? [];
                  setSlots(
                    d,
                    ATTACHMENT_SLOTS.filter((s) => (s === slot ? on : was.includes(s))),
                  );
                })
              }
            />
          </Group>
        </>
      );
    case 'ammo': {
      const kind: AmmoKind = def.flame ? 'fuel' : def.incendiary ? 'incendiary' : 'bullet';
      const setKind = (k: AmmoKind): void =>
        b.edit((d) => {
          // Fuel does no damage itself: the burning does it.
          if (k === 'fuel') {
            d.flame = { ...FUEL };
            d.damage = 0;
            delete d.incendiary;
            delete d.pellets;
            delete d.pelletSpread;
            return;
          }
          if (d.flame) {
            delete d.flame;
            d.damage = 10;
          }
          if (k === 'incendiary') d.incendiary ??= { ...INCENDIARY };
          else delete d.incendiary;
        });
      return (
        <Group title="Rounds">
          <Labeled label="Kind">
            <Segmented
              value={kind}
              options={['bullet', 'incendiary', 'fuel'] as const}
              labels={{ bullet: 'Bullet', incendiary: 'Incendiary', fuel: 'Flamethrower fuel' }}
              titles={{
                incendiary: 'May set alight whoever it hits, on top of its damage',
                fuel: "A flamethrower's fuel: flames that set alight, no bullet",
              }}
              onChange={setKind}
            />
          </Labeled>
          <div className="ie-grid">
            <Text
              label="Caliber"
              value={def.caliber}
              onChange={(v) => b.edit((d) => put(d, ['caliber'], v))}
            />
            <N
              {...b}
              path={['level']}
              label="Level (1–6)"
              min={1}
              hint="Against armor's level: below it does nothing until it breaks, level half, above all"
            />
            <N {...b} path={['stack']} label="Stack" min={2} hint="Most in one cell" />
          </div>
          {def.flame ? (
            <>
              <div className="ie-grid">
                <N {...b} path={['flame', 'speed']} label="Flame speed (m/s)" min={0} />
                <N
                  {...b}
                  path={['flame', 'fireTime']}
                  label="Burns on the map (s)"
                  min={0}
                  hint="Where it lands; anyone touching it is set alight"
                />
              </div>
              <div className="ie-grid">
                <N
                  {...b}
                  path={['flame', 'burnDamage']}
                  label="Burn damage (/s)"
                  min={0}
                  hint="To every zone, past armor, while alight"
                />
                <N
                  {...b}
                  path={['flame', 'burnTime']}
                  label="Burns someone (s)"
                  min={0}
                  hint={`If they don't put it out, which takes ${FIRE.extinguishTime} s`}
                />
              </div>
            </>
          ) : (
            <div className="ie-grid">
              <N {...b} path={['damage']} label="Damage" min={0} hint="To the chest" />
              <N
                {...b}
                path={['pellets']}
                label="Pellets"
                min={2}
                placeholder="1"
                hint="Shotgun shells: pellets a round fires, each doing the damage"
              />
              <N
                {...b}
                path={['pelletSpread']}
                label="Pellet spread (°)"
                min={0}
                hint="With pellets: the most each strays from the shot's line"
              />
            </div>
          )}
          <div className="ie-grid">
            <N
              {...b}
              path={['armorDamage']}
              label="Armor damage"
              min={0}
              hint="Durability lost per hit, less against armor above its level"
            />
            <N {...b} path={['bleedChance']} label="Bleed chance (0–1)" min={0} />
          </div>
          {def.incendiary && (
            <div className="ie-grid">
              <N
                {...b}
                path={['incendiary', 'chance']}
                label="Ignite chance"
                min={0}
                hint="0–1 a hit; each pellet's own chance, for shells"
              />
              <N {...b} path={['incendiary', 'burnTime']} label="Burns for (s)" min={0} />
              <N {...b} path={['incendiary', 'burnDamage']} label="Burn damage (/s)" min={0} />
            </div>
          )}
        </Group>
      );
    }
    case 'armor':
      return (
        <>
          <Group title="Armor">
            <S {...b} path={['slot']} label="Worn as" options={['helmet', 'body']} />
            <ArmorStats {...b} at={[]} />
          </Group>
          <Group title="Face mask" aside={<span className="ed-note">blank: none</span>}>
            <div className="ie-grid">
              <N
                {...b}
                path={['mask', 'edge']}
                label="View hidden (0–0.4)"
                min={0}
                placeholder="none"
                hint="The share of the screen's width hidden at each side"
              />
              <N
                {...b}
                path={['mask', 'muffle']}
                label="Muffle above (Hz)"
                min={200}
                placeholder="none"
                hint="Sounds above this are muffled for whoever wears it"
              />
            </div>
          </Group>
        </>
      );
    case 'attachment':
      return <AttachmentFields {...b} def={def} weapons={ofType('weapon')} items={items} />;
    case 'med':
      return (
        <Group title="Medical">
          <S
            {...b}
            path={['effect']}
            label="Does"
            options={MED_EFFECTS}
            labels={{ bandage: 'Bandage', splint: 'Splint', surgery: 'Surgery', heal: 'Heal' }}
            then={(d, v) => {
              if (v === 'heal') {
                put(d, ['uses'], undefined);
                if (d.hp === undefined) put(d, ['hp'], 100);
              } else {
                put(d, ['hp'], undefined);
                put(d, ['bleedCost'], undefined);
              }
            }}
          />
          <p className="ed-note">{MED_NOTES[def.effect]}</p>
          <div className="ie-grid">
            <N {...b} path={['useTime']} label="Use time (s)" min={0} />
            {def.effect === 'heal' ? (
              <>
                <N {...b} path={['hp']} label="HP pool" min={0} />
                <N
                  {...b}
                  path={['bleedCost']}
                  label="HP per bleed"
                  min={1}
                  placeholder="can't"
                  hint="HP from its pool to stop a bleed. Blank: it doesn't stop bleeding"
                />
              </>
            ) : (
              <N {...b} path={['uses']} label="Uses" min={1} placeholder="1" />
            )}
          </div>
        </Group>
      );
    case 'container':
      return (
        <>
          <Group title="Worn">
            <S
              {...b}
              path={['slot']}
              label="Worn as"
              options={['rig', 'backpack', 'vault']}
              // Only a rig has armor.
              then={(d, v) => v !== 'rig' && put(d, ['armor'], undefined)}
            />
            {def.slot === 'rig' && (
              <Tick
                label="Armored"
                checked={!!def.armor}
                title="Covers the chest as body armor does, which can't be worn with it"
                onChange={(on) =>
                  b.edit((d) => put(d, ['armor'], on ? { level: 3, durability: 40 } : undefined))
                }
              />
            )}
            {def.armor && <ArmorStats {...b} at={['armor']} />}
          </Group>
          <SectionFields {...b} def={def} />
        </>
      );
    case 'melee':
      return (
        <Group title="Knife">
          <div className="ie-grid">
            <N {...b} path={['damage']} label="Damage" min={0} />
            <N {...b} path={['level']} label="Level (1–6)" min={1} />
          </div>
          <div className="ie-grid">
            <N {...b} path={['armorDamage']} label="Armor damage" min={0} />
            <N {...b} path={['bleedChance']} label="Bleed chance" min={0} />
          </div>
          <div className="ie-grid">
            <N {...b} path={['swingTime']} label="Swing (s)" min={0} />
            <N {...b} path={['reach']} label="Reach (m)" min={0} />
            <N {...b} path={['drawTime']} label="Draw (s)" min={0} />
          </div>
          {def.id !== 'knife' && (
            <p className="ed-note">Players always carry the item called knife; this one is loot.</p>
          )}
        </Group>
      );
    case 'grenade':
      return (
        <Group title="Grenade">
          <S
            {...b}
            path={['effect']}
            label="Effect"
            options={GRENADE_EFFECTS}
            fallback="frag"
            labels={{ frag: 'Frag', flash: 'Flash', smoke: 'Smoke', c4: 'C4', molotov: 'Molotov' }}
            then={(d, v) => {
              // Each effect's own field, there only for it.
              if (v === 'flash') d.blindTime ??= 5;
              else delete d.blindTime;
              if (v === 'smoke') d.smokeTime ??= 25;
              else delete d.smokeTime;
              if (v === 'molotov') d.fire ??= { burnTime: 8, burnDamage: 1.5, fireTime: 7 };
              else delete d.fire;
            }}
          />
          {def.effect === 'flash' && (
            <div className="ie-grid">
              <N
                {...b}
                path={['blindTime']}
                label="Blinds for (s)"
                min={0}
                hint="Looking at it, close; less further out"
              />
            </div>
          )}
          {def.effect === 'smoke' && (
            <div className="ie-grid">
              <N {...b} path={['smokeTime']} label="Cloud lasts (s)" min={0} />
            </div>
          )}
          {def.effect === 'molotov' && (
            <div className="ie-grid">
              <N
                {...b}
                path={['fire', 'fireTime']}
                label="Fire burns (s)"
                min={0}
                hint="Spilled across its radius where it breaks"
              />
              <N {...b} path={['fire', 'burnTime']} label="Burns someone (s)" min={0} />
              <N {...b} path={['fire', 'burnDamage']} label="Burn damage (/s)" min={0} />
            </div>
          )}
          <div className="ie-grid">
            <N {...b} path={['damage']} label="Damage" min={0} hint="At the center" />
            <N {...b} path={['level']} label="Level (1–6)" min={1} />
            <N {...b} path={['radius']} label="Radius (m)" min={0} />
          </div>
          <div className="ie-grid">
            <N {...b} path={['armorDamage']} label="Armor damage" min={0} />
            <N {...b} path={['bleedChance']} label="Bleed chance" min={0} />
            <N
              {...b}
              path={['fuse']}
              label="Fuse (s)"
              min={0}
              hint="From the throw; for C4, from the detonator"
            />
          </div>
          <div className="ie-grid">
            <N {...b} path={['throwSpeed']} label="Throw speed (m/s)" min={0} />
            <N {...b} path={['loudness']} label="Heard from (m)" min={0} />
          </div>
        </Group>
      );
    case 'key':
      return (
        <Group title="Key">
          <div className="ie-grid">
            <N
              {...b}
              path={['uses']}
              label="Uses"
              min={1}
              placeholder="unlimited"
              hint="Unlocks this many times, then it's gone"
            />
          </div>
        </Group>
      );
    case 'loot':
      return (
        <Group title="Loot">
          <div className="ie-grid">
            <N {...b} path={['stack']} label="Stack" min={2} placeholder="doesn't stack" />
            <C
              {...b}
              path={['category']}
              label="Category"
              options={categories(items)}
              unset="none (shows Loot)"
              newLabel="category"
            />
          </div>
          <T {...b} path={['money']} label="Money" title="Deposited at full value" />
        </Group>
      );
    case 'repair':
      return (
        <Group title="Repair kit">
          <div className="ie-grid">
            <N {...b} path={['points']} label="Durability in all" min={0} />
            <N {...b} path={['useTime']} label="Use time (s)" min={0} />
          </div>
        </Group>
      );
    case 'quest':
      return (
        <Group title="Quest item">
          <p className="ed-note">Nothing more to set: its quest says where it lies.</p>
        </Group>
      );
  }
}

/** Armor's level, durability and repair loss, on armor or under an armored rig's `armor`. */
function ArmorStats(props: Bound & { at: Path }) {
  const { at, ...b } = props;
  return (
    <div className="ie-grid">
      <N {...b} path={[...at, 'level']} label="Level (1–6)" min={1} />
      <N {...b} path={[...at, 'durability']} label="Durability" min={0} />
      <N
        {...b}
        path={[...at, 'repairLoss']}
        label="Repair loss"
        min={0}
        placeholder="0.1"
        hint="0–1: the share of what a repair mends that comes off its max"
      />
    </div>
  );
}

const SOUND_USES: Record<string, string> = {
  shot: 'Shot',
  suppressed: 'Shot, suppressed',
  reload: 'Reload',
  swing: 'Swing',
  use: 'Using it',
  throw: 'Throw',
  bounce: 'Bounce',
  explode: 'Going off',
};

/** The sound files it plays (session 19), each with a button to hear it and a link to tune it. */
function SoundFields(props: Bound & { def: ItemDef }) {
  const { def, ...b } = props;
  if (!('sounds' in def)) return null;
  const ids = [...soundSources().keys()];
  return (
    <Group title="Sounds">
      {Object.entries(def.sounds).map(([use, id]) => (
        <div key={use} className="ie-sound">
          <P {...b} path={['sounds', use]} label={SOUND_USES[use] ?? use} options={ids} />
          <button onClick={() => sounds().play(id)} title="Play it">
            ▶
          </button>
          <a className="ie-link" href={`/sounds?sound=${id}`} target="sounds" title="Tune it">
            tune
          </a>
        </div>
      ))}
    </Group>
  );
}

const MED_NOTES: Record<(typeof MED_EFFECTS)[number], string> = {
  bandage: 'Stops one zone bleeding per use.',
  splint: "Takes away a broken limb's effects (it stays at 0 HP).",
  surgery: 'Brings a broken limb back to 1 HP.',
  heal: "Restores HP to limbs that aren't broken, from its pool.",
};

const MODS: [key: string, label: string, hint: string][] = [
  ['recoil', 'Recoil', 'Kick up and sideways'],
  ['recoilUp', 'Kick up', 'On top of recoil'],
  ['recoilSide', 'Kick sideways', 'On top of recoil'],
  ['ergonomics', 'Ergonomics', 'Above 1 recovers from recoil faster'],
  ['spread', 'Spread', 'Hip and aimed spread'],
  ['aimTime', 'Aim time', ''],
  ['reloadTime', 'Reload', ''],
  ['loudness', 'Loudness', 'Below 1 is quieter'],
];

function AttachmentFields(
  props: Bound & { def: AttachmentDef; weapons: string[]; items: ReadonlyMap<string, ItemDef> },
) {
  const { def, weapons, items, ...b } = props;
  const withSlot = weapons.filter((w) => {
    const g = items.get(w);
    return g?.type === 'weapon' && g.slots?.includes(def.slot);
  });
  const listed = def.weapons ?? [];
  return (
    <>
      <Group title="Attachment">
        <S
          {...b}
          path={['slot']}
          label="Slot"
          options={ATTACHMENT_SLOTS}
          then={(d, v) => {
            if (v === 'optic' && d.optic === undefined)
              put(d, ['optic'], structuredClone(BLANK_OPTIC));
            if (v !== 'optic') put(d, ['optic'], undefined);
            fitPointsToSlot(d);
          }}
        />
        {def.optic && (
          <div className="ie-grid">
            <N
              {...b}
              path={['optic', 'zoom']}
              label="Zoom"
              min={1}
              hint="1 is a red dot; above is a scope, which zooms the whole screen behind a mask"
            />
          </div>
        )}
      </Group>
      <Group
        title="Fits"
        aside={
          <span className="ed-note">
            {listed.length ? 'only those picked' : `every gun with a ${def.slot} slot`}
          </span>
        }
      >
        <Chips
          options={[...new Set([...withSlot, ...listed])]}
          on={(w) => listed.includes(w)}
          toggle={(w, on) =>
            b.edit((d) => {
              const next = weapons.filter((x) => (x === w ? on : listed.includes(x)));
              put(d, ['weapons'], next.length ? next : undefined);
            })
          }
        />
      </Group>
      <Group
        title="Changes to the gun"
        aside={<span className="ed-note">× each, blank: none</span>}
      >
        <div className="ie-grid ie-grid-4">
          {MODS.map(([k, label, hint]) => (
            <N
              key={k}
              {...b}
              path={['mods', k]}
              label={label}
              min={0}
              placeholder="1"
              hint={hint}
            />
          ))}
          <N {...b} path={['mods', 'magazine']} label="Extra rounds" min={1} placeholder="0" />
        </div>
      </Group>
    </>
  );
}

/** Where each view is taken from, for its button's tooltip. */
const VIEW_NOTES: Record<ItemView, string> = {
  top: 'Straight down, the back (−z) at the top',
  front: 'From the front (+z)',
  side: "From the left (−x), a gun's barrel to the left",
  angled:
    'A three-quarter turn from the front left, the front (−z) to the left, a little from above',
  frontRight: 'A three-quarter turn from the front right, a little from above',
  backLeft: 'A three-quarter turn from the back left, a little from above',
  backRight: 'A three-quarter turn from the back right, a little from above',
};

/** What each view's button says (`angled` is the front-left one, under its old name). */
const VIEW_LABELS: Record<ItemView, string> = {
  top: 'Top',
  front: 'Front',
  side: 'Side',
  angled: 'Front L',
  frontRight: 'Front R',
  backLeft: 'Back L',
  backRight: 'Back R',
};

/**
 * Where the item's picture is taken from (2026-11-02): each view drawn as its tile would
 * be, to click; the one by its kind is marked, and picking it leaves the field out.
 */
function ViewPicker(props: Bound & { def: ItemDef }) {
  const { def } = props;
  const byKind = viewOf({ ...def, view: undefined } as ItemDef);
  const current = viewOf(def);
  const key = JSON.stringify([def.model, def.size]);
  const arts = useMemo(
    () => ITEM_VIEWS.map((v) => previewPortrait({ ...def, view: v } as ItemDef, def.size)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const [w, h] = def.size;
  const scale = 34 / Math.max(w, h);
  return (
    <Group title="Picture" aside={<span className="ed-note">taken from</span>}>
      <div className="ie-views">
        {ITEM_VIEWS.map((v, i) => (
          <button
            key={v}
            className={v === current ? 'ie-view-pick ed-on' : 'ie-view-pick'}
            title={`${VIEW_NOTES[v]}${v === byKind ? ' (the default for its kind)' : ''}`}
            onClick={() => props.edit((d) => put(d, ['view'], v === byKind ? undefined : v))}
          >
            <span
              className="ie-view-tile"
              style={{
                width: w * scale,
                height: h * scale,
                background: `${colorOf(def)}66`,
                borderColor: colorOf(def),
              }}
            >
              {arts[i] && <img src={arts[i]!} alt="" />}
            </span>
            <span>{VIEW_LABELS[v]}</span>
            {v === byKind && <span className="ie-auto">default</span>}
          </button>
        ))}
      </div>
    </Group>
  );
}

function SizePreview({ def }: { def: ItemDef }) {
  const [w, h] = def.size;
  // Redrawn when the model, view or size changes, not on every other edit.
  const key = JSON.stringify([def.model, def.view, def.size]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const art = useMemo(() => previewPortrait(def, def.size), [key]);
  return (
    <div className="ie-card">
      <h4>
        {w}×{h} in the inventory
        {def.type === 'container' &&
          ` · ${def.grid[0]}×${def.grid[1]} inside${def.sections ? `, ${def.sections.length} sections` : ''}`}
      </h4>
      <div className="ie-sizes">
        <Cells w={w} h={h} color={colorOf(def)} label={tileName(def)} art={art} />
        {/* Turned, as the inventory draws it when rotated (2026-11-09): the same picture, a
            quarter turn clockwise. Every item that isn't square can be rotated. */}
        {w !== h && (
          <Cells w={h} h={w} color={colorOf(def)} label={tileName(def)} art={art} turned />
        )}
        {def.type === 'container' && <InsidePreview def={def} />}
      </div>
    </div>
  );
}

/** A rig's or backpack's inside as the inventory draws it: each section its own box. */
function InsidePreview({ def }: { def: ContainerDef }) {
  const [w, h] = def.grid;
  if (!def.sections?.length) return <Cells w={w} h={h} color="" label="" />;
  // A cell is 44px with a 1px line between (as Cells draws it).
  const cell = 45;
  const boxes = sectionBoxes(
    def.sections.map(({ at: [x, y], size: [sw, sh] }) => ({ x, y, w: sw, h: sh })),
    cell,
  );
  return (
    <div
      className="ie-sections"
      style={{
        width: Math.max(...boxes.map((b) => b.left + b.s.w * cell)),
        height: Math.max(...boxes.map((b) => b.top + b.s.h * cell)),
      }}
    >
      {boxes.map(({ s, left, top }, i) => (
        <div key={i} style={{ left, top }}>
          <Cells w={s.w} h={s.h} color="" label="" />
        </div>
      ))}
    </div>
  );
}

/** Each section's color in the painter, by its index. */
const SECTION_COLORS = ['#4f8fd6', '#d68f4f', '#5fb36a', '#b45fc4', '#c9b13e', '#4fbfbf'];

type Section = { at: [number, number]; size: [number, number] };
type Layout = 'open' | 'columns' | 'rows' | 'custom';

const columnsOf = (w: number, h: number): Section[] =>
  Array.from({ length: w }, (_, x) => ({ at: [x, 0], size: [1, h] }));
const rowsOf = (w: number, h: number): Section[] =>
  Array.from({ length: h }, (_, y) => ({ at: [0, y], size: [w, 1] }));

const sameSections = (a: readonly Section[], b: readonly Section[]): boolean =>
  a.length === b.length &&
  a.every(
    (s, i) =>
      s.at[0] === b[i]!.at[0] &&
      s.at[1] === b[i]!.at[1] &&
      s.size[0] === b[i]!.size[0] &&
      s.size[1] === b[i]!.size[1],
  );

/** Which preset a bag's sections match, or custom (drawn by hand). */
function layoutOf(w: number, h: number, sections: readonly Section[]): Layout {
  if (!sections.length) return 'open';
  // A 1-wide or 1-tall inside is columns and rows at once: call it columns.
  if (sameSections(sections, columnsOf(w, h))) return 'columns';
  if (sameSections(sections, rowsOf(w, h))) return 'rows';
  return 'custom';
}

/**
 * A rig's or backpack's inside (2026-11-11 rework): its size, then its layout as one open
 * grid, columns, rows or custom pouches. Drag across free cells of the painter to add a
 * pouch (which makes it custom), × to remove one; exact numbers are under "Positions".
 */
function SectionFields(props: Bound & { def: ContainerDef }) {
  const { def } = props;
  const [w, h] = def.grid;
  const sections = (def.sections ?? []) as Section[];
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const valid = w >= 1 && h >= 1 && w <= 20 && h <= 20;
  const owner = (x: number, y: number): number =>
    sections.findIndex(
      ({ at: [sx, sy], size: [sw, sh] }) => x >= sx && y >= sy && x < sx + sw && y < sy + sh,
    );
  const rect = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0) + 1,
    h: Math.abs(drag.y1 - drag.y0) + 1,
  };
  let rectFree = !!rect;
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) if (owner(x, y) >= 0) rectFree = false;
  }
  const set = (next: Section[]) =>
    props.edit((d) => put(d, ['sections'], next.length ? next : undefined));
  const cellAt = (e: PointerEvent): [number, number] | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!el) return null;
    const [x, y] = el.dataset.cell!.split(',').map(Number);
    return [x!, y!];
  };
  const end = () => {
    if (rect && rectFree) {
      set([...sections, { at: [rect.x, rect.y], size: [rect.w, rect.h] }]);
    }
    setDrag(null);
  };
  const layout = layoutOf(w, h, sections);
  const held = bagCells(def);
  const free = w * h - (sections.length ? held : w * h);
  // The box around the sections, for "fit inside" when it's smaller than the inside.
  const box = sections.length
    ? {
        x0: Math.min(...sections.map((s) => s.at[0])),
        y0: Math.min(...sections.map((s) => s.at[1])),
        x1: Math.max(...sections.map((s) => s.at[0] + s.size[0])),
        y1: Math.max(...sections.map((s) => s.at[1] + s.size[1])),
      }
    : null;
  const canFit = !!box && (box.x0 > 0 || box.y0 > 0 || box.x1 < w || box.y1 < h);
  const pick = (l: Layout): void => {
    if (l === 'open') set([]);
    else if (l === 'columns') set(columnsOf(w, h));
    else if (l === 'rows') set(rowsOf(w, h));
  };
  return (
    <Group
      title="Inside"
      aside={
        <span className="ed-note">
          {held} cell{held === 1 ? '' : 's'}
          {sections.length ? ` · ${sections.length} pouch${sections.length === 1 ? '' : 'es'}` : ''}
        </span>
      }
    >
      <div className="ie-grid">
        <N {...props} path={['grid', 0]} label="Width" min={1} />
        <N {...props} path={['grid', 1]} label="Height" min={1} />
      </div>
      <Labeled label="Layout">
        <Segmented
          value={layout}
          options={
            layout === 'custom'
              ? (['open', 'columns', 'rows', 'custom'] as const)
              : (['open', 'columns', 'rows'] as const)
          }
          labels={{ open: 'Open', columns: 'Columns', rows: 'Rows', custom: 'Custom' }}
          titles={{
            open: 'No pouches: the inside is one grid',
            columns: 'A pouch per column, each as tall as the inside',
            rows: 'A pouch per row, each as wide as the inside',
            custom: 'Pouches drawn by hand',
          }}
          onChange={pick}
        />
      </Labeled>
      {valid && (
        <div
          className="ie-painter"
          style={{
            gridTemplateColumns: `repeat(${w}, 36px)`,
            gridTemplateRows: `repeat(${h}, 36px)`,
          }}
          onPointerDown={(e) => {
            const c = cellAt(e);
            if (!c || owner(c[0], c[1]) >= 0) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setDrag({ x0: c[0], y0: c[1], x1: c[0], y1: c[1] });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            // Pointer capture sends moves here; find the cell under the pointer itself.
            const el = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>('.ie-painter [data-cell]');
            if (!el) return;
            const [x, y] = el.dataset.cell!.split(',').map(Number);
            if (x !== drag.x1 || y !== drag.y1) setDrag({ ...drag, x1: x!, y1: y! });
          }}
          onPointerUp={end}
          onPointerCancel={() => setDrag(null)}
        >
          {Array.from({ length: w * h }, (_, i) => {
            const x = i % w;
            const y = Math.floor(i / w);
            const o = owner(x, y);
            const inRect =
              rect && x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
            const color = o >= 0 ? SECTION_COLORS[o % SECTION_COLORS.length] : undefined;
            return (
              <div
                key={i}
                data-cell={`${x},${y}`}
                className={
                  inRect
                    ? rectFree
                      ? 'ie-pcell ie-pcell-new'
                      : 'ie-pcell ie-pcell-bad'
                    : sections.length && o < 0
                      ? 'ie-pcell ie-pcell-unused'
                      : 'ie-pcell'
                }
                style={{
                  gridArea: `${y + 1} / ${x + 1}`,
                  ...(color && { background: `${color}55` }),
                }}
              />
            );
          })}
          {sections.map(({ at: [x, y], size: [sw, sh] }, i) => (
            <div
              key={`s${i}`}
              className="ie-psection"
              style={{
                gridArea: `${y + 1} / ${x + 1} / ${y + sh + 1} / ${x + sw + 1}`,
                borderColor: SECTION_COLORS[i % SECTION_COLORS.length],
              }}
            >
              <span>{i + 1}</span>
              <button
                title="Remove this pouch"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => set(sections.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="ed-note">
        Drag across empty cells to add a pouch. Items never reach across a pouch&apos;s edge.
      </p>
      {sections.length > 0 && free > 0 && (
        <p className="ie-warn">
          {free} cell{free === 1 ? '' : 's'} in no pouch hold nothing.
        </p>
      )}
      {sections.length > 0 && (
        <details className="ie-positions">
          <summary>
            Positions
            {canFit && (
              <button
                title="Shrinks the inside to the box around the pouches"
                onClick={(e) => {
                  e.preventDefault();
                  props.edit((d) => {
                    const { x0, y0, x1, y1 } = box!;
                    put(d, ['grid'], [x1 - x0, y1 - y0]);
                    put(
                      d,
                      ['sections'],
                      sections.map((s) => ({
                        at: [s.at[0] - x0, s.at[1] - y0],
                        size: [...s.size],
                      })),
                    );
                  });
                }}
              >
                Trim inside to fit
              </button>
            )}
          </summary>
          <div className="ie-sec-table">
            <span />
            <span className="ie-label">x</span>
            <span className="ie-label">y</span>
            <span className="ie-label">w</span>
            <span className="ie-label">h</span>
            {sections.map((_, i) => (
              <Fragment key={i}>
                <span
                  className="ie-sec-num"
                  style={{ color: SECTION_COLORS[i % SECTION_COLORS.length] }}
                >
                  {i + 1}
                </span>
                <N {...props} path={['sections', i, 'at', 0]} label="" min={0} />
                <N {...props} path={['sections', i, 'at', 1]} label="" min={0} />
                <N {...props} path={['sections', i, 'size', 0]} label="" min={1} />
                <N {...props} path={['sections', i, 'size', 1]} label="" min={1} />
              </Fragment>
            ))}
          </div>
        </details>
      )}
    </Group>
  );
}

function Cells(props: {
  w: number;
  h: number;
  color: string;
  label: string;
  art?: string | null;
  /** The art was drawn for the unturned tile (h × w) and is turned a quarter to fit. */
  turned?: boolean;
  /** A cell's size in pixels; 44 left out. */
  size?: number;
}) {
  const { w, h } = props;
  const px = props.size ?? 44;
  if (!(w >= 1 && h >= 1 && w <= 20 && h <= 20)) return null;
  return (
    <div
      className="ie-cells"
      style={{
        gridTemplateColumns: `repeat(${w}, ${px}px)`,
        gridTemplateRows: `repeat(${h}, ${px}px)`,
      }}
    >
      {props.color ? (
        <div
          className="ie-tile"
          style={{
            background: props.art ? `${props.color}66` : props.color,
            borderColor: props.color,
            gridArea: `1 / 1 / ${h + 1} / ${w + 1}`,
          }}
        >
          {props.art && (
            <img
              className={props.turned ? 'ie-tile-art ie-tile-art-turned' : 'ie-tile-art'}
              src={props.art}
              alt=""
              style={
                props.turned
                  ? { width: `${(h / w) * 100}%`, height: `${(w / h) * 100}%` }
                  : undefined
              }
            />
          )}
          <span className="ie-tile-name">{props.label}</span>
        </div>
      ) : (
        Array.from({ length: w * h }, (_, i) => <div key={i} className="ie-cell" />)
      )}
    </div>
  );
}

const fmt = (n: number, places = 2): string => String(Number(n.toFixed(places)));

/** What an item's numbers work out to, for balancing. */
function Facts({ def, db }: { def: ItemDef; db: ItemDb }) {
  const lines: string[] = [];
  const money = def.type === 'loot' && def.money;
  if (money) lines.push(`Each is deposited as ${def.value} money.`);
  else if (def.value > 0)
    lines.push(
      `Vendors sell it for ${def.value} and buy it new for ${Math.floor(def.value * VENDOR.sellShare)}.`,
    );
  else lines.push("Worth nothing: it can't be bought or sold.");
  switch (def.type) {
    case 'weapon': {
      const ammo = db.get(def.ammo);
      const gap = 60 / def.rpm;
      lines.push(
        `A shot every ${fmt(gap, 3)} s; a full magazine lasts ${fmt(def.magazine * gap)} s.`,
      );
      if (ammo?.type === 'ammo' && ammo.flame) {
        const f = ammo.flame;
        lines.push(
          `With ${ammo.name}: a flame every ${fmt(gap, 3)} s, landing ${fmt(def.range / f.speed, 2)} s out at its range. Someone set alight loses ${fmt(f.burnDamage * 6 * f.burnTime, 0)} HP if they let it burn out, ${fmt(f.burnDamage * 6 * FIRE.extinguishTime, 0)} if they put it out at once.`,
        );
      } else if (ammo?.type === 'ammo') {
        // Every pellet landing.
        const round = ammo.damage * (ammo.pellets ?? 1);
        lines.push(
          `With ${ammo.name}: ${fmt(round * (def.rpm / 60), 0)} damage a second to an unarmored chest, ${fmt(round * def.magazine, 0)} a magazine.`,
        );
      }
      break;
    }
    case 'attachment':
      for (const g of db.values()) {
        if (g.type !== 'weapon' || !fits(g, def)) continue;
        const changes = gunChanges(g, def);
        lines.push(`On ${g.name}: ${changes.length ? changes.join(', ') : 'no stat changes'}.`);
      }
      break;
    case 'container': {
      const inside = def.grid[0] * def.grid[1];
      const outside = def.size[0] * def.size[1];
      lines.push(`Holds ${inside} cells for the ${outside} it takes up: ${inside - outside} more.`);
      break;
    }
    case 'ammo': {
      lines.push(`A full stack of ${def.stack} is worth ${def.stack * def.value}.`);
      const guns = [...db.values()].filter((g) => g.type === 'weapon' && firesRound(db, g, def.id));
      lines.push(
        guns.length ? `Fired by ${guns.map((g) => g.name).join(', ')}.` : 'No gun fires it.',
      );
      break;
    }
    case 'med':
      if (def.effect === 'heal') lines.push(`${fmt(def.hp! / def.useTime, 1)} HP a second of use.`);
      break;
    case 'armor':
      lines.push(`${fmt(def.value / def.durability, 0)} money a point of durability.`);
      break;
  }
  return (
    <div className="ie-card">
      <h4>works out to</h4>
      {lines.map((l) => (
        <p key={l} className="ed-note">
          {l}
        </p>
      ))}
    </div>
  );
}

/** How an attachment changes one gun's stats, as "reload 2.4 → 2.76 s". */
function gunChanges(g: WeaponDef, a: AttachmentDef): string[] {
  const m = a.mods ?? {};
  const out: string[] = [];
  const show = (label: string, from: number, by: number | undefined, unit = ''): void => {
    if (by !== undefined && by !== 1) out.push(`${label} ${fmt(from)} → ${fmt(from * by)}${unit}`);
  };
  if (m.magazine) out.push(`magazine ${g.magazine} → ${g.magazine + m.magazine}`);
  show('aimed spread', g.aimSpread, m.spread, '°');
  show('kick up', g.recoil.up, (m.recoil ?? 1) * (m.recoilUp ?? 1), '°');
  show('kick sideways', g.recoil.side, (m.recoil ?? 1) * (m.recoilSide ?? 1), '°');
  show('recovery', g.recoil.recovery, m.ergonomics, '/s');
  show('aim', g.aimTime, m.aimTime, ' s');
  show('reload', g.reloadTime, m.reloadTime, ' s');
  show('heard to', g.loudness, m.loudness, ' m');
  return out;
}

function UsedBy({ id, items }: { id: string; items: ReadonlyMap<string, ItemDef> }) {
  const uses = itemUses(id, items);
  return (
    <div className="ie-card">
      <h4>named by</h4>
      {uses.length ? (
        <p className="ed-note">{uses.join(' · ')}</p>
      ) : (
        <p className="ed-note">Nothing names it yet: it won&apos;t turn up in the game.</p>
      )}
    </div>
  );
}

/** "Pool Pump Impeller" -> "pool-pump-impeller", as typed (a trailing dash is trimmed on make). */
const toId = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-/, '');

/** "Pool Pump Impeller" -> "Pool pump impeller": a capital first, the rest lower case. */
const toName = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/^\s/, '')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

/** The form for a new item, blank of a type or a copy of the open one. */
function NewItem(props: {
  editor: ItemEditor;
  state: ItemEditorState;
  copy: boolean;
  close: () => void;
}) {
  const { state: s, copy } = props;
  const from = s.items.get(s.current);
  const [type, setType] = useState<ItemType>(from?.type ?? 'loot');
  const [rawId, setId] = useState(copy && from ? `${from.id}-2` : '');
  const id = rawId.replace(/-+$/, '');
  const [name, setName] = useState(copy && from ? `${from.name} 2` : '');
  const idProblem = !id
    ? 'needs an id'
    : !idSchema.safeParse(id).success
      ? 'ids are lower-case letters, digits and dashes'
      : s.items.has(id)
        ? 'that item exists'
        : null;
  const make = (): void => {
    if (idProblem || !name.trim()) return;
    props.editor.create(type, id, name.trim(), copy ? s.current : undefined);
    props.close();
  };
  return (
    <div className="ed-modal" onKeyDown={(e) => e.key === 'Escape' && props.close()}>
      <div className="ed-inspector">
        <h3>{copy ? `copy ${from?.name}` : 'new item'}</h3>
        {!copy && (
          <label className="ed-field">
            type
            <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
              {ITEM_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <label className="ed-field">
          id
          <input value={rawId} autoFocus onChange={(e) => setId(toId(e.target.value))} />
        </label>
        <label className="ed-field">
          name
          <input
            value={name}
            onChange={(e) => setName(toName(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && make()}
          />
        </label>
        <p className="ed-note">
          The id is the file name, content/items/&lt;id&gt;.json, and can&apos;t change later.
        </p>
        {id && idProblem && <p className="ed-problem">{idProblem}</p>}
        <div className="ed-row">
          <button onClick={make} disabled={!!idProblem || !name.trim()}>
            Make
          </button>
          <button onClick={props.close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
