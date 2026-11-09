import { describe, expect, it } from 'vitest';
import type { EnemySkill } from '../content/enemies';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { AI, DEFAULT_SKILL, TACTICS, joinSquad, spawnEnemy, updateAi } from './ai';
import { createItem } from './create-item';
import { equip, heldWeapon, stow } from './gear';
import { CHEST, LEFT_ARM, LEFT_LEG, shootCharacter } from './health';
import { launchGrenade } from './grenades';
import { ammoDef, grenadeDef } from '../content/items';
import type { MedUse } from './meds';
import { createState, spawnCharacter, type Character, type SimState } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';

/*
 * How PMCs fight (AI rework session 5): the callout, sprinting to cover and leaving it
 * sooner, pushing on a reload or heal they hear, and a squad splitting into holders firing
 * at your cover and flankers. AI-6: frag grenades.
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

  it('goes to cover and stays there less long than its default', () => {
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
    // Since AI-10 a PMC that sees you walks to cover firing ('walks there firing' below);
    // it sprints only out of your sight. Scavs never sprint to it.
    expect(scavStays.sprinted).toBe(false);
    expect(pmcStays.longest).toBeGreaterThan(0);
    expect(pmcStays.longest).toBeLessThanOrEqual(1.4 + 2 / TICK_RATE);
    expect(scavStays.longest).toBeGreaterThanOrEqual(AI.coverTime[0]);
  });

  it('going to cover while it sees you, it walks there firing; up close it just fights', () => {
    const go = (dist: number) => {
      // A low wall 6 m to its side to take cover behind.
      const world = makeWorld([{ x: 6, y: 0.75, z: -dist, hx: 3, hy: 0.75, hz: 0.2, yaw: 0 }]);
      const nav = new NavGrid(world);
      const state = createState(9);
      const c = pmc(state, world, 0, -dist, Math.PI);
      stow(c, items, createItem(items, 'round', 200));
      you(state, world, 0, 0);
      let toCover = 0;
      let shotsOnWay = 0;
      let sprintedSeeing = false;
      run(state, world, nav, 8, () => {
        // Hit now and then: it wants cover.
        if (state.tick % TICK_RATE === 0) c.ai!.hurt = true;
        if (c.ai!.activity !== 'takeCover') return;
        toCover++;
        if (c.ai!.seesTarget && c.ai!.input.sprint) sprintedSeeing = true;
        shotsOnWay += state.events.filter((e) => e.type === 'shot' && e.by === c.id).length;
      });
      return { toCover, shotsOnWay, sprintedSeeing };
    };
    const far = go(18);
    expect(far.toCover).toBeGreaterThan(0);
    expect(far.shotsOnWay).toBeGreaterThan(0);
    expect(far.sprintedSeeing).toBe(false);
    // Within TACTICS.closeFight it never turns its back to go for cover.
    expect(go(TACTICS.closeFight - 3).toCover).toBe(0);
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

  it('a holder that cannot put rounds on your cover moves to where it can', () => {
    // A second wall in front of the leader blocks its line to where you hide (it saw you
    // out east, past that wall's end).
    const world = makeWorld([wall(-4, -2, 4, -2), wall(-3.5, -14, 0, -14)]);
    const nav = new NavGrid(world);
    const state = createState(4);
    const team = [-1.5, 1.5].map((x) => pmc(state, world, x, -20, Math.PI));
    squad(team);
    const leader = team[0]!;
    const me = you(state, world, 7, 0);
    run(state, world, nav, 5);
    expect(leader.ai!.awareness).toBe('alert');
    me.x = 0;
    me.z = 0;
    let moved = false;
    let onCover = 0;
    run(state, world, nav, 10, () => {
      if (leader.ai!.activity === 'suppress' && leader.ai!.vantage) moved = true;
      for (const e of state.events)
        if (e.type === 'shot' && e.by === leader.id && Math.abs(e.toZ + 2.2) < 0.3) onCover++;
    });
    expect(moved).toBe(true);
    expect(onCover).toBeGreaterThan(3);
  });

  it('fires its own longer bursts', () => {
    const bursts = (skill: EnemySkill): number[] => {
      const world = makeWorld();
      const nav = new NavGrid(world);
      const state = createState(5);
      const c = pmc(state, world, 0, -25, Math.PI, skill);
      stow(c, items, createItem(items, 'round', 300));
      you(state, world, 0, 0);
      const sizes: number[] = [];
      let last = -Infinity;
      run(state, world, nav, 8, () => {
        for (const e of state.events) {
          if (e.type !== 'shot' || e.by !== c.id) continue;
          if (state.tick - last > 0.2 * TICK_RATE) sizes.push(0);
          sizes[sizes.length - 1]!++;
          last = state.tick;
        }
      });
      return sizes.slice(0, -1);
    };
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const long = bursts({ ...PMC_SKILL, burst: [6, 6], burstPause: [0.15, 0.15] });
    expect(long.length).toBeGreaterThan(3);
    expect(mean(long)).toBeGreaterThan(5);
    // Beyond 15 m an enemy without its own fires 2–3 at a time.
    expect(mean(bursts(PMC_SKILL))).toBeLessThan(3.5);
  });

  it("a squad doesn't go to other AI's gunfire, but does to yours", () => {
    const heard = (byScav: boolean): string => {
      const world = makeWorld();
      const nav = new NavGrid(world);
      const state = createState(8);
      const team = [-1.5, 1.5].map((x) => pmc(state, world, x, 0, 0));
      squad(team);
      // Behind them, 30 m off, firing into the air.
      const shooter = byScav
        ? spawnEnemy(state, world, 0, 0, 30, 0, {})
        : spawnCharacter(state, world, 0, 30);
      state.events.length = 0;
      state.events.push({
        type: 'shot',
        by: shooter.id,
        fromX: 0,
        fromY: 1.6,
        fromZ: 30,
        toX: 0,
        toY: 100,
        toZ: 30,
        hit: 'none',
        target: 0,
        loudness: 150,
        pellet: 0,
        grenade: 0,
        flame: 0,
      });
      updateAi(state, world, items, nav);
      return team[0]!.ai!.awareness;
    };
    expect(heard(true)).toBe('unaware');
    expect(heard(false)).not.toBe('unaware');
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

describe('PMC grenades', () => {
  /** A squad of n carrying `kit` each, standing `dist` m north of a 3 m wall you hide 2 m behind. */
  function behindWall(
    seed: number,
    dist: number,
    n = 2,
    kit: string[] = ['grenade'],
  ): { state: SimState; world: CollisionWorld; nav: NavGrid; team: Character[]; me: Character } {
    const world = makeWorld([wall(-4, -2, 4, -2)]);
    const nav = new NavGrid(world);
    const state = createState(seed);
    const team = Array.from({ length: n }, (_, i) =>
      pmc(state, world, (i - (n - 1) / 2) * 3, -dist, Math.PI),
    );
    for (const m of team) for (const id of kit) stow(m, items, createItem(items, id));
    squad(team);
    // Seen out in the open first, then behind the wall.
    const me = you(state, world, 7, 0);
    run(state, world, nav, 5);
    expect(team.every((m) => m.ai!.awareness === 'alert')).toBe(true);
    me.x = 0;
    me.z = 0;
    return { state, world, nav, team, me };
  }

  it('lobs a frag over your cover that lands by you; its mates take nothing', () => {
    const { state, world, nav, team, me } = behindWall(2, 18);
    const ids = new Set(team.map((m) => m.id));
    let thrown = 0;
    let off = Infinity;
    let hurt = 0;
    run(state, world, nav, 20, () => {
      for (const e of state.events) {
        if (e.type === 'throw' && ids.has(e.by)) thrown++;
        if (e.type === 'explosion' && ids.has(e.by))
          off = Math.min(off, Math.hypot(e.x - me.x, e.z - me.z));
        if (e.type === 'damage' && e.cause === 'explosion') {
          expect(ids.has(e.target)).toBe(false);
          if (e.target === me.id) hurt += e.amount;
        }
      }
    });
    expect(thrown).toBeGreaterThanOrEqual(1);
    expect(off).toBeLessThan(TACTICS.throwSlack);
    expect(hurt).toBeGreaterThan(200);
  });

  it('throws onto a roof it cannot get up to', () => {
    // A 14 m square block 4.5 m tall, with no way up; you on it, out of sight over 10 m in.
    const world = makeWorld([{ x: 0, y: 2.25, z: 0, hx: 7, hy: 2.25, hz: 7, yaw: 0 }]);
    const nav = new NavGrid(world);
    const state = createState(2);
    const c = pmc(state, world, 0, -20, Math.PI);
    stow(c, items, createItem(items, 'grenade'));
    const me = you(state, world, 0, -6);
    expect(me.y).toBeCloseTo(4.5, 1);
    run(state, world, nav, 4);
    expect(c.ai!.awareness).toBe('alert');
    me.z = 4;
    let landed: { x: number; y: number; z: number } | null = null;
    let threwFrom = '';
    run(state, world, nav, 25, () => {
      for (const e of state.events) {
        if (e.type === 'throw') threwFrom = c.ai!.activity;
        if (e.type === 'explosion' && !landed) landed = { x: e.x, y: e.y, z: e.z };
      }
    });
    expect(c.ai!.reachable).toBe(false);
    expect(threwFrom).not.toBe('');
    expect(landed!.y).toBeGreaterThan(4.5);
    expect(Math.hypot(landed!.x - me.x, landed!.z - me.z)).toBeLessThan(TACTICS.throwSlack);
  });

  it('never throws from close up, while pushing, or without a frag', () => {
    const throws = (s: SimState, seconds: number, world: CollisionWorld, nav: NavGrid): number => {
      let n = 0;
      run(s, world, nav, seconds, () => {
        n += s.events.filter((e) => e.type === 'throw').length;
      });
      return n;
    };
    // Closer than throwMin.
    for (const seed of [1, 2, 3]) {
      const { state, world, nav } = behindWall(seed, 7);
      expect(throws(state, 12, world, nav)).toBe(0);
    }
    // Only a flash and a smoke.
    for (const seed of [1, 2, 3]) {
      const { state, world, nav } = behindWall(seed, 14, 2, ['flash', 'smoke']);
      expect(throws(state, 12, world, nav)).toBe(0);
    }
    // On its own, always pushing in when it loses you.
    for (const seed of [1, 2, 3]) {
      const world = makeWorld([wall(-4, -2, 4, -2)]);
      const nav = new NavGrid(world);
      const state = createState(seed);
      const c = pmc(state, world, 0, -14, Math.PI, { ...PMC_SKILL, holdChance: 0 });
      stow(c, items, createItem(items, 'grenade'));
      const me = you(state, world, 7, 0);
      run(state, world, nav, 5);
      me.x = 0;
      me.z = 0;
      expect(throws(state, 12, world, nav)).toBe(0);
    }
  });

  it('one AI grenade at a time near a spot: the area token', () => {
    let thrown = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { state, world, nav, team } = behindWall(seed, 14, 4, ['grenade', 'grenade']);
      run(state, world, nav, 25, () => {
        thrown += state.events.filter((e) => e.type === 'throw').length;
        let live = state.grenades.length;
        for (const m of team) if (m.ai!.toss) live++;
        expect(live).toBeLessThanOrEqual(1);
      });
    }
    expect(thrown).toBeGreaterThanOrEqual(2);
  });

  it('a raid saved while it turns to throw carries on the same', () => {
    const { state, world, nav, team } = behindWall(2, 18);
    let saved: SimState | null = null;
    for (let i = 0; i < 15 * TICK_RATE && !saved; i++) {
      step(state, world, items, {}, nav);
      if (team.some((m) => m.ai!.toss)) saved = JSON.parse(JSON.stringify(state)) as SimState;
    }
    expect(saved).not.toBeNull();
    run(state, world, nav, 5);
    run(saved!, world, nav, 5);
    expect(saved!.entities.map((e) => [e.x, e.z, e.health.hp])).toEqual(
      state.entities.map((e) => [e.x, e.z, e.health.hp]),
    );
  });
});

describe('PMC healing (2026-11-08)', () => {
  const HEALER: EnemySkill = { ...PMC_SKILL, heals: true };
  const hurt = (c: Character): void => {
    c.health.bleeding[LEFT_LEG] = true;
    c.health.hp[CHEST] = 30;
  };
  const kit = (c: Character, ...ids: string[]): void => {
    // A rig, as every PMC's kit has: a medkit (1×2) doesn't go in the pockets' 1×1 slots.
    equip(c, items, 'rig', createItem(items, 'rig'));
    for (const id of ids) stow(c, items, createItem(items, id));
  };
  const usedOf = (
    state: SimState,
    c: Character,
    seconds: number,
    world: CollisionWorld,
    nav: NavGrid,
  ) => {
    const used = new Set<string>();
    run(state, world, nav, seconds, () => {
      if (c.using) used.add(c.using.item);
    });
    return used;
  };

  it('calm, it bandages its bleeding and uses a medkit, never a surgery kit', () => {
    const go = (skill: EnemySkill) => {
      const world = makeWorld();
      const nav = new NavGrid(world);
      const state = createState(1);
      const c = pmc(state, world, 0, 0, 0, skill);
      kit(c, 'bandage', 'medkit', 'surgery');
      hurt(c);
      // A broken arm a surgery kit would mend.
      c.health.hp[LEFT_ARM] = 0;
      const used = usedOf(state, c, 10, world, nav);
      return { used, c };
    };
    const healer = go(HEALER);
    expect(healer.used.has('bandage')).toBe(true);
    expect(healer.used.has('medkit')).toBe(true);
    expect(healer.used.has('surgery')).toBe(false);
    expect(healer.c.health.bleeding[LEFT_LEG]).toBe(false);
    expect(healer.c.health.hp[CHEST]).toBeGreaterThan(60);
    expect(healer.c.health.hp[LEFT_ARM]).toBe(0);
    // Without the skill (scavs), nothing.
    expect(go(PMC_SKILL).used.size).toBe(0);
  });

  it('never treats itself while it can see you: it fights', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const state = createState(2);
    const c = pmc(state, world, 0, -15, Math.PI, HEALER);
    kit(c, 'bandage', 'medkit');
    stow(c, items, createItem(items, 'round', 200));
    you(state, world, 0, 0);
    // Hurt once it's fighting you (calm, it would treat itself at once).
    run(state, world, nav, 2);
    expect(c.ai!.seesTarget).toBe(true);
    hurt(c);
    let shots = 0;
    const used = new Set<string>();
    run(state, world, nav, 6, () => {
      if (c.using) used.add(c.using.item);
      shots += state.events.filter((e) => e.type === 'shot' && e.by === c.id).length;
    });
    expect(c.ai!.seesTarget).toBe(true);
    expect(used.size).toBe(0);
    expect(shots).toBeGreaterThan(10);
  });

  /**
   * It sees you in the open, then smoke hides you (sight, not cover: from where you are it's
   * still in the open); a low wall 6 m long stands off to its side.
   */
  const lost = (withCover: boolean) => {
    const boxes = withCover ? [{ x: 6, y: 0.75, z: -14, hx: 3, hy: 0.75, hz: 0.2, yaw: 0 }] : [];
    const world = makeWorld(boxes);
    const nav = new NavGrid(world);
    const state = createState(3);
    const c = pmc(state, world, 0, -15, Math.PI, HEALER);
    kit(c, 'bandage', 'medkit');
    you(state, world, 0, 0);
    run(state, world, nav, 3);
    expect(c.ai!.awareness).toBe('alert');
    hurt(c);
    state.smokes.push({ id: 999, x: 0, y: 1, z: -8, radius: 5, age: 5, time: 60 });
    const x0 = c.x;
    const z0 = c.z;
    let farthest = 0;
    let coverAct = false;
    let usedAt: [number, number] | null = null;
    run(state, world, nav, 12, () => {
      farthest = Math.max(farthest, Math.hypot(c.x - x0, c.z - z0));
      if (c.ai!.activity === 'takeCover' || c.ai!.activity === 'cover') coverAct = true;
      if (c.using && !usedAt) usedAt = [c.x, c.z];
    });
    return { c, farthest, coverAct, usedAt: usedAt as [number, number] | null, x0, z0 };
  };

  it('losing you, it treats itself in cover nearby, not far off', () => {
    const r = lost(true);
    expect(r.coverAct).toBe(true);
    expect(r.usedAt).not.toBeNull();
    // Behind the wall from you (south of it).
    expect(r.usedAt![0]).toBeGreaterThan(2.5);
    expect(r.usedAt![1]).toBeLessThan(-14);
    expect(r.farthest).toBeLessThan(AI.coverRadius + 1);
    expect(r.c.health.bleeding[LEFT_LEG]).toBe(false);
  });

  it('with no cover nearby, it treats itself where it stands', () => {
    const r = lost(false);
    expect(r.usedAt).not.toBeNull();
    expect(r.c.health.bleeding[LEFT_LEG]).toBe(false);
  });
});

describe('PMCs against scavs, and their fire (2026-11-08)', () => {
  const SPRAYER: EnemySkill = {
    ...PMC_SKILL,
    burst: [5, 6],
    burstPause: [0.25, 0.45],
    spray: { range: 10, burst: [15, 30], pause: [0.05, 0.15] },
  };

  it('sprays full auto up close, and fires 5–6 round bursts further off', () => {
    const bursts = (dist: number): number[] => {
      const world = makeWorld();
      const nav = new NavGrid(world);
      const state = createState(5);
      const c = pmc(state, world, 0, -dist, Math.PI, SPRAYER);
      stow(c, items, createItem(items, 'round', 600));
      you(state, world, 0, 0);
      const sizes: number[] = [];
      let last = -Infinity;
      run(state, world, nav, 10, () => {
        for (const e of state.events) {
          if (e.type !== 'shot' || e.by !== c.id) continue;
          if (state.tick - last > 0.2 * TICK_RATE) sizes.push(0);
          sizes[sizes.length - 1]!++;
          last = state.tick;
        }
      });
      // The last may be cut off by the end, or by a reload.
      return sizes.slice(0, -1).filter((n) => n > 1);
    };
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const close = bursts(6);
    const far = bursts(25);
    expect(mean(close)).toBeGreaterThan(12);
    expect(mean(far)).toBeGreaterThan(4.5);
    expect(mean(far)).toBeLessThan(6.5);
  });

  it('a PMC is slower to notice a boss, and to fire at one, than at you', () => {
    const go = (atBoss: boolean) => {
      const world = makeWorld();
      const nav = new NavGrid(world);
      const state = createState(6);
      const c = pmc(state, world, 0, 0, 0);
      stow(c, items, createItem(items, 'round', 200));
      // 20 m in front of it: a boss facing away (it doesn't start the fight), or you.
      const other = atBoss
        ? spawnEnemy(state, world, 0, 0, -20, 0, {
            faction: 'boss',
            skill: { ...DEFAULT_SKILL, fov: 30 },
          })
        : you(state, world, 0, -20);
      let alertAt = -1;
      let firedAt = -1;
      run(state, world, nav, 8, () => {
        if (alertAt < 0 && c.ai!.awareness === 'alert' && c.ai!.target === other.id)
          alertAt = state.tick;
        if (firedAt < 0 && state.events.some((e) => e.type === 'shot' && e.by === c.id))
          firedAt = state.tick;
      });
      return { alertAt, firedAt };
    };
    const atYou = go(false);
    const atBoss = go(true);
    expect(atYou.alertAt).toBeGreaterThan(0);
    expect(atBoss.alertAt).toBeGreaterThan(atYou.alertAt * 1.3);
    expect(atBoss.firedAt - atBoss.alertAt).toBeGreaterThan(
      atYou.firedAt - atYou.alertAt + TACTICS.pmcReactsBoss * TICK_RATE * 0.8,
    );
  });

  it('a scav is slower to notice a PMC, and to fire at one, than at you', () => {
    const alertAfter = (pmcTarget: boolean) => {
      const world = makeWorld();
      const nav = new NavGrid(world);
      const state = createState(6);
      const scav = spawnEnemy(state, world, 0, 0, 0, 0, {});
      giveWeapon(scav, items, 'rifle');
      // Standing 20 m in front of it: a peaceful player in the PMC's case (so only the
      // PMC counts), or a player.
      const other = pmcTarget ? pmc(state, world, 0, -20, 0) : you(state, world, 0, -20);
      if (pmcTarget) {
        // A PMC that doesn't see it (facing away) and doesn't fire first.
        other.ai!.skill = { ...PMC_SKILL, fov: 30 };
      }
      let alertAt = -1;
      let firedAt = -1;
      run(state, world, nav, 8, () => {
        if (alertAt < 0 && scav.ai!.awareness === 'alert') alertAt = state.tick;
        if (firedAt < 0 && state.events.some((e) => e.type === 'shot' && e.by === scav.id))
          firedAt = state.tick;
      });
      return { alertAt, firedAt };
    };
    const atYou = alertAfter(false);
    const atPmc = alertAfter(true);
    expect(atYou.alertAt).toBeGreaterThan(0);
    expect(atPmc.alertAt).toBeGreaterThan(atYou.alertAt * 1.3);
    expect(atPmc.firedAt - atPmc.alertAt).toBeGreaterThan(atYou.firedAt - atYou.alertAt);
  });

  it('runs from a grenade to a spot out of the thrower’s sight when there is one nearly as near', () => {
    // You 14 m north; a frag just east of it; a wall 1.5 m north of the escape spot south of
    // it hides that spot from you. Open ground west of it is a little nearer.
    const flee = (hidden: boolean) => {
      const world = makeWorld([wall(-3, 7.5, 3, 7.5)]);
      const nav = new NavGrid(world);
      const state = createState(7);
      const c = pmc(state, world, 0, 0, 0);
      const me = you(state, world, 0, -14);
      const g = launchGrenade(state, me, world, grenadeDef(items, 'grenade'), 0, 0, 0);
      g.x = 0.5;
      g.y = 0.1;
      g.z = 0;
      g.vx = g.vy = g.vz = 0;
      g.resting = true;
      if (!hidden) (AI as { fleeHidden: number }).fleeHidden = 0;
      try {
        run(state, world, nav, 0.2);
        return c.ai!.flee ? { x: c.ai!.flee.x, z: c.ai!.flee.z } : null;
      } finally {
        (AI as { fleeHidden: number }).fleeHidden = 4;
      }
    };
    const covered = flee(true)!;
    const open = flee(false)!;
    // Behind the wall from you (south of it); else the open ground west.
    expect(covered.z).toBeGreaterThan(7.5);
    expect(open.x).toBeLessThan(-5);
  });
});

describe('players first (2026-11-08)', () => {
  const armed = (c: Character): Character => {
    stow(c, items, createItem(items, 'round', 300));
    c.health.hp.fill(1e6);
    return c;
  };

  it('fighting an AI, it turns on you when you show up nearer, not when you are much further', () => {
    const switchAfter = (watcherIsPmc: boolean, youAt: [number, number]): number => {
      const world = makeWorld();
      const nav = new NavGrid(world);
      const state = createState(4);
      const p = armed(pmc(state, world, 0, 0, 0));
      const scav = armed(spawnEnemy(state, world, 0, 0, -15, Math.PI, {}));
      giveWeapon(scav, items, 'rifle');
      run(state, world, nav, 3);
      const watcher = watcherIsPmc ? p : scav;
      const foe = watcherIsPmc ? scav : p;
      expect(watcher.ai!.target).toBe(foe.id);
      const me = you(state, world, youAt[0], youAt[1]);
      let at = -1;
      let t = 0;
      run(state, world, nav, 4, () => {
        t += 1 / TICK_RATE;
        if (at < 0 && watcher.ai!.target === me.id) at = t;
      });
      return at;
    };
    // 10 m off the PMC, in front of it (its foe 15 m off).
    const pmcTurns = switchAfter(true, [5, -9]);
    expect(pmcTurns).toBeGreaterThan(0);
    expect(pmcTurns).toBeLessThan(1);
    // The scav (facing the PMC 15 m off), with you 6 m in front of it.
    const scavTurns = switchAfter(false, [4, -10]);
    expect(scavTurns).toBeGreaterThan(0);
    expect(scavTurns).toBeLessThan(1);
    // Much further than its foe (40 m off, the foe 15): it keeps on the foe.
    expect(switchAfter(true, [10, -39])).toBe(-1);
  });

  it('calm, it picks you over a scav at a similar distance, but a much nearer scav first', () => {
    const picked = (scavAt: [number, number]): string[] => {
      const out: string[] = [];
      for (let seed = 1; seed <= 6; seed++) {
        const world = makeWorld();
        const nav = new NavGrid(world);
        const state = createState(seed);
        const p = pmc(state, world, 0, 0, 0);
        // A scav facing away (it doesn't start the fight), and you, both in front of it.
        const sc = spawnEnemy(state, world, scavAt[0], 0, scavAt[1], 0, {});
        sc.ai!.skill = { ...DEFAULT_SKILL, fov: 30 };
        const me = you(state, world, 6, -12);
        for (let i = 0; i < 4 * TICK_RATE && p.ai!.awareness !== 'alert'; i++)
          step(state, world, items, {}, nav);
        out.push(p.ai!.target === me.id ? 'you' : p.ai!.target === sc.id ? 'scav' : 'none');
      }
      return out;
    };
    expect(picked([-6, -12])).toEqual(Array(6).fill('you'));
    expect(picked([-2, -4])).toEqual(Array(6).fill('scav'));
  });
});

describe('aim and sprinting (2026-11-08)', () => {
  /** Where its hits land on you, standing still dist m off, behind boxes if any. */
  const hitsOn = (dist: number, boxes: BoxDef[] = []) => {
    const zones = [0, 0, 0, 0, 0, 0];
    const world = makeWorld(boxes);
    const nav = new NavGrid(world);
    for (let seed = 1; seed <= 6; seed++) {
      const state = createState(seed);
      const c = pmc(state, world, 0, -dist, Math.PI, {
        ...PMC_SKILL,
        aimError: 4,
        aimSettled: 0.3,
      });
      stow(c, items, createItem(items, 'round', 600));
      const me = you(state, world, 0, 0);
      run(state, world, nav, 8, () => {
        // Held where it is, so the distance stays.
        c.x = 0;
        c.z = -dist;
        for (const e of state.events)
          if (e.type === 'damage' && e.target === me.id) zones[e.zone]!++;
      });
    }
    const all = zones.reduce((a, b) => a + b, 0);
    return {
      all,
      head: zones[0]! / all,
      chest: zones[1]! / all,
      legs: (zones[4]! + zones[5]!) / all,
    };
  };

  it('aims for the chest, and hits legs hardly ever within 15 m', () => {
    for (const d of [10, 15]) {
      const r = hitsOn(d);
      expect(r.all).toBeGreaterThan(40);
      expect(r.chest).toBeGreaterThan(0.6);
      expect(r.legs).toBeLessThan(0.03);
    }
  });

  it('with only your head over a wall, it aims for your head', () => {
    const r = hitsOn(10, [{ x: 0, y: 0.7, z: -1, hx: 3, hy: 0.7, hz: 0.15, yaw: 0 }]);
    expect(r.all).toBeGreaterThan(20);
    expect(r.head).toBeGreaterThan(0.9);
  });

  it('losing you, it walks in, unless it decides to rush your position at a sprint', () => {
    const go = (pushChance: number) => {
      // It sees you 15 m off, then you're gone behind a wall: it pushes to where you were.
      const world = makeWorld([wall(-6, -3, 6, -3)]);
      const nav = new NavGrid(world);
      const state = createState(3);
      const c = pmc(state, world, 0, -25, Math.PI, {
        ...PMC_SKILL,
        holdChance: 0,
        sprints: true,
        pushChance,
      });
      const me = you(state, world, 8, -12);
      run(state, world, nav, 4);
      expect(c.ai!.seesTarget).toBe(true);
      me.x = 0;
      me.z = 3;
      let sprinted = 0;
      run(state, world, nav, 4, () => {
        if (!c.ai!.seesTarget && c.ai!.input.sprint) sprinted++;
      });
      return sprinted;
    };
    expect(go(0)).toBe(0);
    expect(go(1)).toBeGreaterThan(TICK_RATE / 2);
  });

  it('alerted without seeing you, it sprints to close the gap', () => {
    const go = (sprints: boolean) => {
      // You hit it from behind a wall 25 m off: it knows, but can't see you.
      const world = makeWorld([wall(-6, -3, 6, -3)]);
      const nav = new NavGrid(world);
      const state = createState(4);
      const c = pmc(state, world, 0, -25, 0, { ...PMC_SKILL, holdChance: 0, sprints });
      const me = you(state, world, 0, 2);
      state.events.length = 0;
      shootCharacter(state, items, c, LEFT_LEG, { ...ammoDef(items, 'round'), damage: 1 }, me.id);
      updateAi(state, world, items, nav);
      expect(c.ai!.awareness).toBe('alert');
      let sprinted = 0;
      run(state, world, nav, 3, () => {
        if (!c.ai!.seesTarget && c.ai!.input.sprint) sprinted++;
      });
      return sprinted;
    };
    expect(go(true)).toBeGreaterThan(TICK_RATE);
    expect(go(false)).toBe(0);
  });
});
