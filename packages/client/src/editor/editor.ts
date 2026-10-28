import {
  MAP_FORMAT,
  PREFAB_FORMAT,
  compileMap,
  compileNodes,
  idSchema,
  loadContent,
  type MapFile,
  type MapNode,
  type PrefabFile,
  type PrefabLookup,
} from '@mes/shared';
import * as THREE from 'three';
import { checkDoorKeys, checkEnemySpawns, checkLootContainers, loadQuests } from '../content';
import {
  canEnter,
  collectIds,
  copyNode,
  groupNodes,
  makePrefab,
  moveWith,
  nodeAt,
  nodePos,
  nodeYaw,
  nodesAt,
  placeNode,
  placementNeedsId,
  round,
  scopePrefabs,
  uniqueId,
  ungroup,
  unpackPrefab,
  nodeLabel,
  type NodePath,
} from './doc';
import { findOverlaps, forgetPrefabSolids, type Overlaps } from './overlap';
import { newMap, setHeights, type Brush } from './terrain';
import { EditorView, typing, type Moved } from './view';

export type Placeable = 'box' | 'cylinder' | 'ramp' | 'stairs' | 'ladder';
export const PLACEABLE: readonly Placeable[] = ['box', 'cylinder', 'ramp', 'stairs', 'ladder'];

export const GRID_SNAPS = [0, 0.05, 0.1, 0.25, 0.5, 1, 2, 4];
export const BRUSH_RADII = [1, 2, 4, 6, 8, 12, 16, 24, 32];
export const ANGLE_SNAPS = [0, 1, 5, 15, 45, 90];
const HISTORY = 200;

export interface EditorState {
  file: string;
  map: MapFile;
  /** The group or placed prefab being edited (its path), or [] for the whole map. */
  scope: NodePath;
  /** Indices in the scope's nodes; the last is the active one. */
  selected: readonly number[];
  tool: 'select' | 'terrain' | 'prefab' | Placeable;
  /** The prefab the prefab tool places. */
  placing: string;
  brush: Brush;
  gizmo: 'translate' | 'rotate';
  gridSnap: number;
  angleSnap: number;
  snapDown: boolean;
  /** The colour new shapes get: the last one set. */
  colour: string;
  /** Whether any file (the map or a prefab) differs from what's saved. */
  dirty: boolean;
  /** The files that do, for the save button. */
  unsaved: readonly string[];
  saving: boolean;
  /** What's wrong with the map as it stands; saving is refused until it's fixed. */
  problem: string | null;
  /** What overlaps (warnings, except buildings overlapping, which is a problem). */
  overlaps: Overlaps;
  message: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

/** Every file's JSON (the map's and each prefab's) by file name, as at one moment. */
type Files = ReadonlyMap<string, string>;

interface Snapshot {
  files: Files;
  scope: NodePath;
  selected: readonly number[];
}

const prefabFile = (id: string): string => `prefabs/${id}.json`;

/**
 * The map editor's state and commands. The map and the prefabs are kept as their files,
 * edited in place; each edit saves a snapshot of every file's JSON first for undo, so one
 * history covers editing inside prefabs too. The view is rebuilt after every edit.
 */
export class MapEditor {
  private state: EditorState;
  private readonly listeners = new Set<() => void>();
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  /** The files as they are now, and as saved (a new prefab isn't, until it is). */
  private files: Files;
  private readonly saved: Map<string, string>;
  /** The prefabs as edited, by id. A changed one gets a new object. */
  readonly prefabs: Map<string, PrefabFile>;
  readonly view: EditorView;

  constructor(
    canvas: HTMLCanvasElement,
    file: string,
    map: MapFile,
    prefabs: ReadonlyMap<string, PrefabFile>,
    /** Every map, as loaded, to check that a changed prefab breaks none of them. */
    private readonly maps: ReadonlyMap<string, MapFile>,
  ) {
    const doc = structuredClone(map);
    this.prefabs = new Map([...prefabs].map(([id, p]) => [id, structuredClone(p)]));
    this.state = {
      file,
      map: doc,
      scope: [],
      selected: [],
      tool: 'select',
      placing: [...prefabs.keys()][0] ?? '',
      brush: { mode: 'raise', radius: 6, strength: 1 },
      gizmo: 'translate',
      gridSnap: 0.5,
      angleSnap: 15,
      snapDown: true,
      colour: '#b5b0a6',
      dirty: false,
      unsaved: [],
      saving: false,
      problem: null,
      overlaps: { props: [], buildings: [], buried: [] },
      message: null,
      canUndo: false,
      canRedo: false,
    };
    this.files = this.serialise();
    this.saved = new Map(this.files);
    this.view = new EditorView(canvas, compileMap(doc, this.prefabs), {
      click: (e, index, outside) => this.clicked(e, index, outside),
      doubleClick: (index) => {
        if (index !== null) this.enter(index);
      },
      moved: (moves) => this.moved(moves),
      broken: (message) => this.set({ problem: message }),
      terrain: (heights) => {
        this.edit((_, m) => setHeights(m, heights, this.prefabs));
      },
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
    if (tool === 'terrain') this.select([]);
    this.view.brush = tool === 'terrain' ? this.state.brush : null;
    this.set({ tool, message: toolHint(tool, this.state.placing) });
  }

  /** Picks the prefab to place, and the prefab tool. */
  setPlacing(placing: string): void {
    this.set({ placing });
    this.setTool('prefab');
  }

  setBrush(patch: Partial<Brush>): void {
    const brush = { ...this.state.brush, ...patch };
    this.set({ brush });
    if (this.state.tool === 'terrain') this.view.brush = brush;
  }

  /** A brush size one step bigger or smaller. */
  private resizeBrush(step: 1 | -1): void {
    const r = this.state.brush.radius;
    const next =
      step > 0 ? BRUSH_RADII.find((v) => v > r) : [...BRUSH_RADII].reverse().find((v) => v < r);
    if (next !== undefined) this.setBrush({ radius: next });
  }

  setGizmo(gizmo: EditorState['gizmo']): void {
    this.view.setGizmoMode(gizmo);
    this.set({ gizmo });
  }

  scopeNodes(): MapNode[] {
    return nodesAt(this.state.map, this.state.scope, this.prefabs);
  }

  /** The prefab being edited inside (the innermost one the scope goes into), if any. */
  scopePrefab(): PrefabFile | undefined {
    return scopePrefabs(this.state.map, this.state.scope, this.prefabs).at(-1)?.prefab;
  }

  /** The top-level nodes of the file the scope is in: the map's, or the prefab's. */
  private fileNodes(): MapNode[] {
    return (this.scopePrefab() ?? this.state.map).nodes;
  }

  /** The colour slots of the file the scope is in. */
  slots(): Readonly<Record<string, string>> {
    return (this.scopePrefab() ?? this.state.map).colours ?? {};
  }

  /** The active (last selected) node. */
  active(): MapNode | undefined {
    const i = this.state.selected[this.state.selected.length - 1];
    return i === undefined ? undefined : this.scopeNodes()[i];
  }

  // Selection and groups

  select(selected: readonly number[], scope: NodePath = this.state.scope): void {
    const moved = scope.join('.') !== this.state.scope.join('.');
    this.set({ selected, scope });
    // A prefab gone into is built part by part, and one left as a whole again.
    if (moved) this.view.build(this.state.map, this.prefabs, scope, selected);
    else this.view.setSelection(scope, selected);
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

  /** Edits inside a group, or a placed prefab (which changes every copy of it). */
  enter(index: number): void {
    if (!canEnter(this.scopeNodes()[index], this.prefabs)) return;
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
  /**
   * Changes the map or a prefab: `change` edits the scope's nodes (or any file) in place and
   * may return a new selection. Saves a snapshot first, so it can be undone. `refuse` can
   * turn the edit down once it's made, with the reason, and then it's put back.
   */
  edit(
    change: (nodes: MapNode[], map: MapFile) => readonly number[] | void,
    refuse?: () => string | null,
  ): void {
    const before = this.snapshot();
    const selected = change(this.scopeNodes(), this.state.map);
    const after = this.serialise();
    if (sameFiles(after, before.files)) return;
    this.load(after, before.files);
    // Buildings can't overlap: an edit that makes more of them overlap doesn't happen.
    const overlaps = findOverlaps(this.state.map, this.prefabs);
    let refused = refuse?.() ?? null;
    if (!refused && overlaps.buildings.length > this.state.overlaps.buildings.length) {
      const [a, b] =
        overlaps.buildings.find(
          (p) => !this.state.overlaps.buildings.some((q) => samePair(p, q)),
        ) ?? overlaps.buildings[0]!;
      refused = `Buildings can't overlap: ${this.label(a)} and ${this.label(b)}.`;
    }
    if (refused) {
      this.load(before.files);
      this.rebuild();
      this.set({ message: refused });
      return;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    // An old message (a refused edit, say) no longer applies.
    this.set({ message: toolHint(this.state.tool, this.state.placing) });
    this.changed(selected ?? this.state.selected, this.state.scope, overlaps);
  }

  /** Every file's JSON as it is now. */
  private serialise(): Map<string, string> {
    const files = new Map([[this.state.file, JSON.stringify(this.state.map)]]);
    for (const [id, p] of this.prefabs) files.set(prefabFile(id), JSON.stringify(p));
    return files;
  }

  /**
   * Makes the map and prefabs these files, parsing only those that differ from `current`
   * (what's in memory). A prefab that's changed gets a new object, so what's cached by it
   * is worked out again; one not in the files (made, then undone) goes.
   */
  private load(files: Files, current: Files = this.files): void {
    const mapJson = files.get(this.state.file)!;
    if (mapJson !== current.get(this.state.file))
      this.state = { ...this.state, map: JSON.parse(mapJson) as MapFile };
    for (const id of [...this.prefabs.keys()])
      if (!files.has(prefabFile(id))) this.prefabs.delete(id);
    for (const [file, json] of files) {
      if (file === this.state.file || json === current.get(file)) continue;
      const prefab = JSON.parse(json) as PrefabFile;
      this.prefabs.set(prefab.id, prefab);
    }
    forgetPrefabSolids();
    this.files = files;
  }

  /** A node's name for messages: its id or name, or its type and path. */
  label(path: NodePath): string {
    const n = nodeAt(this.state.map, path, this.prefabs);
    return (n && nodeLabel(n)) || `${n?.type ?? 'node'} #${path.join('.')}`;
  }

  /** Selects a node anywhere, editing the group it's in. */
  reveal(path: NodePath): void {
    if (path.length) this.select([path[path.length - 1]!], path.slice(0, -1));
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
    const { scope, selected } = this.state;
    return { files: this.files, scope, selected };
  }

  private changed(selected: readonly number[], scope: NodePath, overlaps?: Overlaps): void {
    const map = this.state.map;
    // Drop what no longer exists (after an undo, say).
    let valid = scope;
    while (valid.length && !canEnter(nodeAt(map, valid, this.prefabs), this.prefabs))
      valid = valid.slice(0, -1);
    const count = nodesAt(map, valid, this.prefabs).length;
    const sel = valid === scope ? selected.filter((i) => i < count) : [];
    this.set({
      ...this.unsaved(),
      problem: null,
      scope: valid,
      selected: sel,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
    this.rebuild(overlaps);
  }

  private unsaved(): Pick<EditorState, 'dirty' | 'unsaved'> {
    const unsaved = [...this.files].filter(([f, json]) => this.saved.get(f) !== json);
    return { dirty: unsaved.length > 0, unsaved: unsaved.map(([f]) => f) };
  }

  private rebuild(overlaps = findOverlaps(this.state.map, this.prefabs)): void {
    const { map, scope, selected } = this.state;
    this.view.build(map, this.prefabs, scope, selected);
    const flagged = new Map<string, NodePath>();
    for (const p of [...overlaps.props, ...overlaps.buildings].flat()) flagged.set(p.join('.'), p);
    for (const p of overlaps.buried) flagged.set(p.join('.'), p);
    this.view.setWarnings([...flagged.values()]);
    let problem =
      this.state.problem ?? this.prefabProblem() ?? check(map, this.prefabs, this.state.file);
    const clash = overlaps.buildings[0];
    if (!problem && clash)
      problem = `buildings overlap: ${this.label(clash[0])} and ${this.label(clash[1])}`;
    this.set({ overlaps, problem });
  }

  /** What's wrong with a changed prefab as a file of its own (its schema: ids, slots). */
  private prefabProblem(): string | null {
    for (const [file, json] of this.files) {
      if (file === this.state.file || json === this.saved.get(file)) continue;
      try {
        loadContent(PREFAB_FORMAT, JSON.parse(json), file);
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    }
    return null;
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
    this.load(s.files);
    this.set({ message: toolHint(this.state.tool, this.state.placing) });
    this.changed(s.selected, s.scope);
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

  /**
   * Copies of the selection, a grid step along x (or 1 m), selected. With a building in it,
   * they go beside it, since buildings can't overlap.
   */
  duplicateSelected(): void {
    const sel = [...this.state.selected].sort((a, b) => a - b);
    if (!sel.length) return;
    const grid = this.state.gridSnap || 1;
    const building = this.hasBuilding(sel.map((i) => this.scopeNodes()[i]!));
    const step = building ? Math.ceil(this.view.selectionWidth() / grid + 1) * grid : grid;
    this.edit((nodes) => {
      const taken = collectIds(this.fileNodes());
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

  private hasBuilding(nodes: readonly MapNode[]): boolean {
    return nodes.some((n) =>
      n.type === 'group'
        ? this.hasBuilding(n.nodes)
        : n.type === 'prefab' && !!this.prefabs.get(n.prefab)?.building,
    );
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
    if (tool === 'select' || tool === 'terrain') return;
    const p = this.view.pointUnder(e);
    if (!p) return;
    const { gridSnap, snapDown, colour, placing } = this.state;
    if (gridSnap) {
      p.x = round(Math.round(p.x / gridSnap) * gridSnap);
      p.z = round(Math.round(p.z / gridSnap) * gridSnap);
      if (snapDown) p.y = this.view.dropPoint(p);
    }
    let node: MapNode;
    if (tool === 'prefab') {
      const prefab = this.prefabs.get(placing);
      if (!prefab) return;
      const inside = scopePrefabs(this.state.map, this.state.scope, this.prefabs);
      if (inside.some((s) => s.prefab.id === placing)) {
        this.set({ message: `A ${placing} can't go inside itself.` });
        return;
      }
      node = {
        type: 'prefab',
        ...(placementNeedsId(prefab) && { id: uniqueIdIn(placing, this.fileNodes()) }),
        prefab: placing,
        pos: [0, 0, 0],
      };
      placeNode(node, [p.x, p.y, p.z]);
    } else {
      node = newShape(tool, [p.x, p.y, p.z], colour);
      placeNode(node, nodePos(node));
    }
    this.edit((nodes) => {
      nodes.push(node);
      return [nodes.length - 1];
    });
  }

  setColour(colour: string): void {
    this.set({ colour });
  }

  /** Changes the map's own settings (environment, ground colour, water). */
  editMap(change: (map: MapFile) => void): void {
    this.edit((_, map) => void change(map));
  }

  /** Changes the own settings (name, slots, building) of the prefab being edited inside. */
  editPrefab(change: (prefab: PrefabFile) => void): void {
    const prefab = this.scopePrefab();
    if (prefab) this.edit(() => void change(prefab));
  }

  /**
   * Fits the building footprint of the prefab being edited to what stands on its floor:
   * the solids whose bottom is within 0.3 m of y = 0 (so a roof's overhang doesn't count).
   */
  fitFootprint(): void {
    const prefab = this.scopePrefab();
    if (!prefab) return;
    let out;
    try {
      out = compileNodes(prefab.nodes, this.prefabs, prefab.colours);
    } catch {
      return;
    }
    const corners: [number, number][] = [];
    const rect = (x: number, z: number, hx: number, hz: number, yaw: number): void => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (const [dx, dz] of [
        [-hx, -hz],
        [hx, -hz],
        [hx, hz],
        [-hx, hz],
      ] as const)
        corners.push([x + dx * c + dz * s, z - dx * s + dz * c]);
    };
    for (const b of out.boxes) if (b.y - b.hy <= 0.3) rect(b.x, b.z, b.hx, b.hz, b.yaw);
    for (const r of out.ramps) if (r.bottom <= 0.3) rect(r.x, r.z, r.hx, r.hz, r.yaw);
    if (!corners.length) {
      this.set({ message: 'Nothing stands on the floor (y = 0) to fit to.' });
      return;
    }
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const cm = (v: number): number => round(v, 0.01);
    this.editPrefab((p) => {
      const centre: [number, number] = [cm((x0 + x1) / 2), cm((z0 + z1) / 2)];
      p.building = {
        size: [cm(x1 - x0), cm(z1 - z0)],
        ...(centre[0] || centre[1] ? { centre } : {}),
        ...(p.building?.colour !== undefined && { colour: p.building.colour }),
      };
    });
  }

  /**
   * Makes a new prefab of what's selected, and puts one placement of it in its place, as one
   * edit. Written with the next save. Refused if it would break something the map names (a
   * quest's marker, say: ids inside a prefab come out as placement/id).
   */
  makePrefab(id: string, name: string): void {
    const sel = this.state.selected;
    if (!sel.length) return;
    if (!idSchema.safeParse(id).success || this.prefabs.has(id)) {
      this.set({ message: `Not made: "${id}" isn't a free prefab id.` });
      return;
    }
    const before = this.state.problem;
    this.edit(
      (nodes) => {
        const made = makePrefab(nodes, sel, id, name, this.slots(), collectIds(this.fileNodes()));
        this.prefabs.set(id, made.prefab);
        return [made.index];
      },
      () => this.newProblem(before, 'Not made'),
    );
    if (this.prefabs.has(id))
      this.set({ message: `Made prefab ${id}; it's saved with the map (⌘S).` });
  }

  /**
   * Turns the selected prefabs into groups of their parts, so they can be changed on their
   * own. Refused if it would break something the map names.
   */
  unpackSelected(): void {
    const picked = this.state.selected.filter((i) => this.scopeNodes()[i]?.type === 'prefab');
    if (!picked.length) return;
    const before = this.state.problem;
    let building = false;
    this.edit(
      (nodes) => {
        const taken = collectIds(this.fileNodes());
        for (const i of picked) {
          const prefab = this.prefabs.get((nodes[i] as { prefab: string }).prefab);
          if (!prefab) continue;
          building ||= !!prefab.building;
          unpackPrefab(nodes, i, prefab, taken);
        }
      },
      () => this.newProblem(before, 'Not unpacked'),
    );
    if (building && this.state.message === null)
      this.set({ message: "Unpacked. A group isn't a building: it has no concrete base." });
  }

  /** The problem the map now has, if it didn't have it before an edit, as a refusal. */
  private newProblem(before: string | null, what: string): string | null {
    const problem = check(this.state.map, this.prefabs, this.state.file);
    return problem && problem !== before ? `${what}: ${problem}` : null;
  }

  /**
   * Makes a new map file and opens it. It's saved straight away (refused if the file
   * exists), so the dev server can serve it to the reloaded page.
   */
  async createMap(id: string, name: string, size: number, cellSize: number): Promise<void> {
    const map = newMap(id, name, size, cellSize);
    const problem = check(map, this.prefabs, `maps/${id}.json`);
    if (problem) {
      this.set({ message: `Not made: ${problem}` });
      return;
    }
    try {
      await post([{ file: `maps/${id}.json`, doc: map, create: true }]);
      // Nothing to keep this page from going.
      for (const [file, json] of this.files) this.saved.set(file, json);
      this.set({ dirty: false });
      location.search = `?map=${id}`;
    } catch (err) {
      this.set({ message: `Not made: ${err instanceof Error ? err.message : err}` });
    }
  }

  // Saving

  /**
   * Saves every file that's changed (the map, and prefabs edited or made) in one request.
   * Refused while the map has a problem, or if a changed prefab would break another map.
   */
  async save(): Promise<void> {
    const { problem } = this.state;
    if (problem) {
      this.set({ message: `Not saved: ${problem}` });
      return;
    }
    const files = this.files;
    const changed = [...files].filter(([f, json]) => this.saved.get(f) !== json);
    if (!changed.length) {
      this.set({ message: 'Nothing to save.' });
      return;
    }
    const broken = changed.some(([f]) => f !== this.state.file) && this.otherMapProblem();
    if (broken) {
      this.set({ message: `Not saved: ${broken}` });
      return;
    }
    this.set({ saving: true });
    try {
      // New prefabs first, so the map is never written naming one that isn't there.
      const last = (f: string): number => Number(f === this.state.file);
      const order = [...changed].sort(([a], [b]) => last(a) - last(b));
      await post(
        order.map(([file, json]) => ({
          file,
          doc: JSON.parse(json) as unknown,
          ...(!this.saved.has(file) && { create: true }),
        })),
      );
      for (const [file, json] of changed) this.saved.set(file, json);
      this.set({
        saving: false,
        ...this.unsaved(),
        message: `Saved ${changed.map(([f]) => `content/${f}`).join(', ')}.`,
      });
    } catch (err) {
      this.set({
        saving: false,
        message: `Not saved: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  /** A problem that the prefabs as edited give another map, one it didn't have with them as saved. */
  private otherMapProblem(): string | null {
    const saved = new Map<string, PrefabFile>();
    for (const [file, json] of this.saved) {
      if (file.startsWith('prefabs/')) {
        const p = JSON.parse(json) as PrefabFile;
        saved.set(p.id, p);
      }
    }
    for (const [id, map] of this.maps) {
      if (id === this.state.map.id) continue;
      const file = `maps/${id}.json`;
      const problem = check(map, this.prefabs, file);
      // The problem names the map already.
      if (problem && problem !== check(map, saved, file)) return problem;
    }
    return null;
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
    if (e.key === String(PLACEABLE.length + 1)) return run(() => this.setTool('prefab'));
    if (k === 'g')
      return run(() => this.setTool(this.state.tool === 'terrain' ? 'select' : 'terrain'));
    if (this.state.tool === 'terrain') {
      if (e.key === '[') return run(() => this.resizeBrush(-1));
      if (e.key === ']') return run(() => this.resizeBrush(1));
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

function toolHint(tool: EditorState['tool'], placing: string): string | null {
  if (tool === 'select') return null;
  if (tool === 'terrain')
    return 'Drag on the ground to shape it; ⇧ to lower (or raise). [ and ] change the size. Esc stops.';
  return `Click to place a ${tool === 'prefab' ? placing : tool}. Esc stops.`;
}

async function post(files: { file: string; doc: unknown; create?: boolean }[]): Promise<void> {
  const res = await fetch('/__editor/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const reply = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
}

const sameFiles = (a: Files, b: Files): boolean =>
  a.size === b.size && [...a].every(([f, json]) => b.get(f) === json);

/** An id from `base` that no node in these (and the groups in them) has. */
const uniqueIdIn = (base: string, nodes: readonly MapNode[]): string =>
  uniqueId(base, collectIds(nodes));

const samePair = (
  [a, b]: readonly [NodePath, NodePath],
  [c, d]: readonly [NodePath, NodePath],
): boolean => a.join('.') === c.join('.') && b.join('.') === d.join('.');

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
