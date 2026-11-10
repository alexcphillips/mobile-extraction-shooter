/*
 * A page open from before a deploy asks for code chunks the new build doesn't have, and
 * the Worker's single-page fallback answers with index.html ("text/html is not a valid
 * JavaScript MIME type", seen on Settings, 2026-11-10). Vite raises vite:preloadError when a
 * lazy chunk fails to load: reload once to pick up the new build. A raid in progress is
 * saved on pagehide and resumes. If it fails again soon after reloading, it's something
 * else, so the error shows as before rather than reloading forever.
 */

const KEY = 'mes:stale-build-reload';
const AGAIN_MS = 30_000;

export function reloadOnStaleBuild(): void {
  window.addEventListener('vite:preloadError', (e) => {
    try {
      // Reloaded for this a moment ago: it's something else.
      if (Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < AGAIN_MS) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // Without storage there's no guard against a loop, so let the error show instead.
      return;
    }
    e.preventDefault();
    location.reload();
  });
}
