import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip, gearBurden } from './gear';
import { MOVEMENT } from './movement';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS, carryLoad } from './test-items';
import { giveWeapon } from './weapons';
import { WEIGHT, canSprint, gearWeight, itemWeight, loadNoise, loadSpeed } from './weight';

function world(): CollisionWorld {
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

/** Test items weigh 0 but ballast (1 kg); these give the rest a weight for one test. */
function weighed(kg: Record<string, number>) {
  const items = new Map(TEST_ITEMS);
  for (const [id, w] of Object.entries(kg)) items.set(id, { ...items.get(id)!, weight: w });
  return items;
}

describe('weight (BW-3)', () => {
  it('counts a gun with its attachments and loaded rounds, and what a bag holds', () => {
    const items = weighed({ rifle: 3, round: 0.01, backpack: 1 });
    const s = createState(1);
    const c = spawnCharacter(s, world(), 0, 0);
    const gun = giveWeapon(c, items, 'rifle');
    const rounds = gun.mag;
    expect(rounds).toBeGreaterThan(0);
    expect(itemWeight(items, gun)).toBeCloseTo(3 + rounds * 0.01, 5);
    const bag = createItem(items, 'backpack');
    equip(c, items, 'backpack', bag);
    carryLoad({ gear: { pockets: bag.grid! } }, 5);
    carryLoad(c, 2);
    expect(gearWeight(items, c.gear)).toBeCloseTo(3 + rounds * 0.01 + 1 + 5 + 2, 5);
  });

  it('slows from 25 kg to ×0.8 at 45, with no sprint over it', () => {
    expect(loadSpeed(0)).toBe(1);
    expect(loadSpeed(WEIGHT.from)).toBe(1);
    expect(loadSpeed(35)).toBeCloseTo(0.9, 5);
    expect(loadSpeed(WEIGHT.heavy)).toBeCloseTo(WEIGHT.slowest, 5);
    expect(loadSpeed(80)).toBeCloseTo(WEIGHT.slowest, 5);
    expect(canSprint(WEIGHT.heavy)).toBe(true);
    expect(canSprint(WEIGHT.heavy + 0.1)).toBe(false);
  });

  it('makes footsteps quieter light and louder heavy, as before at the reference load', () => {
    expect(loadNoise(0)).toBeCloseTo(WEIGHT.quietest, 5);
    expect(loadNoise(WEIGHT.reference)).toBeCloseTo(1, 5);
    expect(loadNoise(2 * WEIGHT.reference)).toBeGreaterThan(1);
    expect(loadNoise(500)).toBe(WEIGHT.loudest);
  });

  it('walks a heavy player slower, and won’t let them sprint', () => {
    const run = (kg: number, sprint: boolean): number => {
      const s = createState(1);
      const w = world();
      const c = spawnCharacter(s, w, 0, 0);
      carryLoad(c, kg);
      for (let i = 0; i < TICK_RATE; i++)
        step(s, w, TEST_ITEMS, { [c.id]: input({ moveY: 1, sprint }) });
      return Math.hypot(c.vx, c.vz);
    };
    expect(run(10, false)).toBeCloseTo(MOVEMENT.walkSpeed, 5);
    expect(run(35, false)).toBeCloseTo(MOVEMENT.walkSpeed * 0.9, 5);
    expect(run(35, true)).toBeCloseTo(MOVEMENT.sprintSpeed * 0.9, 5);
    expect(run(50, true)).toBeCloseTo(MOVEMENT.walkSpeed * WEIGHT.slowest, 5);
  });

  it('recounts after an inventory action and once a second, not every tick', () => {
    const s = createState(1);
    const w = world();
    const c = spawnCharacter(s, w, 0, 0);
    step(s, w, TEST_ITEMS, {});
    expect(c.load).toBe(0);
    carryLoad(c, 30);
    step(s, w, TEST_ITEMS, {});
    expect(c.load).toBe(0);
    // Any inventory action recounts at once.
    const split = {
      type: 'split' as const,
      at: { owner: { kind: 'self' as const }, grid: 'pockets' as const, index: 0, item: 'ballast' },
      count: 10,
    };
    step(s, w, TEST_ITEMS, { [c.id]: input({ inventory: [split] }) });
    expect(c.load).toBe(30);
    // Without one, within a second.
    carryLoad(c, 5);
    for (let i = 0; i < TICK_RATE; i++) step(s, w, TEST_ITEMS, {});
    expect(c.load).toBe(35);
  });
});

describe('gear burden (GZ-1)', () => {
  /** The test helmet and vest, slowing aim and movement. */
  function burdened() {
    const items = new Map(TEST_ITEMS);
    items.set('helmet', { ...items.get('helmet')!, aimTime: 1.25, moveSpeed: 0.9 } as never);
    items.set('vest', { ...items.get('vest')!, aimTime: 1.2, moveSpeed: 0.88 } as never);
    return items;
  }

  function wearing(items: typeof TEST_ITEMS) {
    const s = createState(1);
    const w = world();
    const c = spawnCharacter(s, w, 0, 0);
    equip(c, items, 'helmet', createItem(items, 'helmet'));
    equip(c, items, 'bodyArmor', createItem(items, 'vest'));
    return { s, w, c };
  }

  it('multiplies what each worn piece costs', () => {
    const items = burdened();
    const { c } = wearing(items);
    const b = gearBurden(items, c.gear);
    expect(b.aimTime).toBeCloseTo(1.5, 5);
    expect(b.moveSpeed).toBeCloseTo(0.792, 5);
  });

  it('slows a player’s walk and aiming in, on top of weight', () => {
    const items = burdened();
    const run = (db: typeof TEST_ITEMS) => {
      const { s, w, c } = wearing(db);
      giveWeapon(c, db, 'rifle');
      for (let i = 0; i < TICK_RATE; i++) step(s, w, db, { [c.id]: input({ moveY: 1 }) });
      const speed = Math.hypot(c.vx, c.vz);
      step(s, w, db, { [c.id]: input({ aim: true }) });
      return { speed, aim: c.aim };
    };
    const plain = run(TEST_ITEMS);
    const slow = run(items);
    expect(slow.speed).toBeCloseTo(plain.speed * 0.792, 5);
    expect(slow.aim).toBeCloseTo(plain.aim / 1.5, 5);
  });
});
