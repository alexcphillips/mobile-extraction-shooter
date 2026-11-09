import { describe, expect, it, vi } from 'vitest';
import { BLAST_FELT, Rumbler, blastPulse, firePulse, hitPulse, type Pulse } from './rumble';

const pulse = (): Pulse => ({ strong: 0, weak: 0, ms: 0 });

function fakePad(): { gp: Gamepad; playEffect: ReturnType<typeof vi.fn> } {
  const playEffect = vi.fn(() => Promise.resolve('complete'));
  return { gp: { vibrationActuator: { playEffect } } as unknown as Gamepad, playEffect };
}

describe('pulse sizes', () => {
  it('fires harder with a harder-kicking gun, and stays short', () => {
    const smg = { ...firePulse(0.9, pulse()) };
    const shotgun = { ...firePulse(5.9, pulse()) };
    expect(shotgun.strong).toBeGreaterThan(smg.strong);
    expect(shotgun.ms).toBeGreaterThan(smg.ms);
    // Full auto at 10 rounds a second still feels like separate shots.
    expect(shotgun.ms).toBeLessThan(100);
    expect(smg.strong).toBeGreaterThan(0.2);
    expect(firePulse(10, pulse()).strong).toBeLessThanOrEqual(1);
  });

  it('jolts harder for a bigger hit, up to full', () => {
    const graze = { ...hitPulse(3, pulse()) };
    const big = { ...hitPulse(60, pulse()) };
    expect(big.strong).toBe(1);
    expect(graze.strong).toBeGreaterThan(0);
    expect(graze.strong).toBeLessThan(big.strong);
  });

  it('feels a blast fully inside its radius, fading to nothing further out', () => {
    expect(blastPulse(2, 5, pulse()).strong).toBe(1);
    const mid = blastPulse(5 + 5 * (BLAST_FELT - 1) * 0.5, 5, pulse()).strong;
    expect(mid).toBeCloseTo(0.5);
    const far = blastPulse(5 * BLAST_FELT + 1, 5, pulse());
    expect(far.strong).toBe(0);
    expect(far.ms).toBe(0);
  });
});

describe('Rumbler', () => {
  it('plays a dual rumble with the pulse', () => {
    const { gp, playEffect } = fakePad();
    expect(new Rumbler().play(gp, { strong: 0.5, weak: 0.25, ms: 80 }, 0)).toBe(true);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 80,
      startDelay: 0,
      strongMagnitude: 0.5,
      weakMagnitude: 0.25,
    });
  });

  it("doesn't cut a stronger pulse short with a weaker one, but follows it after", () => {
    const { gp, playEffect } = fakePad();
    const r = new Rumbler();
    r.play(gp, { strong: 1, weak: 0.6, ms: 400 }, 0);
    expect(r.play(gp, { strong: 0.2, weak: 0.4, ms: 50 }, 100)).toBe(false);
    expect(r.play(gp, { strong: 1, weak: 0.6, ms: 300 }, 200)).toBe(true);
    expect(r.play(gp, { strong: 0.2, weak: 0.4, ms: 50 }, 600)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(3);
  });

  it('does nothing on a pad without rumble, or for an empty pulse', () => {
    const r = new Rumbler();
    expect(r.play({} as Gamepad, { strong: 1, weak: 1, ms: 100 }, 0)).toBe(false);
    expect(r.play(null, { strong: 1, weak: 1, ms: 100 }, 0)).toBe(false);
    const { gp, playEffect } = fakePad();
    expect(r.play(gp, { strong: 0, weak: 0, ms: 0 }, 0)).toBe(false);
    expect(playEffect).not.toHaveBeenCalled();
  });
});
