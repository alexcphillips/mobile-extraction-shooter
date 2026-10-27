import { RAID, extractionAt, timeLeft, type Character, type SimState } from '@mes/shared';

/** Under this many seconds left, the timer turns red. */
const LOW_TIME = 120;

/** m:ss. */
export function clock(seconds: number): string {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** How long a warning under the crosshair ("No room for …") stays, in ms. */
const WARN_MS = 1500;

/**
 * The raid timer (top left); while you stand in an extraction point, its name and a
 * countdown to leaving; and under the crosshair, the item on the ground the use button
 * would take, or a warning. Written straight to the DOM, and only when the text changes.
 */
export class RaidHud {
  private timerText = '';
  private extractText = '';
  private promptText = '';
  private warning = '';
  private warnUntil = 0;

  constructor(
    private readonly timer: HTMLElement,
    private readonly extract: HTMLElement,
    private readonly prompt: HTMLElement,
  ) {}

  /** Shows a warning under the crosshair for a moment, over the prompt. */
  warn(text: string, now: number): void {
    this.warning = text;
    this.warnUntil = now + WARN_MS;
  }

  /** Call once per tick: what the use button would take (empty for nothing). */
  setPrompt(text: string, now: number): void {
    const warning = now < this.warnUntil;
    const shown = warning ? this.warning : text;
    if (shown === this.promptText) return;
    this.promptText = shown;
    this.prompt.textContent = shown;
    this.prompt.hidden = !shown;
    this.prompt.classList.toggle('warn', warning);
  }

  /** Call once per tick. `over`: the raid has ended for you. */
  update(sim: SimState, c: Character, over: boolean): void {
    const left = timeLeft(sim);
    const timer = over || left === Infinity ? '' : clock(left);
    if (timer !== this.timerText) {
      this.timerText = timer;
      this.timer.textContent = timer;
      this.timer.hidden = !timer;
      this.timer.classList.toggle('low', left < LOW_TIME);
    }

    const p = over || c.health.dead ? null : extractionAt(sim, c);
    const extract = p
      ? `Extracting at ${p.name} · ${Math.max(0, RAID.extractTime - c.extracting).toFixed(1)}`
      : '';
    if (extract !== this.extractText) {
      this.extractText = extract;
      this.extract.textContent = extract;
      this.extract.hidden = !extract;
    }
  }
}
