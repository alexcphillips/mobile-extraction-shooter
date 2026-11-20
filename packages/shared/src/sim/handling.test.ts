import { describe, expect, it } from 'vitest';
import {
  HANDLING,
  aimMoveAt,
  aimTimeAt,
  raiseTimeAt,
  drawTimeAt,
  pointsOf,
  swayAt,
  weaponDef,
  type AttachmentDef,
} from '../content/items';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { createGear, drawTime, heldWeapon } from './gear';
import { MOVEMENT } from './movement';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS } from './test-items';
import { createWeapon, createWeaponStats, giveWeapon, weaponStats } from './weapons';

function flat(): CollisionWorld {
  return new CollisionWorld({
    terrain: {
      minX: -50,
      minZ: -50,
      cellSize: 2,
      cols: 50,
      rows: 50,
      heights: Array(51 * 51).fill(0),
    },
    boxes: [],
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

describe('handling', () => {
  it('sets aim time, draw time and sway: handier is quicker and steadier', () => {
    expect(aimTimeAt(80)).toBeLessThan(aimTimeAt(40));
    expect(drawTimeAt(80)).toBeLessThan(drawTimeAt(40));
    expect(swayAt(80)).toBeLessThan(1);
    expect(swayAt(HANDLING.swayAt)).toBe(1);
    expect(swayAt(20)).toBeGreaterThan(1);
    // Clamped at the ends.
    expect(aimTimeAt(1000)).toBe(aimTimeAt(100));
    expect(swayAt(-50)).toBeLessThanOrEqual(HANDLING.maxSway);
  });

  it("adds attachments' points to aim and reload, and a folded stock's count for nothing", () => {
    const items = new Map(TEST_ITEMS);
    const sup = TEST_ITEMS.get('suppressor') as AttachmentDef;
    items.set('suppressor', { ...sup, mods: { ...sup.mods, handling: -10 } });
    const def = weaponDef(items, 'rifle');
    const base = def.stats.handling;
    const bare = weaponStats(items, createWeapon(items, 'rifle'), createWeaponStats());
    const w = createWeapon(items, 'rifle', ['suppressor']);
    const s = weaponStats(items, w, createWeaponStats());
    expect(bare.points.handling).toBeCloseTo(base, 5);
    expect(bare.reloadTime).toBeCloseTo(def.reloadTime, 5);
    expect(s.points.handling).toBeCloseTo(base - 10, 5);
    expect(s.aimTime).toBeCloseTo(aimTimeAt(base - 10), 5);
    expect(s.aimTime).toBeGreaterThan(bare.aimTime);
    expect(s.reloadTime).toBeCloseTo(def.reloadTime * (1 + 10 * HANDLING.reloadPerPoint), 5);
    expect(pointsOf(items, w, 'handling')).toBeCloseTo(base - 10, 5);
  });

  it('times taking a gun out by its handling', () => {
    const gear = createGear(false);
    gear.primary1 = createWeapon(TEST_ITEMS, 'rifle');
    const e = weaponDef(TEST_ITEMS, 'rifle').stats.handling;
    expect(drawTime(TEST_ITEMS, gear, 'primary1')).toBeCloseTo(drawTimeAt(e), 5);
  });

  it('slows moving aimed by handling, never below the floor (WS-4)', () => {
    expect(aimMoveAt(80)).toBeGreaterThan(aimMoveAt(40));
    expect(aimMoveAt(100)).toBeLessThanOrEqual(HANDLING.maxAimMove);
    // The user's call: the heaviest builds can still strafe.
    expect(aimMoveAt(0)).toBe(HANDLING.minAimMove);
    expect(aimMoveAt(-50)).toBe(HANDLING.minAimMove);

    const world = flat();
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    giveWeapon(c, TEST_ITEMS, 'rifle');
    const strafe = (aim: boolean): number => {
      for (let i = 0; i < TICK_RATE; i++)
        step(state, world, TEST_ITEMS, { [c.id]: input({ moveX: 1, aim }) });
      return Math.hypot(c.vx, c.vz);
    };
    expect(strafe(false)).toBeCloseTo(MOVEMENT.walkSpeed, 5);
    const handling = weaponDef(TEST_ITEMS, 'rifle').stats.handling;
    expect(strafe(true)).toBeCloseTo(MOVEMENT.walkSpeed * aimMoveAt(handling), 5);
  });

  it("doesn't fire after a sprint until the gun is up, by its handling (WS-4)", () => {
    expect(raiseTimeAt(80)).toBeLessThan(raiseTimeAt(40));
    expect(raiseTimeAt(1000)).toBe(raiseTimeAt(100));
    const world = flat();
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    giveWeapon(c, TEST_ITEMS, 'pistol');
    for (let i = 0; i < TICK_RATE; i++)
      step(state, world, TEST_ITEMS, { [c.id]: input({ moveY: 1, sprint: true }) });
    expect(c.sprinting).toBe(true);
    expect(c.raised).toBe(0);
    // The trigger held from the end of the sprint: a semi-auto fires once, when it's up.
    const ticks = Math.ceil(
      raiseTimeAt(weaponDef(TEST_ITEMS, 'pistol').stats.handling) * TICK_RATE,
    );
    const mag = heldWeapon(c)!.mag;
    for (let i = 0; i < ticks - 1; i++) {
      step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true, sprint: true, moveY: 1 }) });
      expect(heldWeapon(c)!.mag).toBe(mag);
    }
    for (let i = 0; i < 3; i++)
      step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true, sprint: true, moveY: 1 }) });
    expect(heldWeapon(c)!.mag).toBe(mag - 1);
  });
});
