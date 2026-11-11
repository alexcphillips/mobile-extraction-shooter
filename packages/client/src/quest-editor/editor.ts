import {
  QUEST_FORMAT,
  QUEST_FORMAT_VERSION,
  checkQuests,
  loadContent,
  type ItemDb,
  type QuestDef,
  type QuestObjective,
  type VendorDef,
} from '@mes/shared';
import { questMarkerProblem } from '../content';
import { canRequire, newObjectiveId, newQuestId, rewireForDelete } from './chain';

/*
 * The quest editor at /quest-editor (2026-11-11, the user's request): every quest at once,
 * each edited as its own JSON (so saving keeps its key order), with one undo history across
 * them. Saving writes every changed, new and deleted file in one request, refused while
 * anything is wrong, so a chain is never saved half-changed. See chain.ts for why ids are
 * random and fixed, and what deleting does.
 */

/** A quest file as written: the schema's defaults may be left out. */
export type QuestDoc = Omit<QuestDef, 'requires' | 'rewards'> & {
  requires?: string[];
  rewards?: Partial<QuestDef['rewards']>;
};

interface Snapshot {
  files: ReadonlyMap<string, string>;
  current: string;
}

export interface QuestEditorState {
  /** Every quest as edited, by id, in file order. */
  quests: ReadonlyMap<string, QuestDoc>;
  current: string;
  /** Problems by quest id: its own (the schema), or the first one the checks pin on it. */
  problems: ReadonlyMap<string, string>;
  /** The first problem anywhere: nothing saves while set. */
  problem: string | null;
  /** Quests changed, new or deleted since the last save, by id. */
  unsaved: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  message: string | null;
}

/** What the editor checks against: the rest of content, as the game loads it. */
export interface QuestWorld {
  vendors: ReadonlyMap<string, VendorDef>;
  items: ItemDb;
  /** Each map's quest marker ids, by map. */
  markers: ReadonlyMap<string, readonly string[]>;
}

const UNDO_DEPTH = 200;

/** The fields that say what an objective asks for: a change to one resets its progress. */
const ASKS = ['type', 'item', 'map', 'marker'] as const;

export class QuestEditor {
  private files: ReadonlyMap<string, string>;
  /** What each file holds on disk; a new one isn't here until saved. */
  private readonly saved = new Map<string, string>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private state: QuestEditorState;
  private readonly listeners = new Set<() => void>();

  constructor(
    docs: ReadonlyMap<string, unknown>,
    readonly world: QuestWorld,
    current: string,
  ) {
    const files = new Map<string, string>();
    for (const [id, doc] of docs) {
      const json = JSON.stringify(doc);
      files.set(id, json);
      this.saved.set(id, json);
    }
    this.files = files;
    this.state = {
      quests: new Map(),
      current: files.has(current) ? current : '',
      problems: new Map(),
      problem: null,
      unsaved: [],
      canUndo: false,
      canRedo: false,
      saving: false,
      message: null,
    };
    this.refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => this.key(e));
      window.addEventListener('beforeunload', (e) => {
        if (this.state.unsaved.length) e.preventDefault();
      });
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): QuestEditorState => this.state;

  private set(patch: Partial<QuestEditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Opens a quest, or (with '') none. */
  select(id: string): void {
    if (id !== '' && !this.files.has(id)) return;
    if (id === this.state.current) return;
    if (typeof history !== 'undefined')
      history.replaceState(null, '', id ? `?open=${id}` : location.pathname);
    this.set({ current: id, message: null });
  }

  /** Changes quests by id, as one undo step. */
  private change(changes: ReadonlyMap<string, (q: QuestDoc) => void>, message?: string): void {
    const next = new Map(this.files);
    for (const [id, change] of changes) {
      const before = next.get(id);
      if (before === undefined) continue;
      const doc = JSON.parse(before) as QuestDoc;
      change(doc);
      next.set(id, JSON.stringify(doc));
    }
    if ([...next].every(([id, json]) => this.files.get(id) === json)) return;
    this.push();
    this.files = next;
    this.refresh(message);
  }

  /** Changes one quest (the open one by default). */
  edit(change: (q: QuestDoc) => void, id = this.state.current): void {
    this.change(new Map([[id, change]]));
  }

  /**
   * Changes the open quest's objective at `index`. If what it asks for changes (its type,
   * item, map or marker) it gets a new id, so progress made on the old ask doesn't count.
   */
  editObjective(index: number, change: (o: QuestObjective) => void): void {
    this.edit((q) => {
      const o = q.objectives[index];
      if (!o) return;
      const before = ASKS.map((k) => (o as Record<string, unknown>)[k]);
      change(o);
      const after = ASKS.map((k) => (o as Record<string, unknown>)[k]);
      if (before.some((v, i) => v !== after[i]))
        o.id = newObjectiveId(q.objectives.map((x) => x.id));
    });
  }

  /** Adds an objective of a type to the open quest, filled in with something valid-looking. */
  addObjective(type: QuestObjective['type']): void {
    this.edit((q) => {
      q.objectives.push(this.blankObjective(type, newObjectiveId(q.objectives.map((o) => o.id))));
    });
  }

  /** Changes an objective's type, starting the new type's fields afresh but keeping its text. */
  retypeObjective(index: number, type: QuestObjective['type']): void {
    this.editObjective(index, (o) => {
      if (o.type === type) return;
      const fresh = this.blankObjective(type, o.id);
      const text = o.text;
      for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
      Object.assign(o, fresh, text !== undefined && { text });
    });
  }

  blankObjective(type: QuestObjective['type'], id: string): QuestObjective {
    const { items, markers } = this.world;
    const map = [...markers].find(([, m]) => m.length)?.[0] ?? [...markers.keys()][0] ?? '';
    const marker = markers.get(map)?.[0] ?? '';
    const sorted = [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (type === 'investigate') return { id, type, map, marker, text: 'Look around' };
    if (type === 'extract') {
      const item = sorted.find((d) => d.type === 'quest')?.id ?? '';
      return { id, type, item, map, spots: marker ? [marker] : [] };
    }
    const item =
      sorted.find((d) => d.type !== 'quest' && d.type !== 'melee' && d.value > 0)?.id ?? '';
    return { id, type, item, count: 1 };
  }

  /** Makes `quest` require `other`, unless that would loop. */
  require(quest: string, other: string): void {
    const { quests } = this.state;
    if (!canRequire(quests, quest, other)) {
      const why =
        quest === other
          ? "A quest can't require itself."
          : quests.get(quest)?.requires?.includes(other)
            ? 'It already requires that.'
            : `That would make a loop: ${this.name(other)} already needs ${this.name(quest)} first.`;
      return this.set({ message: why });
    }
    this.change(
      new Map([[quest, (q: QuestDoc) => (q.requires = [...(q.requires ?? []), other])]]),
      `${this.name(other)} now unlocks ${this.name(quest)}.`,
    );
  }

  unrequire(quest: string, other: string): void {
    this.edit((q) => {
      q.requires = (q.requires ?? []).filter((r) => r !== other);
      if (!q.requires.length) delete q.requires;
    }, quest);
  }

  /**
   * Makes a new quest for a vendor and opens it: blank, a copy of `from`, or (with
   * `after`) unlocked by that quest.
   */
  create(opts: { vendor: string; from?: string; after?: string }): string {
    const id = newQuestId((x) => this.files.has(x) || this.saved.has(x));
    const source = opts.from === undefined ? undefined : this.files.get(opts.from);
    let doc: QuestDoc;
    if (source !== undefined) {
      const copy = JSON.parse(source) as QuestDoc;
      doc = { ...copy, id, name: `${copy.name} (copy)` };
      // A copy's objectives get ids of their own, though they could keep them.
      const ids: string[] = [];
      for (const o of doc.objectives) ids.push((o.id = newObjectiveId(ids)));
    } else {
      doc = {
        formatVersion: QUEST_FORMAT_VERSION,
        id,
        name: 'New quest',
        vendor: opts.vendor,
        description: 'What the vendor says when they give it.',
        objectives: [this.blankObjective('handOver', newObjectiveId([]))],
        rewards: { money: 0, items: [], rep: 0 },
      };
    }
    doc.vendor = opts.vendor;
    if (opts.after !== undefined) {
      // After the description, where the hand-written files have it.
      const { objectives, rewards, ...head } = doc;
      doc = { ...head, requires: [opts.after], objectives, ...(rewards && { rewards }) };
    }
    this.push();
    this.files = new Map(this.files).set(id, JSON.stringify(doc));
    this.state = { ...this.state, current: id };
    if (typeof history !== 'undefined') history.replaceState(null, '', `?open=${id}`);
    this.refresh(`Made "${doc.name}": it's saved with the next save.`);
    return id;
  }

  /**
   * Deletes a quest. The quests it unlocked take its requirements instead (rewireForDelete),
   * in the same undo step and the same save.
   */
  remove(id: string): void {
    if (!this.files.has(id)) return;
    const name = this.name(id);
    const rewired = rewireForDelete(this.state.quests, id);
    this.push();
    const next = new Map(this.files);
    next.delete(id);
    for (const [d, requires] of rewired) {
      const doc = JSON.parse(next.get(d)!) as QuestDoc;
      if (requires.length) doc.requires = requires;
      else delete doc.requires;
      next.set(d, JSON.stringify(doc));
    }
    this.files = next;
    if (this.state.current === id) {
      this.state = { ...this.state, current: '' };
      if (typeof history !== 'undefined') history.replaceState(null, '', location.pathname);
    }
    this.refresh(
      rewired.size
        ? `Deleted "${name}". ${[...rewired.keys()].map((d) => this.name(d)).join(', ')} now open${rewired.size === 1 ? 's' : ''} where it did.`
        : `Deleted "${name}".`,
    );
  }

  /** A quest's name, or its id if it has none. */
  name(id: string): string {
    return this.state.quests.get(id)?.name || id;
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

  /** Goes back to a snapshot, opening the quest that changed if it's still there. */
  private restore(s: Snapshot): void {
    const changed = [...s.files.keys()].find((id) => s.files.get(id) !== this.files.get(id));
    this.files = s.files;
    const current = changed ?? (s.files.has(s.current) ? s.current : '');
    this.state = { ...this.state, current };
    if (typeof history !== 'undefined')
      history.replaceState(null, '', current ? `?open=${current}` : location.pathname);
    this.refresh();
  }

  /** Parses and checks every quest after a change. */
  private refresh(message: string | null = null): void {
    const quests = new Map<string, QuestDoc>();
    const problems = new Map<string, string>();
    const db = new Map<string, QuestDef>();
    for (const [id, json] of this.files) {
      quests.set(id, JSON.parse(json) as QuestDoc);
      try {
        db.set(id, loadContent(QUEST_FORMAT, JSON.parse(json), `content/quests/${id}.json`));
      } catch (err) {
        problems.set(id, err instanceof Error ? err.message : String(err));
      }
    }
    let problem = [...problems.values()][0] ?? null;
    if (!problem) {
      try {
        checkQuests(db, this.world.vendors, this.world.items);
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }
    }
    problem ??= questMarkerProblem(db, (m) => this.world.markers.get(m));
    // Pin a whole-content problem on the quest it names, for its card.
    if (problem && !problems.size) {
      const id = /quests\/([a-z0-9-]+)\.json|^quest ([a-z0-9-]+):/.exec(problem);
      const of = id?.[1] ?? id?.[2];
      if (of) problems.set(of, problem);
    }
    const ids = new Set([...this.files.keys(), ...this.saved.keys()]);
    this.set({
      quests,
      problems,
      problem,
      unsaved: [...ids].filter((id) => this.saved.get(id) !== this.files.get(id)),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      message,
    });
  }

  /** Saves every changed, new and deleted quest in one request; refused while anything is wrong. */
  async save(): Promise<void> {
    const { problem, unsaved } = this.state;
    if (problem) return this.set({ message: `Not saved: ${problem}` });
    if (!unsaved.length) return this.set({ message: 'Nothing to save.' });
    const files = unsaved.map((id) => ({ id, json: this.files.get(id) }));
    this.set({ saving: true });
    try {
      const res = await fetch('/__editor/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          files: files.map(({ id, json }) =>
            json === undefined
              ? { file: `quests/${id}.json`, delete: true }
              : {
                  file: `quests/${id}.json`,
                  doc: JSON.parse(json) as unknown,
                  ...(!this.saved.has(id) && { create: true }),
                },
          ),
        }),
      });
      const reply = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
      for (const { id, json } of files) {
        if (json === undefined) this.saved.delete(id);
        else this.saved.set(id, json);
      }
      const n = files.length;
      this.refresh(`Saved ${n} quest file${n === 1 ? '' : 's'}.`);
      this.set({ saving: false });
    } catch (err) {
      this.set({
        saving: false,
        message: `Not saved: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  private key(e: KeyboardEvent): void {
    const t = e.target;
    const typing =
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement ||
      (t instanceof HTMLInputElement && !['checkbox', 'range'].includes(t.type));
    if (e.key === 'Escape' && !typing) return this.select('');
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
