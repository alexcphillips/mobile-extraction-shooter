import type { ItemDb, ItemDef } from '@mes/shared';
import { useMemo, useState } from 'react';
import { SearchPicker, type PickerEntry } from '../editor/search-picker';
import { colorOf } from '../ui/raid-screen';

/*
 * Picking items for a loot table (2026-11-02): a searchable list of every item as its tile
 * (rarity color, size), name, type and value. One pick replaces a row's item; with
 * `multi`, ticked items are added together. The list itself is the shared SearchPicker
 * (2026-11-11), which the quest editor also uses for requirements.
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
  /** Shown ticked; not offered with multi. */
  current?: string;
  /** Items already in the table, marked as such. */
  taken?: ReadonlySet<string>;
  multi?: boolean;
  onPick: (ids: string[]) => void;
  close: () => void;
}) {
  const { items, taken } = props;
  const filters = useMemo(
    () =>
      [...new Set([...items.values()].map((d) => d.type))].sort().map((t) => ({ id: t, label: t })),
    [items],
  );
  const entries = useMemo(
    () =>
      [...items.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d): PickerEntry => ({
          id: d.id,
          name: d.name,
          group: d.type,
          swatch: <ItemSwatch def={d} />,
          tag: d.type,
          right: money(d.value),
          ...(taken?.has(d.id) && { note: '(in the table)' }),
        })),
    [items, taken],
  );
  return (
    <SearchPicker
      entries={entries}
      filters={filters}
      placeholder={props.multi ? 'Find items to add (Enter adds the ticked)' : 'Find an item'}
      empty="No items match."
      {...(props.multi && { multi: true })}
      {...(props.current !== undefined && { current: props.current })}
      onPick={props.onPick}
      close={props.close}
    />
  );
}
