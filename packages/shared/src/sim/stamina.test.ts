import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { MOVEMENT } from './movement';
import { STAMINA, staminaBreath } from './stamina';
import { createState, spawnCharacter, type Character, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS, carryLoad } from './test-items';

function world(): CollisionWorld {
  return new CollisionWorld({
    terrain: {
      minX: -200,
      minZ: -200,
      cellSize: 4,
      cols: 100,
      rows: 100,
      heights: Array(101 * 101).fill(0),
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

function setup() {
  const s = createState(1);
  const w = world();
  const c = spawnCharacter(s, w, 0, 150);
  const run = (seconds: number, parts: Partial<PlayerInput> = {}): void => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++)
      step(s, w, TEST_ITEMS, { [c.id]: input(parts) });
  };
  return { s, w, c, run };
}

const speed = (c: Character): number => Math.hypot(c.vx, c.vz);

describe('stamina (BW-4)', () => {
  it('drains while sprinting, then no sprint until it refills past 30%', () => {
    const { c, run } = setup();
    run(STAMINA.sprint / 2, { moveY: 1, sprint: true });
    expect(c.stamina).toBeCloseTo(0.5, 1);
    expect(speed(c)).toBeCloseTo(MOVEMENT.sprintSpeed, 5);
    run(STAMINA.sprint / 2 + 0.5, { moveY: 1, sprint: true });
    expect(c.stamina).toBeLessThan(0.05);
    expect(c.winded).toBe(true);
    expect(speed(c)).toBeCloseTo(MOVEMENT.walkSpeed, 5);
    // Walking on with sprint held: it refills at the moving rate, still no sprint under 30%.
    run(STAMINA.refillMoving * 0.25, { moveY: 1, sprint: true });
    expect(speed(c)).toBeCloseTo(MOVEMENT.walkSpeed, 5);
    run(STAMINA.refillMoving * 0.06, { moveY: 1, sprint: true });
    expect(c.winded).toBeUndefined();
    expect(speed(c)).toBeCloseTo(MOVEMENT.sprintSpeed, 5);
  });

  it('refills faster standing than walking, and slower over each weight threshold', () => {
    const refilled = (kg: number, moveY: number): number => {
      const { c, run } = setup();
      carryLoad(c, kg);
      c.stamina = 0.2;
      run(2, { moveY });
      return c.stamina!;
    };
    const standing = refilled(0, 0);
    expect(standing).toBeCloseTo(0.2 + 2 / STAMINA.refillStill, 2);
    expect(refilled(0, 1)).toBeLessThan(standing);
    expect(refilled(30, 0)).toBeCloseTo(0.2 + (2 * STAMINA.refillLoaded) / STAMINA.refillStill, 2);
    expect(refilled(50, 0)).toBeCloseTo(0.2 + (2 * STAMINA.refillHeavy) / STAMINA.refillStill, 2);
  });

  it('takes a chunk for a jump', () => {
    const { c, run } = setup();
    run(1 / TICK_RATE, { jump: true });
    expect(c.stamina).toBeCloseTo(1 - STAMINA.jump, 2);
  });

  it('shortens held breath when low', () => {
    const { c } = setup();
    expect(staminaBreath(c)).toBe(1);
    c.stamina = STAMINA.breathFrom;
    expect(staminaBreath(c)).toBe(1);
    c.stamina = 0;
    expect(staminaBreath(c)).toBe(STAMINA.breathEmpty);
  });

  it('leaves enemies alone', () => {
    const { s, w } = setup();
    const e = spawnCharacter(s, w, 10, 150);
    e.ai = {} as Character['ai'];
    const before = e.stamina;
    for (let i = 0; i < 40 * TICK_RATE; i++)
      step(s, w, TEST_ITEMS, { [e.id]: input({ moveY: 1, sprint: true }) });
    expect(e.stamina).toBe(before);
    expect(speed(e)).toBeCloseTo(MOVEMENT.sprintSpeed, 5);
  });
});
