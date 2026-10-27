import { RAID, extractionAt, timeLeft, type Character, type SimState } from '@mes/shared';

/** Under this many seconds left, the timer turns red. */
const LOW_TIME = 120;

/** m:ss. */
export function clock(seconds: number): string {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The raid timer (top left) and, while you stand in an extraction point, its name and a
 * countdown to leaving. Written straight to the DOM, and only when the text changes.
 */
export class RaidHud {
  private timerText = '';
  private extractText = '';

  constructor(
    private readonly timer: HTMLElement,
    private readonly extract: HTMLElement,
  ) {}

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
