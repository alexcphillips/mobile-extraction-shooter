import {
  ATTACHMENT_SLOTS,
  HEAD,
  HIT_CAPSULES,
  addVec,
  platingShapes,
  fits,
  foldParts,
  modelShapes,
  partSchema,
  sightsOf,
  type AttachmentDef,
  type BodyDef,
  type Outfit,
  type SkeletonBone,
  type AttachmentSlot,
  type ItemDb,
  type ItemDef,
  type ModelPart,
  type ModelShape,
  type Vec3,
  type WeaponDef,
  type WeaponState,
  type Fold,
  noAttachments,
  fitsIn,
  slotsOfKind,
  fittedLook,
} from '@mes/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Combo, HexColor, Num, Pick, Text, Toggle } from '../editor/fields';
import { loadEnemies } from '../content';
import { tintedHex } from '../render/body-model';
import { shiftForBarrel } from '../render/gun-model';
import { budgetOf, triangleCount } from './budget';
import type { ItemEditor, ItemEditorState } from './editor';
import {
  appendParts,
  duplicateParts,
  groupsOf,
  newPart,
  partLabel,
  removeParts,
  type Axis,
} from './model-edit';
import {
  FLAT_LOOKS,
  ModelView,
  pointColor,
  type FirstPerson,
  type Look,
  type ModelScene,
  type Picked,
  type ViewMode,
} from './model-view';
import { HOUSE_PALETTE, colorsOf } from './palette';
import {
  readReference,
  removeReference,
  writeReference,
  type StoredReference,
} from './reference-store';

/*
 * The item editor's model tab (session 18b): the parts and points down the left, the 3D
 * view on the right. Everything edits the item's own JSON through ItemEditor.edit, so undo,
 * checks and saving work as for stats; a gizmo drag is one undo step.
 */

type Model = { parts: ModelPart[] } & Record<string, unknown>;
const DEG_STEP = [0, 5, 15, 45];
const MOVE_STEP = [0, 0.001, 0.005, 0.01, 0.05];
const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The points an item's model has, by key ("mounts.optic" for a mount). */
function pointKeys(def: ItemDef): string[] {
  switch (def.type) {
    case 'weapon':
      return [
        'grip',
        'support',
        'muzzle',
        'sight',
        ...ATTACHMENT_SLOTS.filter((s) => def.slots?.includes(s)).map((s) => `mounts.${s}`),
      ];
    case 'attachment':
      return (
        {
          optic: ['sight'],
          offsetOptic: ['sight'],
          muzzle: ['muzzle'],
          barrel: ['muzzle'],
          foregrip: ['support'],
          grip: ['grip'],
          rail: ['laser'],
          // A stock kit's support point is from the gun's foregrip mount (AT-7b).
          stock: def.model.foregrip ? ['foregrip.support'] : [],
        }[def.slot as string] ?? []
      );
    case 'melee':
      return ['grip'];
    default:
      return [];
  }
}

const POINT_NOTES: Record<string, string> = {
  grip: 'the right hand',
  support: 'the left hand',
  muzzle: 'where shots leave',
  sight: 'the eye lines up here, aimed',
  laser: 'a laser’s beam leaves here, along −z',
  'foregrip.support': 'the left hand, from the gun’s foregrip mount',
  'mounts.optic': 'an optic’s origin goes here',
  'mounts.muzzle': 'a muzzle device’s origin goes here',
  'mounts.magazine': 'a magazine’s origin goes here',
};

function pointAt(model: Model, key: string): Vec3 | undefined {
  const [a, b] = key.split('.') as [string, string | undefined];
  const v = b ? (model[a] as Record<string, Vec3> | undefined)?.[b] : model[a];
  return Array.isArray(v) ? (v as unknown as Vec3) : undefined;
}

function setPoint(model: Model, key: string, at: Vec3): void {
  const [a, b] = key.split('.') as [string, string | undefined];
  const v: Vec3 = [r4(at[0]), r4(at[1]), r4(at[2])];
  if (b) ((model[a] ??= {}) as Record<string, Vec3>)[b] = v;
  else model[a] = v;
}

/**
 * Parts copied with ⌘C, kept on this device (IE-1) so they paste into any item, after a
 * reload too. Pasted where they were: a part keeps its place in the frame it came from.
 */
interface Clip {
  from: string;
  parts: ModelPart[];
}
const CLIP_KEY = 'mes.itemEditor.parts';

function readClip(): Clip | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null') as Clip | null;
    const parts = partSchema.array().min(1).safeParse(raw?.parts);
    return raw && parts.success ? { from: String(raw.from), parts: parts.data } : null;
  } catch {
    return null;
  }
}

function writeClip(clip: Clip): void {
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(clip));
  } catch {
    // Kept for this page only.
  }
}

/** The picked part indices, as a list. */
const partsOf = (p: Picked): readonly number[] => (p?.kind === 'parts' ? p.indices : []);

/** Parts picked as a Picked: nothing for none. */
const asPicked = (indices: readonly number[]): Picked =>
  indices.length ? { kind: 'parts', indices: [...new Set(indices)] } : null;

export const gunState = (
  item: string,
  attachments: Partial<Record<AttachmentSlot, string>>,
  folded = false,
  sight = 0,
): WeaponState =>
  ({
    item,
    mag: 0,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: { ...noAttachments(), ...attachments },
    ...(folded && attachments.stock && { folded: true }),
    ...(sight > 0 && { sight }),
  }) as WeaponState;

export function ModelTab(props: {
  editor: ItemEditor;
  state: ItemEditorState;
  def: ItemDef;
  /** From the fits page: what to fit and how to look at it. */
  request?: {
    fitted: Partial<Record<AttachmentSlot, string>>;
    mode: ViewMode;
    n: number;
  } | null;
}) {
  const { editor, state: s, def, request } = props;
  const model = def.model as Model;
  const [picked, setPicked] = useState<Picked>(null);
  const [mode, setMode] = useState<ViewMode>('build');
  const [gizmo, setGizmo] = useState<'translate' | 'rotate'>('translate');
  const [step, setStep] = useState(0.005);
  const [angle, setAngle] = useState(15);
  /** Weapons: what's previewed in each slot. */
  const [fitted, setFitted] = useState<Partial<Record<AttachmentSlot, string>>>(() =>
    def.type === 'weapon' ? { ...def.defaults } : {},
  );
  /** WF-1: the stock previewed folded (nothing can be picked while it is). */
  const [folded, setFolded] = useState(false);
  /** Which of the gun's sights it's previewed aimed with (sightsOf): 0 the first. */
  const [sight, setSight] = useState(0);
  /** Attachments: the gun it's previewed on. */
  const [onGun, setOnGun] = useState<string | undefined>(undefined);
  const [clip, setClip] = useState<Clip | null>(readClip);
  /** The body (CH-2): the enemy outfit it's previewed in ('' for its own colors); ?outfit=. */
  const isBody = (def.type as string) === 'body';
  const [outfitKey, setOutfitKey] = useState(
    () => new URLSearchParams(location.search).get('outfit') ?? '',
  );
  /** IE-2: orbit or a flat view, and the eyedropper (the next part clicked gives its color). */
  const [look, setLook] = useState<Look>('orbit');
  const [dropper, setDropper] = useState(false);
  /** What a click in the view does while the eyedropper is on; set every render. */
  const dropRef = useRef<((p: Picked) => boolean) | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const view = useRef<ModelView | null>(null);
  // A new item: nothing picked, building (set while rendering, as React suggests).
  const [shown, setShown] = useState(def.id);
  if (shown !== def.id) {
    setShown(def.id);
    setPicked(null);
    setMode('build');
    setFitted(def.type === 'weapon' ? { ...def.defaults } : {});
    setFolded(false);
  }

  // A fit opened from the fits page (set while rendering, like a new item above).
  const [seenRequest, setSeenRequest] = useState(0);
  if (request && request.n !== seenRequest) {
    setSeenRequest(request.n);
    setFitted(request.fitted);
    setMode(request.mode);
    setPicked(null);
  }

  const editModel = (change: (m: Model) => void, gesture = false): void =>
    editor.edit((d) => change(d.model as Model), gesture);

  // The view lives as long as the tab.
  useEffect(() => {
    const v = new ModelView(canvas.current!, overlay.current!, {
      // Shift-click adds a part, or takes it away if it's picked; a click on nothing with
      // shift keeps what's picked.
      pick: (p, add) => {
        if (dropRef.current?.(p)) return;
        setPicked((cur) => {
          if (!add) return p;
          if (p?.kind !== 'parts') return p ?? cur;
          const had = partsOf(cur);
          const i = p.indices[0]!;
          return asPicked(had.includes(i) ? had.filter((j) => j !== i) : [...had, i]);
        });
      },
      boxPick: (indices, add) =>
        setPicked((cur) => asPicked(add ? [...partsOf(cur), ...indices] : indices)),
      movedParts: (moves) =>
        editModel((m) => {
          for (const { index, pos, angles } of moves) {
            const part = m.parts[index];
            if (!part) continue;
            part.pos = [r4(pos[0]), r4(pos[1]), r4(pos[2])];
            const [yaw, pitch, roll] = angles.map(r1) as [number, number, number];
            for (const [k, a] of [
              ['yaw', yaw],
              ['pitch', pitch],
              ['roll', roll],
            ] as const) {
              if (a) part[k] = a;
              else delete part[k];
            }
          }
        }, true),
      movedPoint: (key, pos) => editModel((m) => setPoint(m, key, pos), true),
      dragStart: () => editor.beginGesture(),
      dragEnd: () => editor.endGesture(),
    });
    view.current = v;
    // For poking at it from the console.
    (window as { modelView?: ModelView }).modelView = v;
    return () => v.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const db = s.db;
  const items = db ?? s.items;
  const guns = [...items.values()].filter(
    (g): g is WeaponDef => g.type === 'weapon' && def.type === 'attachment' && fits(items, g, def),
  );
  const gun = def.type === 'attachment' ? (guns.find((g) => g.id === onGun) ?? guns[0]) : undefined;
  const fittedOk = (slot: AttachmentSlot): string | undefined => {
    const id = fitted[slot];
    const a = id ? items.get(id) : undefined;
    // A rail item's kind is `rail`, for either rail slot: fitsIn checks the slot.
    return def.type === 'weapon' && a?.type === 'attachment' && fitsIn(items, def, a, slot)
      ? id
      : undefined;
  };

  // WF-1: how the previewed stock folds, if it does: the gun's mount, else the stock's own,
  // or with none fitted the gun's factory stock's (AT-1b).
  const stockId =
    def.type === 'weapon'
      ? fittedOk('stock')
      : def.type === 'attachment' && def.slot === 'stock'
        ? def.id
        : undefined;
  const stockDef = stockId ? items.get(stockId) : undefined;
  const mountFold = def.type === 'weapon' ? def.model.stockFold : gun?.model.stockFold;
  const factory = def.type === 'weapon' && !stockId && !!def.stock;
  const fold =
    (factory ? (def.model.stockFold ?? def.model.factoryFold) : undefined) ??
    (stockId ? mountFold : undefined) ??
    (stockDef?.type === 'attachment' ? stockDef.model.fold : undefined) ??
    null;
  const foldedView = folded && !!fold;

  // What the view draws, and first person, from the item as edited.
  const built = buildScene(def, model, items, fittedOk, gun, foldedView ? fold : null);
  // The body (CH-2): previewed in an enemy's outfit, tinted, with its plating (not pickable).
  const preview = isBody ? BODY_OUTFITS().find((o) => o.key === outfitKey) : undefined;
  const scene: ModelScene = preview
    ? {
        ...built,
        parts: model.parts.map((p) => ({
          ...p,
          color: tintedHex(
            def as unknown as BodyDef,
            preview.outfit,
            p.group as SkeletonBone,
            p.color,
          ),
        })),
        context: platingShapes(preview.outfit.plating).flatMap((g) => g.shapes),
      }
    : built;
  const fp: FirstPerson | null = !db
    ? null
    : def.type === 'weapon'
      ? {
          kind: 'gun',
          gun: gunState(
            def.id,
            Object.fromEntries(ATTACHMENT_SLOTS.map((k) => [k, fittedOk(k)])),
            foldedView,
            sight,
          ),
          db,
          optic: null,
        }
      : def.type === 'attachment' && gun
        ? {
            kind: 'gun',
            gun: gunState(gun.id, { [def.slot]: def.id }, foldedView, sight),
            db,
            optic: null,
          }
        : def.type === 'melee'
          ? { kind: 'knife', id: def.id, db }
          : null;
  // Aimed, it looks through the sight the preview gun is set to (sightsOf), as the game does.
  const sights = fp?.kind === 'gun' && db ? sightsOf(fp.gun, db) : [];
  if (fp?.kind === 'gun') fp.optic = (sights[sight] ?? sights[0])?.look ?? null;
  const sceneKey = JSON.stringify(scene);
  useEffect(() => {
    view.current?.show(scene, picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, picked]);
  const fpKey = fp
    ? JSON.stringify([
        fp.kind === 'gun' ? fp.gun : fp.id,
        db?.get(def.id),
        fp.kind === 'gun' && fp.gun.attachments,
        mode,
      ])
    : mode;
  useEffect(() => {
    view.current?.setMode(fp ? mode : 'build', fp);
    // db changes with every edit; the key says when the gun drawn would.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fpKey, db]);
  useEffect(() => view.current?.setGizmo(gizmo, step, angle), [gizmo, step, angle]);
  useEffect(() => view.current?.setLook(look), [look]);
  // A new item: look at it.
  useEffect(() => {
    requestAnimationFrame(() => view.current?.frame());
  }, [def.id]);

  const sel = partsOf(picked).filter((i) => model.parts[i]);
  const addPart = (type: ModelPart['type']): void => {
    const at = sel.length === 1 ? model.parts[sel[0]!]?.pos : undefined;
    const group = sel.length ? model.parts[sel[0]!]?.group : undefined;
    const part = newPart(type, at ?? [0, 0, 0]);
    if (group) part.group = group;
    editModel((m) => m.parts.push(part));
    setPicked(asPicked([model.parts.length]));
  };
  /** Copies of the picked parts, mirrored (across x, or the axis given) or not, then picked. */
  const duplicate = (mirror: boolean | Axis): void => {
    if (!sel.length) return;
    let added: number[] = [];
    editModel((m) => (added = duplicateParts(m.parts, sel, mirror)));
    setPicked(asPicked(added));
  };
  const canRemove = sel.length > 0 && sel.length < model.parts.length;
  const remove = (): void => {
    if (!canRemove) return;
    editModel((m) => removeParts(m.parts, sel));
    setPicked(null);
  };
  const copy = (): void => {
    if (!sel.length) return;
    const c = { from: def.id, parts: sel.map((i) => structuredClone(model.parts[i]!)) };
    writeClip(c);
    setClip(c);
  };
  const paste = (): void => {
    if (!clip) return;
    let added: number[] = [];
    editModel((m) => (added = appendParts(m.parts, clip.parts)));
    setPicked(asPicked(added));
  };
  /** Changes every picked part. */
  const editPicked = (change: (p: ModelPart) => void): void =>
    editModel((m) => sel.forEach((i) => m.parts[i] && change(m.parts[i])));

  // The eyedropper: a part clicked in the view gives its color to the picked parts.
  useEffect(() => {
    dropRef.current = dropper
      ? (p) => {
          const from = p?.kind === 'parts' ? model.parts[p.indices[0]!] : undefined;
          if (from) editPicked((q) => (q.color = from.color));
          setDropper(false);
          return true;
        }
      : null;
  });
  if (dropper && !sel.length) setDropper(false);

  /**
   * Moves the picked parts or point by `n` snap steps (a millimeter with snap off) along an
   * axis. Holding the key down is one undo step.
   */
  const nudge = (axis: Vec3, n: number, first: boolean): void => {
    const d = (step || 0.001) * n;
    const by = (v: Vec3): [number, number, number] => [
      r4(v[0] + axis[0] * d),
      r4(v[1] + axis[1] * d),
      r4(v[2] + axis[2] * d),
    ];
    if (first) editor.beginGesture();
    if (picked?.kind === 'point') {
      const at = pointAt(model, picked.key);
      if (at) editModel((m) => setPoint(m, picked.key, by(at)), true);
    } else if (sel.length)
      editModel(
        (m) => sel.forEach((i) => m.parts[i] && (m.parts[i].pos = by(m.parts[i].pos))),
        true,
      );
  };

  // Keys, while not typing: W move, E turn, ⌫ delete, ⌘D duplicate, M mirror, F frame,
  // ⌘C copy, ⌘V paste, ⌘A pick every part, Esc pick nothing (or stop the eyedropper);
  // IE-2: 1 side, 2 top, 3 front, 0 orbit; arrows nudge (⇧↑↓ towards and away from you);
  // I eyedropper.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      )
        return;
      const k = e.key.toLowerCase();
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd) {
        if (k === 'd' && sel.length) duplicate(false);
        else if (k === 'c' && sel.length) copy();
        else if (k === 'v' && clip) paste();
        else if (k === 'a') setPicked(asPicked(model.parts.map((_, i) => i)));
        else return;
        e.preventDefault();
        return;
      }
      const arrow = { arrowleft: -1, arrowright: 1, arrowup: 1, arrowdown: -1 }[k];
      if (arrow !== undefined && mode === 'build' && (sel.length || picked?.kind === 'point')) {
        const axes = view.current?.screenAxes();
        if (!axes) return;
        const along =
          k === 'arrowleft' || k === 'arrowright' ? axes.right : e.shiftKey ? axes.out : axes.up;
        nudge(along, arrow, !e.repeat);
        e.preventDefault();
        return;
      }
      if (k === 'w') setGizmo('translate');
      else if (k === 'e') setGizmo('rotate');
      else if (k === 'f') view.current?.frame();
      else if (k === 'backspace' || k === 'delete') remove();
      else if (k === 'm') duplicate(true);
      else if (k === 'i') setDropper((d) => !d && sel.length > 0);
      else if (k === '0') setLook('orbit');
      else if (k === '1' || k === '2' || k === '3') setLook(FLAT_LOOKS[Number(k) - 1]!);
      else if (k === 'escape') {
        if (dropper) setDropper(false);
        else setPicked(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const part = sel.length === 1 ? model.parts[sel[0]!] : undefined;
  const keys = pointKeys(def);
  const groups = groupsOf(model.parts);
  return (
    <main className="ie-main">
      <section className="ed-inspector ie-form">
        <h3>{def.name}</h3>
        <p className="ed-note">{FRAME_NOTES[def.type] ?? FRAME_NOTES.other}</p>
        {isBody && (
          <label className="ed-row" title="See the body in an enemy outfit: its colors and plating">
            outfit{' '}
            <select value={outfitKey} onChange={(e) => setOutfitKey(e.target.value)}>
              <option value="">its own colors</option>
              {BODY_OUTFITS().map((o) => (
                <option key={o.key} value={o.key}>
                  {o.key}
                </option>
              ))}
            </select>
          </label>
        )}
        <Cost def={def} scene={scene} sceneKey={sceneKey} />
        <h4>parts</h4>
        <PartList
          parts={model.parts}
          picked={sel}
          choose={(indices, how) =>
            setPicked((cur) => {
              const had = partsOf(cur);
              if (how === 'set') return asPicked(indices);
              if (how === 'add') return asPicked([...had, ...indices]);
              return asPicked(
                had.includes(indices[0]!)
                  ? had.filter((j) => !indices.includes(j))
                  : [...had, ...indices],
              );
            })
          }
        />
        <div className="ed-row ie-tools">
          <button onClick={() => addPart('box')}>+ box</button>
          <button onClick={() => addPart('cylinder')}>+ cylinder</button>
          <button onClick={() => addPart('wedge')}>+ wedge</button>
          <button onClick={() => addPart('panel')} title="A flat face with no thickness, facing up">
            + panel
          </button>
          <button
            onClick={() => addPart('slab')}
            title="A box with rounded corners, seen from above"
          >
            + slab
          </button>
        </div>
        <div className="ed-row ie-tools">
          <button onClick={copy} disabled={!sel.length} title="⌘C: copy the picked parts">
            Copy
          </button>
          <button
            onClick={paste}
            disabled={!clip}
            title={
              clip
                ? `⌘V: ${clip.parts.length} part${clip.parts.length > 1 ? 's' : ''} from ${clip.from}, where they were there`
                : 'Copy parts first (⌘C), from this item or another'
            }
          >
            Paste{clip ? ` ${clip.parts.length}` : ''}
          </button>
          {clip && <span className="ed-note">from {clip.from}</span>}
        </div>
        {sel.length > 0 && (
          <PickedFields
            parts={model.parts}
            picked={sel}
            groups={groups}
            gun={def.type === 'weapon' ? def : null}
            scope={def.type === 'attachment' && (def.optic?.zoom ?? 1) > 1}
            edit={editPicked}
            single={
              part && ((change) => editModel((m) => m.parts[sel[0]!] && change(m.parts[sel[0]!]!)))
            }
            duplicate={duplicate}
            remove={canRemove ? remove : null}
            itemColors={colorsOf(model.parts)}
            pickColor={(c) =>
              setPicked(
                asPicked(model.parts.flatMap((p, i) => (p.color.toLowerCase() === c ? [i] : []))),
              )
            }
            dropper={dropper}
            setDropper={setDropper}
          />
        )}
        {keys.length > 0 && <h4>points</h4>}
        {keys.map((k) => {
          const at = pointAt(model, k);
          const on = picked?.kind === 'point' && picked.key === k;
          return (
            <div key={k} className={on ? 'ie-point ed-on' : 'ie-point'}>
              <button
                className="ie-point-name"
                onClick={() => setPicked({ kind: 'point', key: k })}
              >
                <span className="ie-swatch" style={{ background: pointColor(k) }} />
                {k.replace('mounts.', 'mount: ')}
              </button>
              <span className="ed-note">{POINT_NOTES[k]}</span>
              {at && (
                <div className="ed-row">
                  {(['x', 'y', 'z'] as const).map((axis, j) => (
                    <Num
                      key={axis}
                      label={axis}
                      value={at[j]}
                      onChange={(v) =>
                        v !== undefined &&
                        editModel((m) => {
                          const next: [number, number, number] = [at[0], at[1], at[2]];
                          next[j] = v;
                          setPoint(m, k, next);
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {s.problems.get(def.id) && <p className="ed-problem">{s.problems.get(def.id)}</p>}
      </section>
      <section className="ie-view">
        <div className="ed-row ie-tools ie-viewbar">
          {(def.type === 'weapon' || def.type === 'attachment'
            ? (['build', 'hip', 'aimed'] as const)
            : def.type === 'melee'
              ? (['build', 'hip'] as const)
              : (['build'] as const)
          ).map((m) => (
            <Toggle
              key={m}
              on={mode === m}
              onClick={() => setMode(m)}
              title={m === 'build' ? 'Edit the model' : `First person, ${m}, as the game draws it`}
            >
              {m}
            </Toggle>
          ))}
          {mode === 'aimed' && sights.length > 1 && (
            <Toggle
              on={sight > 0}
              onClick={() => setSight((sight + 1) % sights.length)}
              title="Step to the gun's next sight (a scope's red dot on top), as the sight button does"
            >
              {`sight ${Math.min(sight, sights.length - 1) + 1}/${sights.length}`}
            </Toggle>
          )}
          {mode === 'build' &&
            (['orbit', ...FLAT_LOOKS] as const).map((l, i) => (
              <Toggle
                key={l}
                on={look === l}
                onClick={() => setLook(l)}
                title={
                  l === 'orbit'
                    ? '0: the orbit camera'
                    : `${i}: flat from the ${l}${l === 'side' ? ' (the barrel to the left), with a picture to trace' : l === 'top' ? ' (the barrel to the left)' : ' (looking down the barrel)'}`
                }
              >
                {l === 'orbit' ? '3D' : l}
              </Toggle>
            ))}
          {mode === 'build' && (
            <>
              <Toggle on={gizmo === 'translate'} onClick={() => setGizmo('translate')} title="W">
                move
              </Toggle>
              <Toggle on={gizmo === 'rotate'} onClick={() => setGizmo('rotate')} title="E">
                turn
              </Toggle>
              <Pick
                label="snap"
                value={String(step)}
                options={MOVE_STEP.map(String)}
                onChange={(v) => setStep(Number(v ?? 0))}
              />
              <Pick
                label="turn snap"
                value={String(angle)}
                options={DEG_STEP.map(String)}
                onChange={(v) => setAngle(Number(v ?? 0))}
              />
              <button onClick={() => view.current?.frame()} title="F">
                frame
              </button>
            </>
          )}
          {def.type === 'weapon' &&
            ATTACHMENT_SLOTS.filter((slot) => def.slots?.includes(slot)).map((slot) => (
              <Pick
                key={slot}
                label={slot}
                value={fittedOk(slot)}
                options={[...items.values()]
                  .filter((a) => a.type === 'attachment' && fitsIn(items, def, a, slot))
                  .map((a) => a.id)}
                unset="none"
                onChange={(v) => setFitted((f) => ({ ...f, [slot]: v }))}
              />
            ))}
          {def.type === 'attachment' && (
            <Pick
              label="on"
              value={gun?.id}
              options={guns.map((g) => g.id)}
              onChange={(v) => setOnGun(v)}
            />
          )}
          {fold && (
            <Toggle
              on={foldedView}
              onClick={() => {
                setFolded(!folded);
                setPicked(null);
              }}
              title="Shows the stock folded, as it is in the game; parts can't be picked meanwhile"
            >
              folded
            </Toggle>
          )}
        </div>
        <div className="ie-canvas">
          <canvas ref={canvas} />
          <svg ref={overlay} className="ie-overlay" preserveAspectRatio="xMidYMid meet" />
          {mode !== 'build' && !fp && (
            <p className="ie-fp-note">
              {db
                ? 'Only guns, attachments on a gun and knives are seen in first person.'
                : 'First person shows once every item passes its checks.'}
            </p>
          )}
        </div>
        {dropper && (
          <p className="ie-dropper-note">Eyedropper: click a part to give its color (Esc stops).</p>
        )}
        {mode === 'build' && look === 'side' && (
          <ReferenceFields key={def.id} item={def.id} view={view} />
        )}
        <p className="ed-note">
          Click a part or point to pick it, shift-click to add one, drag a box to pick many; drag
          the gizmo. Right-drag or ⌥-drag orbits (pans in a flat view), middle-drag pans, scroll
          zooms. 0 3D, 1 side, 2 top, 3 front. W move, E turn, F frame, arrows nudge by the snap
          (⇧↑↓ in and out), M mirror a copy, I eyedropper, ⌘D duplicate, ⌘C/⌘V copy and paste (into
          any item), ⌘A all, ⌫ delete, Esc none.
        </p>
      </section>
    </main>
  );
}

/** Every enemy outfit, keyed '<enemy>-<n>', for the body's preview. */
let bodyOutfits: { key: string; outfit: Outfit }[] | undefined;
function BODY_OUTFITS(): { key: string; outfit: Outfit }[] {
  bodyOutfits ??= [...loadEnemies().types.values()].flatMap((e) =>
    (e.outfits ?? []).map((outfit, i) => ({ key: `${e.id}-${i + 1}`, outfit })),
  );
  return bodyOutfits;
}

/** The sim's head capsule in the model's frame (the sim's forward is +; the model's is −z). */
const HEAD_CAPSULE = HIT_CAPSULES.find((c) => c.zone === HEAD)!;
const HEAD_WIRE = [
  {
    a: [HEAD_CAPSULE.a[0], HEAD_CAPSULE.a[1], -HEAD_CAPSULE.a[2]] as Vec3,
    b: [HEAD_CAPSULE.b[0], HEAD_CAPSULE.b[1], -HEAD_CAPSULE.b[2]] as Vec3,
    radius: HEAD_CAPSULE.radius,
  },
];

const FRAME_NOTES: Record<string, string> = {
  weapon: 'Meters; the barrel along −z, y up. The origin sits on the body’s weapon bone.',
  attachment: 'Meters; its origin goes on the gun’s mount for its slot.',
  melee: 'Meters; the blade along −z, held at the grip.',
  body: 'Meters; the rest pose (a T-pose), feet at y = 0, facing −z. Each part’s group is the bone it moves with (hips, spine, chest, neck, head, upperArmL…footR); the head stays inside the sim’s head volume, drawn as a wire.',
  armor: 'Meters, on the body as it stands (feet at 0, facing −z).',
  container: 'Meters, on the body as it stands (feet at 0, facing −z).',
  other: 'Meters. On the ground it rests on its lowest point.',
};

function opticOf(db: ItemDb, id: string | undefined) {
  const a = id ? db.get(id) : undefined;
  return a?.type === 'attachment' ? (a.optic ?? null) : null;
}

/** Shapes, skipping any that a half-typed field has broken. */
/** A model's parts folded, or as they are if the fold is half typed in. */
function safeFold(parts: readonly ModelPart[], fold: Fold): readonly ModelPart[] {
  try {
    return foldParts(parts, fold);
  } catch {
    return parts;
  }
}

function safeShapes(
  parts: readonly ModelPart[],
  at?: Vec3,
  fitted?: (s: AttachmentSlot) => boolean,
): ModelShape[] {
  try {
    return modelShapes({ parts }, [], at, fitted).filter((s) =>
      Object.values(s).every((v) => typeof v !== 'number' || Number.isFinite(v)),
    );
  } catch {
    return [];
  }
}

function buildScene(
  def: ItemDef,
  model: Model,
  items: ReadonlyMap<string, ItemDef>,
  fitted: (slot: AttachmentSlot) => string | undefined,
  gun: WeaponDef | undefined,
  fold: Fold | null,
): ModelScene {
  const points = pointKeys(def).flatMap((key) => {
    const at = pointAt(model, key);
    return at ? [{ key, at }] : [];
  });
  const scene: ModelScene = {
    parts: model.parts,
    fitted: new Set(),
    points,
    context: [],
    body: def.type === 'armor' || def.type === 'container',
    sightLine: null,
    // The body (CH-2): the sim's head volume, which the head stays inside.
    ...((def.type as string) === 'body' && { wires: HEAD_WIRE }),
  };
  if (def.type === 'weapon') {
    const fittedSlots = new Set(ATTACHMENT_SLOTS.filter((s) => fitted(s)));
    scene.fitted = fittedSlots;
    const context: ModelShape[] = [];
    let sight = pointAt(model, 'sight') ?? null;
    // A fitted barrel moves where the barrel ends, as in the game (gunModel): a muzzle
    // device, or the gun's own (hidden in place), rides on the end of it.
    const barrel = fitted('barrel');
    const shift = shiftForBarrel(
      pointAt(model, 'mounts.barrel'),
      pointAt(model, 'mounts.muzzle') ?? pointAt(model, 'muzzle') ?? [0, 0, 0],
      barrel ? (items.get(barrel) as AttachmentDef | undefined)?.model.muzzle : undefined,
    );
    let kitForegrip = false;
    for (const slot of fittedSlots) {
      const a = items.get(fitted(slot)!) as AttachmentDef;
      const at = pointAt(model, `mounts.${slot}`);
      if (!at) continue;
      const mount = slot === 'muzzle' ? addVec(at, shift) : at;
      // A rear grip on a gun whose grip wraps the magazine well draws its look for it.
      const look = fittedLook(model as { magwellGrip?: true | undefined }, slot, a.model);
      const parts = slot === 'stock' && fold ? safeFold(look.parts, fold) : look.parts;
      context.push(...safeShapes(parts, mount));
      // A stock kit's own foregrip, on this gun's foregrip mount (AT-7b).
      const under = pointAt(model, 'mounts.foregrip');
      if (slot === 'stock' && a.model.foregrip && under) {
        context.push(...safeShapes(a.model.foregrip.parts, under));
        kitForegrip = true;
      }
      if (slot === 'optic' && a.model.sight) sight = addVec(mount, a.model.sight);
    }
    // Its factory stock folded (AT-1b): hidden in place, drawn folded as context.
    const stockMount = pointAt(model, 'mounts.stock');
    if (kitForegrip) fittedSlots.add('foregrip');
    if (fold && !fittedSlots.has('stock') && stockMount) {
      fittedSlots.add('stock');
      const own = model.parts.filter((p) => p.hiddenBy === 'stock');
      context.push(
        ...safeShapes(safeFold(own, { ...fold, pivot: addVec(fold.pivot, stockMount) })),
      );
    }
    if (shift.some((v) => v !== 0) && !fittedSlots.has('muzzle')) {
      fittedSlots.add('muzzle');
      const tip = model.parts.filter((p) => p.hiddenBy === 'muzzle');
      context.push(...safeShapes(tip, shift));
    }
    scene.context = context;
    scene.sightLine = sight;
  } else if (def.type === 'attachment') {
    // Previewed in the first slot of its kind the gun has (a rail item on its right rail
    // if it has one, else its left).
    const slot = gun
      ? [...slotsOfKind(def.slot)].reverse().find((s) => gun.slots?.includes(s))
      : undefined;
    const mount = slot ? gun?.model.mounts?.[slot] : undefined;
    if (gun && mount) {
      // The gun around it, moved so this attachment's origin stays at the origin.
      const back: Vec3 = [-mount[0], -mount[1], -mount[2]];
      const hides = (s: AttachmentSlot) => s === slot;
      // A barrel carries the gun's own muzzle device on its end, as in the game.
      const shift = shiftForBarrel(
        gun.model.mounts?.barrel,
        gun.model.mounts?.muzzle ?? gun.model.muzzle,
        def.slot === 'barrel' ? pointAt(model, 'muzzle') : undefined,
      );
      const own = gun.model.parts.filter((p) => p.hiddenBy !== 'muzzle');
      const tip = gun.model.parts.filter((p) => p.hiddenBy === 'muzzle');
      // A stock kit's own foregrip sits on the gun's foregrip mount, hiding what's there.
      const kit = slot === 'stock' ? (model.foregrip as Model | undefined) : undefined;
      const under = gun.model.mounts?.foregrip;
      const kitHides = (s: AttachmentSlot) => hides(s) || (!!kit && s === 'foregrip');
      scene.context = [
        ...safeShapes(own, back, kitHides),
        ...safeShapes(tip, addVec(back, shift), kitHides),
        ...(kit && under && Array.isArray(kit.parts)
          ? safeShapes(kit.parts, addVec(back, under))
          : []),
      ];
    }
    if (fold) {
      // Folded: drawn as context, so nothing is picked or moved where it doesn't live.
      scene.context = [...scene.context, ...safeShapes(safeFold(model.parts, fold))];
      scene.parts = [];
      scene.points = [];
    }
    if (def.slot === 'optic' || def.slot === 'offsetOptic')
      scene.sightLine = pointAt(model, 'sight') ?? null;
  }
  return scene;
}

/** A slab's corners, in its corners' order. */
const SLAB_CORNER_NAMES = ['back left', 'back right', 'front right', 'front left'] as const;

/**
 * The parts list (IE-1): folded by group, in the order groups first come, then the parts in
 * no group. A click picks, shift-click adds or takes away; a group's name picks all of it.
 */
function PartList(props: {
  parts: readonly ModelPart[];
  picked: readonly number[];
  choose: (indices: number[], how: 'set' | 'add' | 'toggle') => void;
}) {
  const { parts, picked } = props;
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const groups = groupsOf(parts);
  const row = (p: ModelPart, i: number) => (
    <li
      key={i}
      className={picked.includes(i) ? 'ed-on' : undefined}
      onClick={(e) => props.choose([i], e.shiftKey || e.metaKey ? 'toggle' : 'set')}
    >
      <span className="ie-swatch" style={{ background: p.color }} />
      {partLabel(p, i)}
      {p.name && <span className="ed-note"> · {p.type}</span>}
      {p.hiddenBy && <span className="ed-note"> · hidden by {p.hiddenBy}</span>}
      {p.scopedHidden && <span className="ed-note"> · hidden looking through</span>}
    </li>
  );
  const loose = parts.flatMap((p, i) => (p.group ? [] : [row(p, i)]));
  return (
    <ul className="ed-list ie-parts">
      {groups.map((g) => {
        const of = parts.flatMap((p, i) => (p.group === g ? [i] : []));
        const all = of.every((i) => picked.includes(i));
        const shut = folded.has(g);
        return (
          <li key={`group ${g}`} className="ie-group">
            <div className={all ? 'ie-group-name ed-on' : 'ie-group-name'}>
              <button
                className="ie-fold"
                onClick={() =>
                  setFolded((f) => {
                    const n = new Set(f);
                    if (!n.delete(g)) n.add(g);
                    return n;
                  })
                }
                title={shut ? 'Show its parts' : 'Hide its parts'}
              >
                {shut ? '▸' : '▾'}
              </button>
              <span onClick={(e) => props.choose(of, e.shiftKey || e.metaKey ? 'add' : 'set')}>
                {g} <span className="ed-note">({of.length})</span>
              </span>
            </div>
            {!shut && <ul className="ie-sub">{of.map((i) => row(parts[i]!, i))}</ul>}
          </li>
        );
      })}
      {groups.length > 0 && loose.length > 0 && <li className="ie-group-name ed-note">no group</li>}
      {loose}
    </ul>
  );
}

/** Triangles drawn for the item as shown (a gun with what's fitted), against its budget. */
function Cost(props: { def: ItemDef; scene: ModelScene; sceneKey: string }) {
  const { def, scene } = props;
  const [own, fitted] = useMemo(() => {
    const parts = safeShapes(scene.parts, undefined, (s) => scene.fitted.has(s));
    // An attachment's context is the gun it's shown on, not part of it.
    return [triangleCount(parts), def.type === 'weapon' ? triangleCount(scene.context) : 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sceneKey, def.type]);
  const budget = budgetOf(def);
  const total = own + fitted;
  const over = total > budget.triangles;
  return (
    <p className={over ? 'ie-cost ie-over' : 'ie-cost'}>
      {scene.parts.length} parts · {total} triangles
      {fitted > 0 && ` (${own} + ${fitted} fitted)`} of {budget.triangles} for a {budget.kind}
      {over && ' — over budget'}
    </p>
  );
}

/**
 * What the picked parts share (group, color, what hides them) and what to do with them;
 * with one picked, its name, shape, place and turn as well.
 */
function PickedFields(props: {
  parts: readonly ModelPart[];
  picked: readonly number[];
  groups: readonly string[];
  gun: WeaponDef | null;
  /** A magnifying optic: its parts can be hidden while looking through it (scopedHidden). */
  scope: boolean;
  edit: (change: (p: ModelPart) => void) => void;
  /** Edits the one picked part, when only one is. */
  single: ((change: (p: ModelPart) => void) => void) | undefined;
  duplicate: (mirror: boolean | Axis) => void;
  remove: (() => void) | null;
  /** The colors the item uses, most used first. */
  itemColors: readonly string[];
  /** Picks every part of a color. */
  pickColor: (c: string) => void;
  dropper: boolean;
  setDropper: (on: boolean) => void;
}) {
  const { parts, picked, edit } = props;
  const chosen = picked.map((i) => parts[i]!);
  const first = chosen[0]!;
  /** A value every picked part has, else undefined. */
  const shared = <T,>(get: (p: ModelPart) => T): T | undefined => {
    const v = get(first);
    return chosen.every((p) => get(p) === v) ? v : undefined;
  };
  const group = shared((p) => p.group);
  const mixedGroup = group === undefined && chosen.some((p) => p.group);
  return (
    <div className="ie-part">
      {props.single ? (
        <Text
          label="name"
          value={first.name ?? ''}
          onChange={(v) =>
            props.single!((q) => {
              if (v) q.name = v.slice(0, 40);
              else delete q.name;
            })
          }
        />
      ) : (
        <p className="ed-note">{picked.length} parts picked</p>
      )}
      <div className="ed-row">
        <Combo
          label="group"
          value={group}
          options={props.groups}
          newLabel="+ New group"
          unset={mixedGroup ? 'mixed' : 'no group'}
          onChange={(v) =>
            edit((q) => {
              if (v) q.group = v.slice(0, 40);
              else delete q.group;
            })
          }
        />
        {group && (
          <button onClick={() => edit((q) => delete q.group)} title="Take them out of the group">
            Ungroup
          </button>
        )}
      </div>
      {props.single && <PartFields part={first} edit={props.single} />}
      <div className="ed-row">
        <HexColor
          label={shared((p) => p.color) ? 'color' : 'color (mixed)'}
          value={first.color}
          onChange={(c) => edit((q) => (q.color = c))}
        />
        <Toggle
          on={props.dropper}
          onClick={() => props.setDropper(!props.dropper)}
          title="I: then click a part in the view to give its color to the picked parts"
        >
          eyedropper
        </Toggle>
        {props.gun && (
          <Pick
            label="hidden by"
            value={shared((p) => p.hiddenBy)}
            options={ATTACHMENT_SLOTS.filter((s) => props.gun!.slots?.includes(s))}
            unset={shared((p) => p.hiddenBy ?? '') === undefined ? 'mixed' : 'never hidden'}
            onChange={(v) =>
              edit((q) => {
                if (v) q.hiddenBy = v as AttachmentSlot;
                else delete q.hiddenBy;
              })
            }
          />
        )}
        {props.scope && (
          <Toggle
            on={chosen.every((p) => p.scopedHidden)}
            onClick={() => {
              const hide = !chosen.every((p) => p.scopedHidden);
              edit((q) => {
                if (hide) q.scopedHidden = true;
                else delete q.scopedHidden;
              });
            }}
            title="Not drawn while looking through the scope: parts in the line of sight (tube, bells, caps). The eyepiece rim stays."
          >
            hidden looking through
          </Toggle>
        )}
      </div>
      <Swatches
        label="this item"
        colors={props.itemColors.map((color) => ({ color, name: color }))}
        current={shared((p) => p.color.toLowerCase())}
        set={(c) => edit((q) => (q.color = c))}
        pickAll={props.pickColor}
      />
      <Swatches
        label="house"
        colors={HOUSE_PALETTE}
        current={shared((p) => p.color.toLowerCase())}
        set={(c) => edit((q) => (q.color = c))}
      />
      <div className="ed-row">
        <button onClick={() => props.duplicate(false)} title="⌘D">
          Duplicate
        </button>
        <button onClick={() => props.duplicate('x')} title="M: copies on the other side (x = 0)">
          Mirror x
        </button>
        <button onClick={() => props.duplicate('y')} title="Copies upside down, across y = 0">
          Mirror y
        </button>
        <button onClick={() => props.duplicate('z')} title="Copies front to back, across z = 0">
          Mirror z
        </button>
        <button
          onClick={() => props.remove?.()}
          disabled={!props.remove}
          title={props.remove ? '⌫' : 'A model keeps at least one part'}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/**
 * Rows of numbers as text, one row a line (a loft's rings, a hull's points, CH-3a). Kept
 * as typed while a line doesn't parse; saved once every line has a right number of numbers.
 */
function NumberRows(props: {
  rows: readonly (readonly number[])[];
  width: [number, number];
  onChange: (rows: number[][]) => void;
}) {
  const shown = props.rows.map((r) => r.join(', ')).join('\n');
  const [text, setText] = useState(shown);
  // When the part changes from outside (undo, another part picked), show its rows.
  const [was, setWas] = useState(shown);
  if (shown !== was) {
    setWas(shown);
    setText(shown);
  }
  return (
    <textarea
      className="ie-rows"
      rows={Math.min(12, props.rows.length + 1)}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const rows = e.target.value
          .split('\n')
          .filter((l) => l.trim())
          .map((l) =>
            l
              .split(/[\s,]+/)
              .filter(Boolean)
              .map(Number),
          );
        const [a, b] = props.width;
        if (rows.every((r) => (r.length === a || r.length === b) && r.every(Number.isFinite)))
          props.onChange(rows);
      }}
    />
  );
}

/** One part's shape, place and turn. */
function PartFields(props: { part: ModelPart; edit: (change: (p: ModelPart) => void) => void }) {
  const { part: p, edit } = props;
  const num = (
    label: string,
    get: number | undefined,
    set: (p: ModelPart, v: number) => void,
    min?: number,
  ) => (
    <Num
      key={label}
      label={label}
      value={get}
      {...(min !== undefined && { min })}
      onChange={(v) => v !== undefined && edit((q) => set(q, v))}
    />
  );
  const angle = (k: 'yaw' | 'pitch' | 'roll') =>
    num(k, p[k] ?? 0, (q, v) => {
      if (v) q[k] = v;
      else delete q[k];
    });
  return (
    <div className="ie-part">
      <div className="ed-row">
        {(['x', 'y', 'z'] as const).map((axis, j) =>
          num(`center ${axis}`, p.pos[j], (q, v) => (q.pos[j] = v)),
        )}
      </div>
      {p.type === 'cylinder' ? (
        <div className="ed-row">
          {num('radius', p.radius, (q, v) => q.type === 'cylinder' && (q.radius = v), 0.0001)}
          {num(
            'top radius',
            p.radiusTop ?? p.radius,
            (q, v) => q.type === 'cylinder' && (q.radiusTop = v),
            0,
          )}
          {num('height', p.height, (q, v) => q.type === 'cylinder' && (q.height = v), 0.0001)}
          {num(
            'sides',
            p.sides ?? 8,
            (q, v) => q.type === 'cylinder' && (q.sides = Math.round(v)),
            3,
          )}
        </div>
      ) : p.type === 'loft' ? (
        <>
          <p className="ed-note">
            Rings up its y, one a line: y, width, depth, and optionally x and z moved over.
          </p>
          <NumberRows
            rows={p.rings}
            width={[3, 5]}
            onChange={(rows) =>
              edit((q) => q.type === 'loft' && (q.rings = rows as typeof q.rings))
            }
          />
          <div className="ed-row">
            {num(
              'sides',
              p.sides ?? 8,
              (q, v) => q.type === 'loft' && (q.sides = Math.max(3, Math.min(16, Math.round(v)))),
              3,
            )}
          </div>
        </>
      ) : p.type === 'panel' ? (
        p.points ? (
          <>
            <p className="ed-note">
              Corners (x, z, one a line, in order round it); a flat face up its y.
            </p>
            <NumberRows
              rows={p.points}
              width={[2, 2]}
              onChange={(rows) =>
                edit((q) => q.type === 'panel' && (q.points = rows as typeof q.points))
              }
            />
          </>
        ) : (
          <div className="ed-row">
            {(['width', 'depth'] as const).map((label, j) =>
              num(
                label,
                p.size?.[j] ?? 0.1,
                (q, v) => q.type === 'panel' && q.size && (q.size[j] = v),
                0.0001,
              ),
            )}
          </div>
        )
      ) : p.type === 'hull' ? (
        <>
          <p className="ed-note">Points (x, y, z, one a line); it's the shape round them.</p>
          <NumberRows
            rows={p.points}
            width={[3, 3]}
            onChange={(rows) =>
              edit((q) => q.type === 'hull' && (q.points = rows as typeof q.points))
            }
          />
        </>
      ) : (
        <div className="ed-row">
          {(['width', 'height', 'depth'] as const).map((label, j) =>
            num(
              label,
              p.size[j],
              (q, v) =>
                (q.type === 'box' || q.type === 'wedge' || q.type === 'slab') && (q.size[j] = v),
              0.0001,
            ),
          )}
        </div>
      )}
      {p.type === 'slab' && (
        <>
          <p className="ed-note">Corner radii, seen from above (−z is the back):</p>
          <div className="ed-row">
            {SLAB_CORNER_NAMES.map((label, j) =>
              num(label, p.corners[j], (q, v) => q.type === 'slab' && (q.corners[j] = v), 0),
            )}
          </div>
          <div className="ed-row">
            {num(
              'steps per corner',
              p.segments ?? 4,
              (q, v) => {
                if (q.type !== 'slab') return;
                const n = Math.max(1, Math.min(12, Math.round(v)));
                if (n === 4) delete q.segments;
                else q.segments = n;
              },
              1,
            )}
          </div>
        </>
      )}
      <div className="ed-row">
        {angle('yaw')}
        {angle('pitch')}
        {angle('roll')}
      </div>
    </div>
  );
}

/**
 * A row of color swatches: a click colors the picked parts; with `pickAll`, shift-click
 * picks every part of that color instead.
 */
function Swatches(props: {
  label: string;
  colors: readonly { color: string; name: string }[];
  current: string | undefined;
  set: (c: string) => void;
  pickAll?: (c: string) => void;
}) {
  return (
    <div className="ie-swatches">
      <span className="ed-note">{props.label}</span>
      {props.colors.map(({ color, name }) => (
        <button
          key={color}
          className={color === props.current ? 'ie-chip ed-on' : 'ie-chip'}
          style={{ background: color }}
          title={`${name}${name === color ? '' : ` ${color}`}${props.pickAll ? ' · shift-click picks every part this color' : ''}`}
          onClick={(e) => (e.shiftKey && props.pickAll ? props.pickAll(color) : props.set(color))}
        />
      ))}
    </div>
  );
}

/**
 * The picture to trace under the side view (IE-2): chosen from a file, kept for this item on
 * this device (never in content), sized and placed in meters.
 */
function ReferenceFields(props: { item: string; view: { current: ModelView | null } }) {
  const { item, view } = props;
  // Keyed by the item, so a new item starts empty and loads its own.
  const [ref, setRef] = useState<(StoredReference & { url: string }) | null>(null);
  useEffect(() => {
    let live = true;
    void readReference(item).then((r) => {
      if (live && r) setRef({ ...r, url: URL.createObjectURL(r.picture) });
    });
    return () => {
      live = false;
    };
  }, [item]);
  // Shown while this is; each picture's URL let go once it's replaced or gone.
  useEffect(() => view.current?.setReference(ref), [ref, view]);
  useEffect(() => () => view.current?.setReference(null), [view]);
  const url = ref?.url;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const change = (c: Partial<StoredReference>): void => {
    if (!ref) return;
    const next = { ...ref, ...c };
    setRef(next);
    const { url: _, ...stored } = next;
    void writeReference(item, stored);
  };
  const choose = (file: File | undefined): void => {
    if (!file) return;
    const stored: StoredReference = ref
      ? { ...ref, picture: file }
      : { picture: file, width: 0.9, y: 0, z: 0, opacity: 0.5, flip: false };
    const { url: _, ...plain } = stored as StoredReference & { url?: string };
    setRef({ ...plain, url: URL.createObjectURL(file) });
    void writeReference(item, plain);
  };
  return (
    <div className="ed-row ie-tools ie-reference">
      <label className="ed-field">
        trace a picture
        <input type="file" accept="image/*" onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      {ref && (
        <>
          <Num
            label="width m"
            value={ref.width}
            min={0.01}
            onChange={(v) => v !== undefined && v > 0 && change({ width: v })}
          />
          <Num
            label="middle y"
            value={ref.y}
            onChange={(v) => v !== undefined && change({ y: v })}
          />
          <Num
            label="middle z"
            value={ref.z}
            onChange={(v) => v !== undefined && change({ z: v })}
          />
          <label className="ed-field">
            show
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={ref.opacity}
              onChange={(e) => change({ opacity: Number(e.target.value) })}
            />
          </label>
          <label className="ed-field">
            <input
              type="checkbox"
              checked={ref.flip}
              onChange={(e) => change({ flip: e.target.checked })}
            />
            flip
          </label>
          <button
            onClick={() => {
              setRef(null);
              void removeReference(item);
            }}
            title="Forget the picture for this item"
          >
            Remove
          </button>
        </>
      )}
    </div>
  );
}
