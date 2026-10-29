import {
  ATTACHMENT_SLOTS,
  MED_EFFECTS,
  VENDOR,
  fits,
  idSchema,
  type AttachmentDef,
  type ItemDb,
  type ItemDef,
  type WeaponDef,
} from '@mes/shared';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { itemUses } from '../content';
import { Num, Pick, Text, Toggle } from '../editor/fields';
import { colourOf } from '../ui/raid-screen';
import type { Doc, ItemEditor, ItemEditorState } from './editor';
import { fitPointsToSlot, setSlots } from './model-edit';
import { ModelTab } from './model-panel';
import { ReticleDesigner } from './reticle';
import { BLANK_OPTIC, ITEM_TYPES, type ItemType } from './templates';

/*
 * The item editor's page (session 18): the list of items down the left, the open item's
 * fields, and beside them what it looks like in a grid, what it works out to, what names
 * it, and for optics the reticle designer.
 */

type Path = readonly (string | number)[];

function get(doc: Doc, path: Path): unknown {
  let v: unknown = doc;
  for (const k of path) v = v && typeof v === 'object' ? (v as Doc)[String(k)] : undefined;
  return v;
}

/** Sets a field, or leaves it out for undefined (and an object it leaves empty too). */
function put(doc: Doc, path: Path, value: unknown): void {
  const parents: Doc[] = [doc];
  let o = doc;
  for (const k of path.slice(0, -1).map(String)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k] as Doc;
    parents.push(o);
  }
  const last = String(path[path.length - 1]);
  if (value !== undefined) {
    o[last] = value;
    return;
  }
  delete o[last];
  for (let i = parents.length - 1; i > 0; i--) {
    if (Object.keys(parents[i]!).length) break;
    delete parents[i - 1]![String(path[i - 1])];
  }
}

export function ItemEditorPanel({ editor }: { editor: ItemEditor }) {
  const s = useSyncExternalStore(editor.subscribe, editor.getState);
  const [making, setMaking] = useState<'new' | 'copy' | null>(null);
  const [tab, setTab] = useState<'stats' | 'model'>('stats');
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
          {(['stats', 'model'] as const).map((t) => (
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
      ) : tab === 'model' ? (
        <ModelTab editor={editor} state={s} def={def} />
      ) : (
        <ItemPage key={s.current} editor={editor} state={s} def={def} />
      )}
      <div className={s.problem && !s.message ? 'ed-status ed-problem' : 'ed-status'}>
        {status ?? 'Fields change when you press Enter or leave them. ⌘S saves every changed item.'}
      </div>
    </div>
  );
}

function ItemList({ state: s, editor }: { state: ItemEditorState; editor: ItemEditor }) {
  const [filter, setFilter] = useState('');
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
            <div key={type}>
              <h4>{type}</h4>
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
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Fields bound to the open item: a number, a choice, a tick box. */
interface Bound {
  doc: Doc;
  edit: (change: (doc: Doc) => void) => void;
}

function N(props: Bound & { path: Path; label: string; min?: number; hint?: string }) {
  const v = get(props.doc, props.path);
  return (
    <span title={props.hint}>
      <Num
        label={props.label}
        value={typeof v === 'number' ? v : undefined}
        {...(props.min !== undefined && { min: props.min })}
        onChange={(n) => props.edit((d) => put(d, props.path, n))}
      />
    </span>
  );
}

function P(
  props: Bound & {
    path: Path;
    label: string;
    options: readonly string[];
    unset?: string;
    then?: (doc: Doc, v: string | undefined) => void;
  },
) {
  const v = get(props.doc, props.path);
  return (
    <Pick
      label={props.label}
      value={typeof v === 'string' ? v : undefined}
      options={props.options}
      {...(props.unset !== undefined && { unset: props.unset })}
      onChange={(o) =>
        props.edit((d) => {
          put(d, props.path, o);
          props.then?.(d, o);
        })
      }
    />
  );
}

function Check(props: Bound & { path: Path; label: string }) {
  return (
    <label className="ed-field">
      <input
        type="checkbox"
        checked={get(props.doc, props.path) === true}
        onChange={(e) => props.edit((d) => put(d, props.path, e.target.checked || undefined))}
      />
      {props.label}
    </label>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="ed-row">{children}</div>;
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
        <p className="ed-note">
          content/items/{def.id}.json · {def.type}
        </p>
        <Text label="name" value={def.name} onChange={(v) => b.edit((d) => put(d, ['name'], v))} />
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
        <TypeFields {...b} def={def} items={s.items} />
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

function TypeFields(props: Bound & { def: ItemDef; items: ReadonlyMap<string, ItemDef> }) {
  const { def, items, ...b } = props;
  const ofType = (t: ItemType): string[] =>
    [...items.values()].filter((d) => d.type === t).map((d) => d.id);
  switch (def.type) {
    case 'weapon':
      return (
        <>
          <h4>gun</h4>
          <P {...b} path={['ammo']} label="ammo" options={ofType('ammo')} />
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
            <N {...b} path={['recoil', 'recovery']} label="settles (°/s)" min={0} />
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
          <N {...b} path={['damage']} label="damage (to the chest)" min={0} />
          <Row>
            <N
              {...b}
              path={['armourDamage']}
              label="armour damage (1)"
              min={0}
              hint="Durability lost per point the armour absorbs; blank is 1"
            />
            <N {...b} path={['bleedChance']} label="bleed chance (0–1)" min={0} />
          </Row>
        </>
      );
    case 'armour':
      return (
        <>
          <h4>armour</h4>
          <P {...b} path={['slot']} label="worn as" options={['helmet', 'body']} />
          <Row>
            <N {...b} path={['absorb']} label="absorbs (0–1)" min={0} />
            <N {...b} path={['durability']} label="durability" min={0} />
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
              } else put(d, ['hp'], undefined);
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
        </>
      );
    case 'container':
      return (
        <>
          <h4>rig or backpack</h4>
          <P {...b} path={['slot']} label="worn as" options={['rig', 'backpack']} />
          <Row>
            <N {...b} path={['grid', 0]} label="inside width" min={1} />
            <N {...b} path={['grid', 1]} label="inside height" min={1} />
          </Row>
        </>
      );
    case 'melee':
      return (
        <>
          <h4>knife</h4>
          <Row>
            <N {...b} path={['damage']} label="damage" min={0} />
            <N {...b} path={['armourDamage']} label="armour damage (1)" min={0} />
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

const MED_NOTES: Record<(typeof MED_EFFECTS)[number], string> = {
  bandage: 'Stops one zone bleeding per use.',
  splint: "Takes away a broken limb's effects (it stays at 0 HP).",
  surgery: 'Brings a broken limb back to 1 HP.',
  heal: "Restores HP to limbs that aren't broken, from its pool.",
};

const MODS: [key: string, label: string, hint: string][] = [
  ['spread', 'spread ×', 'Hip and aimed spread'],
  ['recoil', 'recoil ×', 'Kick up and sideways'],
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
        {MODS.slice(0, 3).map(([k, label, hint]) => (
          <N key={k} {...b} path={['mods', k]} label={label} min={0} hint={hint} />
        ))}
      </Row>
      <Row>
        {MODS.slice(3).map(([k, label, hint]) => (
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
function SizePreview({ def }: { def: ItemDef }) {
  const [w, h] = def.size;
  return (
    <div className="ie-card">
      <h4>
        {w}×{h} in the inventory
        {def.type === 'container' && ` · ${def.grid[0]}×${def.grid[1]} inside`}
      </h4>
      <div className="ie-sizes">
        <Cells w={w} h={h} colour={colourOf(def)} label={def.name} />
        {def.type === 'container' && <Cells w={def.grid[0]} h={def.grid[1]} colour="" label="" />}
      </div>
    </div>
  );
}

function Cells(props: { w: number; h: number; colour: string; label: string }) {
  const { w, h } = props;
  if (!(w >= 1 && h >= 1 && w <= 20 && h <= 20)) return null;
  return (
    <div
      className="ie-cells"
      style={{ gridTemplateColumns: `repeat(${w}, 26px)`, gridTemplateRows: `repeat(${h}, 26px)` }}
    >
      {props.colour ? (
        <div
          className="ie-tile"
          style={{ background: props.colour, gridArea: `1 / 1 / ${h + 1} / ${w + 1}` }}
        >
          {props.label}
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
      if (ammo?.type === 'ammo')
        lines.push(
          `With ${ammo.name}: ${fmt(ammo.damage * (def.rpm / 60), 0)} damage a second to an unarmoured chest, ${fmt(ammo.damage * def.magazine, 0)} a magazine.`,
        );
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
    case 'ammo':
      lines.push(`A full stack of ${def.stack} is worth ${def.stack * def.value}.`);
      break;
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
  show('kick', g.recoil.up, m.recoil, '°');
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
  const [id, setId] = useState(copy && from ? `${from.id}-2` : '');
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
          <input value={id} autoFocus onChange={(e) => setId(e.target.value)} />
        </label>
        <label className="ed-field">
          name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
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
