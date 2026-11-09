export type InputMode = 'touch' | 'desktop' | 'gamepad';

type Listener = (mode: InputMode) => void;

/** A captured or free mouse moving less than this (px) in one event is a nudge of the desk. */
const MOUSE_WAKE = 3;

/**
 * Whether the game is being played by touch, with a mouse and keyboard, or with a
 * controller. It starts from what the device says it has, then follows the last input
 * used, so a touchscreen laptop or an iPad with a trackpad works either way. A pad takes
 * the mode from any button or a stick past its dead zone (`pad-driver.ts`); a key or a
 * mouse move gives it back to desktop. Written to `body[data-input]` so CSS can hide the
 * touch controls on desktop and with a pad.
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
        // Not a synthetic one: the pad's own cursor (CP-2) sends those.
        else if (e.pointerType === 'mouse' && e.isTrusted) this.set('desktop');
      },
      true,
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.mode === 'gamepad' && e.isTrusted) this.set('desktop');
      },
      true,
    );
    window.addEventListener(
      'mousemove',
      (e) => {
        if (
          this.mode === 'gamepad' &&
          e.isTrusted &&
          Math.abs(e.movementX) + Math.abs(e.movementY) >= MOUSE_WAKE
        )
          this.set('desktop');
      },
      true,
    );
  }

  get current(): InputMode {
    return this.mode;
  }

  /** Mouse and keyboard. */
  get desktop(): boolean {
    return this.mode === 'desktop';
  }

  get touch(): boolean {
    return this.mode === 'touch';
  }

  get gamepad(): boolean {
    return this.mode === 'gamepad';
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The pad was used. */
  usePad(): void {
    this.set('gamepad');
  }

  private set(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    document.body.dataset.input = mode;
    for (const l of this.listeners) l(mode);
  }
}

export const inputMode = new Mode();
