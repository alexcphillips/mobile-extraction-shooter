import type { ReactNode } from 'react';
import { Num, Pick } from './fields';

/*
 * Form fields bound to a path in a content file's raw JSON, edited through a change
 * function (one undo step each): shared by the item editor (session 18) and the sound
 * editor (session 19).
 */

/** A raw content doc, edited in place by a change. */
export type Doc = Record<string, unknown>;

export type Path = readonly (string | number)[];

export function get(doc: Doc, path: Path): unknown {
  let v: unknown = doc;
  for (const k of path) v = v && typeof v === 'object' ? (v as Doc)[String(k)] : undefined;
  return v;
}

/** Sets a field, or leaves it out for undefined (and an object it leaves empty too). */
export function put(doc: Doc, path: Path, value: unknown): void {
  const parents: Doc[] = [doc];
  let o = doc;
  for (const k of path.slice(0, -1).map(String)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k] as Doc;
    parents.push(o);
  }
  const last = String(path[path.length - 1]);
  if (value !== undefined) {
    o[last] = value;
    return;
  }
  delete o[last];
  for (let i = parents.length - 1; i > 0; i--) {
    if (Object.keys(parents[i]!).length) break;
    delete parents[i - 1]![String(path[i - 1])];
  }
}

/** Fields bound to the open doc: a number, a choice, a tick box. */
export interface Bound {
  doc: Doc;
  edit: (change: (doc: Doc) => void) => void;
}

export function N(props: Bound & { path: Path; label: string; min?: number; hint?: string }) {
  const v = get(props.doc, props.path);
  return (
    <span title={props.hint}>
      <Num
        label={props.label}
        value={typeof v === 'number' ? v : undefined}
        {...(props.min !== undefined && { min: props.min })}
        onChange={(n) => props.edit((d) => put(d, props.path, n))}
      />
    </span>
  );
}

export function P(
  props: Bound & {
    path: Path;
    label: string;
    options: readonly string[];
    unset?: string;
    then?: (doc: Doc, v: string | undefined) => void;
  },
) {
  const v = get(props.doc, props.path);
  return (
    <Pick
      label={props.label}
      value={typeof v === 'string' ? v : undefined}
      options={props.options}
      {...(props.unset !== undefined && { unset: props.unset })}
      onChange={(o) =>
        props.edit((d) => {
          put(d, props.path, o);
          props.then?.(d, o);
        })
      }
    />
  );
}

export function Check(props: Bound & { path: Path; label: string }) {
  return (
    <label className="ed-field">
      <input
        type="checkbox"
        checked={get(props.doc, props.path) === true}
        onChange={(e) => props.edit((d) => put(d, props.path, e.target.checked || undefined))}
      />
      {props.label}
    </label>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="ed-row">{children}</div>;
}
