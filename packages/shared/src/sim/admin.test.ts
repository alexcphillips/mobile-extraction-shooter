import { describe, expect, it } from 'vitest';
import { ammoDef } from '../content/items';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { CHEST, HEAD, TOTAL_HP, dealDamage, shootCharacter, totalHp } from './health';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});

const OFF = { infiniteHealth: false, infiniteAmmo: false, peaceful: false };

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

describe('admin cheats', () => {
  it('infinite health: hits still land, but take nothing and never kill', () => {
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    c.admin = { ...OFF, infiniteHealth: true };
    shootCharacter(state, items, c, HEAD, { ...ammoDef(items, 'round'), bleedChance: 1 }, 9);
    dealDamage(state, c, CHEST, 1000, 0);
    expect(totalHp(c.health)).toBe(TOTAL_HP);
    expect(c.health.dead).toBe(false);
    expect(c.health.bleeding.includes(true)).toBe(false);
    expect(state.events).toContainEqual(expect.objectContaining({ type: 'damage', amount: 0 }));
  });

  it('infinite ammo: firing uses no rounds, and an empty gun reloads with none carried', () => {
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    c.admin = { ...OFF, infiniteAmmo: true };
    const rifle = giveWeapon(c, items, 'rifle');
    for (let i = 0; i < TICK_RATE; i++)
      step(state, world, items, { [c.id]: input({ fire: true }) });
    expect(rifle.mag).toBe(30);
    rifle.mag = 0;
    for (let i = 0; i < 3 * TICK_RATE; i++)
      step(state, world, items, { [c.id]: input({ reload: true }) });
    expect(rifle.mag).toBe(30);
  });
});
