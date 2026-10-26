/** A second tap ending sooner than this after the last one counts as a double tap. */
const DOUBLE_TAP_MS = 350;

/** Whether the page is at its normal size, not zoomed in. */
function unzoomed(): boolean {
  return (window.visualViewport?.scale ?? 1) <= 1.01;
}

/**
 * Stops Safari zooming the game. iOS ignores the viewport's user-scalable=no, and the
 * page's touch-action doesn't catch every double tap, and cancelling pointer events (as
 * the controls do) doesn't stop it: only touch and gesture events do. Cancelling them
 * leaves the touches themselves alone, so two thumbs and fast taps on the buttons still
 * work. If the page is zoomed in anyway, nothing is blocked, so you can pinch back out.
 */
export function preventZoom(): void {
  // Pinch: Safari's own gesture events.
  for (const type of ['gesturestart', 'gesturechange']) {
    document.addEventListener(
      type,
      (e) => {
        if (unzoomed()) e.preventDefault();
      },
      { passive: false },
    );
  }
  // Double tap: cancelling the second touchend stops the zoom (and only its click).
  let lastEnd = -Infinity;
  document.addEventListener(
    'touchend',
    (e) => {
      if (e.timeStamp - lastEnd < DOUBLE_TAP_MS && unzoomed()) e.preventDefault();
      lastEnd = e.timeStamp;
    },
    { passive: false },
  );
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
}
