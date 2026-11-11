import { equippedLayout, type ControlLayout, type ControlPlacement } from '@mes/shared';
import { settings } from '../settings';
import type { Hud } from './hud';
import { CONTROLS, isHidden, placementOf, type ControlDef } from './layout';

const SCALE_STEP = 0.1;
/** Keeps a control's center this far (as a fraction) inside the screen edges. */
const EDGE = 0.03;

/**
 * Edits the equipped HUD layout in place, over the paused game: drag a control to move it,
 * tap it to select it, size or hide it with the toolbar (hidden ones show faded, so they
 * can be shown again). Done saves the layout to its slot in settings; Cancel puts it back
 * as it was.
 */
export function editLayout(hud: Hud, onClose: () => void): void {
  const slot = settings.current.equippedLayout;
  const draft = new Map<ControlDef, ControlPlacement>();
  const hidden = new Set<ControlDef>();
  const reset = (layout: ControlLayout): void => {
    hidden.clear();
    for (const def of CONTROLS) {
      draft.set(def, { ...placementOf(def, layout.placements) });
      hud.place(def, draft.get(def)!);
      if (isHidden(def, layout)) hidden.add(def);
      hud.hide(def, hidden.has(def));
    }
  };
  reset(equippedLayout(settings.current));

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
  const hide = button('Hide', () => {
    if (selected.required) return;
    if (hidden.has(selected)) hidden.delete(selected);
    else hidden.add(selected);
    hud.hide(selected, hidden.has(selected));
    showSelection();
  });
  bar.append(
    label,
    button('−', () => resize(-SCALE_STEP)),
    button('+', () => resize(SCALE_STEP)),
    hide,
    button('Reset all', () => {
      reset({ placements: {}, hidden: [] });
      showSelection();
    }),
    button('Cancel', () => close(false)),
    button('Done', () => close(true)),
  );
  document.body.append(bar);
  hud.container.classList.add('editing');

  function showSelection(): void {
    for (const [id, b] of hud.buttons) b.classList.toggle('selected', id === selected.id);
    const off = hidden.has(selected);
    label.textContent = `Layout ${slot + 1} · ${selected.label} ${Math.round(draft.get(selected)!.scale * 100)}%${off ? ' · hidden' : ''}`;
    hide.textContent = off ? 'Show' : 'Hide';
    // Fire, use and bag can't go: on touch nothing else does what they do.
    hide.disabled = !!selected.required;
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
        const layout: ControlLayout = { placements: {}, hidden: [] };
        for (const [def, p] of draft) {
          // Only moved controls are saved, so a later change to a default still reaches them.
          if (p.x !== def.x || p.y !== def.y || p.scale !== 1) layout.placements[def.id] = p;
          if (hidden.has(def)) layout.hidden.push(def.id);
        }
        s.layouts[slot] = layout;
      });
    } else {
      hud.applyLayout(equippedLayout(settings.current));
    }
    onClose();
  }
}
