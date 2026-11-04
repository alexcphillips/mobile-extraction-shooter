import {
  LOOT_CONTAINER_FORMAT,
  LOOT_CONTAINER_FORMAT_VERSION,
  LOOT_TABLE_FORMAT,
  LOOT_TABLE_FORMAT_VERSION,
  loadContent,
  type LootContainerDef,
  type LootTableDef,
} from '@mes/shared';
import { checkLootKinds, lootTableContentProblem } from '../content';
import type { Doc } from '../editor/bound-fields';

/** What the loot editor edits: a loot table, or a kind of loot container (2026-11-02). */
export type LootFileKind = 'table' | 'container';

const DIR: Record<LootFileKind, string> = {
  table: 'loot-tables',
  container: 'loot-containers',
};

/** A file's key: its path in content/ without .json, like "loot-tables/household". */
export const fileKey = (kind: LootFileKind, id: string): string => `${DIR[kind]}/${id}`;

/** The kind and id in a file's key. */
export function parseKey(key: string): { kind: LootFileKind; id: string } {
  const [dir, id = ''] = key.split('/');
  return { kind: dir === DIR.container ? 'container' : 'table', id };
}

/** Every file's JSON by key. */
type Files = ReadonlyMap<string, string>;

interface Snapshot {
  files: Files;
  current: string;
}

export interface LootEditorState {
  /** Every table as edited, parsed from its JSON (it may not pass the schema), by id. */
  tables: ReadonlyMap<string, LootTableDef>;
  /** Every container kind as edited, the same way, by id. */
  containers: ReadonlyMap<string, LootContainerDef>;
  /** The open file's key. */
  current: string;
  /** Each file's own problem (its schema), by key. */
  problems: ReadonlyMap<string, string>;
  /** The first problem anywhere, its own or one the items or enemies find: nothing saves while set. */
  problem: string | null;
  /** Changed or new files, by key. */
  unsaved: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  message: string | null;
}

const UNDO_DEPTH = 200;

/** A new table to start from: one item, one or two of it in a container. */
export function blankLootTable(id: string, name: string, item: string): LootTableDef {
  return {
    formatVersion: LOOT_TABLE_FORMAT_VERSION,
    id,
    name,
    rolls: [1, 2],
    items: [{ item, weight: 1 }],
  };
}

/** A new container kind to start from: a 4×3 grid, filled from one table. */
export function blankLootContainer(id: string, name: string, table: string): LootContainerDef {
  return {
    formatVersion: LOOT_CONTAINER_FORMAT_VERSION,
    id,
    name,
    grid: [4, 3],
    loot: { tables: { [table]: 1 } },
  };
}

/**
 * The loot editor at /loot-editor (2026-11-01, its page 2026-11-02), like the sound editor:
 * every loot table and container kind file at once, edited as its own JSON (so saving
 * keeps its key order), with one undo history across them. Saving writes every changed
 * file in one request, refused while anything has a problem. Files can be made, not
 * deleted or renamed, so nothing that names one is left without it.
 */
export class LootEditor {
  private files: Files;
  /** What each file holds on disk; a new one isn't here until saved. */
  private readonly saved = new Map<string, string>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** Set while a drag is going on: its changes after the first join the same undo step. */
  private gesture = false;
  private state: LootEditorState;
  private readonly listeners = new Set<() => void>();

  constructor(
    tables: ReadonlyMap<string, LootTableDef>,
    containers: ReadonlyMap<string, LootContainerDef>,
    current: string,
    /** What a new blank table starts with. */
    private readonly firstItem: string,
  ) {
    const files = new Map<string, string>();
    const add = (kind: LootFileKind, id: string, doc: unknown) => {
      const json = JSON.stringify(doc);
      files.set(fileKey(kind, id), json);
      this.saved.set(fileKey(kind, id), json);
    };
    for (const [id, doc] of tables) add('table', id, doc);
    for (const [id, doc] of containers) add('container', id, doc);
    this.files = files;
    this.state = {
      tables: new Map(),
      containers: new Map(),
      current: files.has(current) ? current : ([...files.keys()][0] ?? ''),
      problems: new Map(),
      problem: null,
      unsaved: [],
      canUndo: false,
      canRedo: false,
      saving: false,
      message: null,
    };
    this.refresh();
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('beforeunload', (e) => {
      if (this.state.unsaved.length) e.preventDefault();
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): LootEditorState => this.state;

  private set(patch: Partial<LootEditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  select(key: string): void {
    if (!this.files.has(key) || key === this.state.current) return;
    history.replaceState(null, '', `?open=${key}`);
    this.set({ current: key, message: null });
  }

  /**
   * Changes the open file's doc. With `gesture`, a change made while one is going on
   * (see beginGesture) joins the step its first change made.
   */
  edit(change: (doc: Doc) => void, gesture = false): void {
    const key = this.state.current;
    const before = this.files.get(key);
    if (before === undefined) return;
    const doc = JSON.parse(before) as Doc;
    change(doc);
    const json = JSON.stringify(doc);
    if (json === before) return;
    if (!(gesture && this.gesture)) this.push();
    if (gesture) this.gesture = true;
    this.files = new Map(this.files).set(key, json);
    this.refresh();
  }

  /** A drag starts: its edits will be one undo step. */
  beginGesture(): void {
    this.gesture = false;
  }

  endGesture(): void {
    this.gesture = false;
  }

  /** Makes a new table or container kind, blank or (with `from`, a key) a copy, and opens it. */
  create(kind: LootFileKind, id: string, name: string, from?: string): void {
    const key = fileKey(kind, id);
    if (this.files.has(key)) return this.set({ message: `There's already a ${kind} "${id}".` });
    const source = from === undefined ? undefined : this.files.get(from);
    const firstTable = [...this.files.keys()].map(parseKey).find((k) => k.kind === 'table');
    const doc =
      source !== undefined
        ? { ...(JSON.parse(source) as Doc), id, name }
        : kind === 'table'
          ? blankLootTable(id, name, this.firstItem)
          : blankLootContainer(id, name, firstTable?.id ?? 'household');
    this.push();
    this.files = new Map(this.files).set(key, JSON.stringify(doc));
    history.replaceState(null, '', `?open=${key}`);
    this.state = { ...this.state, current: key };
    this.refresh(
      kind === 'table'
        ? `Made ${id}: it's saved with the next save. Point containers at it here or in the map editor.`
        : `Made ${id}: it's saved with the next save. Place it in the map editor (a loot container's kind).`,
    );
  }

  private push(): void {
    this.undoStack.push({ files: this.files, current: this.state.current });
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push({ files: this.files, current: this.state.current });
    this.restore(s);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push({ files: this.files, current: this.state.current });
    this.restore(s);
  }

  /** Goes back to a snapshot, showing the file that changed (or the one it had open). */
  private restore(s: Snapshot): void {
    const changed = [...s.files.keys(), ...this.files.keys()].find(
      (key) => s.files.get(key) !== this.files.get(key),
    );
    this.files = s.files;
    const current = changed !== undefined && s.files.has(changed) ? changed : s.current;
    if (current !== this.state.current) history.replaceState(null, '', `?open=${current}`);
    this.state = { ...this.state, current: s.files.has(current) ? current : s.current };
    this.refresh();
  }

  /** Parses and checks every file after a change. */
  private refresh(message: string | null = null): void {
    const tables = new Map<string, LootTableDef>();
    const containers = new Map<string, LootContainerDef>();
    const problems = new Map<string, string>();
    const tableDb = new Map<string, LootTableDef>();
    const containerDb = new Map<string, LootContainerDef>();
    for (const [key, json] of this.files) {
      const { kind, id } = parseKey(key);
      const source = `content/${key}.json`;
      try {
        if (kind === 'table') {
          tables.set(id, JSON.parse(json) as LootTableDef);
          tableDb.set(id, loadContent(LOOT_TABLE_FORMAT, JSON.parse(json), source));
        } else {
          containers.set(id, JSON.parse(json) as LootContainerDef);
          containerDb.set(id, loadContent(LOOT_CONTAINER_FORMAT, JSON.parse(json), source));
        }
      } catch (err) {
        problems.set(key, err instanceof Error ? err.message : String(err));
      }
    }
    let problem = [...problems.values()][0] ?? null;
    if (!problem) problem = lootTableContentProblem(tableDb);
    if (!problem) {
      try {
        checkLootKinds(containerDb, tableDb);
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }
    }
    this.set({
      tables,
      containers,
      problems,
      problem,
      unsaved: [...this.files]
        .filter(([key, json]) => this.saved.get(key) !== json)
        .map(([key]) => key),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      message,
    });
  }

  /** Saves every changed file in one request; refused while anything has a problem. */
  async save(): Promise<void> {
    const { problem, unsaved } = this.state;
    if (problem) return this.set({ message: `Not saved: ${problem}` });
    if (!unsaved.length) return this.set({ message: 'Nothing to save.' });
    const files = unsaved.map((key) => ({ key, json: this.files.get(key)! }));
    this.set({ saving: true });
    try {
      const res = await fetch('/__editor/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          files: files.map(({ key, json }) => ({
            file: `${key}.json`,
            doc: JSON.parse(json) as unknown,
            ...(!this.saved.has(key) && { create: true }),
          })),
        }),
      });
      const reply = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
      for (const { key, json } of files) this.saved.set(key, json);
      this.refresh(`Saved ${files.map(({ key }) => `content/${key}.json`).join(', ')}.`);
      this.set({ saving: false });
    } catch (err) {
      this.set({
        saving: false,
        message: `Not saved: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  private key(e: KeyboardEvent): void {
    if (!(e.metaKey || e.ctrlKey)) return;
    const t = e.target;
    const typing =
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLInputElement && !['checkbox', 'range'].includes(t.type));
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      // A field commits when it's left, so the save has what's being typed.
      (document.activeElement as HTMLElement | null)?.blur();
      void this.save();
      return;
    }
    // Inside a text box, undo is the box's own.
    if (typing) return;
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (k === 'y') {
      e.preventDefault();
      this.redo();
    }
  }
}
