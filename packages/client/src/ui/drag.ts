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

/** Onto a piece of armour, to mend it with the repair kit dropped (session 13b). */
export interface RepairOn {
  repair: ItemRef;
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
  /** A repair kit onto armour (an element with a data-armour attribute). */
  | { kind: 'repair'; armour: ItemRef };

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
  colour: string;
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
   * go on, if it's an attachment that fits (loose, or from another gun); otherwise null, and the drag treats the
   * gun as part of its grid or gear slot.
   */
  gunZone: (src: DragSource, gun: ItemRef) => DropZone | null;
  /**
   * A repair zone if the dragged item is a repair kit (an element with a data-armour
   * attribute is armour); otherwise null, and the armour is part of its grid or slot.
   */
  armourZone: (src: DragSource, armour: ItemRef) => DropZone | null;
  /** Whether the item may drop on a zone there (x, y: the top-left cell for a grid). */
  canDrop: (src: DragSource, zone: DropZone, x: number, y: number, rotated: boolean) => boolean;
  drop: (src: DragSource, to: Target | PartSlot | Into | RepairOn) => void;
  tap: (src: DragSource) => void;
}

function swallowClick(e: Event): void {
  e.stopPropagation();
}

/** How far a pointer moves before a press becomes a drag, in CSS pixels. */
const SLOP = 8;

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
 * press that moves becomes a drag with a ghost under the finger; one that doesn't is a
 * tap. While dragging, a second finger (or R) turns the item, and holding it within a cell
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
  private rotated = false;
  private ghost: HTMLElement | null = null;
  private hover: { zone: DropZone; el: HTMLElement; x: number; y: number; ok: boolean } | null =
    null;
  private readonly highlight = document.createElement('div');
  /** The area the drag was last over that scrolls, and the frame that scrolls it. */
  private scroller: HTMLElement | null = null;
  private scrollFrame = 0;
  private scrollTime = 0;

  constructor(private readonly host: DragHost) {
    this.highlight.className = 'inv-drop';
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
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('pointerdown', this.onOtherDown, true);
    window.addEventListener('keydown', this.onKey);
  }

  /** Stops any drag, without dropping. */
  cancel(): void {
    this.end();
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer || !this.src) return;
    this.x = e.clientX;
    this.y = e.clientY;
    if (!this.dragging) {
      if (Math.hypot(this.x - this.startX, this.y - this.startY) < SLOP) return;
      this.start();
    }
    this.update();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer || !this.src) return;
    const src = this.src;
    const hover = this.hover;
    const dragging = this.dragging;
    const rotated = this.rotated;
    this.end();
    // The click a drag ends with (a mouse's, in the same task) isn't a tap on whatever it
    // was dropped on. A touch drag ends with none, so don't wait for one.
    if (dragging) {
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
                  ? { repair: z.armour }
                  : { gun: z.gun, slot: z.slot },
      );
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.pointer) this.end();
  };

  private readonly onOtherDown = (e: PointerEvent): void => {
    if (e.pointerId === this.pointer || !this.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    this.rotate();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR' && this.dragging && !e.repeat) this.rotate();
    else if (e.code === 'Escape') this.end();
  };

  private start(): void {
    const src = this.src!;
    this.dragging = true;
    src.el.classList.add('dragging');
    const g = document.createElement('div');
    g.className = 'inv-ghost';
    g.style.background = src.colour;
    g.textContent = src.label;
    document.body.append(g);
    this.ghost = g;
    this.sizeGhost();
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
    const armourEl = onGun ? null : hit?.closest<HTMLElement>('[data-armour]');
    const onArmour = armourEl
      ? this.host.armourZone(src, JSON.parse(armourEl.dataset.armour!) as ItemRef)
      : null;
    const el = onGun ? gunEl! : onArmour ? armourEl! : hit?.closest<HTMLElement>('[data-drop]');
    const zone = onGun ?? onArmour ?? (el ? this.host.zoneAt(el) : null);
    this.clearHover();
    if (!el || !zone) return;
    let x = 0;
    let y = 0;
    if (zone.kind === 'grid') {
      const r = el.getBoundingClientRect();
      x = Math.round((left - r.left) / c);
      y = Math.round((top - r.top) / c);
    }
    const ok = this.host.canDrop(src, zone, x, y, this.rotated);
    this.hover = { zone, el, x, y, ok };
    if (zone.kind === 'grid') {
      const [w, h] = this.size();
      const hl = this.highlight;
      hl.style.left = `${x * c}px`;
      hl.style.top = `${y * c}px`;
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
    this.clearHover();
    this.ghost?.remove();
    this.ghost = null;
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    this.scroller = null;
    this.src?.el.classList.remove('dragging');
    this.src = null;
    this.pointer = -1;
    this.dragging = false;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('pointerdown', this.onOtherDown, true);
    window.removeEventListener('keydown', this.onKey);
  }
}
