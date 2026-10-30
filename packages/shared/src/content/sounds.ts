import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import type { ItemDb, ItemDef } from './items';
import { idSchema } from './schema';

/*
 * Sound files (content/sounds/<id>.json), from session 19: recipes the client renders into
 * sounds with its own synthesiser (audio/synth.ts), not recordings. A sound is layers of
 * noise or tones, each shaped by an envelope and an optional filter, mixed together.
 * Times are seconds, frequencies hertz. Items name the sounds they make (their `sounds`);
 * the game names the rest itself (audio/cues.ts lists them).
 */

export const SOUND_FORMAT_VERSION = 1;

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const nonNegative = finite.refine((n) => n >= 0, 'must be 0 or more');
const hertz = finite.refine((n) => n >= 20 && n <= 20_000, 'must be from 20 to 20,000 Hz');
/** A frequency that may glide: [start, end], reached after the layer's sweep. */
const glide = z.tuple([hertz, hertz]);

export const NOISE_COLOURS = ['white', 'pink', 'brown'] as const;
export const WAVES = ['sine', 'triangle', 'square', 'saw'] as const;
export const FILTERS = ['lowpass', 'highpass', 'bandpass'] as const;

const layerSchema = z.strictObject({
  /** noise: random hiss (white bright, pink softer, brown a rumble); tone: a wave. */
  source: z.enum(['noise', 'tone']),
  /** noise only. Defaults to white. */
  colour: z.enum(NOISE_COLOURS).optional(),
  /** tone only. Defaults to sine. */
  wave: z.enum(WAVES).optional(),
  /** tone only: its pitch. */
  freq: glide.optional(),
  /** When it starts, from the start of the sound. */
  at: nonNegative,
  /** Rising from silence to full. */
  attack: nonNegative,
  /** Staying at full. */
  hold: nonNegative,
  /** Falling from full to silence. */
  decay: nonNegative,
  /** How the decay falls: 1 straight, higher drops fast then tails off. Defaults to 1. */
  curve: finite.refine((n) => n >= 0.1 && n <= 10, 'must be from 0.1 to 10').optional(),
  gain: nonNegative,
  /** Soft clipping, for crunch: 0 (or left out) is clean, 1 a lot. */
  drive: finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1').optional(),
  filter: z
    .strictObject({
      type: z.enum(FILTERS),
      freq: glide,
      /** Resonance; 0.7 is flat. */
      q: finite.refine((n) => n >= 0.1 && n <= 30, 'must be from 0.1 to 30'),
    })
    .optional(),
  /** How long pitch and filter take to glide from start to end. Defaults to the whole layer. */
  sweep: nonNegative.optional(),
});

export const soundSchema = z
  .strictObject({
    formatVersion: z.literal(SOUND_FORMAT_VERSION),
    id: idSchema,
    name: z.string().min(1),
    /** The whole sound's loudness, on top of each layer's. */
    gain: nonNegative,
    /**
     * Played at a place, how far away it can be heard. Shots are heard as far as their
     * loudness instead, so a suppressor quietens them for players as it does for enemies.
     */
    range: finite.refine((n) => n > 0, 'must be greater than 0'),
    /** Each play is up to this much higher or lower in pitch (0.05 is 5%), for variety. */
    pitchJitter: finite.refine((n) => n >= 0 && n < 0.5, 'must be from 0 to 0.5'),
    layers: z.array(layerSchema).min(1),
  })
  .superRefine((s, ctx) => {
    s.layers.forEach((l, i) => {
      const path = ['layers', i];
      if (l.source === 'tone' && !l.freq)
        ctx.addIssue({ code: 'custom', message: 'a tone needs freq', path });
      if (l.source === 'noise' && (l.freq || l.wave))
        ctx.addIssue({ code: 'custom', message: 'noise has no freq or wave', path });
      if (l.source === 'tone' && l.colour)
        ctx.addIssue({ code: 'custom', message: 'a tone has no colour', path });
      if (l.attack + l.hold + l.decay === 0)
        ctx.addIssue({ code: 'custom', message: 'lasts no time: give it a hold or decay', path });
    });
  });

export type SoundDef = z.infer<typeof soundSchema>;
export type SoundLayer = z.infer<typeof layerSchema>;

export const SOUND_FORMAT: ContentFormat<SoundDef> = {
  kind: 'sound',
  version: SOUND_FORMAT_VERSION,
  schema: soundSchema,
  migrations: {},
};

/** Every sound by id. */
export type SoundDb = ReadonlyMap<string, SoundDef>;

/** How long a sound lasts: to the end of its last layer. */
export function soundLength(def: SoundDef): number {
  let end = 0;
  for (const l of def.layers) end = Math.max(end, l.at + l.attack + l.hold + l.decay);
  return end;
}

/** The sounds an item names, as "shot", "reload" and so on. */
export function itemSounds(item: ItemDef): Readonly<Record<string, string>> {
  return 'sounds' in item ? item.sounds : {};
}

/**
 * Checks every sound an item names exists, and every sound the game names itself
 * (`needed`).
 */
export function checkSounds(sounds: SoundDb, items: ItemDb, needed: readonly string[]): void {
  for (const item of items.values()) {
    for (const [use, id] of Object.entries(itemSounds(item))) {
      if (!sounds.has(id)) {
        throw new ContentError(
          `content/items/${item.id}.json`,
          `${use} sound "${id}" isn't a sound`,
        );
      }
    }
  }
  for (const id of needed) {
    if (!sounds.has(id)) throw new ContentError(`content/sounds/${id}.json`, 'the game needs it');
  }
}
