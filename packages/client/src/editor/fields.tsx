import { useState, type ReactNode } from 'react';
import { round } from './doc';

/*
 * Form fields shared by the map editor (session 15) and the item editor (session 18). Each
 * commits on Enter or leaving it, so one change is one undo step.
 */

/** The value of a select's option that leaves a field out. */
export const UNSET = '\u0000unset';

export function HexColour(props: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <label className="ed-field">
      {props.label}
      <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function Toggle(props: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button className={props.on ? 'ed-on' : undefined} onClick={props.onClick} title={props.title}>
      {props.children}
    </button>
  );
}

export function Num(props: {
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

export function Text(props: { label: string; value: string; onChange: (v: string) => void }) {
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

/** One of a list of ids, or (with `unset`) none, which leaves the field out. */
export function Pick(props: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  unset?: string;
  onChange: (v: string | undefined) => void;
}) {
  const { value } = props;
  // One not in the list (a typo in the file) still shows, so it can be seen and changed.
  const options =
    value === undefined || props.options.includes(value)
      ? props.options
      : [value, ...props.options];
  return (
    <label className="ed-field">
      {props.label}
      <select
        value={value ?? UNSET}
        onChange={(e) => props.onChange(e.target.value === UNSET ? undefined : e.target.value)}
      >
        {props.unset !== undefined && <option value={UNSET}>{props.unset}</option>}
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
