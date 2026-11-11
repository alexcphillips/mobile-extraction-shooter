import { objectiveText, stackSize, type QuestObjective, type VendorDef } from '@mes/shared';
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Num, Text } from '../editor/fields';
import { ItemChip, ItemPicker } from '../loot-editor/item-picker';
import {
  ancestors,
  canRequire,
  descendants,
  layoutChains,
  rewireForDelete,
  unlocks,
} from './chain';
import type { QuestDoc, QuestEditor, QuestEditorState } from './editor';

/*
 * The quest editor's page (2026-11-11): the chains as a lane per vendor, left to right in
 * the order they open, an arrow from each quest to those it unlocks (in the giving vendor's
 * color when it crosses to another vendor). Dragging from a card's right-hand dot onto
 * another card makes that one need it. The open quest's form is on the right; picking a
 * quest lights up everything before and after it in its chains.
 */

const CARD_W = 210;
const CARD_H = 74;
const COL_GAP = 56;
const ROW_GAP = 12;
const LANE_PAD = 14;
const HEAD_W = 150;

/** When a link drag last ended: the click that follows it isn't a click on the background. */
let droppedAt = 0;

/** A click on the background closes the open quest, unless it ends a drag. */
const deselect = (editor: QuestEditor, e: React.MouseEvent): void => {
  if (e.target === e.currentTarget && performance.now() - droppedAt > 250) editor.select('');
};

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const GRAY = '#8a939e';

type Objective = QuestObjective;
const TYPES: [Objective['type'], string][] = [
  ['investigate', 'Investigate'],
  ['handOver', 'Hand over'],
  ['extract', 'Extract'],
];

export function QuestEditorPanel({ editor }: { editor: QuestEditor }) {
  const s = useSyncExternalStore(editor.subscribe, editor.getState);
  const [filter, setFilter] = useState('');
  const open = s.quests.get(s.current);
  const firstVendor = [...editor.world.vendors.keys()][0] ?? '';
  const status = s.message ?? (s.problem ? `Problem: ${s.problem}` : null);
  return (
    <div className="qe">
      <header className="qe-bar">
        <button
          className={s.unsaved.length ? 'ed-save ed-dirty' : 'ed-save'}
          disabled={s.saving}
          onClick={() => void editor.save()}
          title={s.unsaved.length ? `⌘S: ${s.unsaved.join(', ')}` : '⌘S'}
        >
          {s.saving
            ? 'Saving…'
            : s.unsaved.length
              ? `Save ${s.unsaved.length} quest${s.unsaved.length === 1 ? '' : 's'}`
              : 'Saved'}
        </button>
        <button onClick={() => editor.undo()} disabled={!s.canUndo} title="⌘Z">
          Undo
        </button>
        <button onClick={() => editor.redo()} disabled={!s.canRedo} title="⇧⌘Z">
          Redo
        </button>
        <button onClick={() => editor.create({ vendor: open?.vendor ?? firstVendor })}>
          + New quest
        </button>
        <input
          className="qe-filter"
          placeholder="Find a quest, item or map"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="qe-count">{s.quests.size} quests</span>
        <nav className="qe-nav">
          <a className="ie-link" href="/editor">
            Map editor
          </a>
          <a className="ie-link" href="/item-editor">
            Item editor
          </a>
          <a className="ie-link" href="/loot-editor">
            Loot editor
          </a>
        </nav>
      </header>
      <div className="qe-body">
        <ChainView editor={editor} state={s} filter={filter} />
        {open && <QuestForm key={s.current} editor={editor} state={s} quest={open} />}
      </div>
      <div className={s.problem && !s.message ? 'ed-status ed-problem' : 'ed-status'}>
        {status ??
          'Click a quest to edit it. Drag from a quest’s dot onto another to make it unlock that one. ⌘S saves every changed quest; nothing saves while something is wrong.'}
      </div>
    </div>
  );
}

/** A vendor's color, or gray. */
const colorOfVendor = (v: VendorDef | undefined): string => v?.color ?? GRAY;

function ChainView(props: { editor: QuestEditor; state: QuestEditorState; filter: string }) {
  const { editor, state: s } = props;
  const { vendors, items } = editor.world;
  const layout = useMemo(() => layoutChains(s.quests, [...vendors.keys()]), [s.quests, vendors]);
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Lane tops in pixels.
  const laneTop = new Map<string, number>();
  let y = 0;
  for (const lane of layout.lanes) {
    laneTop.set(lane.vendor, y);
    y += lane.rows * (CARD_H + ROW_GAP) - ROW_GAP + LANE_PAD * 2;
  }
  const height = y;
  const width = HEAD_W + LANE_PAD + layout.cols * (CARD_W + COL_GAP);
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of layout.cards) {
    const q = s.quests.get(c.id)!;
    const lane = layout.lanes.find((l) => l.vendor === q.vendor)!;
    pos.set(c.id, {
      x: HEAD_W + LANE_PAD + c.col * (CARD_W + COL_GAP),
      y: laneTop.get(q.vendor)! + LANE_PAD + (c.row - lane.row) * (CARD_H + ROW_GAP),
    });
  }

  // What lights up: the open quest's chains.
  const focus = s.current || hover;
  const lit = useMemo(() => {
    if (!focus || !s.quests.has(focus)) return null;
    return new Set([focus, ...ancestors(s.quests, focus), ...descendants(s.quests, focus)]);
  }, [focus, s.quests]);
  const f = props.filter.trim().toLowerCase();
  const matches = (q: QuestDoc): boolean =>
    !f ||
    q.name.toLowerCase().includes(f) ||
    q.id.includes(f) ||
    q.description.toLowerCase().includes(f) ||
    q.objectives.some(
      (o) =>
        (o.type !== 'investigate' &&
          (items.get(o.item)?.name.toLowerCase().includes(f) ?? false)) ||
        (o.type !== 'handOver' && o.map.includes(f)),
    );

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const drop = (e: React.PointerEvent) => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-quest]');
    const to = el?.getAttribute('data-quest');
    setDrag(null);
    droppedAt = performance.now();
    if (to && to !== drag.from) editor.require(to, drag.from);
  };

  const edges: ReactNode[] = [];
  for (const q of s.quests.values()) {
    const to = pos.get(q.id);
    if (!to) continue;
    for (const r of q.requires ?? []) {
      const from = pos.get(r);
      const req = s.quests.get(r);
      if (!from || !req) continue;
      const cross = req.vendor !== q.vendor;
      const on = lit?.has(q.id) && lit.has(r);
      const x1 = from.x + CARD_W;
      const y1 = from.y + CARD_H / 2;
      const x2 = to.x - 6;
      const y2 = to.y + CARD_H / 2;
      const bend = Math.max(30, (x2 - x1) / 2);
      const color = on ? '#ff8c00' : cross ? colorOfVendor(vendors.get(req.vendor)) : GRAY;
      edges.push(
        <g key={`${r}>${q.id}`} opacity={lit && !on ? 0.18 : 1}>
          <path
            d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`}
            fill="none"
            stroke={color}
            strokeWidth={cross || on ? 2.5 : 1.5}
            strokeDasharray={cross ? '6 4' : undefined}
          >
            <title>
              {req.name} unlocks {q.name}
            </title>
          </path>
          <path d={`M${x2},${y2 - 5} L${x2 + 6},${y2} L${x2},${y2 + 5} Z`} fill={color} />
        </g>,
      );
    }
  }

  return (
    <div
      className="qe-chains"
      onPointerMove={(e) => drag && setDrag({ from: drag.from, ...local(e) })}
      onPointerUp={drop}
      onClick={(e) => deselect(editor, e)}
    >
      <div
        className="qe-canvas"
        ref={box}
        style={{ width, height }}
        onClick={(e) => deselect(editor, e)}
      >
        {layout.lanes.map((lane, i) => (
          <Lane
            key={lane.vendor}
            editor={editor}
            state={s}
            vendor={lane.vendor}
            top={laneTop.get(lane.vendor)!}
            height={lane.rows * (CARD_H + ROW_GAP) - ROW_GAP + LANE_PAD * 2}
            width={width}
            odd={i % 2 === 1}
          />
        ))}
        <svg className="qe-edges" width={width} height={height}>
          {edges}
          {drag && pos.get(drag.from) && (
            <line
              x1={pos.get(drag.from)!.x + CARD_W}
              y1={pos.get(drag.from)!.y + CARD_H / 2}
              x2={drag.x}
              y2={drag.y}
              stroke="#ff8c00"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          )}
        </svg>
        {layout.cards.map((c) => {
          const q = s.quests.get(c.id)!;
          const p = pos.get(c.id)!;
          const dropOk = drag ? canRequire(s.quests, c.id, drag.from) : null;
          const cls = [
            'qe-card',
            c.id === s.current && 'qe-open',
            lit && !lit.has(c.id) && 'qe-dim',
            f && !matches(q) && 'qe-dim',
            f && matches(q) && 'qe-match',
            s.problems.has(c.id) && 'qe-bad',
            drag && c.id !== drag.from && (dropOk ? 'qe-drop-ok' : 'qe-drop-no'),
          ]
            .filter(Boolean)
            .join(' ');
          const rep = q.rewards?.rep ?? 0;
          const rewardItems = q.rewards?.items?.length ?? 0;
          return (
            <div
              key={c.id}
              data-quest={c.id}
              className={cls}
              style={{
                left: p.x,
                top: p.y,
                width: CARD_W,
                height: CARD_H,
                borderLeftColor: colorOfVendor(vendors.get(q.vendor)),
              }}
              onClick={() => editor.select(c.id)}
              onPointerEnter={() => setHover(c.id)}
              onPointerLeave={() => setHover((h) => (h === c.id ? null : h))}
              title={s.problems.get(c.id) ?? q.description}
            >
              <div className="qe-card-name">
                {s.problems.has(c.id) && <span className="qe-warn">⚠ </span>}
                {s.unsaved.includes(c.id) && <span className="ie-dot">● </span>}
                {q.name}
              </div>
              <div className="qe-card-line">
                {q.objectives.length === 1
                  ? safeText(editor, q.objectives[0]!)
                  : `${q.objectives.length} objectives`}
              </div>
              <div className="qe-card-line qe-card-reward">
                {[
                  (q.rewards?.money ?? 0) > 0 && money(q.rewards!.money!),
                  rep > 0 && `+${rep} rep`,
                  rewardItems > 0 && `${rewardItems} item${rewardItems === 1 ? '' : 's'}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'no reward'}
              </div>
              <span
                className="qe-handle"
                title="Drag onto a quest this one unlocks"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setDrag({ from: c.id, ...local(e) });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** An objective's line, or what's wrong with it (a missing item). */
function safeText(editor: QuestEditor, o: Objective): string {
  try {
    return objectiveText(editor.world.items, o);
  } catch {
    return o.type === 'investigate' ? o.text : `(no item "${o.item}")`;
  }
}

/** A vendor's lane: its name, how many quests and how much rep they give, and a + button. */
function Lane(props: {
  editor: QuestEditor;
  state: QuestEditorState;
  vendor: string;
  top: number;
  height: number;
  width: number;
  odd: boolean;
}) {
  const { editor, vendor } = props;
  const v = editor.world.vendors.get(vendor);
  const mine = [...props.state.quests.values()].filter((q) => q.vendor === vendor);
  const rep = Math.round(mine.reduce((n, q) => n + (q.rewards?.rep ?? 0), 0) * 1000) / 1000;
  const top = v?.levels.at(-1)?.rep;
  return (
    <div
      className={props.odd ? 'qe-lane qe-odd' : 'qe-lane'}
      style={{ top: props.top, height: props.height, width: props.width }}
      onClick={(e) => deselect(editor, e)}
    >
      <div className="qe-lane-head" style={{ borderLeftColor: colorOfVendor(v) }}>
        <div className="qe-lane-name" style={{ color: colorOfVendor(v) }}>
          {v?.name ?? `${vendor} (no such vendor)`}
        </div>
        <div className="qe-lane-sub">
          {mine.length} quest{mine.length === 1 ? '' : 's'}
        </div>
        <div
          className={top !== undefined && rep < top ? 'qe-lane-sub qe-short' : 'qe-lane-sub'}
          title={top !== undefined ? `Level IV needs ${top} rep` : undefined}
        >
          {rep} rep{top !== undefined && ` / ${top} for IV`}
        </div>
        {v && (
          <button className="qe-lane-add" onClick={() => editor.create({ vendor })}>
            + quest
          </button>
        )}
      </div>
    </div>
  );
}

function Card(props: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="ie-card qe-section">
      <h4>
        {props.title}
        {props.extra && <span className="qe-h-extra">{props.extra}</span>}
      </h4>
      {props.children}
    </section>
  );
}

function QuestForm(props: { editor: QuestEditor; state: QuestEditorState; quest: QuestDoc }) {
  const { editor, state: s, quest: q } = props;
  const { vendors, items, markers } = editor.world;
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  const problem = s.problems.get(q.id);
  const requires = q.requires ?? [];
  const unlocked = unlocks(s.quests, q.id);
  const rewards = { money: 0, items: [], rep: 0, ...q.rewards };
  const vendorName = (id: string) => vendors.get(id)?.name ?? id;
  const mayRequire = [...s.quests.values()]
    .filter((o) => canRequire(s.quests, q.id, o.id))
    .sort(
      (a, b) =>
        vendorName(a.vendor).localeCompare(vendorName(b.vendor)) || a.name.localeCompare(b.name),
    );

  const QuestChip = ({ id, onRemove }: { id: string; onRemove?: () => void }) => {
    const other = s.quests.get(id);
    return (
      <span
        className="qe-qchip"
        style={{ borderColor: colorOfVendor(vendors.get(other?.vendor ?? '')) }}
      >
        <button className="qe-qchip-name" onClick={() => editor.select(id)} title="Open it">
          {other?.name ?? `${id} (missing)`}
          <span className="qe-qchip-vendor">{vendorName(other?.vendor ?? '')}</span>
        </button>
        {onRemove && (
          <button className="qe-x" onClick={onRemove} title="Remove">
            ×
          </button>
        )}
      </span>
    );
  };

  const rewired = confirming ? rewireForDelete(s.quests, q.id) : null;
  return (
    <aside className="qe-form ie-form">
      <div className="ie-head">
        <div className="ie-head-name">
          <Text
            label="Name"
            value={q.name}
            onChange={(v) => v && editor.edit((d) => (d.name = v))}
          />
          <div
            className="ed-note"
            title="Quests are linked and saved by this id, so it never changes"
          >
            id {q.id} · fixed, so renaming is safe
          </div>
        </div>
        <button onClick={() => editor.select('')} title="Close (Esc)">
          ×
        </button>
      </div>
      {problem && <div className="qe-problem">{problem}</div>}

      <div className="qe-actions">
        <button onClick={() => editor.create({ vendor: q.vendor, after: q.id })}>
          + Quest it unlocks
        </button>
        <button onClick={() => editor.create({ vendor: q.vendor, from: q.id })}>Copy</button>
        <button className="qe-danger" onClick={() => setConfirming(true)}>
          Delete…
        </button>
      </div>
      {confirming && rewired && (
        <div className="qe-confirm">
          <div>
            Delete <b>{q.name}</b>?
            {rewired.size > 0 ? (
              <>
                {' '}
                {[...rewired.keys()].map((d) => editor.name(d)).join(', ')} will open{' '}
                {requires.length
                  ? `after ${requires.map((r) => editor.name(r)).join(' and ')} instead`
                  : 'from the start instead'}
                , so the chain stays in order.
              </>
            ) : (
              ' Nothing needs it.'
            )}{' '}
            Players’ progress on it is just ignored. You can undo this until you save.
          </div>
          <div className="qe-actions">
            <button className="qe-danger" onClick={() => editor.remove(q.id)}>
              Delete
            </button>
            <button onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      <Card title="Given by">
        <div className="qe-seg">
          {[...vendors.values()].map((v) => (
            <button
              key={v.id}
              className={q.vendor === v.id ? 'ed-on' : undefined}
              style={
                q.vendor === v.id
                  ? { borderColor: colorOfVendor(v), color: colorOfVendor(v) }
                  : undefined
              }
              onClick={() => editor.edit((d) => (d.vendor = v.id))}
            >
              <span className="qe-dot" style={{ background: colorOfVendor(v) }} />
              {v.name}
            </button>
          ))}
        </div>
        <TextArea
          label="Description (what they say)"
          value={q.description}
          onChange={(v) => v && editor.edit((d) => (d.description = v))}
        />
      </Card>

      <Card title="Chain">
        <div className="qe-label">Opens after</div>
        <div className="qe-chips">
          {requires.map((r) => (
            <QuestChip key={r} id={r} onRemove={() => editor.unrequire(q.id, r)} />
          ))}
          {!requires.length && <span className="ed-note">Open from the start</span>}
          {adding ? (
            <select
              autoFocus
              value=""
              onBlur={() => setAdding(false)}
              onChange={(e) => {
                if (e.target.value) editor.require(q.id, e.target.value);
                setAdding(false);
              }}
            >
              <option value="">Pick a quest…</option>
              {mayRequire.map((o) => (
                <option key={o.id} value={o.id}>
                  {vendorName(o.vendor)}: {o.name}
                </option>
              ))}
            </select>
          ) : (
            <button
              className="qe-add"
              onClick={() => setAdding(true)}
              disabled={!mayRequire.length}
            >
              + requirement
            </button>
          )}
        </div>
        <div className="qe-label">Unlocks</div>
        <div className="qe-chips">
          {unlocked.map((d) => (
            <QuestChip key={d} id={d} onRemove={() => editor.unrequire(d, q.id)} />
          ))}
          {!unlocked.length && <span className="ed-note">Nothing yet</span>}
        </div>
      </Card>

      <Card
        title="Objectives"
        extra={
          <span className="qe-add-row">
            {TYPES.map(([t, label]) => (
              <button key={t} className="qe-add" onClick={() => editor.addObjective(t)}>
                + {label}
              </button>
            ))}
          </span>
        }
      >
        {q.objectives.map((o, i) => (
          <ObjectiveCard
            key={o.id}
            editor={editor}
            o={o}
            index={i}
            count={q.objectives.length}
            markers={markers}
          />
        ))}
      </Card>

      <Card title="Rewards">
        <div className="ed-row qe-rewards">
          <Num
            label="Money ($)"
            value={rewards.money}
            min={0}
            onChange={(v) =>
              editor.edit((d) => (d.rewards = { ...rewards, money: Math.round(v ?? 0) }))
            }
          />
          <Num
            label={`Rep with ${vendorName(q.vendor)}`}
            value={rewards.rep}
            min={0}
            onChange={(v) => editor.edit((d) => (d.rewards = { ...rewards, rep: v ?? 0 }))}
          />
        </div>
        <RepHint editor={editor} state={s} quest={q} />
        <div className="qe-label">Items</div>
        {rewards.items.map((r, i) => {
          const def = items.get(r.item);
          const max = def ? stackSize(def) : 1;
          const setItems = (next: typeof rewards.items) =>
            editor.edit((d) => (d.rewards = { ...rewards, items: next }));
          return (
            <div key={`${r.item}-${i}`} className="qe-reward-row">
              <ItemChip
                items={rewardable(items)}
                value={r.item}
                onPick={(id) =>
                  setItems(rewards.items.map((x, j) => (j === i ? { ...x, item: id } : x)))
                }
              />
              {max > 1 && (
                <Num
                  label="×"
                  value={r.count ?? 1}
                  min={1}
                  onChange={(v) =>
                    setItems(
                      rewards.items.map((x, j) => {
                        if (j !== i) return x;
                        const count = Math.min(max, Math.max(1, Math.round(v ?? 1)));
                        return count === 1 ? { item: x.item } : { ...x, count };
                      }),
                    )
                  }
                />
              )}
              <button
                className="qe-x"
                onClick={() => setItems(rewards.items.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          );
        })}
        <AddItems
          items={rewardable(items)}
          onPick={(ids) =>
            editor.edit(
              (d) =>
                (d.rewards = {
                  ...rewards,
                  items: [...rewards.items, ...ids.map((item) => ({ item }))],
                }),
            )
          }
        />
      </Card>
    </aside>
  );
}

/** How the vendor's quests add up toward its levels. */
function RepHint(props: { editor: QuestEditor; state: QuestEditorState; quest: QuestDoc }) {
  const v = props.editor.world.vendors.get(props.quest.vendor);
  if (!v) return null;
  const total =
    Math.round(
      [...props.state.quests.values()]
        .filter((q) => q.vendor === v.id)
        .reduce((n, q) => n + (q.rewards?.rep ?? 0), 0) * 1000,
    ) / 1000;
  return (
    <div className="ed-note">
      {v.name}’s quests give {total} rep in all; levels II–IV need{' '}
      {v.levels.map((l) => l.rep).join(' / ')}.
    </div>
  );
}

// Filtered item lists, made once per item db.
const filtered = new WeakMap<object, Map<string, ReturnType<typeof filterItems>>>();
function filterItems(
  items: QuestEditor['world']['items'],
  keep: (t: string, value: number) => boolean,
) {
  return new Map([...items].filter(([, d]) => keep(d.type, d.value)));
}
function cachedFilter(
  items: QuestEditor['world']['items'],
  key: string,
  keep: (t: string, v: number) => boolean,
) {
  let m = filtered.get(items);
  if (!m) filtered.set(items, (m = new Map()));
  let out = m.get(key);
  if (!out) m.set(key, (out = filterItems(items, keep)));
  return out;
}
const rewardable = (items: QuestEditor['world']['items']) =>
  cachedFilter(items, 'reward', (t) => t !== 'quest');
const handable = (items: QuestEditor['world']['items']) =>
  cachedFilter(items, 'hand', (t) => t !== 'quest' && t !== 'melee');
const questItems = (items: QuestEditor['world']['items']) =>
  cachedFilter(items, 'quest', (t) => t === 'quest');

function AddItems(props: {
  items: QuestEditor['world']['items'];
  onPick: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="le-chip-wrap">
      <button className="qe-add" onClick={() => setOpen(true)}>
        + item
      </button>
      {open && (
        <ItemPicker items={props.items} multi onPick={props.onPick} close={() => setOpen(false)} />
      )}
    </span>
  );
}

function ObjectiveCard(props: {
  editor: QuestEditor;
  o: Objective;
  index: number;
  count: number;
  markers: ReadonlyMap<string, readonly string[]>;
}) {
  const { editor, o, index, markers } = props;
  const { items } = editor.world;
  const set = (change: (o: Objective) => void) => editor.editObjective(index, change);
  const move = (by: number) =>
    editor.edit((d) => {
      const [x] = d.objectives.splice(index, 1);
      d.objectives.splice(index + by, 0, x!);
    });
  const maps = [...markers.keys()];
  const mapPick = (o: Objective & { map: string }) => (
    <label className="ed-field">
      Map
      <select
        value={o.map}
        onChange={(e) =>
          set((x) => {
            if (x.type === 'handOver') return;
            x.map = e.target.value;
            const first = markers.get(x.map)?.[0] ?? '';
            if (x.type === 'investigate') x.marker = first;
            else x.spots = first ? [first] : [];
          })
        }
      >
        {!maps.includes(o.map) && <option value={o.map}>{o.map} (missing)</option>}
        {maps.map((m) => (
          <option key={m} value={m}>
            {m} ({markers.get(m)!.length} quest markers)
          </option>
        ))}
      </select>
    </label>
  );
  const onMap = o.type === 'handOver' ? [] : (markers.get(o.map) ?? []);
  return (
    <div className="qe-objective">
      <div className="qe-obj-head">
        <div className="qe-seg">
          {TYPES.map(([t, label]) => (
            <button
              key={t}
              className={o.type === t ? 'ed-on' : undefined}
              onClick={() => editor.retypeObjective(index, t)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="qe-obj-tools">
          <button onClick={() => move(-1)} disabled={index === 0} title="Up">
            ↑
          </button>
          <button onClick={() => move(1)} disabled={index === props.count - 1} title="Down">
            ↓
          </button>
          <button
            className="qe-x"
            onClick={() => editor.edit((d) => d.objectives.splice(index, 1))}
            disabled={props.count === 1}
            title={props.count === 1 ? 'A quest needs at least one objective' : 'Remove'}
          >
            ×
          </button>
        </span>
      </div>

      {o.type === 'investigate' && (
        <>
          {mapPick(o)}
          <label className="ed-field">
            Quest marker (placed in the map editor)
            <select
              value={o.marker}
              onChange={(e) => set((x) => x.type === 'investigate' && (x.marker = e.target.value))}
            >
              {!onMap.includes(o.marker) && (
                <option value={o.marker}>{o.marker || '—'} (missing)</option>
              )}
              {onMap.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <Text
            label="Text (what the quests page says)"
            value={o.text}
            onChange={(v) => v && set((x) => (x.text = v))}
          />
        </>
      )}

      {o.type === 'handOver' && (
        <>
          <div className="ed-row qe-obj-row">
            <span className="ed-field">
              Item
              <ItemChip
                items={handable(items)}
                value={o.item}
                onPick={(id) => set((x) => x.type === 'handOver' && (x.item = id))}
              />
            </span>
            <Num
              label="Count"
              value={o.count}
              min={1}
              onChange={(v) =>
                set((x) => x.type === 'handOver' && (x.count = Math.max(1, Math.round(v ?? 1))))
              }
            />
            <label className="qe-check">
              <input
                type="checkbox"
                checked={o.foundInRaid === true}
                onChange={(e) =>
                  set((x) => {
                    if (x.type !== 'handOver') return;
                    if (e.target.checked) x.foundInRaid = true;
                    else delete x.foundInRaid;
                  })
                }
              />
              Found in raid only
            </label>
          </div>
          <OptionalText editor={editor} o={o} set={set} />
        </>
      )}

      {o.type === 'extract' && (
        <>
          <span className="ed-field">
            Quest item (spawns only while the quest is active)
            <ItemChip
              items={questItems(items)}
              value={o.item}
              onPick={(id) => set((x) => x.type === 'extract' && (x.item = id))}
            />
          </span>
          {mapPick(o)}
          <div className="ed-field">
            Spots it can spawn at (one picked at random each raid)
            <div className="qe-chips">
              {[...new Set([...onMap, ...o.spots])].map((m) => (
                <button
                  key={m}
                  className={o.spots.includes(m) ? 'ed-on' : undefined}
                  title={onMap.includes(m) ? undefined : 'Not on this map'}
                  onClick={() =>
                    set((x) => {
                      if (x.type !== 'extract') return;
                      x.spots = x.spots.includes(m)
                        ? x.spots.filter((y) => y !== m)
                        : [...x.spots, m];
                    })
                  }
                >
                  {m}
                  {!onMap.includes(m) && ' ⚠'}
                </button>
              ))}
              {!onMap.length && <span className="ed-note">No quest markers on this map yet</span>}
            </div>
          </div>
          <Text
            label="Find step (optional, shown first; ticks while carrying it)"
            value={o.find ?? ''}
            placeholder="none"
            onChange={(v) =>
              set((x) => {
                if (x.type !== 'extract') return;
                if (v) x.find = v;
                else delete x.find;
              })
            }
          />
          <OptionalText editor={editor} o={o} set={set} />
        </>
      )}
    </div>
  );
}

/** An objective's own text, blank for its default (shown grayed). */
function OptionalText(props: {
  editor: QuestEditor;
  o: Objective;
  set: (c: (o: Objective) => void) => void;
}) {
  const { o } = props;
  const fallback = safeText(props.editor, { ...o, text: undefined } as Objective);
  return (
    <Text
      label="Text"
      value={o.text ?? ''}
      placeholder={fallback}
      onChange={(v) =>
        props.set((x) => {
          if (v) x.text = v;
          else delete x.text;
        })
      }
    />
  );
}

/** A text box over several lines, committed when it's left. */
function TextArea(props: { label: string; value: string; onChange: (v: string) => void }) {
  return <TextAreaInput key={props.value} {...props} />;
}

function TextAreaInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(props.value);
  return (
    <label className="ed-field qe-textarea">
      {props.label}
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== props.value && props.onChange(text.trim())}
      />
    </label>
  );
}
