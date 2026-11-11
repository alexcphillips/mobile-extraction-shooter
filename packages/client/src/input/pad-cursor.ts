import { unlockAudio } from '../app/audio';
import {
  PAD,
  bit,
  createPadFrame,
  createPadState,
  firstPad,
  mapPad,
  readPad,
  type PadButton,
  type PadFrame,
} from './gamepad';
import { inputMode } from './mode';
import {
  cellCenter,
  cursorSpeed,
  dirStep,
  nearestBox,
  stepRange,
  stepTarget,
  type Box,
  type Dir,
} from './pad-nav';

/**
 * What the cursor can land on: buttons and links, inputs (a radio's or checkbox's label),
 * tabs, item tiles, gear slots and grids (snapped to a cell), and anything marked
 * data-pad.
 */
const TARGETS = [
  'button:not(:disabled)',
  'a[href]',
  'input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not(:disabled)',
  'label:has(input:not(:disabled))',
  'textarea',
  '[role=button]',
  '[role=tab]',
  '.inv-item',
  '.inv-slot',
  '.inv-grid',
  '.inv-ground',
  '[data-pad]',
].join(', ');

/** The synthetic pointer's id, and the second one △ presses to turn a dragged item. */
const POINTER = 31;
/** The stick letting go snaps to a target this close (CSS pixels). */
const SNAP_RADIUS = 56;
/** Past this size, the cursor isn't pulled to a target's middle (a big panel button). */
const LARGE = 96;
/** A D-pad held repeats after this long, this often. */
const REPEAT_DELAY = 350;
const REPEAT_MS = 90;
/** The right stick scrolls this many pixels a second at full push. */
const SCROLL_SPEED = 1400;
/** Away from the pad this long (ms), the cursor's own reading starts afresh. */
const STALE_MS = 150;
/** The raid claimed or fed the pad within this (ms): the cursor doesn't read it itself. */
const OWNED_MS = 100;

/** What the raid gives the cursor while one of its screens is up. */
export interface CursorContext {
  /** Closes the raid screen (○ with nothing else open, Options, the touchpad). */
  close?: () => void;
}

const DIRS: readonly [PadButton, Dir][] = [
  [PAD.up, 'up'],
  [PAD.down, 'down'],
  [PAD.left, 'left'],
  [PAD.right, 'right'],
];

const has = (mask: number, b: PadButton): boolean => (mask & bit(b)) !== 0;

/**
 * The pad's menu cursor (CP-2, 2026-11-08), drawn over everything in gamepad mode while a
 * menu or screen is up. The left stick moves it (creeping on a small push, speeding up
 * held), and it snaps to the nearest target when the stick lets go; the D-pad steps it to
 * the next target, or one cell in a grid. It works the page by sending it synthetic
 * pointer, mouse and key events at its spot, so the screens' own handlers do the work:
 * ✕ clicks (held and moved, it drags), □ is a double-tap (quick move), △ a right-click
 * (details) or, while dragging, the second finger that turns the item, ○ is Esc (back),
 * L1/R1 the previous and next tab, the right stick scrolls what's under it. A range
 * input can't be dragged by synthetic events, so ✕ grabs it, the stick or D-pad steps it,
 * and ✕ or ○ lets go. In a raid the pad driver feeds it frames while a screen is open,
 * and claims the pad (hiding it) while you play; anywhere else it reads the pad itself.
 */
class PadCursor {
  private x = window.innerWidth / 2;
  private y = window.innerHeight / 2;
  private readonly dot = document.createElement('div');
  private readonly ring = document.createElement('div');
  private readonly state = createPadState();
  private frameA = createPadFrame();
  private frameB = createPadFrame();
  private lastRead = 0;
  private claimedAt = -Infinity;
  private fedAt = -Infinity;
  private active = false;
  private started = false;
  /** Seconds the move stick has been pushed. */
  private pushed = 0;
  /** Where ✕ went down, while it's held. */
  private press: Element | null = null;
  /** The range input ✕ grabbed, and the part-step the stick has built up. */
  private range: HTMLInputElement | null = null;
  private rangeAcc = 0;
  /** The D-pad direction held, and when it next repeats. */
  private repeatDir: Dir | null = null;
  private repeatAt = 0;
  private scrollAccX = 0;
  private scrollAccY = 0;
  private over: Element | null = null;
  private lastX = NaN;
  private lastY = NaN;

  constructor() {
    this.dot.className = 'pad-cursor';
    this.ring.className = 'pad-ring';
    this.dot.hidden = this.ring.hidden = true;
  }

  /** Starts reading the pad once one is connected (a phone with none never polls). */
  start(): void {
    if (this.started) return;
    const go = (): void => {
      if (this.started) return;
      this.started = true;
      document.body.append(this.ring, this.dot);
      requestAnimationFrame(this.loop);
    };
    window.addEventListener('gamepadconnected', go);
    if (firstPad(navigator.getGamepads?.() ?? [])) go();
  }

  /** The raid is being played with the pad: the cursor stays out of it. */
  claim(): void {
    this.claimedAt = performance.now();
    if (this.active) this.deactivate();
  }

  /** A frame from the raid's pad driver, while a raid screen (or the results) is up. */
  feed(f: PadFrame, dtMs: number, ctx: CursorContext): void {
    this.fedAt = performance.now();
    if (!inputMode.gamepad) {
      if (this.active) this.deactivate();
      return;
    }
    this.step(f, dtMs / 1000, ctx);
  }

  private readonly loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    if (now - this.claimedAt < OWNED_MS || now - this.fedAt < OWNED_MS) return;
    const gp = firstPad(navigator.getGamepads?.() ?? []);
    if (!gp) {
      if (this.active) this.deactivate();
      return;
    }
    readPad(gp, this.state);
    const prev = this.frameA;
    this.frameA = this.frameB;
    this.frameB = prev;
    const dt = now - this.lastRead;
    mapPad(this.state, prev, Math.min(dt, 50) / 1000, this.frameA);
    const f = this.frameA;
    // Back after a while (the raid had it, or the tab was away): what's held isn't a press.
    if (dt > STALE_MS) f.pressed = f.released = 0;
    this.lastRead = now;
    if (f.active && !inputMode.gamepad) {
      inputMode.usePad();
      unlockAudio();
    }
    if (!inputMode.gamepad) {
      if (this.active) this.deactivate();
      return;
    }
    this.step(f, Math.min(dt, 50) / 1000, {});
  };

  private step(f: PadFrame, dt: number, ctx: CursorContext): void {
    // The press that brings the cursor up only shows it: it can't click what it couldn't see.
    const pressed = this.active ? f.pressed : 0;
    if (!this.active) this.activate();

    if (this.range) {
      this.stepRangeInput(f, dt);
      this.draw();
      return;
    }

    if (has(pressed, PAD.options)) this.options(ctx);
    else if (has(pressed, PAD.circle)) this.back(ctx);
    else if (has(pressed, PAD.touchpad)) ctx.close?.();

    // D-pad: a step, repeating while held.
    const now = performance.now();
    let dir: Dir | null = null;
    for (const [b, d] of DIRS) if (has(f.held, b)) dir = d;
    if (dir && dir !== this.repeatDir) {
      this.repeatDir = dir;
      this.repeatAt = now + REPEAT_DELAY;
      this.stepDir(dir);
    } else if (dir && now >= this.repeatAt) {
      this.repeatAt = now + REPEAT_MS;
      this.stepDir(dir);
    } else if (!dir) this.repeatDir = null;

    // Left stick: move, then snap when it lets go.
    const mag = Math.min(1, Math.hypot(f.moveX, f.moveY));
    if (mag > 0) {
      this.pushed += dt;
      const speed = cursorSpeed(mag, this.pushed);
      this.moveTo(this.x + f.moveX * speed * dt, this.y - f.moveY * speed * dt);
    } else if (this.pushed > 0) {
      this.pushed = 0;
      this.snap();
    }

    if (f.lookX !== 0 || f.lookY !== 0) this.scroll(f.lookX, f.lookY, dt);
    else this.scrollAccX = this.scrollAccY = 0;

    this.pointerMoved();
    if (has(pressed, PAD.cross)) this.down();
    else if (has(f.released, PAD.cross)) this.up();
    if (has(pressed, PAD.square)) this.quick();
    if (has(pressed, PAD.triangle)) {
      if (this.dragging) this.rotate();
      else this.details();
    }
    if (has(pressed, PAD.l1)) this.tab(-1);
    if (has(pressed, PAD.r1)) this.tab(1);
    this.draw();
  }

  private activate(): void {
    this.active = true;
    this.dot.hidden = false;
    this.x = Math.min(this.x, window.innerWidth - 1);
    this.y = Math.min(this.y, window.innerHeight - 1);
    this.snap();
    this.lastX = this.lastY = NaN;
  }

  /** Hides it, and lets go of anything it holds down. */
  private deactivate(): void {
    this.active = false;
    this.dot.hidden = this.ring.hidden = true;
    if (this.press) {
      this.dispatchPointer('pointercancel', this.press, 0);
      this.press = null;
    }
    this.releaseRange();
    this.pushed = 0;
    this.repeatDir = null;
    this.over = null;
  }

  private get dragging(): boolean {
    return document.body.classList.contains('inv-dragging');
  }

  private moveTo(x: number, y: number): void {
    this.x = Math.max(0, Math.min(window.innerWidth - 1, x));
    this.y = Math.max(0, Math.min(window.innerHeight - 1, y));
  }

  private hit(): Element | null {
    return document.elementFromPoint(this.x, this.y);
  }

  // Pointer events

  private dispatchPointer(type: string, at: Element, buttons: number, id = POINTER): boolean {
    return at.dispatchEvent(
      new PointerEvent(type, {
        bubbles: type !== 'pointerenter' && type !== 'pointerleave',
        cancelable: true,
        composed: true,
        pointerId: id,
        pointerType: 'mouse',
        isPrimary: id === POINTER,
        clientX: this.x,
        clientY: this.y,
        button: type === 'pointermove' ? -1 : 0,
        buttons,
      }),
    );
  }

  private dispatchMouse(type: string, at: Element, button = 0): boolean {
    return at.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: this.x,
        clientY: this.y,
        button,
        buttons: 0,
      }),
    );
  }

  private key(code: string, key = code): void {
    const at = document.activeElement ?? document.body;
    for (const type of ['keydown', 'keyup']) {
      at.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, code, key }));
    }
  }

  /** Moves the pointer the page sees (the hover card, a drag) when the cursor moved. */
  private pointerMoved(): void {
    if (this.x === this.lastX && this.y === this.lastY) return;
    this.lastX = this.x;
    this.lastY = this.y;
    const hit = this.hit();
    if (hit !== this.over) {
      if (this.over?.isConnected) this.dispatchPointer('pointerout', this.over, this.press ? 1 : 0);
      if (hit) this.dispatchPointer('pointerover', hit, this.press ? 1 : 0);
      this.over = hit;
    }
    if (hit) this.dispatchPointer('pointermove', hit, this.press ? 1 : 0);
  }

  /** ✕ down: a pointer press there (a range input is grabbed instead). */
  private down(): void {
    const hit = this.hit();
    if (!hit) return;
    const range = hit.closest<HTMLInputElement>('input[type=range]');
    if (range && !range.disabled) {
      this.range = range;
      this.rangeAcc = 0;
      range.classList.add('pad-grabbed');
      range.focus({ preventScroll: true });
      return;
    }
    // As a mouse press: what it's on takes the focus (a text field, to type in), else none.
    const focusable = hit.closest<HTMLElement>(
      'button, input, textarea, select, a[href], [tabindex]',
    );
    if (focusable) focusable.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.press = hit;
    this.dispatchPointer('pointerdown', hit, 1);
  }

  /** ✕ up: the pointer lets go there, and clicks what both ends were on. */
  private up(): void {
    const from = this.press;
    if (!from) return;
    this.press = null;
    const hit = this.hit() ?? document.body;
    this.dispatchPointer('pointerup', hit, 0);
    let target: Node | null = from.isConnected ? from : hit;
    while (target && !target.contains(hit)) target = target.parentNode;
    if (target instanceof Element) this.dispatchMouse('click', target);
  }

  /** □: two taps at once, the double-tap that moves an item where it goes. */
  private quick(): void {
    const item = this.hit()?.closest('.inv-item');
    if (!item || this.press) return;
    for (let i = 0; i < 2; i++) {
      this.dispatchPointer('pointerdown', item, 1);
      this.dispatchPointer('pointerup', item, 0);
      this.dispatchMouse('click', item);
    }
  }

  /** △: a right-click, which opens an item's details. */
  private details(): void {
    const hit = this.hit();
    if (hit) this.dispatchMouse('contextmenu', hit, 2);
  }

  /** △ while dragging: a second finger down and up, which turns the item. */
  private rotate(): void {
    const hit = this.hit() ?? document.body;
    this.dispatchPointer('pointerdown', hit, 1, POINTER + 1);
    this.dispatchPointer('pointerup', hit, 0, POINTER + 1);
  }

  /** The open settings, if any. */
  private settings(): HTMLElement | null {
    return document.querySelector('[role="dialog"][aria-label="Settings"]');
  }

  private closeSettings(s: HTMLElement): void {
    s.querySelector<HTMLButtonElement>('header button.primary')?.click();
  }

  /** ○: back. A drag is dropped where it began, then settings, details, the screen, the page. */
  private back(ctx: CursorContext): void {
    if (this.press) {
      // Ends a drag without dropping it (Esc would also leave the page).
      this.dispatchPointer('pointercancel', this.press, 0);
      this.press = null;
      return;
    }
    const s = this.settings();
    if (s) return this.closeSettings(s);
    // The details close on Esc, before the page's own Esc (item-details.tsx).
    if (ctx.close && !document.querySelector('.item-details')) return ctx.close();
    this.key('Escape');
  }

  /** Options: closes settings or the screen; on the main menu, opens settings. */
  private options(ctx: CursorContext): void {
    const s = this.settings();
    if (s) return this.closeSettings(s);
    if (ctx.close) return ctx.close();
    const open = document.querySelector<HTMLElement>('[data-pad-options]');
    if (open && open.getClientRects().length > 0) open.click();
    else this.key('Escape');
  }

  /** L1/R1: the previous or next tab of the nearest tab strip (stash pages, raid tabs). */
  private tab(by: number): void {
    let scope: Element | null = (this.hit() ?? document.body).closest('[role="dialog"]');
    for (;;) {
      const lists = (scope ?? document).querySelectorAll('[role="tablist"]');
      for (const list of lists) {
        const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
          (t) => t.getClientRects().length > 0 && !(t as HTMLButtonElement).disabled,
        );
        if (!tabs.length) continue;
        const at = tabs.findIndex(
          (t) => t.getAttribute('aria-selected') === 'true' || t.classList.contains('active'),
        );
        const next = tabs[Math.max(0, Math.min(tabs.length - 1, at + by))]!;
        if (next !== tabs[at]) next.click();
        return;
      }
      if (!scope) return;
      scope = scope.parentElement?.closest('[role="dialog"]') ?? null;
    }
  }

  /** Right stick: scrolls what's under the cursor. */
  private scroll(lx: number, ly: number, dt: number): void {
    const hit = this.hit();
    this.scrollAccX += lx * SCROLL_SPEED * dt;
    this.scrollAccY += ly * SCROLL_SPEED * dt;
    const sx = Math.trunc(this.scrollAccX);
    const sy = Math.trunc(this.scrollAccY);
    this.scrollAccX -= sx;
    this.scrollAccY -= sy;
    if (sy) {
      const el = scrollerOf(hit, 'y');
      if (el) el.scrollTop += sy;
    }
    if (sx) {
      const el = scrollerOf(hit, 'x');
      if (el) el.scrollLeft += sx;
    }
    if (sx || sy) this.lastX = NaN; // what's under the cursor moved
  }

  /** The D-pad: one cell in a grid, else the next target that way. */
  private stepDir(dir: Dir): void {
    const [dx, dy] = dirStep(dir);
    const hit = this.hit();
    const grid = hit?.closest<HTMLElement>('.inv-grid');
    const cell = Number(grid?.dataset.cell);
    if (grid && cell > 0) {
      const r = grid.getBoundingClientRect();
      const from = this.dragging ? null : hit!.closest('.inv-item');
      let [x, y] = cellCenter(this.x, this.y, r, cell);
      for (let i = 0; i < 64; i++) {
        x += dx * cell;
        y += dy * cell;
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) break;
        // Not dragging, a step leaves the item it's on: a gun is one step, not four.
        const on = document.elementFromPoint(x, y)?.closest('.inv-item') ?? null;
        if (from && on === from) continue;
        this.moveTo(x, y);
        return;
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const { els, boxes } = gather();
      const to = stepTarget(this.x, this.y, dir, boxes);
      if (to) {
        this.moveTo(to.x, to.y);
        this.snapTo(els[to.index]!, boxes[to.index]!);
        return;
      }
      // Nothing that way on screen: scroll what's under the cursor and look again.
      const el = scrollerOf(hit, dx ? 'x' : 'y');
      if (!el) return;
      if (dx) el.scrollLeft += dx * el.clientWidth * 0.6;
      else el.scrollTop += dy * el.clientHeight * 0.6;
    }
  }

  /** Pulls the cursor onto the nearest target, if one is close. */
  private snap(): void {
    const { els, boxes } = gather();
    const i = nearestBox(this.x, this.y, boxes, SNAP_RADIUS);
    if (i >= 0) this.snapTo(els[i]!, boxes[i]!);
  }

  /** Onto a target: a grid's (or a tile's) cell, a small target's middle, inside a large one. */
  private snapTo(el: Element, box: Box): void {
    const grid = el.classList.contains('inv-grid') ? el : el.closest('.inv-grid');
    const cell = Number((grid as HTMLElement | null)?.dataset.cell);
    const x = Math.max(box.left + 1, Math.min(box.left + box.width - 1, this.x));
    const y = Math.max(box.top + 1, Math.min(box.top + box.height - 1, this.y));
    if (grid && cell > 0) {
      const [cx, cy] = cellCenter(x, y, grid.getBoundingClientRect(), cell);
      this.moveTo(cx, cy);
      return;
    }
    const inset = 16;
    const along = (lo: number, size: number, p: number): number =>
      size <= LARGE ? lo + size / 2 : Math.max(lo + inset, Math.min(lo + size - inset, p));
    this.moveTo(along(box.left, box.width, x), along(box.top, box.height, y));
  }

  /** While a range input is grabbed: the stick or D-pad steps it; ✕ or ○ lets go. */
  private stepRangeInput(f: PadFrame, dt: number): void {
    const r = this.range!;
    if (!r.isConnected || has(f.pressed, PAD.cross) || has(f.pressed, PAD.circle)) {
      this.releaseRange();
      return;
    }
    const min = Number(r.min || 0);
    const max = Number(r.max || 100);
    const step = Number(r.step) || 1;
    let by = 0;
    const now = performance.now();
    let dir = 0;
    if (has(f.held, PAD.left)) dir = -1;
    if (has(f.held, PAD.right)) dir = 1;
    if (dir && (has(f.pressed, PAD.left) || has(f.pressed, PAD.right))) {
      by = dir;
      this.repeatAt = now + REPEAT_DELAY;
    } else if (dir && now >= this.repeatAt) {
      by = dir;
      this.repeatAt = now + REPEAT_MS;
    }
    // The stick: up to about two thirds of the range a second, slower on a small push.
    const steps = (max - min) / step;
    this.rangeAcc += Math.sign(f.moveX) * f.moveX * f.moveX * Math.max(6, steps * 0.6) * dt;
    const whole = Math.trunc(this.rangeAcc);
    this.rangeAcc -= whole;
    by += whole;
    if (!by) return;
    const value = stepRange(Number(r.value), min, max, step, by);
    if (value === Number(r.value)) return;
    // Through the native setter, so React sees the change.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      r,
      String(value),
    );
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private releaseRange(): void {
    this.range?.classList.remove('pad-grabbed');
    this.range = null;
  }

  private draw(): void {
    this.dot.style.transform = `translate(${this.x}px, ${this.y}px)`;
    this.dot.classList.toggle('grab', !!this.range || this.dragging);
    const target = this.range ?? this.hit()?.closest(TARGETS);
    if (!target || (this.dragging && !this.range)) {
      this.ring.hidden = true;
      return;
    }
    let r: Box = target.getBoundingClientRect();
    const cell = Number((target as HTMLElement).dataset.cell);
    if (target.classList.contains('inv-grid') && cell > 0) {
      const [cx, cy] = cellCenter(this.x, this.y, r, cell);
      r = { left: cx - cell / 2, top: cy - cell / 2, width: cell, height: cell };
    }
    this.ring.hidden = false;
    const s = this.ring.style;
    s.transform = `translate(${r.left}px, ${r.top}px)`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
  }
}

/** The nearest element at or above `el` that scrolls that way and has more to show. */
function scrollerOf(el: Element | null, axis: 'x' | 'y'): HTMLElement | null {
  for (let n = el; n instanceof HTMLElement; n = n.parentElement) {
    const style = getComputedStyle(n);
    const o = axis === 'y' ? style.overflowY : style.overflowX;
    const more = axis === 'y' ? n.scrollHeight > n.clientHeight : n.scrollWidth > n.clientWidth;
    if ((o === 'auto' || o === 'scroll') && more) return n;
  }
  const page = document.scrollingElement;
  return page instanceof HTMLElement &&
    (axis === 'y' ? page.scrollHeight > page.clientHeight : page.scrollWidth > page.clientWidth)
    ? page
    : null;
}

/**
 * Every target on screen that can be reached: its box clipped to what scrolls it, and not
 * under something else (a dialog over the page) at the middle of what shows.
 */
function gather(): { els: Element[]; boxes: Box[] } {
  const els: Element[] = [];
  const boxes: Box[] = [];
  const clips = new Map<Element, Box>();
  const view: Box = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const clipOf = (el: Element | null): Box => {
    if (!el || el === document.body || el === document.documentElement) return view;
    const known = clips.get(el);
    if (known) return known;
    const outer = clipOf(el.parentElement);
    const style = getComputedStyle(el);
    const clip =
      style.overflowX !== 'visible' || style.overflowY !== 'visible'
        ? intersect(el.getBoundingClientRect(), outer)
        : outer;
    clips.set(el, clip);
    return clip;
  };
  for (const el of document.querySelectorAll(TARGETS)) {
    if (el.closest('[hidden], [aria-hidden="true"]')) continue;
    const box = intersect(el.getBoundingClientRect(), clipOf(el.parentElement));
    if (box.width < 4 || box.height < 4) continue;
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!at || !(at === el || el.contains(at))) continue;
    els.push(el);
    boxes.push(box);
  }
  return { els, boxes };
}

function intersect(a: Box, b: Box): Box {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export const padCursor = new PadCursor();
