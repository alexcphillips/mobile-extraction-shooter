import {
  armorOf,
  bagCells,
  bagRarity,
  levelRarity,
  RARITIES,
  type ItemDef,
  type Rarity,
} from '@mes/shared';
import type { CSSProperties, ReactNode } from 'react';
import { get, put, type Bound, type Doc, type Path } from '../editor/bound-fields';
import { RARITY_COLORS } from '../ui/raid-screen';

/*
 * The stats form's building blocks (2026-11-11 rework): a titled card per group of fields,
 * segmented pickers for short lists, one tick box style, and the rarity chips.
 */

/** A titled card of fields; `aside` sits at the right of the title (a summary or a switch). */
export function Group(props: { title: string; aside?: ReactNode; children?: ReactNode }) {
  return (
    <section className="ie-group-card">
      <header>
        <h4>{props.title}</h4>
        {props.aside}
      </header>
      {props.children}
    </section>
  );
}

/** A label over its control, for controls that aren't a field of their own. */
export function Labeled(props: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="ie-labeled" title={props.title}>
      <span className="ie-label">{props.label}</span>
      {props.children}
    </div>
  );
}

/** Buttons side by side, one of them on. */
export function Segmented<T extends string>(props: {
  value: T | undefined;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  titles?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="ie-seg" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={o === props.value}
          className={o === props.value ? 'ed-on' : undefined}
          title={props.titles?.[o]}
          onClick={() => o !== props.value && props.onChange(o)}
        >
          {props.labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

/**
 * A segmented pick bound to a field. `fallback` is the option a missing field means:
 * picking it leaves the field out.
 */
export function S<T extends string>(
  props: Bound & {
    path: Path;
    label: string;
    options: readonly T[];
    labels?: Partial<Record<T, string>>;
    titles?: Partial<Record<T, string>>;
    fallback?: T;
    then?: (doc: Doc, v: T | undefined) => void;
  },
) {
  const raw = get(props.doc, props.path);
  const value = (typeof raw === 'string' ? raw : props.fallback) as T | undefined;
  return (
    <Labeled label={props.label}>
      <Segmented
        value={value}
        options={props.options}
        {...(props.labels && { labels: props.labels })}
        {...(props.titles && { titles: props.titles })}
        onChange={(o) =>
          props.edit((d) => {
            const v = o === props.fallback ? undefined : o;
            put(d, props.path, v);
            props.then?.(d, v);
          })
        }
      />
    </Labeled>
  );
}

/** A tick box with its label, one style for all of them. */
export function Tick(props: {
  label: string;
  checked: boolean;
  title?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="ie-tick" title={props.title}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** A tick box bound to a true-or-missing field. */
export function T(props: Bound & { path: Path; label: string; title?: string }) {
  return (
    <Tick
      label={props.label}
      checked={get(props.doc, props.path) === true}
      {...(props.title && { title: props.title })}
      onChange={(on) => props.edit((d) => put(d, props.path, on || undefined))}
    />
  );
}

/**
 * The rarity an item's level or room gives (2026-11-11): armor's and an armored rig's by
 * armor level, a rig's or backpack's by its cells. Filled in when that changes (editor.ts).
 */
export function autoRarity(def: ItemDef): { rarity: Rarity; why: string } | null {
  const armor = armorOf(def);
  if (armor) return { rarity: levelRarity(armor.level), why: `level ${armor.level} armor` };
  if (def.type === 'container' && def.slot !== 'vault') {
    const cells = bagCells(def);
    return { rarity: bagRarity(def), why: `${cells} cell${cells === 1 ? '' : 's'}` };
  }
  return null;
}

/**
 * Rarity as colored chips. The one its level or room gives is marked "auto" (and is what
 * the editor picks when that changes), so going back to it is one click on it.
 */
export function RarityPicker(props: Bound & { def: ItemDef }) {
  const { def } = props;
  const auto = autoRarity(def);
  return (
    <Labeled label="Rarity">
      <div className="ie-rarities">
        {RARITIES.map((r) => {
          const on = r === def.rarity;
          const isAuto = auto?.rarity === r;
          return (
            <button
              key={r}
              className={on ? 'ie-rarity ie-rarity-on' : 'ie-rarity'}
              style={{ '--r': RARITY_COLORS[r] } as CSSProperties}
              title={isAuto ? `Auto: ${auto.why}` : undefined}
              aria-pressed={on}
              onClick={() => !on && props.edit((d) => put(d, ['rarity'], r))}
            >
              {r}
              {isAuto && <span className="ie-auto">auto</span>}
            </button>
          );
        })}
      </div>
    </Labeled>
  );
}
