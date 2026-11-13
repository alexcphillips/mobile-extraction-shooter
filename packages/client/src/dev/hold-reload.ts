/**
 * Dev only (2026-11-12): on the editor pages, a file saved by someone else (a Claude
 * session editing code or content) no longer reloads the page mid-edit. Vite awaits its
 * `vite:beforeFullReload` listeners before reloading, so this holds that reload until the
 * Reload button is pressed, and shows the button instead. Vite handles its messages in
 * order, so later updates wait behind the held one and the page keeps running the code
 * and content it loaded with. The editors' own saves never get here: editor-save.mjs
 * already skips their reload.
 */
export function holdReloads(hot: NonNullable<ImportMeta['hot']>): void {
  const bar = document.createElement('div');
  bar.className = 'dev-reload';
  bar.hidden = true;
  bar.append('Files changed on disk. Reload when ready. ');
  const button = document.createElement('button');
  button.textContent = 'Reload';
  bar.append(button);
  document.body.append(bar);

  hot.on('vite:beforeFullReload', () => {
    bar.hidden = false;
    return new Promise<void>((resolve) => (button.onclick = () => resolve()));
  });
}
