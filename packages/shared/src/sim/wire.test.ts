import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { LEFT_LEG, RIGHT_LEG } from './health';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS } from './test-items';

/** Flat ground with a 1.2 m coil of wire across x = 0, 0.45 m high. */
function wired(): CollisionWorld {
  return new CollisionWorld({
    terrain: { minX: -16, minZ: -16, cellSize: 4, cols: 8, rows: 8, heights: Array(81).fill(0) },
    boxes: [],
    ramps: [],
    ladders: [],
    wires: [{ x: 0, y: 0.225, z: 0, hx: 0.225, hy: 0.225, hz: 3, yaw: 0 }],
  });
}

const walk = (moveY: number, crouch = false): PlayerInput => ({
  moveX: 0,
  moveY,
  // Facing +x.
  yaw: -Math.PI / 2,
  pitch: 0,
  sprint: false,
  crouch,
  jump: false,
  fire: false,
  aim: false,
  reload: false,
});

describe('barbed wire (TU-2)', () => {
  it('starts a leg bleeding once as you go through it, crouched or not, not every tick', () => {
    for (const crouch of [false, true]) {
      const state = createState(1);
      const world = wired();
      const c = spawnCharacter(state, world, -3, 0);
      const snags: number[] = [];
      for (let t = 0; t < 4 * TICK_RATE; t++) {
        step(state, world, TEST_ITEMS, { [c.id]: walk(1, crouch) });
        for (const e of state.events)
          if (e.type === 'wire' && e.target === c.id) snags.push(e.zone);
      }
      expect(c.x, 'walked through').toBeGreaterThan(1);
      expect(snags).toHaveLength(1);
      expect([LEFT_LEG, RIGHT_LEG]).toContain(snags[0]);
      expect(c.health.bleeding[snags[0]!]).toBe(true);
    }
  });

  it('snags again on the way back, and not the infinite health cheat', () => {
    const state = createState(1);
    const world = wired();
    const c = spawnCharacter(state, world, -3, 0);
    let snags = 0;
    for (const dir of [1, -1]) {
      for (let t = 0; t < 4 * TICK_RATE; t++) {
        step(state, world, TEST_ITEMS, { [c.id]: walk(dir) });
        for (const e of state.events) if (e.type === 'wire') snags++;
      }
    }
    expect(snags).toBe(2);

    const s2 = createState(1);
    const god = spawnCharacter(s2, world, -3, 0);
    god.admin = {
      infiniteHealth: true,
      infiniteAmmo: false,
      peaceful: false,
      infiniteConsumables: false,
    };
    for (let t = 0; t < 4 * TICK_RATE; t++) step(s2, world, TEST_ITEMS, { [god.id]: walk(1) });
    expect(god.health.bleeding.includes(true)).toBe(false);
  });
});
