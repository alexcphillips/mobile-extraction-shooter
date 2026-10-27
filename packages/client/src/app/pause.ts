/** Why the game is paused. Solo raids stop the clock; co-op (later) won't be able to. */
export type PauseReason = 'portrait' | 'menu' | 'hidden' | 'ended';

type Listener = (paused: boolean) => void;

class Pause {
  private readonly reasons = new Set<PauseReason>();
  private readonly listeners = new Set<Listener>();

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  set(reason: PauseReason, on: boolean): void {
    const was = this.paused;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (this.paused !== was) for (const l of this.listeners) l(this.paused);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const pause = new Pause();

/**
 * Pauses while a phone is held upright (the #portrait overlay in style.css uses the same
 * query) and while the page is hidden.
 */
export function watchPauseTriggers(): void {
  const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');
  const check = (): void => pause.set('portrait', portrait.matches);
  portrait.addEventListener('change', check);
  check();
  document.addEventListener('visibilitychange', () => pause.set('hidden', document.hidden));
}
