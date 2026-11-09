import { describe, expect, it } from 'vitest';
import type { EnemySkill } from '../content/enemies';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef, type DoorDef, type GlassDef } from '../world/collision-world';
import { AI, DEFAULT_SKILL, JUG, spawnEnemy, updateAi } from './ai';
import { createItem } from './create-item';
import { heldWeapon, stow } from './gear';
import {
  CHEST,
  HEAD,
  HEALTH,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_LEG,
  isBroken,
  killCharacter,
  shootCharacter,
  type Zone,
} from './health';
import { launchGrenade } from './grenades';
import { MOVEMENT, moveCharacter } from './movement';
import {
  createState,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimState,
} from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';
import { ammoDef, grenadeDef } from '../content/items';

/*
 * Jug (AI-7; design.md → AI → Jug): the sprint-slide, his hearing, checking noises boldly,
 * charging rather than taking cover, and the hunt along your path once you've hit him.
 * AI-8: suppression while walking in, kicking doors and smashing glass, charging at
 * grenades, the rage, stagger, and his breathing and muttering.
 */

function makeWorld(
  boxes: BoxDef[] = [],
  half = 60,
  doors: DoorDef[] = [],
  glass: GlassDef[] = [],
): CollisionWorld {
  const n = Math.ceil(half / 4) * 2;
  return new CollisionWorld({
    terrain: {
      minX: -half,
      minZ: -half,
      cellSize: 4,
      cols: n,
      rows: n,
      heights: Array((n + 1) ** 2).fill(0),
    },
    boxes,
    ramps: [],
    ladders: [],
    doors,
    glass,
  });
}

/** A wall 3 m tall from (x0, z0) to (x1, z1), 0.4 m thick, along x or z. */
function wall(x0: number, z0: number, x1: number, z1: number, height = 3): BoxDef {
  return {
    x: (x0 + x1) / 2,
    y: height / 2,
    z: (z0 + z1) / 2,
    hx: Math.max(0.2, Math.abs(x1 - x0) / 2),
    hy: height / 2,
    hz: Math.max(0.2, Math.abs(z1 - z0) / 2),
    yaw: 0,
  };
}

const JUG_SKILL: EnemySkill = {
  ...DEFAULT_SKILL,
  holdChance: 0,
  hearing: 2,
  bold: true,
  charge: true,
  slide: true,
  relentless: true,
  smash: true,
  enrage: true,
  stagger: true,
};

function jug(
  state: SimState,
  world: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
  skill: EnemySkill = JUG_SKILL,
): Character {
  const c = spawnEnemy(state, world, x, 0, z, yaw, { faction: 'boss', skill });
  giveWeapon(c, items, 'rifle');
  // Loaded like his 100-round drum: the test rifle's own 30 go in two of his bursts.
  heldWeapon(c)!.mag = 100;
  stow(c, items, createItem(items, 'round', 300));
  return c;
}

/** You, at (x, z), too tough to die. */
function you(state: SimState, world: CollisionWorld, x: number, z: number, y?: number): Character {
  const c = spawnCharacter(state, world, x, z, 0, y);
  c.health.hp.fill(1e6);
  return c;
}

function run(
  state: SimState,
  world: CollisionWorld,
  nav: NavGrid,
  seconds: number,
  each?: () => void,
  inputs: () => Record<number, PlayerInput> = () => ({}),
): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(state, world, items, inputs(), nav);
    each?.();
  }
}

function stand(): PlayerInput {
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
  };
}

/** Input walking (or sprinting) c towards (x, z), or standing once there. */
function toward(c: Character, x: number, z: number, sprint = false): PlayerInput {
  const input = stand();
  const d = Math.hypot(x - c.x, z - c.z);
  if (d < 0.3) return input;
  input.yaw = Math.atan2(-(x - c.x), -(z - c.z));
  input.moveY = 1;
  input.sprint = sprint;
  return input;
}

/** You hit c with a round, as from a gun: it knows straight away. */
function hit(
  state: SimState,
  world: CollisionWorld,
  nav: NavGrid,
  c: Character,
  by: Character,
  damage = 1,
  zone: Zone = CHEST,
) {
  state.events.length = 0;
  shootCharacter(state, items, c, zone, { ...ammoDef(items, 'round'), damage }, by.id);
  updateAi(state, world, items, nav);
}

describe('the sprint-slide', () => {
  /** Sprints c forward (−z) a second, presses slide, and measures what follows. */
  function slideOf(c: Character, world: CollisionWorld) {
    const input = stand();
    input.moveY = 1;
    input.sprint = true;
    for (let i = 0; i < TICK_RATE; i++) moveCharacter(c, input, world);
    input.sprint = false;
    input.slide = true;
    const z0 = c.z;
    moveCharacter(c, input, world);
    input.slide = false;
    let ticks = 1;
    let low = c.height;
    while (c.slide && ticks < 5 * TICK_RATE) {
      moveCharacter(c, input, world);
      low = Math.min(low, c.height);
      ticks++;
    }
    return { slid: ticks > 1, distance: z0 - c.z, seconds: ticks / TICK_RATE, low };
  }

  it('goes low and fast for under a second, only for an enemy with the skill', () => {
    const world = makeWorld();
    const state = createState(1);
    const s = slideOf(jug(state, world, 0, 30, 0), world);
    expect(s.slid).toBe(true);
    expect(s.seconds).toBeCloseTo(MOVEMENT.slideTime, 1);
    // Faster than a walk from the slide's time: 3–4.5 m.
    expect(s.distance).toBeGreaterThan(3);
    expect(s.distance).toBeLessThan(4.5);
    expect(s.low).toBeLessThanOrEqual(MOVEMENT.slideHeight + 0.01);

    // A player pressing it, or another enemy, doesn't slide.
    for (const c of [
      spawnCharacter(state, world, 10, 30),
      spawnEnemy(state, world, 20, 0, 30, 0, { skill: DEFAULT_SKILL }),
    ]) {
      const other = slideOf(c, world);
      expect(other.slid).toBe(false);
      expect(c.slide ?? null).toBeNull();
    }
  });

  it('ends against a wall in the way', () => {
    // A wall 2.5 m past where the sprint ends.
    const world = makeWorld([wall(-3, 21, 3, 21)]);
    const state = createState(1);
    const c = jug(state, world, 0, 30, 0);
    const s = slideOf(c, world);
    expect(s.slid).toBe(true);
    expect(s.seconds).toBeLessThan(MOVEMENT.slideTime - 0.2);
    expect(c.z).toBeGreaterThan(21);
  });
});

describe('Jug', () => {
  it('hears footsteps twice as far as anyone', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const heard = (skill: EnemySkill): boolean => {
      const state = createState(3);
      // Facing away (−z), you sprinting across 25 m behind it.
      const c = jug(state, world, 0, 0, 0, skill);
      const me = you(state, world, -10, 25);
      run(state, world, nav, 1.5, undefined, () => ({ [me.id]: toward(me, 10, 25, true) }));
      return c.ai!.awareness !== 'unaware';
    };
    expect(heard(JUG_SKILL)).toBe(true);
    expect(heard(DEFAULT_SKILL)).toBe(false);
  });

  it('checks gunfire straight away at a walk, past the responder cap, without stopping to watch', () => {
    // You fire behind a wall 30 m off; of three scavs nearer it, two go to check (the cap).
    const world = makeWorld([wall(-6, -26, 6, -26)]);
    const nav = new NavGrid(world);
    const check = (skill: EnemySkill) => {
      const state = createState(4);
      const scavs = [-4, 0, 4].map((x) => spawnEnemy(state, world, x, 0, -14, 0, {}));
      const c = jug(state, world, 0, 2, 0, skill);
      const me = you(state, world, 0, -30);
      giveWeapon(me, items, 'rifle');
      const shoot = stand();
      shoot.fire = true;
      shoot.pitch = 1;
      run(state, world, nav, 0.2, undefined, () => ({ [me.id]: shoot }));
      expect(scavs.filter((s) => s.ai!.investigate)).toHaveLength(AI.responders);
      const activities = new Set<string>();
      let fastest = 0;
      run(state, world, nav, 6, () => {
        activities.add(c.ai!.activity);
        fastest = Math.max(fastest, Math.hypot(c.vx, c.vz));
      });
      return { going: c.ai!.investigate, activities, fastest, z: c.z };
    };
    const bold = check(JUG_SKILL);
    expect(bold.going).toBe(true);
    expect(bold.activities.has('watch')).toBe(false);
    expect(bold.fastest).toBeGreaterThan(MOVEMENT.walkSpeed * 0.9);
    // In 6 s it's covered most of the way.
    expect(bold.z).toBeLessThan(-12);

    // An ordinary boss is held back by the cap and stays put.
    const held = check({ ...DEFAULT_SKILL, hearing: 2 });
    expect(held.going).toBe(false);
    expect(held.z).toBeGreaterThan(0);
  });

  it('walks at you firing, never into cover, and slides in firing', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const state = createState(6);
    const c = jug(state, world, 0, 0, 0);
    const me = you(state, world, 0, -28);
    let slides = 0;
    let shotSliding = 0;
    let wasSliding = false;
    let closest = Infinity;
    const activities = new Set<string>();
    run(state, world, nav, 12, () => {
      // Hurt every so often: it still doesn't hide.
      if (state.tick % TICK_RATE === 0) c.ai!.hurt = true;
      activities.add(c.ai!.activity);
      if (c.slide && !wasSliding) slides++;
      wasSliding = !!c.slide;
      if (c.slide && state.events.some((e) => e.type === 'shot' && e.by === c.id)) shotSliding++;
      closest = Math.min(closest, Math.hypot(me.x - c.x, me.z - c.z));
    });
    expect(c.ai!.awareness).toBe('alert');
    expect(activities.has('takeCover')).toBe(false);
    expect(activities.has('cover')).toBe(false);
    expect(slides).toBeGreaterThanOrEqual(1);
    expect(shotSliding).toBeGreaterThan(0);
    expect(closest).toBeLessThan(5);
  });

  /**
   * Two long walls east–west, 12 m apart: Jug south of the first, you between them, out of
   * his sight. Your way out: west past their ends, north round the second, then back east.
   */
  const corridors = (): CollisionWorld => makeWorld([wall(-30, 0, 30, 0), wall(-30, -12, 30, -12)]);
  const ROUTE = [
    [-34, -4],
    [-34, -20],
    [-8, -20],
  ] as const;

  /**
   * You running ROUTE a leg at a time, from leg `start`: the inputs, a step to call after
   * each tick, and the leg you're on.
   */
  function runRoute(me: Character, start = 0) {
    let leg = start;
    return {
      leg: () => leg,
      inputs: () => {
        const [x, z] = ROUTE[leg]!;
        return { [me.id]: toward(me, x, z, true) };
      },
      after: () => {
        const [x, z] = ROUTE[leg]!;
        if (leg < ROUTE.length - 1 && Math.hypot(me.x - x, me.z - z) < 0.5) leg++;
      },
    };
  }

  it('once hit, hunts you along the way you went, unlike anyone else', () => {
    const chase = (skill: EnemySkill) => {
      const world = corridors();
      const nav = new NavGrid(world);
      const state = createState(7);
      const c = jug(state, world, 0, 6, 0, skill);
      const me = you(state, world, 0, -4);
      hit(state, world, nav, c, me);
      const r = runRoute(me);
      let corner = Infinity;
      const activities = new Set<string>();
      run(
        state,
        world,
        nav,
        45,
        () => {
          r.after();
          activities.add(c.ai!.activity);
          corner = Math.min(corner, Math.hypot(c.x - ROUTE[0][0], c.z - ROUTE[0][1]));
        },
        r.inputs,
      );
      return { state, world, nav, c, me, corner, activities };
    };
    // Round the walls' end the way you went, never searching, and on to you.
    const { state, world, nav, c, me, corner, activities } = chase(JUG_SKILL);
    expect(c.ai!.quarry).toBe(me.id);
    expect(corner).toBeLessThan(4);
    expect(activities.has('search')).toBe(false);
    expect(c.ai!.awareness).toBe('alert');
    expect(c.ai!.seesTarget).toBe(true);
    expect(Math.hypot(c.x - me.x, c.z - me.z)).toBeLessThan(10);

    // An ordinary boss goes to where it was hit from, searches about, and loses you.
    const other = chase(DEFAULT_SKILL);
    expect(other.activities.has('search')).toBe(true);
    expect(other.c.ai!.awareness).not.toBe('alert');
    expect(Math.hypot(other.c.x - other.me.x, other.c.z - other.me.z)).toBeGreaterThan(15);

    // Over once you're dead.
    killCharacter(state, me, 0);
    run(state, world, nav, 1);
    expect(c.ai!.quarry ?? 0).toBe(0);
  });

  it('never gives up a hunt on you out of reach, unlike anyone else', () => {
    // You shut in a walled pen with no way in.
    const world = makeWorld([
      wall(-3, -13, 3, -13),
      wall(-3, -7, 3, -7),
      wall(-3, -13, -3, -7),
      wall(3, -13, 3, -7),
    ]);
    const nav = new NavGrid(world);
    const hunts = (skill: EnemySkill): boolean => {
      const state = createState(8);
      const c = jug(state, world, 0, 8, 0, skill);
      const me = you(state, world, 0, -10);
      hit(state, world, nav, c, me);
      let calmed = false;
      run(state, world, nav, AI.giveUp + 15, () => (calmed ||= c.ai!.awareness !== 'alert'));
      expect(c.ai!.reachable).toBe(false);
      return !calmed && c.ai!.target === me.id;
    };
    expect(hunts(JUG_SKILL)).toBe(true);
    expect(hunts({ ...JUG_SKILL, relentless: false })).toBe(false);
  });

  it('a raid saved mid-hunt carries on the same', () => {
    const world = corridors();
    const nav = new NavGrid(world);
    const state = createState(9);
    const c = jug(state, world, 0, 6, 0);
    const me = you(state, world, 0, -4);
    hit(state, world, nav, c, me);
    const r = runRoute(me);
    run(state, world, nav, 3, r.after, r.inputs);
    expect(c.ai!.seesTarget).toBe(false);
    expect(c.ai!.trail!.length).toBeGreaterThan(3);
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    const meCopy = copy.entities.find((e) => e.id === me.id)!;
    const rc = runRoute(meCopy, r.leg());
    run(state, world, nav, 4, r.after, r.inputs);
    run(copy, world, nav, 4, rc.after, rc.inputs);
    expect(copy.entities.map((e) => [e.x, e.z])).toEqual(state.entities.map((e) => [e.x, e.z]));
  });
});

describe('Jug, AI-8', () => {
  it('pins you behind thin cover, walking in with the trigger held, unlike anyone else', () => {
    // A counter 1.35 m tall 16 m off: standing behind it your head shows; crouched, nothing.
    const world = makeWorld([{ x: 0, y: 0.675, z: -16, hx: 2, hy: 0.675, hz: 0.3, yaw: 0 }]);
    const nav = new NavGrid(world);
    const pin = (skill: EnemySkill) => {
      const state = createState(11);
      const c = jug(state, world, 0, 0, 0, skill);
      c.health.hp.fill(1e6);
      const me = you(state, world, 0, -17.2);
      run(state, world, nav, 3);
      expect(c.ai!.awareness).toBe('alert');
      const z0 = c.z;
      let unseenShots = 0;
      let sprinted = false;
      const crouch = stand();
      crouch.crouch = true;
      run(
        state,
        world,
        nav,
        4,
        () => {
          if (c.ai!.seesTarget || c.ai!.unseen < 0.3) return;
          for (const e of state.events) if (e.type === 'shot' && e.by === c.id) unseenShots++;
          sprinted ||= c.ai!.input.sprint;
        },
        () => ({ [me.id]: crouch }),
      );
      return { unseenShots, sprinted, closer: z0 - c.z };
    };
    const jugPin = pin(JUG_SKILL);
    // Held down: about 10 rounds a second, less a reload.
    expect(jugPin.unseenShots).toBeGreaterThan(15);
    expect(jugPin.sprinted).toBe(false);
    expect(jugPin.closer).toBeGreaterThan(3);
    // Without charging it doesn't fire at what it can't see.
    expect(pin({ ...JUG_SKILL, charge: false }).unseenShots).toBe(0);
  });

  it('comes round low cover that shows only your head and shoots you, not the cover', () => {
    // You crouched close behind a counter 16 m off; from its end only your head shows.
    const world = makeWorld([{ x: 0, y: 0.675, z: -16, hx: 2, hy: 0.675, hz: 0.3, yaw: 0 }]);
    const nav = new NavGrid(world);
    const state = createState(11);
    const c = jug(state, world, 0, 0, 0);
    c.health.hp.fill(1e6);
    const me = you(state, world, 0, -16.9);
    const crouch = stand();
    crouch.crouch = true;
    let hits = 0;
    let closeShots = 0;
    let closeMisses = 0;
    run(
      state,
      world,
      nav,
      12,
      () => {
        const close = Math.hypot(c.x - me.x, c.z - me.z) < JUG.chargeClose;
        for (const e of state.events) {
          if (e.type === 'damage' && e.target === me.id) hits++;
          if (e.type === 'shot' && e.by === c.id && close) {
            closeShots++;
            if (e.hit === 'world') closeMisses++;
          }
        }
      },
      () => (state.tick < TICK_RATE ? {} : { [me.id]: crouch }),
    );
    // Before (2026-11-08) he stood at the counter's end firing into it, or not at all.
    expect(hits).toBeGreaterThan(15);
    expect(closeShots).toBeGreaterThan(15);
    expect(closeMisses / closeShots).toBeLessThan(0.25);
  });

  /** A wall across z = 5 with a closed door 1.2 m wide in it at x = 0. */
  const doorway = (): CollisionWorld =>
    makeWorld([wall(-30, 5, -0.6, 5), wall(0.6, 5, 30, 5)], 60, [
      {
        x: 0,
        y: 0,
        z: 5,
        yaw: 0,
        width: 1.2,
        height: 2.1,
        thickness: 0.05,
        hinge: 'left',
        key: undefined,
        open: false,
      },
    ]);

  it('kicks a door open from further off, loud, only while alert', () => {
    const world = doorway();
    const nav = new NavGrid(world);
    const through = (skill: EnemySkill, alert: boolean) => {
      const state = createState(12);
      // Jug north of the door, you south of it.
      const c = jug(state, world, 0, 12, 0, skill);
      const me = you(state, world, 0, -4);
      if (alert) hit(state, world, nav, c, me);
      else {
        // Unaware: sent to check a noise past the door.
        c.ai!.awareness = 'suspicious';
        c.ai!.activity = 'investigate';
        c.ai!.investigate = true;
        c.ai!.focusX = 0;
        c.ai!.focusY = 0;
        c.ai!.focusZ = -2;
      }
      let result = '';
      let from = 0;
      run(state, world, nav, 6, () => {
        for (const e of state.events) {
          if (e.type !== 'door' || result) continue;
          result = e.result;
          from = Math.abs(c.z - 5);
        }
      });
      return { result, from };
    };
    const kicked = through(JUG_SKILL, true);
    expect(kicked.result).toBe('kicked');
    expect(kicked.from).toBeGreaterThan(1.4);
    const plain = through({ ...JUG_SKILL, smash: false }, true);
    expect(plain.result).toBe('opened');
    expect(plain.from).toBeLessThan(1.3);
    expect(through(JUG_SKILL, false).result).toBe('opened');
  });

  it('a kicked door is heard by hostile enemies nearby, not his allies', () => {
    const world = doorway();
    const nav = new NavGrid(world);
    const state = createState(13);
    const c = jug(state, world, 0, 12, 0);
    const me = you(state, world, 0, -4);
    me.admin = {
      infiniteHealth: false,
      infiniteAmmo: false,
      peaceful: true,
      infiniteConsumables: false,
    };
    // The far side of the wall, 9 m from the door, facing away: heard through the wall.
    const pmc = spawnEnemy(state, world, 8, 0, 0, 0, { faction: 'pmc' });
    const scav = spawnEnemy(state, world, -8, 0, 0, 0, {});
    c.ai!.awareness = 'alert';
    c.ai!.activity = 'engage';
    c.ai!.target = me.id;
    c.ai!.seesTarget = false;
    c.ai!.unseen = 2;
    c.ai!.focusX = 0;
    c.ai!.focusY = 0;
    c.ai!.focusZ = -2;
    // Unaware until the tick of the kick, then suspicious of it.
    let before = '';
    let after = '';
    run(state, world, nav, 6, () => {
      const kick = state.events.some((e) => e.type === 'door' && e.result === 'kicked');
      if (kick) after = pmc.ai!.awareness;
      else if (!after) before = pmc.ai!.awareness;
    });
    expect(before).toBe('unaware');
    expect(after).toBe('suspicious');
    expect(pmc.ai!.investigate).toBe(true);
    expect(scav.ai!.awareness).toBe('unaware');
  });

  it('smashes a pane in his way, unarmed even, unlike anyone else', () => {
    // A pane 1 m in front of him, you behind it in plain view.
    const pane: GlassDef = { x: 0, y: 0, z: -1, yaw: 0, width: 4, height: 2.5, thickness: 0.02 };
    const world = makeWorld([], 60, [], [pane]);
    const nav = new NavGrid(world);
    const smashed = (skill: EnemySkill): boolean => {
      const state = createState(14);
      const c = spawnEnemy(state, world, 0, 0, 0, 0, { faction: 'boss', skill });
      const me = you(state, world, 0, -6);
      hit(state, world, nav, c, me);
      let by = 0;
      run(state, world, nav, 1, () => {
        for (const e of state.events) if (e.type === 'glass') by = e.by;
      });
      return by === c.id && state.glass[0] === true;
    };
    expect(smashed(JUG_SKILL)).toBe(true);
    expect(smashed({ ...JUG_SKILL, smash: false })).toBe(false);
  });

  it('charges at a grenade he sees rather than running from it', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const meets = (skill: EnemySkill) => {
      const state = createState(15);
      // Facing −z; you behind him, out of his view.
      const c = jug(state, world, 0, 0, 0, skill);
      const me = you(state, world, 0, 30);
      // A frag landing 7 m ahead of him, to the side.
      const g = launchGrenade(state, me, world, grenadeDef(items, 'grenade'), 0, 0, 0);
      g.x = 3;
      g.y = 0.1;
      g.z = -7;
      g.vx = g.vy = g.vz = 0;
      g.resting = true;
      const d0 = Math.hypot(g.x - c.x, g.z - c.z);
      let fled = false;
      let fastest = 0;
      run(state, world, nav, 1.5, () => {
        fled ||= !!c.ai!.flee;
        fastest = Math.max(fastest, Math.hypot(c.vx, c.vz));
      });
      return { fled, fastest, closer: d0 - Math.hypot(g.x - c.x, g.z - c.z), c, me };
    };
    const charged = meets(JUG_SKILL);
    expect(charged.fled).toBe(false);
    expect(charged.closer).toBeGreaterThan(3);
    expect(charged.fastest).toBeGreaterThan(MOVEMENT.walkSpeed + 0.5);
    expect(charged.c.ai!.target).toBe(charged.me.id);
    // Anyone else runs.
    expect(meets(DEFAULT_SKILL).fled).toBe(true);
  });

  /** A wall between Jug (south of it, facing away) and you north of it. */
  const camped = () => {
    const world = makeWorld([wall(-8, 6, 8, 6)]);
    const nav = new NavGrid(world);
    const state = createState(16);
    const c = jug(state, world, 0, 0, 0);
    c.health.hp.fill(1e6);
    stow(c, items, createItem(items, 'smoke', 1));
    const me = you(state, world, 0, 9);
    return { world, nav, state, c, me };
  };

  it('badly hurt by someone he cannot see: smoke at his feet, blind fire, then a charge', () => {
    const { world, nav, state, c, me } = camped();
    hit(state, world, nav, c, me, 50, LEFT_LEG);
    expect(c.ai!.rage).toBeTruthy();
    // Dropped as the rage starts, on the tick of the hit.
    let smoke = state.events.some((e) => e.type === 'throw' && e.by === c.id && e.item === 'smoke');
    let blindShots = 0;
    let sprinted = false;
    run(state, world, nav, JUG.rageFire + 2, () => {
      for (const e of state.events) {
        if (e.type === 'throw' && e.by === c.id && e.item === 'smoke') smoke = true;
        if (e.type === 'shot' && e.by === c.id && !c.ai!.seesTarget) blindShots++;
      }
      sprinted ||= Math.hypot(c.vx, c.vz) > MOVEMENT.walkSpeed + 0.5;
    });
    expect(smoke).toBe(true);
    expect(state.grenades.some((g) => g.item === 'smoke') || state.smokes.length > 0).toBe(true);
    expect(blindShots).toBeGreaterThan(5);
    expect(sprinted).toBe(true);

    // A light hit doesn't do it.
    const light = camped();
    hit(light.state, light.world, light.nav, light.c, light.me, 10, LEFT_LEG);
    expect(light.c.ai!.rage ?? null).toBeNull();
  });

  it('a raid saved mid-rage carries on the same', () => {
    const { world, nav, state, c, me } = camped();
    hit(state, world, nav, c, me, 50, LEFT_LEG);
    run(state, world, nav, 1);
    expect(c.ai!.rage).toBeTruthy();
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    run(state, world, nav, 4);
    run(copy, world, nav, 4);
    expect(copy.entities.map((e) => [e.x, e.z])).toEqual(state.entities.map((e) => [e.x, e.z]));
  });

  it('heavy rounds stagger him: aim thrown off, no firing for a moment', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const shot = (damage: number, skill: EnemySkill = JUG_SKILL) => {
      const state = createState(17);
      const c = jug(state, world, 0, 0, 0, skill);
      c.health.hp.fill(1e6);
      const me = you(state, world, 0, -15);
      run(state, world, nav, 2);
      expect(c.ai!.awareness).toBe('alert');
      const before = c.ai!.aimError;
      hit(state, world, nav, c, me, damage);
      const thrown = c.ai!.aimError - before;
      let fired = false;
      run(state, world, nav, JUG.staggerTime - 0.1, () => {
        fired ||= state.events.some((e) => e.type === 'shot' && e.by === c.id);
      });
      return { thrown, fired, staggered: (c.ai!.stagger ?? 0) > 0 || !fired };
    };
    const heavy = shot(80);
    expect(heavy.thrown).toBeGreaterThan((JUG.staggerAim - 1) * (Math.PI / 180));
    expect(heavy.fired).toBe(false);
    // A light round only flinches it.
    expect(shot(30).thrown).toBeLessThan(5 * (Math.PI / 180));
    // Nor does anyone without the weakness stagger.
    expect(shot(80, { ...JUG_SKILL, stagger: false }).thrown).toBeLessThan(5 * (Math.PI / 180));
  });

  it('has twice the HP in his arms and legs, head and chest as anyone', () => {
    const world = makeWorld();
    const state = createState(19);
    const c = spawnEnemy(state, world, 0, 0, 0, 0, {
      faction: 'boss',
      skill: JUG_SKILL,
      limbHealth: 2,
    });
    for (let z = LEFT_ARM; z <= RIGHT_LEG; z++) expect(c.health.hp[z]).toBe(HEALTH.maxHp[z]! * 2);
    expect(c.health.hp[HEAD]).toBe(HEALTH.maxHp[HEAD]);
    expect(c.health.hp[CHEST]).toBe(HEALTH.maxHp[CHEST]);
    // A leg that breaks after two 45-damage rounds takes four.
    const round = { ...ammoDef(items, 'round'), damage: 45, bleedChance: 0 };
    const hitsToBreak = (e: Character): number => {
      let n = 0;
      while (!isBroken(e.health, LEFT_LEG) && n < 10) {
        shootCharacter(state, items, e, LEFT_LEG, round, 0);
        n++;
      }
      return n;
    };
    expect(hitsToBreak(spawnEnemy(state, world, 5, 0, 0, 0, { faction: 'boss' }))).toBe(2);
    expect(hitsToBreak(c)).toBe(4);
  });

  it('breathes and mutters while calm, only if his type has the lines, not while fighting', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const lines = (voiced: boolean, fight: boolean) => {
      const state = createState(18);
      const c = spawnEnemy(state, world, 0, 0, 0, 0, { faction: 'boss', skill: JUG_SKILL, voiced });
      giveWeapon(c, items, 'rifle');
      stow(c, items, createItem(items, 'round', 300));
      c.health.hp.fill(1e6);
      if (fight) you(state, world, 0, -12);
      const said: string[] = [];
      run(state, world, nav, 13, () => {
        for (const e of state.events) if (e.type === 'voice' && e.by === c.id) said.push(e.line);
      });
      return said;
    };
    const calm = lines(true, false);
    expect(calm.filter((l) => l === 'breathe').length).toBeGreaterThanOrEqual(1);
    expect(calm.filter((l) => l === 'mutter').length).toBeGreaterThanOrEqual(1);
    expect(calm.length).toBeGreaterThanOrEqual(3);
    expect(lines(false, false)).toEqual([]);
    expect(lines(true, true)).toEqual([]);
  });
});

describe('local AI fights, and Jug on his ground (2026-11-08)', () => {
  it('a PMC and a scav in plain view fight within 35 m, not 50, unless one shoots', () => {
    const fights = (dist: number, shot: boolean): boolean => {
      const world = makeWorld();
      const nav = new NavGrid(world);
      const state = createState(5);
      const p = spawnEnemy(state, world, 0, 0, 0, 0, { faction: 'pmc', skill: DEFAULT_SKILL });
      const sc = spawnEnemy(state, world, 0, 0, -dist, Math.PI, { skill: DEFAULT_SKILL });
      if (shot) hit(state, world, nav, p, sc);
      run(state, world, nav, 12);
      return p.ai!.target === sc.id && p.ai!.awareness === 'alert';
    };
    expect(fights(25, false)).toBe(true);
    expect(fights(50, false)).toBe(false);
    expect(fights(50, true)).toBe(true);
  });

  /** Jug patrolling one point at the origin, his ground 20 m round it; a shot at (x, z). */
  const hears = (x: number, z: number, byPmc: boolean) => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const state = createState(6);
    const c = spawnEnemy(state, world, 0, 0, 0, 0, {
      faction: 'boss',
      skill: { ...JUG_SKILL, territory: 20 },
      patrol: { points: [{ x: 0, y: 0, z: 0, wait: 30, radius: 0 }], repeatFrom: 0, loop: true },
    });
    giveWeapon(c, items, 'rifle');
    const shooter = byPmc
      ? spawnEnemy(state, world, x, 0, z, 0, { faction: 'pmc', skill: DEFAULT_SKILL })
      : you(state, world, x, z);
    state.events.length = 0;
    state.events.push({
      type: 'shot',
      by: shooter.id,
      fromX: x,
      fromY: 1.6,
      fromZ: z,
      toX: x,
      toY: 100,
      toZ: z,
      hit: 'none',
      target: 0,
      loudness: 150,
      pellet: 0,
      grenade: 0,
      flame: 0,
    });
    updateAi(state, world, items, nav);
    return c.ai!.awareness !== 'unaware';
  };

  it("he doesn't go to AI gunfire off his ground, but does on it, and to yours anywhere", () => {
    expect(hears(0, -45, true)).toBe(false);
    expect(hears(0, -15, true)).toBe(true);
    expect(hears(0, -45, false)).toBe(true);
  });

  it('he goes out to check your gunfire near his ground, and only turns to look further off', () => {
    const check = (z: number, roam?: number) => {
      const world = makeWorld([], 120);
      const nav = new NavGrid(world);
      const state = createState(6);
      const c = spawnEnemy(state, world, 0, 0, 0, 0, {
        faction: 'boss',
        skill: { ...JUG_SKILL, territory: 20, ...(roam !== undefined && { roam }) },
        patrol: { points: [{ x: 0, y: 0, z: 0, wait: 30, radius: 0 }], repeatFrom: 0, loop: true },
      });
      giveWeapon(c, items, 'rifle');
      const me = you(state, world, 0, z);
      state.events.length = 0;
      state.events.push({
        type: 'shot',
        by: me.id,
        fromX: 0,
        fromY: 1.6,
        fromZ: z,
        toX: 0,
        toY: 100,
        toZ: z,
        hit: 'none',
        target: 0,
        loudness: 150,
        pellet: 0,
        grenade: 0,
        flame: 0,
      });
      updateAi(state, world, items, nav);
      const heard = c.ai!.awareness !== 'unaware';
      const goes = c.ai!.investigate;
      // Peaceful now, so it doesn't see you: where does it go?
      me.admin = {
        infiniteHealth: false,
        infiniteAmmo: false,
        peaceful: true,
        infiniteConsumables: false,
      };
      let far = 0;
      run(state, world, nav, 15, () => (far = Math.max(far, Math.hypot(c.x, c.z))));
      return { heard, goes, far };
    };
    // 50 m off: within 45 m of his 20 m ground, he goes.
    const near = check(-50, 45);
    expect(near.goes).toBe(true);
    expect(near.far).toBeGreaterThan(30);
    // 80 m off: he hears it and turns, but stays.
    const far = check(-80, 45);
    expect(far.heard).toBe(true);
    expect(far.goes).toBe(false);
    expect(far.far).toBeLessThan(20);
    // Without the limit he'd have gone.
    expect(check(-80).goes).toBe(true);
  });

  it('he hunts a player who shoots him, not an AI', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const state = createState(7);
    const c = jug(state, world, 0, 0, 0);
    const p = spawnEnemy(state, world, 0, 0, -20, Math.PI, {
      faction: 'pmc',
      skill: DEFAULT_SKILL,
    });
    hit(state, world, nav, c, p);
    expect(c.ai!.quarry ?? 0).toBe(0);
    const me = you(state, world, 10, -20);
    hit(state, world, nav, c, me);
    expect(c.ai!.quarry).toBe(me.id);
  });
});

describe('Jug bandaging (2026-11-08)', () => {
  it('bandages a bleed out of sight where he stands, never going for cover', () => {
    // He sees you, then you're behind a wall; a crate stands beside him he could hide by.
    const world = makeWorld([
      wall(-6, -3, 6, -3),
      { x: 4, y: 0.75, z: -15, hx: 0.8, hy: 0.75, hz: 0.8, yaw: 0 },
    ]);
    const nav = new NavGrid(world);
    const state = createState(12);
    const c = jug(state, world, 0, -15, Math.PI, { ...JUG_SKILL, heals: true });
    c.health.hp.fill(1e3);
    stow(c, items, createItem(items, 'bandage', 1));
    const me = you(state, world, 1, -8);
    run(state, world, nav, 3);
    expect(c.ai!.awareness).toBe('alert');
    me.x = 0;
    me.z = 3;
    c.health.bleeding[LEFT_LEG] = true;
    let covered = false;
    let used = false;
    run(state, world, nav, 6, () => {
      if (c.ai!.activity === 'takeCover' || c.ai!.activity === 'cover') covered = true;
      if (c.using?.item === 'bandage') used = true;
    });
    expect(used).toBe(true);
    expect(c.health.bleeding[LEFT_LEG]).toBe(false);
    expect(covered).toBe(false);
  });
});
