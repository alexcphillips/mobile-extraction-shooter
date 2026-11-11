import {
  ITEM_FORMAT,
  bagCells,
  bagRarity,
  loadContent,
  type ItemDb,
  type ItemDef,
} from '@mes/shared';
import { itemContentProblem } from '../content';
import { storageRisks } from './risk';
import { blankItem, retype, type ItemType } from './templates';

/** A rig's or backpack's cells (bagCells), or null for anything else or one not valid yet. */
function cellsOf(doc: Doc | null): number | null {
  if (!doc || doc.type !== 'container' || doc.slot === 'vault') return null;
  const grid = doc.grid;
  const sections = doc.sections;
  if (!Array.isArray(grid) || !grid.every((n) => typeof n === 'number')) return null;
  if (sections !== undefined && !Array.isArray(sections)) return null;
  const n = bagCells(doc as Parameters<typeof bagCells>[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Auto-fill (2026-11-11, the user's call): when a rig's or backpack's cells change (its
 * grid or sections, or it becomes one), its rarity is set from them (bagRarity). Picking a
 * rarity by hand afterwards overrides it until the cells change again.
 */
export function fillBagRarity(before: Doc | null, doc: Doc): void {
  const cells = cellsOf(doc);
  if (cells === null || cells === cellsOf(before)) return;
  doc.rarity = bagRarity(doc as Parameters<typeof bagRarity>[0]);
}

/** Every item file's JSON by item id. */
type Files = ReadonlyMap<string, string>;

/** A raw item doc, edited in place by a change. */
export type Doc = Record<string, unknown>;

interface Snapshot {
  files: Files;
  current: string;
}

export interface ItemEditorState {
  /** Every item as edited, parsed from its JSON (it may not pass the schema). */
  items: ReadonlyMap<string, ItemDef>;
  current: string;
  /** Each item's own problem (its schema), by id. */
  problems: ReadonlyMap<string, string>;
  /** The first problem anywhere, its own or what it breaks elsewhere: nothing saves while set. */
  problem: string | null;
  /** The items as one database, when every one passes its schema. */
  db: ItemDb | null;
  /** What each changed item can break in saved stashes (risk.ts), by id. */
  risks: ReadonlyMap<string, string[]>;
  /** Changed or new items, by id. */
  unsaved: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  message: string | null;
}

const UNDO_DEPTH = 200;

/**
 * The item editor at /item-editor (session 18): every item file at once, edited as its own
 * JSON (so saving keeps its key order), with one undo history across them and the same
 * checks the game and server run on the rest of content/. Saving writes every changed
 * item in one request, refused while anything has a problem.
 */
export class ItemEditor {
  private files: Files;
  /** What each file holds on disk; a new item isn't here until saved. */
  private readonly saved = new Map<string, string>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** Set while a drag is going on: its changes after the first join the same undo step. */
  private gesture = false;
  private state: ItemEditorState;
  private readonly listeners = new Set<() => void>();

  constructor(sources: ReadonlyMap<string, ItemDef>, current: string) {
    const files = new Map<string, string>();
    for (const [id, doc] of sources) {
      const json = JSON.stringify(doc);
      files.set(id, json);
      this.saved.set(id, json);
    }
    this.files = files;
    this.state = {
      items: new Map(),
      current: files.has(current) ? current : ([...files.keys()][0] ?? ''),
      problems: new Map(),
      problem: null,
      db: null,
      risks: new Map(),
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

  readonly getState = (): ItemEditorState => this.state;

  private set(patch: Partial<ItemEditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  select(id: string): void {
    if (!this.files.has(id) || id === this.state.current) return;
    history.replaceState(null, '', `?item=${id}`);
    this.set({ current: id, message: null });
  }

  /**
   * Changes the current item's doc. With `gesture`, a change made while one is going on
   * (see beginGesture) joins the step its first change made.
   */
  edit(change: (doc: Doc) => void, gesture = false): void {
    const id = this.state.current;
    const before = this.files.get(id);
    if (before === undefined) return;
    const doc = JSON.parse(before) as Doc;
    change(doc);
    fillBagRarity(JSON.parse(before) as Doc, doc);
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

  /** Turns the current item into another type (see retype), as one undo step. */
  changeType(type: ItemType): void {
    // From its file, not the item list, so an item that doesn't validate yet can change too.
    const file = this.files.get(this.state.current);
    if (file === undefined) return;
    const def = JSON.parse(file) as ItemDef;
    if (def.type === type) return;
    const ammo = [...this.state.items.values()].find((d) => d.type === 'ammo')?.id;
    const next = retype(def, type, ammo) as unknown as Doc;
    this.edit((doc) => {
      for (const k of Object.keys(doc)) delete doc[k];
      Object.assign(doc, next);
    });
  }

  /** Makes a new item, blank or (with `from`) a copy of another, and opens it. */
  create(type: ItemType, id: string, name: string, from?: string): void {
    if (this.files.has(id)) return this.set({ message: `There's already an item "${id}".` });
    let doc: Doc;
    const source = from === undefined ? undefined : this.files.get(from);
    if (source !== undefined) {
      doc = { ...(JSON.parse(source) as Doc), id, name };
    } else {
      const ammo = [...this.state.items.values()].find((d) => d.type === 'ammo')?.id;
      doc = blankItem(type, id, name, ammo) as unknown as Doc;
      fillBagRarity(null, doc);
    }
    this.push();
    this.files = new Map(this.files).set(id, JSON.stringify(doc));
    history.replaceState(null, '', `?item=${id}`);
    this.state = { ...this.state, current: id };
    this.refresh(`Made ${id}: it's saved with the next save.`);
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

  /** Goes back to a snapshot, showing the item that changed (or the one it had open). */
  private restore(s: Snapshot): void {
    const changed = [...s.files.keys(), ...this.files.keys()].find(
      (id) => s.files.get(id) !== this.files.get(id),
    );
    this.files = s.files;
    const current = changed !== undefined && s.files.has(changed) ? changed : s.current;
    if (current !== this.state.current) history.replaceState(null, '', `?item=${current}`);
    this.state = { ...this.state, current: s.files.has(current) ? current : s.current };
    this.refresh();
  }

  /** Parses and checks every file after a change. */
  private refresh(message: string | null = null): void {
    const items = new Map<string, ItemDef>();
    const problems = new Map<string, string>();
    const db = new Map<string, ItemDef>();
    for (const [id, json] of this.files) {
      const doc = JSON.parse(json) as ItemDef;
      items.set(id, doc);
      try {
        db.set(id, loadContent(ITEM_FORMAT, JSON.parse(json), `content/items/${id}.json`));
      } catch (err) {
        problems.set(id, err instanceof Error ? err.message : String(err));
      }
    }
    const valid = problems.size === 0;
    const problem = valid ? itemContentProblem(db) : ([...problems.values()][0] ?? null);
    const unsaved = [...this.files].filter(([id, json]) => this.saved.get(id) !== json);
    const risks = new Map<string, string[]>();
    for (const [id] of unsaved) {
      const was = this.saved.get(id);
      const now = db.get(id);
      if (was === undefined || !now) continue;
      const found = storageRisks(JSON.parse(was) as ItemDef, now);
      if (found.length) risks.set(id, found);
    }
    this.set({
      items,
      problems,
      problem,
      db: valid ? db : null,
      risks,
      unsaved: unsaved.map(([id]) => id),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      message,
    });
  }

  /** Saves every changed item in one request; refused while anything has a problem. */
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
            file: `items/${id}.json`,
            doc: JSON.parse(json) as unknown,
            ...(!this.saved.has(id) && { create: true }),
          })),
        }),
      });
      const reply = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
      for (const { id, json } of files) this.saved.set(id, json);
      this.refresh(`Saved ${files.map(({ id }) => `content/items/${id}.json`).join(', ')}.`);
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
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      // A field commits when it's left, so the save has what's being typed.
      (document.activeElement as HTMLElement | null)?.blur();
      void this.save();
      return;
    }
    // Inside a text box, undo is the box's own.
    const t = e.target;
    if (t instanceof HTMLTextAreaElement) return;
    if (t instanceof HTMLInputElement && !['checkbox', 'color'].includes(t.type)) return;
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
