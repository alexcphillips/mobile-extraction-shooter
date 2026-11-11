import {
  ATTACHMENT_SLOTS,
  bagCells,
  bagRarity,
  FIRE,
  GRENADE_EFFECTS,
  MED_EFFECTS,
  ITEM_VIEWS,
  type ItemView,
  RARITIES,
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
import { useMemo, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react';
import { sounds } from '../audio/sounds';
import { itemUses, soundSources } from '../content';
import { C, Check, N, P, Row, put, type Bound } from '../editor/bound-fields';
import { Text, Toggle } from '../editor/fields';
import { previewPortrait, viewOf } from '../render/item-portrait';
import { colourOf, tileName } from '../ui/raid-screen';
import { sectionBoxes } from '../ui/inventory-layout';
import type { Doc, ItemEditor, ItemEditorState } from './editor';
import { fitPointsToSlot, setSlots } from './model-edit';
import { FitsPage, type OpenFit } from './fits-panel';
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

/** Loot by its category, A to Z, with uncategorised loot ('') last. */
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
          <span className="ie-swatch" style={{ background: colourOf(d) }} />
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
      <section className="ed-inspector ie-form">
        <h3>{def.name}</h3>
        <p className="ed-note">content/items/{def.id}.json</p>
        <label
          className="ed-field"
          title="Keeps its name, size, value, rarity and model; the rest starts from the new type's blank"
        >
          type
          <select value={def.type} onChange={(e) => editor.changeType(e.target.value as ItemType)}>
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <Text label="name" value={def.name} onChange={(v) => b.edit((d) => put(d, ['name'], v))} />
        <Text
          label="short name (on its tile)"
          value={def.shortName ?? ''}
          placeholder={def.name}
          onChange={(v) => b.edit((d) => put(d, ['shortName'], v.trim() ? v : undefined))}
        />
        <h4>in the inventory</h4>
        <Row>
          <N {...b} path={['size', 0]} label="width (cells)" min={1} />
          <N {...b} path={['size', 1]} label="height (cells)" min={1} />
        </Row>
        <N
          {...b}
          path={['value']}
          label="value (money, new)"
          min={0}
          hint="What vendors sell it for; they buy it for a share of this"
        />
        <P {...b} path={['rarity']} label="rarity (its tile's colour)" options={RARITIES} />
        {def.type === 'container' && def.slot !== 'vault' && <BagRarityNote {...b} def={def} />}
        <ViewPicker {...b} def={def} />
        <TypeFields {...b} def={def} items={s.items} />
        <SoundFields {...b} def={def} />
        {problem && <p className="ed-problem">{problem}</p>}
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

function TypeFields(props: Bound & { def: ItemDef; items: ReadonlyMap<string, ItemDef> }) {
  const { def, items, ...b } = props;
  const ofType = (t: ItemType): string[] =>
    [...items.values()].filter((d) => d.type === t).map((d) => d.id);
  switch (def.type) {
    case 'weapon':
      return (
        <>
          <h4>gun</h4>
          <P
            {...b}
            path={['ammo']}
            label="ammo"
            options={[
              ...ofType('ammo'),
              // Not C4: it's placed by hand, never launched.
              ...ofType('grenade').filter((id) => roundOf(items, id)),
            ]}
          />
          {items.get(def.ammo)?.type === 'grenade' && (
            <Row>
              <N
                {...b}
                path={['launchSpeed']}
                label="launch speed (m/s)"
                min={0}
                hint="Grenade launchers: how fast a grenade leaves the barrel"
              />
              <N
                {...b}
                path={['armDistance']}
                label="arms after (m)"
                min={0}
                hint="Goes off on impact once it's flown this far; blank keeps only the fuse"
              />
            </Row>
          )}
          <P
            {...b}
            path={['hold']}
            label="held as"
            options={['rifle', 'pistol']}
            unset="rifle (default)"
          />
          <P {...b} path={['fireMode']} label="fire mode" options={['auto', 'semi']} />
          <Row>
            <N {...b} path={['rpm']} label="rounds a minute" min={0} />
            <N {...b} path={['magazine']} label="magazine" min={1} />
          </Row>
          <Row>
            <N {...b} path={['reloadTime']} label="reload (s)" min={0} />
            <N {...b} path={['aimTime']} label="aim (s)" min={0} />
            <N {...b} path={['drawTime']} label="draw (s)" min={0} />
          </Row>
          <Row>
            <N {...b} path={['range']} label="range (m)" min={0} />
            <N
              {...b}
              path={['loudness']}
              label="heard to (m)"
              min={0}
              hint="How far away enemies hear a shot"
            />
          </Row>
          <h4>accuracy (degrees)</h4>
          <Row>
            <N {...b} path={['hipSpread']} label="hip spread" min={0} />
            <N {...b} path={['aimSpread']} label="aimed spread" min={0} />
          </Row>
          <Row>
            <N {...b} path={['recoil', 'up']} label="kick up" min={0} />
            <N {...b} path={['recoil', 'side']} label="kick sideways" min={0} />
          </Row>
          <Row>
            <N
              {...b}
              path={['recoil', 'snap']}
              label="snap (/s)"
              min={0}
              hint="How fast each kick lands: higher is snappier (about 40)"
            />
            <N
              {...b}
              path={['recoil', 'recovery']}
              label="recovers (/s)"
              min={0}
              hint="How fast the kick wears off: higher settles sooner (about 3)"
            />
          </Row>
          <Row>
            <N
              {...b}
              path={['recoil', 'angle']}
              label="kick angle (°)"
              hint="Which way it climbs, off straight up: + right, − left, up to 45. Blank: straight up"
            />
            <N
              {...b}
              path={['recoil', 'stableAfter']}
              label="steadies after (rounds)"
              min={1}
              hint="Past this round of a burst it stops climbing. Blank: climbs until recovery catches up"
            />
          </Row>
          <h4>attachment slots</h4>
          <Row>
            {ATTACHMENT_SLOTS.map((slot) => (
              <label key={slot} className="ed-field">
                <input
                  type="checkbox"
                  checked={!!def.slots?.includes(slot)}
                  onChange={(e) =>
                    b.edit((d) => {
                      const was = (d.slots as string[] | undefined) ?? [];
                      setSlots(
                        d,
                        ATTACHMENT_SLOTS.filter((s) =>
                          s === slot ? e.target.checked : was.includes(s),
                        ),
                      );
                    })
                  }
                />
                {slot}
              </label>
            ))}
          </Row>
        </>
      );
    case 'ammo':
      return (
        <>
          <h4>rounds</h4>
          <N {...b} path={['stack']} label="stack (most in one cell)" min={2} />
          <Row>
            <Text
              label="calibre"
              value={def.calibre}
              onChange={(v) => b.edit((d) => put(d, ['calibre'], v))}
            />
            <N
              {...b}
              path={['level']}
              label="level (1–6)"
              min={1}
              hint="Against armour's level: below it does nothing until it breaks, level half, above all"
            />
          </Row>
          <label
            className="ed-field"
            title="A flamethrower's fuel: flames that set alight, no bullet"
          >
            <input
              type="checkbox"
              checked={!!def.flame}
              onChange={(e) =>
                b.edit((d) => {
                  // Fuel does no damage itself: the burning does it.
                  if (e.target.checked) {
                    d.flame = { speed: 18, burnTime: 8, burnDamage: 1.5, fireTime: 7 };
                    d.damage = 0;
                    delete d.pellets;
                    delete d.pelletSpread;
                  } else {
                    delete d.flame;
                    d.damage = 10;
                  }
                })
              }
            />
            flamethrower fuel
          </label>
          {def.flame && (
            <>
              <Row>
                <N {...b} path={['flame', 'speed']} label="flame speed (m/s)" min={0} />
                <N
                  {...b}
                  path={['flame', 'fireTime']}
                  label="burns on the map (s)"
                  min={0}
                  hint="Where it lands; anyone touching it is set alight"
                />
              </Row>
              <Row>
                <N
                  {...b}
                  path={['flame', 'burnDamage']}
                  label="burn damage (/s a zone)"
                  min={0}
                  hint="To every zone, past armour, while alight"
                />
                <N
                  {...b}
                  path={['flame', 'burnTime']}
                  label="burns someone for (s)"
                  min={0}
                  hint={`If they don't put it out, which takes ${FIRE.extinguishTime} s`}
                />
              </Row>
            </>
          )}
          {!def.flame && <N {...b} path={['damage']} label="damage (to the chest)" min={0} />}
          {!def.flame && (
            <label
              className="ed-field"
              title="May set alight whoever it hits, on top of its damage"
            >
              <input
                type="checkbox"
                checked={!!def.incendiary}
                onChange={(e) =>
                  b.edit((d) => {
                    if (e.target.checked)
                      d.incendiary = { chance: 0.25, burnTime: 4, burnDamage: 1.5 };
                    else delete d.incendiary;
                  })
                }
              />
              incendiary
            </label>
          )}
          {def.incendiary && (
            <Row>
              <N
                {...b}
                path={['incendiary', 'chance']}
                label="sets alight (0–1 a hit)"
                min={0}
                hint="Each pellet's own chance, for shells"
              />
              <N {...b} path={['incendiary', 'burnTime']} label="burns for (s)" min={0} />
              <N
                {...b}
                path={['incendiary', 'burnDamage']}
                label="burn damage (/s a zone)"
                min={0}
              />
            </Row>
          )}
          <Row>
            <N
              {...b}
              path={['armourDamage']}
              label="armour damage"
              min={0}
              hint="Durability lost per hit, less against armour above its level"
            />
            <N {...b} path={['bleedChance']} label="bleed chance (0–1)" min={0} />
          </Row>
          <Row>
            <N
              {...b}
              path={['pellets']}
              label="pellets (1)"
              min={2}
              hint="Shotgun shells: pellets a round fires, each doing the damage; blank is 1"
            />
            <N
              {...b}
              path={['pelletSpread']}
              label="pellet spread (°)"
              min={0}
              hint="With pellets: the most each strays from the shot's line"
            />
          </Row>
        </>
      );
    case 'armour':
      return (
        <>
          <h4>armour</h4>
          <P {...b} path={['slot']} label="worn as" options={['helmet', 'body']} />
          <Row>
            <N {...b} path={['level']} label="level (1–6)" min={1} />
            <N {...b} path={['durability']} label="durability" min={0} />
            <N
              {...b}
              path={['repairLoss']}
              label="repair loss (0–1)"
              min={0}
              hint="The share of what a repair mends that comes off its max. Blank is 0.1"
            />
          </Row>
          <Row>
            <N
              {...b}
              path={['mask', 'edge']}
              label="mask: view hidden (0–0.4)"
              min={0}
              hint="A face mask: the share of the screen's width hidden at each side. Blank is none"
            />
            <N
              {...b}
              path={['mask', 'muffle']}
              label="mask: muffle (Hz)"
              min={200}
              hint="A face mask: sounds above this are muffled for whoever wears it. Blank is none"
            />
          </Row>
        </>
      );
    case 'attachment':
      return <AttachmentFields {...b} def={def} weapons={ofType('weapon')} items={items} />;
    case 'med':
      return (
        <>
          <h4>med</h4>
          <P
            {...b}
            path={['effect']}
            label="does"
            options={MED_EFFECTS}
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
          <Row>
            <N {...b} path={['useTime']} label="use time (s)" min={0} />
            {def.effect === 'heal' ? (
              <N {...b} path={['hp']} label="HP in all" min={0} />
            ) : (
              <N {...b} path={['uses']} label="uses (1)" min={1} hint="Blank is 1" />
            )}
          </Row>
          {def.effect === 'heal' && (
            <N
              {...b}
              path={['bleedCost']}
              label="HP to stop a bleed"
              min={1}
              hint="Blank: doesn't stop bleeding"
            />
          )}
        </>
      );
    case 'container':
      return (
        <>
          <h4>rig or backpack</h4>
          <P {...b} path={['slot']} label="worn as" options={['rig', 'backpack', 'vault']} />
          <Row>
            <N {...b} path={['grid', 0]} label="inside width" min={1} />
            <N {...b} path={['grid', 1]} label="inside height" min={1} />
          </Row>
          <SectionFields {...b} def={def} />
        </>
      );
    case 'melee':
      return (
        <>
          <h4>knife</h4>
          <Row>
            <N {...b} path={['damage']} label="damage" min={0} />
            <N {...b} path={['level']} label="level (1–6)" min={1} />
          </Row>
          <Row>
            <N {...b} path={['armourDamage']} label="armour damage" min={0} />
            <N {...b} path={['bleedChance']} label="bleed chance" min={0} />
          </Row>
          <Row>
            <N {...b} path={['swingTime']} label="swing (s)" min={0} />
            <N {...b} path={['reach']} label="reach (m)" min={0} />
            <N {...b} path={['drawTime']} label="draw (s)" min={0} />
          </Row>
          {def.id !== 'knife' && (
            <p className="ed-note">Players always carry the item called knife; this one is loot.</p>
          )}
        </>
      );
    case 'grenade':
      return (
        <>
          <h4>grenade</h4>
          <P
            {...b}
            path={['effect']}
            label="effect"
            options={[...GRENADE_EFFECTS]}
            unset="frag (default)"
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
            <N
              {...b}
              path={['blindTime']}
              label="blinds for (s)"
              min={0}
              hint="Looking at it, close; less further out"
            />
          )}
          {def.effect === 'smoke' && (
            <N {...b} path={['smokeTime']} label="cloud lasts (s)" min={0} />
          )}
          {def.effect === 'molotov' && (
            <Row>
              <N
                {...b}
                path={['fire', 'fireTime']}
                label="fire burns (s)"
                min={0}
                hint="Spilled across its radius where it breaks"
              />
              <N {...b} path={['fire', 'burnTime']} label="burns someone for (s)" min={0} />
              <N {...b} path={['fire', 'burnDamage']} label="burn damage (/s a zone)" min={0} />
            </Row>
          )}
          <Row>
            <N {...b} path={['damage']} label="damage at the centre" min={0} />
            <N {...b} path={['level']} label="level (1–6)" min={1} />
          </Row>
          <Row>
            <N {...b} path={['armourDamage']} label="armour damage" min={0} />
            <N {...b} path={['bleedChance']} label="bleed chance" min={0} />
          </Row>
          <Row>
            <N {...b} path={['radius']} label="radius (m)" min={0} />
            <N
              {...b}
              path={['fuse']}
              label="fuse (s)"
              min={0}
              hint="From the throw; for C4, from the detonator"
            />
          </Row>
          <Row>
            <N {...b} path={['throwSpeed']} label="throw speed (m/s)" min={0} />
            <N {...b} path={['loudness']} label="heard from (m)" min={0} />
          </Row>
        </>
      );
    case 'key':
      return (
        <>
          <h4>key</h4>
          <N
            {...b}
            path={['uses']}
            label="uses (blank: never wears out)"
            min={1}
            hint="Unlocks this many times, then it's gone"
          />
        </>
      );
    case 'loot':
      return (
        <>
          <h4>loot</h4>
          <N {...b} path={['stack']} label="stack (blank: doesn't stack)" min={2} />
          <Check {...b} path={['money']} label="money: deposited at full value" />
          <C
            {...b}
            path={['category']}
            label="category (item details)"
            options={categories(items)}
            unset="none (shows Loot)"
            newLabel="category"
          />
        </>
      );
    case 'repair':
      return (
        <>
          <h4>repair kit</h4>
          <Row>
            <N {...b} path={['points']} label="durability in all" min={0} />
            <N {...b} path={['useTime']} label="use time (s)" min={0} />
          </Row>
        </>
      );
    case 'quest':
      return (
        <p className="ed-note">A quest item has nothing more: its quest says where it lies.</p>
      );
  }
}

const SOUND_USES: Record<string, string> = {
  shot: 'shot',
  suppressed: 'shot, suppressed',
  reload: 'reload',
  swing: 'swing',
  use: 'using it',
  throw: 'throw',
  bounce: 'bounce',
  explode: 'going off',
};

/** The sound files it plays (session 19), each with a button to hear it and a link to tune it. */
function SoundFields(props: Bound & { def: ItemDef }) {
  const { def, ...b } = props;
  if (!('sounds' in def)) return null;
  const ids = [...soundSources().keys()];
  return (
    <>
      <h4>sounds</h4>
      {Object.entries(def.sounds).map(([use, id]) => (
        <Row key={use}>
          <P {...b} path={['sounds', use]} label={SOUND_USES[use] ?? use} options={ids} />
          <button onClick={() => sounds().play(id)} title="Play it">
            ▶
          </button>
          <a className="ie-link" href={`/sounds?sound=${id}`} target="sounds">
            tune
          </a>
        </Row>
      ))}
    </>
  );
}

const MED_NOTES: Record<(typeof MED_EFFECTS)[number], string> = {
  bandage: 'Stops one zone bleeding per use.',
  splint: "Takes away a broken limb's effects (it stays at 0 HP).",
  surgery: 'Brings a broken limb back to 1 HP.',
  heal: "Restores HP to limbs that aren't broken, from its pool.",
};

// The first RECOIL_MODS share a row.
const RECOIL_MODS = 4;
const MODS: [key: string, label: string, hint: string][] = [
  ['recoil', 'recoil ×', 'Kick up and sideways'],
  ['recoilUp', 'kick up ×', 'On top of recoil ×'],
  ['recoilSide', 'kick sideways ×', 'On top of recoil ×'],
  ['ergonomics', 'ergonomics ×', 'Above 1 recovers from recoil faster'],
  ['spread', 'spread ×', 'Hip and aimed spread'],
  ['aimTime', 'aim time ×', ''],
  ['reloadTime', 'reload ×', ''],
  ['loudness', 'loudness ×', 'Below 1 is quieter'],
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
      <h4>attachment</h4>
      <P
        {...b}
        path={['slot']}
        label="slot"
        options={ATTACHMENT_SLOTS}
        then={(d, v) => {
          if (v === 'optic' && d.optic === undefined)
            put(d, ['optic'], structuredClone(BLANK_OPTIC));
          if (v !== 'optic') put(d, ['optic'], undefined);
          fitPointsToSlot(d);
        }}
      />
      <h4>fits</h4>
      <p className="ed-note">
        {listed.length ? 'Only the guns ticked.' : `Every gun with a ${def.slot} slot.`}
      </p>
      <Row>
        {[...new Set([...withSlot, ...listed])].map((w) => (
          <label key={w} className="ed-field">
            <input
              type="checkbox"
              checked={listed.includes(w)}
              onChange={(e) =>
                b.edit((d) => {
                  const next = weapons.filter((x) =>
                    x === w ? e.target.checked : listed.includes(x),
                  );
                  put(d, ['weapons'], next.length ? next : undefined);
                })
              }
            />
            {w}
          </label>
        ))}
      </Row>
      <h4>changes to the gun (blank: none)</h4>
      <Row>
        {MODS.slice(0, RECOIL_MODS).map(([k, label, hint]) => (
          <N key={k} {...b} path={['mods', k]} label={label} min={0} hint={hint} />
        ))}
      </Row>
      <Row>
        {MODS.slice(RECOIL_MODS).map(([k, label, hint]) => (
          <N key={k} {...b} path={['mods', k]} label={label} min={0} hint={hint} />
        ))}
        <N {...b} path={['mods', 'magazine']} label="extra rounds" min={1} />
      </Row>
      {def.optic && (
        <>
          <h4>optic</h4>
          <N
            {...b}
            path={['optic', 'zoom']}
            label="zoom (1: red dot, above: scope)"
            min={1}
            hint="A scope zooms the whole screen behind a mask"
          />
        </>
      )}
    </>
  );
}

/** The item at its grid size, and a rig's or backpack's grid inside. */
const VIEW_NOTES: Record<ItemView, string> = {
  top: 'straight down, the back (−z) at the top',
  front: 'from the front (+z)',
  side: "from the left (−x), a gun's barrel to the left",
  angled:
    'a three-quarter turn from the front left, the front (−z) to the left, a little from above',
  frontRight: 'a three-quarter turn from the front right, a little from above',
  backLeft: 'a three-quarter turn from the back left, a little from above',
  backRight: 'a three-quarter turn from the back right, a little from above',
};

/** What each view's button says (`angled` is the front-left one, under its old name). */
const VIEW_LABELS: Record<ItemView, string> = {
  top: 'top',
  front: 'front',
  side: 'side',
  angled: 'front left',
  frontRight: 'front right',
  backLeft: 'back left',
  backRight: 'back right',
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
  const scale = 52 / Math.max(w, h);
  return (
    <>
      <h4>its picture, taken from</h4>
      <div className="ie-views">
        {ITEM_VIEWS.map((v, i) => (
          <button
            key={v}
            className={v === current ? 'ie-view ed-on' : 'ie-view'}
            title={VIEW_NOTES[v]}
            onClick={() => props.edit((d) => put(d, ['view'], v === byKind ? undefined : v))}
          >
            <span
              className="ie-view-tile"
              style={{
                width: w * scale,
                height: h * scale,
                background: `${colourOf(def)}66`,
                borderColor: colourOf(def),
              }}
            >
              {arts[i] && <img src={arts[i]!} alt="" />}
            </span>
            {VIEW_LABELS[v]}
            {v === byKind && <span className="ed-note"> (its kind&apos;s)</span>}
          </button>
        ))}
      </div>
    </>
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
        <Cells w={w} h={h} colour={colourOf(def)} label={tileName(def)} art={art} />
        {/* Turned, as the inventory draws it when rotated (2026-11-09): the same picture, a
            quarter turn clockwise. Every item that isn't square can be rotated. */}
        {w !== h && (
          <Cells w={h} h={w} colour={colourOf(def)} label={tileName(def)} art={art} turned />
        )}
        {def.type === 'container' && <InsidePreview def={def} />}
      </div>
    </div>
  );
}

/** A rig's or backpack's inside as the inventory draws it: each section its own box. */
function InsidePreview({ def }: { def: ContainerDef }) {
  const [w, h] = def.grid;
  if (!def.sections?.length) return <Cells w={w} h={h} colour="" label="" />;
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
          <Cells w={s.w} h={s.h} colour="" label="" />
        </div>
      ))}
    </div>
  );
}

/**
 * A rig's or backpack's rarity by its cells (2026-11-11): filled in when they change
 * (editor.ts), and here, when set by hand to another, a button to go back to it.
 */
function BagRarityNote(props: Bound & { def: ContainerDef }) {
  const { def } = props;
  const cells = bagCells(def);
  const auto = bagRarity(def);
  return (
    <p className="ed-note">
      {cells} slot{cells === 1 ? '' : 's'}: {auto} by size
      {def.rarity !== auto && (
        <>
          {' '}
          (set by hand){' '}
          <button onClick={() => props.edit((d) => put(d, ['rarity'], auto))}>use {auto}</button>
        </>
      )}
    </p>
  );
}

/** Each section's colour in the painter, by its index. */
const SECTION_COLOURS = ['#4f8fd6', '#d68f4f', '#5fb36a', '#b45fc4', '#c9b13e', '#4fbfbf'];

/**
 * A rig's or backpack's sections (compartments, 2026-11-11): drag across free cells of
 * the inside to add one, × to remove it, or set its cell and size below. No sections is
 * one open grid. Pouches splits the inside into 1-wide columns, as the chest rig has.
 */
function SectionFields(props: Bound & { def: ContainerDef }) {
  const { def } = props;
  const [w, h] = def.grid;
  const sections = def.sections ?? [];
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  if (!(w >= 1 && h >= 1 && w <= 20 && h <= 20)) return null;
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
  const set = (next: { at: [number, number]; size: [number, number] }[]) =>
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
  const free = w * h - sections.reduce((n, s) => n + s.size[0] * s.size[1], 0);
  return (
    <>
      <h4>sections (compartments)</h4>
      <p className="ed-note">
        {sections.length
          ? `Drag across free cells to add one. Items never reach across a section's edge.${free ? ` ${free} cell${free === 1 ? '' : 's'} in no section hold nothing.` : ''}`
          : 'One open grid. Drag across the cells to make a section.'}
      </p>
      <div
        className="ie-painter"
        style={{
          gridTemplateColumns: `repeat(${w}, 40px)`,
          gridTemplateRows: `repeat(${h}, 40px)`,
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
          const colour = o >= 0 ? SECTION_COLOURS[o % SECTION_COLOURS.length] : undefined;
          return (
            <div
              key={i}
              data-cell={`${x},${y}`}
              className={
                inRect ? (rectFree ? 'ie-pcell ie-pcell-new' : 'ie-pcell ie-pcell-bad') : 'ie-pcell'
              }
              style={{
                gridArea: `${y + 1} / ${x + 1}`,
                ...(colour && { background: `${colour}99` }),
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
              borderColor: SECTION_COLOURS[i % SECTION_COLOURS.length],
            }}
          >
            <span>{i + 1}</span>
            <button
              title="Remove this section"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => set(sections.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <Row>
        <button
          title="Splits the inside into 1-wide columns, each as tall as the inside"
          onClick={() => set(Array.from({ length: w }, (_, x) => ({ at: [x, 0], size: [1, h] })))}
        >
          pouches (columns)
        </button>
        <button
          title="Splits the inside into rows, each as wide as the inside"
          onClick={() => set(Array.from({ length: h }, (_, y) => ({ at: [0, y], size: [w, 1] })))}
        >
          rows
        </button>
        <button
          title="No sections: the inside is one open grid"
          disabled={!sections.length}
          onClick={() => set([])}
        >
          one open grid
        </button>
        <button
          title="Shrinks the inside to the box around the sections"
          disabled={!sections.length}
          onClick={() =>
            props.edit((d) => {
              const ss = sections;
              const x0 = Math.min(...ss.map((s) => s.at[0]));
              const y0 = Math.min(...ss.map((s) => s.at[1]));
              const x1 = Math.max(...ss.map((s) => s.at[0] + s.size[0]));
              const y1 = Math.max(...ss.map((s) => s.at[1] + s.size[1]));
              put(d, ['grid'], [x1 - x0, y1 - y0]);
              put(
                d,
                ['sections'],
                ss.map((s) => ({ at: [s.at[0] - x0, s.at[1] - y0], size: [...s.size] })),
              );
            })
          }
        >
          fit inside
        </button>
      </Row>
      {sections.map((_, i) => (
        <div key={i} className="ie-sec-row">
          <span
            className="ie-sec-num"
            style={{ color: SECTION_COLOURS[i % SECTION_COLOURS.length] }}
          >
            {i + 1}
          </span>
          <N {...props} path={['sections', i, 'at', 0]} label="x" min={0} />
          <N {...props} path={['sections', i, 'at', 1]} label="y" min={0} />
          <N {...props} path={['sections', i, 'size', 0]} label="w" min={1} />
          <N {...props} path={['sections', i, 'size', 1]} label="h" min={1} />
        </div>
      ))}
    </>
  );
}

function Cells(props: {
  w: number;
  h: number;
  colour: string;
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
      {props.colour ? (
        <div
          className="ie-tile"
          style={{
            background: props.art ? `${props.colour}66` : props.colour,
            borderColor: props.colour,
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
          `With ${ammo.name}: ${fmt(round * (def.rpm / 60), 0)} damage a second to an unarmoured chest, ${fmt(round * def.magazine, 0)} a magazine.`,
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
    case 'armour':
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
