import {
  ATTACHMENT_SLOTS,
  addVec,
  fits,
  modelShapes,
  partSchema,
  type AttachmentDef,
  type AttachmentSlot,
  type ItemDb,
  type ItemDef,
  type ModelPart,
  type Shape,
  type Vec3,
  type WeaponDef,
  type WeaponState,
} from '@mes/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Combo, HexColour, Num, Pick, Text, Toggle } from '../editor/fields';
import { budgetOf, triangleCount } from './budget';
import type { ItemEditor, ItemEditorState } from './editor';
import {
  appendParts,
  duplicateParts,
  groupsOf,
  newPart,
  partLabel,
  removeParts,
} from './model-edit';
import {
  ModelView,
  pointColour,
  type FirstPerson,
  type ModelScene,
  type Picked,
  type ViewMode,
} from './model-view';

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
      return def.slot === 'optic' ? ['sight'] : def.slot === 'muzzle' ? ['muzzle'] : [];
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
): WeaponState =>
  ({
    item,
    mag: 0,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: {
      optic: attachments.optic ?? null,
      muzzle: attachments.muzzle ?? null,
      magazine: attachments.magazine ?? null,
    },
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
  const [fitted, setFitted] = useState<Partial<Record<AttachmentSlot, string>>>({});
  /** Attachments: the gun it's previewed on. */
  const [onGun, setOnGun] = useState<string | undefined>(undefined);
  const [clip, setClip] = useState<Clip | null>(readClip);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const view = useRef<ModelView | null>(null);
  // A new item: nothing picked, building (set while rendering, as React suggests).
  const [shown, setShown] = useState(def.id);
  if (shown !== def.id) {
    setShown(def.id);
    setPicked(null);
    setMode('build');
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
      pick: (p, add) =>
        setPicked((cur) => {
          if (!add) return p;
          if (p?.kind !== 'parts') return p ?? cur;
          const had = partsOf(cur);
          const i = p.indices[0]!;
          return asPicked(had.includes(i) ? had.filter((j) => j !== i) : [...had, i]);
        }),
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
    (g): g is WeaponDef => g.type === 'weapon' && def.type === 'attachment' && fits(g, def),
  );
  const gun = def.type === 'attachment' ? (guns.find((g) => g.id === onGun) ?? guns[0]) : undefined;
  const fittedOk = (slot: AttachmentSlot): string | undefined => {
    const id = fitted[slot];
    const a = id ? items.get(id) : undefined;
    return def.type === 'weapon' && a?.type === 'attachment' && a.slot === slot && fits(def, a)
      ? id
      : undefined;
  };

  // What the view draws, and first person, from the item as edited.
  const scene = buildScene(def, model, items, fittedOk, gun);
  const fp: FirstPerson | null = !db
    ? null
    : def.type === 'weapon'
      ? {
          kind: 'gun',
          gun: gunState(def.id, Object.fromEntries(ATTACHMENT_SLOTS.map((k) => [k, fittedOk(k)]))),
          db,
          optic: opticOf(db, fittedOk('optic')),
        }
      : def.type === 'attachment' && gun
        ? {
            kind: 'gun',
            gun: gunState(gun.id, { [def.slot]: def.id }),
            db,
            optic: def.slot === 'optic' ? (def.optic ?? null) : null,
          }
        : def.type === 'melee'
          ? { kind: 'knife', id: def.id, db }
          : null;
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
  /** Copies of the picked parts, mirrored or not, which are then picked. */
  const duplicate = (mirror: boolean): void => {
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

  // Keys, while not typing: W move, E turn, ⌫ delete, ⌘D duplicate, M mirror, F frame,
  // ⌘C copy, ⌘V paste, ⌘A pick every part, Esc pick nothing.
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
      if (k === 'w') setGizmo('translate');
      else if (k === 'e') setGizmo('rotate');
      else if (k === 'f') view.current?.frame();
      else if (k === 'backspace' || k === 'delete') remove();
      else if (k === 'm') duplicate(true);
      else if (k === 'escape') setPicked(null);
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
            edit={editPicked}
            single={
              part && ((change) => editModel((m) => m.parts[sel[0]!] && change(m.parts[sel[0]!]!)))
            }
            duplicate={duplicate}
            remove={canRemove ? remove : null}
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
                <span className="ie-swatch" style={{ background: pointColour(k) }} />
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
                  .filter((a) => a.type === 'attachment' && a.slot === slot && fits(def, a))
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
        <p className="ed-note">
          Click a part or point to pick it, shift-click to add one, drag a box to pick many; drag
          the gizmo. Right-drag or ⌥-drag orbits, middle-drag pans, scroll zooms. W move, E turn, F
          frame, M mirror a copy, ⌘D duplicate, ⌘C/⌘V copy and paste (into any item), ⌘A all, ⌫
          delete, Esc none.
        </p>
      </section>
    </main>
  );
}

const FRAME_NOTES: Record<string, string> = {
  weapon: 'Metres; the barrel along −z, y up. The origin sits on the body’s weapon bone.',
  attachment: 'Metres; its origin goes on the gun’s mount for its slot.',
  melee: 'Metres; the blade along −z, held at the grip.',
  armour: 'Metres, on the body as it stands (feet at 0, facing −z).',
  container: 'Metres, on the body as it stands (feet at 0, facing −z).',
  other: 'Metres. On the ground it rests on its lowest point.',
};

function opticOf(db: ItemDb, id: string | undefined) {
  const a = id ? db.get(id) : undefined;
  return a?.type === 'attachment' ? (a.optic ?? null) : null;
}

/** Shapes, skipping any that a half-typed field has broken. */
function safeShapes(
  parts: readonly ModelPart[],
  at?: Vec3,
  fitted?: (s: AttachmentSlot) => boolean,
): Shape[] {
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
    body: def.type === 'armour' || def.type === 'container',
    sightLine: null,
  };
  if (def.type === 'weapon') {
    const fittedSlots = new Set(ATTACHMENT_SLOTS.filter((s) => fitted(s)));
    scene.fitted = fittedSlots;
    const context: Shape[] = [];
    let sight = pointAt(model, 'sight') ?? null;
    for (const slot of fittedSlots) {
      const a = items.get(fitted(slot)!) as AttachmentDef;
      const mount = pointAt(model, `mounts.${slot}`);
      if (!mount) continue;
      context.push(...safeShapes(a.model.parts, mount));
      if (slot === 'optic' && a.model.sight) sight = addVec(mount, a.model.sight);
    }
    scene.context = context;
    scene.sightLine = sight;
  } else if (def.type === 'attachment') {
    const mount = gun?.model.mounts?.[def.slot];
    if (gun && mount) {
      // The gun around it, moved so this attachment's origin stays at the origin.
      const back: Vec3 = [-mount[0], -mount[1], -mount[2]];
      scene.context = safeShapes(gun.model.parts, back, (s) => s === def.slot);
    }
    if (def.slot === 'optic') scene.sightLine = pointAt(model, 'sight') ?? null;
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
      <span className="ie-swatch" style={{ background: p.colour }} />
      {partLabel(p, i)}
      {p.name && <span className="ed-note"> · {p.type}</span>}
      {p.hiddenBy && <span className="ed-note"> · hidden by {p.hiddenBy}</span>}
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
 * What the picked parts share (group, colour, what hides them) and what to do with them;
 * with one picked, its name, shape, place and turn as well.
 */
function PickedFields(props: {
  parts: readonly ModelPart[];
  picked: readonly number[];
  groups: readonly string[];
  gun: WeaponDef | null;
  edit: (change: (p: ModelPart) => void) => void;
  /** Edits the one picked part, when only one is. */
  single: ((change: (p: ModelPart) => void) => void) | undefined;
  duplicate: (mirror: boolean) => void;
  remove: (() => void) | null;
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
        <HexColour
          label={shared((p) => p.colour) ? 'colour' : 'colour (mixed)'}
          value={first.colour}
          onChange={(c) => edit((q) => (q.colour = c))}
        />
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
      </div>
      <div className="ed-row">
        <button onClick={() => props.duplicate(false)} title="⌘D">
          Duplicate
        </button>
        <button onClick={() => props.duplicate(true)} title="M: copies on the other side">
          Mirror
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
          num(`centre ${axis}`, p.pos[j], (q, v) => (q.pos[j] = v)),
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
      ) : (
        <div className="ed-row">
          {(['width', 'height', 'depth'] as const).map((label, j) =>
            num(label, p.size[j], (q, v) => q.type !== 'cylinder' && (q.size[j] = v), 0.0001),
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
