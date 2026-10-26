let ctx: AudioContext | null = null;

/** The game's audio context, or null before the first tap has unlocked it. */
export function audio(): AudioContext | null {
  return ctx?.state === 'running' ? ctx : null;
}

/**
 * Safari only starts audio from inside a user gesture. The first tap creates the context
 * and plays a silent sample; later taps resume it after iOS suspends it (a call, the app
 * going to the background).
 */
export function unlockAudioOnTap(): void {
  const unlock = (): void => {
    if (!ctx) {
      ctx = new AudioContext();
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, 22050);
      source.connect(ctx.destination);
      source.start();
    }
    if (ctx.state !== 'running') void ctx.resume();
  };
  // touchend and pointerup both count as gestures in Safari; touchstart doesn't.
  for (const type of ['touchend', 'pointerup', 'keydown']) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }
}
