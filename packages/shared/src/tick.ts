/** Simulation ticks per second. The renderer interpolates between ticks. */
export const TICK_RATE = 30;

export const TICK_SECONDS = 1 / TICK_RATE;

/**
 * Turns variable frame times into whole fixed ticks. Call `advance` once per frame with the
 * frame's duration; it runs `tick` as many times as are due and returns how far (0..1) the
 * frame is between the last tick and the next, for interpolation.
 */
export class FixedTimestep {
  private acc = 0;

  /** maxFrame caps one frame's time, so a backgrounded tab doesn't run thousands of ticks on return. */
  constructor(private readonly maxFrame = 0.25) {}

  advance(dtSeconds: number, tick: () => void): number {
    this.acc += Math.min(Math.max(dtSeconds, 0), this.maxFrame);
    while (this.acc >= TICK_SECONDS) {
      tick();
      this.acc -= TICK_SECONDS;
    }
    return this.acc / TICK_SECONDS;
  }
}
