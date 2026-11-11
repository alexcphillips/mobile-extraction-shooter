import {
  ATTACHMENT_SLOTS,
  placeholderModel,
  type AttachmentSlot,
  type ModelPart,
  type Vec3,
  type WeaponModel,
} from '@mes/shared';
import * as THREE from 'three';
import type { Doc } from './editor';

/*
 * Edits to an item's model (session 18b) that keep it valid as its stats change: a gun's
 * mounts follow its slots, an attachment's points follow its slot.
 */

type Model = { parts: ModelPart[] } & Record<string, unknown>;
const modelOf = (doc: Doc): Model => doc.model as Model;

/**
 * Sets a gun's slots, giving a new slot a mount (where the placeholder gun of its hold has
 * one) and taking a dropped slot's mount, and its parts' hiddenBy, away.
 */
export function setSlots(doc: Doc, slots: readonly AttachmentSlot[]): void {
  const next = ATTACHMENT_SLOTS.filter((s) => slots.includes(s));
  if (next.length) doc.slots = next;
  else delete doc.slots;
  const model = modelOf(doc);
  const mounts = { ...((model.mounts as Partial<Record<AttachmentSlot, Vec3>>) ?? {}) };
  const guess = (placeholderModel({ type: 'weapon', hold: doc.hold, slots: next }) as WeaponModel)
    .mounts;
  for (const s of ATTACHMENT_SLOTS) {
    if (!next.includes(s)) delete mounts[s];
    else mounts[s] ??= guess?.[s] ?? [0, 0, 0];
  }
  // Keep the file's order: optic, muzzle, magazine.
  const ordered = Object.fromEntries(
    ATTACHMENT_SLOTS.filter((s) => mounts[s]).map((s) => [s, mounts[s]]),
  );
  if (Object.keys(ordered).length) model.mounts = ordered;
  else delete model.mounts;
  for (const p of model.parts) if (p.hiddenBy && !next.includes(p.hiddenBy)) delete p.hiddenBy;
}

/** After an attachment's slot changes: an optic has a sight point, a muzzle device a muzzle. */
export function fitPointsToSlot(doc: Doc): void {
  const model = modelOf(doc);
  const slot = doc.slot as AttachmentSlot;
  if (slot === 'optic') model.sight ??= [0, 0.04, 0];
  else delete model.sight;
  if (slot === 'muzzle') model.muzzle ??= [0, 0, -0.05];
  else delete model.muzzle;
}

/** A new part of a type, small and gray, at a point. */
export function newPart(type: ModelPart['type'], at: Vec3): ModelPart {
  const pos: [number, number, number] = [at[0], at[1], at[2]];
  if (type === 'cylinder')
    return { type, pos, pitch: 90, radius: 0.02, height: 0.1, color: '#3a3f44' };
  if (type === 'slab')
    return {
      type,
      pos,
      size: [0.1, 0.03, 0.08],
      corners: [0.02, 0.02, 0.02, 0.02],
      color: '#3a3f44',
    };
  return { type, pos, size: [0.05, 0.05, 0.1], color: '#3a3f44' };
}

/** The groups a model's parts name, in the order they first come. */
export function groupsOf(parts: readonly ModelPart[]): string[] {
  return [...new Set(parts.flatMap((p) => (p.group ? [p.group] : [])))];
}

/** What a part is called in the editor: its name, else its type and number. */
export const partLabel = (p: ModelPart, i: number): string => p.name ?? `${p.type} ${i + 1}`;

/**
 * Copies of some parts (mirrored left for right with `mirror`): one part's copy goes just
 * after it, several parts' copies at the end in their order. Returns the copies' indices.
 */
export function duplicateParts(
  parts: ModelPart[],
  indices: readonly number[],
  mirror: boolean | Axis,
) {
  const from = [...new Set(indices)].filter((i) => parts[i]).sort((a, b) => a - b);
  const axis: Axis | null = mirror === true ? 'x' : mirror || null;
  const copies = from.map((i) => (axis ? mirrorPart(parts[i]!, axis) : structuredClone(parts[i]!)));
  if (from.length === 1) {
    parts.splice(from[0]! + 1, 0, copies[0]!);
    return [from[0]! + 1];
  }
  const start = parts.length;
  parts.push(...copies);
  return copies.map((_, k) => start + k);
}

/** Takes parts away, keeping at least one; false (and nothing changed) if it would take all. */
export function removeParts(parts: ModelPart[], indices: readonly number[]): boolean {
  const gone = new Set(indices.filter((i) => parts[i]));
  if (!gone.size || gone.size >= parts.length) return false;
  const kept = parts.filter((_, i) => !gone.has(i));
  parts.splice(0, parts.length, ...kept);
  return true;
}

/** Adds parts (pasted from another item, say) at the end; returns their indices. */
export function appendParts(parts: ModelPart[], add: readonly ModelPart[]): number[] {
  const start = parts.length;
  parts.push(...add.map((p) => structuredClone(p)));
  return add.map((_, k) => start + k);
}

export type Axis = 'x' | 'y' | 'z';

/** An angle in (−180, 180] (left as it is when it already is), without float noise. */
const angle = (a: number): number => {
  let r = Math.round(a * 10_000) / 10_000;
  while (r > 180) r -= 360;
  while (r <= -180) r += 360;
  return r || 0;
};

/** Sets or (for 0) leaves out a part's yaw, pitch and roll. */
function setAngles(p: ModelPart, yaw: number, pitch: number, roll: number): void {
  for (const [k, a] of [
    ['yaw', yaw],
    ['pitch', pitch],
    ['roll', roll],
  ] as const) {
    const v = angle(a);
    if (v) p[k] = v;
    else delete p[k];
  }
}

/**
 * The half turn, about one of its own axes, that makes a part flipped along its own `axis`
 * out of itself, or null if it's the same flipped. A box and a slab are (a slab's corners
 * swap instead); a wedge rises along z, so flipped along y it's turned about z, along z
 * about y; a cylinder's first corner is on +x, so one of odd sides flipped along x is turned
 * about y, and a cone flipped along y is turned about x.
 */
function halfTurn(p: ModelPart, axis: Axis): THREE.Vector3 | null {
  if (p.type === 'wedge') {
    if (axis === 'y') return new THREE.Vector3(0, 0, 1);
    if (axis === 'z') return new THREE.Vector3(0, 1, 0);
  } else if (p.type === 'cylinder') {
    if (axis === 'x' && (p.sides ?? 8) % 2 === 1) return new THREE.Vector3(0, 1, 0);
    if (axis === 'y' && p.radiusTop !== undefined && p.radiusTop !== p.radius)
      return new THREE.Vector3(1, 0, 0);
  }
  return null;
}

/**
 * A copy of a part mirrored across the model's x = 0 (left for right, the default), y = 0
 * (top for bottom) or z = 0 (front for back). The mirror turns the part the other way about
 * the two axes in the mirror's plane; a slab's corners swap; a part that isn't the same
 * flipped is turned half round as well, so the copy is a true mirror image.
 */
export function mirrorPart(p: ModelPart, axis: Axis = 'x'): ModelPart {
  const k = 'xyz'.indexOf(axis);
  const out: ModelPart = structuredClone(p);
  const pos: [number, number, number] = [p.pos[0], p.pos[1], p.pos[2]];
  pos[k] = -pos[k]! || 0;
  out.pos = pos;
  // Mirrored, a turn about the axis across the mirror stays; the other two go the other way.
  const yaw = axis === 'y' ? (p.yaw ?? 0) : -(p.yaw ?? 0);
  const pitch = axis === 'x' ? (p.pitch ?? 0) : -(p.pitch ?? 0);
  const roll = axis === 'z' ? (p.roll ?? 0) : -(p.roll ?? 0);
  const turn = halfTurn(p, axis);
  if (turn) {
    // Its own half turn first (yaw, pitch, roll is Y·X·Z), then back into yaw, pitch, roll.
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(pitch * DEG, yaw * DEG, roll * DEG, 'YXZ'))
      .multiply(new THREE.Quaternion().setFromAxisAngle(turn, Math.PI));
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    setAngles(out, e.y / DEG, e.x / DEG, e.z / DEG);
  } else setAngles(out, yaw, pitch, roll);
  if (out.type === 'slab') {
    const [bl, br, fr, fl] = out.corners;
    // Left for right: back left swaps with back right, front right with front left. Front
    // for back: back left with front left, back right with front right.
    if (axis === 'x') out.corners = [br, bl, fl, fr];
    if (axis === 'z') out.corners = [fl, fr, br, bl];
  }
  return out;
}

const DEG = Math.PI / 180;
