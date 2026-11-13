import {
  LAYOUT_SPEEDS,
  heightAt,
  layoutIds,
  layoutSchema,
  rectCorners,
  toLocal,
  toWorld,
  type LayoutDef,
  type LayoutRect,
} from '@mes/shared';
import { groundSvg, layoutBody } from './sketch';

/*
 * The layout board at /layout?map=<id> (MK-3, 2026-11-12; tech/editors.md → Layout board):
 * a map's bones in 2D. It edits content/layouts/<id>.json as written (so a save keeps the
 * file's key order and leaves defaults out), checks it against the schema after every
 * change, and draws the last good version with the review sketch's own drawing.
 */

export type Kind = 'pads' | 'areas' | 'roads' | 'landmarks' | 'zones';
export type Tool = 'select' | 'area' | 'pad' | 'landmark' | 'road' | 'zone' | 'entrance' | 'rings';
export type Raw = Record<string, unknown>;
export interface Selection {
  kind: Kind;
  id: string;
  /** A road's or zone's point, picked by its handle. */
  point?: number;
}

export interface BoardState {
  layout: LayoutDef;
  /** Why the file as edited isn't a valid layout (the board shows the last one that was). */
  problem: string;
  selected: Selection | null;
  tool: Tool;
  dirty: boolean;
  saving: boolean;
  message: string;
  cursor: { x: number; z: number; y: number } | null;
  rings: { x: number; z: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped on every change, so React panels re-read the doc. */
  version: number;
}

export const RECT_KINDS: readonly Kind[] = ['pads', 'areas', 'landmarks'];
const LINE_KINDS: readonly Kind[] = ['roads', 'zones'];
const PREFIX: Record<Kind, string> = {
  pads: 'pad',
  areas: 'area',
  roads: 'road',
  landmarks: 'landmark',
  zones: 'zone',
};
const TOOL_KIND: Partial<Record<Tool, Kind>> = {
  area: 'areas',
  pad: 'pads',
  landmark: 'landmarks',
  road: 'roads',
  zone: 'zones',
};
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  a: 'area',
  p: 'pad',
  l: 'landmark',
  o: 'road',
  z: 'zone',
  e: 'entrance',
  g: 'rings',
};

const HANDLE_PX = 6;
const round = (v: number, step: number) => Math.round(v / step) * step;
const clean = (v: number) => +v.toFixed(3);

type Drag =
  | { type: 'pan'; sx: number; sy: number; cx: number; cz: number }
  | { type: 'move'; start: [number, number]; orig: Raw; key: string }
  | { type: 'corner'; corner: number; orig: LayoutRect; key: string }
  | { type: 'rotate'; orig: LayoutRect; key: string }
  | { type: 'point'; index: number; key: string }
  | { type: 'create'; kind: Kind; anchor: [number, number]; id: string | null; key: string };

export class LayoutBoard {
  state: BoardState;
  /** The file as edited. */
  doc: Raw;
  private saved: string;
  private exists: boolean;
  private history: string[] = [];
  private future: string[] = [];
  private lastMerge = '';
  private listeners = new Set<() => void>();
  private view = { cx: 0, cz: 0, scale: 2 };
  private svg: SVGSVGElement;
  private groundLayer: SVGGElement;
  private bodyLayer: SVGGElement;
  private groundKey = '';
  private drag: Drag | null = null;
  private draft: { kind: Kind; points: [number, number][] } | null = null;
  private frame = 0;
  private dragCount = 0;
  private scaleBar: HTMLElement;

  constructor(
    readonly id: string,
    raw: Raw | undefined,
    private host: HTMLElement,
  ) {
    this.exists = raw !== undefined;
    this.doc = structuredClone(raw ?? blankLayout(id));
    this.saved = this.exists ? JSON.stringify(this.doc) : '';
    const parsed = layoutSchema.safeParse(this.doc);
    this.state = {
      layout: parsed.success ? parsed.data : layoutSchema.parse(blankLayout(id)),
      problem: parsed.success ? '' : problemOf(parsed.error),
      selected: null,
      tool: 'select',
      dirty: !this.exists,
      saving: false,
      message: this.exists ? '' : `No content/layouts/${id}.json yet: saving makes it.`,
      cursor: null,
      rings: null,
      canUndo: false,
      canRedo: false,
      version: 0,
    };
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.classList.add('layout-sketch', 'lb-svg');
    this.groundLayer = document.createElementNS(ns, 'g');
    this.bodyLayer = document.createElementNS(ns, 'g');
    this.svg.append(this.groundLayer, this.bodyLayer);
    this.scaleBar = document.createElement('div');
    this.scaleBar.className = 'lb-scale';
    host.append(this.svg, this.scaleBar);
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', (e) => this.up(e));
    this.svg.addEventListener('dblclick', (e) => this.doubleClick(e));
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());
    this.svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.svg.addEventListener('pointerleave', () => this.set({ cursor: null }));
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('resize', () => this.render());
    window.addEventListener('beforeunload', (e) => {
      if (this.state.dirty) e.preventDefault();
    });
    this.fit();
  }

  // ----- state for React -----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): BoardState => this.state;

  set(patch: Partial<BoardState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
    this.render();
  }

  // ----- editing -----

  /**
   * Changes the doc. Changes with the same `merge` key in a row are one undo step (a drag,
   * typing into one field).
   */
  change(fn: (doc: Raw) => void, merge = ''): void {
    const before = JSON.stringify(this.doc);
    if (!merge || merge !== this.lastMerge) {
      this.history.push(before);
      if (this.history.length > 200) this.history.shift();
      this.future = [];
    }
    this.lastMerge = merge;
    fn(this.doc);
    this.reparse();
  }

  private reparse(message = ''): void {
    const text = JSON.stringify(this.doc);
    const parsed = layoutSchema.safeParse(this.doc);
    let selected = this.state.selected;
    const layout = parsed.success ? parsed.data : this.state.layout;
    if (selected && !this.piece(selected.kind, selected.id)) selected = null;
    this.set({
      layout,
      problem: parsed.success ? '' : problemOf(parsed.error),
      dirty: !this.exists || text !== this.saved,
      selected,
      message,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
      version: this.state.version + 1,
    });
  }

  undo(): void {
    const prev = this.history.pop();
    if (prev === undefined) return;
    this.future.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev) as Raw;
    this.lastMerge = '';
    this.reparse('Undone.');
  }

  redo(): void {
    const next = this.future.pop();
    if (next === undefined) return;
    this.history.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next) as Raw;
    this.lastMerge = '';
    this.reparse('Redone.');
  }

  /** A piece as written, or undefined. */
  piece(kind: Kind, id: string): Raw | undefined {
    const list = this.doc[kind];
    return Array.isArray(list) ? (list as Raw[]).find((p) => p.id === id) : undefined;
  }

  /** The doc's list of a kind, made if missing. */
  list(kind: Kind): Raw[] {
    if (!Array.isArray(this.doc[kind])) this.doc[kind] = [];
    return this.doc[kind] as Raw[];
  }

  /** Sets fields on the selected piece (undefined removes one). */
  edit(patch: Raw, merge = ''): void {
    const s = this.state.selected;
    if (!s) return;
    this.change(() => {
      const p = this.piece(s.kind, s.id);
      if (!p) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete p[k];
        else p[k] = v;
      }
      if (typeof patch.id === 'string') this.state.selected = { kind: s.kind, id: patch.id };
    }, merge);
  }

  select(sel: Selection | null): void {
    this.set({ selected: sel });
  }

  setTool(tool: Tool): void {
    this.finishDraft();
    this.set({ tool, message: TOOL_HINT[tool] });
  }

  freshId(kind: Kind): string {
    const used = layoutIds(this.state.layout);
    for (const p of this.list(kind)) used.add(String(p.id));
    for (let i = 1; ; i++) if (!used.has(`${PREFIX[kind]}-${i}`)) return `${PREFIX[kind]}-${i}`;
  }

  removeSelected(): void {
    const s = this.state.selected;
    if (!s) return;
    if (s.point !== undefined) {
      const p = this.piece(s.kind, s.id);
      const points = p?.points as unknown[] | undefined;
      const min = s.kind === 'zones' ? 3 : 2;
      if (!points || points.length <= min) {
        this.set({
          message: `A ${PREFIX[s.kind]} needs ${min} points; delete the whole thing instead.`,
        });
        return;
      }
      this.change(() => points.splice(s.point!, 1));
      this.select({ kind: s.kind, id: s.id });
      return;
    }
    this.change((doc) => {
      doc[s.kind] = this.list(s.kind).filter((p) => p.id !== s.id);
    });
    this.select(null);
  }

  duplicateSelected(): void {
    const s = this.state.selected;
    const p = s && this.piece(s.kind, s.id);
    if (!s || !p) return;
    const copy = structuredClone(p);
    copy.id = this.freshId(s.kind);
    if (Array.isArray(copy.points))
      copy.points = (copy.points as [number, number][]).map(([x, z]) => [x + 10, z + 10]);
    else {
      copy.x = clean(Number(copy.x) + 10);
      copy.z = clean(Number(copy.z) + 10);
    }
    this.change(() => this.list(s.kind).push(copy));
    this.select({ kind: s.kind, id: String(copy.id) });
  }

  // ----- saving -----

  async save(): Promise<void> {
    const { problem, dirty } = this.state;
    if (problem) return this.set({ message: `Not saved: ${problem}` });
    if (!dirty) return this.set({ message: 'Nothing to save.' });
    this.set({ saving: true });
    try {
      const res = await fetch('/__editor/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          files: [
            {
              file: `layouts/${this.id}.json`,
              doc: this.doc,
              ...(!this.exists && { create: true }),
            },
          ],
        }),
      });
      const reply = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
      this.exists = true;
      this.saved = JSON.stringify(this.doc);
      this.set({ saving: false, dirty: false, message: `Saved content/layouts/${this.id}.json.` });
    } catch (err) {
      this.set({
        saving: false,
        message: `Not saved: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  // ----- view -----

  /** Fits the whole map in the view. */
  fit(): void {
    const b = this.state.layout.bounds;
    const { width, height } = this.host.getBoundingClientRect();
    this.view.cx = (b.x0 + b.x1) / 2;
    this.view.cz = (b.z0 + b.z1) / 2;
    this.view.scale = Math.min(width / (b.x1 - b.x0 + 30), height / (b.z1 - b.z0 + 30)) || 2;
    this.render();
  }

  private render(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { width, height } = this.host.getBoundingClientRect();
    const { cx, cz, scale } = this.view;
    const w = width / scale;
    const h = height / scale;
    this.svg.setAttribute('viewBox', `${cx - w / 2} ${cz - h / 2} ${w} ${h}`);
    this.svg.style.setProperty('--px', `${1 / scale}px`);
    const l = this.state.layout;
    // The ground waits for a pad's or the slope's drag to end: it's thousands of cells.
    const key = JSON.stringify([l.bounds, l.slope, l.pads]);
    if (key !== this.groundKey && !(this.drag && this.drag.type !== 'pan')) {
      this.groundKey = key;
      const span = Math.max(l.bounds.x1 - l.bounds.x0, l.bounds.z1 - l.bounds.z0);
      this.groundLayer.innerHTML = groundSvg(l, span > 400 ? 10 : 5);
    }
    const sel = this.state.selected;
    this.bodyLayer.innerHTML =
      layoutBody(l, scale, { selected: sel?.id, rings: this.state.rings }) +
      this.handles() +
      this.draftSvg();
    // A scale bar of a round length near 120 px.
    const bar = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].reduce((a, v) =>
      Math.abs(v * scale - 120) < Math.abs(a * scale - 120) ? v : a,
    );
    this.scaleBar.style.width = `${bar * scale}px`;
    this.scaleBar.textContent = `${bar} m`;
  }

  private handles(): string {
    const s = this.state.selected;
    if (!s) return '';
    const r = HANDLE_PX / this.view.scale;
    const dot = (x: number, z: number, h: string, cls = '') =>
      `<circle class="lb-handle${cls}" data-handle="${h}" cx="${x}" cy="${z}" r="${r}"/>`;
    const l = this.state.layout;
    if (RECT_KINDS.includes(s.kind)) {
      const p = (l[s.kind] as LayoutRect[]).find((q) => (q as { id?: string }).id === s.id);
      if (!p) return '';
      const corners = rectCorners(p);
      const stalk = 28 / this.view.scale;
      const [fx, fz] = toWorld(p, 0, -p.d / 2);
      const [rx, rz] = toWorld(p, 0, -p.d / 2 - stalk);
      return (
        `<line class="lb-stalk" x1="${fx}" y1="${fz}" x2="${rx}" y2="${rz}"/>` +
        corners.map(([x, z], i) => dot(x, z, `corner:${i}`)).join('') +
        dot(rx, rz, 'rotate', ' rotate')
      );
    }
    const piece = (l[s.kind] as { id: string; points: [number, number][] }[]).find(
      (q) => q.id === s.id,
    );
    if (!piece) return '';
    const pts = piece.points;
    const closed = s.kind === 'zones';
    let out = pts.map(([x, z], i) => dot(x, z, `point:${i}`, s.point === i ? ' on' : '')).join('');
    // A smaller dot in the middle of each segment adds a point there when dragged.
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      out += `<circle class="lb-handle mid" data-handle="mid:${i + 1}" cx="${(a[0] + b[0]) / 2}" cy="${(a[1] + b[1]) / 2}" r="${r * 0.7}"/>`;
    }
    return out;
  }

  private draftSvg(): string {
    const d = this.draft;
    if (!d) return '';
    const cur = this.state.cursor;
    const pts = [...d.points, ...(cur ? [[cur.x, cur.z] as [number, number]] : [])];
    return `<polyline class="lb-draft" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
  }

  // ----- pointer -----

  private world(e: { clientX: number; clientY: number }): [number, number] {
    const box = this.svg.getBoundingClientRect();
    const { cx, cz, scale } = this.view;
    return [
      cx + (e.clientX - box.left - box.width / 2) / scale,
      cz + (e.clientY - box.top - box.height / 2) / scale,
    ];
  }

  /** A point snapped to the grid: 1 m, 0.1 m with Alt held. */
  private snap(p: [number, number], e: { altKey: boolean }): [number, number] {
    const step = e.altKey ? 0.1 : 1;
    return [clean(round(p[0], step)), clean(round(p[1], step))];
  }

  private down(e: PointerEvent): void {
    const target = e.target as Element;
    const p = this.world(e);
    this.svg.setPointerCapture(e.pointerId);
    const key = `drag-${++this.dragCount}`;
    if (e.button === 1 || e.button === 2) return this.startPan(e);
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
    const sel = this.state.selected;
    if (handle && sel) {
      const [type, arg] = handle.split(':');
      const rect = (this.state.layout[sel.kind] as (LayoutRect & { id: string })[]).find(
        (q) => q.id === sel.id,
      );
      if (type === 'corner' && rect)
        this.drag = { type: 'corner', corner: Number(arg), orig: { ...rect }, key };
      else if (type === 'rotate' && rect) this.drag = { type: 'rotate', orig: { ...rect }, key };
      else if (type === 'point') {
        this.drag = { type: 'point', index: Number(arg), key };
        this.select({ ...sel, point: Number(arg) });
      } else if (type === 'mid') {
        const i = Number(arg);
        const at = this.snap(p, e);
        this.change(
          () => (this.piece(sel.kind, sel.id)!.points as unknown[]).splice(i, 0, at),
          key,
        );
        this.drag = { type: 'point', index: i, key };
        this.select({ ...sel, point: i });
      }
      return;
    }
    const hit = target.closest('[data-kind]');
    const tool = this.state.tool;
    if (tool === 'rings') return this.set({ rings: { x: p[0], z: p[1] } });
    if (tool === 'entrance') return this.addEntrance(p, hit);
    const kind = TOOL_KIND[tool];
    if (kind && LINE_KINDS.includes(kind)) {
      const at = this.snap(p, e);
      if (!this.draft) this.draft = { kind, points: [at] };
      else if (
        kind === 'zones' &&
        this.draft.points.length >= 3 &&
        near(this.draft.points[0]!, p, 10 / this.view.scale)
      )
        this.finishDraft();
      else this.draft.points.push(at);
      return this.render();
    }
    if (kind) {
      this.drag = { type: 'create', kind, anchor: this.snap(p, e), id: null, key };
      return;
    }
    if (hit) {
      const k = hit.getAttribute('data-kind') as Kind;
      const id = hit.getAttribute('data-id')!;
      this.select({ kind: k, id });
      this.drag = { type: 'move', start: p, orig: structuredClone(this.piece(k, id) ?? {}), key };
      return;
    }
    this.select(null);
    this.startPan(e);
  }

  private startPan(e: PointerEvent): void {
    this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: this.view.cx, cz: this.view.cz };
  }

  private move(e: PointerEvent): void {
    const p = this.world(e);
    this.set({ cursor: { x: p[0], z: p[1], y: heightAt(this.state.layout, p[0], p[1]) } });
    const d = this.drag;
    if (!d) return;
    const sel = this.state.selected;
    if (d.type === 'pan') {
      this.view.cx = d.cx - (e.clientX - d.sx) / this.view.scale;
      this.view.cz = d.cz - (e.clientY - d.sy) / this.view.scale;
      return this.render();
    }
    if (d.type === 'create') return this.dragCreate(d, p, e);
    if (!sel) return;
    if (d.type === 'move') {
      const step = e.altKey ? 0.1 : 1;
      const dx = round(p[0] - d.start[0], step);
      const dz = round(p[1] - d.start[1], step);
      return this.change(() => {
        const piece = this.piece(sel.kind, sel.id)!;
        if (Array.isArray(d.orig.points))
          piece.points = (d.orig.points as [number, number][]).map(([x, z]) => [
            clean(x + dx),
            clean(z + dz),
          ]);
        else {
          piece.x = clean(Number(d.orig.x) + dx);
          piece.z = clean(Number(d.orig.z) + dz);
        }
      }, d.key);
    }
    if (d.type === 'point')
      return this.change(() => {
        (this.piece(sel.kind, sel.id)!.points as unknown[])[d.index] = this.snap(p, e);
      }, d.key);
    if (d.type === 'corner')
      return this.change(
        () =>
          Object.assign(
            this.piece(sel.kind, sel.id)!,
            resized(d.orig, d.corner, p, e.altKey ? 0.1 : 1),
          ),
        d.key,
      );
    if (d.type === 'rotate') {
      const yaw = (Math.atan2(-(p[0] - d.orig.x), -(p[1] - d.orig.z)) * 180) / Math.PI;
      const step = e.altKey ? 0.1 : e.shiftKey ? 15 : 5;
      return this.change(() => {
        this.piece(sel.kind, sel.id)!.yaw = clean((((round(yaw, step) % 360) + 540) % 360) - 180);
      }, d.key);
    }
  }

  private dragCreate(
    d: Extract<Drag, { type: 'create' }>,
    p: [number, number],
    e: PointerEvent,
  ): void {
    const [ax, az] = d.anchor;
    const [bx, bz] = this.snap(p, e);
    const w = Math.max(1, Math.abs(bx - ax));
    const dd = Math.max(1, Math.abs(bz - az));
    if (!d.id && Math.hypot(bx - ax, bz - az) < 2) return;
    const fields = {
      x: clean(Math.min(ax, bx) + w / 2),
      z: clean(Math.min(az, bz) + dd / 2),
      w: clean(w),
      d: clean(dd),
    };
    if (!d.id) {
      d.id = this.freshId(d.kind);
      const piece: Raw = { id: d.id, ...fields };
      if (d.kind === 'pads') piece.y = clean(heightAt(this.state.layout, fields.x, fields.z));
      if (d.kind === 'landmarks') piece.height = 30;
      if (d.kind === 'areas') piece.floors = 1;
      this.change(() => this.list(d.kind).push(piece), d.key);
      this.state.selected = { kind: d.kind, id: d.id };
    } else this.change(() => Object.assign(this.piece(d.kind, d.id!)!, fields), d.key);
  }

  private up(e: PointerEvent): void {
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    const d = this.drag;
    this.drag = null;
    this.lastMerge = '';
    if (d?.type === 'create' && d.id) this.setTool('select');
    this.render();
  }

  private doubleClick(e: MouseEvent): void {
    if (this.draft) {
      // The double click's second press added a point where the first did.
      this.draft.points.pop();
      this.finishDraft();
      return;
    }
    const hit = (e.target as Element).closest('[data-kind]');
    if (hit && this.state.tool === 'select')
      this.set({
        rings: centerOf(
          this.state.layout,
          hit.getAttribute('data-kind') as Kind,
          hit.getAttribute('data-id')!,
        ),
      });
  }

  private finishDraft(): void {
    const d = this.draft;
    this.draft = null;
    if (!d) return;
    const min = d.kind === 'zones' ? 3 : 2;
    if (d.points.length < min) {
      this.set({ message: `A ${PREFIX[d.kind]} needs at least ${min} points: not added.` });
      return;
    }
    const id = this.freshId(d.kind);
    this.change(() => this.list(d.kind).push({ id, points: d.points }));
    this.set({ selected: { kind: d.kind, id }, tool: 'select' });
  }

  private addEntrance(p: [number, number], hit: Element | null): void {
    // The area clicked, or else the nearest one within 4 m of its edge.
    const areas = this.state.layout.areas;
    let area =
      hit?.getAttribute('data-kind') === 'areas'
        ? areas.find((a) => a.id === hit.getAttribute('data-id'))
        : undefined;
    if (!area) {
      let best = 4;
      for (const a of areas) {
        const [lx, lz] = toLocal(a, ...p);
        const out = Math.hypot(
          Math.max(0, Math.abs(lx) - a.w / 2),
          Math.max(0, Math.abs(lz) - a.d / 2),
        );
        if (out < best) {
          best = out;
          area = a;
        }
      }
    }
    if (!area)
      return this.set({ message: 'Click on or next to an area’s side to put a way in there.' });
    const a = area;
    const [lx, lz] = toLocal(a, ...p);
    // The side nearest the click.
    const gaps = {
      front: Math.abs(lz + a.d / 2),
      back: Math.abs(lz - a.d / 2),
      left: Math.abs(lx + a.w / 2),
      right: Math.abs(lx - a.w / 2),
    };
    const side = (Object.keys(gaps) as (keyof typeof gaps)[]).reduce((m, k) =>
      gaps[k] < gaps[m] ? k : m,
    );
    const length = side === 'front' || side === 'back' ? a.w : a.d;
    const width = Math.min(2, length);
    const room = (length - width) / 2;
    const along = clean(
      Math.max(-room, Math.min(room, round(side === 'front' || side === 'back' ? lx : lz, 0.5))),
    );
    this.change(() => {
      const raw = this.piece('areas', a.id)!;
      const list = (Array.isArray(raw.entrances) ? raw.entrances : (raw.entrances = [])) as Raw[];
      list.push({ side, along, width });
    });
    this.set({
      selected: { kind: 'areas', id: a.id },
      message: `Way in added on ${a.id}'s ${side}.`,
    });
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const before = this.world(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    this.view.scale = Math.min(60, Math.max(0.3, this.view.scale * factor));
    const after = this.world(e);
    this.view.cx += before[0] - after[0];
    this.view.cz += before[1] - after[1];
    this.render();
  }

  private key(e: KeyboardEvent): void {
    const t = e.target;
    const typing =
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement;
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === 's') return (e.preventDefault(), void this.save());
      if (typing) return;
      if (k === 'z' && !e.shiftKey) return (e.preventDefault(), this.undo());
      if ((k === 'z' && e.shiftKey) || k === 'y') return (e.preventDefault(), this.redo());
      if (k === 'd') return (e.preventDefault(), this.duplicateSelected());
      return;
    }
    if (typing) return;
    if (e.key === 'Escape') {
      if (this.draft) return ((this.draft = null), this.render());
      if (this.state.rings) return this.set({ rings: null });
      return this.select(null);
    }
    if (e.key === 'Enter' && this.draft) return this.finishDraft();
    if (e.key === 'Delete' || e.key === 'Backspace')
      return (e.preventDefault(), this.removeSelected());
    if (e.key === 'f') return this.fit();
    const sel = this.state.selected;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = arrows[e.key];
    if (step && sel) {
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1;
      return this.change(() => {
        const p = this.piece(sel.kind, sel.id)!;
        if (Array.isArray(p.points))
          p.points = (p.points as [number, number][]).map(([x, z]) => [
            clean(x + step[0] * k),
            clean(z + step[1] * k),
          ]);
        else {
          p.x = clean(Number(p.x) + step[0] * k);
          p.z = clean(Number(p.z) + step[1] * k);
        }
      }, 'nudge');
    }
    const tool = TOOL_KEYS[e.key];
    if (tool) this.setTool(tool);
  }
}

const TOOL_HINT: Record<Tool, string> = {
  select:
    'Drag pieces to move them, corners to resize, the stalk to turn; drag empty ground to pan.',
  area: 'Drag out an area.',
  pad: 'Drag out a flat level of ground; set its height and edge in the panel.',
  landmark: 'Drag out a landmark’s footprint.',
  road: 'Click each point; Enter or double-click finishes.',
  zone: 'Click each corner; click the first again, press Enter or double-click to close.',
  entrance: 'Click on an area’s side to put a way in there.',
  rings: 'Click to center the walking-time rings (3.5 m/s solid, 6 m/s dashed); Esc clears.',
};

/** A rect resized by dragging one corner, the opposite one staying put. */
export function resized(r: LayoutRect, corner: number, p: [number, number], step: number): Raw {
  // Corners as rectCorners gives them: front-left, front-right, back-right, back-left.
  const sx = corner === 1 || corner === 2 ? 1 : -1;
  const sz = corner >= 2 ? 1 : -1;
  const ox = (-sx * r.w) / 2;
  const oz = (-sz * r.d) / 2;
  const [lx, lz] = toLocal(r, ...p);
  const w = Math.max(1, round(sx * (lx - ox), step));
  const d = Math.max(1, round(sz * (lz - oz), step));
  const [x, z] = toWorld(r, ox + (sx * w) / 2, oz + (sz * d) / 2);
  return { x: clean(x), z: clean(z), w: clean(w), d: clean(d) };
}

function near(a: [number, number], b: [number, number], r: number): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= r;
}

/** A piece's middle, for centering the rings on it. */
function centerOf(l: LayoutDef, kind: Kind, id: string): { x: number; z: number } | null {
  const p = (l[kind] as { id: string; x?: number; z?: number; points?: [number, number][] }[]).find(
    (q) => q.id === id,
  );
  if (!p) return null;
  if (p.points) {
    const n = p.points.length;
    return {
      x: p.points.reduce((s, q) => s + q[0], 0) / n,
      z: p.points.reduce((s, q) => s + q[1], 0) / n,
    };
  }
  return { x: p.x!, z: p.z! };
}

/** Seconds to walk and sprint a straight line between two points. */
export function travelTimes(
  a: { x: number; z: number },
  b: { x: number; z: number },
): { meters: number; walk: number; sprint: number } {
  const meters = Math.hypot(a.x - b.x, a.z - b.z);
  return { meters, walk: meters / LAYOUT_SPEEDS.walk, sprint: meters / LAYOUT_SPEEDS.sprint };
}

export function blankLayout(id: string): Raw {
  return { formatVersion: 1, id, bounds: { x0: 0, z0: 0, x1: 200, z1: 200 } };
}

function problemOf(err: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string {
  const issue = err.issues[0];
  if (!issue) return 'invalid';
  return `${issue.path.map(String).join('.') || 'layout'}: ${issue.message}${err.issues.length > 1 ? ` (and ${err.issues.length - 1} more)` : ''}`;
}
