import type { MapFile, MapNode } from '@mes/shared';

/*
 * Editing a map file in place: finding nodes by index path, moving them between frames,
 * grouping, duplicating. The editor keeps the file as plain JSON, so what it saves is
 * exactly what it edited. Positions are rounded to a millimetre and angles to a hundredth
 * of a degree as they're written, to keep the files tidy.
 */

export type Vec3 = [number, number, number];
type Group = Extract<MapNode, { type: 'group' }>;
type Patrol = Extract<MapNode, { type: 'patrol' }>;

const DEG = Math.PI / 180;

/** Indices from the map's nodes down through groups. */
export type NodePath = readonly number[];

export const round = (n: number, step = 1e-3): number => {
  const r = Math.round(n / step) * step;
  // Tidy floating point (0.30000000000000004) and −0.
  return Number(r.toFixed(6)) + 0;
};
const roundAngle = (deg: number): number => {
  const a = round((((deg % 360) + 540) % 360) - 180, 0.01);
  return a === -180 ? 180 : a;
};

/** The node list a path's group holds; the map's own list for the empty path. */
export function nodesAt(map: MapFile, scope: NodePath): MapNode[] {
  let list = map.nodes;
  for (const i of scope) {
    const n = list[i];
    if (n?.type !== 'group') throw new Error(`no group at ${scope.join('.')}`);
    list = n.nodes;
  }
  return list;
}

export function nodeAt(map: MapFile, path: NodePath): MapNode | undefined {
  if (path.length === 0) return undefined;
  try {
    return nodesAt(map, path.slice(0, -1))[path[path.length - 1]!];
  } catch {
    return undefined;
  }
}

/** Where a node stands; a patrol stands at its first point. */
export function nodePos(n: MapNode): Vec3 {
  if (n.type === 'patrol') {
    const p = n.points[0]!;
    return [...(Array.isArray(p) ? p : p.pos)];
  }
  return [...n.pos];
}

export function nodeYaw(n: MapNode): number {
  return 'yaw' in n ? (n.yaw ?? 0) : 0;
}

/** Whether a node has a yaw to turn. Patrols and loot spawns don't. */
export function canTurn(n: MapNode): boolean {
  return (
    n.type !== 'patrol' &&
    n.type !== 'lootSpawn' &&
    n.type !== 'questMarker' &&
    n.type !== 'extraction'
  );
}

/**
 * Puts a node at a position in its frame, with a yaw in degrees if it turns. A patrol moves
 * all its points with its first.
 */
export function placeNode(n: MapNode, pos: readonly number[], yaw?: number): void {
  const to: Vec3 = [round(pos[0]!), round(pos[1]!), round(pos[2]!)];
  if (n.type === 'patrol') {
    const [fx, fy, fz] = nodePos(n);
    shiftPatrol(n, (p) => [
      round(p[0] + to[0] - fx),
      round(p[1] + to[1] - fy),
      round(p[2] + to[2] - fz),
    ]);
    return;
  }
  n.pos = to;
  if (yaw !== undefined && canTurn(n)) setYaw(n, yaw);
}

function setYaw(n: MapNode, deg: number): void {
  if (!canTurn(n)) return;
  const yaw = roundAngle(deg);
  if (yaw === 0) delete (n as { yaw?: number }).yaw;
  else (n as { yaw?: number }).yaw = yaw;
}

function shiftPatrol(n: Patrol, f: (p: Vec3) => Vec3): void {
  n.points = n.points.map((p) => (Array.isArray(p) ? f(p) : { ...p, pos: f(p.pos) }));
}

/** A position in a frame (at `at`, turned by `yaw` degrees) in the frame's parent. */
export function toParent(p: readonly number[], at: readonly number[], yaw: number): Vec3 {
  const c = Math.cos(yaw * DEG);
  const s = Math.sin(yaw * DEG);
  return [at[0]! + p[0]! * c + p[2]! * s, at[1]! + p[1]!, at[2]! - p[0]! * s + p[2]! * c];
}

/** The inverse of toParent. */
export function toLocal(p: readonly number[], at: readonly number[], yaw: number): Vec3 {
  const c = Math.cos(yaw * DEG);
  const s = Math.sin(yaw * DEG);
  const dx = p[0]! - at[0]!;
  const dz = p[2]! - at[2]!;
  return [dx * c - dz * s, p[1]! - at[1]!, dx * s + dz * c];
}

/**
 * Moves a node as if fixed to a point that moved from `from` to `to` and turned `yaw`
 * degrees about it: how the gizmo moves what's selected. A patrol's points all go with it.
 */
export function moveWith(
  n: MapNode,
  from: readonly number[],
  to: readonly number[],
  yaw: number,
): void {
  const move = (p: readonly number[]): Vec3 =>
    toParent(toLocal(p, from, 0), to, yaw).map((v) => round(v)) as Vec3;
  if (n.type === 'patrol') return shiftPatrol(n, move);
  n.pos = move(n.pos);
  if (canTurn(n)) setYaw(n, nodeYaw(n) + yaw);
}

/** Moves a node from a frame's inside to its parent, or the other way with `into`. */
function reframe(n: MapNode, at: readonly number[], yaw: number, into: boolean): void {
  const move = (p: readonly number[]): Vec3 =>
    (into ? toLocal(p, at, yaw) : toParent(p, at, yaw)).map((v) => round(v)) as Vec3;
  if (n.type === 'patrol') return shiftPatrol(n, move);
  n.pos = move(n.pos);
  if (canTurn(n)) setYaw(n, nodeYaw(n) + (into ? -yaw : yaw));
}

/**
 * Puts the nodes at these indices of a list into a new group in their place (at the first
 * one's index), standing at the middle of where they stand, at the lowest of them. Returns
 * the group's index.
 */
export function groupNodes(list: MapNode[], indices: readonly number[], name?: string): number {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('nothing to group');
  const picked = sorted.map((i) => list[i]!);
  const ps = picked.map(nodePos);
  const at: Vec3 = [
    round(ps.reduce((t, p) => t + p[0], 0) / ps.length),
    round(Math.min(...ps.map((p) => p[1]))),
    round(ps.reduce((t, p) => t + p[2], 0) / ps.length),
  ];
  for (const n of picked) reframe(n, at, 0, true);
  const group: Group = { type: 'group', ...(name && { name }), pos: at, nodes: picked };
  for (const i of [...sorted].reverse()) list.splice(i, 1);
  list.splice(sorted[0]!, 0, group);
  return sorted[0]!;
}

/** Replaces the group at an index with what it holds. Returns the indices they now have. */
export function ungroup(list: MapNode[], index: number): number[] {
  const g = list[index];
  if (g?.type !== 'group') throw new Error('not a group');
  for (const n of g.nodes) reframe(n, g.pos, nodeYaw(g), false);
  list.splice(index, 1, ...g.nodes);
  return g.nodes.map((_, k) => index + k);
}

/** Every id in these nodes and the groups in them. */
export function collectIds(nodes: readonly MapNode[], into = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.type === 'group') collectIds(n.nodes, into);
    else if (n.id !== undefined) into.add(n.id);
  }
  return into;
}

/** `base`, or base-2, base-3… (without base's own number) if it's taken. Adds it to taken. */
export function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  if (taken.has(id)) {
    const stem = base.replace(/-\d+$/, '');
    let k = 2;
    while (taken.has(`${stem}-${k}`)) k++;
    id = `${stem}-${k}`;
  }
  taken.add(id);
  return id;
}

/**
 * A copy of a node with fresh ids (unique against `taken`, which they're added to). An
 * enemy spawn copied with its patrol keeps following its own copy.
 */
export function copyNode(n: MapNode, taken: Set<string>): MapNode {
  const copy = structuredClone(n);
  const renamed = new Map<string, string>();
  const rename = (list: MapNode[]): void => {
    for (const c of list) {
      if (c.type === 'group') rename(c.nodes);
      else if (c.id !== undefined) {
        const id = uniqueId(c.id, taken);
        renamed.set(c.id, id);
        c.id = id;
      }
    }
  };
  const repoint = (list: MapNode[]): void => {
    for (const c of list) {
      if (c.type === 'group') repoint(c.nodes);
      else if (c.type === 'enemySpawn' && c.patrol !== undefined)
        c.patrol = renamed.get(c.patrol) ?? c.patrol;
    }
  };
  rename([copy]);
  repoint([copy]);
  return copy;
}

/** A short label for lists: the id or name; empty for a node without either. */
export function nodeLabel(n: MapNode): string {
  if (n.type === 'group') return n.name ?? `group of ${n.nodes.length}`;
  if (n.type === 'prefab') return n.id ? `${n.id} (${n.prefab})` : n.prefab;
  if (n.type === 'extraction') return n.id ?? n.name;
  return n.id ?? '';
}
