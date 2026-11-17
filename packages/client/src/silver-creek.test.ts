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
      ['fire lookout foot', 30, 8],
      ['lookout hut, inside', 38, 8.5, ground(37.8, 6.4) + 0.15],
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
      // 2026-11-16: the filing loft, its room, the catwalk and the shed roof, by the loft stair.
      ['filing loft', 149, 96.3, 3.5],
      ['filing room', 148.5, 99.5, 3.5],
      ['catwalk', 170, 98.9, 3.5],
      ['lumber shed roof', 150, 105, 3.3],
      ['powerhouse control room', 138.5, 137.8, 3.6],
      ['powerhouse gallery', 125, 138.4, 3.6],
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
      ['house 1 kitchen', 38.5, 73.5, 0.35],
      ['house 1 entry', 44.8, 74.5, 0.35],
      ['house 1 living', 42.5, 71.5, 0.35],
      ['house 1 bedroom', 39.3, 70.5, 0.35],
      ['house 2 hall', 59.2, 75.5, 0.3],
      ['house 2 living', 57.3, 73.5, 0.3],
      ['house 2 dining', 57.7, 68.9, 0.3],
      ['house 2 library', 62, 73.5, 0.3],
      ['house 2 kitchen', 62.5, 71.5, 0.3],
      ['house 2 upstairs hall', 59.1, 72.5, 3.3],
      ['house 2 master bedroom', 57, 74.5, 3.3],
      ['house 2 office', 57, 71, 3.3],
      ['house 2 second bedroom', 62.1, 74, 3.3],
      ['house 2 bathroom', 62.1, 70, 3.3],
      ['house 3 west kitchen', 73.9, 73.5, 0.35],
      ['house 3 west bedroom', 75.5, 70.9, 0.35],
      ['house 3 east living', 80.9, 73.5, 0.35],
      ['house 3 kids room', 80.9, 70.7, 0.35],
      ['house 4 living', 48.5, 88.9, 0.35],
      ['house 4 kitchen', 42.9, 88.9, 0.35],
      ['house 4 bedroom', 48, 90.9, 0.35],
      ['house 4 workroom', 42.7, 91.7, 0.35],
      ['house 5 living', 65, 87.5, 0.35],
      ['house 5 bedroom', 66.2, 90.5, 0.35],
      ['house 5 kitchen', 64, 90.5, 0.35],
      ['house 5 garage', 58.9, 91, 0.35],
      ['house 6 dining hall', 81.5, 90.3, 0.35],
      ['house 6 bedroom', 84.3, 90, 0.35],
      ['house 6 kitchen', 78.5, 88.5, 0.35],
      ['house 6 sunroom', 81.5, 92.5, 0.35],
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
      ['grading shed, west aisle', 132.6, 88],
      ['grading shed, east aisle', 135.9, 88],
      ['trail past a pile (north)', 140, 17.6, ground(140, 20)],
      ['trail past a pile (south)', 179, 22.4, ground(140, 20)],
      ['clear-cut landing, past the skidder', 213, 18.2, ground(140, 20)],
      // rooms made 2026-11-17: the crane's engine house, the scaler's shack, the headgate house
      ['crane engine house', 134.2, 37.8, 0.1],
      ['jack ladder ramp top', 190.2, 72.2, 3.0],
      ['scaler shack', 122.5, 56.9, 0.1],
      ['headgate house', 216.5, 101, 0.1],
      ['tunnel west mouth', 113, 106],
      ['tunnel east mouth', 219, 106],
      // MT-8: the east end's rooms, decks and pit, and the way past the yard's tie stacks.
      ['loading tower deck 1', 277.5, 37, 3.3],
      ['loading tower deck 2', 277, 37.5, 6.6],
      ['freight dock', 243, 39.5, 1.2],
      // the rail yard's rooms (2026-11-17): the open boxcar off the dock's plate, the
      // caboose by its steps, the section house, the speeder shed
      ['open boxcar', 252, 44, 1.3],
      ['caboose', 200, 51, 1.1],
      ['section house', 214.5, 38.6, 0.15],
      ['speeder shed', 302.6, 37.8, 0.1],
      ['yard lane past a tie stack', 216, 48.6],
      ['engine shed, road 1', 250, 63],
      ['engine shed pit', 261, 63, -1.4],
      ['engine shed walkway', 258, 65.2],
      ['engine shed, beside the switcher', 260, 70.6],
      ['engine shed tool room', 273.8, 59.5],
      // the engine shed's rework (2026-11-17): the loco shop's rooms, both stairs, the
      // balcony and the switcher's hood top by the gangway, the oil house, the fuel stand
      ['engine shed, east of the pit jack', 267, 63, -1.4],
      ['loco shop machine shop', 256, 77],
      ['loco shop battery room', 267, 74.5],
      ['loco shop stair room', 268, 77],
      ['loco shop crew room', 257, 78, 3.3],
      ['loco shop foreman office', 267, 76, 3.3],
      ['loco shop landing', 252.2, 73.5, 3.3],
      ['engine shed balcony', 266, 70.7, 3.3],
      ['switcher hood top', 261, 68, 3.3],
      ['oil house', 252.5, 55],
      ['fuel and sand stand', 283, 70.5],
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
      ['equipment depot walkway', 250, 124.9, 3.3],
      ['equipment depot crane bridge', 245, 132, 3.3],
      ['equipment depot parts cage', 258.5, 128],
      ['tire shop', 229, 132],
      ['equipment yard', 290.5, 134.8],
      ['equipment yard container', 284.5, 132.5, 0.2],
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

  it('the creek and pond are waded anywhere: waist deep, and the AI walks the bed', () => {
    // They were 2–3 m deep and stopped you like a wall (MT-1) until 2026-11-16.
    const main = at(5, 60);
    for (const [x, z] of [
      [166.6, 110],
      [162, 30],
      [165, 50],
      [166.6, 106], // over the race tunnel's roof
    ] as const) {
      if (z !== 106) expect(world.waterDepth(x, z)).toBeLessThanOrEqual(1.01);
      expect(at(x, z, z === 106 ? -3 : ground(x, z))).toBe(main);
    }
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
      // 10 s: wading is slow, and along the weir's face it's 9 m to the shore.
      for (let k = 0; k < 300; k++) {
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

  it('the AI reaches the electrical places: the substation, its switch house, the motor room', () => {
    // 2026-11-16: electrical loot near the middle, for quests and the hangar.
    const main = at(5, 60);
    expect(at(228, 103.5)).toBe(main); // the yard, between its gates
    expect(at(233.6, 105.6, 0.15)).toBe(main); // the switch house
    expect(at(144, 77.5, 0.3)).toBe(main); // the motor room
  });

  it("the race tunnel's cover can't put you through its walls or roof", () => {
    // Jumping, sprint-jumping and crouch-jumping at the crates pushed you through the 0.5 m
    // walls into the earth, then up onto the surface; vaulting landed on it (2026-11-16).
    const escaped: string[] = [];
    for (let x0 = 130; x0 <= 200; x0 += 3)
      for (const z0 of [104.8, 105.5, 106.2, 107.2])
        for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
          for (const mode of ['jump', 'sprint', 'crouch']) {
            const state = createState(1);
            const c = spawnCharacter(state, world, x0, z0, 0, -5.95);
            if (c.y < -6.1 || c.y > -5.9) continue;
            for (let k = 0; k < 60; k++) {
              const input = {
                moveX: 0,
                moveY: 1,
                yaw,
                pitch: 0,
                jump: k % 10 === 0,
                sprint: mode === 'sprint',
                crouch: mode === 'crouch' && k % 10 > 3,
              } as PlayerInput;
              step(state, world, new Map(), { [c.id]: input });
              // The shafts' stairs and the hatch's ladder are the ways out.
              const inside = c.x > 128.5 && c.x < 203.5 && Math.abs(c.x - 178.8) > 1.2;
              if (inside && (c.y > -3.7 || c.z < 104.5 || c.z > 107.5)) {
                escaped.push(`${mode} from ${x0}, ${z0}`);
                break;
              }
            }
          }
    expect(escaped).toEqual([]);
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

  it("the fire lookout's cab is out of everyone's reach", () => {
    const main = at(5, 60);
    expect(at(30, 8, ground(30, 8) + 17.2)).not.toBe(main);
  });

  it("the fire lookout's leaning legs stop shots all the way up", () => {
    // The north-east leg, 3.2 m off the middle at its foot and 2.0 m under the cab.
    for (const h of [1.5, 8, 15]) {
      const e = 3.2 - (1.2 * h) / 17;
      const d = world.raycast(40, ground(30, 8) + h, 8 - e, -1, 0, 0, 20);
      expect(d).toBeGreaterThan(40 - (30 + e) - 0.3);
      expect(d).toBeLessThan(40 - (30 + e));
    }
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
    // MT-6: off the open west edge of the office's fire escape.
    expect(walk(19.4, 40.4, west, 4)).toEqual([expect.closeTo(0, 1), full]);
    // MT-8: off the loading tower's upper deck, sprinting, onto the lower deck's apron or
    // the chip car flush with it, and on off the car onto the ground; through the gap in
    // the depot mezzanine's rail onto the floor (over the parts cage's gate, 2026-11-17).
    expect(walk(277, 38, Math.PI, 7, true)).toEqual([expect.closeTo(0, 1), full]);
    expect(walk(257, 128.4, west, 4)).toEqual([expect.closeTo(0, 1), full]);
    // Off the depot's crane bridge and the tire shop's roof (2026-11-17).
    expect(walk(245, 135, east, 4)).toEqual([expect.closeTo(0, 1), full]);
    expect(walk(228.5, 132, west, 4)).toEqual([expect.closeTo(0, 1), full]);
  });
});

/** The sketch's pixels in meters, as the generator places the deer stand. */
function sxz(p: number, z = false): number {
  return Math.round(((p - (z ? 46 : 40)) / 3) * 100) / 100;
}
