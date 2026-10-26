import type { Hud } from '../hud/hud';
import type { ControlId } from '../hud/layout';
import { settings } from '../settings';

const STICK_RADIUS = 60;
const LOOK_SPEED = 0.006; // radians per CSS pixel at sensitivity 1
const PITCH_LIMIT = 1.4;
/** Dragging this far straight up from where the thumb landed locks sprinting. #sprint-zone in style.css marks the spot. */
const LOCK_DISTANCE = 110;
/** A touch shorter and smaller than this is a tap (which unlocks sprinting). */
const TAP_MS = 250;
const TAP_SLOP = 12;
const QUICK_SLOTS: readonly ControlId[] = ['quick1', 'quick2', 'quick3', 'quick4'];

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
 * the stick back, tapping the left half, aiming or crouching unlocks it.
 *
 * Desktop: WASD, Shift sprint, Space jump, C crouch, F fire, Q aim, R reload, E use, 1–4
 * quick slots, and mouse drag to look.
 */
export class Controls {
  /** Move input, -1..1 per axis; y is forward. */
  moveX = 0;
  moveY = 0;
  sprint = false;
  jump = false;
  crouch = false;
  aim = false;
  fire = false;
  yaw = 0;
  pitch = 0;
  /** Presses, each true for the one tick after its button went down. */
  reload = false;
  interact = false;
  /** The quick slot pressed this tick (0–3), or -1. */
  quickSlot = -1;

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
  private touchAim = false;
  private touchFire = false;
  private pressedReload = false;
  private pressedInteract = false;
  private pressedQuick = -1;
  private readonly keys = new Set<string>();

  constructor(
    target: HTMLElement,
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
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Combine the stick, buttons and keys; call once per tick. */
  update(): void {
    const k = this.keys;
    this.jump = this.touchJump || k.has('Space');
    this.aim = this.touchAim || k.has('KeyQ');
    this.fire = this.touchFire || k.has('KeyF');
    this.reload = this.pressedReload;
    this.interact = this.pressedInteract;
    this.quickSlot = this.pressedQuick;
    this.pressedReload = this.pressedInteract = false;
    this.pressedQuick = -1;

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
    if (this.aim) this.sprint = false;
    // Sprinting turns the crouch toggle off (the sim only sprints forwards).
    if (this.sprint && this.moveY > 0 && this.touchCrouch) this.setCrouch(false);
    this.crouch = this.touchCrouch || k.has('KeyC');
  }

  /** Ends sprint lock, for things outside the controls (letting go of a ladder). */
  unlockSprint(): void {
    this.setSprintLock(false);
  }

  /** Lets go of every touch and key, for pausing. Toggles (crouch, toggled aim) stay. */
  reset(): void {
    this.move = null;
    this.stickX = this.stickY = 0;
    this.hud.stick.hidden = true;
    this.look.clear();
    for (const release of this.releases.values()) release();
    this.releases.clear();
    this.keys.clear();
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
          this.touchAim = !this.touchAim;
          button.classList.toggle('active', this.touchAim);
        } else {
          this.touchAim = true;
          held(() => (this.touchAim = false));
        }
        break;
      case 'jump':
        this.touchJump = true;
        held(() => (this.touchJump = false));
        break;
      case 'crouch':
        this.setSprintLock(false);
        this.setCrouch(!this.touchCrouch);
        break;
      case 'reload':
        this.pressedReload = true;
        held(() => {});
        break;
      case 'interact':
        this.pressedInteract = true;
        held(() => {});
        break;
      default:
        this.pressedQuick = QUICK_SLOTS.indexOf(id);
        held(() => {});
    }
  }

  private setCrouch(on: boolean): void {
    this.touchCrouch = on;
    this.hud.button('crouch').classList.toggle('active', on);
  }

  private setSprintLock(on: boolean): void {
    this.sprintLocked = on;
    this.hud.sprintZone.classList.toggle('active', on);
    this.hud.sprintLock.hidden = !on || this.move !== null;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyR') this.pressedReload = true;
    else if (e.code === 'KeyE') this.pressedInteract = true;
    else if (/^Digit[1-4]$/.test(e.code)) this.pressedQuick = Number(e.code.slice(5)) - 1;
  };

  private readonly onDown = (e: PointerEvent): void => {
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
    const s = settings.current;
    const speed = LOOK_SPEED * s.lookSensitivity * (this.aim ? s.aimSensitivity : 1);
    this.yaw -= (e.clientX - last.x) * speed;
    this.pitch -= (e.clientY - last.y) * speed * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    last.x = e.clientX;
    last.y = e.clientY;
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
