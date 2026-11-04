import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { loadItems, lootContainerSources, lootTableSources } from '../content';
import { LootEditor } from './editor';
import { LootEditorPanel } from './panel';
import '../editor/editor.css';
import '../item-editor/item-editor.css';
import './loot-editor.css';

/**
 * The loot editor at /loot-editor (2026-11-02), in the dev server only: main.ts imports it
 * behind import.meta.env.DEV, so a build leaves it out. ?open=loot-tables/<id> or
 * loot-containers/<id> picks what's open.
 */
export function startLootEditor(ui: HTMLElement): void {
  document.body.classList.add('editor', 'item-editor');
  const open = new URLSearchParams(location.search).get('open') ?? '';
  const firstItem = [...loadItems().keys()].sort()[0] ?? 'cash';
  const editor = new LootEditor(lootTableSources(), lootContainerSources(), open, firstItem);
  ui.hidden = false;
  createRoot(ui).render(createElement(LootEditorPanel, { editor }));
  // For poking at it from the console.
  (window as { lootEditor?: LootEditor }).lootEditor = editor;
}
