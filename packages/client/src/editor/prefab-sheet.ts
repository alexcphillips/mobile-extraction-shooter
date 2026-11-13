import { mapSources } from '../content';
import { Thumbnails } from './thumbnails';

/*
 * The prefab sheet (MK-5, 2026-11-12, dev only): the prefab browser's thumbnails on one
 * page, labeled by id, for `scripts/prefabs.mjs --sheet` to screenshot or the user to scroll.
 * `?ids=a,b,c` shows those in that order, `?q=word` those whose id, name or tags hold it,
 * otherwise every prefab. Sets `data-sheet-done` on the sheet when every picture is drawn.
 */
export function startPrefabSheet(ui: HTMLElement): void {
  document.body.classList.add('editor');
  ui.hidden = false;
  const { prefabs } = mapSources();
  const params = new URLSearchParams(location.search);
  const q = params.get('q')?.toLowerCase();
  const ids = params.get('ids')
    ? params
        .get('ids')!
        .split(',')
        .filter((id) => prefabs.has(id))
    : [...prefabs.values()]
        .filter(
          (p) =>
            !q || p.id.includes(q) || !!p.name?.toLowerCase().includes(q) || !!p.tags?.includes(q),
        )
        .map((p) => p.id)
        .sort();
  const style = document.createElement('style');
  style.textContent = `
    .sheet { display: grid; grid-template-columns: repeat(auto-fill, 168px); gap: 6px;
      padding: 8px; background: #3a3f45; width: max-content; max-width: 100vw; }
    .sheet figure { margin: 0; background: #5a6068; border-radius: 4px; padding: 4px; }
    .sheet img { width: 160px; height: 160px; display: block; }
    .sheet figcaption { font: 12px/1.3 system-ui, sans-serif; color: #f0f0f0;
      overflow-wrap: anywhere; padding-top: 2px; }
    body.editor { overflow: auto; }`;
  document.head.append(style);
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  ui.replaceChildren(sheet);
  const thumbs = new Thumbnails();
  let i = 0;
  // A few at a time, so a long sheet shows as it's drawn.
  const step = (): void => {
    for (const end = Math.min(ids.length, i + 12); i < end; i++) {
      const id = ids[i]!;
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = thumbs.get(id, prefabs) ?? '';
      img.alt = id;
      const cap = document.createElement('figcaption');
      cap.textContent = id;
      fig.append(img, cap);
      sheet.append(fig);
    }
    if (i < ids.length) setTimeout(step, 0);
    else sheet.dataset.sheetDone = '';
  };
  step();
}
