export type InputMode = 'touch' | 'desktop';

type Listener = (mode: InputMode) => void;

/**
 * Whether the game is being played by touch or with a mouse and keyboard. It starts from
 * what the device says it has, then follows the last pointer used, so a touchscreen
 * laptop or an iPad with a trackpad works either way. Written to `body[data-input]` so
 * CSS can hide the touch controls on desktop.
 */
class Mode {
  private mode: InputMode = matchMedia('(hover: hover) and (pointer: fine)').matches
    ? 'desktop'
    : 'touch';
  private readonly listeners = new Set<Listener>();

  constructor() {
    document.body.dataset.input = this.mode;
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') this.set('touch');
        else if (e.pointerType === 'mouse') this.set('desktop');
      },
      true,
    );
  }

  get current(): InputMode {
    return this.mode;
  }

  get desktop(): boolean {
    return this.mode === 'desktop';
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    document.body.dataset.input = mode;
    for (const l of this.listeners) l(mode);
  }
}

export const inputMode = new Mode();
