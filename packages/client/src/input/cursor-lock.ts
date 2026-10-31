import { pause } from '../app/pause';
import { inputMode } from './mode';

/**
 * Desktop mouse capture. In a raid the mouse is locked to the canvas, so moving it looks
 * and its buttons fire and aim. Screens that need the cursor (inventory, heal picker,
 * results) say so with `want(false)`, and get it back locked when they close. Browsers
 * only lock on a user gesture (never from Esc), so when a request goes unanswered the game
 * carries on and the next click on the canvas locks (see `resuming`); nothing is shown.
 * Esc while playing, whether it freed the cursor or the cursor was already free, presses
 * the settings button. Does nothing on touch.
 */
export class CursorLock {
  private wanted = true;
  private wasLocked = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly settingsButton: HTMLElement,
    private readonly onChange: (locked: boolean) => void,
  ) {
    document.addEventListener('pointerlockchange', this.changed);
    target.addEventListener('mousedown', () => this.request());
    // Back from settings: the Resume click is a gesture.
    pause.subscribe((paused) => {
      if (!paused) this.request();
    });
    window.addEventListener('keydown', this.onKey, true);
    inputMode.subscribe(() => {
      if (!inputMode.desktop && this.locked) document.exitPointerLock();
    });
    // From the click that started the raid, if the browser still counts it.
    this.request();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** Wanted but not locked yet: a click on the canvas locks and also counts as input. */
  get resuming(): boolean {
    return inputMode.desktop && this.wanted && !this.locked;
  }

  /** Whether the game wants the mouse captured now. Call it from input handlers when possible: browsers only lock on a user gesture. */
  want(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) this.request();
    else if (this.locked) document.exitPointerLock();
  }

  private request(): void {
    if (!inputMode.desktop || !this.wanted || this.locked || pause.paused) return;
    try {
      // A promise in Chrome (rejected without a gesture), nothing in Safari.
      const p = this.target.requestPointerLock() as unknown;
      if (p instanceof Promise) p.catch(() => {});
    } catch {
      // Refused: the next click asks again.
    }
  }

  /** Esc during play, as the player sees it. */
  private playing(): boolean {
    return inputMode.desktop && this.wanted && !pause.paused;
  }

  private readonly changed = (): void => {
    const locked = this.locked;
    // Granted after the game let go (giving up right after settings' click asked for it).
    if (locked && !this.wanted) {
      document.exitPointerLock();
      return;
    }
    // Lost without the game letting go: the browser's Esc (or switching away).
    if (this.wasLocked && !locked && this.playing()) this.settingsButton.click();
    this.wasLocked = locked;
    document.body.classList.toggle('cursor-locked', locked);
    this.onChange(locked);
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && !this.locked && this.playing()) this.settingsButton.click();
  };
}
