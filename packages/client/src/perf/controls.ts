const STICK_RADIUS = 60;
const LOOK_SPEED = 0.006; // radians per CSS pixel
const PITCH_LIMIT = 1.4;

/**
 * Basic twin-stick touch input: a floating move stick on the left half of the screen,
 * drag to look on the right half. WASD + Shift and mouse drag also work on desktop.
 * The full controls (layout, buttons, settings) are session 5.
 */
export class Controls {
  /** Move input, -1..1 per axis; y is forward. */
  moveX = 0;
  moveY = 0;
  sprint = false;
  yaw = 0;
  pitch = 0;

  private moveId = -1;
  private lookId = -1;
  private originX = 0;
  private originY = 0;
  private lastX = 0;
  private lastY = 0;
  private stickX = 0;
  private stickY = 0;
  private readonly keys = new Set<string>();

  constructor(
    target: HTMLElement,
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
  ) {
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Combine stick and keys; call once per tick. */
  update(): void {
    const kx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const ky = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    if (kx !== 0 || ky !== 0) {
      const len = Math.hypot(kx, ky);
      this.moveX = kx / len;
      this.moveY = ky / len;
      this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    } else {
      this.moveX = this.stickX;
      this.moveY = this.stickY;
      // Pushing the stick to the rim sprints.
      this.sprint = Math.hypot(this.stickX, this.stickY) > 0.95;
    }
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.clientX < window.innerWidth / 2 && this.moveId < 0) {
      this.moveId = e.pointerId;
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = 'translate(0px, 0px)';
      this.stick.hidden = false;
    } else if (this.lookId < 0) {
      this.lookId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    } else return;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.moveId) {
      let dx = e.clientX - this.originX;
      let dy = e.clientY - this.originY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      this.stickX = dx / STICK_RADIUS;
      this.stickY = -dy / STICK_RADIUS;
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === this.lookId) {
      this.yaw -= (e.clientX - this.lastX) * LOOK_SPEED;
      this.pitch -= (e.clientY - this.lastY) * LOOK_SPEED;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.moveId) {
      this.moveId = -1;
      this.stickX = 0;
      this.stickY = 0;
      this.stick.hidden = true;
    } else if (e.pointerId === this.lookId) {
      this.lookId = -1;
    }
  };
}
