import { heightAt, type LayoutDef } from '@mes/shared';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { TOOL_KEYS, travelTimes, type Kind, type LayoutBoard, type Raw, type Tool } from './board';

/* The layout board's side panel (MK-3): tools, the selected piece's fields, the map's. */

const TOOLS: [Tool, string][] = [
  ['select', 'Select'],
  ['area', 'Area'],
  ['pad', 'Pad'],
  ['landmark', 'Landmark'],
  ['road', 'Road'],
  ['zone', 'Zone'],
  ['entrance', 'Way in'],
  ['rings', 'Rings'],
];
const KEY_OF = Object.fromEntries(Object.entries(TOOL_KEYS).map(([k, t]) => [t, k]));
const KINDS: [Kind, string][] = [
  ['areas', 'Areas'],
  ['pads', 'Pads'],
  ['roads', 'Roads'],
  ['landmarks', 'Landmarks'],
  ['zones', 'Zones'],
];
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function LayoutPanel({ board }: { board: LayoutBoard }): ReactNode {
  const s = useSyncExternalStore(board.subscribe, board.getState);
  const sel = s.selected;
  const raw = sel ? board.piece(sel.kind, sel.id) : undefined;
  return (
    <div className="lb-panel">
      <div className="lb-row lb-head">
        <strong>Layout: {board.id}</strong>
        <span className="lb-grow" />
        <button disabled={!s.canUndo} onClick={() => board.undo()} title="Undo (⌘Z)">
          ↶
        </button>
        <button disabled={!s.canRedo} onClick={() => board.redo()} title="Redo (⇧⌘Z)">
          ↷
        </button>
        <button
          disabled={s.saving || !!s.problem}
          onClick={() => void board.save()}
          title="Save (⌘S)"
        >
          {s.dirty ? 'Save •' : 'Saved'}
        </button>
      </div>
      {s.problem && <div className="lb-problem">{s.problem}</div>}
      {s.message && <div className="lb-message">{s.message}</div>}
      <div className="lb-tools">
        {TOOLS.map(([t, label]) => (
          <button
            key={t}
            className={s.tool === t ? 'ed-on' : ''}
            onClick={() => board.setTool(t)}
            title={`Key ${KEY_OF[t]}`}
          >
            {label}
          </button>
        ))}
      </div>
      <Readout board={board} />
      {sel && raw ? (
        <PieceFields
          board={board}
          kind={sel.kind}
          raw={raw}
          layout={s.layout}
          key={`${sel.kind}:${sel.id}`}
        />
      ) : (
        <MapFields board={board} />
      )}
      <PieceList board={board} />
      <p className="lb-keys">
        Wheel zooms, F fits, drag empty ground (or right-drag) pans. Alt drags free of the grid;
        Shift turns in 15° steps. Arrows nudge (Shift ×10), ⌘D duplicates, Delete removes.
        Double-click a piece to ring it.
      </p>
    </div>
  );
}

function Readout({ board }: { board: LayoutBoard }): ReactNode {
  const { cursor, rings } = board.getState();
  if (!cursor) return <div className="lb-readout">&nbsp;</div>;
  const t = rings && travelTimes(rings, cursor);
  return (
    <div className="lb-readout">
      x {f1(cursor.x)} · z {f1(cursor.z)} · ground {f1(cursor.y)} m
      {t && (
        <>
          <br />
          from the rings: {Math.round(t.meters)} m, walk {Math.round(t.walk)} s, sprint{' '}
          {Math.round(t.sprint)} s (straight line)
        </>
      )}
    </div>
  );
}

function PieceFields({
  board,
  kind,
  raw,
  layout,
}: {
  board: LayoutBoard;
  kind: Kind;
  raw: Raw;
  layout: LayoutDef;
}): ReactNode {
  const id = String(raw.id);
  const merge = (k: string) => `field:${id}:${k}`;
  const num = (
    k: string,
    label: string,
    opts: { optional?: boolean; placeholder?: string; step?: number } = {},
  ) => (
    <NumField
      label={label}
      value={raw[k] as number | undefined}
      placeholder={opts.placeholder}
      step={opts.step}
      onSet={(v) =>
        v === undefined && !opts.optional ? undefined : board.edit({ [k]: v }, merge(k))
      }
    />
  );
  const text = (k: string, label: string) => (
    <TextField
      label={label}
      value={(raw[k] as string | undefined) ?? ''}
      onSet={(v) => board.edit({ [k]: v || undefined }, merge(k))}
    />
  );
  const pick = (k: string, label: string, options: string[], fallback: string) => (
    <label className="lb-field">
      <span>{label}</span>
      <select
        value={(raw[k] as string | undefined) ?? fallback}
        onChange={(e) => board.edit({ [k]: e.target.value })}
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
  const area = kind === 'areas' ? layout.areas.find((a) => a.id === id) : undefined;
  return (
    <section className="lb-section">
      <h3>
        {kind.slice(0, -1)} <code>{id}</code>
      </h3>
      <TextField
        label="id"
        value={id}
        onSet={(v) => {
          if (v && v !== id && !board.piece(kind, v)) board.edit({ id: v });
        }}
      />
      {text('name', 'name')}
      {kind !== 'roads' && kind !== 'zones' && (
        <div className="lb-grid">
          {num('x', 'x')}
          {num('z', 'z')}
          {num('w', 'width')}
          {num('d', 'depth')}
          {num('yaw', 'yaw °', { optional: true, placeholder: '0' })}
        </div>
      )}
      {kind === 'pads' && (
        <div className="lb-grid">
          {num('y', 'height')}
          {pick('edge', 'edge', ['bank', 'wall'], 'bank')}
          {num('blend', 'bank m', { optional: true, placeholder: '6' })}
        </div>
      )}
      {kind === 'landmarks' && <div className="lb-grid">{num('height', 'height')}</div>}
      {kind === 'roads' && (
        <div className="lb-grid">
          {pick('kind', 'kind', ['road', 'service', 'path'], 'road')}
          {num('width', 'width', { optional: true, placeholder: '7' })}
          <span className="lb-dim">{(raw.points as unknown[]).length} points</span>
        </div>
      )}
      {kind === 'zones' && (
        <span className="lb-dim">{(raw.points as unknown[]).length} corners</span>
      )}
      {kind === 'areas' && area && (
        <>
          <div className="lb-grid">
            <label className="lb-field">
              <span>poi</span>
              <select
                value={(raw.poi as string | undefined) ?? ''}
                onChange={(e) => board.edit({ poi: e.target.value || undefined })}
              >
                <option value="">(none)</option>
                {Object.entries(layout.pois).map(([p, v]) => (
                  <option key={p} value={p}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            {pick('tier', 'depth', ['full', 'partial', 'facade'], 'full')}
            {num('y', 'floor y', {
              optional: true,
              placeholder: f1(heightAt(layout, area.x, area.z)),
            })}
            {num('floors', 'floors', { optional: true, placeholder: '1' })}
            {num('floorHeight', 'floor m', { optional: true, placeholder: '4' })}
          </div>
          <Entrances board={board} raw={raw} />
        </>
      )}
      <div className="lb-row">
        <button onClick={() => board.duplicateSelected()}>Duplicate</button>
        <button onClick={() => board.removeSelected()}>Delete</button>
      </div>
    </section>
  );
}

function Entrances({ board, raw }: { board: LayoutBoard; raw: Raw }): ReactNode {
  const list = (raw.entrances as Raw[] | undefined) ?? [];
  const id = String(raw.id);
  const set = (i: number, patch: Raw, merge = '') =>
    board.edit(
      {
        entrances: list.map((e, k) =>
          k === i
            ? Object.fromEntries(
                Object.entries({ ...e, ...patch }).filter(([, v]) => v !== undefined),
              )
            : e,
        ),
      },
      merge,
    );
  return (
    <div className="lb-entrances">
      <h4>Ways in ({list.length})</h4>
      {list.map((e, i) => (
        <div className="lb-entrance" key={i}>
          <select value={String(e.side)} onChange={(ev) => set(i, { side: ev.target.value })}>
            {['front', 'back', 'left', 'right'].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <NumField
            label="along"
            value={e.along as number | undefined}
            placeholder="0"
            onSet={(v) => set(i, { along: v }, `ent:${id}:${i}:along`)}
          />
          <NumField
            label="w"
            value={e.width as number | undefined}
            placeholder="2"
            onSet={(v) => set(i, { width: v }, `ent:${id}:${i}:width`)}
          />
          <NumField
            label="floor"
            value={e.floor as number | undefined}
            placeholder="0"
            onSet={(v) => set(i, { floor: v }, `ent:${id}:${i}:floor`)}
          />
          <TextField
            label="kind"
            value={(e.kind as string | undefined) ?? ''}
            onSet={(v) => set(i, { kind: v || undefined }, `ent:${id}:${i}:kind`)}
          />
          <button
            title="Remove"
            onClick={() => board.edit({ entrances: list.filter((_, k) => k !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <p className="lb-dim">The Way in tool (E) adds one where you click a side.</p>
    </div>
  );
}

function MapFields({ board }: { board: LayoutBoard }): ReactNode {
  const doc = board.doc;
  const bounds = doc.bounds as Raw;
  const slope = doc.slope as Raw | undefined;
  const pois = (doc.pois as Record<string, Raw> | undefined) ?? {};
  const setDoc = (fn: (d: Raw) => void, merge = '') => board.change(fn, merge);
  return (
    <section className="lb-section">
      <h3>Map</h3>
      <TextField
        label="name"
        value={(doc.name as string | undefined) ?? ''}
        onSet={(v) => setDoc((d) => (v ? (d.name = v) : delete d.name), 'map:name')}
      />
      <h4>Bounds</h4>
      <div className="lb-grid">
        {(['x0', 'z0', 'x1', 'z1'] as const).map((k) => (
          <NumField
            key={k}
            label={k}
            value={bounds[k] as number}
            onSet={(v) => v !== undefined && setDoc(() => (bounds[k] = v), `map:${k}`)}
          />
        ))}
      </div>
      <h4>
        <label>
          <input
            type="checkbox"
            checked={!!slope}
            onChange={(e) =>
              setDoc((d) => {
                const b = d.bounds as Record<string, number>;
                if (e.target.checked)
                  d.slope = {
                    low: [(b.x0! + b.x1!) / 2, b.z1],
                    lowY: 0,
                    high: [(b.x0! + b.x1!) / 2, b.z0],
                    highY: 12,
                  };
                else delete d.slope;
              })
            }
          />{' '}
          Slope (the hill)
        </label>
      </h4>
      {slope && (
        <div className="lb-grid">
          {(['low', 'high'] as const).flatMap((end) => [
            <NumField
              key={`${end}x`}
              label={`${end} x`}
              value={(slope[end] as number[])[0]}
              onSet={(v) =>
                v !== undefined && setDoc(() => ((slope[end] as number[])[0] = v), `slope:${end}x`)
              }
            />,
            <NumField
              key={`${end}z`}
              label={`${end} z`}
              value={(slope[end] as number[])[1]}
              onSet={(v) =>
                v !== undefined && setDoc(() => ((slope[end] as number[])[1] = v), `slope:${end}z`)
              }
            />,
            <NumField
              key={`${end}y`}
              label={`${end} y`}
              value={slope[`${end}Y`] as number}
              onSet={(v) =>
                v !== undefined && setDoc(() => (slope[`${end}Y`] = v), `slope:${end}y`)
              }
            />,
          ])}
        </div>
      )}
      <h4>Places (pois)</h4>
      {Object.entries(pois).map(([id, p]) => (
        <div className="lb-row" key={id}>
          <input
            type="color"
            value={String(p.color)}
            onChange={(e) => setDoc(() => (p.color = e.target.value), `poi:${id}:color`)}
          />
          <code>{id}</code>
          <TextField
            label=""
            value={String(p.name)}
            onSet={(v) => setDoc(() => (p.name = v), `poi:${id}:name`)}
          />
          <button
            title="Remove (areas using it must change first)"
            onClick={() => setDoc((d) => delete (d.pois as Record<string, Raw>)[id])}
          >
            ×
          </button>
        </div>
      ))}
      <AddPoi
        onAdd={(id) =>
          setDoc(
            (d) =>
              (((d.pois ??= {}) as Record<string, Raw>)[id] ??= { name: id, color: '#8a8f98' }),
          )
        }
      />
    </section>
  );
}

function AddPoi({ onAdd }: { onAdd: (id: string) => void }): ReactNode {
  const [id, setId] = useState('');
  const ok = /^[a-z0-9][a-z0-9-]*$/.test(id);
  return (
    <div className="lb-row">
      <input placeholder="new poi id" value={id} onChange={(e) => setId(e.target.value)} />
      <button
        disabled={!ok}
        onClick={() => {
          onAdd(id);
          setId('');
        }}
      >
        Add
      </button>
    </div>
  );
}

function PieceList({ board }: { board: LayoutBoard }): ReactNode {
  const { layout, selected } = board.getState();
  return (
    <section className="lb-section lb-list">
      {KINDS.map(([kind, label]) => {
        const items = layout[kind] as { id: string; name?: string; poi?: string }[];
        if (!items.length) return null;
        return (
          <div key={kind}>
            <h4>
              {label} ({items.length})
            </h4>
            <ul>
              {items.map((p) => (
                <li
                  key={p.id}
                  className={selected?.id === p.id ? 'ed-on' : ''}
                  onClick={() => board.select({ kind, id: p.id })}
                >
                  {p.name ?? p.id}
                  {p.poi && <span className="lb-dim"> · {layout.pois[p.poi]?.name ?? p.poi}</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** A number box that keeps what's typed while it's focused; empty means left out. */
function NumField({
  label,
  value,
  onSet,
  placeholder,
  step,
}: {
  label: string;
  value: number | undefined;
  onSet: (v: number | undefined) => void;
  placeholder?: string | undefined;
  step?: number | undefined;
}): ReactNode {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [focused, setFocused] = useState(false);
  // Follows the value when it changes from outside (a drag, undo), unless being typed in.
  const [shown, setShown] = useState(value);
  if (!focused && shown !== value) {
    setShown(value);
    setText(value === undefined ? '' : String(value));
  }
  return (
    <label className="lb-field">
      {label && <span>{label}</span>}
      <input
        type="number"
        step={step ?? 'any'}
        value={text}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') return onSet(undefined);
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onSet(v);
        }}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onSet,
}: {
  label: string;
  value: string;
  onSet: (v: string) => void;
}): ReactNode {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(value);
  if (!focused && shown !== value) {
    setShown(value);
    setText(value);
  }
  return (
    <label className="lb-field">
      {label && <span>{label}</span>}
      <input
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (text !== value) onSet(text);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        onChange={(e) => setText(e.target.value)}
      />
    </label>
  );
}
