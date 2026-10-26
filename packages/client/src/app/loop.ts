import type * as THREE from 'three';
import type { Controls } from '../input/controls';
import { pause } from './pause';

/**
 * Runs the frame loop until paused. While paused nothing ticks or draws, every touch is
 * let go, and the first frame after resuming counts as a normal frame, not the time away.
 */
export function startLoop(
  renderer: THREE.WebGLRenderer,
  controls: Controls,
  frame: (time: number, dtMs: number) => void,
): void {
  let last = -1;
  const run = (): void => {
    last = -1;
    renderer.setAnimationLoop((time) => {
      const dtMs = last < 0 ? 16.7 : time - last;
      last = time;
      frame(time, dtMs);
    });
  };
  pause.subscribe((paused) => {
    if (paused) {
      renderer.setAnimationLoop(null);
      controls.reset();
    } else run();
  });
  if (!pause.paused) run();
}
