import { nodeSchema, type MapNode } from '@mes/shared';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { canTurn, nodeLabel, nodePos, nodeYaw, nodesAt, placeNode, round } from './doc';
import { ANGLE_SNAPS, GRID_SNAPS, PLACEABLE, type MapEditor } from './editor';

/*
 * The map editor's panels (session 15): the toolbar along the top, the list of nodes in
 * the group being edited and the selected node's fields on the right, and the status line.
 */

export function EditorPanel({ editor, maps }: { editor: MapEditor; maps: readonly string[] }) {
  const s = useSyncExternalStore(editor.subscribe, editor.getState);
  const nodes = nodesAt(s.map, s.scope);
  const active = s.selected.length ? nodes[s.selected[s.selected.length - 1]!] : undefined;

  return (
    <>
      <div className="ed-bar">
        <select
          value={s.map.id}
          title="Map"
          onChange={(e) => {
            if (s.dirty && !confirm('Leave without saving?')) return;
            location.search = `?map=${e.target.value}`;
          }}
        >
          {maps.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
        <button
          className={s.dirty ? 'ed-save ed-dirty' : 'ed-save'}
          disabled={s.saving}
          onClick={() => void editor.save()}
          title="⌘S"
        >
          {s.saving ? 'Saving…' : s.dirty ? 'Save' : 'Saved'}
        </button>
        <span className="ed-sep" />
        <button onClick={() => editor.undo()} disabled={!s.canUndo} title="⌘Z">
          Undo
        </button>
        <button onClick={() => editor.redo()} disabled={!s.canRedo} title="⇧⌘Z">
          Redo
        </button>
        <span className="ed-sep" />
        <Toggle on={s.tool === 'select'} onClick={() => editor.setTool('select')} title="Esc">
          Select
        </Toggle>
        {PLACEABLE.map((t, i) => (
          <Toggle key={t} on={s.tool === t} onClick={() => editor.setTool(t)} title={`${i + 1}`}>
            {t}
          </Toggle>
        ))}
        <span className="ed-sep" />
        <Toggle on={s.gizmo === 'translate'} onClick={() => editor.setGizmo('translate')} title="T">
          Move
        </Toggle>
        <Toggle on={s.gizmo === 'rotate'} onClick={() => editor.setGizmo('rotate')} title="R">
          Turn
        </Toggle>
        <label title="Grid snap">
          Grid
          <select
            value={s.gridSnap}
            onChange={(e) => editor.setOption({ gridSnap: Number(e.target.value) })}
          >
            {GRID_SNAPS.map((g) => (
              <option key={g} value={g}>
                {g ? `${g} m` : 'off'}
              </option>
            ))}
          </select>
        </label>
        <label title="Angle snap">
          Angle
          <select
            value={s.angleSnap}
            onChange={(e) => editor.setOption({ angleSnap: Number(e.target.value) })}
          >
            {ANGLE_SNAPS.map((a) => (
              <option key={a} value={a}>
                {a ? `${a}°` : 'off'}
              </option>
            ))}
          </select>
        </label>
        <label title="Drop what's moved or placed onto the surface below">
          <input
            type="checkbox"
            checked={s.snapDown}
            onChange={(e) => editor.setOption({ snapDown: e.target.checked })}
          />
          Snap down
        </label>
      </div>

      <div className="ed-side">
        <div className="ed-crumbs">
          <button onClick={() => editor.select([], [])} disabled={!s.scope.length}>
            {s.map.name}
          </button>
          {s.scope.map((_, k) => {
            const path = s.scope.slice(0, k + 1);
            const g = nodesAt(s.map, path.slice(0, -1))[path[k]!]!;
            return (
              <span key={k}>
                {' › '}
                <button onClick={() => editor.select([], path)} disabled={k === s.scope.length - 1}>
                  {nodeLabel(g)}
                </button>
              </span>
            );
          })}
        </div>
        <ul className="ed-list">
          {nodes.map((n, i) => (
            <li
              key={i}
              className={s.selected.includes(i) ? 'ed-on' : undefined}
              onClick={(e) =>
                editor.select(
                  e.shiftKey || e.metaKey
                    ? s.selected.includes(i)
                      ? s.selected.filter((k) => k !== i)
                      : [...s.selected, i]
                    : [i],
                )
              }
              onDoubleClick={() => editor.enter(i)}
            >
              <span className="ed-type">{n.type === 'group' ? '▸' : n.type}</span>{' '}
              {nodeLabel(n) || `#${i}`}
            </li>
          ))}
        </ul>
        <div className="ed-actions">
          <button onClick={() => editor.groupSelected()} disabled={!s.selected.length} title="⌘G">
            Group
          </button>
          <button
            onClick={() => editor.ungroupSelected()}
            disabled={!s.selected.some((i) => nodes[i]?.type === 'group')}
            title="⇧⌘G"
          >
            Ungroup
          </button>
          <button
            onClick={() => editor.duplicateSelected()}
            disabled={!s.selected.length}
            title="⌘D"
          >
            Copy
          </button>
          <button onClick={() => editor.dropSelected()} disabled={!s.selected.length} title="B">
            Drop
          </button>
          <button onClick={() => editor.matchRotation()} disabled={s.selected.length < 2} title="M">
            Match turn
          </button>
          <button onClick={() => editor.deleteSelected()} disabled={!s.selected.length} title="⌫">
            Delete
          </button>
        </div>
        {s.selected.length > 1 && <p className="ed-note">{s.selected.length} selected.</p>}
        {active && s.selected.length === 1 && (
          <Inspector
            key={`${s.scope.join('.')}:${s.selected[0]}`}
            editor={editor}
            node={active}
            slots={Object.keys(s.map.colours ?? {})}
            prefabs={[...editor.prefabs.keys()]}
          />
        )}
      </div>

      <div className={s.problem ? 'ed-status ed-problem' : 'ed-status'}>
        {s.problem ? `⚠ ${s.problem}` : (s.message ?? HELP)}
      </div>
    </>
  );
}

const HELP =
  'Two-finger scroll orbit, ⇧ pan · pinch zoom · ⌥-drag orbit, ⌥⇧-drag pan · WASD QE fly · ' +
  'click select, ⇧ add · double-click enter group · F focus';

function Toggle(props: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button className={props.on ? 'ed-on' : undefined} onClick={props.onClick} title={props.title}>
      {props.children}
    </button>
  );
}

type Edit = (change: (n: MapNode) => void) => void;

function Inspector(props: {
  editor: MapEditor;
  node: MapNode;
  slots: string[];
  prefabs: string[];
}) {
  const { editor, node: n } = props;
  const edit: Edit = (change) => editor.editActive(change);
  const pos = nodePos(n);
  const any = n as Record<string, unknown>;
  const num = (key: string, label = key, fallback?: number) => (
    <Num
      label={label}
      value={(any[key] as number | undefined) ?? fallback}
      onChange={(v) =>
        edit((m) => {
          const r = m as Record<string, unknown>;
          if (v === undefined) delete r[key];
          else r[key] = v;
        })
      }
    />
  );
  const vec = (key: 'size', labels: string[]) => {
    const v = any[key] as number[];
    return labels.map((l, k) => (
      <Num
        key={l}
        label={l}
        value={v[k]}
        min={0.01}
        onChange={(x) =>
          x !== undefined &&
          edit((m) => {
            const arr = [...((m as Record<string, unknown>)[key] as number[])];
            arr[k] = x;
            (m as Record<string, unknown>)[key] = arr;
          })
        }
      />
    ));
  };

  return (
    <div className="ed-inspector">
      <h3>{n.type}</h3>
      {n.type === 'group' ? (
        <Text
          label="name"
          value={n.name ?? ''}
          onChange={(v) =>
            edit((m) => (v ? ((m as typeof n).name = v) : delete (m as typeof n).name))
          }
        />
      ) : (
        <Text
          label="id"
          value={n.id ?? ''}
          onChange={(v) =>
            edit((m) => {
              const r = m as { id?: string };
              if (v) r.id = v;
              else delete r.id;
            })
          }
        />
      )}
      <div className="ed-row">
        {(['x', 'y', 'z'] as const).map((l, k) => (
          <Num
            key={l}
            label={l}
            value={pos[k]}
            onChange={(v) => {
              if (v === undefined) return;
              const to = [...pos];
              to[k] = v;
              edit((m) => placeNode(m, to));
            }}
          />
        ))}
      </div>
      <div className="ed-row">
        {canTurn(n) && (
          <Num
            label="yaw"
            value={nodeYaw(n)}
            onChange={(v) => edit((m) => placeNode(m, nodePos(m), v ?? 0))}
          />
        )}
        {(n.type === 'box' || n.type === 'cylinder') && (
          <>
            {num('pitch')}
            {num('roll')}
          </>
        )}
      </div>
      {(n.type === 'box' || n.type === 'ramp' || n.type === 'stairs') && (
        <div className="ed-row">{vec('size', ['w', 'h', 'd'])}</div>
      )}
      {n.type === 'cylinder' && (
        <div className="ed-row">
          {num('radius')}
          {num('radiusTop', 'top r')}
          {num('height')}
          {num('sides', 'sides', 8)}
        </div>
      )}
      {n.type === 'stairs' && <div className="ed-row">{num('steps')}</div>}
      {n.type === 'ladder' && (
        <div className="ed-row">
          {num('height')}
          {num('width', 'width', 0.6)}
        </div>
      )}
      {n.type === 'prefab' && (
        <label className="ed-field">
          prefab
          <select
            value={n.prefab}
            onChange={(e) => edit((m) => ((m as typeof n).prefab = e.target.value))}
          >
            {props.prefabs.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      )}
      {'colour' in n && (
        <Colour
          value={n.colour}
          slots={props.slots}
          onChange={(c) => {
            editor.setColour(c);
            edit((m) => ((m as typeof n).colour = c));
          }}
        />
      )}
      {n.type === 'box' || n.type === 'cylinder' || n.type === 'ramp' || n.type === 'stairs' ? (
        <label className="ed-field">
          <input
            type="checkbox"
            checked={(n as { collide?: boolean }).collide !== false}
            onChange={(e) =>
              edit((m) => {
                const r = m as { collide?: boolean };
                if (e.target.checked) delete r.collide;
                else r.collide = false;
              })
            }
          />
          collides
        </label>
      ) : null}
      {n.type === 'group' && (
        <button onClick={() => editor.enter(editor.getState().selected[0]!)}>Edit inside</button>
      )}
      <Json editor={editor} node={n} />
    </div>
  );
}

/** A number typed in, applied on Enter or leaving the field. Empty clears an optional one. */
function Num(props: {
  label: string;
  value: number | undefined;
  min?: number;
  onChange: (v: number | undefined) => void;
}) {
  const shown = props.value === undefined ? '' : String(round(props.value, 1e-3));
  // Keyed by the value, so a change from elsewhere (the gizmo, undo) starts it afresh.
  return <NumInput key={shown} shown={shown} {...props} />;
}

function NumInput(props: {
  label: string;
  shown: string;
  min?: number;
  onChange: (v: number | undefined) => void;
}) {
  const { shown } = props;
  const [text, setText] = useState(shown);
  const commit = (): void => {
    if (text === shown) return;
    if (text.trim() === '') return props.onChange(undefined);
    const v = Number(text);
    if (!Number.isFinite(v) || (props.min !== undefined && v < props.min)) return setText(shown);
    props.onChange(v);
  };
  return (
    <label className="ed-num">
      {props.label}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}

function Text(props: { label: string; value: string; onChange: (v: string) => void }) {
  return <TextInput key={props.value} {...props} />;
}

function TextInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(props.value);
  const commit = (): void => {
    if (text !== props.value) props.onChange(text.trim());
  };
  return (
    <label className="ed-field">
      {props.label}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}

/** A #rrggbb colour (with a picker) or one of the map's colour slots. */
function Colour(props: { value: string; slots: string[]; onChange: (c: string) => void }) {
  const hex = props.value.startsWith('#');
  return (
    <label className="ed-field">
      colour
      <select
        value={hex ? '' : props.value}
        onChange={(e) => props.onChange(e.target.value || '#b5b0a6')}
      >
        <option value="">custom</option>
        {props.slots.map((slot) => (
          <option key={slot}>{slot}</option>
        ))}
      </select>
      {hex && (
        <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </label>
  );
}

/** The node as JSON, for the fields not shown above (markers and doors until session 17). */
function Json({ editor, node }: { editor: MapEditor; node: MapNode }) {
  const json = JSON.stringify(node, null, 2);
  // Only the text is keyed, so the panel stays open after Apply.
  return (
    <details className="ed-json">
      <summary>JSON</summary>
      <JsonInput key={json} editor={editor} json={json} />
    </details>
  );
}

function JsonInput({ editor, json }: { editor: MapEditor; json: string }) {
  const [text, setText] = useState(json);
  const [error, setError] = useState<string | null>(null);
  const apply = (): void => {
    try {
      const parsed = nodeSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'not a node');
      editor.replaceActive(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <>
      <textarea value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      {error && <p className="ed-problem">{error}</p>}
      <button onClick={apply} disabled={text === json}>
        Apply
      </button>
    </>
  );
}
