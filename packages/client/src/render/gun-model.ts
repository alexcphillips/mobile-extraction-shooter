import {
  addVec,
  attachmentDef,
  meleeDef,
  modelShapes,
  weaponDef,
  type AttachmentSlot,
  type ItemDb,
  type Shape,
  type Vec3,
  type WeaponState,
} from '@mes/shared';

export interface GunModel {
  hold: 'rifle' | 'pistol';
  shapes: Shape[];
  /** The point the eye lines up with when aimed: the optic's, or the iron sights. */
  sight: Vec3;
  /** Where shots leave: the end of the barrel or of the muzzle device. */
  muzzle: Vec3;
  suppressed: boolean;
  grip: Vec3;
  support: Vec3;
}

/**
 * A gun with its attachments, from their item models (session 18b), in the gun's frame
 * (barrel along −z): each attachment on its mount, and the gun's parts hidden by a fitted
 * slot left out.
 */
export function gunModel(w: WeaponState, items: ItemDb): GunModel {
  const gun = weaponDef(items, w.item);
  const m = gun.model;
  const a = w.attachments;
  const fitted = (slot: AttachmentSlot): boolean => !!a[slot];
  const shapes = modelShapes(m, [], [0, 0, 0], fitted);
  let sight: Vec3 = m.sight;
  let muzzle: Vec3 = m.muzzle;
  let suppressed = false;
  for (const slot of ['optic', 'muzzle', 'magazine'] as const) {
    const id = a[slot];
    const mount = m.mounts?.[slot];
    if (!id || !mount) continue;
    const def = attachmentDef(items, id);
    modelShapes(def.model, shapes, mount);
    if (slot === 'optic' && def.model.sight) sight = addVec(mount, def.model.sight);
    if (slot === 'muzzle') {
      if (def.model.muzzle) muzzle = addVec(mount, def.model.muzzle);
      // Anything that makes a gun quieter hides the flash.
      suppressed = (def.mods?.loudness ?? 1) < 1;
    }
  }
  return {
    hold: gun.hold ?? 'rifle',
    shapes,
    sight,
    muzzle,
    suppressed,
    grip: m.grip,
    support: m.support,
  };
}

/**
 * A knife in the same frame as a gun: the blade along −z. Drawn in first person and in a
 * body's right hand.
 */
export function knifeModel(items: ItemDb, id: string): { shapes: Shape[]; grip: Vec3 } {
  const model = meleeDef(items, id).model;
  return { shapes: modelShapes(model), grip: model.grip };
}

/** A key that changes whenever the gun's model would. */
export function gunKey(w: WeaponState): string {
  const { optic, muzzle, magazine } = w.attachments;
  return `${w.item} ${optic} ${muzzle} ${magazine}`;
}
