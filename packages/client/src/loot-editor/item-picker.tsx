import type { ItemDb, ItemDef } from '@mes/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { colorOf } from '../ui/raid-screen';

/*
 * Picking items for a loot table (2026-11-02): a searchable list of every item as its tile
 * (rarity color, size), name, type and value. One pick replaces a row's item; with
 * `multi`, ticked items are added together.
 */

/** An item's tile, small: its rarity color, its shape in cells. */
export function ItemSwatch({ def, cell = 7 }: { def: ItemDef | undefined; cell?: number }) {
  if (!def) return <span className="le-swatch le-missing" title="No such item" />;
  const [w, h] = def.size;
  return (
    <span
      className="le-swatch"
      style={{
        width: Math.min(w, 4) * cell,
        height: Math.min(h, 4) * cell,
        background: `${colorOf(def)}88`,
        borderColor: colorOf(def),
      }}
      title={`${def.rarity}, ${w}×${h}`}
    />
  );
}

/** A row's item, as a button that opens the picker to change it. */
export function ItemChip(props: { items: ItemDb; value: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const def = props.items.get(props.value);
  return (
    <span className="le-chip-wrap">
      <button className="le-chip" onClick={() => setOpen(true)} title={props.value}>
        <ItemSwatch def={def} />
        <span className="le-chip-name">{def?.name ?? props.value}</span>
      </button>
      {open && (
        <ItemPicker
          items={props.items}
          current={props.value}
          onPick={([id]) => id && props.onPick(id)}
          close={() => setOpen(false)}
        />
      )}
    </span>
  );
}

const money = (n: number): string => n.toLocaleString('en-GB');

export function ItemPicker(props: {
  items: ItemDb;
  /** Shown ticked and first; not offered with multi. */
  current?: string;
  /** Items already in the table, marked as such. */
  taken?: ReadonlySet<string>;
  multi?: boolean;
  onPick: (ids: string[]) => void;
  close: () => void;
}) {
  const { items, multi, taken } = props;
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const types = useMemo(() => [...new Set([...items.values()].map((d) => d.type))].sort(), [items]);
  const q = query.trim().toLowerCase();
  const shown = [...items.values()]
    .filter((d) => !type || d.type === type)
    .filter((d) => !q || d.name.toLowerCase().includes(q) || d.id.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

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
    if (ticked.length) props.onPick(ticked);
    props.close();
  };
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
        placeholder={multi ? 'Find items to add (Enter adds the ticked)' : 'Find an item'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="le-types">
        <button className={type === null ? 'ed-on' : undefined} onClick={() => setType(null)}>
          all
        </button>
        {types.map((t) => (
          <button
            key={t}
            className={type === t ? 'ed-on' : undefined}
            onClick={() => setType(type === t ? null : t)}
          >
            {t}
          </button>
        ))}
      </div>
      <ul className="le-pick-list">
        {shown.map((d) => {
          const on = multi ? ticked.includes(d.id) : d.id === props.current;
          return (
            <li key={d.id} className={on ? 'ed-on' : undefined} onClick={() => choose(d.id)}>
              {multi && <input type="checkbox" readOnly checked={on} />}
              <ItemSwatch def={d} />
              <span className="le-pick-name">
                {d.name}
                {taken?.has(d.id) && <span className="ed-note"> (in the table)</span>}
              </span>
              <span className="ed-type">{d.type}</span>
              <span className="le-value">{money(d.value)}</span>
            </li>
          );
        })}
        {!shown.length && <li className="ed-note">No items match.</li>}
      </ul>
      {multi && (
        <div className="ed-row">
          <button onClick={done} disabled={!ticked.length}>
            Add {ticked.length || ''} item{ticked.length === 1 ? '' : 's'}
          </button>
          <button onClick={props.close}>Cancel</button>
        </div>
      )}
    </div>
  );
}
