import {
  CollisionWorld,
  createState,
  NavGrid,
  spawnCharacter,
  step,
  syncDoors,
  type PlayerInput,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadMap, loadRaid, raidIds } from './content';

// Silver Creek's graybox (MT-2): what the AI can reach, and what it can't, so a reshape in
// the editor that cuts a place off (or opens a perch to the AI) shows up here.
describe('Silver Creek', () => {
  const map = loadMap('silver-creek');
  const world = new CollisionWorld(map.world);
  const nav = new NavGrid(world);
  const ground = (x: number, z: number): number => world.terrain.heightAt(x, z);
  /** The nav node's component at a spot, or -1 if the AI can't stand there. */
  const at = (x: number, z: number, y = ground(x, z)): number => {
    const n = nav.nearest(x, y + 0.2, z, undefined, true);
    return n < 0 ? -1 : nav.component[n]!;
  };

  it('is first in the map list, tagged a starter map', () => {
    expect(raidIds()[0]).toBe('silver-creek');
    expect(loadRaid('silver-creek').tags).toEqual(['starter']);
  });

  it('the AI reaches every place from both ends, across all five crossings and the tunnel', () => {
    const main = at(5, 60);
    expect(main).toBeGreaterThanOrEqual(0);
    const places: [string, number, number, number?][] = [
      ['east spawn', 315, 90],
      ['company office yard', 30, 47],
      ['sheds', 53, 40],
      ['fire lookout landing', 30, 8, ground(30, 10.5) + 3.3],
      ['houses lane', 50, 81],
      ['gas station', 20, 126],
      ['log deck lane', 110, 40],
      ['timber yard', 117, 90],
      ['saw hall, west', 145, 88, 0.3],
      ['saw hall, over the creek', 166, 80, 0.3],
      ['saw hall, east', 188, 84, 0.3],
      ['kilns', 225, 94],
      ['rail yard', 230, 48],
      ['engine shed', 262, 75],
      ['water tower foot', 302, 80],
      ['bunkhouse', 297, 100],
      ['equipment depot', 247, 122],
      ['ridge trail west', 40, 20],
      ['log jam', 160.5, 20, ground(140, 20)],
      ['ridge trail east', 250, 20],
      ['hunting cabin', 84, 18],
      ['clear-cut', 228, 14],
      ['log boom', 166, 56, 0],
      ['road bridge', 168, 118, 0.3],
      ['weir ford', 163, 136, -2.6],
      ['mill race tunnel', 166, 106, -6],
      // MT-5: the office roof is a perch the AI can follow you up to, by the stairs.
      ['mill office roof', 187, 98.4, 3.5],
      ['mill office', 186, 99.5, 0.3],
      ['kiln 1', 206.5, 84],
      ['kiln 5', 234.5, 84],
      ['tunnel past the cover', 184, 107, -6],
      // MT-6: every room of the west end's buildings, upstairs included.
      ['company office hall', 27, 41.5, 0.3],
      ['company office pay office', 22.5, 41, 0.3],
      ['company office records', 22, 35.5, 0.3],
      ['company office manager', 29.5, 42, 0.3],
      ['company office store', 30.5, 36, 0.3],
      ['company office upstairs', 25, 38.5, 3.3],
      ['company office upstairs east', 31, 36, 3.3],
      ['company office chief', 21.5, 36, 3.3],
      ['company office fire escape', 19.25, 40.4, 3.3],
      ['house 1 hall', 41.5, 72.5, 0.35],
      ['house 1 living', 38.5, 75, 0.35],
      ['house 1 kitchen', 43.1, 73.7, 0.35],
      ['house 1 bedroom', 43.5, 71.5, 0.35],
      ['house 2 front', 61, 72.5, 0.35],
      ['house 2 bedroom west', 57, 70.9, 0.35],
      ['house 2 bathroom', 59.7, 70.5, 0.35],
      ['house 2 bedroom east', 62, 70.9, 0.35],
      ['house 3 kitchen', 73, 73.7, 0.35],
      ['house 3 living', 81.5, 73.3, 0.35],
      ['house 3 bedroom', 75.5, 71.5, 0.35],
      ['house 3 caved-in room', 82, 71.5, 0.35],
      ['house 4 living', 49.1, 89.5, 0.35],
      ['house 4 bedroom', 45.5, 90.8, 0.35],
      ['house 4 bathroom', 45.9, 87.2, 0.35],
      ['house 4 kitchen', 42, 92, 0.35],
      ['house 5 front room', 64.5, 87, 0.3],
      ['house 5 kitchen', 64.5, 91.5, 0.3],
      ['house 5 upstairs', 66, 89.5, 3.3],
      ['house 5 bedroom 1', 61.5, 86.7, 3.3],
      ['house 5 bedroom 2', 61.5, 92, 3.3],
      ['house 6 west', 84.5, 87, 0.35],
      ['house 6 camp', 83.5, 91, 0.35],
      ['house 6 east', 78, 88, 0.35],
      ['store shop floor', 38, 123, 0.3],
      ['store stockroom', 34.5, 130.5, 0.3],
      ['store office', 41, 130.4, 0.3],
      ['store toilet', 42, 132.1, 0.3],
      // MT-7: the cabin on its terrace, the campsite, the boom shack, the yard's lanes, and
      // the ways past the piles set across the ridge trail and the skidder.
      ['hunting cabin main room', 86.5, 12, 5.75],
      ['hunting cabin bunk room', 81, 11, 5.75],
      ['hunting cabin porch', 90, 11, 5.73],
      ['campsite', 125, 14],
      ['boom shack', 165, 56, 0.05],
      ['timber yard west lane', 106.5, 88],
      ['timber yard south lane', 106, 100],
      ['timber yard east lane', 122.5, 79],
      ['trail past a pile (north)', 140, 17.6, ground(140, 20)],
      ['trail past a pile (south)', 179, 22.4, ground(140, 20)],
      ['clear-cut landing, past the skidder', 213, 18.2, ground(140, 20)],
      ['tunnel west mouth', 113, 106],
      ['tunnel east mouth', 219, 106],
      // MT-8: the east end's rooms, decks and pit, and the way past the yard's tie stacks.
      ['loading tower deck 1', 277.5, 37, 3.3],
      ['loading tower deck 2', 277, 37.5, 6.6],
      ['freight dock', 243, 39.5, 1.2],
      ['yard lane past a tie stack', 216, 48.6],
      ['engine shed, road 1', 250, 63],
      ['engine shed pit', 261, 63, -1.4],
      ['engine shed walkway', 258, 65.2],
      ['engine shed, beside the switcher', 260, 70.6],
      ['engine shed tool room', 273.8, 59.5],
      ['pump house', 296, 73],
      ['bunkhouse west dorm', 290, 94.5, 0.35],
      ['bunkhouse common room', 283, 96.5, 0.35],
      ['bunkhouse east dorm', 278.2, 94.7, 0.35],
      ['bunkhouse washroom', 274, 99, 0.35],
      ['cookhouse mess hall', 275.7, 108, 0.35],
      ['cookhouse kitchen', 281, 106.5, 0.35],
      ['equipment depot floor', 245, 128],
      ['equipment depot mezzanine', 257, 127, 3.3],
      ['equipment depot office', 259, 135, 3.3],
      ['fuel bund', 268, 131.5],
    ];
    const cutOff = places.filter(([, x, z, y]) => at(x, z, y) !== main).map(([name]) => name);
    expect(cutOff).toEqual([]);
  });

  it('the AI (MT-9): light-kit scavs at the ends and ridge, the usual kit and PMCs round the mill', () => {
    expect(map.hearingScale).toBe(0.6);
    // Three squads at the start (2026-11-11).
    expect(map.pmcs).toEqual({ count: [3, 5], squads: 3, pmcSpawnsOnly: true });
    expect(map.scavPerSlot).toBe(3);
    // Every spawn, patrol stop and point of interest stands on the AI's main area.
    const main = at(5, 60);
    const spots = [
      ...map.markers
        .filter((m) => ['enemySpawn', 'pmcSpawn', 'poi'].includes(m.type))
        .map((m) => [m.id, m.x, m.y, m.z] as const),
      ...map.patrols.flatMap((p) =>
        p.points.map((q, i) => [`${p.id}#${i}`, q.x, q.y, q.z] as const),
      ),
    ];
    expect(spots.filter(([, x, y, z]) => at(x, z, y) !== main).map(([id]) => id)).toEqual([]);
    // The mill's four sectors get the usual kit; the ends' and the ridge's the light one.
    const mill = new Set(['sc-hall', 'sc-yard', 'sc-kilns', 'sc-crossings']);
    const spawns = map.markers.flatMap((m) => (m.type === 'enemySpawn' ? [m] : []));
    expect(new Set(spawns.map((m) => m.enemy))).toEqual(new Set(['scav', 'foreman']));
    // The foreman (MT-12) once, on his patrol round the saw hall, his guards with him.
    expect(spawns.filter((m) => m.enemy === 'foreman').map((m) => m.id)).toEqual(['boss-foreman']);
    const scavs = spawns.filter((m) => m.enemy === 'scav');
    // The points of interest's scavs are in once at the start (2026-11-11); only the edges'
    // are wave slots, each walking in once and then looping on.
    const posts = scavs.filter((m) => m.once);
    const edges = scavs.filter((m) => !m.once);
    for (const m of posts)
      expect([m.id, m.loadout]).toEqual([m.id, mill.has(m.oneOf!) ? undefined : 'scav-kit-light']);
    // Nine sectors at the points of interest, as against Northpoint's 12.
    expect(new Set(posts.map((m) => m.oneOf)).size).toBe(9);
    expect(edges.map((m) => m.id).every((id) => id.startsWith('sc-edge-'))).toBe(true);
    expect(edges).toHaveLength(8);
    const patrols = new Map(map.patrols.map((p) => [p.id, p]));
    for (const m of edges) {
      expect(m.oneOf).toBeUndefined();
      expect(patrols.get(m.patrol!)!.repeatFrom).toBeGreaterThan(0);
    }
    // PMCs start only round the mill.
    for (const m of map.markers.filter((m) => m.type === 'pmcSpawn'))
      expect(m.x > 100 && m.x < 228).toBe(true);
  });

  it('the kiln key room (MT-5) is shut to the AI until someone unlocks its door', () => {
    const locked = new NavGrid(world);
    syncDoors(createState(1), world, locked);
    const near = (x: number, z: number, y: number): number => {
      const n = locked.nearest(x, y + 0.2, z, undefined, true);
      return n < 0 ? -1 : locked.component[n]!;
    };
    const main = near(5, 60, ground(5, 60));
    expect(near(227.5, 85, ground(227.5, 85))).not.toBe(main);
    expect(near(220.5, 84, ground(220.5, 84))).toBe(main); // kiln 3 beside it is open
    expect(world.doors.filter((d) => d.key === 'kiln-key')).toHaveLength(1);
  });

  it('the creek is too deep to wade away from the crossings', () => {
    expect(at(166.6, 110, -4)).toBe(-1);
    expect(at(162, 30, -3.5)).toBe(-1);
    expect(at(165, 50, -3.5)).toBe(-1);
  });

  it('banks are walkable above the deep water: whoever wades in walks back out', () => {
    // Banks fell at 51° (over the 45° you can walk up), so the shallows along them were
    // pits you walked down into and couldn't leave (2026-11-10). From every shallow spot
    // on a bank, walking uphill (or, below the weir's face, along it) reaches dry
    // ground.
    const t = world.terrain;
    const g = { x: 0, z: 0 };
    const hit = { solid: -1 };
    const walkOut = (x: number, z: number, yaw: number | null): boolean => {
      const state = createState(1);
      const c = spawnCharacter(state, world, x, z, 0, t.heightAt(x, z) + 0.05);
      for (let k = 0; k < 150; k++) {
        t.gradientAt(c.x, c.z, g);
        const uphill = Math.hypot(g.x, g.z) > 0.05 ? Math.atan2(-g.x, -g.z) : c.yaw;
        const input = { moveX: 0, moveY: 1, yaw: yaw ?? uphill, pitch: 0 } as PlayerInput;
        step(state, world, new Map(), { [c.id]: input });
      }
      return world.waterDepth(c.x, c.z) === 0;
    };
    const stuck: string[] = [];
    let tried = 0;
    for (let x = 0.5; x < 320; x += 2) {
      for (let z = 0.5; z < 150; z += 2) {
        const depth = world.waterDepth(x, z);
        if (t.holeAt(x, z) || depth < 0.1 || depth > 1.1) continue;
        world.groundAt(x, z, 0.4, t.heightAt(x, z) + 0.45, hit);
        t.gradientAt(x, z, g);
        // On a flat bed (the ford's middle, among its boulders) there's no uphill to try.
        if (hit.solid >= 0 || Math.hypot(g.x, g.z) < 0.05) continue;
        tried++;
        if (walkOut(x, z, null)) continue;
        if ([0, 1, 2, 3].some((k) => walkOut(x, z, (k * Math.PI) / 2))) continue;
        stuck.push(`${x}, ${z}`);
      }
    }
    expect(tried).toBeGreaterThan(100);
    expect(stuck).toEqual([]);
  });

  it('ladder perches are player-only: the water tower, deer stands and crane cab', () => {
    const main = at(5, 60);
    expect(at(302, 74, 6.6)).not.toBe(main);
    expect(at(sxz(748), sxz(115, true), ground(sxz(748), sxz(115, true)) + 3.65)).not.toBe(main);
    expect(at(130, 37, 6.6)).not.toBe(main);
    expect(at(133.7, 37, 3.3)).not.toBe(main); // the crane's engine house
    expect(at(297, 72, 3.3)).not.toBe(main); // the water tower's pump house
    // MT-8: the switcher's cab and walkway, climbed onto from its deck (1.05 m)
    expect(at(256.5, 68, 1.05)).not.toBe(main);
    expect(at(262, 66.85, 1.05)).not.toBe(main);
  });

  it('the timber yard (MT-7): stack tops are player-only, climbed low to tall and dropped off', () => {
    const main = at(5, 60);
    expect(at(105.5, 75, 2.4)).not.toBe(main); // block 1, a tall stack's top
    expect(at(108, 76.3, 1.2)).not.toBe(main); // the low stack beside it
    // From the ground south of block 1, jumping and pushing north: onto the low stack, the
    // tall one, across the block and off its far side, unhurt.
    const state = createState(1);
    const c = spawnCharacter(state, world, 108, 78, 0, 0.1);
    const full = c.health.hp[4]!;
    let high = c.y;
    for (let t = 0; t < 200; t++) {
      step(state, world, new Map(), {
        [c.id]: { moveX: 0, moveY: 1, yaw: 0, pitch: 0, jump: t % 20 < 12 } as PlayerInput,
      });
      high = Math.max(high, c.y);
    }
    expect(high).toBeGreaterThan(2.3);
    expect(c.z).toBeLessThan(72);
    expect(Math.min(c.health.hp[4]!, c.health.hp[5]!)).toBe(full);
  });

  it("the fire lookout's cab and upper flights are out of everyone's reach (MT-6)", () => {
    const main = at(5, 60);
    const landing = ground(30, 10.5) + 3.3;
    for (const y of [3.3, 5.9, 8.5, 11.1, 13.7]) expect(at(30, 8, landing + y)).not.toBe(main);
    // the lowest flight starts 3.3 m over the landing: past a jump from the rail's top
    const state = createState(1);
    const c = spawnCharacter(state, world, 30, 8, 0, landing + 1.2);
    let high = c.y;
    for (let t = 0; t < 120; t++) {
      step(state, world, new Map(), {
        [c.id]: {
          moveX: 0,
          moveY: 1,
          yaw: Math.PI / 2,
          pitch: 0,
          jump: t % 20 === 0,
        } as PlayerInput,
      });
      high = Math.max(high, c.y);
    }
    expect(high).toBeLessThan(landing + 2.2);
  });
  it('falls (MT-3): the shafts are railed, and the crane and tower drop down unhurt', () => {
    /** Walks from (x, z), spawned on the highest surface below y; returns lowest y, leg HP. */
    const walk = (
      x: number,
      z: number,
      yaw: number,
      y: number,
      sprint = false,
    ): [number, number] => {
      const state = createState(1);
      const c = spawnCharacter(state, world, x, z, yaw, y);
      const input = { moveY: 1, yaw, moveX: 0, pitch: 0, sprint } as PlayerInput;
      let low = c.y;
      for (let t = 0; t < 120; t++) {
        step(state, world, new Map(), { [c.id]: input });
        low = Math.min(low, c.y);
      }
      return [low, Math.min(c.health.hp[4]!, c.health.hp[5]!)];
    };
    const east = -Math.PI / 2;
    const west = Math.PI / 2;
    expect(walk(134, 106, west, 1)[0]).toBeGreaterThan(-0.1); // west shaft's deep end
    expect(walk(198, 106, east, 1)[0]).toBeGreaterThan(-0.1); // east shaft's deep end
    const full = walk(5, 60, 0, 1)[1];
    expect(walk(130, 37, east, 7)).toEqual([expect.closeTo(0, 1), full]); // cab, house, ground
    expect(walk(302, 72, west, 7)).toEqual([expect.closeTo(0, 1), full]); // platform, pump house
    // MT-5: off the mill office's roof onto the saw floor.
    expect(walk(187, 96, 0, 4)).toEqual([expect.closeTo(0.3, 1), full]);
    // MT-6: off the open west edges of the lookout's landing and the office's fire escape.
    expect(walk(29, 8, west, ground(30, 10.5) + 4)).toEqual([
      expect.closeTo(ground(26, 8), 1),
      full,
    ]);
    expect(walk(19.4, 40.4, west, 4)).toEqual([expect.closeTo(0, 1), full]);
    // MT-8: off the loading tower's upper deck, sprinting, onto the lower deck's apron or
    // the chip car flush with it, and on off the car onto the ground; through the gap in
    // the depot mezzanine's rail onto the floor.
    expect(walk(277, 38, Math.PI, 7, true)).toEqual([expect.closeTo(0, 1), full]);
    expect(walk(257, 129.8, west, 4)).toEqual([expect.closeTo(0, 1), full]);
  });
});

/** The sketch's pixels in meters, as the generator places the deer stand. */
function sxz(p: number, z = false): number {
  return Math.round(((p - (z ? 46 : 40)) / 3) * 100) / 100;
}
