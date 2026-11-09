import { describe, expect, it } from 'vitest';
import { padLayout } from './pad-labels';

describe('padLayout', () => {
  it('names every button the game uses once, and not Share or PS', () => {
    const keys = padLayout({ aim: 'hold', crouch: 'toggle', lean: 'toggle' }).flatMap(
      (r) => r.keys,
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'Options', 'Touchpad'])
      expect(keys).toContain(k);
    for (const k of ['D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →']) expect(keys).toContain(k);
    expect(keys.join()).not.toMatch(/Share|PS/);
  });

  it('words aim, crouch and lean for the settings', () => {
    const row = (s: Parameters<typeof padLayout>[0], key: string): string =>
      padLayout(s).find((r) => r.keys.includes(key))!.raid;
    const toggles = { aim: 'toggle', crouch: 'toggle', lean: 'toggle' } as const;
    const holds = { aim: 'hold', crouch: 'hold', lean: 'hold' } as const;
    expect(row(toggles, 'L2')).toMatch(/again/);
    expect(row(holds, 'L2')).toMatch(/held/);
    expect(row(toggles, '○')).toMatch(/held: prone/);
    expect(row(holds, '○')).toMatch(/double-tap: prone/);
    expect(row(holds, 'D-pad ←')).toMatch(/held/);
  });
});
