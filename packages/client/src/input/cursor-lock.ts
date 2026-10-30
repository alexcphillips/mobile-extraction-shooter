import { pause } from '../app/pause';
import { inputMode } from './mode';

/** How long a lock request may go unanswered before the "click to play" overlay shows. */
const REQUEST_MS = 1000;

/**
 * Desktop mouse capture. In a raid the mouse is locked to the canvas, so moving it looks
 * and its buttons fire and aim. While it isn't (before the first click, after Esc, or if
 * the browser refused), the overlay says to click and the game pauses. Screens that need
 * the cursor (inventory, heal picker, results) say so with `want(false)`, and get it back
 * locked when they close. Does nothing on touch.
 */
export class CursorLock {
  private wanted = true;
  /** A lock asked for and not yet answered: don't flash the overlay meanwhile. */
  private requesting = false;
  private requestTimer = 0;

  constructor(
    private readonly target: HTMLElement,
    private readonly overlay: HTMLElement,
    private readonly onChange: (locked: boolean) => void,
  ) {
    document.addEventListener('pointerlockchange', this.answered);
    document.addEventListener('pointerlockerror', this.answered);
    overlay.addEventListener('click', () => this.request());
    inputMode.subscribe(() => {
      if (!inputMode.desktop && this.locked) document.exitPointerLock();
      this.sync();
    });
    this.sync();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** Whether the game wants the mouse captured now. Call it from input handlers when possible: browsers only lock on a user gesture. */
  want(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) this.request();
    else if (this.locked) document.exitPointerLock();
    this.sync();
  }

  private request(): void {
    if (!inputMode.desktop || !this.wanted || this.locked) return;
    this.requesting = true;
    clearTimeout(this.requestTimer);
    this.requestTimer = window.setTimeout(this.answered, REQUEST_MS);
    try {
      // A promise in Chrome (rejected without a gesture), nothing in Safari.
      const p = this.target.requestPointerLock() as unknown;
      if (p instanceof Promise) p.catch(() => {});
    } catch {
      this.requesting = false;
    }
  }

  private readonly answered = (): void => {
    this.requesting = false;
    clearTimeout(this.requestTimer);
    this.sync();
  };

  private sync(): void {
    const locked = this.locked;
    const free = inputMode.desktop && this.wanted && !locked && !this.requesting;
    this.overlay.hidden = !free;
    pause.set('cursor', free);
    document.body.classList.toggle('cursor-locked', locked);
    this.onChange(locked);
  }
}
