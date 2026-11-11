import { describe, expect, it } from 'vitest';
import type { AttachmentDef } from '../content/items';
import { TICK_RATE } from '../tick';
import { MOVEMENT } from './movement';
import { RECOIL, gunRecoil, kickRecoil, recoilScale, settleRecoil } from './recoil';
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
    expect(c.recoil!.kickPitch).toBeCloseTo((RECOIL.firstShot + RECOIL.earlyKick) * DEG);
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

  it('climbs along its angle', () => {
    const state = createState(1);
    const right = body();
    const left = body();
    for (let i = 0; i < 5; i++) {
      kickRecoil(state, right, 1, 0, 30);
      kickRecoil(state, left, 1, 0, -30);
    }
    expect(right.recoil!.kickYaw / right.recoil!.kickPitch).toBeCloseTo(Math.tan(30 * DEG));
    expect(left.recoil!.kickYaw).toBeCloseTo(-right.recoil!.kickYaw);
    // Up is the kick along the angle, so tilting it takes a little off the climb.
    expect(right.recoil!.kickPitch).toBeCloseTo(
      (RECOIL.firstShot + 4 * RECOIL.earlyKick) * Math.cos(30 * DEG) * DEG,
    );
  });

  it('stops climbing and drifting past its stable round, but still bounces', () => {
    const state = createState(1);
    const c = body();
    const held: number[] = [];
    for (let round = 0; round < 30; round++) {
      kickRecoil(state, c, 1.8, 0, 20, 5);
      if (round >= 4) held.push(c.recoil!.kickPitch);
      settle(c, 3, true);
    }
    const hold = held[0]!;
    // Every round after the fifth tops the kick back up to where the fifth left it.
    for (const k of held) expect(k).toBeCloseTo(hold, 9);
    expect(c.recoil!.kickYaw / c.recoil!.kickPitch).toBeLessThan(Math.tan(20 * DEG) + 1e-9);
    // Without it, the same burst climbs higher.
    const free = body();
    for (let round = 0; round < 30; round++) {
      kickRecoil(state, free, 1.8, 0, 20);
      settle(free, 3, true);
    }
    expect(free.recoilPitch).toBeGreaterThan(c.recoilPitch * 1.15);
  });

  it('keeps climbing through a magazine, hardest at first, as in Tarkov', () => {
    const state = createState(1);
    const c = body();
    const pitches: number[] = [];
    // The AKM: 600 rpm at a 30 Hz tick, a round every 3 ticks.
    for (let round = 0; round < 30; round++) {
      kickRecoil(state, c, 1.8, 0);
      settle(c, 3, true);
      pitches.push(c.recoilPitch);
    }
    const [fifth, tenth, twentieth, thirtieth] = [
      pitches[4]!,
      pitches[9]!,
      pitches[19]!,
      pitches[29]!,
    ];
    // No leveling off: each ten rounds still climb a few degrees.
    expect(twentieth - tenth).toBeGreaterThan(3 * DEG);
    expect(thirtieth - twentieth).toBeGreaterThan(2 * DEG);
    // The early rounds kick hardest: the first five climb more than the next five.
    expect(fifth).toBeGreaterThan(tenth - fifth);
    expect(thirtieth).toBeLessThan(RECOIL.maxUp * DEG);
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

describe('gunRecoil', () => {
  const start = RECOIL.aimedShare + RECOIL.aimedTail;

  it('leaves all of it on the view from the hip', () => {
    expect(gunRecoil(20 * DEG, 0)).toBe(0);
  });

  it('takes most of a small kick', () => {
    const r = 0.1 * DEG;
    expect(gunRecoil(r, 1)).toBeCloseTo(r * start, 4);
  });

  it('keeps the gun near the center, with more for a harder climb', () => {
    const akm = gunRecoil(21 * DEG, 1);
    const scar = gunRecoil(28 * DEG, 1);
    expect(akm).toBeLessThan(6 * DEG);
    expect(scar).toBeLessThan(7 * DEG);
    expect(scar).toBeGreaterThan(akm);
  });

  it('keeps moving the sights with every round, however far it has climbed', () => {
    const more = gunRecoil(21 * DEG + 0.001, 1) - gunRecoil(21 * DEG, 1);
    expect(more).toBeCloseTo(0.001 * RECOIL.aimedTail, 4);
  });

  it('never lets the view fall as recoil climbs', () => {
    let last = 0;
    for (let d = 0.5; d <= 35; d += 0.5) {
      const view = d * DEG - gunRecoil(d * DEG, 1);
      expect(view).toBeGreaterThan(last);
      last = view;
    }
  });

  it('works the same both ways, for sideways recoil', () => {
    expect(gunRecoil(-3 * DEG, 1)).toBeCloseTo(-gunRecoil(3 * DEG, 1));
    expect(gunRecoil(0, 1)).toBeCloseTo(0);
  });

  it('scales with how far aimed in', () => {
    expect(gunRecoil(10 * DEG, 0.5)).toBeCloseTo(gunRecoil(10 * DEG, 1) / 2);
  });

  it('holds the same place on the screen through a scope', () => {
    expect(gunRecoil(21 * DEG, 1, 3)).toBeCloseTo(gunRecoil(21 * DEG, 1) / 3);
  });
});
