import { describe, expect, it } from 'vitest';
import type { EnemySkill } from '../content/enemies';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { AI, DEFAULT_SKILL, TACTICS, joinSquad, spawnEnemy, updateAi } from './ai';
import { heldWeapon } from './gear';
import type { MedUse } from './meds';
import { createState, spawnCharacter, type Character, type SimState } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';

/*
 * How PMCs fight (AI rework session 5): the callout, sprinting to cover and leaving it
 * sooner, pushing on a reload or heal they hear, and a squad splitting into holders firing
 * at your cover and flankers.
 */

function makeWorld(boxes: BoxDef[] = [], half = 60): CollisionWorld {
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
  });
}

/** A wall 3 m tall from (x0, z0) to (x1, z1), 0.4 m thick, along x or z. */
function wall(x0: number, z0: number, x1: number, z1: number): BoxDef {
  return {
    x: (x0 + x1) / 2,
    y: 1.5,
    z: (z0 + z1) / 2,
    hx: Math.max(0.2, Math.abs(x1 - x0) / 2),
    hy: 1.5,
    hz: Math.max(0.2, Math.abs(z1 - z0) / 2),
    yaw: 0,
  };
}

const PMC_SKILL: EnemySkill = {
  ...DEFAULT_SKILL,
  coverTime: [0.6, 1.4],
  sprintToCover: true,
  listen: 10,
};

function pmc(
  state: SimState,
  world: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
  skill: EnemySkill = PMC_SKILL,
): Character {
  const c = spawnEnemy(state, world, x, 0, z, yaw, { faction: 'pmc', skill });
  giveWeapon(c, items, 'rifle');
  return c;
}

function squad(team: Character[]): void {
  team.forEach((c, i) => joinSquad(c, team[0]!.id, i));
}

/** You, at (x, z), too tough to die. */
function you(state: SimState, world: CollisionWorld, x: number, z: number): Character {
  const c = spawnCharacter(state, world, x, z);
  c.health.hp.fill(1e6);
  return c;
}

/** Runs ticks, calling each after every one. */
function run(
  state: SimState,
  world: CollisionWorld,
  nav: NavGrid,
  seconds: number,
  each?: () => void,
): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(state, world, items, {}, nav);
    each?.();
  }
}

describe('PMC fighting', () => {
  it('calls out once when the squad spots you', () => {
    const state = createState(1);
    const world = makeWorld();
    const nav = new NavGrid(world);
    const team = [0, 1, 2].map((i) => pmc(state, world, i * 3, 0, 0));
    squad(team);
    const me = you(state, world, 3, -15);
    const callers: number[] = [];
    run(state, world, nav, 3, () => {
      for (const e of state.events)
        if (e.type === 'callout') {
          expect(e.target).toBe(me.id);
          callers.push(e.by);
        }
    });
    expect(team.every((m) => m.ai!.awareness === 'alert')).toBe(true);
    expect(callers).toHaveLength(1);

    // Lone enemies don't call out.
    const lone = createState(1);
    pmc(lone, world, 0, 0, 0);
    you(lone, world, 0, -15);
    let any = false;
    run(lone, world, nav, 3, () => {
      any ||= lone.events.some((e) => e.type === 'callout');
    });
    expect(any).toBe(false);
  });

  it('sprints to cover and stays there less long than its default', () => {
    // A long wall east of it, between you and the ground beyond.
    const world = makeWorld([wall(4, -4, 14, -4)]);
    const nav = new NavGrid(world);
    const stays = (skill: EnemySkill): { sprinted: boolean; longest: number } => {
      const state = createState(5);
      const c = pmc(state, world, 0, 0, 0, skill);
      you(state, world, 0, -20);
      run(state, world, nav, 5);
      expect(c.ai!.awareness).toBe('alert');
      let sprinted = false;
      let inCover = 0;
      let longest = 0;
      for (let k = 0; k < 4; k++) {
        c.ai!.hurt = true;
        run(state, world, nav, 4, () => {
          if (c.ai!.activity === 'takeCover' && c.ai!.input.sprint) sprinted = true;
          inCover = c.ai!.activity === 'cover' ? inCover + 1 / TICK_RATE : 0;
          longest = Math.max(longest, inCover);
        });
      }
      return { sprinted, longest };
    };
    const pmcStays = stays(PMC_SKILL);
    const scavStays = stays(DEFAULT_SKILL);
    expect(pmcStays.sprinted).toBe(true);
    expect(scavStays.sprinted).toBe(false);
    expect(pmcStays.longest).toBeGreaterThan(0);
    expect(pmcStays.longest).toBeLessThanOrEqual(1.4 + 2 / TICK_RATE);
    expect(scavStays.longest).toBeGreaterThanOrEqual(AI.coverTime[0]);
  });

  it('hearing you reload round a corner, it comes round it at you', () => {
    // You behind the end of a wall, 9 m off; it had lost you and was searching elsewhere.
    const world = makeWorld([wall(2, -14, 2, -2)]);
    const nav = new NavGrid(world);
    const trial = (skill: EnemySkill, at: number): { sees: number; c: Character } => {
      const state = createState(3);
      const c = pmc(state, world, 0, 0, 0, skill);
      const me = you(state, world, 4, at);
      giveWeapon(me, items, 'rifle');
      const ai = c.ai!;
      ai.awareness = 'searching';
      ai.activity = 'searchScan';
      ai.target = me.id;
      ai.focusX = -30;
      ai.focusY = 0;
      ai.focusZ = 30;
      ai.timer = 10;
      heldWeapon(me)!.reloading = 3;
      let sees = -1;
      let t = 0;
      run(state, world, nav, 5, () => {
        t += 1 / TICK_RATE;
        if (sees < 0 && ai.seesTarget) sees = t;
      });
      return { sees, c };
    };
    const heard = trial(PMC_SKILL, -8);
    expect(heard.sees).toBeGreaterThan(0);
    expect(heard.sees).toBeLessThan(4);
    // Deaf to it, or too far to hear it: it searches on, the other way.
    expect(trial(DEFAULT_SKILL, -8).sees).toBe(-1);
    expect(trial(PMC_SKILL, -13).sees).toBe(-1);
  });

  it('hearing you heal while it fights you out of sight, it pushes, not hiding', () => {
    const world = makeWorld([wall(2, -14, 2, -2)]);
    const nav = new NavGrid(world);
    const state = createState(3);
    const c = pmc(state, world, 0, 0, 0);
    const me = you(state, world, 4, -8);
    const ai = c.ai!;
    ai.awareness = 'alert';
    ai.activity = 'cover';
    ai.target = me.id;
    ai.timer = 10;
    me.using = { left: 3 } as MedUse;
    // On its perception tick.
    while ((state.tick + c.id) % AI.perceiveEvery !== 0) state.tick++;
    updateAi(state, world, items, nav);
    expect(ai.activity).toBe('engage');
    expect(ai.rush).toBeGreaterThan(TACTICS.rushTime - 0.1);
    expect(Math.hypot(ai.focusX - me.x, ai.focusZ - me.z)).toBeLessThan(0.01);
  });

  it('losing you behind cover, the squad splits: the leader fires at it, the other flanks', () => {
    // A wall between you and the squad, 2 m in front of you.
    const world = makeWorld([wall(-4, -2, 4, -2)]);
    const nav = new NavGrid(world);
    const state = createState(4);
    const team = [-1.5, 1.5].map((x) => pmc(state, world, x, -20, Math.PI));
    squad(team);
    const [leader, flanker] = team as [Character, Character];
    // Seen out in the open first...
    const me = you(state, world, 7, 0);
    run(state, world, nav, 5);
    expect(team.every((m) => m.ai!.awareness === 'alert')).toBe(true);
    // ...then behind the wall.
    me.x = 0;
    me.z = 0;
    let suppressed = false;
    let flanked = false;
    let onCover = 0;
    let seenAt = -1;
    let angle = 0;
    let t = 0;
    run(state, world, nav, 15, () => {
      t += 1 / TICK_RATE;
      if (leader.ai!.activity === 'suppress') suppressed = true;
      if (flanker.ai!.activity === 'flank') flanked = true;
      for (const e of state.events)
        if (e.type === 'shot' && e.by === leader.id && Math.abs(e.toZ + 2.2) < 0.3) onCover++;
      // Seen again once it's on its way round (not still, from before you moved).
      if (seenAt < 0 && flanked && flanker.ai!.seesTarget) {
        seenAt = t;
        const a = Math.atan2(flanker.z - me.z, flanker.x - me.x);
        const b = Math.atan2(leader.z - me.z, leader.x - me.x);
        angle = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) / (Math.PI / 180);
      }
    });
    expect(suppressed).toBe(true);
    expect(flanked).toBe(true);
    // The leader's rounds hit the wall in front of you.
    expect(onCover).toBeGreaterThan(3);
    // The flanker came round and saw you from well off the leader's line.
    expect(seenAt).toBeGreaterThan(0);
    expect(angle).toBeGreaterThanOrEqual(TACTICS.flankAngle - 5);
  });

  it('a squad of four splits two and two', () => {
    const world = makeWorld([wall(-4, -2, 4, -2)]);
    const nav = new NavGrid(world);
    const state = createState(6);
    const team = [-3, -1, 1, 3].map((x) => pmc(state, world, x, -20, Math.PI));
    squad(team);
    const me = you(state, world, 7, 0);
    run(state, world, nav, 5);
    me.x = 0;
    me.z = 0;
    const parts = new Map<number, string>();
    run(state, world, nav, 3, () => {
      for (const m of team) {
        const a = m.ai!.activity;
        if ((a === 'suppress' || a === 'flank') && !parts.has(m.id)) parts.set(m.id, a);
      }
    });
    expect([...parts.values()].filter((a) => a === 'suppress')).toHaveLength(2);
    expect([...parts.values()].filter((a) => a === 'flank')).toHaveLength(2);
    // By place: the leader and the first follower hold.
    expect(parts.get(team[0]!.id)).toBe('suppress');
    expect(parts.get(team[1]!.id)).toBe('suppress');
  });

  it('a raid saved mid-flank carries on the same', () => {
    const world = makeWorld([wall(-4, -2, 4, -2)]);
    const nav = new NavGrid(world);
    const state = createState(4);
    const team = [-1.5, 1.5].map((x) => pmc(state, world, x, -20, Math.PI));
    squad(team);
    const me = you(state, world, 7, 0);
    run(state, world, nav, 5);
    me.x = 0;
    me.z = 0;
    run(state, world, nav, 2);
    expect(team[1]!.ai!.activity).toBe('flank');
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    run(state, world, nav, 3);
    run(copy, world, nav, 3);
    expect(copy.entities.map((e) => [e.x, e.z])).toEqual(state.entities.map((e) => [e.x, e.z]));
  });
});
