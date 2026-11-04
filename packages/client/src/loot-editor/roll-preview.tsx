import {
  addItem,
  createGrid,
  createRng,
  itemDef,
  rollMix,
  type Grid,
  type ItemDb,
  type LootContainerDef,
  type LootMix,
  type LootTableDef,
} from '@mes/shared';
import { useMemo, useState } from 'react';
import { colourOf } from '../ui/raid-screen';

/*
 * Sample containers rolled as a raid would roll them (2026-11-02): a mix (a table alone is
 * a mix of one) into a kind's grid, with what didn't fit counted. Each "Roll again" is a
 * new seed.
 */

const SAMPLES = 8;
const CELL = 30;

interface Sample {
  grid: Grid;
  /** Items rolled that didn't fit. */
  left: number;
  worth: number;
}

function roll(
  items: ItemDb,
  tables: ReadonlyMap<string, LootTableDef>,
  mix: LootMix,
  size: readonly [number, number],
  seed: number,
): Sample[] | string {
  try {
    const rng = createRng(seed);
    return Array.from({ length: SAMPLES }, () => {
      const grid = createGrid(size[0], size[1], true);
      let left = 0;
      let worth = 0;
      for (const item of rollMix(items, tables, mix, rng)) {
        const value = itemDef(items, item.item).value * item.count;
        const before = item.count;
        const out = addItem(items, grid, item);
        if (out) left++;
        worth += (value * (before - out)) / before;
      }
      return { grid, left, worth };
    });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function RollPreview(props: {
  items: ItemDb;
  tables: ReadonlyMap<string, LootTableDef>;
  mix: LootMix;
  /** Kinds to roll into; the first is picked to start. */
  kinds: readonly LootContainerDef[];
}) {
  const { items, tables, mix, kinds } = props;
  const [seed, setSeed] = useState(1);
  const [kindId, setKindId] = useState<string | null>(null);
  const kind = kinds.find((k) => k.id === kindId) ?? kinds[0];
  const size = kind?.grid ?? ([4, 3] as const);
  const json = JSON.stringify(mix);
  const samples = useMemo(
    () => roll(items, tables, mix, size, seed),
    // The mix by value, so an edit elsewhere doesn't reroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, tables, json, size[0], size[1], seed],
  );
  return (
    <div className="ie-card">
      <h4>
        rolled
        <button className="le-reroll" onClick={() => setSeed((s) => s + 1)} title="New samples">
          🎲 Roll again
        </button>
      </h4>
      {kinds.length > 1 && (
        <label className="ed-field">
          into
          <select value={kind?.id} onChange={(e) => setKindId(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.grid[0]}×{k.grid[1]})
              </option>
            ))}
          </select>
        </label>
      )}
      {typeof samples === 'string' ? (
        <p className="ed-problem">{samples}</p>
      ) : (
        <div className="le-samples">
          {samples.map((s, i) => (
            <figure key={i} className="le-sample">
              <SampleGrid items={items} grid={s.grid} />
              <figcaption className="ed-note">
                {s.grid.items.length
                  ? `worth ${Math.round(s.worth).toLocaleString('en-GB')}`
                  : 'empty'}
                {s.left > 0 && <span className="ed-problem"> · {s.left} didn&apos;t fit</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function SampleGrid({ items, grid }: { items: ItemDb; grid: Grid }) {
  return (
    <div className="le-sample-grid" style={{ width: grid.w * CELL, height: grid.h * CELL }}>
      {grid.items.map((g, i) => {
        const def = itemDef(items, g.item.item);
        const w = g.rotated ? def.size[1] : def.size[0];
        const h = g.rotated ? def.size[0] : def.size[1];
        return (
          <div
            key={i}
            className="le-tile"
            title={`${def.name}${g.item.count > 1 ? ` ×${g.item.count}` : ''}`}
            style={{
              left: g.x * CELL,
              top: g.y * CELL,
              width: w * CELL,
              height: h * CELL,
              background: `${colourOf(def)}88`,
              borderColor: colourOf(def),
            }}
          >
            {def.name}
            {g.item.count > 1 && <span className="le-count-badge">{g.item.count}</span>}
          </div>
        );
      })}
    </div>
  );
}
