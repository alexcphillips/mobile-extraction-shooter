import { describe, expect, it } from 'vitest';
import type { AttachmentDef } from '../content/items';
import { TICK_RATE } from '../tick';
import { MOVEMENT } from './movement';
import { RECOIL, kickRecoil, recoilScale, settleRecoil } from './recoil';
import { createState, type Character } from './state';
import { TEST_ITEMS } from './test-items';
import { createWeapon, createWeaponStats, weaponStats } from './weapons';

const DEG = Math.PI / 180;

/** Only what recoil reads: a standing, still character. */
function body(parts: Partial<Character> = {}): Character {
  return {
    height: MOVEMENT.standHeight,
    vx: 0,
    vz: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    ...parts,
  } as Character;
}

/** Settles for so many ticks, the trigger held or not; returns the highest pitch reached. */
function settle(c: Character, ticks: number, trigger = false, snap = 40, recovery = 3): number {
  let peak = c.recoilPitch;
  for (let i = 0; i < ticks; i++) {
    settleRecoil(c, snap, recovery, trigger);
    peak = Math.max(peak, c.recoilPitch);
  }
  return peak;
}

describe('recoil', () => {
  it('kicks the first round of a burst harder', () => {
    const state = createState(1);
    const c = body();
    kickRecoil(state, c, 1, 0);
    expect(c.recoil!.kickPitch).toBeCloseTo(RECOIL.firstShot * DEG);
    kickRecoil(state, c, 1, 0);
    expect(c.recoil!.kickPitch).toBeCloseTo((RECOIL.firstShot + 1) * DEG);
    expect(c.recoil!.shots).toBe(2);
  });

  it('starts a new burst only after the trigger is let go long enough', () => {
    const state = createState(1);
    const c = body();
    kickRecoil(state, c, 1, 0);
    // A quick tap after: still the same burst.
    settle(c, Math.floor(RECOIL.resetTime * TICK_RATE) - 1);
    expect(c.recoil!.shots).toBe(1);
    settle(c, 2);
    expect(c.recoil!.shots).toBe(0);
    // Holding the trigger never resets it.
    kickRecoil(state, c, 1, 0);
    settle(c, TICK_RATE, true);
    expect(c.recoil!.shots).toBe(1);
  });

  it('kicks sideways at random, within side either way', () => {
    const state = createState(7);
    const c = body();
    const yaws = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const before = c.recoil?.kickYaw ?? 0;
      kickRecoil(state, c, 0, 1);
      const kick = c.recoil!.kickYaw - before;
      expect(Math.abs(kick)).toBeLessThanOrEqual((i === 0 ? RECOIL.firstShot : 1) * DEG);
      yaws.add(kick);
    }
    expect(yaws.size).toBe(20);
  });

  it('scales with stance and movement', () => {
    expect(recoilScale(body())).toBe(1);
    expect(recoilScale(body({ height: MOVEMENT.crouchHeight }))).toBe(RECOIL.crouched);
    expect(recoilScale(body({ height: MOVEMENT.proneHeight }))).toBe(RECOIL.prone);
    expect(recoilScale(body({ vx: MOVEMENT.walkSpeed }))).toBe(RECOIL.moving);
    const crawl = body({ height: MOVEMENT.proneHeight, vz: MOVEMENT.proneSpeed });
    expect(recoilScale(crawl)).toBeCloseTo(RECOIL.prone * RECOIL.moving);
    const state = createState(1);
    const prone = body({ height: MOVEMENT.proneHeight });
    kickRecoil(state, prone, 1, 0);
    expect(prone.recoil!.kickPitch).toBeCloseTo(RECOIL.firstShot * RECOIL.prone * DEG);
  });

  it('never climbs past the cap', () => {
    const state = createState(1);
    const c = body();
    for (let i = 0; i < 50; i++) kickRecoil(state, c, 5, 0);
    expect(c.recoil!.kickPitch).toBeCloseTo(RECOIL.maxUp * DEG);
  });

  it('springs to the kick quickly, overshoots a little, then settles to exactly 0', () => {
    const state = createState(1);
    const c = body();
    kickRecoil(state, c, 1, 0);
    const kick = c.recoil!.kickPitch;
    // At a snap of 40 the gun lands its kick within about a tenth of a second (3 ticks).
    const peak = settle(c, 3, true);
    expect(peak).toBeGreaterThan(kick * 0.85);
    expect(peak).toBeLessThan(kick * 1.15);
    settle(c, TICK_RATE * 5);
    expect(c.recoilPitch).toBe(0);
    expect(c.recoil!.speedPitch).toBe(0);
  });

  it('keeps snap and recovery separate', () => {
    const state = createState(1);
    const snappy = body();
    const soft = body();
    kickRecoil(state, snappy, 1, 0);
    kickRecoil(state, soft, 1, 0);
    // One tick in, a snappier gun has come further.
    settleRecoil(snappy, 60, 3, true);
    settleRecoil(soft, 20, 3, true);
    expect(snappy.recoilPitch).toBeGreaterThan(soft.recoilPitch * 2);
    // Faster recovery wears the kick off sooner, at the same snap.
    const fast = body();
    const slow = body();
    kickRecoil(state, fast, 1, 0);
    kickRecoil(state, slow, 1, 0);
    settle(fast, TICK_RATE / 2, false, 40, 8);
    settle(slow, TICK_RATE / 2, false, 40, 2);
    expect(fast.recoilPitch).toBeLessThan(slow.recoilPitch / 4);
  });

  it('comes back down quickly once the burst is over', () => {
    const state = createState(1);
    const c = body();
    for (let round = 0; round < 30; round++) {
      kickRecoil(state, c, 1.8, 0);
      settle(c, 3, true);
    }
    const peak = c.recoilPitch;
    // At the AKM's recovery of 3 alone, a fifth would still be left after half a second.
    settle(c, TICK_RATE / 2);
    expect(c.recoilPitch).toBeLessThan(peak * 0.1);
  });

  it('plateaus under sustained fire rather than climbing forever', () => {
    const state = createState(1);
    const c = body();
    const pitches: number[] = [];
    // 600 rpm at a 30 Hz tick: a round every 3 ticks.
    for (let round = 0; round < 60; round++) {
      kickRecoil(state, c, 1.8, 0);
      settle(c, 3, true);
      pitches.push(c.recoilPitch);
    }
    const [fifth, thirtieth, sixtieth] = [pitches[4]!, pitches[29]!, pitches[59]!];
    expect(thirtieth).toBeGreaterThan(fifth);
    expect(Math.abs(sixtieth - thirtieth)).toBeLessThan(0.05 * DEG);
  });
});

describe('recoil attachment mods', () => {
  it('scales kick up, sideways and recovery separately', () => {
    const items = new Map(TEST_ITEMS);
    const brake = TEST_ITEMS.get('suppressor') as AttachmentDef;
    items.set('suppressor', {
      ...brake,
      mods: { recoilUp: 0.5, recoilSide: 0.8, ergonomics: 1.5 },
    });
    const bare = weaponStats(items, createWeapon(items, 'rifle'), createWeaponStats());
    const s = weaponStats(items, createWeapon(items, 'rifle', ['suppressor']), createWeaponStats());
    expect(s.recoilUp).toBeCloseTo(bare.recoilUp * 0.5);
    expect(s.recoilSide).toBeCloseTo(bare.recoilSide * 0.8);
    expect(s.recoilRecovery).toBeCloseTo(bare.recoilRecovery * 1.5);
    expect(s.recoilSnap).toBe(bare.recoilSnap);
  });
});
