import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/*
 * A searchable list to pick from (2026-11-11, out of the loot editor's item picker): a
 * search box, filter buttons, and rows with a swatch, a name, a tag and something on the
 * right. One pick closes it; with `multi`, rows have tick boxes and Done hands back what's
 * ticked (starting from `initial`, so it can untick as well as add). Used for items (loot
 * and quest editors) and quest requirements (quest editor, filtered by vendor).
 */

export interface PickerEntry {
  id: string;
  name: string;
  /** Which filter button it falls under. */
  group: string;
  swatch?: ReactNode;
  /** A short gray word after the name, such as its type or vendor. */
  tag?: string;
  /** On the right, such as a value. */
  right?: ReactNode;
  /** Grayed after the name, such as "(in the table)". */
  note?: string;
}

export interface PickerFilter {
  id: string;
  label: string;
  /** A dot in this color before the label. */
  color?: string;
}

export function SearchPicker(props: {
  entries: readonly PickerEntry[];
  filters: readonly PickerFilter[];
  placeholder: string;
  multi?: boolean;
  /** Shown ticked (not with multi). */
  current?: string;
  /** Ticked when it opens, with multi. */
  initial?: readonly string[];
  /** Done's label for what's ticked, with multi; "Add N" by default. */
  doneLabel?: (ticked: readonly string[]) => string;
  /** What's shown when nothing matches. */
  empty?: string;
  onPick: (ids: string[]) => void;
  close: () => void;
}) {
  const { multi, entries } = props;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>(() => [...(props.initial ?? [])]);
  const box = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      entries
        .filter((e) => filter === null || e.group === filter)
        .filter(
          (e) =>
            !q ||
            e.name.toLowerCase().includes(q) ||
            e.id.includes(q) ||
            (e.tag?.toLowerCase().includes(q) ?? false),
        ),
    [entries, filter, q],
  );
  const changed =
    ticked.length !== (props.initial ?? []).length ||
    ticked.some((t) => !(props.initial ?? []).includes(t));

  // A click outside closes it.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) props.close();
    };
    window.addEventListener('pointerdown', down);
    return () => window.removeEventListener('pointerdown', down);
  });

  const choose = (id: string) => {
    if (!multi) {
      props.onPick([id]);
      return props.close();
    }
    setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  };
  const done = () => {
    if (changed) props.onPick(ticked);
    props.close();
  };
  const label =
    props.doneLabel?.(ticked) ?? `Add ${ticked.length || ''} item${ticked.length === 1 ? '' : 's'}`;
  return (
    <div
      className="le-picker"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.close();
        if (e.key === 'Enter' && !multi && shown[0]) choose(shown[0].id);
        if (e.key === 'Enter' && multi) done();
      }}
    >
      <input
        className="ie-filter"
        autoFocus
        placeholder={props.placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="le-types">
        <button className={filter === null ? 'ed-on' : undefined} onClick={() => setFilter(null)}>
          all
        </button>
        {props.filters.map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? 'ed-on' : undefined}
            onClick={() => setFilter(filter === f.id ? null : f.id)}
          >
            {f.color && <span className="le-filter-dot" style={{ background: f.color }} />}
            {f.label}
          </button>
        ))}
      </div>
      <ul className="le-pick-list">
        {shown.map((e) => {
          const on = multi ? ticked.includes(e.id) : e.id === props.current;
          return (
            <li key={e.id} className={on ? 'ed-on' : undefined} onClick={() => choose(e.id)}>
              {multi && <input type="checkbox" readOnly checked={on} />}
              {e.swatch}
              <span className="le-pick-name">
                {e.name}
                {e.note && <span className="ed-note"> {e.note}</span>}
              </span>
              {e.tag && <span className="ed-type">{e.tag}</span>}
              {e.right !== undefined && <span className="le-value">{e.right}</span>}
            </li>
          );
        })}
        {!shown.length && <li className="ed-note">{props.empty ?? 'Nothing matches.'}</li>}
      </ul>
      {multi && (
        <div className="ed-row">
          <button onClick={done} disabled={!changed}>
            {label}
          </button>
          <button onClick={props.close}>Cancel</button>
          {ticked.length > 0 && <span className="ed-note le-ticked">{ticked.length} ticked</span>}
        </div>
      )}
    </div>
  );
}
