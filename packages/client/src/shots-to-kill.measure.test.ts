import {
  CollisionWorld,
  createArmor,
  createState,
  DEFAULT_SKILL,
  giveWeapon,
  NavGrid,
  spawnCharacter,
  spawnEnemy,
  step,
  stow,
  TICK_RATE,
  ZONE_NAMES,
  type PlayerInput,
} from '@mes/shared';
import { describe, it } from 'vitest';
import { loadEnemies, loadItems } from './content';

// GZ-3's measurement, kept for retuning damage or enemy aim: a PMC with an AKM (PS) against
// a player standing still in the open, facing it, with no helmet. How many hits it takes to
// kill, and where they land. Skipped unless asked for:
//   MEASURE=1 npx vitest run src/shots-to-kill.measure.test.ts --silent=false

const items = loadItems();
const pmc = loadEnemies().types.get('pmc')!;

const half = 80;
const n = Math.ceil(half / 4) * 2;
const world = new CollisionWorld({
  terrain: {
    minX: -half,
    minZ: -half,
    cellSize: 4,
    cols: n,
    rows: n,
    heights: Array((n + 1) ** 2).fill(0),
  },
  boxes: [],
  ramps: [],
  ladders: [],
});
const nav = new NavGrid(world);

const still: PlayerInput = {
  moveX: 0,
  moveY: 0,
  yaw: Math.PI,
  pitch: 0,
  sprint: false,
  crouch: false,
  jump: false,
  fire: false,
  aim: false,
  reload: false,
};

/** Hits until the player died (NaN if it lived a minute), counting where they landed. */
function trial(seed: number, range: number, armor: string | null, zones: number[]): number {
  const state = createState(seed);
  const enemy = spawnEnemy(state, world, 0, 0, 0, 0, { skill: { ...DEFAULT_SKILL, ...pmc.skill } });
  giveWeapon(enemy, items, 'akm');
  stow(enemy, items, { item: 'ammo-762x39', count: 600 });
  const player = spawnCharacter(state, world, 0, -range);
  if (armor) player.gear.bodyArmor = createArmor(items, armor);
  let hits = 0;
  for (let t = 0; t < 60 * TICK_RATE && !player.health.dead; t++) {
    state.events.length = 0;
    step(state, world, items, { [player.id]: still }, nav);
    for (const e of state.events)
      if (e.type === 'damage' && e.target === player.id && e.cause === 'shot') {
        hits++;
        zones[e.face ? zones.length - 1 : e.zone]!++;
      }
    player.x = 0;
    player.z = -range;
  }
  return player.health.dead ? hits : NaN;
}

describe.skipIf(!import.meta.env.MEASURE)('shots to kill (GZ-3 measurement)', () => {
  it('prints a table', () => {
    const names = [...ZONE_NAMES, 'face'];
    const rows: string[] = [];
    for (const armor of [null, 'tactical-vest', 'plate-carrier'])
      for (const range of [10, 25, 50]) {
        const zones = Array<number>(names.length).fill(0);
        const kills: number[] = [];
        for (let seed = 1; seed <= 40; seed++) {
          const h = trial(seed, range, armor, zones);
          if (!Number.isNaN(h)) kills.push(h);
        }
        kills.sort((a, b) => a - b);
        const mean = kills.reduce((a, b) => a + b, 0) / (kills.length || 1);
        const total = zones.reduce((a, b) => a + b, 0) || 1;
        const share = zones
          .map((z, i) => `${names[i]} ${Math.round((z / total) * 100)}`)
          .join(', ');
        rows.push(
          `${armor ?? 'none'} | ${range} m | mean ${mean.toFixed(1)} | median ${kills[kills.length >> 1]} | killed ${kills.length}/40 | ${share}`,
        );
      }
    console.log('\n' + rows.join('\n'));
  });
});
