import {
  SOUND_FORMAT,
  SOUND_FORMAT_VERSION,
  loadContent,
  type SoundDb,
  type SoundDef,
} from '@mes/shared';
import { soundContentProblem } from '../content';
import type { Doc } from '../editor/bound-fields';

/** Every sound file's JSON by id. */
type Files = ReadonlyMap<string, string>;

interface Snapshot {
  files: Files;
  current: string;
}

export interface SoundEditorState {
  /** Every sound as edited, parsed from its JSON (it may not pass the schema). */
  sounds: ReadonlyMap<string, SoundDef>;
  current: string;
  /** Each sound's own problem (its schema), by id. */
  problems: ReadonlyMap<string, string>;
  /** The first problem anywhere, its own or a sound the items or game need gone: nothing saves while set. */
  problem: string | null;
  /** The sounds as one database, when every one passes its schema. */
  db: SoundDb | null;
  /** Changed or new sounds, by id. */
  unsaved: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  message: string | null;
}

const UNDO_DEPTH = 200;

/** A new sound to start from: a short click of white noise. */
export function blankSound(id: string, name: string): SoundDef {
  return {
    formatVersion: SOUND_FORMAT_VERSION,
    id,
    name,
    gain: 1,
    range: 20,
    pitchJitter: 0.05,
    layers: [
      { source: 'noise', colour: 'white', at: 0, attack: 0.001, hold: 0, decay: 0.1, gain: 0.5 },
    ],
  };
}

/**
 * The sound editor at /sounds (session 19), like the item editor: every sound file at once,
 * edited as its own JSON (so saving keeps its key order), with one undo history across
 * them. Saving writes every changed sound in one request, refused while anything has a
 * problem. Space plays the open sound.
 */
export class SoundEditor {
  private files: Files;
  /** What each file holds on disk; a new sound isn't here until saved. */
  private readonly saved = new Map<string, string>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** Set while a drag is going on: its changes after the first join the same undo step. */
  private gesture = false;
  private state: SoundEditorState;
  private readonly listeners = new Set<() => void>();

  constructor(
    sources: ReadonlyMap<string, SoundDef>,
    current: string,
    private readonly play: () => void,
  ) {
    const files = new Map<string, string>();
    for (const [id, doc] of sources) {
      const json = JSON.stringify(doc);
      files.set(id, json);
      this.saved.set(id, json);
    }
    this.files = files;
    this.state = {
      sounds: new Map(),
      current: files.has(current) ? current : ([...files.keys()][0] ?? ''),
      problems: new Map(),
      problem: null,
      db: null,
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

  readonly getState = (): SoundEditorState => this.state;

  private set(patch: Partial<SoundEditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  select(id: string): void {
    if (!this.files.has(id) || id === this.state.current) return;
    history.replaceState(null, '', `?sound=${id}`);
    this.set({ current: id, message: null });
  }

  /**
   * Changes the open sound's doc. With `gesture`, a change made while one is going on
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

  /** Makes a new sound, blank or (with `from`) a copy of another, and opens it. */
  create(id: string, name: string, from?: string): void {
    if (this.files.has(id)) return this.set({ message: `There's already a sound "${id}".` });
    const source = from === undefined ? undefined : this.files.get(from);
    const doc =
      source !== undefined ? { ...(JSON.parse(source) as Doc), id, name } : blankSound(id, name);
    this.push();
    this.files = new Map(this.files).set(id, JSON.stringify(doc));
    history.replaceState(null, '', `?sound=${id}`);
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

  /** Goes back to a snapshot, showing the sound that changed (or the one it had open). */
  private restore(s: Snapshot): void {
    const changed = [...s.files.keys(), ...this.files.keys()].find(
      (id) => s.files.get(id) !== this.files.get(id),
    );
    this.files = s.files;
    const current = changed !== undefined && s.files.has(changed) ? changed : s.current;
    if (current !== this.state.current) history.replaceState(null, '', `?sound=${current}`);
    this.state = { ...this.state, current: s.files.has(current) ? current : s.current };
    this.refresh();
  }

  /** Parses and checks every file after a change. */
  private refresh(message: string | null = null): void {
    const sounds = new Map<string, SoundDef>();
    const problems = new Map<string, string>();
    const db = new Map<string, SoundDef>();
    for (const [id, json] of this.files) {
      sounds.set(id, JSON.parse(json) as SoundDef);
      try {
        db.set(id, loadContent(SOUND_FORMAT, JSON.parse(json), `content/sounds/${id}.json`));
      } catch (err) {
        problems.set(id, err instanceof Error ? err.message : String(err));
      }
    }
    const valid = problems.size === 0;
    const problem = valid ? soundContentProblem(db) : ([...problems.values()][0] ?? null);
    this.set({
      sounds,
      problems,
      problem,
      db: valid ? db : null,
      unsaved: [...this.files]
        .filter(([id, json]) => this.saved.get(id) !== json)
        .map(([id]) => id),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      message,
    });
  }

  /** Saves every changed sound in one request; refused while anything has a problem. */
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
            file: `sounds/${id}.json`,
            doc: JSON.parse(json) as unknown,
            ...(!this.saved.has(id) && { create: true }),
          })),
        }),
      });
      const reply = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
      for (const { id, json } of files) this.saved.set(id, json);
      this.refresh(`Saved ${files.map(({ id }) => `content/sounds/${id}.json`).join(', ')}.`);
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
      (t instanceof HTMLInputElement && !['checkbox', 'color', 'range'].includes(t.type));
    // A select or button takes space itself.
    const takesSpace = typing || t instanceof HTMLSelectElement || t instanceof HTMLButtonElement;
    if (e.key === ' ' && !takesSpace && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.play();
      return;
    }
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
