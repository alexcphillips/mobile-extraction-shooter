import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { LayoutBoard, type Raw } from './board';
import { LayoutPanel } from './panel';
import { SKETCH_CSS } from './sketch';
import '../editor/editor.css';
import './layout-board.css';

// The layout files, as written. Only this dev-only page bundles them: the game doesn't
// read layouts, a map's generator does.
const layoutFiles = import.meta.glob<Raw>('../../../../content/layouts/*.json', {
  eager: true,
  import: 'default',
});

/** Each layout file as written, by id (its file name). */
export function layoutDocs(): Map<string, Raw> {
  return new Map(
    Object.entries(layoutFiles).map(([path, doc]) => [
      path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
      doc,
    ]),
  );
}

/**
 * The layout board at /layout?map=<id> (MK-3, 2026-11-12), in the dev server only: main.ts
 * imports it behind import.meta.env.DEV. Without ?map it lists the layouts there are.
 */
export function startLayoutBoard(ui: HTMLElement): void {
  document.body.classList.add('editor', 'layout-board');
  const style = document.createElement('style');
  style.textContent = SKETCH_CSS;
  document.head.append(style);
  ui.hidden = false;
  const docs = layoutDocs();
  const map = new URLSearchParams(location.search).get('map') ?? '';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(map)) {
    ui.innerHTML =
      '<div class="lb-pick"><h2>Layouts</h2><ul>' +
      [...docs.keys()].map((id) => `<li><a href="/layout?map=${id}">${id}</a></li>`).join('') +
      '</ul><p>A new one: /layout?map=&lt;map id&gt;</p></div>';
    return;
  }
  ui.innerHTML = '<div class="lb"><div class="lb-view"></div><div class="lb-side"></div></div>';
  const view = ui.querySelector<HTMLElement>('.lb-view')!;
  const side = ui.querySelector<HTMLElement>('.lb-side')!;
  const board = new LayoutBoard(map, docs.get(map), view);
  createRoot(side).render(createElement(LayoutPanel, { board }));
  // For poking at it from the console.
  (window as { layoutBoard?: LayoutBoard }).layoutBoard = board;
}
