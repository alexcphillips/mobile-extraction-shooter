import {
  MAP_FORMAT,
  compileMap,
  loadContent,
  type MapFile,
  type MapNode,
  type PrefabLookup,
} from '@mes/shared';
import * as THREE from 'three';
import { checkDoorKeys, checkEnemySpawns, checkLootContainers, loadQuests } from '../content';
import {
  collectIds,
  copyNode,
  groupNodes,
  moveWith,
  nodeAt,
  nodePos,
  nodeYaw,
  nodesAt,
  placeNode,
  round,
  ungroup,
  type NodePath,
} from './doc';
import { EditorView, typing, type Moved } from './view';

export type Placeable = 'box' | 'cylinder' | 'ramp' | 'stairs' | 'ladder';
export const PLACEABLE: readonly Placeable[] = ['box', 'cylinder', 'ramp', 'stairs', 'ladder'];

export const GRID_SNAPS = [0, 0.05, 0.1, 0.25, 0.5, 1, 2, 4];
export const ANGLE_SNAPS = [0, 1, 5, 15, 45, 90];
const HISTORY = 200;

export interface EditorState {
  file: string;
  map: MapFile;
  /** The group being edited (its path), or [] for the whole map. */
  scope: NodePath;
  /** Indices in the scope's nodes; the last is the active one. */
  selected: readonly number[];
  tool: 'select' | Placeable;
  gizmo: 'translate' | 'rotate';
  gridSnap: number;
  angleSnap: number;
  snapDown: boolean;
  /** The colour new shapes get: the last one set. */
  colour: string;
  dirty: boolean;
  saving: boolean;
  /** What's wrong with the map as it stands; saving is refused until it's fixed. */
  problem: string | null;
  message: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

interface Snapshot {
  map: string;
  scope: NodePath;
  selected: readonly number[];
}

/**
 * The map editor's state and commands. The map is kept as its file, edited in place; each
 * edit saves a snapshot first for undo. The view is rebuilt after every edit.
 */
export class MapEditor {
  private state: EditorState;
  private readonly listeners = new Set<() => void>();
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private saved: string;
  readonly view: EditorView;

  constructor(
    canvas: HTMLCanvasElement,
    file: string,
    map: MapFile,
    readonly prefabs: PrefabLookup,
  ) {
    const doc = structuredClone(map);
    this.saved = JSON.stringify(doc);
    this.state = {
      file,
      map: doc,
      scope: [],
      selected: [],
      tool: 'select',
      gizmo: 'translate',
      gridSnap: 0.5,
      angleSnap: 15,
      snapDown: true,
      colour: '#b5b0a6',
      dirty: false,
      saving: false,
      problem: null,
      message: null,
      canUndo: false,
      canRedo: false,
    };
    this.view = new EditorView(canvas, compileMap(doc, prefabs), prefabs, {
      click: (e, index, outside) => this.clicked(e, index, outside),
      doubleClick: (index) => {
        if (index !== null && this.scopeNodes()[index]?.type === 'group') this.enter(index);
      },
      moved: (moves) => this.moved(moves),
      broken: (message) => this.set({ problem: message }),
    });
    this.view.options = this.viewOptions();
    this.view.setGizmoMode('translate');
    this.rebuild();
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('beforeunload', (e) => {
      if (this.state.dirty) e.preventDefault();
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): EditorState => this.state;

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private viewOptions() {
    const { gridSnap, angleSnap, snapDown } = this.state;
    return { gridSnap, angleSnap, snapDown };
  }

  setOption(patch: Partial<Pick<EditorState, 'gridSnap' | 'angleSnap' | 'snapDown'>>): void {
    this.set(patch);
    this.view.options = this.viewOptions();
  }

  setTool(tool: EditorState['tool']): void {
    this.set({ tool, message: tool === 'select' ? null : `Click to place a ${tool}. Esc stops.` });
  }

  setGizmo(gizmo: EditorState['gizmo']): void {
    this.view.setGizmoMode(gizmo);
    this.set({ gizmo });
  }

  scopeNodes(): MapNode[] {
    return nodesAt(this.state.map, this.state.scope);
  }

  /** The active (last selected) node. */
  active(): MapNode | undefined {
    const i = this.state.selected[this.state.selected.length - 1];
    return i === undefined ? undefined : this.scopeNodes()[i];
  }

  // Selection and groups

  select(selected: readonly number[], scope: NodePath = this.state.scope): void {
    this.set({ selected, scope });
    this.view.setSelection(scope, selected);
  }

  private clicked(e: MouseEvent, index: number | null, outside: NodePath | null): void {
    if (this.state.tool !== 'select') return this.placeAt(e);
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    if (outside) return this.select(outside, []);
    if (index === null) return add ? undefined : this.select([]);
    const sel = this.state.selected;
    if (!add) return this.select([index]);
    this.select(sel.includes(index) ? sel.filter((i) => i !== index) : [...sel, index]);
  }

  enter(index: number): void {
    if (this.scopeNodes()[index]?.type !== 'group') return;
    this.select([], [...this.state.scope, index]);
  }

  /** Back out of the group being edited, with it selected. */
  exit(): void {
    const scope = this.state.scope;
    if (scope.length) this.select([scope[scope.length - 1]!], scope.slice(0, -1));
  }

  // Edits

  /**
   * Changes the map: `change` edits it in place and may return a new selection. Saves a
   * snapshot first, so it can be undone.
   */
  edit(change: (nodes: MapNode[], map: MapFile) => readonly number[] | void): void {
    const before = this.snapshot();
    const selected = change(this.scopeNodes(), this.state.map);
    const after = JSON.stringify(this.state.map);
    if (after === before.map) return;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.changed(selected ?? this.state.selected, this.state.scope, after);
  }

  /** Changes the active node: `change` gets it and edits it in place. */
  editActive(change: (n: MapNode) => void): void {
    const i = this.state.selected[this.state.selected.length - 1];
    if (i !== undefined) this.edit((nodes) => void change(nodes[i]!));
  }

  /** Replaces the active node, with one typed in as JSON (checked by the caller). */
  replaceActive(node: MapNode): void {
    const i = this.state.selected[this.state.selected.length - 1];
    if (i !== undefined) this.edit((nodes) => void (nodes[i] = node));
  }

  private snapshot(): Snapshot {
    const { map, scope, selected } = this.state;
    return { map: JSON.stringify(map), scope, selected };
  }

  private changed(selected: readonly number[], scope: NodePath, json: string): void {
    const map = this.state.map;
    // Drop what no longer exists (after an undo, say).
    let valid = scope;
    while (valid.length && nodeAt(map, valid)?.type !== 'group') valid = valid.slice(0, -1);
    const count = nodesAt(map, valid).length;
    const sel = valid === scope ? selected.filter((i) => i < count) : [];
    this.set({
      dirty: json !== this.saved,
      problem: null,
      scope: valid,
      selected: sel,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
    this.rebuild();
  }

  private rebuild(): void {
    const { map, scope, selected } = this.state;
    this.view.build(map, scope, selected);
    if (!this.state.problem) this.set({ problem: check(map, this.prefabs, this.state.file) });
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  private restore(s: Snapshot): void {
    this.state = { ...this.state, map: JSON.parse(s.map) as MapFile };
    this.changed(s.selected, s.scope, s.map);
  }

  private moved(moves: Moved[]): void {
    this.edit((nodes) => {
      for (const m of moves) moveWith(nodes[m.index]!, m.from, m.to, m.yaw);
    });
  }

  deleteSelected(): void {
    const sel = this.state.selected;
    if (!sel.length) return;
    this.edit((nodes) => {
      for (const i of [...sel].sort((a, b) => b - a)) nodes.splice(i, 1);
      return [];
    });
    this.set({ message: `Deleted ${sel.length === 1 ? 'one' : sel.length}.` });
  }

  groupSelected(): void {
    const sel = this.state.selected;
    if (!sel.length) return;
    this.edit((nodes) => [groupNodes(nodes, sel)]);
  }

  ungroupSelected(): void {
    const groups = this.state.selected.filter((i) => this.scopeNodes()[i]?.type === 'group');
    if (!groups.length) return;
    this.edit((nodes) => {
      let picked: number[] = [];
      // From the end, so earlier indices stay put; then shift for what came before.
      for (const g of [...groups].sort((a, b) => b - a)) {
        const added = ungroup(nodes, g).length - 1;
        picked = picked.map((i) => i + added);
        picked.push(...Array.from({ length: added + 1 }, (_, k) => g + k));
      }
      return picked.sort((a, b) => a - b);
    });
  }

  /** Copies of the selection, a grid step along x (or 1 m), selected. */
  duplicateSelected(): void {
    const sel = [...this.state.selected].sort((a, b) => a - b);
    if (!sel.length) return;
    const step = this.state.gridSnap || 1;
    this.edit((nodes, map) => {
      const taken = collectIds(map.nodes);
      const copies = sel.map((i) => {
        const c = copyNode(nodes[i]!, taken);
        const [x, y, z] = nodePos(c);
        placeNode(c, [x + step, y, z]);
        return c;
      });
      const at = sel[sel.length - 1]! + 1;
      nodes.splice(at, 0, ...copies);
      return copies.map((_, k) => at + k);
    });
  }

  /** Turns everything selected to the active node's yaw. */
  matchRotation(): void {
    const target = this.active();
    if (!target || this.state.selected.length < 2) {
      this.set({ message: 'Select the ones to turn, then last the one to match.' });
      return;
    }
    const yaw = nodeYaw(target);
    this.edit((nodes) => {
      for (const i of this.state.selected) {
        const n = nodes[i]!;
        placeNode(n, nodePos(n), yaw);
      }
    });
  }

  /** Drops everything selected onto the surface below it. */
  dropSelected(): void {
    const sel = this.state.selected;
    this.edit((nodes) => {
      for (const i of sel) {
        const n = nodes[i]!;
        const [x, y, z] = nodePos(n);
        placeNode(n, [x, this.view.dropPoint(new THREE.Vector3(x, y, z), sel), z]);
      }
    });
  }

  private placeAt(e: MouseEvent): void {
    const tool = this.state.tool;
    if (tool === 'select') return;
    const p = this.view.pointUnder(e);
    if (!p) return;
    const { gridSnap, snapDown, colour } = this.state;
    if (gridSnap) {
      p.x = round(Math.round(p.x / gridSnap) * gridSnap);
      p.z = round(Math.round(p.z / gridSnap) * gridSnap);
      if (snapDown) p.y = this.view.dropPoint(p);
    }
    const node = newShape(tool, [p.x, p.y, p.z], colour);
    placeNode(node, nodePos(node));
    this.edit((nodes) => {
      nodes.push(node);
      return [nodes.length - 1];
    });
  }

  setColour(colour: string): void {
    this.set({ colour });
  }

  // Saving

  async save(): Promise<void> {
    const { map, file, problem } = this.state;
    if (problem) {
      this.set({ message: `Not saved: ${problem}` });
      return;
    }
    const json = JSON.stringify(map);
    this.set({ saving: true });
    try {
      const res = await fetch('/__editor/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, doc: map }),
      });
      const reply = (await res.json()) as { error?: string; changed?: boolean };
      if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
      this.saved = json;
      this.set({
        saving: false,
        dirty: JSON.stringify(this.state.map) !== json,
        message: `Saved content/${file}.`,
      });
    } catch (err) {
      this.set({
        saving: false,
        message: `Not saved: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  private key(e: KeyboardEvent): void {
    if (typing(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const run = (f: () => void): void => {
      e.preventDefault();
      f();
    };
    if (mod) {
      if (k === 'z') return run(() => (e.shiftKey ? this.redo() : this.undo()));
      if (k === 'y') return run(() => this.redo());
      if (k === 's') return run(() => void this.save());
      if (k === 'g') return run(() => (e.shiftKey ? this.ungroupSelected() : this.groupSelected()));
      if (k === 'd') return run(() => this.duplicateSelected());
      if (k === 'a') return run(() => this.select(this.scopeNodes().map((_, i) => i)));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return run(() => this.deleteSelected());
    if (e.key === 'Escape')
      return run(() => {
        if (this.state.tool !== 'select') this.setTool('select');
        else if (this.state.selected.length) this.select([]);
        else this.exit();
      });
    if (e.key === 'Enter') {
      const i = this.state.selected[this.state.selected.length - 1];
      if (i !== undefined) return run(() => this.enter(i));
    }
    if (k === 't') return run(() => this.setGizmo('translate'));
    if (k === 'r') return run(() => this.setGizmo('rotate'));
    if (k === 'm') return run(() => this.matchRotation());
    if (k === 'b') return run(() => this.dropSelected());
    if (k === 'f') return run(() => this.view.focus());
    const n = Number(e.key);
    if (n >= 1 && n <= PLACEABLE.length) return run(() => this.setTool(PLACEABLE[n - 1]!));
  }
}

function newShape(tool: Placeable, pos: [number, number, number], colour: string): MapNode {
  switch (tool) {
    case 'box':
      return { type: 'box', pos, size: [1, 1, 1], colour };
    case 'cylinder':
      return { type: 'cylinder', pos, radius: 0.5, height: 1, colour };
    case 'ramp':
      return { type: 'ramp', pos, size: [2, 1, 3], colour };
    case 'stairs':
      return { type: 'stairs', pos, size: [1.2, 2, 3], colour };
    case 'ladder':
      return { type: 'ladder', pos, height: 3, colour };
  }
}

/**
 * What stops the map loading in the game, as saving would find it: the schema, compiling,
 * and what it names in other content (enemies, keys, loot, quest markers).
 */
export function check(map: MapFile, prefabs: PrefabLookup, file: string): string | null {
  try {
    const loaded = loadContent(MAP_FORMAT, structuredClone(map), file);
    const compiled = compileMap(loaded, prefabs);
    checkEnemySpawns(compiled);
    checkDoorKeys(compiled);
    checkLootContainers(compiled);
    for (const q of loadQuests().values()) {
      for (const o of q.objectives) {
        if (o.type === 'handOver' || o.map !== map.id) continue;
        for (const id of o.type === 'investigate' ? [o.marker] : o.spots) {
          if (!compiled.markers.some((m) => m.type === 'questMarker' && m.id === id))
            return `quest ${q.id} needs quest marker "${id}"`;
        }
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
