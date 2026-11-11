import { describe, expect, it } from 'vitest';
import {
  FAVORITES_MAX,
  LAYOUT_SLOTS,
  defaultSettings,
  equippedLayout,
  loadSettings,
} from './settings';

describe('settings', () => {
  it('has the design defaults', () => {
    const s = defaultSettings();
    expect(s.aim).toBe('hold');
    expect(s.lean).toBe('toggle');
    expect(s.leanAim).toBe(false);
    expect(s.crouch).toBe('toggle');
    expect(s.fire).toBe('auto');
    expect(s.aimAssist).toBe('low');
    expect(s.graphics).toBe('high');
    expect(s.layouts).toHaveLength(LAYOUT_SLOTS);
    for (const l of s.layouts) expect(l).toEqual({ placements: {}, hidden: [] });
    expect(s.equippedLayout).toBe(0);
  });

  it('keeps a graphics setting, and settings saved before it get high (2026-11-07)', () => {
    expect(loadSettings({ formatVersion: 1, graphics: 'low' }).graphics).toBe('low');
    expect(loadSettings({ formatVersion: 1 }).graphics).toBe('high');
    expect(loadSettings({ formatVersion: 1, graphics: 'ultra' }).graphics).toBe('high');
  });

  it('keeps a crouch setting, and settings saved before it get toggle (2026-11-08)', () => {
    expect(loadSettings({ formatVersion: 1, crouch: 'hold' }).crouch).toBe('hold');
    expect(loadSettings({ formatVersion: 1 }).crouch).toBe('toggle');
    expect(loadSettings({ formatVersion: 1, crouch: 'squat' }).crouch).toBe('toggle');
  });

  it('round-trips through JSON', () => {
    const s = defaultSettings();
    s.aim = 'toggle';
    s.lookSensitivity = 1.7;
    s.layouts[1]!.placements.fire = { x: 0.8, y: 0.7, scale: 1.2 };
    s.layouts[1]!.hidden = ['grenade'];
    s.equippedLayout = 1;
    expect(loadSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('falls back field by field, keeping the valid ones', () => {
    const s = loadSettings({
      formatVersion: 1,
      aim: 'sideways',
      lean: 'wobbly',
      lookSensitivity: 99,
      padSensitivity: 0.1,
      rumble: 'yes',
      invertY: true,
      layouts: [{ placements: { fire: { x: 0.5, y: 0.5, scale: 1 }, aim: { x: 7 } } }, 5],
      equippedLayout: 3,
    });
    expect(s.aim).toBe('hold');
    expect(s.lean).toBe('toggle');
    expect(s.lookSensitivity).toBe(1);
    expect(s.padSensitivity).toBe(1);
    expect(s.rumble).toBe(true);
    expect(s.invertY).toBe(true);
    expect(s.layouts[0]!.placements).toEqual({ fire: { x: 0.5, y: 0.5, scale: 1 } });
    expect(s.layouts[1]).toEqual({ placements: {}, hidden: [] });
    expect(s.layouts).toHaveLength(LAYOUT_SLOTS);
    expect(s.equippedLayout).toBe(0);
  });

  it('moves a layout saved before UX-4 into the first slot, equipped', () => {
    const s = loadSettings({
      formatVersion: 1,
      volume: 0.4,
      layout: { fire: { x: 0.7, y: 0.6, scale: 1.3 } },
    });
    expect(equippedLayout(s)).toEqual({
      placements: { fire: { x: 0.7, y: 0.6, scale: 1.3 } },
      hidden: [],
    });
    expect(s.volume).toBe(0.4);
    expect('layout' in s).toBe(false);
    // Once there are slots, an old layout left over is ignored.
    const later = loadSettings({ formatVersion: 1, layout: { fire: {} }, layouts: [] });
    expect(later.layouts[0]!.placements).toEqual({});
  });

  it('gives the defaults for anything unreadable', () => {
    expect(loadSettings(null)).toEqual(defaultSettings());
    expect(loadSettings('nope')).toEqual(defaultSettings());
    expect(loadSettings({ formatVersion: 99 })).toEqual(defaultSettings());
  });

  it('keeps favorites once each, up to the most there can be', () => {
    expect(defaultSettings().favorites).toEqual([]);
    const s = loadSettings({ formatVersion: 1, favorites: ['gpu', 'gpu', 'ring'] });
    expect(s.favorites).toEqual(['gpu', 'ring']);
    const many = Array.from({ length: FAVORITES_MAX + 5 }, (_, i) => `item-${i}`);
    expect(loadSettings({ formatVersion: 1, favorites: many }).favorites).toHaveLength(
      FAVORITES_MAX,
    );
    // Not a list: none, and the rest of the settings kept.
    const bad = loadSettings({ formatVersion: 1, favorites: 'gpu', volume: 0.3 });
    expect(bad.favorites).toEqual([]);
    expect(bad.volume).toBe(0.3);
  });
});
