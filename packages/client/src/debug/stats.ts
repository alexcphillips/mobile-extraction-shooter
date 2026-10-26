import * as THREE from 'three';

const REPORT_MS = 500;
const JANK_MS = 20; // a frame slower than this missed a 60 Hz vsync
const JANK_WINDOW_MS = 10_000;

/** FPS counter and timings, written straight to the DOM twice a second. */
export class Stats {
  private frames = 0;
  private frameSum = 0;
  private frameMax = 0;
  private cpuSum = 0;
  private tickSum = 0;
  private ticks = 0;
  private windowStart = -1;
  private janks = 0;
  /** Janks in the current and the previous 10 s window, to tell recent hitches from old ones. */
  private janksNow = 0;
  private janksPrev = 0;
  private jankWindowStart = 0;
  private readonly started = performance.now();

  constructor(
    private readonly el: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly header: string,
    /** Extra text, built only when a report is written. */
    private readonly extra: () => string,
  ) {}

  /** dt: time since the previous frame; cpu: time spent in this frame's update and render. */
  frame(now: number, dtMs: number, cpuMs: number): void {
    this.frames++;
    this.frameSum += dtMs;
    if (dtMs > this.frameMax) this.frameMax = dtMs;
    // Ignore the first seconds while shaders compile.
    if (dtMs > JANK_MS && now - this.started > 3000) {
      this.janks++;
      this.janksNow++;
    }
    if (now - this.jankWindowStart >= JANK_WINDOW_MS) {
      this.janksPrev = this.janksNow;
      this.janksNow = 0;
      this.jankWindowStart = now;
    }
    this.cpuSum += cpuMs;
    if (this.windowStart < 0) this.windowStart = now;
    if (now - this.windowStart < REPORT_MS) return;

    const fps = (this.frames * 1000) / (now - this.windowStart);
    const info = this.renderer.info.render;
    const size = this.renderer.getDrawingBufferSize(scratch);
    const tick = this.ticks ? this.tickSum / this.ticks : 0;
    this.el.textContent =
      `${fps.toFixed(0)} fps  frame ${(this.frameSum / this.frames).toFixed(1)} avg / ${this.frameMax.toFixed(1)} max ms\n` +
      `janks ${this.janks} total, ${this.janksPrev} in the last 10 s\n` +
      `cpu ${(this.cpuSum / this.frames).toFixed(2)} ms/frame  tick ${tick.toFixed(2)} ms  ` +
      `draws ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  ${size.x}×${size.y}\n` +
      `${this.header}\n${this.extra()}`;
    this.frames = 0;
    this.frameSum = 0;
    this.frameMax = 0;
    this.cpuSum = 0;
    this.tickSum = 0;
    this.ticks = 0;
    this.windowStart = now;
  }

  tick(ms: number): void {
    this.tickSum += ms;
    this.ticks++;
  }
}

const scratch = new THREE.Vector2();
