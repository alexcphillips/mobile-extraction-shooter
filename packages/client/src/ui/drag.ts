import type {
  AttachmentSlot,
  GearSlot,
  Grid,
  GridRef,
  ItemRef,
  Owner,
  PartRef,
  Target,
} from '@mes/shared';

/** A gun's attachment slot, to drop an attachment on. */
export interface PartSlot {
  gun: ItemRef;
  slot: AttachmentSlot;
}

/** Into someone's or something's items, wherever there's room (a stash page's tab). */
export interface Into {
  into: Owner;
}

/** Onto a piece of armor, to mend it with the repair kit dropped (session 13b). */
export interface RepairOn {
  repair: ItemRef;
}

/** Onto a gun, to load it with the rounds dropped (2026-10-30). */
export interface LoadOn {
  load: ItemRef;
}

/**
 * Something items can be dropped on. Its element has a data-drop attribute describing it,
 * which the host turns into this.
 */
export type DropZone =
  | { kind: 'grid'; ref: GridRef; grid: Grid }
  | { kind: 'slot'; owner: Owner; slot: GearSlot }
  | ({ kind: 'part' } & PartSlot)
  /** Dropped at your feet. */
  | { kind: 'ground' }
  /** Put wherever there's room, as a double-tap would. */
  | { kind: 'into'; owner: Owner }
  /** A repair kit onto armor (an element with a data-armor attribute). */
  | { kind: 'repair'; armor: ItemRef }
  /** Rounds onto a gun that fires them (an element with a data-gun attribute). */
  | { kind: 'load'; gun: ItemRef };

/** The item a pointer went down on: in a grid or gear slot, or on a gun. */
export interface DragSource {
  ref: ItemRef | PartRef;
  /** Its size unrotated, and whether it's turned now. */
  w: number;
  h: number;
  rotated: boolean;
  /** The cell it was grabbed by, from its top-left as it lies. */
  grabX: number;
  grabY: number;
  color: string;
  label: string;
  el: HTMLElement;
}

export interface DragHost {
  /** Cell size in CSS pixels. */
  readonly cell: number;
  /** The zone an element with a data-drop attribute is, if it can be reached. */
  zoneAt: (el: HTMLElement) => DropZone | null;
  /**
   * The slot of a gun (an element with a data-gun attribute) that the dragged item would
   * go on, if it's an attachment that fits (loose, or from another gun), or loading it if
   * it's rounds the gun fires; otherwise null, and the drag treats the gun as part of its
   * grid or gear slot.
   */
  gunZone: (src: DragSource, gun: ItemRef) => DropZone | null;
  /**
   * A repair zone if the dragged item is a repair kit (an element with a data-armor
   * attribute is armor); otherwise null, and the armor is part of its grid or slot.
   */
  armorZone: (src: DragSource, armor: ItemRef) => DropZone | null;
  /** Whether the item may drop on a zone there (x, y: the top-left cell for a grid). */
  canDrop: (src: DragSource, zone: DropZone, x: number, y: number, rotated: boolean) => boolean;
  drop: (src: DragSource, to: Target | PartSlot | Into | RepairOn | LoadOn) => void;
  /** Let go over a zone that won't take it: to say why, if there's a reason worth it. */
  refused?: (src: DragSource, zone: DropZone) => void;
  tap: (src: DragSource) => void;
}

function swallowClick(e: Event): void {
  e.stopPropagation();
}

/** How far a pointer moves before a press becomes a drag, in CSS pixels. */
const SLOP = 8;

/**
 * How long a finger holds still on an item before it lifts (UX-1, 2026-11-08). Shorter
 * than DOUBLE_TAP_MS (350), so both taps of a double-tap stay taps; a finger that moves
 * before then scrolls instead.
 */
export const HOLD_MS = 200;

/**
 * What a touch press on an item is so far: still waiting, a scroll (it moved past the
 * slop before HOLD_MS), or a lift (it held still that long). A mouse skips this and drags
 * as soon as it moves.
 */
export function touchPress(moved: number, heldMs: number): 'wait' | 'scroll' | 'lift' {
  if (moved >= SLOP) return 'scroll';
  return heldMs >= HOLD_MS ? 'lift' : 'wait';
}

/** Whether a finger holds a lifted item, so it mustn't scroll the page. */
let holding = false;
let blockerAdded = false;

/**
 * Items let a finger pan their panel (touch-action: pan-y), so once one is lifted its
 * touchmoves are canceled to keep the panel still. Added once, up front and not passive:
 * Safari decides at touchstart whether a touch's moves can be canceled.
 */
function addScrollBlocker(): void {
  if (blockerAdded) return;
  blockerAdded = true;
  document.addEventListener(
    'touchmove',
    (e) => {
      if (holding && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
}

/** The fastest a drag held at a scrolling area's edge scrolls it, in cells a second. */
const SCROLL_SPEED = 12;

/** The nearest element at or above `el` that scrolls up and down and has more to show. */
function scrollerOf(el: Element | null): HTMLElement | null {
  for (let n = el; n instanceof HTMLElement; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * Drag and drop for inventory items, in plain DOM so a drag never re-renders React. A
 * mouse press that moves becomes a drag with a ghost under the pointer. A finger has to
 * hold still for HOLD_MS first, and the item lifts (the ghost pops up under it); a finger
 * that moves sooner is left to scroll the panel. A press that ends without moving is a
 * tap, even after a lift. While dragging, a second finger (or R) turns the item, and holding it within a cell
 * of a scrolling area's top or bottom edge (or past it) scrolls that area.
 */
export class DragController {
  private src: DragSource | null = null;
  private pointer = -1;
  private startX = 0;
  private startY = 0;
  private x = 0;
  private y = 0;
  private dragging = false;
  /** A touch press, which must hold still to lift (see touchPress). */
  private touch = false;
  /** Whether the pointer has moved past the slop since it went down. */
  private moved = false;
  private holdTimer = 0;
  private rotated = false;
  private ghost: HTMLElement | null = null;
  /** The empty slots marked as fitting the dragged item. */
  private readonly fits: HTMLElement[] = [];
  private hover: { zone: DropZone; el: HTMLElement; x: number; y: number; ok: boolean } | null =
    null;
  private readonly highlight = document.createElement('div');
  /** The area the drag was last over that scrolls, and the frame that scrolls it. */
  private scroller: HTMLElement | null = null;
  private scrollFrame = 0;
  private scrollTime = 0;

  constructor(private readonly host: DragHost) {
    this.highlight.className = 'inv-drop';
    addScrollBlocker();
  }

  /** Call from an item's pointerdown. */
  down(e: PointerEvent, src: DragSource): void {
    if (this.src) {
      // A second finger while dragging turns the item.
      if (this.dragging) this.rotate();
      return;
    }
    if (e.button > 0) return;
    e.preventDefault();
    this.src = src;
    this.pointer = e.pointerId;
    this.startX = this.x = e.clientX;
    this.startY = this.y = e.clientY;
    this.rotated = src.rotated;
    this.moved = false;
    this.touch = e.pointerType !== 'mouse';
    if (this.touch) this.holdTimer = window.setTimeout(this.onHold, HOLD_MS);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('pointerdown', this.onOtherDown, true);
    // Before a page's own Esc (going back), so Esc only drops the drag.
    window.addEventListener('keydown', this.onKey, true);
    // Android's long-press menu (a right-click) would open the details and drop the item.
    window.addEventListener('contextmenu', this.onContextMenu, true);
  }

  /** Whether an item is pressed or being dragged. */
  get busy(): boolean {
    return this.src !== null;
  }

  /** Stops any drag, without dropping. */
  cancel(): void {
    this.end();
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer || !this.src) return;
    this.x = e.clientX;
    this.y = e.clientY;
    if (!this.moved) this.moved = Math.hypot(this.x - this.startX, this.y - this.startY) >= SLOP;
    if (!this.dragging) {
      if (!this.moved) return;
      // A finger that moves before it lifts is scrolling: let it go (the panel may already
      // have canceled the pointer). One moving sideways scrolls nothing, and still lets go.
      if (this.touch) return this.end();
      this.start();
    }
    this.update();
  };

  private readonly onHold = (): void => {
    this.holdTimer = 0;
    if (!this.src || this.dragging) return;
    // It might have moved past the slop between pointermove events; check what we have.
    if (touchPress(Math.hypot(this.x - this.startX, this.y - this.startY), HOLD_MS) !== 'lift') {
      return this.end();
    }
    holding = true;
    this.start();
    this.ghost!.classList.add('lifted');
    this.update();
  };

  private readonly onContextMenu = (e: Event): void => {
    if (!this.touch) return;
    e.preventDefault();
    e.stopPropagation();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer || !this.src) return;
    const src = this.src;
    const hover = this.hover;
    // A lifted item let go where it was picked up is a tap, not a drop on itself.
    const dragging = this.dragging && this.moved;
    const lifted = this.dragging;
    const rotated = this.rotated;
    this.end();
    // The click a drag ends with (a mouse's, in the same task) isn't a tap on whatever it
    // was dropped on. A touch drag ends with none, so don't wait for one.
    if (lifted) {
      window.addEventListener('click', swallowClick, true);
      setTimeout(() => window.removeEventListener('click', swallowClick, true));
    }
    if (!dragging) {
      this.host.tap(src);
    } else if (hover?.ok) {
      const z = hover.zone;
      this.host.drop(
        src,
        z.kind === 'grid'
          ? { ...z.ref, x: hover.x, y: hover.y, rotated }
          : z.kind === 'slot'
            ? { owner: z.owner, slot: z.slot }
            : z.kind === 'ground'
              ? { owner: { kind: 'ground' } }
              : z.kind === 'into'
                ? { into: z.owner }
                : z.kind === 'repair'
                  ? { repair: z.armor }
                  : z.kind === 'load'
                    ? { load: z.gun }
                    : { gun: z.gun, slot: z.slot },
      );
    } else if (hover) {
      this.host.refused?.(src, hover.zone);
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.pointer) this.end();
  };

  private readonly onOtherDown = (e: PointerEvent): void => {
    if (e.pointerId === this.pointer || !this.dragging) return;
    // Turning it counts as moving it: it'll drop where it's let go, not tap.
    this.moved = true;
    e.preventDefault();
    e.stopPropagation();
    this.rotate();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR' && this.dragging && !e.repeat) this.rotate();
    else if (e.code === 'Escape') {
      e.stopPropagation();
      this.end();
    }
  };

  private start(): void {
    const src = this.src!;
    this.dragging = true;
    src.el.classList.add('dragging');
    // The details panel hides while dragging (UX-2), so what it covers can be dropped on.
    document.body.classList.add('inv-dragging');
    const g = document.createElement('div');
    g.className = 'inv-ghost';
    g.style.background = src.color;
    g.textContent = src.label;
    document.body.append(g);
    this.ghost = g;
    this.sizeGhost();
    this.markFits();
  }

  /** Empty gear slots the item could go in, shaded green while it's dragged (2026-11-09). */
  private markFits(): void {
    const src = this.src!;
    for (const el of document.querySelectorAll<HTMLElement>('.inv-slot[data-drop]')) {
      if (el.querySelector('.inv-item')) continue;
      const zone = this.host.zoneAt(el);
      if (zone?.kind === 'slot' && this.host.canDrop(src, zone, 0, 0, this.rotated)) {
        el.classList.add('drop-fits');
        this.fits.push(el);
      }
    }
  }

  private rotate(): void {
    const src = this.src!;
    if (src.w === src.h) return;
    this.rotated = !this.rotated;
    // Hold it by its middle once turned.
    const [w, h] = this.size();
    src.grabX = Math.floor(w / 2);
    src.grabY = Math.floor(h / 2);
    this.sizeGhost();
    this.update();
  }

  private size(): [number, number] {
    const s = this.src!;
    return this.rotated ? [s.h, s.w] : [s.w, s.h];
  }

  private sizeGhost(): void {
    const [w, h] = this.size();
    const c = this.host.cell;
    this.ghost!.style.width = `${w * c}px`;
    this.ghost!.style.height = `${h * c}px`;
  }

  private update(): void {
    const src = this.src!;
    const c = this.host.cell;
    const left = this.x - (src.grabX + 0.5) * c;
    const top = this.y - (src.grabY + 0.5) * c;
    this.ghost!.style.transform = `translate(${left}px, ${top}px)`;

    const hit = document.elementFromPoint(this.x, this.y);
    // Kept while over something that doesn't scroll (the header above), to scroll on.
    this.scroller = scrollerOf(hit) ?? this.scroller;
    if (this.scroller && !this.scrollFrame && this.scrollStep() !== 0) {
      this.scrollTime = performance.now();
      this.scrollFrame = requestAnimationFrame(this.onScrollFrame);
    }
    const gunEl = hit?.closest<HTMLElement>('[data-gun]');
    const onGun = gunEl ? this.host.gunZone(src, JSON.parse(gunEl.dataset.gun!) as ItemRef) : null;
    const armorEl = onGun ? null : hit?.closest<HTMLElement>('[data-armor]');
    const onArmor = armorEl
      ? this.host.armorZone(src, JSON.parse(armorEl.dataset.armor!) as ItemRef)
      : null;
    const el = onGun ? gunEl! : onArmor ? armorEl! : hit?.closest<HTMLElement>('[data-drop]');
    const zone = onGun ?? onArmor ?? (el ? this.host.zoneAt(el) : null);
    this.clearHover();
    if (!el || !zone) return;
    let x = 0;
    let y = 0;
    // Cells from the drop element's corner; a grid's section (data-at) starts further in.
    let lx = 0;
    let ly = 0;
    if (zone.kind === 'grid') {
      const r = el.getBoundingClientRect();
      lx = Math.round((left - r.left) / c);
      ly = Math.round((top - r.top) / c);
      const [ax, ay] = (el.dataset.at ?? '0,0').split(',').map(Number);
      x = lx + ax!;
      y = ly + ay!;
    }
    const ok = this.host.canDrop(src, zone, x, y, this.rotated);
    this.hover = { zone, el, x, y, ok };
    if (zone.kind === 'grid') {
      const [w, h] = this.size();
      const hl = this.highlight;
      hl.style.left = `${lx * c}px`;
      hl.style.top = `${ly * c}px`;
      hl.style.width = `${w * c}px`;
      hl.style.height = `${h * c}px`;
      hl.classList.toggle('bad', !ok);
      el.append(hl);
    } else {
      el.classList.add(ok ? 'drop-ok' : 'drop-bad');
    }
  }

  /** How fast to scroll, -1 to 1 (up to down), by how far into the edge the pointer is. */
  private scrollStep(): number {
    const r = this.scroller!.getBoundingClientRect();
    const edge = this.host.cell;
    if (this.y < r.top + edge) return -Math.min(1, (r.top + edge - this.y) / edge);
    if (this.y > r.bottom - edge) return Math.min(1, (this.y - (r.bottom - edge)) / edge);
    return 0;
  }

  private readonly onScrollFrame = (now: number): void => {
    this.scrollFrame = 0;
    if (!this.dragging || !this.scroller) return;
    const dt = Math.min(0.05, (now - this.scrollTime) / 1000);
    this.scrollTime = now;
    const step = this.scrollStep();
    if (step === 0) return;
    this.scroller.scrollTop += step * SCROLL_SPEED * this.host.cell * dt;
    this.scrollFrame = requestAnimationFrame(this.onScrollFrame);
    // What's under the pointer moved: find the drop zone again.
    this.update();
  };

  private clearHover(): void {
    if (!this.hover) return;
    this.hover.el.classList.remove('drop-ok', 'drop-bad');
    this.highlight.remove();
    this.hover = null;
  }

  private end(): void {
    clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    // Only one item is ever pressed at a time, whichever controller has it.
    if (this.touch) holding = false;
    this.clearHover();
    for (const el of this.fits) el.classList.remove('drop-fits');
    this.fits.length = 0;
    this.ghost?.remove();
    this.ghost = null;
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    this.scroller = null;
    this.src?.el.classList.remove('dragging');
    if (this.dragging) document.body.classList.remove('inv-dragging');
    this.src = null;
    this.pointer = -1;
    this.dragging = false;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('pointerdown', this.onOtherDown, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('contextmenu', this.onContextMenu, true);
  }
}
