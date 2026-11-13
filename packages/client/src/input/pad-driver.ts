import { settings } from '../settings';
import { audio, unlockAudio } from '../app/audio';
import type { Controls } from './controls';
import {
  PAD,
  PAD_BUTTONS,
  bit,
  createPadFrame,
  createPadState,
  firstPad,
  mapPad,
  readPad,
  type PadButton,
} from './gamepad';
import { inputMode } from './mode';
import { padCursor } from './pad-cursor';

/** Radians per second at full push and look sensitivity 1, before the rim boost (~170°/s). */
export const PAD_TURN_SPEED = 3;
/** △ or a shoulder button held this long is a hold (the sidearm, a picker), as touch's long press. */
const HOLD_MS = 400;
/** Not read for this long (ms; paused, say), what's held isn't a fresh press. */
const STALE_MS = 150;
/** The look stick pushed this far up or down steps the picker once. */
const PICK_FLICK = 0.5;

/** The heal and grenade picker as the pad works it: hold L1 or R1, step, let go. */
export interface PadPicker {
  readonly pickerOpen: boolean;
  /** Moves the highlight one entry up (−1) or down (1). */
  stepPick(by: number): void;
  /** Picks the highlighted entry and closes the picker. */
  choosePick(): void;
}

const has = (mask: number, b: PadButton): boolean => (mask & bit(b)) !== 0;

/**
 * Plays the raid with a controller in the standard mapping (CP-1, 2026-11-08; layout in
 * roadmap.md → PC controller). Read once a frame by `Controls.frame`. Each button presses
 * the control its touch button would (`Controls.press`), so toggles, holds and long
 * presses behave the same; only △ (tap: the other primary, hold: sidearm), R3 (knife),
 * L3 (sprint until you stop pushing forwards, aim or fire) and □ (use when the prompt
 * shows, else reload) are the pad's own. While a raid screen, the results or spectating is
 * up (`Controls.uiOpen`), its frames go to the menu cursor instead (`pad-cursor.ts`, CP-2);
 * while you play, it claims the pad so the cursor stays hidden. While the game is paused
 * (settings) the raid's loop stops, and the cursor reads the pad itself.
 */
export class PadDriver {
  private readonly state = createPadState();
  private frameA = createPadFrame();
  private frameB = createPadFrame();
  /** Release callbacks for the controls each button holds down, by button index. */
  private readonly releases: ((() => void) | null)[] = Array.from(
    { length: PAD_BUTTONS },
    () => null,
  );
  private sprintOn = false;
  /** The look stick was flicked past PICK_FLICK (−1 up, 1 down, 0 neither), for stepping. */
  private flick = 0;
  /** △'s hold timer, and whether it went off (the sidearm came out). */
  private swapTimer: ReturnType<typeof setTimeout> | null = null;
  private warned = false;
  private soundHinted = false;
  private lastRead = 0;

  /** Told once, the first time the pad is used, if the sound is still locked. */
  onSoundLocked: () => void = () => {};

  constructor(
    private readonly controls: Controls,
    /** The settings gear, which Options presses. */
    private readonly settingsButton: HTMLElement,
  ) {}

  /** Reads the pad, presses and lets go of controls, and turns the view. */
  frame(dtMs: number): void {
    if (!this.read(dtMs)) return;
    const f = this.frameA;
    const c = this.controls;
    if (f.active) this.wake();
    if (!inputMode.gamepad) {
      // Another input has the game: a resting pad (drift, a trigger touched) does nothing.
      this.reset();
      return;
    }

    if (c.uiOpen) {
      // A raid screen or the results: the menu cursor works it. Closing a raid screen is
      // the bag button's job.
      this.padMove(0, 0);
      padCursor.feed(f, dtMs, c.screenOpen ? { close: this.closeScreen } : {});
      return;
    }
    padCursor.claim();

    if (has(f.pressed, PAD.options)) this.settingsButton.click();

    const picking = c.picker?.pickerOpen ?? false;
    if (picking) this.stepPicker(f.lookY, f.pressed);
    else this.flick = 0;

    for (let b = 0; b < PAD_BUTTONS; b++) {
      if (has(f.pressed, b as PadButton)) this.down(b as PadButton, picking);
      else if (has(f.released, b as PadButton)) this.up(b as PadButton);
    }

    // Sprint ends when you stop pushing forwards, as letting go of Shift.
    if (this.sprintOn && f.moveY < 0.3) this.sprintOn = false;
    this.padMove(f.moveX, f.moveY);

    if (!picking && (f.lookX !== 0 || f.lookY !== 0)) {
      const base = PAD_TURN_SPEED * settings.current.padSensitivity * f.boost * (dtMs / 1000);
      c.turn(f.lookX, f.lookY, base);
    }
    // Rotational aim assist, only while steering, as console shooters do: a still pad never
    // aims for you.
    const steering = f.moveX !== 0 || f.moveY !== 0 || f.lookX !== 0 || f.lookY !== 0;
    if (!picking && steering) c.follow(dtMs / 1000);
  }

  /** Lets go of everything the pad holds down (pausing). Toggles stay, as for touch. */
  reset(): void {
    for (let b = 0; b < PAD_BUTTONS; b++) this.up(b as PadButton);
    this.sprintOn = false;
    this.padMove(0, 0);
  }

  /** Swaps frames and reads the first standard pad into the new one; false when none. */
  private read(dtMs: number): boolean {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = firstPad(pads);
    if (!gp) {
      if (!this.warned && pads.some((p) => p?.connected && p.mapping !== 'standard')) {
        this.warned = true;
        console.warn(
          'A controller is connected without the standard mapping, so the game can’t read it. Chrome maps a PS4 or Xbox pad; try another browser or a USB cable.',
        );
      }
      if (this.frameA.held !== 0) {
        // Unplugged with buttons down: let go of them.
        this.state.buttons.fill(0);
        this.state.axes.fill(0);
      } else return false;
    } else readPad(gp, this.state);
    const prev = this.frameA;
    this.frameA = this.frameB;
    this.frameB = prev;
    mapPad(this.state, prev, dtMs / 1000, this.frameA);
    // Back from a pause (the cursor had the pad): the button that closed settings is still
    // held, and isn't a press here (○ would crouch).
    const now = performance.now();
    if (now - this.lastRead > STALE_MS) this.frameA.pressed = 0;
    this.lastRead = now;
    return true;
  }

  private readonly closeScreen = (): void => this.controls.press('bag')();

  private wake(): void {
    if (inputMode.gamepad) return;
    inputMode.usePad();
    // Browsers may not count a pad press as a gesture, so this can fail (see app/audio.ts).
    // Resuming is asynchronous: look again a moment later.
    if (unlockAudio() || this.soundHinted) return;
    this.soundHinted = true;
    setTimeout(() => {
      if (!audio()) this.onSoundLocked();
    }, 300);
  }

  private padMove(x: number, y: number): void {
    this.controls.padMoveX = x;
    this.controls.padMoveY = y;
    this.controls.padSprint = this.sprintOn;
  }

  private hold(b: PadButton, release: () => void): void {
    this.releases[b]?.();
    this.releases[b] = release;
  }

  private down(b: PadButton, picking: boolean): void {
    const c = this.controls;
    switch (b) {
      case PAD.r2:
        this.sprintOn = false;
        this.hold(b, c.press('fire'));
        break;
      case PAD.l2:
        this.sprintOn = false;
        this.hold(b, c.press('aim'));
        break;
      case PAD.l3:
        // Aiming stops sprinting, so while aimed L3 is the breath button (BW-2).
        if (c.aim) c.press('breathe')();
        else this.sprintOn = true;
        break;
      case PAD.r3:
        c.drawHand('knife');
        break;
      case PAD.cross:
        this.hold(b, c.press('jump'));
        break;
      case PAD.circle:
        this.hold(b, c.press('crouch'));
        break;
      case PAD.square:
        // Use only when the prompt shows; held, it keeps using (rebuilding a barricade).
        this.hold(b, c.press(c.canUse ? 'interact' : 'reload'));
        break;
      case PAD.triangle: {
        // A tap takes out the other primary when it lifts; a hold, the sidearm.
        let long = false;
        if (this.swapTimer) clearTimeout(this.swapTimer);
        this.swapTimer = setTimeout(() => {
          long = true;
          this.swapTimer = null;
          c.drawHand('sidearm');
        }, HOLD_MS);
        this.hold(b, () => {
          if (this.swapTimer) clearTimeout(this.swapTimer);
          this.swapTimer = null;
          if (!long) c.pressSwap();
        });
        break;
      }
      case PAD.l1:
      case PAD.r1: {
        // A tap heals or throws; a hold opens the picker, stepped while held, picked on letting go.
        if (picking) {
          // Already open (let go before it showed): this press picks.
          this.hold(b, () => c.picker?.choosePick());
          break;
        }
        const release = c.press(b === PAD.l1 ? 'heal' : 'grenade');
        this.hold(b, () => {
          release();
          const p = c.picker;
          if (p?.pickerOpen) p.choosePick();
        });
        break;
      }
      case PAD.left:
      case PAD.right:
        if (!picking) this.hold(b, c.press(b === PAD.left ? 'leanLeft' : 'leanRight'));
        break;
      case PAD.up:
        if (!picking) c.press('detonate')();
        break;
      case PAD.down:
        if (!picking) c.press('extinguish')();
        break;
      case PAD.touchpad:
        c.press('bag')();
        break;
    }
  }

  private up(b: PadButton): void {
    const release = this.releases[b];
    if (!release) return;
    this.releases[b] = null;
    release();
  }

  /** While the picker is open: the D-pad or a flick of the look stick moves the highlight. */
  private stepPicker(lookY: number, pressed: number): void {
    const p = this.controls.picker!;
    if (has(pressed, PAD.up)) p.stepPick(-1);
    if (has(pressed, PAD.down)) p.stepPick(1);
    const flick = lookY < -PICK_FLICK ? -1 : lookY > PICK_FLICK ? 1 : 0;
    if (flick !== 0 && flick !== this.flick) p.stepPick(flick);
    this.flick = flick;
  }
}
