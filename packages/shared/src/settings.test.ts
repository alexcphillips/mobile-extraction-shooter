import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings } from './settings';

describe('settings', () => {
  it('has the design defaults', () => {
    const s = defaultSettings();
    expect(s.aim).toBe('hold');
    expect(s.fire).toBe('auto');
    expect(s.aimAssist).toBe('low');
    expect(s.layout).toEqual({});
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
      lookSensitivity: 99,
      invertY: true,
      layout: { fire: { x: 0.5, y: 0.5, scale: 1 }, aim: { x: 7 } },
    });
    expect(s.aim).toBe('hold');
    expect(s.lookSensitivity).toBe(1);
    expect(s.invertY).toBe(true);
    expect(s.layout).toEqual({ fire: { x: 0.5, y: 0.5, scale: 1 } });
  });

  it('gives the defaults for anything unreadable', () => {
    expect(loadSettings(null)).toEqual(defaultSettings());
    expect(loadSettings('nope')).toEqual(defaultSettings());
    expect(loadSettings({ formatVersion: 99 })).toEqual(defaultSettings());
  });
});
