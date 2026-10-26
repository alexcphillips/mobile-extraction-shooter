import type { ControlPlacement } from '@mes/shared';
import { settings } from '../settings';
import type { Hud } from './hud';
import { CONTROLS, placementOf, type ControlDef } from './layout';

const SCALE_STEP = 0.1;
/** Keeps a control's centre this far (as a fraction) inside the screen edges. */
const EDGE = 0.03;

/**
 * Edits the HUD layout in place, over the paused game: drag a control to move it, tap it
 * to select it, and size it with the toolbar. Done saves the layout to settings; Cancel
 * puts it back as it was.
 */
export function editLayout(hud: Hud, onClose: () => void): void {
  const draft = new Map<ControlDef, ControlPlacement>();
  const reset = (layout: Readonly<Record<string, ControlPlacement>>): void => {
    for (const def of CONTROLS) {
      draft.set(def, { ...placementOf(def, layout) });
      hud.place(def, draft.get(def)!);
    }
  };
  reset(settings.current.layout);

  let selected: ControlDef = CONTROLS[0]!;
  let drag: { id: number; dx: number; dy: number } | null = null;

  const bar = document.createElement('div');
  bar.id = 'layout-bar';
  const label = document.createElement('span');
  const button = (text: string, onTap: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', onTap);
    return b;
  };
  const resize = (by: number): void => {
    const p = draft.get(selected)!;
    p.scale = Math.round(Math.min(2, Math.max(0.5, p.scale + by)) * 10) / 10;
    hud.place(selected, p);
    showSelection();
  };
  bar.append(
    label,
    button('−', () => resize(-SCALE_STEP)),
    button('+', () => resize(SCALE_STEP)),
    button('Reset all', () => reset({})),
    button('Cancel', () => close(false)),
    button('Done', () => close(true)),
  );
  document.body.append(bar);
  hud.container.classList.add('editing');

  function showSelection(): void {
    for (const [id, b] of hud.buttons) b.classList.toggle('selected', id === selected.id);
    label.textContent = `Drag to move · ${selected.label} ${Math.round(draft.get(selected)!.scale * 100)}%`;
  }
  showSelection();

  // Capture phase on the container, so the game's own button handlers never see these.
  const onDown = (e: PointerEvent): void => {
    const def = CONTROLS.find((d) => d.id === (e.target as HTMLElement).dataset.id);
    if (!def) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    selected = def;
    const p = draft.get(def)!;
    drag = { id: e.pointerId, dx: e.clientX - p.x * innerWidth, dy: e.clientY - p.y * innerHeight };
    showSelection();
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = draft.get(selected)!;
    const clamp = (v: number): number => Math.min(1 - EDGE, Math.max(EDGE, v));
    p.x = clamp((e.clientX - drag.dx) / innerWidth);
    p.y = clamp((e.clientY - drag.dy) / innerHeight);
    hud.place(selected, p);
  };
  const onUp = (e: PointerEvent): void => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  hud.container.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  function close(save: boolean): void {
    hud.container.removeEventListener('pointerdown', onDown, { capture: true });
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    hud.container.classList.remove('editing');
    for (const b of hud.buttons.values()) b.classList.remove('selected');
    bar.remove();
    if (save) {
      settings.update((s) => {
        s.layout = {};
        for (const [def, p] of draft) {
          // Only moved controls are saved, so a later change to a default still reaches them.
          if (p.x !== def.x || p.y !== def.y || p.scale !== 1) s.layout[def.id] = p;
        }
      });
    } else {
      hud.applyLayout(settings.current.layout);
    }
    onClose();
  }
}
