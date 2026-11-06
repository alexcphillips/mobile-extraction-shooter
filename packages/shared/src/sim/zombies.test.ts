import { describe, expect, it } from 'vitest';
import { compileMap, type CompiledMap } from '../content/compile';
import type { MapNode } from '../content/schema';
import { ZOMBIES_FORMAT_VERSION, type ZombiesDef } from '../content/zombies';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { carriedAmmo } from './gear';
import { CHEST, dealDamage, woundZone } from './health';
import { meleeDef } from '../content/items';
import {
  createState,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimState,
} from './state';
import * as ai from './ai';
import { step } from './step';
import { giveWeapon } from './weapons';
import { TEST_ITEMS } from './test-items';
// The test items and a minigun for the death machine.
const items = new Map(TEST_ITEMS).set('minigun', {
  ...TEST_ITEMS.get('rifle')!,
  id: 'minigun',
  infiniteAmmo: true,
} as never);

import {
  buyInReach,
  isZombie,
  pointsOf,
  spotPrice,
  startZombies,
  updateZombies,
  windowInReach,
  ZOMBIES,
} from './zombies';

/*
 * Two rooms: a wall across the map at x = 0 with a doorway at z = 0, and a door in it that
 * costs 750. The player starts in the west room, which has a wall rifle and the mystery
 * box. A wall at z = −12 shuts off a yard south of the west room, with a
 * barricaded window at x = −10 and a zombie spawn out in the yard that breaks in through it;
 * the east room has the other spawn, inside.
 */
function rooms(): CompiledMap {
  const row = Array<number>(11).fill(0);
  const nodes: MapNode[] = [
    {
      type: 'wall',
      pos: [0, 0, 0],
      yaw: 90,
      size: [40, 3, 0.2],
      colour: '#888888',
      openings: [{ along: 0, width: 1.4, bottom: 0, top: 2.2 }],
    },
    {
      type: 'door',
      id: 'door',
      pos: [0, 0, 0],
      yaw: 90,
      size: [1.4, 2.2],
      cost: 750,
      colour: '#553322',
    },
    {
      type: 'wall',
      pos: [-10, 0, -12],
      size: [20, 3, 0.2],
      colour: '#888888',
      openings: [{ along: 0, width: 1.4, bottom: 0.9, top: 2.1 }],
    },
    { type: 'barricade', id: 'win', pos: [-10, 0.9, -12], size: [1.4, 1.2] },
    { type: 'playerSpawn', id: 'spawn', pos: [-5, 0, 0] },
    { type: 'zombieSpawn', id: 'west', pos: [-10, 0, -17], window: 'win' },
    { type: 'zombieSpawn', id: 'east', pos: [15, 0, 10] },
    { type: 'wallBuy', id: 'rifle', pos: [-5, 0, -8], item: 'rifle', cost: 1000, ammoCost: 400 },
    { type: 'mysteryBox', id: 'box', pos: [-12, 0, 0], cost: 950 },
  ];
  return compileMap(
    {
      formatVersion: 3,
      id: 'rooms',
      name: 'Rooms',
      environment: { sky: '#000000', fogNear: 10, fogFar: 50 },
      terrain: {
        origin: [-20, -20],
        cellSize: 4,
        heights: Array.from({ length: 11 }, () => row),
        colour: '#555555',
      },
      nodes,
      zones: [],
    },
    new Map(),
  );
}

const MODE: ZombiesDef = {
  formatVersion: ZOMBIES_FORMAT_VERSION,
  id: 'test',
  name: 'Test',
  map: 'rooms',
  kit: 'kit',
  zombie: {
    name: 'Zombie',
    outfit: {
      skin: '#00ff00',
      top: '#000000',
      bottom: '#000000',
      hands: '#00ff00',
      feet: '#000000',
    },
    claws: 'knife',
  },
  rounds: {
    first: 2,
    perRound: 1,
    maxAlive: 10,
    spawnEvery: 1,
    breakTime: 2,
    health: 0.5,
    healthPerRound: 0.1,
  },
  points: { start: 500, hit: 10, kill: 60, meleeKill: 100 },
  player: { health: 150, regenDelay: 3, regenRate: 50 },
  barricades: { rebuildTime: 0.5, rebuildPoints: 10, rebuildCap: 30, tearTime: 1 },
  powerups: {
    chance: 0,
    perRound: 4,
    lifetime: 10,
    duration: 5,
    carpenterPoints: 200,
    minigun: 'minigun',
    weights: { instaKill: 1 },
  },
  spareMags: 2,
  box: [{ weight: 1, item: 'shotgun' }],
};

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

interface Game {
  state: SimState;
  world: CollisionWorld;
  nav: NavGrid;
  player: Character;
  /** Steps n ticks with the player's input (none by default). */
  run(ticks: number, p?: PlayerInput): void;
  zombies(): Character[];
}

function game(at: [number, number] = [-5, 0], mode: ZombiesDef = MODE): Game {
  const map = rooms();
  const world = new CollisionWorld(map.world);
  const nav = new NavGrid(world);
  const state = createState(7);
  const player = spawnCharacter(state, world, at[0], at[1]);
  startZombies(state, map, mode);
  return {
    state,
    world,
    nav,
    player,
    run(ticks, p) {
      for (let i = 0; i < ticks; i++) step(state, world, items, p ? { [player.id]: p } : {}, nav);
    },
    zombies: () => state.entities.filter(isZombie),
  };
}

const seconds = (s: number): number => Math.round(s * TICK_RATE);
const knife = meleeDef(TEST_ITEMS, 'knife');

describe('zombies rounds', () => {
  it('starts round 1 after the break, and zombies climb in one at a time', () => {
    const g = game();
    expect(g.state.zombies!.round).toBe(0);
    expect(pointsOf(g.state, g.player.id)).toBe(500);
    g.run(seconds(2.05));
    expect(g.state.zombies!.round).toBe(1);
    expect(g.zombies()).toHaveLength(1);
    g.run(seconds(1));
    expect(g.zombies()).toHaveLength(2);
    expect(g.state.zombies!.left).toBe(0);
    // Half a player's health in round 1, with its claws out.
    const z = g.zombies()[0]!;
    expect(z.health.hp[1]).toBeCloseTo(85 * 0.5);
    expect(z.gear.hand).toBe('knife');
    expect(z.gear.knife?.item).toBe('knife');
  });

  it('only uses spawns a player can walk to, until the door is bought', () => {
    const g = game();
    g.run(seconds(3.1));
    // Both from the west room's spawn: the east one is behind the locked door.
    for (const z of g.zombies()) expect(z.x).toBeLessThan(0);
  });

  it('ends a round once all its zombies are dead, clears the bodies, then starts the next', () => {
    const g = game();
    g.run(seconds(3.1));
    for (const z of g.zombies()) z.health.dead = true;
    g.run(1);
    expect(g.state.zombies!.between).toBe(true);
    g.run(seconds(2));
    expect(g.state.zombies!.round).toBe(2);
    // The dead are gone after a few seconds (corpseTime 4).
    g.run(seconds(2.5));
    expect(g.state.entities.filter((e) => isZombie(e) && e.health.dead)).toHaveLength(0);
    expect(g.state.zombies!.left + g.zombies().length).toBe(3);
  });
});

describe('zombies points', () => {
  it('pays for a hit once per zombie per tick, a kill, and more for a knife kill', () => {
    const g = game();
    g.run(seconds(3.1));
    const [a, b] = g.zombies();
    const s = g.state;
    const by = g.player.id;
    // Two pellets into a: one hit.
    for (let i = 0; i < 2; i++)
      s.events.push({
        type: 'damage',
        target: a!.id,
        by,
        zone: 1,
        amount: 5,
        absorbed: 0,
        cause: 'shot',
      });
    updateZombies(s, g.world, items, g.nav);
    expect(pointsOf(s, by)).toBe(510);
    s.events.length = 0;
    a!.health.dead = true;
    s.events.push({ type: 'death', target: a!.id, by });
    s.events.push({
      type: 'damage',
      target: a!.id,
      by,
      zone: 1,
      amount: 50,
      absorbed: 0,
      cause: 'shot',
    });
    updateZombies(s, g.world, items, g.nav);
    expect(pointsOf(s, by)).toBe(570);
    s.events.length = 0;
    b!.health.dead = true;
    s.events.push({ type: 'death', target: b!.id, by });
    s.events.push({
      type: 'damage',
      target: b!.id,
      by,
      zone: 1,
      amount: 50,
      absorbed: 0,
      cause: 'melee',
    });
    updateZombies(s, g.world, items, g.nav);
    expect(pointsOf(s, by)).toBe(670);
    expect(s.zombies!.kills[by]).toBe(2);
  });

  it('a zombie breaks in through its window, hunts the player down and claws them', () => {
    const g = game();
    g.run(seconds(2.05));
    const z = g.zombies()[0]!;
    expect(z.z).toBeLessThan(-12);
    // Six planks at a second each, after walking up to the window.
    g.run(seconds(4));
    const w = g.state.zombies!.windows[0]!;
    expect(w.planks).toBeLessThan(6);
    // Its health refills between hits, so count them; and when it got in.
    let clawed = 0;
    let inAt = -1;
    for (let i = 0; i < seconds(20) && !g.player.health.dead; i++) {
      g.run(1);
      if (inAt < 0 && z.ai!.zombie!.window === -1) {
        inAt = i;
        expect(w.planks).toBe(0);
      }
      for (const e of g.state.events)
        if (e.type === 'damage' && e.target === g.player.id && e.by === z.id) {
          clawed++;
          // Clawed from inside, never through the planks here: it got in first.
          expect(inAt).toBeGreaterThanOrEqual(0);
        }
    }
    expect(z.z).toBeGreaterThan(-12);
    expect(clawed).toBeGreaterThan(0);
  });
});

describe('buying', () => {
  it('buys the door open with points, and refuses without enough', () => {
    const g = game([-1.2, 0]);
    const door = { door: 0 };
    g.run(1, input(door));
    expect(g.state.events).toContainEqual(
      expect.objectContaining({ type: 'door', result: 'poor' }),
    );
    expect(g.state.doors[0]!.locked).toBe(true);
    g.state.zombies!.points[g.player.id] = 800;
    g.run(1, input(door));
    expect(g.state.events).toContainEqual(
      expect.objectContaining({ type: 'door', result: 'bought' }),
    );
    expect(g.state.doors[0]).toMatchObject({ locked: false, open: true });
    expect(pointsOf(g.state, g.player.id)).toBe(50);
    // The east room's spawn can be used now: a zombie climbs in nearer to it than the west's.
    g.player.x = 14;
    g.player.z = -10;
    // Enough zombies that both spawns get used.
    g.state.zombies!.rules.rounds.first = 8;
    g.run(seconds(9.1));
    expect(g.zombies().some((z) => z.x > 0)).toBe(true);
  });

  it('buys a wall gun into the hands with spare ammo, then its ammo, and nothing when full', () => {
    const g = game([-5, -7]);
    g.state.zombies!.points[g.player.id] = 2000;
    const spot = buyInReach(g.state, g.player);
    expect(g.state.zombies!.buys[spot]!.id).toBe('rifle');
    expect(spotPrice(g.state, g.player, spot)).toEqual({ cost: 1000, ammo: false });
    g.run(1, input({ buy: spot }));
    expect(g.player.gear.primary1?.item).toBe('rifle');
    expect(g.player.gear.hand).toBe('primary1');
    expect(pointsOf(g.state, g.player.id)).toBe(1000);
    // A rig for the spare rounds: 2 magazines of 30.
    const rig = createItem(items, 'rig');
    g.player.gear.rig = rig as never;
    expect(spotPrice(g.state, g.player, spot)).toEqual({ cost: 400, ammo: true });
    g.run(1, input({ buy: spot }));
    expect(g.state.events).toContainEqual(expect.objectContaining({ type: 'buy', result: 'full' }));
    g.player.gear.primary1!.mag = 3;
    g.run(1, input({ buy: spot }));
    expect(g.state.events).toContainEqual(expect.objectContaining({ type: 'buy', result: 'ammo' }));
    expect(g.player.gear.primary1!.mag).toBe(30);
    expect(carriedAmmo(g.player, 'round')).toBe(60);
    expect(pointsOf(g.state, g.player.id)).toBe(600);
  });

  it("loads a gun with the mode's round for it, if it names one", () => {
    const g = game([-5, -7], { ...MODE, ammo: { rifle: 'ap-round' } });
    g.state.zombies!.points[g.player.id] = 2000;
    g.player.gear.rig = createItem(items, 'rig') as never;
    g.run(1, input({ buy: buyInReach(g.state, g.player) }));
    expect(g.player.gear.primary1?.loaded).toBe('ap-round');
    expect(carriedAmmo(g.player, 'ap-round')).toBe(60);
    expect(carriedAmmo(g.player, 'round')).toBe(0);
  });

  it('the mystery box shows one of its guns, to be taken by using it again', () => {
    const g = game([-11, 0]);
    g.state.zombies!.points[g.player.id] = 2000;
    const spot = buyInReach(g.state, g.player);
    g.run(1, input({ buy: spot }));
    expect(g.state.events).toContainEqual(
      expect.objectContaining({ type: 'buy', result: 'rolled' }),
    );
    expect(g.player.gear.primary1).toBeNull();
    expect(pointsOf(g.state, g.player.id)).toBe(1050);
    expect(g.state.zombies!.buys[spot]!.offer).toMatchObject({ item: 'shotgun', by: g.player.id });
    expect(spotPrice(g.state, g.player, spot)).toEqual({ cost: 0, ammo: false });
    g.run(seconds(3));
    g.run(1, input({ buy: spot }));
    expect(g.state.events).toContainEqual(
      expect.objectContaining({ type: 'buy', result: 'taken' }),
    );
    expect(g.player.gear.primary1?.item).toBe('shotgun');
    expect(pointsOf(g.state, g.player.id)).toBe(1050);
    expect(g.state.zombies!.buys[spot]!.offer).toBeUndefined();
  });

  it("the mystery box's gun goes if it isn't taken in time", () => {
    const g = game([-11, 0]);
    g.state.zombies!.points[g.player.id] = 2000;
    const spot = buyInReach(g.state, g.player);
    g.run(1, input({ buy: spot }));
    g.run(seconds(ZOMBIES.boxOffer));
    expect(g.state.zombies!.buys[spot]!.offer).toBeUndefined();
    expect(g.player.gear.primary1).toBeNull();
    // Using it again rolls again, and pays again.
    g.run(1, input({ buy: spot }));
    expect(pointsOf(g.state, g.player.id)).toBe(100);
  });
});

describe('barricades', () => {
  it('a held use button nails planks up one at a time, paying until the round cap', () => {
    const g = game([-10, -11.2]);
    const w = g.state.zombies!.windows[0]!;
    w.planks = 1;
    // No round starting meanwhile, which would reset the cap.
    g.state.zombies!.timer = 100;
    expect(windowInReach(g.state, g.player)).toBe(0);
    g.run(seconds(0.5), input({ rebuild: true }));
    expect(w.planks).toBe(2);
    expect(pointsOf(g.state, g.player.id)).toBe(510);
    g.run(seconds(2.1), input({ rebuild: true }));
    expect(w.planks).toBe(6);
    // Capped at 30 a round.
    expect(pointsOf(g.state, g.player.id)).toBe(530);
    expect(windowInReach(g.state, g.player)).toBe(-1);
  });

  it('a zombie at the window claws a player rebuilding it, through the planks', () => {
    const g = game([-10, -11.2]);
    // It never gets a plank off, so it can only hurt them through the window.
    g.state.zombies!.rules.barricades.tearTime = 1000;
    let clawed = 0;
    for (let i = 0; i < seconds(10); i++) {
      g.run(1, input({ rebuild: true, yaw: Math.PI }));
      for (const e of g.state.events)
        if (e.type === 'damage' && e.target === g.player.id && e.amount > 0) clawed++;
    }
    expect(clawed).toBeGreaterThan(0);
    expect(g.state.zombies!.windows[0]!.planks).toBe(6);
    expect(g.zombies().every((z) => z.z < -12)).toBe(true);
  });

  it('keeps players out, but not shots', () => {
    const g = game([-10, -11.2]);
    // Walking south into the window goes nowhere.
    g.run(seconds(2), input({ moveY: 1, yaw: Math.PI }));
    expect(g.player.z).toBeGreaterThan(-12);
    expect(g.world.raycast(-10, 1.5, -11, 0, 0, -1, 5)).toBe(Infinity);
  });
});

describe('players in zombies mode', () => {
  it('have one health bar that refills once they go unhurt for a while', () => {
    const g = game();
    const h = g.player.health;
    expect(h.pool).toBe(150);
    expect(h.hp[CHEST]).toBe(150);
    dealDamage(g.state, g.player, 4, 100, 0);
    expect(h.hp[CHEST]).toBe(50);
    expect(h.hp[4]).toBe(65);
    // The hurt is noted in the next tick's events.
    g.state.events.push({
      type: 'damage',
      target: g.player.id,
      by: 0,
      zone: 1,
      amount: 100,
      absorbed: 0,
      cause: 'fall',
    });
    updateZombies(g.state, g.world, items, g.nav);
    g.run(seconds(2.9));
    expect(h.hp[CHEST]).toBeCloseTo(50, 0);
    g.run(seconds(2.2));
    expect(h.hp[CHEST]).toBe(150);
  });

  it('a bought door is gone from its doorway', () => {
    const g = game([-1.2, 0]);
    g.state.zombies!.points[g.player.id] = 1000;
    g.run(1, input({ door: 0 }));
    expect(g.state.doors[0]!.gone).toBe(true);
    expect(g.world.isDoorGone(0)).toBe(true);
    // Nothing left to use there.
    g.run(1, input({ door: 0 }));
    expect(g.state.events.some((e) => e.type === 'door')).toBe(false);
  });
});

describe('the blast gun', () => {
  it('kills every enemy in its cone that nothing hides, and only those', () => {
    const blaster = {
      ...items.get('rifle')!,
      id: 'blaster',
      blast: { range: 12, angle: 30, push: 10 },
    };
    const db = new Map(items).set('blaster', blaster as never);
    const g = game([-10, 5]);
    g.state.zombies = null;
    const { spawnEnemy } = ai;
    const ahead = spawnEnemy(g.state, g.world, -10, 0, -3, 0);
    const wide = spawnEnemy(g.state, g.world, -16, 0, 1, 0);
    const far = spawnEnemy(g.state, g.world, -10, 0, -9, 0);
    giveWeapon(g.player, db, 'blaster');
    for (let i = 0; i < 2; i++)
      step(g.state, g.world, db, { [g.player.id]: input({ fire: true, yaw: 0 }) }, g.nav);
    expect(ahead.health.dead).toBe(true);
    expect(wide.health.dead).toBe(false);
    expect(far.health.dead).toBe(false);
    expect(
      g.state.events.some((e) => e.type === 'shot' && e.blast === 12) || ahead.health.dead,
    ).toBe(true);
  });
});

describe('power-ups', () => {
  /** Kills the first zombie as the player, so it may drop one (with chance 1 here). */
  function killOne(g: Game): Character {
    const z = g.zombies()[0]!;
    z.health.dead = true;
    g.state.events.length = 0;
    g.state.events.push({ type: 'death', target: z.id, by: g.player.id });
    updateZombies(g.state, g.world, items, g.nav);
    return z;
  }

  it("a zombie a player kills may drop one, up to the round's cap, which goes in time", () => {
    const g = game();
    const rules = g.state.zombies!.rules.powerups;
    rules.chance = 1;
    rules.perRound = 1;
    g.run(seconds(3.1));
    const z = killOne(g);
    const drops = g.state.zombies!.drops;
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ kind: 'instaKill', x: z.x, z: z.z });
    killOne(g);
    expect(drops).toHaveLength(1);
    g.run(seconds(10.1));
    expect(drops).toHaveLength(0);
  });

  it('the always-drop cheat drops one for every kill, past the cap', () => {
    const g = game();
    const rules = g.state.zombies!.rules.powerups;
    rules.chance = 0;
    rules.perRound = 1;
    g.player.admin = {
      infiniteHealth: false,
      infiniteAmmo: false,
      peaceful: false,
      infiniteConsumables: false,
      alwaysDrop: true,
    };
    g.run(seconds(3.1));
    killOne(g);
    killOne(g);
    expect(g.state.zombies!.drops).toHaveLength(2);
  });

  it('insta-kill: any hit kills a zombie, until it runs out', () => {
    const g = game();
    const zs = g.state.zombies!;
    g.run(seconds(3.1));
    const [a, b] = g.zombies();
    g.state.zombies!.drops.push({
      id: 1,
      kind: 'instaKill',
      x: g.player.x,
      y: 0,
      z: g.player.z,
      left: 10,
    });
    g.run(1);
    expect(zs.instaKill).toBeGreaterThan(4.9);
    woundZone(g.state, items, a!, 4, 1, knife, g.player.id, 'shot');
    expect(a!.health.dead).toBe(true);
    g.run(seconds(5));
    expect(zs.instaKill).toBe(0);
    woundZone(g.state, items, b!, 4, 1, knife, g.player.id, 'shot');
    expect(b!.health.dead).toBe(false);
  });

  it('double points doubles what hits and kills pay', () => {
    const g = game();
    g.run(seconds(3.1));
    g.state.zombies!.doublePoints = 5;
    killOne(g);
    expect(pointsOf(g.state, g.player.id)).toBe(500 + 120);
  });

  it('carpenter boards every window up and pays; max ammo fills only the spare rounds', () => {
    const g = game();
    const zs = g.state.zombies!;
    zs.windows[0]!.planks = 1;
    giveWeapon(g.player, items, 'rifle');
    g.player.gear.rig = createItem(items, 'rig') as never;
    g.player.gear.primary1!.mag = 3;
    const pick = (kind: 'carpenter' | 'maxAmmo'): void => {
      zs.drops.push({ id: 9, kind, x: g.player.x, y: 0, z: g.player.z, left: 10 });
      g.run(1);
    };
    pick('carpenter');
    expect(zs.windows[0]!.planks).toBe(6);
    expect(pointsOf(g.state, g.player.id)).toBe(700);
    pick('maxAmmo');
    expect(carriedAmmo(g.player, 'round')).toBe(60);
    expect(g.player.gear.primary1!.mag).toBe(3);
  });

  it('the death machine is a minigun in hand for a while, then gives back what it replaced', () => {
    const g = game();
    const zs = g.state.zombies!;
    giveWeapon(g.player, items, 'rifle');
    g.player.gear.hand = 'knife';
    const rifle = g.player.gear.primary1;
    zs.drops.push({ id: 9, kind: 'deathMachine', x: g.player.x, y: 0, z: g.player.z, left: 10 });
    g.run(1);
    expect(g.player.gear.primary1?.item).toBe('minigun');
    expect(g.player.gear.hand).toBe('primary1');
    // Firing it uses nothing, and no new guns meanwhile.
    g.run(seconds(1), input({ fire: true }));
    expect(g.player.gear.primary1!.mag).toBe(30);
    g.player.z = -7;
    zs.points[g.player.id] = 5000;
    g.run(1, input({ buy: buyInReach(g.state, g.player) }));
    expect(g.state.events).toContainEqual(expect.objectContaining({ type: 'buy', result: 'busy' }));
    // Nor switching to anything else until it ends.
    g.run(1, input({ draw: 'knife' }));
    expect(g.player.gear.hand).toBe('primary1');
    g.run(seconds(4.1));
    expect(g.player.gear.primary1).toBe(rifle);
    expect(g.player.gear.hand).toBe('knife');
    expect(zs.machines[g.player.id]).toBeUndefined();
  });
});

describe('the ray gun', () => {
  it("a player's own blast doesn't hurt players in zombies mode, but hurts zombies", () => {
    const g = game();
    g.run(seconds(2.05));
    const z = g.zombies()[0]!;
    const hp = g.player.health.hp[CHEST];
    woundZone(g.state, items, g.player, 1, 80, knife, g.player.id, 'explosion');
    expect(g.player.health.hp[CHEST]).toBe(hp);
    woundZone(g.state, items, z, 1, 80, knife, g.player.id, 'explosion');
    expect(z.health.dead).toBe(true);
  });
});
