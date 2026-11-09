import { describe, expect, it } from 'vitest';
import {
  LOOK_CURVE,
  LOOK_DEAD_ZONE,
  MOVE_DEAD_ZONE,
  PAD,
  RIM_BOOST,
  RIM_RAMP,
  bit,
  createPadFrame,
  createPadState,
  firstPad,
  mapPad,
  readPad,
  shapeStick,
  type PadFrame,
  type PadState,
} from './gamepad';

/** Maps one frame from a fresh previous frame, or from `prev`. */
function frame(pad: PadState, prev: PadFrame = createPadFrame(), dt = 1 / 60): PadFrame {
  const out = createPadFrame();
  mapPad(pad, prev, dt, out);
  return out;
}

describe('shapeStick', () => {
  const out = [0, 0];

  it('reads nothing inside the dead zone, in any direction', () => {
    shapeStick(0.1, 0.1, 0.15, 1, out);
    expect(out).toEqual([0, 0]);
  });

  it('rescales the rest of the throw from 0 to 1', () => {
    shapeStick(0.15 + 0.85 / 2, 0, 0.15, 1, out);
    expect(out[0]).toBeCloseTo(0.5);
    shapeStick(0, -1, 0.15, 1, out);
    expect(out[1]).toBeCloseTo(-1);
  });

  it('is radial: a diagonal keeps its direction and length', () => {
    const d = Math.SQRT1_2;
    shapeStick(d, d, 0.15, 1, out);
    expect(out[0]).toBeCloseTo(d);
    expect(out[1]).toBeCloseTo(d);
  });

  it('clamps a stick that reads past its rim', () => {
    shapeStick(1, 1, 0.15, 1, out);
    expect(Math.hypot(out[0]!, out[1]!)).toBeCloseTo(1);
  });

  it('curves: half the throw is a quarter of the speed when squared', () => {
    shapeStick(0.1 + 0.9 / 2, 0, 0.1, 2, out);
    expect(out[0]).toBeCloseTo(0.25);
  });
});

describe('mapPad', () => {
  it('turns the browser’s down-positive left stick into forwards-positive move', () => {
    const pad = createPadState();
    pad.axes[1] = -1;
    const f = frame(pad);
    expect(f.moveY).toBeCloseTo(1);
    expect(f.moveX).toBe(0);
  });

  it('walks on a partial push and ignores drift', () => {
    const pad = createPadState();
    pad.axes[1] = -0.5;
    expect(frame(pad).moveY).toBeCloseTo((0.5 - MOVE_DEAD_ZONE) / (1 - MOVE_DEAD_ZONE));
    pad.axes[1] = -0.08;
    pad.axes[2] = 0.08;
    const f = frame(pad);
    expect(f.moveY).toBe(0);
    expect(f.lookX).toBe(0);
    expect(f.active).toBe(false);
  });

  it('curves the look stick and keeps y down-positive, as a mouse', () => {
    const pad = createPadState();
    pad.axes[3] = 0.6;
    const f = frame(pad);
    expect(f.lookY).toBeCloseTo(((0.6 - LOOK_DEAD_ZONE) / (1 - LOOK_DEAD_ZONE)) ** LOOK_CURVE);
    expect(f.boost).toBe(1);
  });

  it('ramps up turning while the look stick is held at its rim, and drops back off it', () => {
    const pad = createPadState();
    pad.axes[2] = 1;
    let f = frame(pad);
    for (let t = 0; t < RIM_RAMP * 2; t += 1 / 60) f = frame(pad, f);
    expect(f.boost).toBeCloseTo(1 + RIM_BOOST);
    const halfway = frame(pad, { ...createPadFrame(), rim: RIM_RAMP / 2 - 1 / 60 });
    expect(halfway.boost).toBeCloseTo(1 + RIM_BOOST / 2);
    pad.axes[2] = 0.8;
    f = frame(pad, f);
    expect(f.rim).toBe(0);
    expect(f.boost).toBe(1);
  });

  it('sees presses and releases once each', () => {
    const pad = createPadState();
    pad.buttons[PAD.cross] = 1;
    const down = frame(pad);
    expect(down.pressed).toBe(bit(PAD.cross));
    expect(down.held).toBe(bit(PAD.cross));
    const still = frame(pad, down);
    expect(still.pressed).toBe(0);
    expect(still.held).toBe(bit(PAD.cross));
    pad.buttons[PAD.cross] = 0;
    const up = frame(pad, still);
    expect(up.released).toBe(bit(PAD.cross));
    expect(up.held).toBe(0);
  });

  it('gives triggers some hysteresis, so a resting finger doesn’t flicker', () => {
    const pad = createPadState();
    pad.buttons[PAD.r2] = 0.4;
    let f = frame(pad);
    expect(f.held).toBe(0);
    pad.buttons[PAD.r2] = 0.6;
    f = frame(pad, f);
    expect(f.held).toBe(bit(PAD.r2));
    pad.buttons[PAD.r2] = 0.4;
    f = frame(pad, f);
    expect(f.held).toBe(bit(PAD.r2));
    pad.buttons[PAD.r2] = 0.2;
    f = frame(pad, f);
    expect(f.released).toBe(bit(PAD.r2));
  });

  it('counts the touchpad (button 17) as a button', () => {
    const pad = createPadState();
    pad.buttons[PAD.touchpad] = 1;
    const f = frame(pad);
    expect(f.pressed).toBe(bit(PAD.touchpad));
    expect(f.active).toBe(true);
  });

  it('takes the input mode only for a real push or a press', () => {
    const pad = createPadState();
    pad.axes[0] = 0.25;
    expect(frame(pad).active).toBe(false);
    pad.axes[0] = 0.5;
    expect(frame(pad).active).toBe(true);
  });
});

describe('reading pads', () => {
  const gamepad = (mapping: string, buttons: number, connected = true): Gamepad =>
    ({
      connected,
      mapping,
      axes: [0.5, -0.5, 0, 1],
      buttons: Array.from({ length: buttons }, (_, i) => ({ value: i === 0 ? 1 : 0 })),
    }) as unknown as Gamepad;

  it('picks the first connected pad in the standard mapping', () => {
    const standard = gamepad('standard', 17);
    expect(firstPad([null, gamepad('', 20), gamepad('standard', 17, false), standard])).toBe(
      standard,
    );
    expect(firstPad([gamepad('', 20)])).toBeNull();
  });

  it('reads a pad without a touchpad button as having it up', () => {
    const state = createPadState();
    state.buttons[PAD.touchpad] = 1;
    readPad(gamepad('standard', 17), state);
    expect(state.buttons[PAD.cross]).toBe(1);
    expect(state.buttons[PAD.touchpad]).toBe(0);
    expect([...state.axes]).toEqual([0.5, -0.5, 0, 1]);
  });
});
