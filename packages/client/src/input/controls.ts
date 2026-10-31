import type { Hand } from '@mes/shared';
import type { Hud } from '../hud/hud';
import type { ControlId } from '../hud/layout';
import { settings } from '../settings';
import { CursorLock } from './cursor-lock';

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
 * the stick back, tapping the left half, aiming, firing or crouching unlocks it.
 *
 * Desktop: the mouse is captured (see CursorLock): moving it looks, the left button fires
 * and the right one aims. WASD, Shift sprint, Space jump (or vault), C crouch, X prone
 * (a toggle; C, Space or sprinting gets up), R reload, E use, I or Tab the bag, 1–4 take out primary 1, primary 2, sidearm or knife,
 * H heal (held, picks), G throw a grenade (held, picks which), B set off placed C4,
 * F and Q fire and aim too, 7 and 8 the debug actions. Mouse pointers never drive the
 * touch stick; CSS hides the touch-only buttons.
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
  yaw = 0;
  pitch = 0;
  /** Presses, each true for the one tick after its button went down. */
  reload = false;
  interact = false;
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
  /** Look speed is divided by this, set by the game while looking through a scope. */
  zoom = 1;
  /** Desktop mouse capture; the game frees the cursor while a screen needs it. */
  readonly cursor: CursorLock;

  private sprintLocked = false;
  private move: MoveTouch | null = null;
  /** Pointers that turn the view (right-half drags and the fire button), by id: last x and y. */
  private readonly look = new Map<number, { x: number; y: number }>();
  /** What to do when a pointer holding a button lifts. */
  private readonly releases = new Map<number, () => void>();
  private stickX = 0;
  private stickY = 0;
  private touchJump = false;
  private touchCrouch = false;
  /** Prone is a toggle on both: X, or holding the crouch button. */
  private proneOn = false;
  private touchAim = false;
  private touchFire = false;
  private mouseFire = false;
  private mouseAim = false;
  private pressedReload = false;
  private pressedInteract = false;
  private pressedBag = false;
  private pressedDraw: Hand | null = null;
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
    // Toggled aim would stay on with no way to turn it off once switched to hold.
    settings.subscribe((s) => {
      if (s.aim === 'hold' && this.touchAim) this.toggleAim();
    });
  }

  /** Combine the stick, buttons and keys; call once per tick. */
  update(): void {
    const k = this.keys;
    this.jump = this.touchJump || k.has('Space');
    const holdQ = settings.current.aim === 'hold' && k.has('KeyQ');
    this.aim = this.touchAim || this.mouseAim || holdQ;
    this.fire = this.touchFire || this.mouseFire || k.has('KeyF');
    this.reload = this.pressedReload;
    this.interact = this.pressedInteract;
    this.bag = this.pressedBag;
    this.draw = this.pressedDraw;
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
    this.pressedDebug = -1;

    const kx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const ky = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (kx !== 0 || ky !== 0) {
      const len = Math.hypot(kx, ky);
      this.moveX = kx / len;
      this.moveY = ky / len;
      this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
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
    // Sprinting turns the crouch toggle off (the sim only sprints forwards).
    if (this.sprint && this.moveY > 0) {
      if (this.touchCrouch) this.setCrouch(false);
      if (this.proneOn) this.setProne(false);
    }
    this.crouch = this.touchCrouch || k.has('KeyC');
    this.prone = this.proneOn;
  }

  /** Ends sprint lock, for things outside the controls (letting go of a ladder). */
  unlockSprint(): void {
    this.setSprintLock(false);
  }

  /** Lets go of every touch and key, for pausing. Toggles (crouch, prone, toggled aim) stay. */
  reset(): void {
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
    const held = (release: () => void): void => {
      button.classList.add('active');
      this.releases.set(e.pointerId, () => {
        button.classList.remove('active');
        release();
      });
    };
    switch (id) {
      case 'fire':
        // The fire button also looks, so the thumb can track a target while shooting.
        this.touchFire = true;
        this.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
          } else this.setCrouch(!this.touchCrouch);
        });
        break;
      }
      case 'reload':
        this.pressedReload = true;
        held(() => {});
        break;
      case 'interact':
        this.pressedInteract = true;
        held(() => {});
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
  }

  private toggleAim(): void {
    this.touchAim = !this.touchAim;
    this.hud.button('aim').classList.toggle('active', this.touchAim);
  }

  private setCrouch(on: boolean): void {
    this.touchCrouch = on;
    this.hud.button('crouch').classList.toggle('active', on);
  }

  /** Prone on turns the crouch toggle off, so getting up stands. */
  private setProne(on: boolean): void {
    this.proneOn = on;
    if (on) this.setCrouch(false);
    const button = this.hud.button('crouch');
    button.textContent = on ? 'prone' : 'crouch';
    button.classList.toggle('active', on || this.touchCrouch);
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
    else if (e.code === 'KeyQ' && settings.current.aim === 'toggle') this.toggleAim();
    else if (e.code === 'KeyE') this.pressedInteract = true;
    else if (e.code === 'KeyX') this.setProne(!this.proneOn);
    else if ((e.code === 'KeyC' || e.code === 'Space') && this.proneOn) this.setProne(false);
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

  /** Turns the view by a pointer's movement in CSS pixels, at `base` radians per pixel. */
  private turn(dx: number, dy: number, base: number): void {
    const s = settings.current;
    const speed = (base * (this.aim ? s.aimSensitivity : 1) * this.assist) / this.zoom;
    this.yaw -= dx * speed;
    this.pitch -= dy * speed * (s.invertY ? -1 : 1);
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
