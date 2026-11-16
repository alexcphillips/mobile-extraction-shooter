import {
  CHEST,
  HEAD,
  HEALTH,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_ARM,
  RIGHT_LEG,
  STOMACH,
  medDef,
  treatments,
  treatmentsFor,
  type Character,
  type ItemDb,
  type MedRef,
  type Zone,
} from '@mes/shared';
import { ZONE_COLORS, zoneColor } from './vitals';

/** Short names for the body's tiles. */
const LABELS: Record<Zone, string> = {
  [HEAD]: 'head',
  [CHEST]: 'thorax',
  [STOMACH]: 'stomach',
  [LEFT_ARM]: 'L arm',
  [RIGHT_ARM]: 'R arm',
  [LEFT_LEG]: 'L leg',
  [RIGHT_LEG]: 'R leg',
};

/**
 * Where each zone sits on the 3-column body grid: facing you, as the vitals body does, so
 * your left arm is on the screen's right.
 */
const AREA: Record<Zone, string> = {
  [HEAD]: 'head',
  [CHEST]: 'chest',
  [STOMACH]: 'stom',
  [LEFT_ARM]: 'rarm',
  [RIGHT_ARM]: 'larm',
  [LEFT_LEG]: 'rleg',
  [RIGHT_LEG]: 'lleg',
};

/** The order a pad steps through: down the body, the screen's left before its right. */
const PAD_ORDER: readonly Zone[] = [HEAD, RIGHT_ARM, CHEST, LEFT_ARM, STOMACH, RIGHT_LEG, LEFT_LEG];

/** Resting on a zone this long (finger or mouse) shows its other meds. */
const DWELL_MS = 280;

/**
 * The heal button's body picker (2026-11-15, the user's call, replacing the list of meds):
 * holding heal opens a front-on body. Each zone shows what's wrong with it and the med it
 * would get; letting go (or clicking) on a zone uses that med on that zone only. Resting
 * on a zone shows its other meds in a strip below (surgery instead of a splint, the crate
 * instead of a bandage), and letting go on one uses it. "Auto" does what a tap does. A
 * finger can slide straight from the heal button onto a zone. A pad steps through the
 * zones (up/down), the meds for one (left/right), and picks on letting go of L1.
 */
export class BodyPicker {
  readonly el: HTMLElement;
  private readonly tiles = new Map<Zone, HTMLButtonElement>();
  private readonly strip: HTMLElement;
  private readonly auto: HTMLButtonElement;
  /** Per zone, the meds that help it now, best first. */
  private options = new Map<Zone, MedRef[]>();
  private autoRef: MedRef | null = null;
  /** The zone whose meds the strip shows, and which of them a pad has highlighted. */
  private expanded: Zone | null = null;
  private alt = 0;
  /** The pad's highlight: an index into the zones that need something, then Auto. */
  private highlight = 0;
  private hovered: Zone | null = null;
  private dwell: ReturnType<typeof setTimeout> | null = null;
  private items: ItemDb | null = null;

  constructor(
    container: HTMLElement,
    private readonly onPick: (ref: MedRef) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'body-picker';
    this.el.hidden = true;
    const body = document.createElement('div');
    body.className = 'body-grid';
    for (const z of PAD_ORDER) {
      const b = document.createElement('button');
      b.dataset.zone = String(z);
      b.style.gridArea = AREA[z];
      b.innerHTML = '<b></b><span class="hp"></span><span class="med"></span>';
      body.append(b);
      this.tiles.set(z, b);
    }
    this.strip = document.createElement('div');
    this.strip.className = 'body-meds';
    this.auto = document.createElement('button');
    this.auto.className = 'body-auto';
    this.auto.dataset.auto = '1';
    // Auto sits between the legs, where the body has room.
    body.append(this.auto);
    this.el.append(body, this.strip);
    container.append(this.el);

    // Nothing under the panel sees its touches.
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Opens it over a point (the heal button's top middle, or the screen's middle). */
  show(c: Character, items: ItemDb, x: number, bottom: number): void {
    this.expanded = null;
    this.highlight = 0;
    this.refresh(c, items);
    if (!this.autoRef) return;
    this.el.style.left = `${x}px`;
    this.el.style.bottom = `${bottom}px`;
    this.el.hidden = false;
    // The first zone that needs something starts open, its meds in the strip.
    this.step(0);
    // Kept on screen, measured with the strip filled.
    const r = this.el.getBoundingClientRect();
    if (r.top < 8) this.el.style.bottom = `${Math.max(8, bottom + r.top - 8)}px`;
    const over =
      r.left < 8
        ? 8 - r.left
        : r.right > window.innerWidth - 8
          ? window.innerWidth - 8 - r.right
          : 0;
    if (over) this.el.style.left = `${x + over}px`;
  }

  hide(): void {
    this.el.hidden = true;
    this.hovered = null;
    if (this.dwell) clearTimeout(this.dwell);
    this.dwell = null;
  }

  /** While open, about 5 times a second: health and meds change mid-fight. */
  refresh(c: Character, items: ItemDb): void {
    const h = c.health;
    this.items = items;
    this.autoRef = treatments(c, items)[0] ?? null;
    if (!this.autoRef) {
      this.hide();
      return;
    }
    for (const [z, b] of this.tiles) {
      const opts = treatmentsFor(c, items, z);
      this.options.set(z, opts);
      const hp = h.hp[z]!;
      const max = HEALTH.maxHp[z]!;
      const status = h.bleeding[z] ? '🩸 ' : h.splinted[z] ? '🦴 ' : hp <= 0 ? '💔 ' : '';
      const med = opts[0] ? medDef(items, opts[0].item).name : '';
      const key = `${hp | 0} ${status} ${med} ${opts.length}`;
      if (b.dataset.key === key) continue;
      b.dataset.key = key;
      b.children[0]!.textContent = `${status}${LABELS[z]}`;
      b.children[1]!.textContent = `${Math.ceil(hp)}/${max}`;
      b.children[2]!.textContent = med
        ? opts.length > 1
          ? `${med} +${opts.length - 1}`
          : med
        : '';
      b.style.borderColor = ZONE_COLORS[zoneColor(hp, max)]!;
      b.classList.toggle('idle', !opts.length);
    }
    this.auto.innerHTML = `<b>Auto</b><span>${medDef(items, this.autoRef.item).name}</span>`;
    if (this.expanded !== null) this.expand(this.expanded, items);
  }

  /** Shows a zone's meds in the strip. */
  private expand(z: Zone, items: ItemDb): void {
    this.expanded = z;
    const opts = this.options.get(z) ?? [];
    this.alt = Math.min(this.alt, Math.max(0, opts.length - 1));
    this.strip.replaceChildren(
      ...opts.map((ref, i) => {
        const b = document.createElement('button');
        b.dataset.alt = String(i);
        const def = medDef(items, ref.item);
        b.innerHTML = `<b>${def.name}</b><span>${def.useTime} s</span>`;
        return b;
      }),
    );
    for (const [tz, t] of this.tiles) t.classList.toggle('expanded', tz === z);
    this.showHighlight();
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.open) return;
    const z = this.zoneAt(e.clientX, e.clientY);
    if (z === this.hovered) return;
    this.hovered = z;
    if (this.dwell) clearTimeout(this.dwell);
    this.dwell = null;
    if (z === null || z === this.expanded || !this.options.get(z)?.length) return;
    this.dwell = setTimeout(() => {
      this.alt = 0;
      if (this.items && this.open) this.expand(z, this.items);
    }, DWELL_MS);
  };

  /** Letting go over a zone, a med in the strip or Auto picks it; anywhere else leaves it open. */
  private readonly onUp = (e: PointerEvent): void => {
    if (!this.open) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('button');
    if (!el || !this.el.contains(el)) return;
    let ref: MedRef | null | undefined = null;
    if (el.dataset.auto) ref = this.autoRef;
    else if (el.dataset.alt !== undefined && this.expanded !== null)
      ref = this.options.get(this.expanded)?.[Number(el.dataset.alt)];
    else if (el.dataset.zone !== undefined)
      ref = this.options.get(Number(el.dataset.zone) as Zone)?.[0];
    if (!ref) return;
    e.stopPropagation();
    this.hide();
    this.onPick(ref);
  };

  private zoneAt(x: number, y: number): Zone | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-zone]');
    return el && this.el.contains(el) ? (Number(el.dataset.zone) as Zone) : null;
  }

  /** The zones a pad can land on: those with a med for them, then Auto (null). */
  private padStops(): (Zone | null)[] {
    return [...PAD_ORDER.filter((z) => this.options.get(z)?.length), null];
  }

  /** A pad: up/down moves between zones and Auto. */
  step(by: number): void {
    const stops = this.padStops();
    this.highlight = Math.max(0, Math.min(stops.length - 1, this.highlight + by));
    this.alt = 0;
    const z = stops[this.highlight]!;
    if (z !== null && z !== undefined && this.items) this.expand(z, this.items);
    else {
      this.expanded = null;
      this.strip.replaceChildren();
      for (const t of this.tiles.values()) t.classList.remove('expanded');
      this.showHighlight();
    }
  }

  /** A pad: left/right moves between the highlighted zone's meds. */
  stepAlt(by: number): void {
    const z = this.padStops()[this.highlight];
    if (z === undefined || z === null) return;
    const n = this.options.get(z)?.length ?? 0;
    this.alt = Math.max(0, Math.min(n - 1, this.alt + by));
    this.showHighlight();
  }

  /** A pad picks what's highlighted. */
  choose(): void {
    const z = this.padStops()[this.highlight];
    const ref =
      z === undefined ? null : z === null ? this.autoRef : this.options.get(z)?.[this.alt];
    this.hide();
    if (ref) this.onPick(ref);
  }

  private showHighlight(): void {
    const z = this.padStops()[this.highlight];
    for (const [tz, t] of this.tiles) t.classList.toggle('highlight', tz === z);
    this.auto.classList.toggle('highlight', z === null);
    const alts = this.strip.children;
    for (let i = 0; i < alts.length; i++) alts[i]!.classList.toggle('highlight', i === this.alt);
  }
}
