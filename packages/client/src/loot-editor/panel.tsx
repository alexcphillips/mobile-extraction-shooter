import {
  RARITIES,
  idSchema,
  stackSize,
  type LootContainerDef,
  type LootMix,
  type LootTableDef,
} from '@mes/shared';
import { useState, useSyncExternalStore } from 'react';
import { loadItems, lootContainerUses, lootTableUses, type Use } from '../content';
import { put, type Doc } from '../editor/bound-fields';
import { Num, Text } from '../editor/fields';
import { MixFields, ShareBar, WeightSlider, partColor } from '../editor/loot-mix';
import { colorOf } from '../ui/raid-screen';
import {
  fileKey,
  parseKey,
  type LootEditor,
  type LootEditorState,
  type LootFileKind,
} from './editor';
import { ItemChip, ItemPicker } from './item-picker';
import { RollPreview } from './roll-preview';
import { tableStats } from './stats';

/*
 * The loot editor's page (2026-11-02): loot tables and container kinds down the left. A
 * table's items as rows (picked from their tiles, weighted with sliders, dragged to
 * reorder) with each one's odds, the table's worth and sample containers rolled from it;
 * a kind's grid, picked by pointing at cells, and its default loot mix, rolled the same.
 */

const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;
const money = (n: number): string => Math.round(n).toLocaleString('en-GB');

export function LootEditorPanel({ editor }: { editor: LootEditor }) {
  const s = useSyncExternalStore(editor.subscribe, editor.getState);
  const [making, setMaking] = useState<{ kind: LootFileKind; copy: boolean } | null>(null);
  const { kind, id } = parseKey(s.current);
  const table = kind === 'table' ? s.tables.get(id) : undefined;
  const container = kind === 'container' ? s.containers.get(id) : undefined;
  const status = s.message ?? (s.problem ? `Problem: ${s.problem}` : null);
  return (
    <div className="ie">
      {making && (
        <NewFile
          editor={editor}
          state={s}
          kind={making.kind}
          copy={making.copy}
          close={() => setMaking(null)}
        />
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
                ? `Save ${s.unsaved.length} files`
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
          <button
            onClick={() => setMaking({ kind, copy: true })}
            disabled={!table && !container}
            title="Copy what's open"
          >
            Copy…
          </button>
        </div>
        <FileList state={s} editor={editor} make={(k) => setMaking({ kind: k, copy: false })} />
        <nav className="le-nav">
          <a className="ie-link" href="/editor">
            Map editor
          </a>
          <a className="ie-link" href="/item-editor">
            Item editor
          </a>
        </nav>
      </aside>
      {table ? (
        <TablePage key={s.current} editor={editor} state={s} def={table} />
      ) : container ? (
        <ContainerPage key={s.current} editor={editor} state={s} def={container} />
      ) : (
        <main />
      )}
      <div className={s.problem && !s.message ? 'ed-status ed-problem' : 'ed-status'}>
        {status ??
          'Drag a slider to weigh things; the odds and samples follow. Fields change on Enter or leaving them. ⌘S saves every changed file.'}
      </div>
    </div>
  );
}

function FileList(props: {
  state: LootEditorState;
  editor: LootEditor;
  make: (kind: LootFileKind) => void;
}) {
  const { state: s, editor } = props;
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const groups: [string, LootFileKind, { id: string; name: string }[]][] = [
    ['containers', 'container', [...s.containers.values()]],
    ['loot tables', 'table', [...s.tables.values()]],
  ];
  return (
    <>
      <input
        className="ie-filter"
        placeholder="Find a table or container"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="ie-items">
        {groups.map(([title, kind, all]) => {
          const of = all
            .filter((d) => !f || d.id.includes(f) || d.name?.toLowerCase().includes(f))
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
          return (
            <div key={title}>
              <h4 className="le-group">
                {title}
                <button onClick={() => props.make(kind)} title={`Make a new ${kind}`}>
                  + new
                </button>
              </h4>
              <ul className="ed-list">
                {of.map((d) => {
                  const key = fileKey(kind, d.id);
                  return (
                    <li
                      key={key}
                      className={key === s.current ? 'ed-on' : undefined}
                      onClick={() => editor.select(key)}
                      title={s.problems.get(key) ?? `content/${key}.json`}
                    >
                      {d.name || d.id}
                      {s.unsaved.includes(key) && <span className="ie-dot"> ●</span>}
                      {s.problems.has(key) && <span className="ed-problem"> !</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Where something's used: maps link to the map editor, kinds open here. */
function Uses(props: { title: string; uses: readonly Use[]; editor: LootEditor; none: string }) {
  return (
    <div className="ie-card">
      <h4>{props.title}</h4>
      {props.uses.length ? (
        props.uses.map((u, i) => (
          <p className="ed-note le-use" key={i}>
            {u.map !== undefined ? (
              <a href={`/editor?map=${u.map}`} target="map-editor" title="Open in the map editor">
                {u.text} ↗
              </a>
            ) : u.open !== undefined ? (
              <button className="le-link" onClick={() => props.editor.select(u.open!)}>
                {u.text}
              </button>
            ) : (
              u.text
            )}
          </p>
        ))
      ) : (
        <p className="ed-note">{props.none}</p>
      )}
    </div>
  );
}

/** Container kinds to roll a table into: the ones whose loot names it first. */
function kindsFor(state: LootEditorState, table: string): LootContainerDef[] {
  const all = [...state.containers.values()].filter((k) => Array.isArray(k.grid));
  const uses = (k: LootContainerDef) => (k.loot?.tables[table] ? 0 : 1);
  return all.sort((a, b) => uses(a) - uses(b) || a.name.localeCompare(b.name));
}

/** A loot table: how many items a container gets, and each item's weight and count. */
function TablePage(props: { editor: LootEditor; state: LootEditorState; def: LootTableDef }) {
  const { editor, state: s, def } = props;
  const items = loadItems();
  const [adding, setAdding] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const edit = (change: (d: Doc) => void) => editor.edit(change);
  const drag = (change: (d: Doc) => void) => editor.edit(change, true);
  const rows = (d: Doc) => d.items as Doc[];
  const stats = tableStats(def, items);
  const valid = !s.problems.has(s.current);
  const taken = new Set(def.items.map((e) => e.item));
  const rarity = RARITIES.map((r) => ({
    label: r,
    weight: stats.entries
      .filter((e) => items.get(e.item)?.rarity === r)
      .reduce((a, e) => a + e.pick, 0),
    color: colorOf({ rarity: r } as Parameters<typeof colorOf>[0]),
  })).filter((p) => p.weight > 0);
  const setCount = (i: number, lo: number, hi: number) =>
    edit((d) => put(d, ['items', i, 'count'], [lo, hi]));
  return (
    <main className="ie-main">
      <section className="ed-inspector ie-form le-form">
        <h3>{def.name}</h3>
        <p className="ed-note">content/loot-tables/{def.id}.json</p>
        <Text label="name" value={def.name} onChange={(v) => edit((d) => put(d, ['name'], v))} />
        <div className="ed-row le-rolls">
          <span>items in a container:</span>
          <Num
            label=""
            value={def.rolls[0]}
            min={0}
            onChange={(v) =>
              v !== undefined && edit((d) => put(d, ['rolls'], [v, Math.max(v, def.rolls[1])]))
            }
          />
          <span>to</span>
          <Num
            label=""
            value={def.rolls[1]}
            min={0}
            onChange={(v) =>
              v !== undefined && edit((d) => put(d, ['rolls'], [Math.min(v, def.rolls[0]), v]))
            }
          />
          <span className="ed-note">(a loose spot takes one)</span>
        </div>

        <h4>what&apos;s picked</h4>
        <ShareBar
          parts={def.items.map((e, i) => ({
            label: items.get(e.item)?.name ?? e.item,
            weight: e.weight,
            color: partColor(i),
          }))}
        />
        <div className="le-rows">
          <div className="le-row le-head">
            <span />
            <span>item</span>
            <span>weight</span>
            <span title="How many come in one pick: only for items that stack">count</span>
            <span title="The chance one pick is this">pick</span>
            <span title="The chance a container with only this table has at least one">
              in a container
            </span>
            <span title="Its worth in one pick: its value times its count">worth</span>
            <span />
          </div>
          {def.items.map((e, i) => {
            const st = stats.entries[i];
            const item = items.get(e.item);
            const max = item ? stackSize(item) : 1;
            return (
              <div
                key={`${i}-${e.item}`}
                className={`le-row${dragFrom === i ? ' le-dragging' : ''}`}
                onDragOver={(ev) => dragFrom !== null && ev.preventDefault()}
                onDrop={() => {
                  if (dragFrom === null || dragFrom === i) return;
                  const from = dragFrom;
                  edit((d) => {
                    const [moved] = rows(d).splice(from, 1);
                    rows(d).splice(i, 0, moved!);
                  });
                  setDragFrom(null);
                }}
              >
                <span
                  className="le-handle"
                  draggable
                  onDragStart={() => setDragFrom(i)}
                  onDragEnd={() => setDragFrom(null)}
                  title="Drag to reorder"
                >
                  <span className="ed-dot" style={{ background: partColor(i) }} />⠿
                </span>
                <ItemChip
                  items={items}
                  value={e.item}
                  onPick={(id) =>
                    edit((d) => {
                      put(d, ['items', i, 'item'], id);
                      // A count only for what stacks.
                      const to = items.get(id);
                      if (!to || stackSize(to) <= 1) put(d, ['items', i, 'count'], undefined);
                    })
                  }
                />
                <WeightSlider
                  value={e.weight}
                  begin={() => editor.beginGesture()}
                  onDrag={(v) => drag((d) => put(d, ['items', i, 'weight'], v))}
                  onChange={(v) => edit((d) => put(d, ['items', i, 'weight'], v))}
                />
                <span className="le-count" title={max > 1 ? `A full stack is ${max}` : undefined}>
                  {max > 1 ? (
                    <>
                      <Num
                        label=""
                        value={e.count?.[0] ?? 1}
                        min={0}
                        onChange={(v) =>
                          v !== undefined && setCount(i, v, Math.max(v, e.count?.[1] ?? v))
                        }
                      />
                      –
                      <Num
                        label=""
                        value={e.count?.[1] ?? 1}
                        min={0}
                        onChange={(v) =>
                          v !== undefined && setCount(i, Math.min(v, e.count?.[0] ?? v), v)
                        }
                      />
                    </>
                  ) : (
                    <span className="ed-note">1</span>
                  )}
                </span>
                <span className="le-odds">
                  <span className="le-bar">
                    <span style={{ width: pct(st?.pick ?? 0), background: partColor(i) }} />
                  </span>
                  {st ? pct(st.pick) : ''}
                </span>
                <span>{st ? pct(st.container) : ''}</span>
                <span className="le-value">{st ? money(st.value) : ''}</span>
                <button
                  disabled={def.items.length < 2}
                  onClick={() => edit((d) => rows(d).splice(i, 1))}
                  title="Take this item out"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div className="ed-row le-add">
          <button onClick={() => setAdding(true)}>+ add items…</button>
          {adding && (
            <ItemPicker
              items={items}
              taken={taken}
              multi
              onPick={(ids) =>
                edit((d) => {
                  for (const id of ids) {
                    const it = items.get(id);
                    rows(d).push({
                      item: id,
                      weight: 1,
                      ...(it && stackSize(it) > 1 && { count: [1, Math.min(stackSize(it), 10)] }),
                    });
                  }
                })
              }
              close={() => setAdding(false)}
            />
          )}
        </div>
      </section>
      <aside className="ie-side le-side">
        <div className="ie-card">
          <h4>worth</h4>
          <p className="le-big">
            {money(stats.perContainer)}
            <span className="ed-note"> a container, on average</span>
          </p>
          <p className="ed-note">
            {stats.rolls.toFixed(1)} items each; a loose spot is worth {money(stats.perPick)}.
          </p>
          <h4>rarity of a pick</h4>
          <ShareBar parts={rarity} />
        </div>
        {valid && (
          <RollPreview
            items={items}
            tables={s.tables}
            mix={{ tables: { [def.id]: 1 } }}
            kinds={kindsFor(s, def.id)}
          />
        )}
        <Uses title="used by" uses={lootTableUses(def.id)} editor={editor} none="Nothing yet." />
      </aside>
    </main>
  );
}

const PICK_W = 10;
const PICK_H = 8;

/** A grid's size picked by pointing at cells, as a table's size is in a word processor. */
function GridSizer(props: {
  value: readonly [number, number];
  onChange: (size: [number, number]) => void;
}) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [w, h] = hover ?? props.value;
  return (
    <div className="le-sizer-wrap">
      <div
        className="le-sizer"
        style={{ gridTemplateColumns: `repeat(${PICK_W}, 18px)` }}
        onPointerLeave={() => setHover(null)}
      >
        {Array.from({ length: PICK_W * PICK_H }, (_, i) => {
          const x = (i % PICK_W) + 1;
          const y = Math.floor(i / PICK_W) + 1;
          return (
            <span
              key={i}
              className={x <= w && y <= h ? (hover ? 'le-on le-hover' : 'le-on') : undefined}
              onPointerEnter={() => setHover([x, y])}
              onClick={() => props.onChange([x, y])}
            />
          );
        })}
      </div>
      <span className="le-big">
        {w}×{h}
      </span>
    </div>
  );
}

/** A kind of loot container: its name, grid, and the loot it has unless a map says else. */
function ContainerPage(props: {
  editor: LootEditor;
  state: LootEditorState;
  def: LootContainerDef;
}) {
  const { editor, state: s, def } = props;
  const items = loadItems();
  const edit = (change: (d: Doc) => void) => editor.edit(change);
  const tables = [...s.tables.keys()].sort();
  const valid = !s.problems.has(s.current) && !s.problem;
  const setLoot = (mix: LootMix | undefined, gesture = false) =>
    editor.edit((d) => put(d, ['loot'], mix), gesture);
  return (
    <main className="ie-main">
      <section className="ed-inspector ie-form le-form">
        <h3>{def.name}</h3>
        <p className="ed-note">content/loot-containers/{def.id}.json</p>
        <Text label="name" value={def.name} onChange={(v) => edit((d) => put(d, ['name'], v))} />
        <h4>size inside</h4>
        <GridSizer value={def.grid} onChange={(g) => edit((d) => put(d, ['grid'], g))} />
        <div className="ed-row le-size">
          <Num
            label="width"
            value={def.grid[0]}
            min={1}
            onChange={(v) => v && edit((d) => put(d, ['grid', 0], Math.round(v)))}
          />
          <Num
            label="height"
            value={def.grid[1]}
            min={1}
            onChange={(v) => v && edit((d) => put(d, ['grid', 1], Math.round(v)))}
          />
        </div>
        <h4>loot</h4>
        <p className="ed-note">
          What every {def.name} is filled from, unless the map editor gives one its own.
        </p>
        {def.loot ? (
          <>
            <MixFields
              mix={def.loot}
              tables={tables}
              onChange={(mix) => setLoot(mix)}
              onDrag={(mix) => setLoot(mix, true)}
              begin={() => editor.beginGesture()}
              open={(t) => editor.select(fileKey('table', t))}
            />
            <button onClick={() => setLoot(undefined)} title="Every one placed then needs its own">
              No default loot
            </button>
          </>
        ) : (
          <div className="ed-row">
            <span className="ed-note">
              None: every one placed needs loot set in the map editor.
            </span>
            <button onClick={() => setLoot({ tables: { [tables[0] ?? 'household']: 1 } })}>
              Give it loot
            </button>
          </div>
        )}
      </section>
      <aside className="ie-side le-side">
        {def.loot && valid && (
          <RollPreview items={items} tables={s.tables} mix={def.loot} kinds={[def]} />
        )}
        <Uses title="placed" uses={lootContainerUses(def.id)} editor={editor} none="Nowhere yet." />
      </aside>
    </main>
  );
}

function NewFile(props: {
  editor: LootEditor;
  state: LootEditorState;
  kind: LootFileKind;
  copy: boolean;
  close: () => void;
}) {
  const { state: s, kind, copy } = props;
  const from = (kind === 'table' ? s.tables : s.containers).get(parseKey(s.current).id);
  const [name, setName] = useState(copy && from ? `${from.name} 2` : '');
  const [id, setId] = useState(copy && from ? `${from.id}-2` : '');
  // The id follows the name until it's typed itself.
  const [idTyped, setIdTyped] = useState(copy);
  const what = kind === 'table' ? 'loot table' : 'container';
  const idProblem = !id
    ? 'needs an id'
    : !idSchema.safeParse(id).success
      ? 'ids are lower-case letters, digits and dashes'
      : (kind === 'table' ? s.tables : s.containers).has(id)
        ? `that ${what} exists`
        : null;
  const make = (): void => {
    if (idProblem || !name.trim()) return;
    props.editor.create(kind, id, name.trim(), copy ? s.current : undefined);
    props.close();
  };
  const slug = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return (
    <div className="ed-modal" onKeyDown={(e) => e.key === 'Escape' && props.close()}>
      <div className="ed-inspector">
        <h3>{copy ? `copy ${from?.name}` : `new ${what}`}</h3>
        <label className="ed-field">
          name
          <input
            value={name}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              if (!idTyped) setId(slug(e.target.value));
            }}
            onKeyDown={(e) => e.key === 'Enter' && make()}
          />
        </label>
        <label className="ed-field">
          id
          <input
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setIdTyped(true);
            }}
            onKeyDown={(e) => e.key === 'Enter' && make()}
          />
        </label>
        <p className="ed-note">
          The file is content/{kind === 'table' ? 'loot-tables' : 'loot-containers'}/{id || '<id>'}
          .json; the id can&apos;t be changed here later.
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
