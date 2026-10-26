import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { createItem } from './create-item';
import { equip, heldWeapon, stow } from './gear';
import { CHEST, HEALTH, LEFT_ARM, createArmour } from './health';
import { treatments } from './meds';
import { MOVEMENT } from './movement';
import {
  createState,
  eyeHeight,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';

function makeWorld(boxes: BoxDef[] = []): CollisionWorld {
  return new CollisionWorld({
    terrain: {
      minX: -20,
      minZ: -20,
      cellSize: 2,
      cols: 20,
      rows: 20,
      heights: Array(21 * 21).fill(0),
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

/**
 * A player at the origin facing −z with a rifle, a pistol (in hand), the knife, and a
 * backpack; and a target standing at (tx, tz) with its back to it.
 */
function setup(tx = 0, tz = -1, boxes: BoxDef[] = []) {
  const world = makeWorld(boxes);
  const state = createState(3);
  const player = spawnCharacter(state, world, 0, 0);
  const target = spawnCharacter(state, world, tx, tz);
  giveWeapon(player, items, 'rifle');
  giveWeapon(player, items, 'pistol');
  equip(player, items, 'knife', createItem(items, 'knife'));
  equip(player, items, 'backpack', createItem(items, 'backpack'));
  stow(player, items, { item: 'round', count: 100 });
  const events: SimEvent[] = [];
  /** Steps for a while with one input each tick (a press is sent on the first tick only). */
  const run = (seconds: number, inp: PlayerInput = input()): void => {
    const first = { ...inp };
    const rest = { ...inp, draw: null, use: null };
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
      step(state, world, items, { [player.id]: i === 0 ? first : rest });
      events.push(...state.events);
    }
  };
  return { world, state, player, target, events, run };
}

/** The look from c's eye to a point. */
function lookAt(c: Character, x: number, y: number, z: number): Partial<PlayerInput> {
  const dx = x - c.x;
  const dz = z - c.z;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(y - eyeHeight(c), Math.hypot(dx, dz)),
  };
}

const count = (events: SimEvent[], type: SimEvent['type']): number =>
  events.filter((e) => e.type === type).length;

describe('switching hands', () => {
  it('takes the draw time before a gun fires or aims', () => {
    const s = setup(0, -10);
    s.run(0.3, input({ draw: 'primary1', fire: true, aim: true, pitch: 1 }));
    expect(heldWeapon(s.player)?.item).toBe('rifle');
    expect(count(s.events, 'shot')).toBe(0);
    expect(s.player.aim).toBe(0);
    // The rifle draws in 0.5 s.
    s.run(0.4, input({ fire: true, aim: true, pitch: 1 }));
    expect(count(s.events, 'shot')).toBeGreaterThan(0);
    expect(s.player.aim).toBeGreaterThan(0);
  });

  it('runs a little faster with the knife out', () => {
    const s = setup(5, 5);
    s.run(1, input({ draw: 'knife' }));
    const z0 = s.player.z;
    s.run(1, input({ moveY: 1 }));
    expect(z0 - s.player.z).toBeCloseTo(MOVEMENT.walkSpeed * MOVEMENT.knifeSpeed, 1);
  });
});

describe('the knife', () => {
  it('hits the zone under the crosshair within reach, through armour, at its pace', () => {
    const s = setup();
    s.target.gear.bodyArmour = createArmour(items, 'vest');
    const chest = lookAt(s.player, 0, 1.3, -1);
    s.run(0.25, input({ draw: 'knife', ...chest }));
    expect(s.player.gear.hand).toBe('knife');
    // Drawn in 0.2 s; then 1 s of swinging is 2 swings at 0.5 s each (the first at once).
    s.run(1, input({ fire: true, ...chest }));
    expect(count(s.events, 'swing')).toBe(2);
    const hits = s.events.filter((e) => e.type === 'damage');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ zone: CHEST, cause: 'melee', by: s.player.id });
    // The vest takes a quarter of each 40.
    expect(s.target.health.hp[CHEST]).toBeCloseTo(HEALTH.maxHp[CHEST]! - 2 * 30);
  });

  it("misses beyond its reach and through walls, but forgives an aim that's a little off", () => {
    const far = setup(0, -2.4);
    far.run(0.25, input({ draw: 'knife' }));
    far.run(0.1, input({ fire: true, ...lookAt(far.player, 0, 1.3, -2.4) }));
    expect(far.events.find((e) => e.type === 'swing')).toMatchObject({ hit: 'none' });
    expect(count(far.events, 'damage')).toBe(0);

    const wall = setup(0, -1.3, [{ x: 0, y: 0, z: -0.75, hx: 1, hy: 2, hz: 0.05, yaw: 0 }]);
    wall.run(0.25, input({ draw: 'knife' }));
    wall.run(0.1, input({ fire: true, ...lookAt(wall.player, 0, 1.3, -1.3) }));
    expect(wall.events.find((e) => e.type === 'swing')).toMatchObject({ hit: 'world' });
    expect(count(wall.events, 'damage')).toBe(0);

    // Aimed 16° beside the target 1.4 m away, which a single ray would miss by 0.4 m, but
    // within the fan.
    const off = setup(0, -1.4);
    off.run(0.25, input({ draw: 'knife' }));
    const look = lookAt(off.player, 0, 1.3, -1.4);
    off.run(0.1, input({ fire: true, ...look, yaw: look.yaw! + 16 * (Math.PI / 180) }));
    expect(off.events.find((e) => e.type === 'swing')).toMatchObject({ hit: 'character' });
  });
});

describe('using meds', () => {
  function bleeding(): ReturnType<typeof setup> {
    const s = setup(5, 5);
    stow(s.player, items, createItem(items, 'bandage'));
    s.player.health.bleeding[LEFT_ARM] = true;
    return s;
  }
  const bandages = (c: Character): number =>
    c.gear.pockets.items.filter((gi) => gi.item.item === 'bandage').length;

  it('takes its use time, with slow walking meanwhile, then is used up', () => {
    const s = bleeding();
    const use = treatments(s.player, items)[0]!;
    s.run(1.9, input({ use, moveY: 1 }));
    expect(s.player.using).not.toBeNull();
    expect(Math.hypot(s.player.vx, s.player.vz)).toBeCloseTo(MOVEMENT.useSpeed);
    expect(s.player.health.bleeding[LEFT_ARM]).toBe(true);
    s.run(0.2);
    expect(s.player.using).toBeNull();
    expect(s.player.health.bleeding[LEFT_ARM]).toBe(false);
    expect(bandages(s.player)).toBe(0);
  });

  it('stops when firing, sprinting, reloading or switching, and nothing is used', () => {
    const stops: Partial<PlayerInput>[] = [
      { fire: true, pitch: 1 },
      { sprint: true, moveY: 1 },
      { reload: true },
      { draw: 'knife' },
    ];
    for (const stop of stops) {
      const s = bleeding();
      s.run(1, input({ use: treatments(s.player, items)[0]! }));
      expect(s.player.using).not.toBeNull();
      s.run(1 / TICK_RATE, input(stop));
      s.run(2);
      expect(s.player.using).toBeNull();
      expect(s.player.health.bleeding[LEFT_ARM]).toBe(true);
      expect(bandages(s.player)).toBe(1);
    }
  });

  it('keeps the gun lowered, and a press to cancel stops it', () => {
    const s = bleeding();
    s.run(1, input({ use: treatments(s.player, items)[0]!, aim: true }));
    expect(s.player.aim).toBe(0);
    s.run(1 / TICK_RATE, input({ use: 'cancel' }));
    expect(s.player.using).toBeNull();
  });

  it('ignores a stale press, and finds the med if it moved while in use', () => {
    const s = bleeding();
    const use = treatments(s.player, items)[0]!;
    s.run(0.1, input({ use: { ...use, item: 'splint' } }));
    expect(s.player.using).toBeNull();
    s.run(1, input({ use }));
    // Something else goes in front of it in the pockets list.
    s.player.gear.pockets.items.unshift(s.player.gear.pockets.items.pop()!);
    s.run(1.2);
    expect(s.player.health.bleeding[LEFT_ARM]).toBe(false);
    expect(bandages(s.player)).toBe(0);
  });

  it('carries on identically after a JSON save and restore mid-use and mid-draw', () => {
    const a = bleeding();
    a.run(0.1, input({ draw: 'primary1' }));
    a.run(0.1, input({ use: treatments(a.player, items)[0]! }));
    const b: { state: SimState } = { state: JSON.parse(JSON.stringify(a.state)) as SimState };
    const world = a.world;
    for (let i = 0; i < 2 * TICK_RATE; i++) {
      step(a.state, world, items, { [a.player.id]: input() });
      step(b.state, world, items, { [a.player.id]: input() });
    }
    expect(b.state).toEqual(a.state);
  });
});
