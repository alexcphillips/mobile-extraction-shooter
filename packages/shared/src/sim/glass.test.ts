import { describe, expect, it } from 'vitest';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type GlassDef } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import { equip, heldWeapon } from './gear';
import { STOMACH } from './health';
import {
  createState,
  eyeHeight,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimState,
} from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';

/** A pane 2 m wide and 2.5 m tall across z = paneZ, facing along z. */
function makeWorld(paneZ: number): CollisionWorld {
  const pane: GlassDef = { x: 0, y: 0, z: paneZ, yaw: 0, width: 2, height: 2.5, thickness: 0.02 };
  return new CollisionWorld({
    terrain: {
      minX: -40,
      minZ: -40,
      cellSize: 4,
      cols: 20,
      rows: 20,
      heights: Array(21 * 21).fill(0),
    },
    boxes: [],
    ramps: [],
    ladders: [],
    glass: [pane],
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

function lookAt(from: Character, x: number, y: number, z: number): Partial<PlayerInput> {
  const dx = x - from.x;
  const dz = z - from.z;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(y - eyeHeight(from), Math.hypot(dx, dz)),
  };
}

function run(
  state: SimState,
  world: CollisionWorld,
  nav: NavGrid,
  p: Character,
  s: number,
  i: PlayerInput,
): void {
  for (let k = 0; k < s * TICK_RATE; k++) step(state, world, items, { [p.id]: i }, nav);
}

describe('glass', () => {
  it('is solid, but seen through', () => {
    const world = makeWorld(5);
    expect(world.raycast(0, 1, 10, 0, 0, -1, 20)).toBeCloseTo(4.99);
    expect(world.raycast(0, 1, 10, 0, 0, -1, 20, undefined, true)).toBe(Infinity);
    expect(world.overlaps(0, 5, 0.3, 0, 1.8)).toBe(true);
    world.setGlassBroken(0, true);
    expect(world.raycast(0, 1, 10, 0, 0, -1, 20)).toBe(Infinity);
    expect(world.overlaps(0, 5, 0.3, 0, 1.8)).toBe(false);
    world.setGlassBroken(0, false);
    expect(world.raycast(0, 1, 10, 0, 0, -1, 20)).toBeCloseTo(4.99);
  });

  it('breaks under a shot, which goes on to hit who is behind it', () => {
    const world = makeWorld(5);
    const state = createState(1);
    const shooter = spawnCharacter(state, world, 0, 10);
    const target = spawnCharacter(state, world, 0, 0, Math.PI);
    giveWeapon(shooter, items, 'rifle');
    step(state, world, items, { [shooter.id]: input({ ...lookAt(shooter, 0, 1, 0), fire: true }) });
    expect(state.glass).toEqual([true]);
    expect(state.events.find((e) => e.type === 'glass')).toMatchObject({
      by: shooter.id,
      glass: 0,
      loudness: 12,
    });
    expect(state.events.find((e) => e.type === 'shot')).toMatchObject({ hit: 'character' });
    expect(target.health.hp[STOMACH]).toBeLessThan(70);
    expect(heldWeapon(shooter)?.mag).toBe(29);
  });

  it('breaks under a knife, and enemies near enough go to look', () => {
    for (const [paneZ, heard] of [
      [9, true],
      [15, false],
    ] as const) {
      const world = makeWorld(paneZ);
      const nav = new NavGrid(world);
      const state = createState(1);
      // Facing −z, away from the pane and the player.
      const enemy = spawnEnemy(state, world, 0, 0, 0, 0);
      const player = spawnCharacter(state, world, 0, paneZ + 0.6);
      equip(player, items, 'knife', createItem(items, 'knife'));
      run(state, world, nav, player, 0.25, input({ draw: 'knife' }));
      expect(enemy.ai!.awareness).toBe('unaware');
      run(state, world, nav, player, 0.1, input({ fire: true, ...lookAt(player, 0, 1.3, paneZ) }));
      expect(state.glass).toEqual([true]);
      expect(enemy.ai!.awareness).toBe(heard ? 'suspicious' : 'unaware');
    }
  });

  it('fills in a state saved before glass, all whole', () => {
    const world = makeWorld(5);
    const state = createState(1);
    delete (state as Partial<SimState>).glass;
    step(state, world, items, {});
    expect(state.glass).toEqual([false]);
  });
});
