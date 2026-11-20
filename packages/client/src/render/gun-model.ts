import {
  addVec,
  currentSight,
  ATTACHMENT_SLOTS,
  attachmentDef,
  foldParts,
  meleeDef,
  modelShapes,
  SCOPE_LENS,
  weaponDef,
  type AttachmentSlot,
  type ItemDb,
  type ModelShape,
  type Fold,
  type ModelPart,
  type Vec3,
  type WeaponState,
} from '@mes/shared';

export interface GunModel {
  hold: 'rifle' | 'pistol';
  shapes: ModelShape[];
  /** The point the eye lines up with when aimed: the optic's, or the iron sights. */
  sight: Vec3;
  /**
   * Radians the gun rolls aimed (its top to the left) to bring a canted sight up level, about
   * the sight point: 0 but on an offset optic.
   */
  roll: number;
  /** Where shots leave: the end of the barrel or of the muzzle device. */
  muzzle: Vec3;
  suppressed: boolean;
  /** Where each fitted laser's beam leaves (beams run along −z). */
  lasers: Vec3[];
  grip: Vec3;
  support: Vec3;
  /**
   * With a magnifying scope (2026-11-18): the shapes while looking through it (its parts in
   * the line of sight left out), and its eyepiece's clear radius in meters. Null otherwise.
   */
  scope: { shapes: ModelShape[]; lens: number; fill: number | undefined } | null;
  /** A sight without zoom that sets its window's size aimed (optic.fill): lens and fill. */
  window: { lens: number; fill: number } | null;
  /** The back of the gun's own model (its factory stock's butt), in z: where the shoulder is. */
  butt: number;
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
  // A fitted barrel moves where the barrel ends (barrelShift): the gun's own muzzle device
  // (its parts hidden by a muzzle) rides on the end of it.
  const shift = barrelShift(w, items);
  // Its factory stock (AT-1b, its parts hidden by a stock) folds about the stock mount.
  const factoryFold =
    w.folded && !a.stock && m.mounts?.stock ? (m.stockFold ?? m.factoryFold) : undefined;
  const own = {
    parts: factoryFold
      ? foldFactoryStock(m.parts, factoryFold, m.mounts!.stock!).filter(
          (p) => p.hiddenBy !== 'muzzle',
        )
      : m.parts.filter((p) => p.hiddenBy !== 'muzzle'),
  };
  const tip = { parts: m.parts.filter((p) => p.hiddenBy === 'muzzle') };
  const shapes = modelShapes(own, [], [0, 0, 0], fitted);
  modelShapes(tip, shapes, shift, fitted);
  // The sight it's aimed with (its `sight`): an optic, the red dot riding on a scope, irons.
  const { look, point, roll } = currentSight(w, items);
  const magnified = !!look && look.zoom > 1 && !!m.mounts?.optic;
  // Looking through a scope: the same gun, without the scope's parts in the line of sight.
  const scoped = magnified ? modelShapes(own, [], [0, 0, 0], fitted) : null;
  if (scoped) modelShapes(tip, scoped, shift, fitted);
  const sight: Vec3 = point;
  // The muzzle point and the muzzle mount move with the barrel's end too.
  let muzzle: Vec3 = addVec(m.muzzle, shift);
  let grip: Vec3 = m.grip;
  let support: Vec3 = m.support;
  let suppressed = gun.suppressed ?? false;
  const lasers: Vec3[] = [];
  for (const slot of ATTACHMENT_SLOTS) {
    const id = a[slot];
    const at = m.mounts?.[slot];
    if (!id || !at) continue;
    const mount = slot === 'muzzle' ? addVec(at, shift) : at;
    const def = attachmentDef(items, id);
    // A folded stock turns about its hinge, the gun's or its own (WF-1).
    const fold = slot === 'stock' && w.folded ? (m.stockFold ?? def.model.fold) : undefined;
    const parts = fold ? { parts: foldParts(def.model.parts, fold) } : def.model;
    modelShapes(parts, shapes, mount);
    if (scoped) modelShapes(parts, scoped, mount, undefined, slot === 'optic');
    if (slot === 'muzzle') {
      if (def.model.muzzle) muzzle = addVec(mount, def.model.muzzle);
      // Anything that makes a gun quieter hides the flash.
      suppressed = (def.mods?.loudness ?? 0) < 0;
    }
    if (def.model.laser) lasers.push(addVec(mount, def.model.laser));
    // A foregrip takes the support hand, a rear grip the firing hand.
    if (slot === 'foregrip' && def.model.support) support = addVec(mount, def.model.support);
    if (slot === 'grip' && def.model.grip) grip = addVec(mount, def.model.grip);
  }
  return {
    hold: gun.hold ?? 'rifle',
    shapes,
    sight,
    roll: (roll * Math.PI) / 180,
    muzzle,
    suppressed,
    lasers,
    grip,
    support,
    scope: scoped ? { shapes: scoped, lens: look!.lens ?? SCOPE_LENS, fill: look!.fill } : null,
    window:
      !magnified && look?.fill !== undefined && look.lens !== undefined
        ? { lens: look.lens, fill: look.fill }
        : null,
    butt: backOf(m.parts),
  };
}

/**
 * The furthest back (+z) a model's parts reach, from each part's position and extent along
 * z (turns other than a cylinder laid along z are ignored: near enough for a butt).
 */
export function backOf(parts: readonly ModelPart[]): number {
  let back = -Infinity;
  for (const p of parts) {
    let reach: number;
    if (p.type === 'hull') reach = Math.max(...p.points.map((q) => q[2]));
    else if (p.type === 'cylinder') reach = p.pitch ? p.height / 2 : p.radius;
    else if (p.type === 'loft') reach = Math.max(...p.rings.map((r) => r[2] / 2 + (r[4] ?? 0)));
    else if (p.type === 'panel')
      reach = p.points ? Math.max(...p.points.map((q) => q[1])) : p.size![1] / 2;
    else reach = p.size[2] / 2;
    back = Math.max(back, p.pos[2] + reach);
  }
  return back;
}

/**
 * How far a fitted barrel moves the end of the barrel from the gun's own: its muzzle point
 * (where a muzzle device threads on, from the barrel mount) against the gun's muzzle mount.
 * Zero without one.
 */
export function barrelShift(w: WeaponState, items: ItemDb): Vec3 {
  const m = weaponDef(items, w.item).model;
  const id = w.attachments.barrel;
  const at = m.mounts?.barrel;
  const end = id && at ? attachmentDef(items, id).model.muzzle : undefined;
  if (!at || !end) return [0, 0, 0];
  const was = m.mounts?.muzzle ?? m.muzzle;
  return [at[0] + end[0] - was[0], at[1] + end[1] - was[1], at[2] + end[2] - was[2]];
}

/**
 * A knife in the same frame as a gun: the blade along −z. Drawn in first person and in a
 * body's right hand.
 */
export function knifeModel(items: ItemDb, id: string): { shapes: ModelShape[]; grip: Vec3 } {
  const model = meleeDef(items, id).model;
  return { shapes: modelShapes(model), grip: model.grip };
}

/** A key that changes whenever the gun's model would. */
export function gunKey(w: WeaponState): string {
  const parts = ATTACHMENT_SLOTS.map((s) => w.attachments[s]).join(' ');
  // The sight it's aimed with too: switching sights changes the sight point and the scope view.
  return `${w.item} ${parts}${w.folded ? ' folded' : ''} ${w.sight ?? 0}`;
}

/**
 * A gun's parts with its factory stock's (those hidden by a stock) folded: the fold is
 * from the stock mount, as a fitted stock's is from its origin there.
 */
export function foldFactoryStock(
  parts: readonly ModelPart[],
  fold: Fold,
  mount: Vec3,
): ModelPart[] {
  const moved = { ...fold, pivot: addVec(fold.pivot, mount) };
  const stock = foldParts(
    parts.filter((p) => p.hiddenBy === 'stock'),
    moved,
  );
  return [...parts.filter((p) => p.hiddenBy !== 'stock'), ...stock];
}
