import {
  PREFAB_FORMAT_VERSION,
  type MapFile,
  type MapNode,
  type PrefabFile,
  type PrefabLookup,
} from '@mes/shared';

/*
 * Editing a map file in place: finding nodes by index path, moving them between frames,
 * grouping, duplicating, making and unpacking prefabs. The editor keeps the file as plain JSON, so what it saves is
 * exactly what it edited. Positions are rounded to a millimetre and angles to a hundredth
 * of a degree as they're written, to keep the files tidy.
 */

export type Vec3 = [number, number, number];
type Group = Extract<MapNode, { type: 'group' }>;
type Patrol = Extract<MapNode, { type: 'patrol' }>;
type Placement = Extract<MapNode, { type: 'prefab' }>;

const DEG = Math.PI / 180;

/**
 * Indices from the map's nodes down through groups and placed prefabs: a step into a
 * prefab goes on into that prefab file's nodes.
 */
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

/**
 * The node list a path's group or prefab holds; the map's own list for the empty path.
 * Without `prefabs`, a path only goes through groups.
 */
export function nodesAt(map: MapFile, scope: NodePath, prefabs?: PrefabLookup): MapNode[] {
  let list = map.nodes;
  for (const i of scope) {
    const n = list[i];
    const prefab = n?.type === 'prefab' ? prefabs?.get(n.prefab) : undefined;
    if (n?.type === 'group') list = n.nodes;
    else if (prefab) list = prefab.nodes;
    else throw new Error(`no group at ${scope.join('.')}`);
  }
  return list;
}

export function nodeAt(map: MapFile, path: NodePath, prefabs?: PrefabLookup): MapNode | undefined {
  if (path.length === 0) return undefined;
  try {
    return nodesAt(map, path.slice(0, -1), prefabs)[path[path.length - 1]!];
  } catch {
    return undefined;
  }
}

/** Whether a node can be entered to edit inside: a group, or a prefab that exists. */
export function canEnter(n: MapNode | undefined, prefabs: PrefabLookup): boolean {
  return n?.type === 'group' || (n?.type === 'prefab' && prefabs.has(n.prefab));
}

/** The prefabs a scope goes into, outermost first, each with the path that places it. */
export function scopePrefabs(
  map: MapFile,
  scope: NodePath,
  prefabs: PrefabLookup,
): { prefab: PrefabFile; path: NodePath }[] {
  const out: { prefab: PrefabFile; path: NodePath }[] = [];
  for (let k = 1; k <= scope.length; k++) {
    const n = nodeAt(map, scope.slice(0, k), prefabs);
    const prefab = n?.type === 'prefab' ? prefabs.get(n.prefab) : undefined;
    if (prefab) out.push({ prefab, path: scope.slice(0, k) });
  }
  return out;
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

/** How many times a prefab is placed in these nodes, inside groups and other prefabs too. */
export function countPlacements(
  nodes: readonly MapNode[],
  id: string,
  prefabs: PrefabLookup,
  stack: readonly string[] = [],
): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'group') count += countPlacements(n.nodes, id, prefabs, stack);
    if (n.type !== 'prefab' || stack.includes(n.prefab)) continue;
    if (n.prefab === id) count++;
    const p = prefabs.get(n.prefab);
    if (p) count += countPlacements(p.nodes, id, prefabs, [...stack, n.prefab]);
  }
  return count;
}

/**
 * Calls `f` with every colour reference in these nodes, groups included (a shape's colour
 * and a placement's overrides), and puts back what it returns.
 */
export function eachColour(nodes: MapNode[], f: (ref: string) => string): void {
  for (const n of nodes) {
    if (n.type === 'group') eachColour(n.nodes, f);
    else if (n.type === 'prefab') {
      for (const [slot, ref] of Object.entries(n.colours ?? {})) n.colours![slot] = f(ref);
    } else if ('colour' in n && typeof n.colour === 'string') n.colour = f(n.colour);
  }
}

/** Whether a placement of this prefab should get an id: a building, or one with ids in it. */
export function placementNeedsId(prefab: PrefabFile): boolean {
  return !!prefab.building || collectIds(prefab.nodes).size > 0;
}

/**
 * Moves the nodes at these indices of a list into a new prefab, and puts one placement of
 * it in their place (at the first one's index), standing where a group of them would. The
 * colour slots they use (from `slots`, the file's own) come along as the prefab's, and the
 * placement passes the file's slots on to them, so nothing changes colour. The placement
 * gets an id (unique against `taken`) if what's in it has ids.
 */
export function makePrefab(
  list: MapNode[],
  indices: readonly number[],
  id: string,
  name: string,
  slots: Readonly<Record<string, string>>,
  taken: Set<string>,
): { prefab: PrefabFile; index: number } {
  const index = groupNodes(list, indices);
  const group = list[index] as Group;
  const used = new Set<string>();
  eachColour(group.nodes, (ref) => {
    if (!ref.startsWith('#') && slots[ref] !== undefined) used.add(ref);
    return ref;
  });
  const colours = Object.fromEntries([...used].map((s) => [s, slots[s]!]));
  const prefab: PrefabFile = {
    formatVersion: PREFAB_FORMAT_VERSION,
    id,
    ...(name && { name }),
    ...(used.size > 0 && { colours }),
    nodes: group.nodes,
  };
  const placement: Placement = {
    type: 'prefab',
    ...(placementNeedsId(prefab) && { id: uniqueId(id, taken) }),
    prefab: id,
    pos: group.pos,
    ...(used.size > 0 && { colours: Object.fromEntries([...used].map((s) => [s, s])) }),
  };
  list[index] = placement;
  return { prefab, index };
}

/**
 * Replaces the prefab placed at an index with a group of copies of its parts, where it
 * stood. Their colour slots become the placement's colours (hex, or the slot of the
 * enclosing file it named), and their ids are made unique against `taken`. A building's
 * footprint doesn't come along: a group has none.
 */
export function unpackPrefab(
  list: MapNode[],
  index: number,
  prefab: PrefabFile,
  taken: Set<string>,
): void {
  const n = list[index];
  if (n?.type !== 'prefab') throw new Error('not a prefab');
  const resolved: Record<string, string> = { ...prefab.colours, ...n.colours };
  const group: Group = {
    type: 'group',
    name: n.id ?? prefab.id,
    pos: [...n.pos],
    ...(n.yaw ? { yaw: n.yaw } : {}),
    nodes: structuredClone(prefab.nodes),
  };
  eachColour(group.nodes, (ref) => resolved[ref] ?? ref);
  list[index] = copyNode(group, taken);
}
