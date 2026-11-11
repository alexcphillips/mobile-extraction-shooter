import { PAD_GLYPHS } from '../input/pad-labels';
import { RAID, extractionAt, pointsOf, timeLeft, type Character, type SimState } from '@mes/shared';

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
 * Zombies mode's line where the timer goes: the round (or the wait for the next), your
 * points, and the seconds left of any power-up running.
 */
function zombiesLine(sim: SimState, c: Character): string {
  const z = sim.zombies!;
  const points = c.admin?.infinitePoints
    ? '∞ points'
    : `${pointsOf(sim, c.id).toLocaleString()} points`;
  let line = z.between
    ? `Round ${z.round + 1} in ${Math.max(0, Math.ceil(z.timer))} · ${points}`
    : `Round ${z.round} · ${points}`;
  if (z.instaKill > 0) line += ` · Insta-kill ${Math.ceil(z.instaKill)}`;
  if (z.doublePoints > 0) line += ` · Double points ${Math.ceil(z.doublePoints)}`;
  const machine = z.machines[c.id];
  if (machine) line += ` · Minigun ${Math.ceil(machine.left)}`;
  return line;
}

/**
 * The raid timer (top left), or in zombies mode the round and your points; while you stand in an extraction point, its name and a
 * countdown to leaving; and under the crosshair, the item on the ground the use button
 * would take (or the quest marker it would investigate), or a warning. Written straight to the DOM, and only when the text changes.
 */
export class RaidHud {
  private timerText = '';
  private extractText = '';
  private promptText = '';
  private promptKey = '';
  private warning = '';
  private warnUntil = 0;
  /** Whether what's shown over the prompt is a warning, or just news. */
  private warnClass = true;
  /** The use ring's percentage, or −1 hidden. */
  private useShown = -1;

  constructor(
    private readonly timer: HTMLElement,
    private readonly extract: HTMLElement,
    private readonly prompt: HTMLElement,
    private readonly useRing: HTMLElement,
  ) {}

  /** The ring round the crosshair while holding the use button: how far along, 0 to 1. */
  setUse(fraction: number | null): void {
    const shown = fraction === null ? -1 : Math.min(100, Math.round(fraction * 100));
    if (shown === this.useShown) return;
    this.useShown = shown;
    this.useRing.hidden = shown < 0;
    if (shown >= 0) this.useRing.style.setProperty('--done', `${shown}%`);
  }

  /** Shows a warning under the crosshair for a moment, over the prompt. */
  warn(text: string, now: number, ms = WARN_MS): void {
    this.warning = text;
    this.warnUntil = now + ms;
    this.warnClass = true;
  }

  /** As warn, in the prompt's own color: news, not a problem ("Investigated · …"). */
  note(text: string, now: number, ms = WARN_MS): void {
    this.warn(text, now, ms);
    this.warnClass = false;
  }

  /**
   * Call once per tick: what the use button would take (empty for nothing). `key`: the
   * key that does it, shown before the text on desktop.
   */
  setPrompt(text: string, now: number, key = ''): void {
    const warning = now < this.warnUntil;
    const shown = warning ? this.warning : text;
    const shownKey = warning ? '' : key;
    if (shown === this.promptText && shownKey === this.promptKey) return;
    this.promptText = shown;
    this.promptKey = shownKey;
    if (shownKey) {
      const kbd = document.createElement('kbd');
      kbd.textContent = shownKey;
      // A controller's face button (□ ✕ ○ △) is drawn as a round, colored glyph.
      if (PAD_GLYPHS.includes(shownKey)) {
        kbd.className = 'pad';
        kbd.dataset.glyph = shownKey;
      }
      this.prompt.replaceChildren(kbd, ` ${shown}`);
    } else this.prompt.textContent = shown;
    this.prompt.hidden = !shown;
    this.prompt.classList.toggle('warn', warning && this.warnClass);
  }

  /** Call once per tick. `over`: the raid has ended for you. */
  update(sim: SimState, c: Character, over: boolean): void {
    const left = timeLeft(sim);
    const timer = over
      ? ''
      : sim.zombies
        ? zombiesLine(sim, c)
        : left === Infinity
          ? ''
          : clock(left);
    if (timer !== this.timerText) {
      this.timerText = timer;
      this.timer.textContent = timer;
      this.timer.hidden = !timer;
      this.timer.classList.toggle('low', !sim.zombies && left < LOW_TIME);
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
