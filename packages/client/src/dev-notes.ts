import * as THREE from 'three';
import { NOTES_EVENT, addNote, disposeLabels, fetchNotes, noteLabels } from './notes';
import type { DevHooks } from './play';

/**
 * In any raid on the dev server (from the main menu or the map editor's Play): the map's
 * notes as labels through walls, and N to drop one where you stand (2026-10-30):
 * a box asks for the text (a dev screen, so you stand still and have the cursor), and it's
 * written to content/notes at once by the dev server, with your git name.
 */
export function showNotes(map: string, { scene, player, screen }: DevHooks): void {
  let labels: THREE.Group | null = null;
  const show = (notes: Awaited<ReturnType<typeof fetchNotes>>): void => {
    if (labels) {
      scene.remove(labels);
      disposeLabels(labels);
    }
    labels = noteLabels(notes);
    scene.add(labels);
  };
  const refresh = (): void => void fetchNotes(map).then(show, () => {});
  refresh();
  import.meta.hot?.on(NOTES_EVENT, (data: { map: string }) => {
    if (data.map === map) refresh();
  });

  const toast = document.createElement('div');
  toast.style.cssText =
    'position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:60;padding:6px 12px;' +
    'border-radius:6px;background:rgba(24,28,34,.9);color:#fff;font:600 14px system-ui;' +
    'pointer-events:none;display:none';
  document.body.append(toast);
  let toastTimer = 0;
  const say = (text: string): void => {
    toast.textContent = text;
    toast.style.display = '';
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.style.display = 'none'), 2500);
  };

  const box = document.createElement('form');
  box.style.cssText =
    'position:fixed;top:30%;left:50%;transform:translateX(-50%);z-index:60;width:min(420px,90vw);' +
    'padding:12px;border:2px solid #ffd400;border-radius:8px;background:rgba(24,28,34,.95);' +
    'color:#fff;font:14px system-ui;display:none';
  box.innerHTML =
    '<div style="margin-bottom:6px;font-weight:600">Note for this spot</div>' +
    '<input maxlength="200" style="width:100%;box-sizing:border-box;padding:6px;font:inherit">' +
    '<div style="margin-top:8px;display:flex;gap:8px;align-items:center">' +
    '<button type="submit">Save</button><button type="button">Cancel</button>' +
    '<span style="opacity:.7">Saved to content/notes for everyone. Enter saves, Esc cancels.</span></div>';
  document.body.append(box);
  const input = box.querySelector('input')!;
  const cancel = box.querySelectorAll('button')[1]!;
  // Keys and clicks in the box stay out of the game's controls (on window).
  for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown'])
    box.addEventListener(type, (e) => e.stopPropagation());
  let at: number[] = [];
  const close = (): void => {
    box.style.display = 'none';
    input.blur();
    screen(false);
  };
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    close();
    if (!text) return;
    addNote(map, at, text).then(
      (notes) => {
        show(notes);
        say('Note saved');
      },
      (err: unknown) => say(`Note not saved: ${err instanceof Error ? err.message : err}`),
    );
  });
  cancel.addEventListener('click', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN' || e.repeat || e.metaKey || e.ctrlKey || box.style.display !== 'none')
      return;
    e.preventDefault();
    at = [player.x, player.y, player.z];
    screen(true);
    input.value = '';
    box.style.display = '';
    input.focus();
  });
}
