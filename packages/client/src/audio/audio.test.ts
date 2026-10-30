import {
  CollisionWorld,
  SOUND_FORMAT_VERSION,
  createState,
  giveWeapon,
  heldWeapon,
  soundLength,
  spawnCharacter,
  weaponDef,
  type SimEvent,
  type SoundDef,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadItems, loadSounds } from '../content';
import { SoundCues } from './cues';
import { GAME_SOUNDS } from './sound-ids';
import type { PlaceOptions, SoundPlayer } from './sounds';
import { place, type Placement } from './spatial';
import { envelope, renderSound } from './synth';

const RATE = 8000;

function sound(layers: SoundDef['layers']): SoundDef {
  return {
    formatVersion: SOUND_FORMAT_VERSION,
    id: 's',
    name: 'S',
    gain: 1,
    range: 10,
    pitchJitter: 0,
    layers,
  };
}

const beep = (patch: Partial<SoundDef['layers'][number]> = {}): SoundDef['layers'][number] => ({
  source: 'tone',
  freq: [1000, 1000],
  at: 0,
  attack: 0,
  hold: 0.1,
  decay: 0,
  gain: 0.5,
  ...patch,
});

/** How often the samples change sign per second: about twice the main frequency. */
function crossings(s: Float32Array): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i - 1]! < 0 !== s[i]! < 0) n++;
  return (n / s.length) * RATE;
}

describe('synth', () => {
  it('renders a layer where and as long as it says, the same each time', () => {
    const { samples } = renderSound(sound([beep({ at: 0.1 })]), RATE);
    expect(samples.length).toBe(Math.ceil((0.2 + 0.02) * RATE));
    expect(samples.slice(0, 0.1 * RATE).every((s) => s === 0)).toBe(true);
    expect(Math.max(...samples.slice(0.1 * RATE, 0.2 * RATE))).toBeCloseTo(0.5, 2);
    expect(crossings(samples.slice(0.1 * RATE, 0.2 * RATE))).toBeCloseTo(2000, -2);
    const noise = sound([{ source: 'noise', at: 0, attack: 0, hold: 0.1, decay: 0, gain: 1 }]);
    expect(renderSound(noise, RATE).samples).toEqual(renderSound(noise, RATE).samples);
    expect(renderSound(noise, RATE, 2).samples).not.toEqual(renderSound(noise, RATE).samples);
  });

  it('shapes layers with envelopes, glides and filters, and limits the peak', () => {
    expect(envelope(0.05, 0.1, 0, 0.1, 1)).toBeCloseTo(0.5);
    expect(envelope(0.15, 0.1, 0, 0.1, 1)).toBeCloseTo(0.5);
    expect(envelope(0.15, 0.1, 0, 0.1, 2)).toBeCloseTo(0.25);
    expect(envelope(0.25, 0.1, 0, 0.1, 1)).toBe(0);
    // A glide down an octave: fewer crossings at the end than the start.
    const glide = renderSound(sound([beep({ freq: [1000, 500], hold: 0.2 })]), RATE).samples;
    expect(crossings(glide.slice(0, 400))).toBeGreaterThan(
      crossings(glide.slice(1200, 1600)) * 1.6,
    );
    // A lowpass takes the hiss out of white noise.
    const white = { source: 'noise' as const, at: 0, attack: 0, hold: 0.2, decay: 0, gain: 0.5 };
    const muffled = {
      ...white,
      filter: { type: 'lowpass' as const, freq: [300, 300] as [number, number], q: 0.7 },
    };
    expect(crossings(renderSound(sound([muffled]), RATE).samples)).toBeLessThan(
      crossings(renderSound(sound([white]), RATE).samples) / 3,
    );
    // Too loud is turned down to fit, and says how loud it was.
    const loud = renderSound(sound([beep({ gain: 2 })]), RATE);
    expect(loud.peak).toBeCloseTo(2, 2);
    expect(Math.max(...loud.samples)).toBeLessThanOrEqual(1);
  });

  it('renders every sound in content/ without being turned down much', () => {
    for (const def of loadSounds().values()) {
      const { samples, peak } = renderSound(def, 44100);
      expect(samples.length, def.id).toBeGreaterThanOrEqual(soundLength(def) * 44100);
      expect(peak, def.id).toBeGreaterThan(0.05);
      expect(peak, def.id).toBeLessThan(1.5);
    }
  });
});

describe('spatial', () => {
  const at: Placement = { gain: 0, pan: 0, cutoff: 0 };
  const facingNorth = { x: 0, y: 0, z: 0, yaw: 0 };

  it('is quieter and duller further away, and silent out of range', () => {
    place(at, facingNorth, 0, 0, -5, 100, false);
    const near = { ...at };
    place(at, facingNorth, 0, 0, -50, 100, false);
    expect(at.gain).toBeLessThan(near.gain / 4);
    expect(at.cutoff).toBeLessThan(near.cutoff);
    expect(place(at, facingNorth, 0, 0, -100, 100, false)).toBe(false);
  });

  it('pans by direction, turning with the listener, and muffles behind and through walls', () => {
    place(at, facingNorth, 10, 0, 0, 100, false);
    expect(at.pan).toBeCloseTo(0.8);
    // Turned left a quarter (facing −x), what's north is on the right.
    place(at, { ...facingNorth, yaw: Math.PI / 2 }, 0, 0, -10, 100, false);
    expect(at.pan).toBeCloseTo(0.8);
    place(at, facingNorth, 0, 0, -10, 100, false);
    const ahead = { ...at };
    place(at, facingNorth, 0, 0, 10, 100, false);
    expect(at.pan).toBeCloseTo(0);
    expect(at.cutoff).toBeLessThan(ahead.cutoff);
    expect(at.gain).toBeLessThan(ahead.gain);
    place(at, facingNorth, 0, 0, -10, 100, true);
    expect(at.cutoff).toBeLessThanOrEqual(600);
    expect(at.gain).toBeLessThan(ahead.gain / 2);
  });
});

describe('sound cues', () => {
  const items = loadItems();

  function setup(boxes: ConstructorParameters<typeof CollisionWorld>[0]['boxes'] = []) {
    const world = new CollisionWorld({
      terrain: {
        minX: -50,
        minZ: -50,
        cellSize: 2,
        cols: 50,
        rows: 50,
        heights: Array(51 * 51).fill(0),
      },
      boxes,
      ramps: [],
      ladders: [],
    });
    const sim = createState(1);
    const player = spawnCharacter(sim, world, 0, 0);
    const enemy = spawnCharacter(sim, world, 0, -20, 0, Infinity, false);
    const played: { id: string; at: boolean; options?: PlaceOptions }[] = [];
    const player_: Pick<SoundPlayer, 'listener' | 'play' | 'playAt'> = {
      listener: { x: 0, y: 0, z: 0, yaw: 0 },
      play: (id) => played.push({ id, at: false }),
      playAt: (id, _x, _y, _z, options) => played.push({ id, at: true, options: { ...options } }),
    };
    const cues = new SoundCues(player_ as SoundPlayer, world, items);
    return { sim, player, enemy, played, cues };
  }

  it('steps in time with walking: yours centred and quieter, none standing still', () => {
    const { sim, player, played, cues } = setup();
    for (let i = 0; i < 30; i++) cues.tick(sim, player, 0);
    expect(played).toEqual([]);
    player.vz = -3.5;
    for (let i = 0; i < 60; i++) cues.tick(sim, player, 0);
    const steps = played.filter((p) => p.id === GAME_SOUNDS.footstep);
    // 7 m at 3.5 m/s, a step every 1.45 m, the first 0.9 m after setting off.
    expect(steps.length).toBe(5);
    expect(steps.every((s) => !s.at)).toBe(true);
  });

  it("plays a shot from where it was, suppressed when it's quieter than the gun", () => {
    const { sim, player, enemy, played, cues } = setup();
    giveWeapon(enemy, items, 'pistol', []);
    const def = weaponDef(items, 'pistol');
    const shot = (loudness: number): SimEvent => ({
      type: 'shot',
      by: enemy.id,
      fromX: 0,
      fromY: 1.6,
      fromZ: -20,
      toX: 0.5,
      toY: 1.6,
      toZ: 20,
      hit: 'world',
      target: 0,
      loudness,
      pellet: 0,
    });
    sim.events = [shot(def.loudness), shot(def.loudness * 0.3)];
    cues.tick(sim, player, 0);
    expect(played.map((p) => p.id)).toEqual([
      def.sounds.shot,
      GAME_SOUNDS.whizz,
      GAME_SOUNDS.impactWorld,
      def.sounds.suppressed,
      GAME_SOUNDS.whizz,
      GAME_SOUNDS.impactWorld,
    ]);
    // Heard as far as the shot's loudness.
    expect(played[3]!.options?.range).toBeCloseTo(def.loudness * 0.3);
  });

  it('plays a reload as it starts, once, muffled behind a wall', () => {
    const wall = { x: 0, y: 2, z: -10.5, hx: 5, hy: 2, hz: 0.5, yaw: 0 };
    const { sim, player, enemy, played, cues } = setup([wall]);
    giveWeapon(enemy, items, 'pistol', []);
    heldWeapon(enemy)!.reloading = 1;
    for (let i = 0; i < 5; i++) cues.tick(sim, player, 0);
    expect(played).toEqual([
      { id: weaponDef(items, 'pistol').sounds.reload, at: true, options: { occluded: true } },
    ]);
  });
});
