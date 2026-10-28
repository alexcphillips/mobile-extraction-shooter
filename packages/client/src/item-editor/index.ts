import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { itemSources } from '../content';
import { ItemEditor } from './editor';
import { ItemEditorPanel } from './panel';
import '../editor/editor.css';
import './item-editor.css';

/**
 * The item editor at /item-editor (session 18), in the dev server only: main.ts imports it
 * behind import.meta.env.DEV, so a build leaves it out. ?item=<id> picks the item.
 */
export function startItemEditor(ui: HTMLElement): void {
  document.body.classList.add('editor', 'item-editor');
  const sources = itemSources();
  const id = new URLSearchParams(location.search).get('item') ?? [...sources.keys()][0] ?? '';
  const editor = new ItemEditor(sources, id);
  ui.hidden = false;
  createRoot(ui).render(createElement(ItemEditorPanel, { editor }));
  // For poking at it from the console.
  (window as { itemEditor?: ItemEditor }).itemEditor = editor;
}
