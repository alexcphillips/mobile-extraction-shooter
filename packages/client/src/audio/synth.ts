import { createRng, nextFloat, soundLength, type SoundDef, type SoundLayer } from '@mes/shared';

/*
 * Renders a sound file's recipe (session 19) into samples, in plain TypeScript rather than
 * Web Audio nodes: once per sound, so playing one costs a buffer source, and the same in
 * a test as on the phone. Mono; the player places it.
 */

/** Filter coefficients are worked out again every this many samples while gliding. */
const BLOCK = 32;

export interface Rendered {
  samples: Float32Array<ArrayBuffer>;
  /** The loudest sample before limiting; above 1, the whole sound was turned down to fit. */
  peak: number;
}

/** Renders a sound at a sample rate. The same seed gives the same noise. */
export function renderSound(def: SoundDef, sampleRate: number, seed = 1): Rendered {
  // A short tail, so a filter's ring doesn't stop dead.
  const out = new Float32Array(Math.ceil((soundLength(def) + 0.02) * sampleRate));
  const rng = createRng(seed);
  for (const layer of def.layers) addLayer(out, layer, def.gain, sampleRate, () => nextFloat(rng));
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  if (peak > 1) for (let i = 0; i < out.length; i++) out[i]! /= peak;
  return { samples: out, peak };
}

function addLayer(
  out: Float32Array,
  l: SoundLayer,
  gain: number,
  rate: number,
  random: () => number,
): void {
  const length = l.attack + l.hold + l.decay;
  const start = Math.round(l.at * rate);
  const n = Math.min(out.length - start, Math.ceil(length * rate));
  const sweep = l.sweep ?? length;
  const curve = l.curve ?? 1;
  const drive = l.drive ? 1 + l.drive * 9 : 0;
  const driveNorm = drive ? Math.tanh(drive) : 1;
  const filter = l.filter ? new Biquad() : null;
  const noise = l.source === 'noise' ? noiseSource(l.colour ?? 'white', random) : null;
  const wave = l.wave ?? 'sine';
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // How far through the glide, 0 to 1.
    const g = sweep > 0 ? Math.min(1, t / sweep) : 1;
    let s: number;
    if (noise) s = noise();
    else {
      const [f0, f1] = l.freq!;
      phase += glideAt(f0, f1, g) / rate;
      phase -= Math.floor(phase);
      s = waveAt(wave, phase);
    }
    if (filter && i % BLOCK === 0) {
      const f = l.filter!;
      filter.set(f.type, glideAt(f.freq[0], f.freq[1], g), f.q, rate);
    }
    if (filter) s = filter.run(s);
    s *= envelope(t, l.attack, l.hold, l.decay, curve) * l.gain;
    if (drive) s = Math.tanh(s * drive) / driveNorm;
    out[start + i]! += s * gain;
  }
}

/** Exponential, so a glide sounds even across octaves. */
function glideAt(from: number, to: number, g: number): number {
  return from * Math.pow(to / from, g);
}

function waveAt(wave: NonNullable<SoundLayer['wave']>, phase: number): number {
  switch (wave) {
    case 'sine':
      return Math.sin(phase * 2 * Math.PI);
    case 'triangle':
      return 1 - 4 * Math.abs(phase - 0.5);
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * phase - 1;
  }
}

export function envelope(
  t: number,
  attack: number,
  hold: number,
  decay: number,
  curve: number,
): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  t -= attack;
  if (t < hold) return 1;
  t -= hold;
  if (t >= decay) return 0;
  return Math.pow(1 - t / decay, curve);
}

/**
 * White noise from the rng, or pink (Paul Kellett's economy filter) or brown (leaky
 * integration), each scaled to about the same loudness as white.
 */
function noiseSource(colour: 'white' | 'pink' | 'brown', random: () => number): () => number {
  if (colour === 'white') return () => random() * 2 - 1;
  if (colour === 'pink') {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    return () => {
      const w = random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      return (b0 + b1 + b2 + w * 0.1848) * 0.25;
    };
  }
  let b = 0;
  return () => {
    b = (b + 0.02 * (random() * 2 - 1)) / 1.02;
    return b * 3.5;
  };
}

/** A biquad filter (Robert Bristow-Johnson's cookbook), bandpass at 0 dB peak. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  set(type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q: number, rate: number): void {
    const w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'lowpass') {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else if (type === 'highpass') {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}
