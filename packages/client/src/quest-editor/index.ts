import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { loadItems, loadVendors, mapIds, questDocs, questMarkerIds } from '../content';
import { QuestEditor } from './editor';
import { QuestEditorPanel } from './panel';
import '../editor/editor.css';
import '../item-editor/item-editor.css';
import '../loot-editor/loot-editor.css';
import './quest-editor.css';

/**
 * The quest editor at /quest-editor (2026-11-11), in the dev server only: main.ts imports
 * it behind import.meta.env.DEV, so a build leaves it out. ?open=<quest id> opens one.
 */
export function startQuestEditor(ui: HTMLElement): void {
  document.body.classList.add('editor', 'item-editor', 'quest-editor');
  const open = new URLSearchParams(location.search).get('open') ?? '';
  // Every map's quest markers, compiled once: the pickers list them and saving checks them.
  const markers = new Map(mapIds().map((m) => [m, questMarkerIds(m) ?? []]));
  const editor = new QuestEditor(
    questDocs(),
    { vendors: loadVendors(), items: loadItems(), markers },
    open,
  );
  ui.hidden = false;
  createRoot(ui).render(createElement(QuestEditorPanel, { editor }));
  // For poking at it from the console.
  (window as { questEditor?: QuestEditor }).questEditor = editor;
}
