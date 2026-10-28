import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { mapSources } from '../content';
import { MapEditor } from './editor';
import { EditorPanel } from './panel';
import './editor.css';

/**
 * The map editor at /editor (session 15), in the dev server only: main.ts imports it
 * behind import.meta.env.DEV, so a build leaves it out. ?map=<id> picks the map.
 */
export function startEditor(canvas: HTMLCanvasElement, ui: HTMLElement): void {
  document.body.classList.add('editor');
  const { maps, prefabs } = mapSources();
  const ids = [...maps.keys()];
  const id = new URLSearchParams(location.search).get('map') ?? ids[0];
  const map = id === undefined ? undefined : maps.get(id);
  if (!map) throw new Error(`no map "${id}" in content/maps`);
  const editor = new MapEditor(canvas, `maps/${map.id}.json`, map, prefabs);
  ui.hidden = false;
  createRoot(ui).render(createElement(EditorPanel, { editor, maps: ids }));
  // For poking at it from the console.
  (window as { editor?: MapEditor }).editor = editor;
}
