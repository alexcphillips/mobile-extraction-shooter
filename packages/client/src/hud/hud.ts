import { equippedLayout, type ControlLayout, type ControlPlacement } from '@mes/shared';
import { settings } from '../settings';
import { CONTROLS, isHidden, placementOf, type ControlDef, type ControlId } from './layout';

/**
 * The on-screen controls: the floating move stick, the sprint-lock badge and the buttons,
 * placed from the saved layout. It only builds and places elements; `Controls` reads them.
 */
export class Hud {
  readonly buttons = new Map<ControlId, HTMLButtonElement>();

  constructor(
    readonly container: HTMLElement,
    readonly stick: HTMLElement,
    readonly knob: HTMLElement,
    readonly sprintZone: HTMLElement,
    readonly sprintLock: HTMLElement,
    /** The settings gear, which Esc presses on desktop. */
    readonly settingsButton: HTMLElement,
  ) {
    for (const def of CONTROLS) {
      const b = document.createElement('button');
      b.className = 'control';
      b.dataset.id = def.id;
      b.textContent = def.label;
      container.append(b);
      this.buttons.set(def.id, b);
    }
    this.applyLayout(equippedLayout(settings.current));
    settings.subscribe((s) => this.applyLayout(equippedLayout(s)));
  }

  button(id: ControlId): HTMLButtonElement {
    const b = this.buttons.get(id);
    if (!b) throw new Error(`no control ${id}`);
    return b;
  }

  applyLayout(layout: ControlLayout): void {
    for (const def of CONTROLS) {
      this.place(def, placementOf(def, layout.placements));
      this.hide(def, isHidden(def, layout));
    }
  }

  /** Hides a control the player doesn't want (UX-4); the layout editor still shows it, faded. */
  hide(def: ControlDef, hidden: boolean): void {
    this.button(def.id).classList.toggle('off', hidden);
  }

  place(def: ControlDef, p: ControlPlacement): void {
    const b = this.button(def.id);
    const size = Math.round(def.size * p.scale);
    b.style.left = `${p.x * 100}%`;
    b.style.top = `${p.y * 100}%`;
    b.style.width = `${size}px`;
    b.style.height = `${size}px`;
  }
}
