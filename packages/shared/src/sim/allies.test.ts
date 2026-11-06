import { describe, expect, it } from 'vitest';
import { ammoDef } from '../content/items';
import { CollisionWorld } from '../world/collision-world';
import { NavGrid } from '../nav/nav-grid';
import { DEFAULT_SKILL, spawnEnemy } from './ai';
import { ignite } from './fire';
import { CHEST, HEALTH, shootCharacter, totalHp, woundZone } from './health';
import { createState, spawnCharacter } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';
import { TICK_RATE } from '../tick';

const world = new CollisionWorld({
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

const round = ammoDef(items, 'round');
const full = totalHp({ hp: [...HEALTH.maxHp] } as never);

describe('enemies never hurt each other', () => {
  it("an enemy's shot, swing, blast or fire does nothing to another; a player's does", () => {
    const state = createState(1);
    const player = spawnCharacter(state, world, 0, 0);
    const a = spawnEnemy(state, world, 5, 0, 5, 0);
    const b = spawnEnemy(state, world, 6, 0, 5, 0);
    shootCharacter(state, items, b, CHEST, round, a.id);
    shootCharacter(state, items, b, CHEST, round, a.id, 'melee');
    woundZone(state, items, b, CHEST, 500, round, a.id, 'explosion');
    ignite(state, b, items, 'inc-round', a.id);
    expect(totalHp(b.health)).toBe(full);
    expect(b.burn).toBeFalsy();
    expect(state.events.filter((e) => e.type === 'damage' || e.type === 'ignite')).toEqual([]);
    // A player's still land, and enemies still hurt players.
    shootCharacter(state, items, b, CHEST, round, player.id);
    expect(totalHp(b.health)).toBeLessThan(full);
    ignite(state, b, items, 'inc-round', player.id);
    expect(b.burn).toBeTruthy();
    shootCharacter(state, items, player, CHEST, round, a.id);
    expect(totalHp(player.health)).toBeLessThan(full);
  });

  it('in a long fight, stray rounds from a group never wound one of its own', () => {
    const state = createState(7);
    const player = spawnCharacter(state, world, 0, 0);
    player.admin = {
      infiniteHealth: true,
      infiniteAmmo: false,
      peaceful: false,
      infiniteConsumables: false,
    };
    // A tight, poor-shooting group 15 m off, side by side and one behind another.
    const group = [
      [0, -15],
      [0.7, -15],
      [-0.7, -15],
      [0.3, -17],
      [-0.3, -17],
    ].map(([x, z]) => {
      // Facing the player (+z), and shooting badly: wide aim error that never settles.
      const e = spawnEnemy(state, world, x!, 0, z!, Math.PI, {
        skill: { ...DEFAULT_SKILL, reaction: 0.2, aimError: 25, aimSettled: 1, holdChance: 0 },
      });
      giveWeapon(e, items, 'rifle');
      return e;
    });
    const nav = new NavGrid(world);
    const stand = {
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
    };
    let shots = 0;
    for (let i = 0; i < 30 * TICK_RATE; i++) {
      step(state, world, items, { [player.id]: stand }, nav);
      for (const e of state.events) if (e.type === 'shot' && e.by !== player.id) shots++;
    }
    expect(shots).toBeGreaterThan(50);
    for (const e of group) expect(totalHp(e.health)).toBe(full);
  });
});
