import { describe, expect, it } from 'vitest';
import { ENEMY_FORMAT } from '../content/enemies';
import { ammoDef } from '../content/items';
import { loadContent } from '../content/format';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { DEFAULT_SKILL, spawnEnemy, updateAi } from './ai';
import { hostile } from './factions';
import { stow } from './gear';
import { CHEST, HEALTH, shootCharacter, totalHp } from './health';
import { createState, spawnCharacter, type Character, type SimState } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';

/** Flat ground, 120 m across (or half each way), with optional boxes. */
function makeWorld(half = 60, boxes: BoxDef[] = []): CollisionWorld {
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

function arm(c: Character): void {
  giveWeapon(c, items, 'rifle');
  stow(c, items, { item: 'round', count: 300 });
}

function run(state: SimState, world: CollisionWorld, nav: NavGrid, seconds: number): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) step(state, world, items, {}, nav);
}

const round = ammoDef(items, 'round');
const full = totalHp({ hp: [...HEALTH.maxHp] } as never);

describe('factions', () => {
  it('scavs and bosses are allies; PMCs are hostile to everyone; players to every enemy', () => {
    const state = createState(1);
    const world = makeWorld();
    const p1 = spawnCharacter(state, world, 0, 0);
    const p2 = spawnCharacter(state, world, 2, 0);
    const scav = spawnEnemy(state, world, 4, 0, 0, 0, { faction: 'scav' });
    const scav2 = spawnEnemy(state, world, 6, 0, 0, 0);
    const boss = spawnEnemy(state, world, 8, 0, 0, 0, { faction: 'boss' });
    const pmc = spawnEnemy(state, world, 10, 0, 0, 0, { faction: 'pmc' });
    const pmc2 = spawnEnemy(state, world, 12, 0, 0, 0, { faction: 'pmc' });
    expect(scav2.ai!.faction).toBe('scav');
    expect(hostile(p1, p2)).toBe(false);
    for (const e of [scav, boss, pmc]) {
      expect(hostile(p1, e)).toBe(true);
      expect(hostile(e, p1)).toBe(true);
    }
    expect(hostile(scav, scav2)).toBe(false);
    expect(hostile(scav, boss)).toBe(false);
    expect(hostile(scav, pmc)).toBe(true);
    expect(hostile(boss, pmc)).toBe(true);
    // Two PMCs not in the same squad (AI-3) are hostile.
    expect(hostile(pmc, pmc2)).toBe(true);
    expect(hostile(pmc, pmc)).toBe(false);
    // A save from before factions has none: a scav.
    delete scav2.ai!.faction;
    expect(hostile(scav2, scav)).toBe(false);
    expect(hostile(scav2, pmc)).toBe(true);
  });

  it("an ally's hit does nothing; another faction's lands", () => {
    const state = createState(1);
    const world = makeWorld();
    const scav = spawnEnemy(state, world, 0, 0, 0, 0, { faction: 'scav' });
    const boss = spawnEnemy(state, world, 2, 0, 0, 0, { faction: 'boss' });
    const pmc = spawnEnemy(state, world, 4, 0, 0, 0, { faction: 'pmc' });
    shootCharacter(state, items, scav, CHEST, round, boss.id);
    expect(totalHp(scav.health)).toBe(full);
    shootCharacter(state, items, scav, CHEST, round, pmc.id);
    expect(totalHp(scav.health)).toBeLessThan(full);
    shootCharacter(state, items, pmc, CHEST, round, boss.id);
    expect(totalHp(pmc.health)).toBeLessThan(full);
  });

  it('a scav and a PMC that see each other fight it out with no player about', () => {
    const state = createState(3);
    const world = makeWorld();
    const nav = new NavGrid(world);
    // Facing each other 25 m apart.
    const scav = spawnEnemy(state, world, 0, 0, 12, 0, { faction: 'scav' });
    const pmc = spawnEnemy(state, world, 0, 0, -13, Math.PI, { faction: 'pmc' });
    arm(scav);
    arm(pmc);
    let scavAlert = false;
    let pmcAlert = false;
    for (let t = 0; t < 40 * TICK_RATE && !scav.health.dead && !pmc.health.dead; t++) {
      run(state, world, nav, 1 / TICK_RATE);
      if (scav.ai!.awareness === 'alert' && scav.ai!.target === pmc.id) scavAlert = true;
      if (pmc.ai!.awareness === 'alert' && pmc.ai!.target === scav.id) pmcAlert = true;
    }
    expect(scavAlert).toBe(true);
    expect(pmcAlert).toBe(true);
    expect(scav.health.dead || pmc.health.dead).toBe(true);
  });

  it("is alarmed by another faction's hit, and turns on whoever did it", () => {
    const state = createState(1);
    const world = makeWorld();
    const nav = new NavGrid(world);
    // The PMC behind the scav, out of its view.
    const scav = spawnEnemy(state, world, 0, 0, 0, 0, { faction: 'scav' });
    const pmc = spawnEnemy(state, world, 0, 0, 20, 0, { faction: 'pmc' });
    // As at the end of the tick the hit landed in.
    shootCharacter(state, items, scav, CHEST, round, pmc.id);
    updateAi(state, world, items, nav);
    expect(scav.ai!.awareness).toBe('alert');
    expect(scav.ai!.target).toBe(pmc.id);
  });

  it("hears another faction's shots as a noise to check, not an ally's call", () => {
    // A scav fighting a player far off; a PMC behind a wall 40 m from the scav hears it.
    const state = createState(5);
    const world = makeWorld(80, [{ x: 0, y: 1.5, z: 25, hx: 30, hy: 1.5, hz: 0.2, yaw: 0 }]);
    const nav = new NavGrid(world);
    const player = spawnCharacter(state, world, 0, -20);
    player.health.hp.fill(1e6);
    const scav = spawnEnemy(state, world, 0, 0, 0, 0, { faction: 'scav' });
    arm(scav);
    const pmc = spawnEnemy(state, world, 0, 0, 40, 0, { faction: 'pmc' });
    let heard = false;
    for (let t = 0; t < 6 * TICK_RATE && !heard; t++) {
      step(state, world, items, {}, nav);
      if (pmc.ai!.awareness !== 'unaware') heard = true;
    }
    expect(heard).toBe(true);
    // Suspicious of where the shots came from (the scav), not told where the player is.
    expect(pmc.ai!.target).not.toBe(player.id);
    expect(Math.hypot(pmc.ai!.focusX - scav.x, pmc.ai!.focusZ - scav.z)).toBeLessThan(8);
  });

  it("a map's hearing scale shortens how far shots carry", () => {
    // The test rifle is heard 150 m away. 120 m behind: heard at 1, not at 0.6.
    for (const [scale, heard] of [
      [1, true],
      [0.6, false],
    ] as const) {
      const state = createState(1);
      state.hearingScale = scale;
      const world = makeWorld(140);
      const nav = new NavGrid(world);
      const enemy = spawnEnemy(state, world, 0, 0, 0, 0, { skill: DEFAULT_SKILL });
      const player = spawnCharacter(state, world, 0, 120);
      giveWeapon(player, items, 'rifle');
      step(
        state,
        world,
        items,
        {
          [player.id]: {
            moveX: 0,
            moveY: 0,
            yaw: 0,
            pitch: 1.4,
            sprint: false,
            crouch: false,
            jump: false,
            fire: true,
            aim: false,
            reload: false,
          },
        },
        nav,
      );
      expect(enemy.ai!.awareness !== 'unaware', `scale ${scale}`).toBe(heard);
    }
  });

  it('picks one of its outfits at spawn, and none from the RNG with only one', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const state = createState(seed);
      const c = spawnEnemy(state, makeWorld(), 0, 0, 0, 0, { outfits: 3, type: 'scav' });
      seen.add(c.look!.outfit);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
    const a = createState(9);
    const b = createState(9);
    spawnEnemy(a, makeWorld(), 0, 0, 0, 0);
    spawnEnemy(b, makeWorld(), 0, 0, 0, 0, { outfits: 1 });
    expect(a.rng).toEqual(b.rng);
  });

  it('migrates enemy format 1: a scav, its one outfit in a list', () => {
    const skill = { reaction: 1, aimError: 5, aimSettled: 1, aimSettle: 1, holdChance: 0.5 };
    const outfit = {
      skin: '#000000',
      top: '#111111',
      bottom: '#222222',
      hands: '#333333',
      feet: '#444444',
    };
    const def = loadContent(
      ENEMY_FORMAT,
      { formatVersion: 1, id: 'grunt', name: 'Grunt', loadout: 'kit', skill, outfit },
      'grunt',
    );
    expect(def.faction).toBe('scav');
    expect(def.outfits).toEqual([outfit]);
    const plain = loadContent(
      ENEMY_FORMAT,
      { formatVersion: 1, id: 'grunt', name: 'Grunt', loadout: 'kit', skill },
      'grunt',
    );
    expect(plain.outfits).toBeUndefined();
  });
});
