import { LOOT_REACH, type Character, type LootContainer, type SimState } from '@mes/shared';

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
