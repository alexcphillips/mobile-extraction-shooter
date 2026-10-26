import {
  LOOT_REACH,
  addItem,
  createItem,
  type Character,
  type CompiledMap,
  type ItemDb,
  type LootContainer,
  type SimState,
} from '@mes/shared';

/**
 * What each loot table puts in a container until loot tables are rolled (session 11): a
 * fixed sample, so session 10's looting has something to take. [item, count].
 */
const TEST_FILL: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  household: [
    ['cash', 1],
    ['gold-watch', 1],
    ['bandage', 1],
    ['ammo-9mm', 30],
  ],
  military: [
    ['pistol', 1],
    ['mag-9mm-24', 1],
    ['suppressor', 1],
    ['ammo-556', 90],
    ['medkit', 1],
    ['large-backpack', 1],
  ],
};

/** Fills every loot container with its loot table's test sample. */
export function fillTestLoot(sim: SimState, map: CompiledMap, items: ItemDb): void {
  const tables = new Map<string, string>();
  for (const m of map.markers) if (m.type === 'lootContainer') tables.set(m.id, m.lootTable);
  for (const l of sim.loot) {
    for (const [id, count] of TEST_FILL[tables.get(l.id) ?? ''] ?? []) {
      addItem(items, l.grid, createItem(items, id, count));
    }
  }
}

/** Something the use button can loot. */
export type Lootable = { kind: 'container'; c: LootContainer } | { kind: 'body'; c: Character };

const scratch = {
  container: { kind: 'container', c: null as unknown as LootContainer },
  body: { kind: 'body', c: null as unknown as Character },
};

/**
 * The container or dead body in reach that the player is most nearly facing, or null. One
 * right underfoot counts even behind. The result is reused: copy what you keep.
 */
export function lootableInReach(sim: SimState, player: Character, yaw: number): Lootable | null {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let best = -Infinity;
  let found: Lootable | null = null;
  for (const l of sim.loot) {
    const s = score(player, fx, fz, l.x, l.y, l.z);
    if (s > best) {
      best = s;
      scratch.container.c = l;
      found = scratch.container as Lootable;
    }
  }
  for (const e of sim.entities) {
    if (e === player || !e.health.dead) continue;
    const s = score(player, fx, fz, e.x, e.y, e.z);
    if (s > best) {
      best = s;
      scratch.body.c = e;
      found = scratch.body as Lootable;
    }
  }
  return found;
}

/** How squarely the player faces a spot in reach (higher is better), or -Infinity. */
function score(p: Character, fx: number, fz: number, x: number, y: number, z: number): number {
  const dx = x - p.x;
  const dz = z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > LOOT_REACH || Math.abs(y - p.y) > LOOT_REACH) return -Infinity;
  if (d < 0.6) return 1;
  const facing = (dx * fx + dz * fz) / d;
  return facing > 0.3 ? facing : -Infinity;
}
