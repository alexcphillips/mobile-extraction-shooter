import type { Character, CompiledTutorial, CompiledTutorialStep } from '@mes/shared';
import type * as THREE from 'three';
import { inputMode, type InputMode } from '../input/mode';
import type { Hud } from './hud';
import type { ControlId } from './layout';
import { screenSpot } from './quest-markers';

/** How high over its spot the marker floats, in metres. */
const LIFT = 0.6;

/** Where to skip from, for inputs that can't tap the card's button. */
const SKIP_HINT: Record<Exclude<InputMode, 'touch'>, string> = {
  desktop: 'Esc, then Skip tutorial in settings, to skip it.',
  gamepad: 'Options, then Skip tutorial in settings, to skip it.',
};

/**
 * The tutorial on screen (TU-3, 2026-11-09): a card at the top with the showing step's
 * prompt, worded for the input in use (and changing with it), a bright marker over the
 * step's spot if it has one (seen through walls, at the screen's edge when off it), and
 * the step's touch buttons outlined. On the first step the card offers to skip.
 */
export class TutorialCard {
  private readonly card = document.createElement('div');
  private readonly count = document.createElement('div');
  private readonly text = document.createElement('p');
  private readonly skip = document.createElement('div');
  private readonly marker = document.createElement('div');
  private step: CompiledTutorialStep | null = null;
  private index = -1;
  private outlined: readonly string[] = [];
  /** Where the marker is drawn, as screenSpot gives it; and its whole metres away. */
  private at = -1;
  private metres = -1;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly tutorial: CompiledTutorial,
    private readonly hud: Hud,
    onSkip: () => void,
  ) {
    root.replaceChildren();
    this.card.className = 'tutorial-card';
    this.count.className = 'tutorial-count';
    this.skip.className = 'tutorial-skip';
    const button = document.createElement('button');
    button.textContent = 'Skip tutorial';
    button.addEventListener('click', onSkip);
    this.skip.append(button, document.createElement('span'));
    this.card.append(this.count, this.text, this.skip);
    this.marker.className = 'tutorial-marker';
    this.marker.hidden = true;
    root.append(this.card, this.marker);
    root.hidden = false;
    this.unsubscribe = inputMode.subscribe(() => this.words());
  }

  /** Shows step i (an index into the tutorial's steps); past the last, nothing. */
  show(i: number): void {
    if (i === this.index) return;
    this.index = i;
    this.step = this.tutorial.steps[i] ?? null;
    this.at = -1;
    this.metres = -1;
    this.outline(this.step?.buttons ?? []);
    this.card.hidden = !this.step;
    if (!this.step) return;
    this.count.textContent = `${i + 1} / ${this.tutorial.steps.length}`;
    this.words();
    // Played again from the start, so each new prompt draws the eye.
    this.card.classList.remove('new');
    void this.card.offsetWidth;
    this.card.classList.add('new');
  }

  /**
   * Call once per frame, after the camera has moved. `shown`: false hides the marker (a
   * screen open, dead, the raid over); the card stays, since a step can need the bag open.
   */
  update(camera: THREE.PerspectiveCamera, player: Character, shown: boolean): void {
    const m = this.step?.markerPos;
    const on = !!m && shown;
    if (this.marker.hidden === on) this.marker.hidden = !on;
    if (!m || !on) return;
    const at = screenSpot(camera, m.x, m.y + LIFT, m.z, 34);
    if (at !== this.at) {
      this.at = at;
      this.marker.style.transform = `translate(${at >> 16}px, ${at & 0xffff}px)`;
    }
    const d = Math.round(Math.hypot(m.x - player.x, m.y - player.y, m.z - player.z));
    if (d !== this.metres) {
      this.metres = d;
      this.marker.textContent = `${d} m`;
    }
  }

  /** Gone: the raid is over for you. */
  close(): void {
    this.unsubscribe();
    this.outline([]);
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  /** The prompt and the skip line, for the input in use. */
  private words(): void {
    if (!this.step) return;
    const mode = inputMode.current;
    this.text.textContent = this.step.prompt[mode];
    const first = this.index === 0;
    this.skip.hidden = !first;
    if (!first) return;
    this.skip.classList.toggle('touch', mode === 'touch');
    this.skip.lastElementChild!.textContent = mode === 'touch' ? '' : SKIP_HINT[mode];
  }

  private outline(ids: readonly string[]): void {
    for (const id of this.outlined)
      this.hud.button(id as ControlId).classList.remove('tutorial-hint');
    for (const id of ids) this.hud.button(id as ControlId).classList.add('tutorial-hint');
    this.outlined = ids;
  }
}
