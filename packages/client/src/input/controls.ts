import type { Hand } from '@mes/shared';
import type { Hud } from '../hud/hud';
import type { ControlId } from '../hud/layout';
import { settings } from '../settings';
import { CursorLock } from './cursor-lock';
import { PadDriver, type PadPicker } from './pad-driver';

const STICK_RADIUS = 60;
const LOOK_SPEED = 0.006; // radians per CSS pixel at sensitivity 1
/** Radians per pixel of captured mouse (or trackpad) movement, at mouse sensitivity 1. */
const MOUSE_LOOK_SPEED = 0.0025;
/** A captured mouse move bigger than this is a browser glitch (they happen on locking), not a flick. */
const MOUSE_JUMP = 400;
const PITCH_LIMIT = 1.4;
/** Dragging this far straight up from where the thumb landed locks sprinting. #sprint-zone in style.css marks the spot. */
const LOCK_DISTANCE = 110;
/** A touch shorter and smaller than this is a tap (which unlocks sprinting). */
const TAP_MS = 250;
const TAP_SLOP = 12;
/** Holding the heal button this long opens the picker instead of using the default. */
const LONG_PRESS_MS = 400;
/** Hold-to-crouch's double-tap to prone: each tap this short, the second this soon. */
const DOUBLE_TAP_MS = 300;
/** The hand slots, in the order of their buttons and of keys 1–4. */
const HANDS: readonly Hand[] = ['primary1', 'primary2', 'sidearm', 'knife'];

interface MoveTouch {
  id: number;
  originX: number;
  originY: number;
  downAt: number;
  /** Furthest the thumb got from where it landed, to tell taps from drags. */
  maxDist: number;
  /** Sprint was already locked when this touch began, so a tap on it unlocks. */
  startedLocked: boolean;
}

/**
 * Twin-stick touch input. A move stick floats where the left thumb lands; dragging on the
 * right half or on the fire button looks. Pushing the stick to its rim sprints, and
 * dragging it on up into the sprint zone locks sprinting, so the thumb can let go. Pulling
 * the stick back, tapping the left half, aiming, firing or crouching unlocks it. The lean
 * buttons, and Q and E, follow the lean setting: toggled (the default; a held button
 * needs a third thumb), a press leans that way, one on the same side straightens up, and
 * sprinting straightens up too; held, you lean while it's down.
 *
 * Desktop: the mouse is captured (see CursorLock): moving it looks, the left button fires
 * and the right one aims. WASD, Shift sprint, Space jump (or vault), C crouch, X prone
 * (a toggle; C, Space or sprinting gets up), Q and E lean left and right, R reload,
 * F use, I or Tab the bag, 1–4 take out primary 1, primary 2, sidearm or knife,
 * H heal (held, picks), G throw a grenade (held, picks which), B set off placed C4,
 * Z aims too (for a trackpad), 7 and 8 the debug actions. Mouse pointers never drive the
 * touch stick; CSS hides the touch-only buttons. (Before 2026-11-01, Q aimed, E was use
 * and F fired; leaning took Q and E.)
 *
 * A controller (CP-1) is read once a frame by `pad` (input/pad-driver.ts), which presses
 * these same controls through `press`, so its toggles and long presses match touch's.
 */
export class Controls {
  /** Move input, -1..1 per axis; y is forward. */
  moveX = 0;
  moveY = 0;
  sprint = false;
  jump = false;
  crouch = false;
  prone = false;
  aim = false;
  fire = false;
  /** −1 leaning left, 1 right, 0 upright. */
  lean = 0;
  yaw = 0;
  pitch = 0;
  /** Presses, each true for the one tick after its button went down. */
  reload = false;
  interact = false;
  /** The use button held down (zombies mode rebuilds a barricade while it's held). */
  interactHeld = false;
  private touchInteract = false;
  /** The bag button: opens the inventory. */
  bag = false;
  /** A hand slot's button: take it out. */
  draw: Hand | null = null;
  /** The heal button tapped: use what it shows (or stop using a med). */
  heal = false;
  /** The heal button held: pick which med. */
  healPick = false;
  /** The grenade button tapped: throw the one it shows. */
  throw = false;
  /** The grenade button held: pick which grenade. */
  throwPick = false;
  /** The detonate button: set off placed C4. */
  detonate = false;
  /** The put out button: put yourself out while on fire. */
  extinguish = false;
  /** A debug action (0 or 1), or -1. */
  debug = -1;
  /** Look speed multiplier from aim assist, set by the game while the crosshair is on an enemy. */
  assist = 1;
  /**
   * The same for looking up and down. The game leaves it at 1 during a burst, so assist never
   * slows pulling down against recoil (the user's call, 2026-11-08).
   */
  assistPitch = 1;
  /**
   * Rotational aim assist (pad only): how fast the target under the crosshair crosses the
   * view, times its share, in radians per second; set by the game each tick, applied by the
   * pad while steering (input/aim-follow.ts).
   */
  followYaw = 0;
  followPitch = 0;
  /** Look speed is divided by this, set by the game while looking through a scope. */
  zoom = 1;
  /** Desktop mouse capture; the game frees the cursor while a screen needs it. */
  readonly cursor: CursorLock;
  /** The controller (CP-1). */
  readonly pad: PadDriver;
  /** △ tapped on a pad: take out the other primary (the game knows which you carry). */
  swapPrimary = false;
  /** Set by the game each tick: the use prompt shows, so the pad's □ uses rather than reloads. */
  canUse = false;
  /** Set by the game: a raid screen (the bag, a container) is open. */
  screenOpen = false;
  /**
   * Set by the game: a raid screen, the results or spectating is up, so the pad works the
   * menu cursor (CP-2) rather than playing.
   */
  uiOpen = false;
  /** Set by the game: the heal and grenade picker, which the pad steps through. */
  picker: PadPicker | null = null;
  /** The pad's move stick, and its sprint (L3), merged in update(). */
  padMoveX = 0;
  padMoveY = 0;
  padSprint = false;

  private sprintLocked = false;
  private move: MoveTouch | null = null;
  /** Pointers that turn the view (right-half drags and the fire button), by id: last x and y. */
  private readonly look = new Map<number, { x: number; y: number }>();
  /** What to do when a pointer holding a button lifts. */
  private readonly releases = new Map<number, () => void>();
  private stickX = 0;
  private stickY = 0;
  private touchJump = false;
  /** Crouched by the button or C: toggled, or while held (the crouch setting). */
  private crouchOn = false;
  /** When the crouch button last lifted from a tap, for hold mode's double-tap to prone. */
  private crouchTapAt = -Infinity;
  /** Prone is a toggle on both: X, or holding the crouch button. */
  private proneOn = false;
  /** Last update's wish to crouch (or be prone) and to sprint, to tell which came last. */
  private crouchWanted = false;
  private sprintWanted = false;
  /** Crouched mid-sprint: sprint stays off until it's let go, or you stand. */
  private sprintHeldOff = false;
  private touchAim = false;
  /** The lean from the buttons, or toggled with Q and E: −1, 0 or 1. */
  private leanOn = 0;
  private touchFire = false;
  private mouseFire = false;
  private mouseAim = false;
  private pressedReload = false;
  private pressedInteract = false;
  private pressedBag = false;
  private pressedDraw: Hand | null = null;
  private pressedSwap = false;
  private pressedHeal = false;
  private pressedHealPick = false;
  private pressedThrow = false;
  private pressedThrowPick = false;
  private pressedDetonate = false;
  private pressedExtinguish = false;
  private pressedDebug = -1;
  private readonly keys = new Set<string>();
  /** H or G while held: called with whether the release is a tap. */
  private readonly keyHolds = new Map<string, (tap?: boolean) => void>();

  constructor(
    private readonly target: HTMLElement,
    private readonly hud: Hud,
  ) {
    for (const [id, button] of hud.buttons) {
      button.addEventListener('pointerdown', (e) => this.onButton(id, button, e));
    }
    target.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.keyHolds.get(e.code)?.();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      // Let go without a tap: a key released while away never sends its keyup.
      for (const [code, release] of this.keyHolds) {
        this.keyHolds.delete(code);
        release(false);
      }
    });
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    this.cursor = new CursorLock(target, hud.settingsButton, (locked) => {
      if (!locked) this.mouseFire = this.mouseAim = false;
    });
    this.pad = new PadDriver(this, hud.settingsButton);
    // Toggled aim would stay on with no way to turn it off once switched to hold.
    settings.subscribe((s) => {
      if (s.aim === 'hold' && this.touchAim) this.toggleAim();
      if (s.lean === 'hold' && this.leanOn) this.setLean(0);
    });
  }

  /** Combine the stick, buttons and keys; call once per tick. */
  update(): void {
    const k = this.keys;
    this.jump = this.touchJump || k.has('Space');
    const holdZ = settings.current.aim === 'hold' && k.has('KeyZ');
    this.aim = this.touchAim || this.mouseAim || holdZ;
    this.fire = this.touchFire || this.mouseFire;
    this.reload = this.pressedReload;
    this.interact = this.pressedInteract;
    this.interactHeld = this.touchInteract || k.has('KeyF');
    this.bag = this.pressedBag;
    this.draw = this.pressedDraw;
    this.swapPrimary = this.pressedSwap;
    this.heal = this.pressedHeal;
    this.healPick = this.pressedHealPick;
    this.throw = this.pressedThrow;
    this.throwPick = this.pressedThrowPick;
    this.detonate = this.pressedDetonate;
    this.extinguish = this.pressedExtinguish;
    this.debug = this.pressedDebug;
    this.pressedReload = this.pressedInteract = this.pressedBag = false;
    this.pressedHeal = this.pressedHealPick = false;
    this.pressedThrow = this.pressedThrowPick = this.pressedDetonate = false;
    this.pressedExtinguish = false;
    this.pressedDraw = null;
    this.pressedSwap = false;
    this.pressedDebug = -1;

    const kx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const ky = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (kx !== 0 || ky !== 0) {
      const len = Math.hypot(kx, ky);
      this.moveX = kx / len;
      this.moveY = ky / len;
      this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    } else if (this.padMoveX !== 0 || this.padMoveY !== 0) {
      // A partial push walks; L3 sprints (forwards only, as in the sim).
      this.moveX = this.padMoveX;
      this.moveY = this.padMoveY;
      this.sprint = this.padSprint && this.padMoveY > 0;
    } else if (this.sprintLocked) {
      // Locked: run forwards, steering with the stick if a thumb is on it.
      this.moveX = this.stickX;
      this.moveY = 1;
      this.sprint = true;
    } else {
      this.moveX = this.stickX;
      this.moveY = this.stickY;
      // Pushing the stick to the rim sprints (forwards only, as in the sim).
      this.sprint = this.stickY > 0 && Math.hypot(this.stickX, this.stickY) > 0.95;
    }
    if (this.aim || this.fire) this.sprint = false;
    // Firing ends sprint lock, as aiming does.
    if (this.fire && this.sprintLocked) this.setSprintLock(false);
    // Whichever came last of sprinting and crouching wins (2026-11-10, the user's call):
    // starting to sprint stands you up; crouching or going prone mid-sprint stops the
    // sprint until sprint is let go or you stand again.
    const crouchWanted =
      this.crouchOn || this.proneOn || (settings.current.crouch === 'hold' && k.has('KeyC'));
    const sprintWanted = this.sprint && this.moveY > 0;
    if (crouchWanted && !this.crouchWanted && sprintWanted) this.sprintHeldOff = true;
    else if (sprintWanted && !this.sprintWanted) this.sprintHeldOff = false;
    if (!sprintWanted || !crouchWanted) this.sprintHeldOff = false;
    this.crouchWanted = crouchWanted;
    this.sprintWanted = sprintWanted;
    if (this.sprintHeldOff) this.sprint = false;
    // Sprinting turns the crouch and lean toggles off (the sim only sprints forwards).
    if (this.sprint && this.moveY > 0) {
      if (this.crouchOn) this.setCrouch(false);
      if (this.proneOn) this.setProne(false);
      if (this.leanOn) this.setLean(0);
    }
    this.crouch = this.crouchOn || (settings.current.crouch === 'hold' && k.has('KeyC'));
    this.prone = this.proneOn;
    // Held: Q and E while down, else a button held. Toggled: what was last pressed.
    const keyLean = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    this.lean = settings.current.lean === 'hold' ? keyLean || this.leanOn : this.leanOn;
    // Aim on lean (a setting): leaning aims for as long as it lasts, and so doesn't sprint.
    if (settings.current.leanAim && this.lean !== 0) {
      this.aim = true;
      this.sprint = false;
    }
  }

  /** Ends sprint lock, for things outside the controls (letting go of a ladder). */
  unlockSprint(): void {
    this.setSprintLock(false);
  }

  /** Takes out a hand slot, as its key does. */
  drawHand(hand: Hand): void {
    this.pressedDraw = hand;
  }

  /** Takes out the other primary next tick (the pad's △). */
  pressSwap(): void {
    this.pressedSwap = true;
  }

  /** Call once a frame, before the ticks: reads the pad and turns the view with its stick. */
  frame(dtMs: number): void {
    this.pad.frame(dtMs);
  }

  /** Lets go of every touch and key, for pausing. Toggles (crouch, prone, toggled aim) stay. */
  reset(): void {
    this.pad.reset();
    this.move = null;
    this.stickX = this.stickY = 0;
    this.hud.stick.hidden = true;
    this.look.clear();
    for (const release of this.releases.values()) release();
    this.releases.clear();
    // Letting go of the heal or grenade button isn't a tap when it's the game letting go.
    this.pressedHeal = this.pressedThrow = false;
    this.keys.clear();
    this.mouseFire = this.mouseAim = false;
    this.setSprintLock(false);
  }

  private onButton(id: ControlId, button: HTMLButtonElement, e: PointerEvent): void {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    // The fire button also looks, so the thumb can track a target while shooting.
    if (id === 'fire') this.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.releases.set(e.pointerId, this.press(id));
  }

  /**
   * Presses a control, as its touch button does (the pad presses them too, CP-1). Returns
   * what to call when it's let go.
   */
  press(id: ControlId): () => void {
    const button = this.hud.button(id);
    let release = (): void => {};
    const held = (onRelease: () => void): void => {
      button.classList.add('active');
      release = () => {
        button.classList.remove('active');
        onRelease();
      };
    };
    switch (id) {
      case 'fire':
        this.touchFire = true;
        held(() => (this.touchFire = false));
        break;
      case 'aim':
        this.setSprintLock(false);
        if (settings.current.aim === 'toggle') {
          this.toggleAim();
        } else {
          this.touchAim = true;
          held(() => (this.touchAim = false));
        }
        break;
      case 'jump':
        // Jumping from prone gets up instead.
        if (this.proneOn) this.setProne(false);
        else this.touchJump = true;
        held(() => (this.touchJump = false));
        break;
      case 'crouch': {
        // A tap crouches (or stands, or gets up from prone to a crouch) when it lifts;
        // holding it goes prone, or gets up from prone.
        this.setSprintLock(false);
        if (settings.current.crouch === 'hold') {
          // Hold: crouched while down. Prone can't be a long press here, so a quick
          // double-tap goes prone; from prone, a press gets up (crouched while held).
          const now = performance.now();
          if (this.proneOn) this.setProne(false);
          else if (now - this.crouchTapAt < DOUBLE_TAP_MS) {
            this.crouchTapAt = -Infinity;
            this.setProne(true);
            held(() => {});
            break;
          }
          this.setCrouch(true);
          held(() => {
            if (performance.now() - now < DOUBLE_TAP_MS) this.crouchTapAt = performance.now();
            if (!this.proneOn) this.setCrouch(false);
          });
          break;
        }
        let long = false;
        const timer = setTimeout(() => {
          long = true;
          this.setProne(!this.proneOn);
        }, LONG_PRESS_MS);
        held(() => {
          clearTimeout(timer);
          if (long) return;
          if (this.proneOn) {
            this.setProne(false);
            this.setCrouch(true);
          } else this.setCrouch(!this.crouchOn);
        });
        break;
      }
      case 'leanLeft':
      case 'leanRight': {
        // On the press, not the lift, so a peek is quick.
        const side = id === 'leanLeft' ? -1 : 1;
        if (settings.current.lean === 'toggle') {
          this.setLean(this.leanOn === side ? 0 : side);
          held(() => this.setLean(this.leanOn));
        } else {
          this.setLean(side);
          // Unless the other button took over meanwhile.
          held(() => this.setLean(this.leanOn === side ? 0 : this.leanOn));
        }
        break;
      }
      case 'reload':
        this.pressedReload = true;
        held(() => {});
        break;
      case 'interact':
        this.pressedInteract = true;
        this.touchInteract = true;
        held(() => (this.touchInteract = false));
        break;
      case 'bag':
        this.pressedBag = true;
        held(() => {});
        break;
      case 'detonate':
        this.pressedDetonate = true;
        held(() => {});
        break;
      case 'extinguish':
        this.pressedExtinguish = true;
        held(() => {});
        break;
      case 'grenade':
      case 'heal': {
        // A tap uses (or throws) the default when it lifts; holding opens the picker instead.
        const grenade = id === 'grenade';
        let picked = false;
        const timer = setTimeout(() => {
          picked = true;
          if (grenade) this.pressedThrowPick = true;
          else this.pressedHealPick = true;
        }, LONG_PRESS_MS);
        held(() => {
          clearTimeout(timer);
          if (picked) return;
          if (grenade) this.pressedThrow = true;
          else this.pressedHeal = true;
        });
        break;
      }
      default:
        this.pressedDraw = id;
        held(() => {});
    }
    return () => release();
  }

  private toggleAim(): void {
    this.touchAim = !this.touchAim;
    this.hud.button('aim').classList.toggle('active', this.touchAim);
  }

  private setCrouch(on: boolean): void {
    this.crouchOn = on;
    this.hud.button('crouch').classList.toggle('active', on);
  }

  /** Prone on turns the crouch toggle off, so getting up stands. */
  private setProne(on: boolean): void {
    this.proneOn = on;
    if (on) this.setCrouch(false);
    const button = this.hud.button('crouch');
    button.textContent = on ? 'prone' : 'crouch';
    button.classList.toggle('active', on || this.crouchOn);
  }

  /** Leans from a button or toggle; its button stays lit while it's on. */
  private setLean(side: number): void {
    this.leanOn = side;
    this.hud.button('leanLeft').classList.toggle('active', side < 0);
    this.hud.button('leanRight').classList.toggle('active', side > 0);
  }

  private setSprintLock(on: boolean): void {
    this.sprintLocked = on;
    this.hud.sprintZone.classList.toggle('active', on);
    this.hud.sprintLock.hidden = !on || this.move !== null;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.repeat) return;
    // H as its touch button: a tap heals when it lifts, holding opens the picker.
    // Not Shift+H (2026-10-30): Shift is sprint, so healing on the run picked.
    if (e.code === 'KeyR') this.pressedReload = true;
    else if (e.code === 'KeyH')
      this.holdKey(
        e.code,
        () => (this.pressedHeal = true),
        () => (this.pressedHealPick = true),
      );
    else if (e.code === 'KeyZ' && settings.current.aim === 'toggle') this.toggleAim();
    else if (e.code === 'KeyF') this.pressedInteract = true;
    else if ((e.code === 'KeyQ' || e.code === 'KeyE') && settings.current.lean === 'toggle') {
      const side = e.code === 'KeyQ' ? -1 : 1;
      this.setLean(this.leanOn === side ? 0 : side);
    } else if (e.code === 'KeyX') this.setProne(!this.proneOn);
    else if (e.code === 'KeyC' && settings.current.crouch === 'toggle') {
      // As the touch button's tap: from prone it gets up to a crouch.
      if (this.proneOn) {
        this.setProne(false);
        this.setCrouch(true);
      } else this.setCrouch(!this.crouchOn);
    } else if ((e.code === 'KeyC' || e.code === 'Space') && this.proneOn) this.setProne(false);
    // G as its touch button too: a tap throws when it lifts, holding opens the picker.
    else if (e.code === 'KeyG')
      this.holdKey(
        e.code,
        () => (this.pressedThrow = true),
        () => (this.pressedThrowPick = true),
      );
    else if (e.code === 'KeyB') this.pressedDetonate = true;
    else if (e.code === 'KeyV') this.pressedExtinguish = true;
    else if (e.code === 'KeyI' || e.code === 'Tab') {
      e.preventDefault();
      this.pressedBag = true;
    } else if (/^Digit[1-4]$/.test(e.code)) this.pressedDraw = HANDS[Number(e.code.slice(5)) - 1]!;
    else if (/^Digit[78]$/.test(e.code)) this.pressedDebug = Number(e.code.slice(5)) - 7;
  };

  private holdKey(code: string, tap: () => void, hold: () => void): void {
    let held = false;
    const timer = setTimeout(() => {
      held = true;
      hold();
    }, LONG_PRESS_MS);
    this.keyHolds.set(code, (isTap = true) => {
      this.keyHolds.delete(code);
      clearTimeout(timer);
      if (!held && isTap) tap();
    });
  }

  /** A debug action from an on-screen button, as if its key was pressed. */
  pressDebug(i: number): void {
    this.pressedDebug = i;
  }

  private readonly onDown = (e: PointerEvent): void => {
    // The mouse looks and shoots through the captured cursor instead.
    if (e.pointerType === 'mouse') return;
    if (e.clientX < window.innerWidth / 2 && !this.move) {
      this.move = {
        id: e.pointerId,
        originX: e.clientX,
        originY: e.clientY,
        downAt: e.timeStamp,
        maxDist: 0,
        startedLocked: this.sprintLocked,
      };
      this.hud.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.hud.knob.style.transform = 'translate(0px, 0px)';
      this.hud.stick.hidden = false;
      this.hud.sprintLock.hidden = true;
    } else if (e.clientX >= window.innerWidth / 2) {
      this.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
    } else return;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const m = this.move;
    if (m && e.pointerId === m.id) {
      const rawX = e.clientX - m.originX;
      const rawY = e.clientY - m.originY;
      const len = Math.hypot(rawX, rawY);
      m.maxDist = Math.max(m.maxDist, len);
      const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
      this.stickX = (rawX * k) / STICK_RADIUS;
      this.stickY = (-rawY * k) / STICK_RADIUS;
      this.hud.knob.style.transform = `translate(${rawX * k}px, ${rawY * k}px)`;
      if (this.sprintLocked) {
        if (this.stickY < -0.5) this.setSprintLock(false);
      } else if (-rawY > LOCK_DISTANCE && Math.abs(rawX) < -rawY * 0.6) {
        this.setSprintLock(true);
      }
      return;
    }
    const last = this.look.get(e.pointerId);
    if (!last) return;
    this.turn(
      e.clientX - last.x,
      e.clientY - last.y,
      LOOK_SPEED * settings.current.lookSensitivity,
    );
    last.x = e.clientX;
    last.y = e.clientY;
  };

  /** Turns the view with the target for `dt` seconds (rotational aim assist). */
  follow(dt: number): void {
    this.yaw += this.followYaw * dt;
    this.pitch += this.followPitch * dt;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  /**
   * Turns the view by a pointer's movement in CSS pixels, at `base` radians per pixel (or by
   * a pad's stick: its rate times the frame's seconds, at `base` radians per second).
   */
  turn(dx: number, dy: number, base: number): void {
    const s = settings.current;
    const speed = (base * (this.aim ? s.aimSensitivity : 1)) / this.zoom;
    this.yaw -= dx * speed * this.assist;
    this.pitch -= dy * speed * this.assistPitch * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    // The click that takes the mouse back after a screen closed fires or aims too.
    if (!this.cursor.locked && !(this.cursor.resuming && e.target === this.target)) return;
    e.preventDefault();
    if (e.button === 0) this.mouseFire = true;
    else if (e.button === 2) {
      if (settings.current.aim === 'toggle') this.toggleAim();
      else this.mouseAim = true;
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseFire = false;
    else if (e.button === 2) this.mouseAim = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.cursor.locked) return;
    if (Math.abs(e.movementX) > MOUSE_JUMP || Math.abs(e.movementY) > MOUSE_JUMP) return;
    this.turn(e.movementX, e.movementY, MOUSE_LOOK_SPEED * settings.current.mouseSensitivity);
  };

  private readonly onUp = (e: PointerEvent): void => {
    const m = this.move;
    if (m && e.pointerId === m.id) {
      this.move = null;
      this.stickX = this.stickY = 0;
      this.hud.stick.hidden = true;
      const tap = e.timeStamp - m.downAt < TAP_MS && m.maxDist < TAP_SLOP;
      this.setSprintLock(this.sprintLocked && !(tap && m.startedLocked));
    }
    this.look.delete(e.pointerId);
    const release = this.releases.get(e.pointerId);
    if (release) {
      this.releases.delete(e.pointerId);
      release();
    }
  };
}
