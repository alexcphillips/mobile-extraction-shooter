import type { SoundDb } from '@mes/shared';
import { audio } from '../app/audio';
import { loadSounds } from '../content';
import { settings } from '../settings';
import { place, SPATIAL, type Listener, type Placement } from './spatial';
import { renderSound } from './synth';

/** The most sounds playing at once; past it, the quietest gives way to a louder one. */
const MAX_VOICES = 16;
/** The same sound started again this soon (seconds) is left out: it would only be louder. */
const REPEAT_GAP = 0.02;
/** Quieter than this isn't worth a voice. */
const SILENT = 0.005;

interface Voice {
  id: string;
  started: number;
  end: number;
  gain: number;
  source: AudioBufferSourceNode | null;
}

export interface PlaceOptions {
  /** How far it carries; the sound file's range if left out. */
  range?: number | undefined;
  /** Multiplies its loudness. */
  gain?: number | undefined;
  /** Something solid is between it and the player. */
  occluded?: boolean;
}

/**
 * Plays the sound files (session 19). Each is rendered by the synthesiser the first time
 * it plays (or by prepare), then played as a buffer through a lowpass filter, a stereo
 * panner and a gain, which `place` sets from where it is. Silent until the first tap has
 * unlocked audio.
 */
export class SoundPlayer {
  /** Where the player hears from; the raid moves it every frame. */
  readonly listener: Listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices: Voice[] = Array.from({ length: MAX_VOICES }, () => ({
    id: '',
    started: 0,
    end: 0,
    gain: 0,
    source: null,
  }));
  private master: GainNode | null = null;
  private volume = 1;
  private readonly at: Placement = { gain: 1, pan: 0, cutoff: SPATIAL.open };

  constructor(private defs: SoundDb) {}

  /** Swaps in other sound files (the sound editor's, as edited). */
  setSounds(defs: SoundDb): void {
    this.defs = defs;
    this.buffers.clear();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  /** Renders every sound now, so none renders the first time it's heard in a raid. */
  prepare(): void {
    const ctx = audio();
    if (ctx) for (const id of this.defs.keys()) this.buffer(ctx, id);
  }

  /** Plays a sound as it is, centred: the player's own, and the HUD's and menus'. */
  play(id: string, gain = 1): void {
    const at = this.at;
    at.gain = gain;
    at.pan = 0;
    at.cutoff = SPATIAL.open;
    this.start(id);
  }

  /** Plays a sound at a place in the world, heard from the listener. */
  playAt(id: string, x: number, y: number, z: number, options?: PlaceOptions): void {
    const def = this.defs.get(id);
    if (!def) return;
    const range = options?.range ?? def.range;
    if (!place(this.at, this.listener, x, y, z, range, options?.occluded ?? false)) return;
    this.at.gain *= options?.gain ?? 1;
    this.start(id);
  }

  private start(id: string): void {
    const ctx = audio();
    const def = this.defs.get(id);
    if (!ctx || !def || this.at.gain < SILENT) return;
    const buffer = this.buffer(ctx, id);
    const now = ctx.currentTime;
    const { gain, pan, cutoff } = this.at;
    let free = -1;
    let quietest = -1;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!;
      if (v.end <= now) {
        if (free < 0) free = i;
        continue;
      }
      if (v.id === id && now - v.started < REPEAT_GAP) return;
      if (quietest < 0 || v.gain < this.voices[quietest]!.gain) quietest = i;
    }
    if (free < 0) {
      const q = this.voices[quietest]!;
      if (gain <= q.gain) return;
      q.source?.stop();
      free = quietest;
    }

    const master = this.masterOf(ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const rate = 1 + (Math.random() * 2 - 1) * def.pitchJitter;
    source.playbackRate.value = rate;
    const out = ctx.createGain();
    out.gain.value = gain;
    let tail: AudioNode = source;
    if (cutoff < SPATIAL.open) {
      const filter = ctx.createBiquadFilter();
      filter.frequency.value = cutoff;
      tail.connect(filter);
      tail = filter;
    }
    if (pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      tail.connect(panner);
      tail = panner;
    }
    tail.connect(out);
    out.connect(master);
    source.onended = () => out.disconnect();
    source.start();

    const v = this.voices[free]!;
    v.id = id;
    v.started = now;
    v.end = now + buffer.duration / rate;
    v.gain = gain;
    v.source = source;
  }

  private buffer(ctx: AudioContext, id: string): AudioBuffer {
    let buffer = this.buffers.get(id);
    if (!buffer) {
      const { samples } = renderSound(this.defs.get(id)!, ctx.sampleRate);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(id, buffer);
    }
    return buffer;
  }

  private masterOf(ctx: AudioContext): GainNode {
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
    }
    return this.master;
  }
}

let player: SoundPlayer | undefined;

/** The game's sound player, at the volume in settings. */
export function sounds(): SoundPlayer {
  if (!player) {
    const p = new SoundPlayer(loadSounds());
    p.setVolume(settings.current.volume);
    settings.subscribe((s) => p.setVolume(s.volume));
    player = p;
  }
  return player;
}
