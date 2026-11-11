import type { LootMix } from '@mes/shared';
import { useState } from 'react';
import { loadLootContainers, loadLootTables } from '../content';
import { Num, Pick } from './fields';

/*
 * A loot mix's fields (2026-11-02): loot tables by weight, a weight for nothing, and
 * whether it's picked once for the container or for every item. Shared by the map editor
 * (a container's own loot) and the loot editor (a kind's default), with the weight slider
 * and share bar the loot editor's tables use too.
 */

/** A colour per part of a share bar, in order; "empty" is always grey. */
const PALETTE = ['#d08a2e', '#4f8fd0', '#59a85a', '#b0569c', '#c9b43a', '#46a9a3', '#c0583f'];
export const EMPTY_COLOUR = '#3a4048';
export const partColour = (i: number): string => PALETTE[i % PALETTE.length]!;

/** Each weight as a share of them all, like "80%". */
function share(weight: number, mix: LootMix): string {
  const total = Object.values(mix.tables).reduce((a, b) => a + b, 0) + (mix.empty ?? 0);
  return total > 0 ? `${Math.round((weight / total) * 100)}%` : '';
}

export interface SharePart {
  label: string;
  weight: number;
  colour: string;
}

/** Shares as one bar, each part as wide as its weight; the label shows on hover. */
export function ShareBar({ parts }: { parts: readonly SharePart[] }) {
  const total = parts.reduce((a, p) => a + p.weight, 0);
  if (total <= 0) return null;
  return (
    <div className="ed-share">
      {parts.map((p, i) => {
        const f = p.weight / total;
        return (
          <span
            key={i}
            style={{ flexGrow: p.weight, background: p.colour }}
            title={`${p.label}: ${Math.round(f * 1000) / 10}%`}
          >
            {f > 0.12 ? p.label : ''}
          </span>
        );
      })}
    </div>
  );
}

const MIN = 0.05;
const MAX = 50;
const STEPS = 400;
const toStep = (w: number): number =>
  Math.round((Math.log(Math.min(MAX, Math.max(MIN, w)) / MIN) / Math.log(MAX / MIN)) * STEPS);
/** A step's weight, rounded to two figures so files stay tidy. */
const fromStep = (s: number): number => Number((MIN * (MAX / MIN) ** (s / STEPS)).toPrecision(2));

/**
 * A weight as a slider (by ratio, so 0.1 to 1 is as far as 1 to 10) and a number. While
 * dragging, `onDrag` (if given) has each value, for a live preview; `onChange` has the
 * value let go on, or typed.
 */
export function WeightSlider(props: {
  value: number;
  onChange: (v: number) => void;
  onDrag?: (v: number) => void;
  begin?: () => void;
  /** Shows the number blank (the slider at its least) while not dragged. */
  unset?: boolean;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? props.value;
  return (
    <span className="ed-weight">
      <input
        type="range"
        min={0}
        max={STEPS}
        value={toStep(shown)}
        onPointerDown={() => {
          props.begin?.();
          setDragging(props.value);
        }}
        onChange={(e) => {
          const v = fromStep(Number(e.target.value));
          setDragging(v);
          props.onDrag?.(v);
        }}
        onPointerUp={() => {
          if (dragging !== null && dragging !== props.value) props.onChange(dragging);
          setDragging(null);
        }}
      />
      <Num
        label=""
        value={props.unset && dragging === null ? undefined : shown}
        min={0}
        onChange={(v) => v && props.onChange(v)}
      />
    </span>
  );
}

interface Loose {
  tables: Record<string, number>;
  empty?: number | undefined;
  each?: boolean | undefined;
}

/** Drops an empty weight of 0 and an `each` of false, as the schema wants them left out. */
function tidy(mix: Loose): LootMix {
  const out: LootMix = { tables: mix.tables };
  if (mix.empty) out.empty = mix.empty;
  if (mix.each) out.each = true;
  return out;
}

export function MixFields(props: {
  mix: LootMix;
  /** The tables to pick from. */
  tables: readonly string[];
  onChange: (mix: LootMix) => void;
  /** Live changes while a slider is dragged (the loot editor's preview follows them). */
  onDrag?: (mix: LootMix) => void;
  begin?: () => void;
  /** Opens a table: in the loot editor itself, or (unset) a link to it there. */
  open?: (table: string) => void;
  /** A loose spot's: it holds one item, so there's no mixing within it. */
  single?: boolean;
}) {
  const { mix, tables } = props;
  const set = (m: Loose) => props.onChange(tidy(m));
  const entries = Object.entries(mix.tables);
  const unused = tables.filter((t) => !(t in mix.tables));
  /** One row replaced, keeping the rows' order. */
  const withRow = (at: number, id: string | null, weight: number): Loose => {
    const next: Record<string, number> = {};
    entries.forEach(([t, w], i) => {
      if (i !== at) next[t] = w;
      else if (id !== null) next[id] = weight;
    });
    return { ...mix, tables: next };
  };
  const row = (at: number, id: string | null, weight: number) => set(withRow(at, id, weight));
  const drag = props.onDrag && ((m: Loose) => props.onDrag!(tidy(m)));
  const parts: SharePart[] = [
    ...entries.map(([t, w], i) => ({ label: t, weight: w, colour: partColour(i) })),
    ...(mix.empty ? [{ label: 'empty', weight: mix.empty, colour: EMPTY_COLOUR }] : []),
  ];
  return (
    <div className="ed-mix">
      <ShareBar parts={parts} />
      {entries.map(([t, w], i) => (
        <div className="ed-row ed-mix-row" key={t}>
          <span className="ed-dot" style={{ background: partColour(i) }} />
          <Pick label="" value={t} options={[t, ...unused]} onChange={(v) => v && row(i, v, w)} />
          {props.open ? (
            <button onClick={() => props.open!(t)} title={`Open ${t}`}>
              ↗
            </button>
          ) : (
            <a
              href={`/loot-editor?open=loot-tables/${t}`}
              target="loot-editor"
              title={`Open ${t} in the loot editor`}
            >
              ↗
            </a>
          )}
          <WeightSlider
            value={w}
            onChange={(v) => row(i, t, v)}
            {...(drag && { onDrag: (v: number) => drag(withRow(i, t, v)) })}
            {...(props.begin && { begin: props.begin })}
          />
          <span className="ed-note ed-pct">{share(w, mix)}</span>
          <button onClick={() => row(i, null, 0)} title="Take this table out">
            ✕
          </button>
        </div>
      ))}
      <div className="ed-row ed-mix-row">
        <span className="ed-dot" style={{ background: EMPTY_COLOUR }} />
        <span className="ed-mix-label">empty</span>
        <WeightSlider
          value={mix.empty ?? MIN}
          unset={!mix.empty}
          onChange={(v) => set({ ...mix, empty: v <= MIN ? undefined : v })}
          {...(drag && {
            onDrag: (v: number) => drag({ ...mix, empty: v <= MIN ? undefined : v }),
          })}
          {...(props.begin && { begin: props.begin })}
        />
        <span className="ed-note ed-pct">{mix.empty ? share(mix.empty, mix) : 'never'}</span>
        <button
          disabled={!mix.empty}
          onClick={() => set({ ...mix, empty: undefined })}
          title="Never empty"
        >
          ✕
        </button>
      </div>
      <div className="ed-row">
        <button
          disabled={!unused.length}
          onClick={() => set({ ...mix, tables: { ...mix.tables, [unused[0]!]: 1 } })}
          title="Add a loot table to the mix"
        >
          + table
        </button>
        {!props.single && (
          <label
            className="ed-field"
            title="Off: one pick for the whole container, so it's all one table's (8 in 10 all food, 2 in 10 all parts). On: a pick for every item, so one container holds a mix."
          >
            <input
              type="checkbox"
              checked={!!mix.each}
              onChange={(e) => set({ ...mix, each: e.target.checked })}
            />
            mix within one container
          </label>
        )}
      </div>
    </div>
  );
}

/** Where a container's loot comes from, as a map names it. */
export interface ContainerLootValue {
  container: string;
  lootTable?: string | undefined;
  mix?: LootMix | undefined;
}

/**
 * A container's kind and loot in the map editor: its kind's loot, or its own mix (an
 * old single table shows as a mix of one, and is written as a mix once changed).
 */
export function ContainerLootFields(props: {
  value: ContainerLootValue;
  onChange: (v: ContainerLootValue) => void;
}) {
  const { value: v } = props;
  const kinds = loadLootContainers();
  const tables = [...loadLootTables().keys()].sort();
  const kind = kinds.get(v.container);
  const own = v.mix ?? (v.lootTable !== undefined ? { tables: { [v.lootTable]: 1 } } : null);
  const describe = (m: LootMix): string =>
    [
      ...Object.entries(m.tables).map(([t, w]) => `${t} ${share(w, m)}`),
      ...(m.empty ? [`empty ${share(m.empty, m)}`] : []),
    ].join(', ') + (m.each ? ', mixed' : '');
  return (
    <>
      <div className="ed-row">
        <Pick
          label="container"
          value={v.container}
          options={[...kinds.keys()].sort()}
          onChange={(c) => {
            if (!c) return;
            // Own loot a lootless kind had to have isn't a choice: a kind with loot drops it.
            const forced = !kind?.loot && kinds.get(c)?.loot;
            props.onChange(forced ? { container: c } : { ...v, container: c });
          }}
        />
        <a
          href={`/loot-editor?open=loot-containers/${v.container}`}
          target="loot-editor"
          title="Open this kind in the loot editor: its grid and its loot"
        >
          ↗
        </a>
      </div>
      {own ? (
        <>
          <MixFields
            mix={own}
            tables={tables}
            onChange={(mix) => props.onChange({ container: v.container, mix })}
          />
          {kind?.loot && (
            <button
              onClick={() => props.onChange({ container: v.container })}
              title={`Fill it as every ${kind.name} is: ${describe(kind.loot)}`}
            >
              Use the {kind.name}&apos;s loot
            </button>
          )}
        </>
      ) : (
        <div className="ed-row">
          <span className="ed-note">
            {kind?.loot
              ? `${kind.name}'s loot: ${describe(kind.loot)}`
              : `${kind?.name ?? v.container} has no loot of its own: give this one some.`}
          </span>
          <button
            onClick={() =>
              props.onChange({
                container: v.container,
                mix: kind?.loot ?? { tables: { [tables[0] ?? 'household']: 1 } },
              })
            }
            title="Give this container its own mix, starting from its kind's"
          >
            Own loot…
          </button>
        </div>
      )}
    </>
  );
}
