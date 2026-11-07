/*
 * Keeping a copy of the raid's state in step over the network (docs/coop.md, C5). The
 * host diffs the state against what it last sent and sends the patch; a guest applies it
 * to its copy **in place**, so the objects the client holds on to (its player, each
 * enemy, the state itself) stay the same objects. Lists of things with an `id` (entities,
 * containers, grenades) are matched by id, so one leaving doesn't shift the others along.
 * Plain JSON in and out. No DOM: the sim's rules apply (CLAUDE.md).
 */

/** A change to one value. */
export type Patch =
  /** Replaced by this value outright. */
  | { $: unknown }
  /** An object: changed keys, and keys gone. */
  | { o?: Record<string, Patch>; d?: string[] }
  /** A list by index: changed places, and its new length. */
  | { a: Record<number, Patch>; n: number }
  /** A list of things with ids: changes by id, and the ids in their new order. */
  | { k: [id: string | number, change: Patch][]; ids: (string | number)[] };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether every item of a list is an object with a string or number id. */
function keyed(list: unknown[]): boolean {
  if (!list.length) return false;
  for (const x of list) {
    if (!isObject(x) || (typeof x.id !== 'string' && typeof x.id !== 'number')) return false;
  }
  return true;
}

/**
 * The patch that turns `prev` into `next`, or undefined if they're the same. Keys in
 * `omit` are left out at any depth (they're never sent).
 */
export function diff(
  prev: unknown,
  next: unknown,
  omit: ReadonlySet<string> = NONE,
): Patch | undefined {
  if (prev === next) return undefined;
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (keyed(next) && (prev.length === 0 || keyed(prev)))
      return diffKeyed(prev as Json[], next as Json[], omit);
    const a: Record<number, Patch> = {};
    let any = prev.length !== next.length;
    for (let i = 0; i < next.length; i++) {
      const p = i < prev.length ? diff(prev[i], next[i], omit) : { $: strip(next[i], omit) };
      if (p) {
        a[i] = p;
        any = true;
      }
    }
    return any ? { a, n: next.length } : undefined;
  }
  if (isObject(prev) && isObject(next)) {
    let o: Record<string, Patch> | undefined;
    let d: string[] | undefined;
    // A key set to undefined is as good as gone, as it is in JSON: sent as a deletion, or
    // the guest would keep the old value while the host's mirror moved on.
    for (const key in next) {
      if (omit.has(key) || next[key] === undefined) continue;
      const p = key in prev ? diff(prev[key], next[key], omit) : { $: strip(next[key], omit) };
      if (p) (o ??= {})[key] = p;
    }
    for (const key in prev) {
      if (omit.has(key) || prev[key] === undefined) continue;
      if (next[key] === undefined) (d ??= []).push(key);
    }
    if (!o && !d) return undefined;
    return d ? (o ? { o, d } : { d }) : { o: o! };
  }
  // Numbers that are both NaN are the same.
  if (typeof prev === 'number' && typeof next === 'number' && prev !== prev && next !== next)
    return undefined;
  return { $: strip(next, omit) };
}

function diffKeyed(prev: Json[], next: Json[], omit: ReadonlySet<string>): Patch | undefined {
  const before = new Map<unknown, Json>();
  for (const x of prev) before.set(x.id, x);
  const k: [string | number, Patch][] = [];
  let moved = prev.length !== next.length;
  for (let i = 0; i < next.length; i++) {
    const x = next[i]!;
    const id = x.id as string | number;
    const old = before.get(id);
    if (!moved && prev[i]!.id !== id) moved = true;
    const p = old ? diff(old, x, omit) : { $: strip(x, omit) };
    if (p) k.push([id, p]);
  }
  if (!k.length && !moved) return undefined;
  return { k, ids: next.map((x) => x.id as string | number) };
}

const NONE: ReadonlySet<string> = new Set();

/** A deep copy without the omitted keys, for a value sent whole. */
export function strip<T>(value: T, omit: ReadonlySet<string> = NONE): T {
  if (Array.isArray(value)) return value.map((v: unknown) => strip(v, omit)) as T;
  if (!isObject(value)) return value;
  const out: Json = {};
  for (const key in value)
    if (!omit.has(key) && value[key] !== undefined) out[key] = strip(value[key], omit);
  return out as T;
}

/**
 * Applies a patch to `target` in place where it can (objects and lists keep their
 * identity, and so does each thing in a list matched by id), and returns the result,
 * which is a new value only where one was replaced outright.
 */
export function apply<T>(target: T, patch: Patch): T {
  if ('$' in patch) return structuredCloneJson(patch.$) as T;
  if ('k' in patch) {
    const list = target as unknown as Json[];
    const byId = new Map<unknown, Json>();
    for (const x of list) byId.set(x.id, x);
    for (const [id, change] of patch.k) byId.set(id, apply(byId.get(id) as Json, change));
    list.length = 0;
    for (const id of patch.ids) list.push(byId.get(id)!);
    return target;
  }
  if ('a' in patch) {
    const list = target as unknown as unknown[];
    for (const i in patch.a) list[+i] = apply(list[+i], patch.a[i]!);
    list.length = patch.n;
    return target;
  }
  const obj = target as unknown as Json;
  if (patch.o) for (const key in patch.o) obj[key] = apply(obj[key], patch.o[key]!);
  if (patch.d) for (const key of patch.d) delete obj[key];
  return target;
}

/** Patches are applied to a copy the guest owns, so a value sent whole is copied. */
function structuredCloneJson(v: unknown): unknown {
  return v === null || typeof v !== 'object' ? v : (JSON.parse(JSON.stringify(v)) as unknown);
}
