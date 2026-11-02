import {
  LOOT_TABLE_FORMAT,
  LOOT_TABLE_FORMAT_VERSION,
  loadContent,
  type LootTableDef,
} from '@mes/shared';
import { lootTableContentProblem } from '../content';
import type { Doc } from '../editor/bound-fields';

/** Every loot table file's JSON by id. */
type Files = ReadonlyMap<string, string>;

interface Snapshot {
  files: Files;
  current: string;
}

export interface LootEditorState {
  /** Every table as edited, parsed from its JSON (it may not pass the schema). */
  tables: ReadonlyMap<string, LootTableDef>;
  current: string;
  /** Each table's own problem (its schema), by id. */
  problems: ReadonlyMap<string, string>;
  /** The first problem anywhere, its own or one the items or enemies find: nothing saves while set. */
  problem: string | null;
  /** Changed or new tables, by id. */
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

/**
 * The loot editor at /loot-editor (2026-11-01), like the sound editor: every loot table
 * file at once, edited as its own JSON (so saving keeps its key order), with one undo
 * history across them. Saving writes every changed table in one request, refused while
 * anything has a problem. Tables can be made, not deleted or renamed, so nothing that names
 * one is left without it.
 */
export class LootEditor {
  private files: Files;
  /** What each file holds on disk; a new table isn't here until saved. */
  private readonly saved = new Map<string, string>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** Set while a drag is going on: its changes after the first join the same undo step. */
  private gesture = false;
  private state: LootEditorState;
  private readonly listeners = new Set<() => void>();

  constructor(
    sources: ReadonlyMap<string, LootTableDef>,
    current: string,
    /** What a new blank table starts with. */
    private readonly firstItem: string,
  ) {
    const files = new Map<string, string>();
    for (const [id, doc] of sources) {
      const json = JSON.stringify(doc);
      files.set(id, json);
      this.saved.set(id, json);
    }
    this.files = files;
    this.state = {
      tables: new Map(),
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

  select(id: string): void {
    if (!this.files.has(id) || id === this.state.current) return;
    history.replaceState(null, '', `?table=${id}`);
    this.set({ current: id, message: null });
  }

  /**
   * Changes the open table's doc. With `gesture`, a change made while one is going on
   * (see beginGesture) joins the step its first change made.
   */
  edit(change: (doc: Doc) => void, gesture = false): void {
    const id = this.state.current;
    const before = this.files.get(id);
    if (before === undefined) return;
    const doc = JSON.parse(before) as Doc;
    change(doc);
    const json = JSON.stringify(doc);
    if (json === before) return;
    if (!(gesture && this.gesture)) this.push();
    if (gesture) this.gesture = true;
    this.files = new Map(this.files).set(id, json);
    this.refresh();
  }

  /** A drag starts: its edits will be one undo step. */
  beginGesture(): void {
    this.gesture = false;
  }

  endGesture(): void {
    this.gesture = false;
  }

  /** Makes a new table, blank or (with `from`) a copy of another, and opens it. */
  create(id: string, name: string, from?: string): void {
    if (this.files.has(id)) return this.set({ message: `There's already a table "${id}".` });
    const source = from === undefined ? undefined : this.files.get(from);
    const doc =
      source !== undefined
        ? { ...(JSON.parse(source) as Doc), id, name }
        : blankLootTable(id, name, this.firstItem);
    this.push();
    this.files = new Map(this.files).set(id, JSON.stringify(doc));
    history.replaceState(null, '', `?table=${id}`);
    this.state = { ...this.state, current: id };
    this.refresh(`Made ${id}: it's saved with the next save. Point markers at it in the map editor.`);
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

  /** Goes back to a snapshot, showing the table that changed (or the one it had open). */
  private restore(s: Snapshot): void {
    const changed = [...s.files.keys(), ...this.files.keys()].find(
      (id) => s.files.get(id) !== this.files.get(id),
    );
    this.files = s.files;
    const current = changed !== undefined && s.files.has(changed) ? changed : s.current;
    if (current !== this.state.current) history.replaceState(null, '', `?table=${current}`);
    this.state = { ...this.state, current: s.files.has(current) ? current : s.current };
    this.refresh();
  }

  /** Parses and checks every file after a change. */
  private refresh(message: string | null = null): void {
    const tables = new Map<string, LootTableDef>();
    const problems = new Map<string, string>();
    const db = new Map<string, LootTableDef>();
    for (const [id, json] of this.files) {
      tables.set(id, JSON.parse(json) as LootTableDef);
      try {
        db.set(
          id,
          loadContent(LOOT_TABLE_FORMAT, JSON.parse(json), `content/loot-tables/${id}.json`),
        );
      } catch (err) {
        problems.set(id, err instanceof Error ? err.message : String(err));
      }
    }
    const problem =
      problems.size === 0 ? lootTableContentProblem(db) : ([...problems.values()][0] ?? null);
    this.set({
      tables,
      problems,
      problem,
      unsaved: [...this.files]
        .filter(([id, json]) => this.saved.get(id) !== json)
        .map(([id]) => id),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      message,
    });
  }

  /** Saves every changed table in one request; refused while anything has a problem. */
  async save(): Promise<void> {
    const { problem, unsaved } = this.state;
    if (problem) return this.set({ message: `Not saved: ${problem}` });
    if (!unsaved.length) return this.set({ message: 'Nothing to save.' });
    const files = unsaved.map((id) => ({ id, json: this.files.get(id)! }));
    this.set({ saving: true });
    try {
      const res = await fetch('/__editor/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          files: files.map(({ id, json }) => ({
            file: `loot-tables/${id}.json`,
            doc: JSON.parse(json) as unknown,
            ...(!this.saved.has(id) && { create: true }),
          })),
        }),
      });
      const reply = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
      for (const { id, json } of files) this.saved.set(id, json);
      this.refresh(`Saved ${files.map(({ id }) => `content/loot-tables/${id}.json`).join(', ')}.`);
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
