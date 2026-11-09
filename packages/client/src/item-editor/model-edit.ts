import {
  ATTACHMENT_SLOTS,
  placeholderModel,
  type AttachmentSlot,
  type ModelPart,
  type Vec3,
  type WeaponModel,
} from '@mes/shared';
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

/** A new part of a type, small and grey, at a point. */
export function newPart(type: ModelPart['type'], at: Vec3): ModelPart {
  const pos: [number, number, number] = [at[0], at[1], at[2]];
  if (type === 'cylinder')
    return { type, pos, pitch: 90, radius: 0.02, height: 0.1, colour: '#3a3f44' };
  if (type === 'slab')
    return {
      type,
      pos,
      size: [0.1, 0.03, 0.08],
      corners: [0.02, 0.02, 0.02, 0.02],
      colour: '#3a3f44',
    };
  return { type, pos, size: [0.05, 0.05, 0.1], colour: '#3a3f44' };
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
export function duplicateParts(parts: ModelPart[], indices: readonly number[], mirror: boolean) {
  const from = [...new Set(indices)].filter((i) => parts[i]).sort((a, b) => a - b);
  const copies = from.map((i) => (mirror ? mirrorPart(parts[i]!) : structuredClone(parts[i]!)));
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

/** A copy of a part mirrored across x = 0 (left for right): its yaw and roll turn the other way. */
export function mirrorPart(p: ModelPart): ModelPart {
  const out: ModelPart = { ...p, pos: [-p.pos[0], p.pos[1], p.pos[2]] };
  if (p.yaw) out.yaw = -p.yaw;
  if (p.roll) out.roll = -p.roll;
  // Left for right: back left swaps with back right, front right with front left.
  if (out.type === 'slab') {
    const [bl, br, fr, fl] = out.corners;
    out.corners = [br, bl, fl, fr];
  }
  return out;
}
