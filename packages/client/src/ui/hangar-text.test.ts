import type { Profile, ProfileResponse } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadHangar } from '../content';
import { hangarLine } from './hangar-text';

describe('the Hangar page (H3)', () => {
  it('loads the modules in order', () => {
    const modules = [...loadHangar().values()];
    expect(modules[0]!.id).toBe('power-grid');
    const orders = modules.map((m) => m.order ?? 0);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('counts the modules built', () => {
    const profile = { hangar: { 'power-grid': 1 } } as unknown as Profile;
    const me = { profile, now: 0 } as ProfileResponse;
    expect(hangarLine([...loadHangar().values()], me)).toBe('1 of 3 modules built');
  });
});
