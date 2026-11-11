/*
 * A gamepad in the browser's standard mapping (CP-1, 2026-11-08), read once a frame. The
 * reading and shaping here are plain functions over plain data, with nothing allocated per
 * frame, so they can be unit-tested; `pad-driver.ts` turns what they find into `Controls`.
 * Laid out for a PS4 pad (DualShock 4), but any pad in the standard mapping works: only
 * the names of the buttons differ.
 */

/** Button indices in the standard mapping, by their DualShock 4 names. */
export const PAD = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  /** Share takes screenshots on macOS (System Settings → Game Controllers): not used. */
  share: 8,
  options: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  /** The PS button belongs to the OS: not used. */
  ps: 16,
  /** Touchpad click: Chrome gives it index 17, past the standard 17 buttons. */
  touchpad: 17,
} as const;

export type PadButton = (typeof PAD)[keyof typeof PAD];

export const PAD_BUTTONS = 18;

/** A button (or trigger) counts as down past this, and up again under RELEASE. */
const PRESS = 0.5;
const RELEASE = 0.3;
/** Radial dead zones, as a fraction of the stick's throw. DS4 sticks drift about 0.05. */
export const MOVE_DEAD_ZONE = 0.15;
export const LOOK_DEAD_ZONE = 0.12;
/** Look speed rises as the push to this power (about squared: fine aim near the middle). */
export const LOOK_CURVE = 2;
/** At the rim, turning speeds up by this much more, reached over RIM_RAMP seconds. */
export const RIM_BOOST = 0.8;
export const RIM_RAMP = 0.3;
/** How far out counts as the rim, before the dead zone. */
const RIM = 0.97;
/** A stick pushed this far (raw) takes the input mode, so drift never does. */
const WAKE = 0.35;

/** One pad's buttons and sticks, copied out of the browser's Gamepad. */
export interface PadState {
  readonly buttons: Float32Array;
  /** Left x, left y, right x, right y; y is positive downwards, as the browser gives it. */
  readonly axes: Float32Array;
}

export function createPadState(): PadState {
  return { buttons: new Float32Array(PAD_BUTTONS), axes: new Float32Array(4) };
}

/** Copies a browser Gamepad into `out` (missing buttons and axes read 0). */
export function readPad(gp: Gamepad, out: PadState): void {
  for (let i = 0; i < PAD_BUTTONS; i++) out.buttons[i] = gp.buttons[i]?.value ?? 0;
  for (let i = 0; i < 4; i++) out.axes[i] = gp.axes[i] ?? 0;
}

/** What a frame of the pad means: buttons as bit masks by index, sticks shaped. */
export interface PadFrame {
  /** Buttons down now. */
  held: number;
  /** Went down since the last frame. */
  pressed: number;
  /** Came up since the last frame. */
  released: number;
  /** Move, −1..1 per axis after the dead zone; y is forwards (the browser's up). */
  moveX: number;
  moveY: number;
  /** Turn rate, −1..1 per axis before the rim boost; y is positive downwards, as a mouse. */
  lookX: number;
  lookY: number;
  /** Multiplies the look rate: 1, rising to 1 + RIM_BOOST while held at the rim. */
  boost: number;
  /** Seconds the look stick has been held at its rim. */
  rim: number;
  /** A button or stick moved enough to say the player is using the pad. */
  active: boolean;
}

export function createPadFrame(): PadFrame {
  return {
    held: 0,
    pressed: 0,
    released: 0,
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    boost: 1,
    rim: 0,
    active: false,
  };
}

export const bit = (b: PadButton): number => 1 << b;

/**
 * A radial dead zone with the rest of the throw rescaled to 0..1, raised to `curve`.
 * Writes the shaped x and y to `out[0]` and `out[1]`; returns the raw length.
 */
export function shapeStick(
  x: number,
  y: number,
  deadZone: number,
  curve: number,
  out: Float32Array | number[],
): number {
  const len = Math.hypot(x, y);
  if (len <= deadZone) {
    out[0] = out[1] = 0;
    return len;
  }
  const m = Math.min(1, (len - deadZone) / (1 - deadZone)) ** curve;
  out[0] = (x / len) * m;
  out[1] = (y / len) * m;
  return len;
}

const shaped = new Float32Array(2);

/**
 * Works out one frame from the pad's state and the last frame (`prev`, untouched), `dt`
 * seconds later, into `out`. Buttons have a little hysteresis, so an analog trigger
 * resting near halfway doesn't flicker.
 */
export function mapPad(pad: PadState, prev: PadFrame, dt: number, out: PadFrame): void {
  let held = 0;
  let active = false;
  for (let i = 0; i < PAD_BUTTONS; i++) {
    const v = pad.buttons[i]!;
    const was = (prev.held >> i) & 1;
    if (v > (was ? RELEASE : PRESS)) held |= 1 << i;
    if (v > PRESS) active = true;
  }
  out.held = held;
  out.pressed = held & ~prev.held;
  out.released = prev.held & ~held;

  const a = pad.axes;
  const moveLen = shapeStick(a[0]!, a[1]!, MOVE_DEAD_ZONE, 1, shaped);
  out.moveX = shaped[0]!;
  out.moveY = 0 - shaped[1]!; // not -0 at rest
  const lookLen = shapeStick(a[2]!, a[3]!, LOOK_DEAD_ZONE, LOOK_CURVE, shaped);
  out.lookX = shaped[0]!;
  out.lookY = shaped[1]!;
  out.rim = lookLen >= RIM ? prev.rim + dt : 0;
  out.boost = 1 + RIM_BOOST * Math.min(1, out.rim / RIM_RAMP);
  out.active = active || moveLen > WAKE || lookLen > WAKE;
}

/** The first connected pad in the standard mapping, or null. */
export function firstPad(pads: readonly (Gamepad | null)[]): Gamepad | null {
  for (const gp of pads) if (gp?.connected && gp.mapping === 'standard') return gp;
  return null;
}
