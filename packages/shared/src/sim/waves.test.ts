import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import type { EnemyDef, LoadoutDef } from '../content/enemies';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { heldWeapon } from './gear';
import { AI, DEFAULT_SKILL, spawnEnemy, updateAi, type PatrolDef } from './ai';
import { startRaid } from './raid';
import { createState, spawnCharacter, type Character, type SimEvent, type SimState } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { SCAV_WAVES, startEnemies, updateWaves, type EnemyContent } from './waves';

/** Flat ground, `half` meters each way, with optional boxes. */
function makeWorld(half = 150, boxes: BoxDef[] = []): CollisionWorld {
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

const enemyType = (id: string, faction: EnemyDef['faction']): EnemyDef => ({
  formatVersion: 2,
  id,
  name: id,
  faction,
  loadout: 'kit',
  skill: DEFAULT_SKILL,
  outfits: [
    { skin: '#000000', top: '#000000', bottom: '#000000', hands: '#000000', feet: '#000000' },
    { skin: '#ffffff', top: '#ffffff', bottom: '#ffffff', hands: '#ffffff', feet: '#ffffff' },
  ],
});

const kit: LoadoutDef = {
  formatVersion: 1,
  id: 'kit',
  weapons: [{ weight: 1, item: 'rifle', spare: [30, 30] }],
};

const content: EnemyContent = {
  types: new Map([
    ['scav', enemyType('scav', 'scav')],
    ['boss', enemyType('boss', 'boss')],
  ]),
  loadouts: new Map([['kit', kit]]),
  tables: new Map(),
  patrols: new Map(),
};

const spawn = (id: string, x: number, z: number, extra: object = {}) => ({
  type: 'enemySpawn',
  id,
  enemy: 'scav',
  x,
  y: 0,
  z,
  yaw: 0,
  ...extra,
});

const mapOf = (markers: object[]): CompiledMap =>
  ({ markers, zones: [], patrols: [] }) as unknown as CompiledMap;

/** A raid of `seconds` with you standing at (px, pz), and its enemies started. */
function raid(markers: object[], px = 120, pz = 0, seconds = 1200, seed = 1) {
  const state = createState(seed);
  const world = makeWorld();
  const map = mapOf(markers);
  const player = spawnCharacter(state, world, px, pz, 0, 1);
  startRaid(state, map, seconds);
  const started = startEnemies(state, world, map, items, content);
  return { state, world, player, started };
}

const scavs = (state: SimState): Character[] =>
  state.entities.filter((e) => e.look?.type === 'scav' && !e.health.dead);

function run(state: SimState, world: CollisionWorld, seconds: number, nav?: NavGrid): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) step(state, world, items, {}, nav);
}

/** Six lone scav spawns down the west side, 40 m apart, and a boss. */
const six = [
  ...[-100, -60, -20, 20, 60, 100].map((z, i) => spawn(`s${i}`, -120, z)),
  spawn('boss', -120, 130, { enemy: 'boss' }),
];

describe("the tutorial's scav (TU-2)", () => {
  it('a spawn put in once is no wave slot, carries its loadout only, with its flags', () => {
    const looter: EnemyDef = {
      ...enemyType('scav', 'scav'),
      loot: { rolls: [2, 2], tables: { stuff: 1 } },
    };
    const keyKit: LoadoutDef = { ...kit, id: 'key-kit', carried: [{ item: 'key' }] };
    const tutorial: EnemyContent = {
      ...content,
      types: new Map([['scav', looter]]),
      loadouts: new Map([['key-kit', keyKit]]),
      tables: new Map([
        [
          'stuff',
          {
            formatVersion: 1,
            id: 'stuff',
            name: 'Stuff',
            rolls: [1, 1],
            items: [{ item: 'bandage', weight: 1 }],
          },
        ],
      ]),
    };
    const state = createState(1);
    const world = makeWorld();
    const map = mapOf([
      spawn('scav', -20, 0, {
        loadout: 'key-kit',
        once: true,
        noLoot: true,
        deaf: true,
        passive: true,
        harmless: true,
      }),
    ]);
    spawnCharacter(state, world, 120, 0, 0, 1);
    startRaid(state, map, 1200);
    const [c] = startEnemies(state, world, map, items, tutorial);
    expect(state.waves).toBeUndefined();
    expect(c!.ai).toMatchObject({ deaf: true, passive: true, harmless: true });
    // The key in its pockets, and nothing from its type's loot.
    expect(c!.gear.pockets.items.map((g) => g.item.item)).toContain('key');
    expect(c!.gear.pockets.items.some((g) => g.item.item === 'bandage')).toBe(false);
    c!.health.dead = true;
    run(state, world, SCAV_WAVES.interval * 3);
    expect(state.entities.filter((e) => e.ai)).toHaveLength(1);
  });
});

describe('scav waves', () => {
  it('starts a third of the scav slots and every boss; the rest come in waves', () => {
    const { state, world, started } = raid(six);
    expect(started.map((c) => c.look!.type).sort()).toEqual(['boss', 'scav', 'scav']);
    expect(scavs(state)).toHaveLength(2);
    expect(state.waves!.slots).toHaveLength(6);
    // Armed from the loadout, its look (type and an outfit) kept on the character.
    expect(heldWeapon(started[0]!)).toBeTruthy();
    run(state, world, SCAV_WAVES.interval - SCAV_WAVES.jitter - 1);
    expect(scavs(state)).toHaveLength(2);
    run(state, world, 2 * SCAV_WAVES.jitter + 2);
    expect(scavs(state)).toHaveLength(4);
    run(state, world, SCAV_WAVES.interval);
    expect(scavs(state)).toHaveLength(6);
    expect(state.waves!.spawned).toBe(6);
  });

  it("starts the map's own share of the slots, the rest in waves of that size", () => {
    const state = createState(1);
    const world = makeWorld();
    const map = { ...mapOf(six), scavStartShare: 0.5 } as CompiledMap;
    spawnCharacter(state, world, 120, 0, 0, 1);
    startRaid(state, map, 1200);
    startEnemies(state, world, map, items, content);
    expect(scavs(state)).toHaveLength(3);
    run(state, world, SCAV_WAVES.interval + SCAV_WAVES.jitter + 1);
    expect(scavs(state)).toHaveLength(6);
  });

  it('rolls the same raid for the same seed, and picks outfits per scav', () => {
    const a = raid(six, 120, 0, 1200, 5);
    const b = raid(six, 120, 0, 1200, 5);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    const outfits = new Set<number>();
    for (let seed = 1; seed < 20; seed++)
      for (const c of raid(six, 120, 0, 1200, seed).started) outfits.add(c.look!.outfit);
    expect([...outfits].sort()).toEqual([0, 1]);
  });

  it("refills a dead scav's slot in a later wave, slower late in the raid", () => {
    const { state, world } = raid([spawn('a', -120, 0)], 120, 0, 3600);
    const first = scavs(state)[0]!;
    first.health.dead = true;
    run(state, world, 1);
    const slot = state.waves!.slots[0]!;
    // At least the refill wait, then on the next wave.
    const wait = slot.due - state.tick;
    expect(wait).toBeGreaterThanOrEqual(SCAV_WAVES.refill * TICK_RATE - TICK_RATE);
    expect((slot.due - state.waves!.start) % (SCAV_WAVES.interval * TICK_RATE)).toBe(0);
    run(state, world, wait / TICK_RATE + 1);
    expect(scavs(state)).toHaveLength(1);
    expect(scavs(state)[0]).not.toBe(first);
  });

  it('waits longer to refill late in the raid', () => {
    const early = raid([spawn('a', -120, 0)], 120, 0, 3600);
    scavs(early.state)[0]!.health.dead = true;
    run(early.state, early.world, 1);
    const late = raid([spawn('a', -120, 0)], 120, 0, 3600);
    run(late.state, late.world, 2400);
    scavs(late.state)[0]!.health.dead = true;
    run(late.state, late.world, 1);
    const wait = (s: SimState) => s.waves!.slots[0]!.due - s.tick;
    // Two thirds of the raid gone: the wait is (1 + refillLate × 2/3) times as long.
    const longer = SCAV_WAVES.refill * (1 + (SCAV_WAVES.refillLate * 2) / 3) * TICK_RATE;
    expect(wait(late.state)).toBeGreaterThanOrEqual(longer - TICK_RATE);
    expect(wait(late.state)).toBeGreaterThan(wait(early.state));
  });

  it('stops at twice the slots', () => {
    const { state, world } = raid([spawn('a', -120, 0)], 120, 0, 7200);
    for (let i = 0; i < 4; i++) {
      for (const c of scavs(state)) c.health.dead = true;
      run(state, world, 900);
    }
    expect(state.waves!.spawned).toBe(2);
    expect(state.entities.filter((e) => e.look?.type === 'scav')).toHaveLength(2);
  });

  it("never arrives in a player's sight or close by: it takes another spot in its sector or waits", () => {
    // A sector of two spots: one in plain view of you, one far off.
    const sector = [
      spawn('near', 60, 0, { oneOf: 'sector' }),
      spawn('far', -120, 0, { oneOf: 'sector' }),
    ];
    const ids = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const { state, world } = raid(sector, 100, 0, 1200, seed);
      const c = scavs(state)[0]!;
      expect(c.x).toBeLessThan(0);
      c.health.dead = true;
      run(state, world, 400);
      for (const s of scavs(state)) {
        expect(s.x).toBeLessThan(0);
        ids.add(s.id);
      }
    }
    expect(ids.size).toBeGreaterThan(0);

    // Only a spot in view: the slot waits, and comes once you've gone.
    const { state, world, player } = raid([spawn('a', 70, 0)], 100, 0, 1200, 3);
    const slot = state.waves!.slots[0]!;
    // Started in (the map's check covers start spots); taken out and due in 30 s.
    state.entities = state.entities.filter((e) => e.id !== slot.entity);
    slot.entity = 0;
    slot.due = state.tick + 30 * TICK_RATE;
    run(state, world, 60);
    expect(slot.entity).toBe(0);
    expect(slot.due).toBeGreaterThan(state.tick - TICK_RATE);
    // Moved, but still 20 m away and in view: still waits.
    player.x = 70;
    player.z = 20;
    player.y = 0;
    run(state, world, SCAV_WAVES.retry + 1);
    expect(slot.entity).toBe(0);
    player.x = -100;
    player.z = 140;
    run(state, world, SCAV_WAVES.retry + 1);
    expect(slot.entity).not.toBe(0);
  });

  it('keeps its queue in a saved raid', () => {
    const { state, world } = raid(six);
    run(state, world, 30);
    const saved = JSON.parse(JSON.stringify(state)) as SimState;
    run(state, world, 400);
    run(saved, world, 400);
    expect(scavs(saved)).toHaveLength(scavs(state).length);
    expect(JSON.stringify(saved.waves)).toBe(JSON.stringify(state.waves));
  });

  it('leaves raids without scav spawns alone', () => {
    const { state, started } = raid([spawn('boss', -120, 0, { enemy: 'boss' })]);
    expect(started).toHaveLength(1);
    expect(state.waves ?? null).toBeNull();
  });
});

describe('the trickle to a long fight', () => {
  function shot(x: number, z: number): SimEvent {
    return {
      type: 'shot',
      by: 999,
      fromX: x,
      fromY: 1.6,
      fromZ: z,
      toX: x + 10,
      toY: 1.6,
      toZ: z,
      hit: 'none',
      target: 0,
      loudness: 150,
      pellet: 0,
      grenade: 0,
      flame: 0,
    } as SimEvent;
  }

  it('draws one more free scav, the nearest in earshot, every 30 s of firing, and forgets a quiet fight', () => {
    const { state, world } = raid([spawn('a', -120, 0)], 120, 0, 1200);
    // Three free scavs at 40, 60 and 200 m from the fight at (0, 0); the last out of earshot.
    const near = spawnEnemy(state, world, 40, 0, 0, 0);
    const mid = spawnEnemy(state, world, 0, 0, 60, 0);
    const far = spawnEnemy(state, world, 0, 0, -140, 0);
    far.x = -200;
    const tick = (firing: boolean): void => {
      state.tick++;
      state.events.length = 0;
      if (firing && state.tick % 10 === 0) state.events.push(shot(0, 0));
      updateWaves(state, world, items);
    };
    for (let i = 0; i < (SCAV_WAVES.trickleEvery - 1) * TICK_RATE; i++) tick(true);
    expect(near.ai!.awareness).toBe('unaware');
    for (let i = 0; i < 2 * TICK_RATE; i++) tick(true);
    expect(near.ai!.awareness).toBe('suspicious');
    expect(near.ai!.investigate && near.ai!.cautious).toBe(true);
    expect(mid.ai!.awareness).toBe('unaware');
    for (let i = 0; i < SCAV_WAVES.trickleEvery * TICK_RATE; i++) tick(true);
    expect(mid.ai!.awareness).toBe('suspicious');
    expect(far.ai!.awareness).toBe('unaware');
    // Quiet for longer than trickleForget: the fight is forgotten.
    for (let i = 0; i < (SCAV_WAVES.trickleForget + 1) * TICK_RATE; i++) tick(false);
    expect(state.waves!.gunfire).toHaveLength(0);
  });
});

describe('scav quirks and sight', () => {
  /** A scav walking a 60 m out-and-back patrol, for a minute; what its input did. */
  function patrolMinute(erratic: number | undefined, seed = 2) {
    const state = createState(seed);
    const world = makeWorld(60);
    const nav = new NavGrid(world);
    const patrol: PatrolDef = {
      points: [
        { x: -30, y: 0, z: 0, wait: 0, radius: 0 },
        { x: 30, y: 0, z: 0, wait: 0, radius: 0 },
      ],
      repeatFrom: 0,
      loop: false,
    };
    const skill = erratic === undefined ? DEFAULT_SKILL : { ...DEFAULT_SKILL, erratic };
    const c = spawnEnemy(state, world, -30, 0, 0, 0, { patrol, skill });
    c.ai!.activity = 'patrol';
    const seen = { stop: 0, crouch: 0, sprint: 0, ticks: 0 };
    for (let i = 0; i < 60 * TICK_RATE; i++) {
      step(state, world, items, {}, nav);
      const input = c.ai!.input;
      if (c.ai!.activity !== 'patrol') continue;
      seen.ticks++;
      if (input.moveX === 0 && input.moveY === 0) seen.stop++;
      if (input.crouch) seen.crouch++;
      if (input.sprint) seen.sprint++;
    }
    return { seen, c };
  }

  it('an erratic scav stops, crouch-walks and sprints now and then; a steady one never', () => {
    const { seen } = patrolMinute(1);
    expect(seen.stop).toBeGreaterThan(0);
    expect(seen.crouch).toBeGreaterThan(0);
    expect(seen.sprint).toBeGreaterThan(0);
    // Quirks, not a new way of walking: mostly it still just walks.
    expect(seen.stop + seen.crouch + seen.sprint).toBeLessThan(seen.ticks * 0.6);
    const steady = patrolMinute(undefined).seen;
    expect(steady.crouch + steady.sprint).toBe(0);
  });

  it('a scav with a 100° view misses someone 55° off to the side that a 120° one sees', () => {
    for (const [fov, sees] of [
      [undefined, true],
      [100, false],
    ] as const) {
      const state = createState(1);
      const world = makeWorld(60);
      const nav = new NavGrid(world);
      const skill = fov === undefined ? DEFAULT_SKILL : { ...DEFAULT_SKILL, fov };
      const c = spawnEnemy(state, world, 0, 0, 0, 0, { skill });
      // Yaw 0 faces −z: 6 m off at 55° to its right.
      const a = (55 * Math.PI) / 180;
      spawnCharacter(state, world, Math.sin(a) * 6, -Math.cos(a) * 6, 0, 1);
      for (let i = 0; i < 2 * TICK_RATE; i++) {
        state.tick++;
        updateAi(state, world, items, nav);
        c.yaw = 0;
      }
      expect(c.ai!.awareness !== 'unaware', `fov ${fov}`).toBe(sees);
    }
    expect(AI.fov).toBe(120);
  });
});
