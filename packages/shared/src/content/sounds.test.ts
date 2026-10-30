import { describe, expect, it } from 'vitest';
import { TEST_ITEMS } from '../sim/test-items';
import { ContentError, loadContent } from './format';
import {
  SOUND_FORMAT,
  SOUND_FORMAT_VERSION,
  checkSounds,
  soundLength,
  type SoundDef,
} from './sounds';

const click = {
  formatVersion: SOUND_FORMAT_VERSION,
  id: 'click',
  name: 'Click',
  gain: 1,
  range: 10,
  pitchJitter: 0.05,
  layers: [
    { source: 'noise', at: 0, attack: 0.001, hold: 0, decay: 0.02, gain: 0.5 },
    { source: 'tone', freq: [800, 600], at: 0.05, attack: 0, hold: 0.1, decay: 0.2, gain: 0.3 },
  ],
};

const load = (raw: object): SoundDef => loadContent(SOUND_FORMAT, raw, 'click.json');
const layer = (patch: object) => ({ ...click, layers: [{ ...click.layers[0], ...patch }] });

describe('sounds', () => {
  it('loads a recipe and works out how long it lasts', () => {
    expect(soundLength(load(click))).toBeCloseTo(0.35);
  });

  it('rejects layers that make no sense', () => {
    // A tone needs a pitch, noise has none, and every layer must last some time.
    expect(() => load(layer({ source: 'tone' }))).toThrow(/a tone needs freq/);
    expect(() => load(layer({ freq: [100, 100] }))).toThrow(/noise has no freq/);
    expect(() => load(layer({ source: 'tone', freq: [100, 100], colour: 'pink' }))).toThrow(
      /a tone has no colour/,
    );
    expect(() => load(layer({ attack: 0, decay: 0 }))).toThrow(/lasts no time/);
    expect(() => load(layer({ filter: { type: 'lowpass', freq: [10, 100], q: 1 } }))).toThrow(
      /20 to 20,000/,
    );
    expect(() => load({ ...click, layers: [] })).toThrow(ContentError);
  });

  it('checks the sounds items and the game name are there', () => {
    const named = new Set<string>();
    for (const item of TEST_ITEMS.values()) {
      if ('sounds' in item) for (const id of Object.values(item.sounds)) named.add(id);
    }
    const sounds = new Map([...named, 'footstep'].map((id) => [id, load({ ...click, id })]));
    expect(() => checkSounds(sounds, TEST_ITEMS, ['footstep'])).not.toThrow();
    sounds.delete('pistol-reload');
    expect(() => checkSounds(sounds, TEST_ITEMS, [])).toThrow(
      'content/items/pistol.json: reload sound "pistol-reload" isn\'t a sound',
    );
    expect(() => checkSounds(new Map(), new Map(), ['footstep'])).toThrow(
      'content/sounds/footstep.json: the game needs it',
    );
  });
});
