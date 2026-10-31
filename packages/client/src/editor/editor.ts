import {
  CollisionWorld,
  Exposure,
  MAP_FORMAT,
  NavGrid,
  PREFAB_FORMAT,
  SPOT,
  compileMap,
  compileNodes,
  exposedSpawns,
  idSchema,
  loadContent,
  type CompiledMap,
  type ExposedSpawn,
  type MapFile,
  type MapNode,
  type PrefabFile,
  type PrefabLookup,
} from '@mes/shared';
import * as THREE from 'three';
import {
  checkDoorKeys,
  checkEnemySpawns,
  checkLootContainers,
  loadEnemies,
  loadLootContainers,
  loadLootTables,
  loadQuests,
} from '../content';
import { NOTES_EVENT, addNote, fetchNotes, noteLabels, removeNote, type MapNote } from '../notes';
import { writePlayTest } from '../play-test-handoff';
import { buildNavOverlay } from '../render/nav-debug';
import {
  canEnter,
  collectIds,
  copyNode,
  groupNodes,
  insertPatrolPoint,
  makePrefab,
  movePatrolPoint,
  moveWith,
  nodeAt,
  nodePos,
  nodeYaw,
  nodesAt,
  patrolIds,
  patrolPoint,
  placeNode,
  placementNeedsId,
  removePatrolPoint,
  round,
  scopePrefabs,
  uniqueId,
  ungroup,
  unpackPrefab,
  nodeLabel,
  type NodePath,
  type Vec3,
} from './doc';
import { floorLevels, startCut, stepCut } from './cut';
import { findOverlaps, forgetPrefabSolids, type Overlaps } from './overlap';
import { newMap, setHeights, type Brush } from './terrain';
import { EditorView, typing, type Handles, type Moved } from './view';
import {
  DOOR_HEIGHT,
  VAULT_THICKNESS,
  WALL_DEFAULTS,
  WINDOW_HEIGHT,
  WINDOW_MIN_WIDTH,
  WINDOW_SILL,
  alongWall,
  cutWall,
  doorIn,
  nearestEnd,
  snapCorner,
  wallAxis,
  wallBoxes,
  wallEnds,
  type Opening,
  type WallSettings,
} from './walls';

export type Placeable = 'box' | 'cylinder' | 'ramp' | 'stairs' | 'ladder';
export const PLACEABLE: readonly Placeable[] = ['box', 'cylinder', 'ramp', 'stairs', 'ladder'];

/** What the marker tool places (session 17): the gameplay nodes. */
export type MarkerKind =
  | 'playerSpawn'
  | 'enemySpawn'
  | 'patrol'
  | 'lootContainer'
  | 'lootSpawn'
  | 'extraction'
  | 'questMarker'
  | 'door';
export const MARKERS: Readonly<Record<MarkerKind, string>> = {
  playerSpawn: 'player spawn',
  enemySpawn: 'enemy spawn',
  patrol: 'patrol',
  lootContainer: 'loot container',
  lootSpawn: 'loose loot',
  extraction: 'extraction',
  questMarker: 'quest marker',
  door: 'door',
};
const TOOL_KEYS = { prefab: '6', marker: '7', zone: '8', wall: '9' } as const;

type Patrol = Extract<MapNode, { type: 'patrol' }>;

/**
 * A patrol, named zone or run of walls being drawn a click at a time (points in the scope's
 * frame), or points being added to the end of the patrol at `index`.
 */
export interface Drawing {
  what: 'patrol' | 'zone' | 'walls' | 'extend';
  index?: number;
  points: readonly Vec3[];
}

/** The search for hiding spots on the navigation overlay. */
export interface Hiding {
  running: boolean;
  checked: number;
  total: number;
  /** What it found, biggest first: islands' hidden parts, each where its middle is. */
  spots: readonly { x: number; y: number; z: number; area: number }[];
  /** The map has changed since: run it again. */
  stale: boolean;
}

/** Where a play-test starts: a random player spawn, one by id, or at the camera's target. */
export const CAMERA_START = '@camera';

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
  tool: 'select' | 'terrain' | 'prefab' | 'marker' | 'zone' | 'wall' | Placeable;
  /** The prefab the prefab tool places. */
  placing: string;
  /** What the marker tool places. */
  marker: MarkerKind;
  /** Whether the prefab browser is open. */
  browsing: boolean;
  /** The map's notes (content/notes), and the one picked. */
  notes: readonly MapNote[];
  note: string | null;
  /** What the wall tool does (draw walls, or cut a door or window), and its sizes. */
  wall: WallSettings;
  drawing: Drawing | null;
  /** The named zone picked in the map's settings, by index. */
  zone: number | null;
  /** The picked point of the selected patrol, or of the picked zone. */
  point: number | null;
  /** Whether the navigation overlay is shown. */
  nav: boolean;
  /** The cutaway's height in the world: everything above it is hidden. Null when off. */
  cut: number | null;
  hiding: Hiding | null;
  /** The ids of the player spawns, as compiled (path ids), for where play-testing starts. */
  spawns: readonly string[];
  brush: Brush;
  gizmo: 'translate' | 'rotate';
  gridSnap: number;
  angleSnap: number;
  snapDown: boolean;
  objectSnap: boolean;
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
  /** Enemy spawns too near a player spawn, or in sight of one (warnings). */
  exposed: readonly ExposedSpawn[];
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
  /** The map as compiled after the last edit, or null if it doesn't compile. */
  private compiled: CompiledMap | null = null;
  /** The navigation grid of the overlay, and what enemies can reach and see on it. */
  private nav: { world: CollisionWorld; grid: NavGrid; exposure: Exposure } | null = null;
  private navTimer = 0;
  /** Bumped to stop a search for hiding spots that's under way. */
  private hidingRun = 0;
  private handlesKey = '';
  /** The ends of the map's walls in the scope's frame, for corners to snap to; worked out when needed. */
  private ends: Vec3[] | null = null;

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
      marker: 'enemySpawn',
      browsing: false,
      notes: [],
      note: null,
      wall: WALL_DEFAULTS,
      drawing: null,
      zone: null,
      point: null,
      nav: false,
      cut: null,
      hiding: null,
      spawns: [],
      brush: { mode: 'raise', radius: 6, strength: 1 },
      gizmo: 'translate',
      gridSnap: 0.5,
      angleSnap: 15,
      snapDown: true,
      objectSnap: true,
      colour: '#b5b0a6',
      dirty: false,
      unsaved: [],
      saving: false,
      problem: null,
      overlaps: { props: [], buildings: [], buried: [] },
      exposed: [],
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
      handle: (index, to) => this.handleMoved(index, to),
      hover: (e) => this.hovered(e),
    });
    this.view.options = this.viewOptions();
    this.view.setGizmoMode('translate');
    this.rebuild();
    window.addEventListener('keydown', (e) => this.key(e));
    this.refreshNotes();
    // Notes dropped in a play-test (or by another editor) arrive as they're written.
    import.meta.hot?.on(NOTES_EVENT, (data: { map: string }) => {
      if (data.map === this.state.map.id) this.refreshNotes();
    });
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
    const { tool, drawing } = this.state;
    this.view.placing = !!drawing || (tool !== 'select' && tool !== 'terrain');
    if (drawing?.what !== 'walls') this.view.setPreview(null);
    this.showHandles();
    for (const l of this.listeners) l();
  }

  private viewOptions() {
    const { gridSnap, angleSnap, snapDown, objectSnap } = this.state;
    return { gridSnap, angleSnap, snapDown, objectSnap };
  }

  setOption(
    patch: Partial<Pick<EditorState, 'gridSnap' | 'angleSnap' | 'snapDown' | 'objectSnap'>>,
  ): void {
    this.set(patch);
    this.view.options = this.viewOptions();
  }

  setTool(tool: EditorState['tool']): void {
    if (tool === 'terrain') this.select([]);
    // Zones belong to the map, outside any group.
    if (tool === 'zone') this.select([], []);
    this.view.brush = tool === 'terrain' ? this.state.brush : null;
    this.set({
      tool,
      drawing: null,
      message: toolHint(tool, this.state.placing, this.state.marker, this.state.wall),
    });
  }

  /** Changes the wall tool's settings, and picks the wall tool. */
  setWall(patch: Partial<WallSettings>): void {
    this.set({ wall: { ...this.state.wall, ...patch } });
    this.setTool('wall');
  }

  /** Picks what the marker tool places, and the marker tool. */
  setMarker(marker: MarkerKind): void {
    this.set({ marker });
    this.setTool('marker');
  }

  /** Opens or closes the prefab browser. */
  setBrowsing(browsing: boolean): void {
    this.set({ browsing });
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

  /** The patrols an enemy spawn in the scope can walk: those in the same file. */
  patrols(): string[] {
    return patrolIds(this.fileNodes());
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
    const same = !moved && selected.join() === this.state.selected.join();
    this.set({ selected, scope, ...(!same && { point: null }) });
    // A prefab gone into is built part by part, and one left as a whole again.
    if (moved) {
      this.ends = null;
      this.view.build(this.state.map, this.prefabs, scope, selected);
    } else this.view.setSelection(scope, selected);
  }

  private clicked(e: MouseEvent, index: number | null, outside: NodePath | null): void {
    if (this.state.drawing || this.state.tool !== 'select') return this.placeAt(e);
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
    this.set({
      message: toolHint(this.state.tool, this.state.placing, this.state.marker, this.state.wall),
    });
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
    const zone =
      this.state.zone !== null && this.state.zone < map.zones.length ? this.state.zone : null;
    this.set({
      ...this.unsaved(),
      problem: null,
      scope: valid,
      selected: sel,
      zone,
      point: valid === scope && sel.join() === selected.join() ? this.state.point : null,
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
    try {
      this.compiled = compileMap(map, this.prefabs);
    } catch {
      this.compiled = null;
    }
    const spawns = this.compiled?.markers.filter((m) => m.type === 'playerSpawn').map((m) => m.id);
    const exposed = this.compiled
      ? exposedSpawns(this.compiled.markers, new CollisionWorld(this.compiled.world))
      : [];
    this.ends = null;
    this.set({ overlaps, problem, spawns: spawns ?? [], exposed });
    this.mapChanged();
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
    this.set({
      message: toolHint(this.state.tool, this.state.placing, this.state.marker, this.state.wall),
    });
    this.changed(s.selected, s.scope);
  }

  // Patrol points and zone corners, as handles

  /** The handles to show, worked out from the state. */
  private handles(): Handles | null {
    const { drawing, scope, selected, zone, point, map } = this.state;
    if (drawing) {
      const zoneLine = drawing.what === 'zone';
      return {
        points: drawing.points,
        picked: null,
        line: zoneLine ? 'closed' : 'open',
        terrainOnly: zoneLine,
      };
    }
    const a = this.active();
    if (selected.length === 1 && a?.type === 'patrol')
      return {
        points: a.points.map((_, k) => patrolPoint(a, k)),
        picked: point,
        line: 'none',
        terrainOnly: false,
      };
    const z = zone === null || scope.length || selected.length ? undefined : map.zones[zone];
    if (z)
      return {
        points: z.points.map(([x, zz]) => [x, this.view.groundAt(x, zz), zz]),
        picked: point,
        line: 'closed',
        terrainOnly: true,
      };
    return null;
  }

  private showHandles(): void {
    const h = this.handles();
    const key = JSON.stringify(h);
    if (key === this.handlesKey) return;
    this.handlesKey = key;
    this.view.setHandles(h);
  }

  /** A handle was dragged (to `to`) or clicked: moves or picks that point, or ends a drawing. */
  private handleMoved(k: number, to: Vec3 | null): void {
    const { drawing, zone } = this.state;
    if (drawing) {
      // Clicking the first corner of walls closes them into a room.
      if (!to && drawing.what === 'walls' && k === 0 && drawing.points.length > 2)
        return this.finishDrawing(true);
      if (!to) return this.finishDrawing();
      const points = [...drawing.points];
      points[k] = to;
      return this.set({ drawing: { ...drawing, points } });
    }
    const i = this.state.selected[0];
    if (this.active()?.type === 'patrol' && i !== undefined) {
      if (to) this.edit((nodes) => void movePatrolPoint(nodes[i] as Patrol, k, to));
      return this.set({ point: k });
    }
    if (zone !== null) {
      if (to) this.editMap((m) => (m.zones[zone]!.points[k] = [round(to[0]), round(to[2])]));
      this.set({ point: k });
    }
  }

  /** Picks a point of the selected patrol, or of the picked zone, or none. */
  pickPoint(point: number | null): void {
    this.set({ point });
  }

  /** Picks a named zone (selecting nothing, since zones are the map's), or none. */
  pickZone(zone: number | null): void {
    if (zone !== null) this.select([], []);
    this.set({ zone, point: null });
  }

  /** Takes out the picked point of a patrol (two must stay) or zone (three must). */
  deletePoint(): void {
    const { point, zone } = this.state;
    if (point === null) return;
    const i = this.state.selected[0];
    if (this.active()?.type === 'patrol' && i !== undefined) {
      this.edit((nodes) => void removePatrolPoint(nodes[i] as Patrol, point));
    } else if (zone !== null) {
      if (this.state.map.zones[zone]!.points.length <= 3) {
        this.set({ message: 'A zone needs three corners at least.' });
        return;
      }
      this.editMap((m) => void m.zones[zone]!.points.splice(point, 1));
    }
    this.set({ point: null });
  }

  /** Puts a new corner in the picked zone, halfway along the edge after the picked one. */
  splitZoneEdge(): void {
    const { point, zone } = this.state;
    if (zone === null || point === null) return;
    this.editMap((m) => {
      const pts = m.zones[zone]!.points;
      const [a, b] = [pts[point]!, pts[(point + 1) % pts.length]!];
      pts.splice(point + 1, 0, [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)]);
    });
    this.set({ point: point + 1 });
  }

  /** Starts adding points to the end of the selected patrol, a click at a time. */
  extendPatrol(): void {
    const i = this.state.selected[0];
    if (i === undefined || this.active()?.type !== 'patrol') return;
    this.set({
      drawing: { what: 'extend', index: i, points: [] },
      message: 'Click to add points to the patrol; Enter or click the last to finish, Esc to stop.',
    });
  }

  /** Adds a point to what's being drawn, where clicked. */
  private addPoint(e: MouseEvent): void {
    const d = this.state.drawing!;
    const p = this.view.pointUnder(e);
    if (!p) return;
    if (d.what === 'walls') {
      const corner = this.wallCorner(d.points, [p.x, p.y, p.z]);
      return this.set({ drawing: { ...d, points: [...d.points, corner] } });
    }
    const grid = this.state.gridSnap;
    if (grid) {
      p.x = round(Math.round(p.x / grid) * grid);
      p.z = round(Math.round(p.z / grid) * grid);
      p.y = d.what === 'zone' ? this.view.groundAt(p.x, p.z) : this.view.dropPoint(p);
    }
    this.set({ drawing: { ...d, points: [...d.points, [round(p.x), round(p.y), round(p.z)]] } });
  }

  /**
   * Where a wall's next corner goes for a point clicked: on the end of a wall near it if
   * there is one, or else on the grid, at the angle and length the snaps allow from the last.
   * Every corner is at the first one's floor.
   */
  private wallCorner(corners: readonly Vec3[], p: Vec3): Vec3 {
    const first = corners[0];
    const last = corners.at(-1);
    this.ends ??= this.compiled
      ? wallEnds(this.compiled.world.boxes).map((e) => this.view.toScope(e))
      : [];
    const end = nearestEnd(this.ends, p);
    if (end) return [round(end[0]), round(first?.[1] ?? end[1]), round(end[2])];
    const grid = this.state.gridSnap;
    const [x, z] = grid ? [p[0], p[2]].map((v) => Math.round(v / grid) * grid) : [p[0], p[2]];
    if (!last) return [round(x!), round(p[1]), round(z!)];
    return snapCorner(last, [x!, last[1], z!], this.state.angleSnap, grid);
  }

  /** Shows the walls being drawn, up to where the mouse is. */
  private hovered(e: PointerEvent): void {
    const d = this.state.drawing;
    if (d?.what !== 'walls' || !d.points.length) return;
    const p = this.view.pointUnder(e);
    if (!p) return;
    const corner = this.wallCorner(d.points, [p.x, p.y, p.z]);
    const { height, thickness } = this.state.wall;
    this.view.setPreview(wallBoxes([...d.points, corner], height, thickness, this.state.colour));
  }

  /** Makes what's been drawn: a zone, a patrol, the patrol's new points, or walls (`close`d into a room). */
  finishDrawing(close = false): void {
    const d = this.state.drawing;
    if (!d) return;
    const pts = d.points;
    const need = d.what === 'zone' ? 3 : d.what === 'patrol' || d.what === 'walls' ? 2 : 1;
    if (pts.length < need) {
      this.set({
        message: `Click ${need - pts.length} more point${need - pts.length > 1 ? 's' : ''}, or Esc to stop.`,
      });
      return;
    }
    this.set({ drawing: null });
    if (d.what === 'zone') {
      const zone = this.state.map.zones.length;
      this.editMap((m) =>
        m.zones.push({
          id: uniqueId('zone', new Set(m.zones.map((z) => z.id))),
          name: `Zone ${zone + 1}`,
          points: pts.map((p) => [p[0], p[2]]),
        }),
      );
      this.setTool('select');
      this.set({ zone });
    } else if (d.what === 'walls') {
      const { height, thickness } = this.state.wall;
      const corners = close ? [...pts, pts[0]!] : pts;
      const walls = wallBoxes(corners, height, thickness, this.state.colour);
      this.edit((nodes) => {
        const at = nodes.length;
        nodes.push(...walls);
        if (walls.length === 1) return [at];
        return [
          groupNodes(
            nodes,
            walls.map((_, k) => at + k),
            close ? 'Room' : 'Walls',
          ),
        ];
      });
      this.set({
        message: `Made ${walls.length === 1 ? 'a wall' : `${walls.length} walls, grouped`}. Pick door or window to cut openings.`,
      });
    } else if (d.what === 'patrol') {
      const id = uniqueIdIn('patrol', this.fileNodes());
      this.edit((nodes) => {
        nodes.push({ type: 'patrol', id, points: pts.map((p) => [...p]) });
        return [nodes.length - 1];
      });
      this.setTool('select');
      this.set({ message: `Made patrol ${id}: an enemy spawn walks it if its patrol is set.` });
    } else {
      const i = d.index!;
      this.edit((nodes) => {
        const p = nodes[i] as Patrol;
        for (const q of pts) insertPatrolPoint(p, p.points.length, q);
      });
    }
  }

  // Notes

  private refreshNotes(): void {
    fetchNotes(this.state.map.id).then(
      (notes) => this.showNotes(notes),
      () => {},
    );
  }

  private showNotes(notes: readonly MapNote[], note = this.state.note): void {
    const picked = notes.some((n) => n.id === note) ? note : null;
    this.set({ notes, note: picked });
    this.view.setLabels(noteLabels(notes, picked));
  }

  /** Picks a note (or none) and points the camera at it. */
  pickNote(id: string | null): void {
    const n = this.state.notes.find((m) => m.id === id);
    if (n) this.view.lookAt(n.pos[0], n.pos[1], n.pos[2], 15);
    this.showNotes(this.state.notes, n ? n.id : null);
  }

  /** Asks for a note and puts it at the camera's target, written to content/notes at once. */
  noteHere(): void {
    const text = prompt('Note for the camera target (saved to content/notes for everyone):');
    if (!text?.trim()) return;
    addNote(this.state.map.id, this.view.target(), text).then(
      (notes) => this.showNotes(notes),
      (err: unknown) =>
        this.set({ message: `Note not saved: ${err instanceof Error ? err.message : err}` }),
    );
  }

  /** Takes a note out of content/notes: it's been dealt with. */
  resolveNote(id: string): void {
    removeNote(this.state.map.id, id).then(
      (notes) => this.showNotes(notes),
      (err: unknown) =>
        this.set({ message: `Note not removed: ${err instanceof Error ? err.message : err}` }),
    );
  }

  // The cutaway

  /** Turns the cutaway on (over the floor at the camera's target) or off. */
  toggleCut(): void {
    this.setCut(this.state.cut === null ? startCut(this.floors(), this.view.target()[1]) : null);
  }

  setCut(cut: number | null): void {
    this.view.cut = cut;
    this.set({ cut });
  }

  /** Moves the cutaway up or down a floor. */
  stepCut(dir: 1 | -1): void {
    const cut = this.state.cut;
    if (cut !== null) this.setCut(stepCut(this.floors(), cut, dir));
  }

  private floors(): number[] {
    return this.compiled ? floorLevels(this.compiled.world) : [];
  }

  // The navigation overlay

  setNav(nav: boolean): void {
    this.set({ nav });
    if (nav) this.buildNav();
    else {
      this.stopHiding();
      this.nav = null;
      this.view.setOverlay(null);
      this.set({ hiding: null });
    }
  }

  /** After an edit: the overlay is built again a moment later, and found hiding spots are out of date. */
  private mapChanged(): void {
    this.nav = null;
    const hiding = this.state.hiding;
    if (hiding) {
      this.stopHiding();
      this.set({ hiding: { ...hiding, running: false, stale: true } });
    }
    if (!this.state.nav) return;
    clearTimeout(this.navTimer);
    this.navTimer = window.setTimeout(() => this.buildNav(), 300);
  }

  /** Builds the navigation grid from the map as compiled, and shows it. */
  private buildNav(): void {
    const map = this.compiled;
    if (!map) return;
    const world = new CollisionWorld(map.world);
    const grid = new NavGrid(world);
    const starts = map.markers
      .filter((m) => m.type === 'enemySpawn')
      .map((m) => [m.x, m.y, m.z] as const);
    this.nav = { world, grid, exposure: new Exposure(grid, world, starts) };
    this.view.setOverlay(buildNavOverlay(grid, this.nav.exposure.kind));
  }

  /**
   * Looks for spots where enemies can neither walk to a player nor see one, a slice at a
   * time so the page keeps going, and shows them red on the overlay.
   */
  findHiding(): void {
    if (!this.state.nav) this.setNav(true);
    if (!this.nav) this.buildNav();
    const nav = this.nav;
    if (!nav) {
      this.set({ message: "The map doesn't compile: fix it first." });
      return;
    }
    const run = ++this.hidingRun;
    const { exposure, grid } = nav;
    const total = exposure.total;
    this.set({ hiding: { running: true, checked: 0, total, spots: [], stale: false } });
    const slice = (): void => {
      if (run !== this.hidingRun) return;
      const until = performance.now() + 30;
      let done = false;
      while (!done && performance.now() < until) done = exposure.step(50);
      if (!done) {
        this.set({ hiding: { ...this.state.hiding!, checked: total - exposure.left } });
        setTimeout(slice, 0);
        return;
      }
      // Each island's hidden part, as one spot.
      const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
      for (let node = 0; node < grid.nodeCount; node++) {
        if (exposure.kind[node] !== SPOT.hidden) continue;
        const c = grid.component[node]!;
        const s = sums.get(c) ?? { x: 0, y: 0, z: 0, n: 0 };
        s.x += grid.nodeX(node);
        s.y += grid.nodeY(node);
        s.z += grid.nodeZ(node);
        s.n++;
        sums.set(c, s);
      }
      const cell = grid.cellSize * grid.cellSize;
      const spots = [...sums.values()]
        .map((s) => ({ x: s.x / s.n, y: s.y / s.n, z: s.z / s.n, area: s.n * cell }))
        .sort((a, b) => b.area - a.area);
      this.view.setOverlay(buildNavOverlay(grid, exposure.kind));
      this.set({ hiding: { running: false, checked: total, total, spots, stale: false } });
    };
    slice();
  }

  private stopHiding(): void {
    this.hidingRun++;
  }

  // Play-testing

  /**
   * Opens the map as it is now (unsaved changes and all) in a raid in another tab, with no
   * server (session 17). `start` is a player spawn's id, CAMERA_START, or '' for a random spawn.
   */
  playTest(start: string): void {
    if (this.state.problem) {
      this.set({ message: `Can't play-test: ${this.state.problem}` });
      return;
    }
    writePlayTest({ map: this.state.map, prefabs: [...this.prefabs.values()] });
    const q = new URLSearchParams();
    if (start === CAMERA_START) {
      const [x, , z] = this.view.target();
      q.set('at', `${round(x, 0.1)},${round(z, 0.1)}`);
    } else if (start) q.set('spawn', start);
    const tab = window.open(`/play-test${q.size ? `?${q}` : ''}`, 'mes-play-test');
    tab?.focus();
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
    if (this.state.drawing) return this.addPoint(e);
    if (tool === 'zone' || (tool === 'marker' && this.state.marker === 'patrol')) {
      const what = tool === 'zone' ? 'zone' : 'patrol';
      this.set({ drawing: { what, points: [] } });
      return this.addPoint(e);
    }
    if (tool === 'wall') {
      if (this.state.wall.mode !== 'draw') return this.cutOpening(e);
      this.set({ drawing: { what: 'walls', points: [] } });
      return this.addPoint(e);
    }
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
    } else if (tool === 'marker') {
      node = newMarker(this.state.marker, [p.x, p.y, p.z], collectIds(this.fileNodes()), colour);
      placeNode(node, nodePos(node));
    } else {
      node = newShape(tool, [p.x, p.y, p.z], colour);
      placeNode(node, nodePos(node));
    }
    this.edit((nodes) => {
      nodes.push(node);
      return [nodes.length - 1];
    });
  }

  /**
   * Cuts a door or window (the wall tool's mode) into the wall clicked, where clicked: its
   * box is split around the gap, and a door is put in a doorway. The wall can be inside a
   * group in scope; a placed prefab has to be gone into first.
   */
  private cutOpening(e: MouseEvent): void {
    const hit = this.view.pickLeaf(e);
    if (!hit) return;
    const { mode, width } = this.state.wall;
    const wall = nodeAt(this.state.map, hit.path, this.prefabs);
    if (wall?.type !== 'box') {
      const inPrefab = wall?.type === 'prefab' ? ': go into the prefab first (double-click)' : '';
      this.set({ message: `Doors and windows are cut into walls (boxes)${inPrefab}.` });
      return;
    }
    const grid = this.state.gridSnap || 0.05;
    const opening: Opening =
      mode === 'door'
        ? { along: 0, width, bottom: 0, top: DOOR_HEIGHT }
        : { along: 0, width, bottom: WINDOW_SILL, top: WINDOW_SILL + WINDOW_HEIGHT };
    opening.along = round(Math.round(alongWall(wall, hit.at) / grid) * grid);
    let pieces: MapNode[];
    try {
      const boxes = cutWall(wall, opening);
      // Only the first piece keeps the wall's id, if it had one.
      for (const b of boxes.slice(1)) delete b.id;
      pieces = boxes;
    } catch (err) {
      this.set({ message: `Not cut: ${err instanceof Error ? err.message : err}.` });
      return;
    }
    if (mode === 'door') {
      const { pos, yaw } = doorIn(wall, opening);
      const door: MapNode = {
        type: 'door',
        pos,
        size: [width, DOOR_HEIGHT],
        colour: this.state.colour,
      };
      placeNode(door, pos, yaw);
      pieces.push(door);
    }
    const parent = hit.path.slice(0, -1);
    const index = hit.path[hit.path.length - 1]!;
    const here = parent.join('.') === this.state.scope.join('.');
    this.edit((_, map) => {
      nodesAt(map, parent, this.prefabs).splice(index, 1, ...pieces);
      return here && mode === 'door' ? [index + pieces.length - 1] : [];
    });
    const thick = wall.size[2 - wallAxis(wall).axis]!;
    const notes =
      mode === 'window' && thick > VAULT_THICKNESS
        ? ` It can't be vaulted through: the wall is over ${VAULT_THICKNESS} m thick.`
        : mode === 'window' && width < WINDOW_MIN_WIDTH
          ? ` It can't be vaulted through: under ${WINDOW_MIN_WIDTH} m wide.`
          : '';
    this.set({ message: `Cut a ${mode} ${width} m wide.${notes}` });
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
    if (e.key === 'Delete' || e.key === 'Backspace')
      return run(() => (this.state.point !== null ? this.deletePoint() : this.deleteSelected()));
    if (e.key === 'Escape')
      return run(() => {
        if (this.state.drawing) this.set({ drawing: null, message: null });
        else if (this.state.point !== null) this.set({ point: null });
        else if (this.state.tool !== 'select') this.setTool('select');
        else if (this.state.selected.length) this.select([]);
        else this.exit();
      });
    if (e.key === 'Enter' && this.state.drawing) return run(() => this.finishDrawing());
    if (e.key === 'Enter') {
      const i = this.state.selected[this.state.selected.length - 1];
      if (i !== undefined) return run(() => this.enter(i));
    }
    for (const [tool, key] of Object.entries(TOOL_KEYS))
      if (e.key === key) return run(() => this.setTool(tool as keyof typeof TOOL_KEYS));
    if (k === 'n') return run(() => this.setNav(!this.state.nav));
    if (k === 'c') return run(() => this.toggleCut());
    if (k === 'p') return run(() => this.setBrowsing(true));
    if (this.state.cut !== null && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))
      return run(() => this.stepCut(e.key === 'ArrowUp' ? 1 : -1));
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

function toolHint(
  tool: EditorState['tool'],
  placing: string,
  marker: MarkerKind,
  wall: WallSettings,
): string | null {
  if (tool === 'select') return null;
  if (tool === 'wall')
    return wall.mode === 'draw'
      ? 'Click corners in turn: Enter or click the last to finish, the first to close a room. Esc stops.'
      : `Click a wall to cut a ${wall.mode} there. Esc stops.`;
  if (tool === 'terrain')
    return 'Drag on the ground to shape it; ⇧ to lower (or raise). [ and ] change the size. Esc stops.';
  if (tool === 'zone' || (tool === 'marker' && marker === 'patrol'))
    return `Click the ${tool === 'zone' ? "zone's corners" : "patrol's points"} in turn; Enter or click a point to finish. Esc stops.`;
  const what = tool === 'prefab' ? placing : tool === 'marker' ? MARKERS[marker] : tool;
  return `Click to place a ${what}. Esc stops.`;
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
 * A new marker or door where clicked, naming the first enemy type, container and loot
 * table there are (the scav and household if they exist). Spawns, extractions and quest
 * markers get ids, since other things name them.
 */
function newMarker(kind: MarkerKind, pos: Vec3, taken: Set<string>, colour: string): MapNode {
  const first = (ids: Iterable<string>, prefer: string): string => {
    const all = [...ids].sort();
    return all.includes(prefer) ? prefer : (all[0] ?? prefer);
  };
  const table = (): string => first(loadLootTables().keys(), 'household');
  switch (kind) {
    case 'playerSpawn':
      return { type: 'playerSpawn', id: uniqueId('spawn', taken), pos };
    case 'enemySpawn':
      return {
        type: 'enemySpawn',
        id: uniqueId('enemy', taken),
        pos,
        enemy: first(loadEnemies().types.keys(), 'scav'),
      };
    case 'lootContainer':
      return {
        type: 'lootContainer',
        pos,
        container: first(loadLootContainers().keys(), 'desk'),
        lootTable: table(),
      };
    case 'lootSpawn':
      return { type: 'lootSpawn', pos, lootTable: table() };
    case 'extraction':
      return {
        type: 'extraction',
        id: uniqueId('extract', taken),
        pos,
        name: 'Extraction',
        radius: 4,
      };
    case 'questMarker':
      return { type: 'questMarker', id: uniqueId('quest-marker', taken), pos };
    case 'door':
      return { type: 'door', pos, size: [1, 2.1], colour };
    case 'patrol':
      throw new Error('patrols are drawn a point at a time');
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
