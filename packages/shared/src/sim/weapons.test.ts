import { describe, expect, it } from 'vitest';
import { createRng, nextFloat } from '../rng';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { CHEST, HEAD, LEFT_ARM, LEFT_LEG, RIGHT_ARM, RIGHT_LEG, TOTAL_HP, totalHp } from './health';
import {
  HIT_CAPSULES,
  capsuleEnds,
  createCharacterHit,
  rayCapsule,
  raycastCharacters,
} from './hit-zones';
import { MOVEMENT } from './movement';
import {
  createState,
  eyeHeight,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimState,
} from './state';
import { step } from './step';
import { TEST_ITEMS } from './test-items';
import { attach, createWeaponStats, detach, giveWeapon, weaponStats } from './weapons';

function makeWorld(boxes: ConstructorParameters<typeof CollisionWorld>[0]['boxes'] = []) {
  return new CollisionWorld({
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
}

function input(parts: Partial<PlayerInput> = {}): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    crouch: false,
    jump: false,
    fire: false,
    aim: false,
    reload: false,
    ...parts,
  };
}

/** Aim from the shooter's eye at a point. */
function lookAt(from: Character, x: number, y: number, z: number): Partial<PlayerInput> {
  const dx = x - from.x;
  const dz = z - from.z;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(y - eyeHeight(from), Math.hypot(dx, dz)),
  };
}

describe('rayCapsule', () => {
  it('hits the side, the ends, and misses beside it', () => {
    const a = [0, 0, 0];
    const b = [0, 2, 0];
    expect(rayCapsule(-5, 1, 0, 1, 0, 0, a, b, 0.5)).toBeCloseTo(4.5);
    expect(rayCapsule(0, 10, 0, 0, -1, 0, a, b, 0.5)).toBeCloseTo(7.5);
    expect(rayCapsule(-5, 1, 0.6, 1, 0, 0, a, b, 0.5)).toBe(Infinity);
    expect(rayCapsule(5, 1, 0, 1, 0, 0, a, b, 0.5)).toBe(Infinity);
  });

  it('matches sampling the distance to the axis', () => {
    const rng = createRng(3);
    const a = [0.3, 0.2, -0.1];
    const b = [-0.2, 1.4, 0.4];
    const r = 0.3;
    for (let i = 0; i < 200; i++) {
      const o = [nextFloat(rng) * 6 - 3, nextFloat(rng) * 6 - 2, nextFloat(rng) * 6 - 3];
      if (distToSegment(o, a, b) <= r) continue;
      const t = [nextFloat(rng) - 0.5, nextFloat(rng) * 1.6, nextFloat(rng) - 0.5];
      const d = [t[0]! - o[0]!, t[1]! - o[1]!, t[2]! - o[2]!];
      const len = Math.hypot(d[0]!, d[1]!, d[2]!);
      const [dx, dy, dz] = [d[0]! / len, d[1]! / len, d[2]! / len];
      const got = rayCapsule(o[0]!, o[1]!, o[2]!, dx, dy, dz, a, b, r);
      // March along the ray to the first point inside the capsule.
      let want = Infinity;
      for (let s = 0; s < 12; s += 0.001) {
        const p = [o[0]! + dx * s, o[1]! + dy * s, o[2]! + dz * s];
        if (distToSegment(p, a, b) <= r) {
          want = s;
          break;
        }
      }
      if (want === Infinity) expect(got).toBe(Infinity);
      else expect(got).toBeCloseTo(want, 2);
    }
  });
});

function distToSegment(p: number[], a: number[], b: number[]): number {
  const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const ap = [p[0]! - a[0]!, p[1]! - a[1]!, p[2]! - a[2]!];
  const len2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
  const t = Math.max(0, Math.min(1, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / len2));
  return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t);
}

describe('hit zones', () => {
  const world = makeWorld();

  function target(yaw = 0): { state: SimState; t: Character } {
    const state = createState(1);
    return { state, t: spawnCharacter(state, world, 0, 0, yaw) };
  }

  /** Shoots horizontally along +x at a height and sideways offset (z). */
  function zoneAt(state: SimState, y: number, z: number): number | null {
    const hit = createCharacterHit();
    raycastCharacters(state, -10, y, z, 1, 0, 0, 100, 0, hit);
    return hit.id ? hit.zone : null;
  }

  it('finds each zone on a standing body', () => {
    // Facing −x, towards the shots, so its right is +z.
    const { state } = target(-Math.PI / 2);
    expect(zoneAt(state, 1.62, 0)).toBe(HEAD);
    expect(zoneAt(state, 1.1, 0)).toBe(CHEST);
    expect(zoneAt(state, 1.1, -0.29)).toBe(LEFT_ARM);
    expect(zoneAt(state, 1.1, 0.29)).toBe(RIGHT_ARM);
    expect(zoneAt(state, 0.5, -0.11)).toBe(LEFT_LEG);
    expect(zoneAt(state, 0.5, 0.11)).toBe(RIGHT_LEG);
    expect(zoneAt(state, 2.0, 0)).toBe(null);
  });

  it('turns with yaw', () => {
    // Facing −z: right is +x, so a ray along +x meets the left arm first.
    const facingMinusZ = target(0).state;
    expect(zoneAt(facingMinusZ, 1.1, 0)).toBe(LEFT_ARM);
    // Facing +z: right is −x, so the right arm comes first.
    const facingPlusZ = target(Math.PI).state;
    expect(zoneAt(facingPlusZ, 1.1, 0)).toBe(RIGHT_ARM);
  });

  it('shrinks with crouching', () => {
    const { state, t } = target(Math.PI / 2);
    expect(zoneAt(state, 1.62, 0)).toBe(HEAD);
    t.height = MOVEMENT.crouchHeight;
    expect(zoneAt(state, 1.62, 0)).toBe(null);
    expect(zoneAt(state, 1.08, 0)).toBe(HEAD);
  });

  it('skips the dead and the shooter', () => {
    const { state, t } = target();
    expect(raycastCharacters(state, -10, 1.1, 0, 1, 0, 0, 100, t.id)).toBe(Infinity);
    t.health.dead = true;
    expect(raycastCharacters(state, -10, 1.1, 0, 1, 0, 0, 100, 0)).toBe(Infinity);
  });

  it('keeps every capsule inside the standing height', () => {
    const { t } = target();
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    for (const cap of HIT_CAPSULES) {
      capsuleEnds(t, cap, a, b);
      expect(Math.min(a[1]!, b[1]!) - cap.radius).toBeGreaterThanOrEqual(0);
      expect(Math.max(a[1]!, b[1]!) + cap.radius).toBeLessThanOrEqual(MOVEMENT.standHeight + 1e-9);
    }
  });
});

describe('firing', () => {
  function range(boxes: Parameters<typeof makeWorld>[0] = []) {
    const world = makeWorld(boxes);
    const state = createState(1);
    const shooter = spawnCharacter(state, world, 0, 10);
    const target = spawnCharacter(state, world, 0, 0, Math.PI);
    return { world, state, shooter, target };
  }

  it('hits what it aims at and leaves an event', () => {
    const { world, state, shooter, target } = range();
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 0);
    const aim = lookAt(shooter, 0, 1.2, 0);
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ ...aim, fire: true }) });
    expect(target.health.hp[CHEST]).toBe(85 - 40);
    expect(shooter.weapon?.mag).toBe(29);
    const shot = state.events.find((e) => e.type === 'shot');
    expect(shot).toMatchObject({ by: shooter.id, hit: 'character', target: target.id });
  });

  it('fires at the weapon rate while held, and kicks the view up', () => {
    const { world, state, shooter } = range();
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 0);
    const fire = input({ pitch: 1, fire: true });
    let shots = 0;
    for (let i = 0; i < TICK_RATE; i++) {
      step(state, world, TEST_ITEMS, { [shooter.id]: fire });
      shots += state.events.filter((e) => e.type === 'shot').length;
    }
    // 600 rpm is 10 a second.
    expect(shots).toBe(10);
    expect(shooter.recoilPitch).toBeGreaterThan(0);
    // It settles once the trigger is let go.
    for (let i = 0; i < TICK_RATE * 2; i++) step(state, world, TEST_ITEMS, {});
    expect(shooter.recoilPitch).toBe(0);
  });

  it('fires semi-automatic guns once per pull', () => {
    const { world, state, shooter } = range();
    giveWeapon(shooter, TEST_ITEMS, 'pistol', 0);
    for (let i = 0; i < 10; i++) {
      step(state, world, TEST_ITEMS, { [shooter.id]: input({ pitch: 1, fire: true }) });
    }
    expect(shooter.weapon?.mag).toBe(11);
  });

  it('is stopped by walls', () => {
    const wall = { x: 0, y: 1, z: 5, hx: 2, hy: 1, hz: 0.1, yaw: 0 };
    const { world, state, shooter, target } = range([wall]);
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 0);
    const aim = lookAt(shooter, 0, 1.2, 0);
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ ...aim, fire: true }) });
    expect(totalHp(target.health)).toBe(TOTAL_HP);
    expect(state.events.find((e) => e.type === 'shot')).toMatchObject({ hit: 'world' });
  });

  it('reloads from the reserve, and on pulling the trigger when empty', () => {
    const { world, state, shooter } = range();
    giveWeapon(shooter, TEST_ITEMS, 'pistol', 5);
    const w = shooter.weapon!;
    w.mag = 0;
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ pitch: 1, fire: true }) });
    expect(w.reloading).toBeGreaterThan(0);
    for (let i = 0; i < TICK_RATE * 2; i++) step(state, world, TEST_ITEMS, {});
    expect(w.mag).toBe(5);
    expect(w.reserve).toBe(0);
    // Nothing left to reload with.
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ reload: true }) });
    expect(w.reloading).toBe(0);
  });

  it('cannot fire while reloading', () => {
    const { world, state, shooter } = range();
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 30);
    shooter.weapon!.mag = 10;
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ reload: true }) });
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ pitch: 1, fire: true }) });
    expect(shooter.weapon?.mag).toBe(10);
  });

  it('aims in over the aim time, slower with a broken arm', () => {
    const { world, state, shooter } = range();
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 0);
    const aim = input({ aim: true });
    for (let i = 0; i < 3; i++) step(state, world, TEST_ITEMS, { [shooter.id]: aim });
    expect(shooter.aim).toBeCloseTo(0.5);
    shooter.aim = 0;
    shooter.health.hp[RIGHT_ARM] = 0;
    for (let i = 0; i < 3; i++) step(state, world, TEST_ITEMS, { [shooter.id]: aim });
    expect(shooter.aim).toBeCloseTo(0.5 / 1.5);
  });

  it('stops sprinting while firing', () => {
    const { world, state, shooter } = range();
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 0);
    step(state, world, TEST_ITEMS, {
      [shooter.id]: input({ moveY: 1, sprint: true, fire: true, pitch: 1 }),
    });
    expect(Math.hypot(shooter.vx, shooter.vz)).toBeCloseTo(MOVEMENT.walkSpeed);
  });

  it('kills, and the dead stop acting', () => {
    const { world, state, shooter, target } = range();
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 0);
    giveWeapon(target, TEST_ITEMS, 'rifle', 0);
    const aim = lookAt(shooter, 0, 1.62, 0);
    for (let i = 0; i < 3 && !target.health.dead; i++) {
      step(state, world, TEST_ITEMS, { [shooter.id]: input({ ...aim, fire: true }) });
    }
    expect(target.health.dead).toBe(true);
    expect(state.events).toContainEqual({ type: 'death', target: target.id, by: shooter.id });
    step(state, world, TEST_ITEMS, { [target.id]: input({ fire: true, moveY: 1 }) });
    expect(target.weapon?.mag).toBe(30);
    expect(target.vz).toBe(0);
  });

  it('damages legs as well as the head', () => {
    const { world, state, shooter, target } = range();
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 0);
    const aim = lookAt(shooter, 0.11, 0.4, 0);
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ ...aim, fire: true }) });
    expect(target.health.hp[LEFT_LEG]).toBeLessThan(65);
  });
});

describe('attachments', () => {
  const world = makeWorld();

  it('changes the stats and the shot loudness', () => {
    const state = createState(1);
    const shooter = spawnCharacter(state, world, 0, 0);
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 0, ['suppressor', 'scope']);
    const s = weaponStats(TEST_ITEMS, shooter.weapon!, createWeaponStats());
    expect(s.loudness).toBe(150 * 0.25);
    expect(s.recoilUp).toBe(0.5);
    expect(s.aimTime).toBe(0.4);
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ pitch: 1, fire: true }) });
    expect(state.events.find((e) => e.type === 'shot')).toMatchObject({ loudness: 37.5 });
    // Half the rifle's kick of 1°.
    expect(shooter.recoilPitch).toBeCloseTo(0.5 * (Math.PI / 180));
  });

  it('fills a bigger magazine, and reloads up to it', () => {
    const state = createState(1);
    const shooter = spawnCharacter(state, world, 0, 0);
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 100, ['big-mag']);
    const w = shooter.weapon!;
    expect(w.mag).toBe(50);
    w.mag = 0;
    step(state, world, TEST_ITEMS, { [shooter.id]: input({ reload: true }) });
    // The big magazine's reload is 1.5 times as long.
    for (let i = 0; i < TICK_RATE * 2.9; i++) step(state, world, TEST_ITEMS, {});
    expect(w.mag).toBe(0);
    for (let i = 0; i < 4; i++) step(state, world, TEST_ITEMS, {});
    expect(w.mag).toBe(50);
    expect(w.reserve).toBe(50);
  });

  it('puts rounds that no longer fit back in the reserve when the magazine comes off', () => {
    const state = createState(1);
    const shooter = spawnCharacter(state, world, 0, 0);
    giveWeapon(shooter, TEST_ITEMS, 'rifle', 10, ['big-mag']);
    const w = shooter.weapon!;
    w.reloading = 1;
    expect(detach(w, TEST_ITEMS, 'magazine')).toBe('big-mag');
    expect(w.mag).toBe(30);
    expect(w.reserve).toBe(30);
    expect(w.reloading).toBe(0);
    expect(detach(w, TEST_ITEMS, 'magazine')).toBe(null);
  });

  it('only goes on guns it fits', () => {
    const state = createState(1);
    const shooter = spawnCharacter(state, world, 0, 0);
    giveWeapon(shooter, TEST_ITEMS, 'pistol', 0);
    const w = shooter.weapon!;
    // The pistol has no optic slot, and the big magazine is for the rifle only.
    expect(() => attach(w, TEST_ITEMS, 'scope')).toThrow(/doesn't fit/);
    expect(() => attach(w, TEST_ITEMS, 'big-mag')).toThrow(/doesn't fit/);
    attach(w, TEST_ITEMS, 'suppressor');
    expect(w.attachments).toEqual({ optic: null, muzzle: 'suppressor', magazine: null });
  });
});
