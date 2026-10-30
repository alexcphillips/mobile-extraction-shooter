import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { soundSources } from '../content';
import { SoundEditor } from './editor';
import { Audition, SoundEditorPanel } from './panel';
import '../editor/editor.css';
import '../item-editor/item-editor.css';
import './sound-editor.css';

/**
 * The sound editor at /sounds (session 19), in the dev server only: main.ts imports it
 * behind import.meta.env.DEV, so a build leaves it out. ?sound=<id> picks the sound.
 */
export function startSoundEditor(ui: HTMLElement): void {
  document.body.classList.add('editor', 'item-editor');
  const sources = soundSources();
  const id = new URLSearchParams(location.search).get('sound') ?? [...sources.keys()][0] ?? '';
  const audition = new Audition();
  const editor: SoundEditor = new SoundEditor(sources, id, () => {
    const s = editor.getState();
    const def = s.sounds.get(s.current);
    if (def && !s.problems.has(s.current)) audition.play(def);
  });
  ui.hidden = false;
  createRoot(ui).render(createElement(SoundEditorPanel, { editor, audition }));
  // For poking at it from the console.
  (window as { soundEditor?: SoundEditor }).soundEditor = editor;
}
