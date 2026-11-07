import { describe, expect, it } from 'vitest';
import { FAVOURITES_MAX, defaultSettings, loadSettings } from './settings';

describe('settings', () => {
  it('has the design defaults', () => {
    const s = defaultSettings();
    expect(s.aim).toBe('hold');
    expect(s.lean).toBe('toggle');
    expect(s.leanAim).toBe(false);
    expect(s.fire).toBe('auto');
    expect(s.aimAssist).toBe('low');
    expect(s.graphics).toBe('high');
    expect(s.layout).toEqual({});
  });

  it('keeps a graphics setting, and settings saved before it get high (2026-11-07)', () => {
    expect(loadSettings({ formatVersion: 1, graphics: 'low' }).graphics).toBe('low');
    expect(loadSettings({ formatVersion: 1 }).graphics).toBe('high');
    expect(loadSettings({ formatVersion: 1, graphics: 'ultra' }).graphics).toBe('high');
  });

  it('round-trips through JSON', () => {
    const s = defaultSettings();
    s.aim = 'toggle';
    s.lookSensitivity = 1.7;
    s.layout.fire = { x: 0.8, y: 0.7, scale: 1.2 };
    expect(loadSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('falls back field by field, keeping the valid ones', () => {
    const s = loadSettings({
      formatVersion: 1,
      aim: 'sideways',
      lean: 'wobbly',
      lookSensitivity: 99,
      invertY: true,
      layout: { fire: { x: 0.5, y: 0.5, scale: 1 }, aim: { x: 7 } },
    });
    expect(s.aim).toBe('hold');
    expect(s.lean).toBe('toggle');
    expect(s.lookSensitivity).toBe(1);
    expect(s.invertY).toBe(true);
    expect(s.layout).toEqual({ fire: { x: 0.5, y: 0.5, scale: 1 } });
  });

  it('gives the defaults for anything unreadable', () => {
    expect(loadSettings(null)).toEqual(defaultSettings());
    expect(loadSettings('nope')).toEqual(defaultSettings());
    expect(loadSettings({ formatVersion: 99 })).toEqual(defaultSettings());
  });

  it('keeps favourites once each, up to the most there can be', () => {
    expect(defaultSettings().favourites).toEqual([]);
    const s = loadSettings({ formatVersion: 1, favourites: ['gpu', 'gpu', 'ring'] });
    expect(s.favourites).toEqual(['gpu', 'ring']);
    const many = Array.from({ length: FAVOURITES_MAX + 5 }, (_, i) => `item-${i}`);
    expect(loadSettings({ formatVersion: 1, favourites: many }).favourites).toHaveLength(
      FAVOURITES_MAX,
    );
    // Not a list: none, and the rest of the settings kept.
    const bad = loadSettings({ formatVersion: 1, favourites: 'gpu', volume: 0.3 });
    expect(bad.favourites).toEqual([]);
    expect(bad.volume).toBe(0.3);
  });
});
