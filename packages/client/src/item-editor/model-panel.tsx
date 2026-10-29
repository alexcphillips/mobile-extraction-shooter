import {
  ATTACHMENT_SLOTS,
  addVec,
  fits,
  modelShapes,
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
import { useEffect, useRef, useState } from 'react';
import { HexColour, Num, Pick, Toggle } from '../editor/fields';
import type { ItemEditor, ItemEditorState } from './editor';
import { mirrorPart, newPart } from './model-edit';
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

const gunState = (
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

export function ModelTab(props: { editor: ItemEditor; state: ItemEditorState; def: ItemDef }) {
  const { editor, state: s, def } = props;
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

  const editModel = (change: (m: Model) => void, gesture = false): void =>
    editor.edit((d) => change(d.model as Model), gesture);

  // The view lives as long as the tab.
  useEffect(() => {
    const v = new ModelView(canvas.current!, overlay.current!, {
      pick: setPicked,
      moved: (p, pos, angles) =>
        editModel((m) => {
          if (p?.kind === 'point') return setPoint(m, p.key, pos);
          const part = p?.kind === 'part' ? m.parts[p.index] : undefined;
          if (!part) return;
          part.pos = [r4(pos[0]), r4(pos[1]), r4(pos[2])];
          const [yaw, pitch, roll] = angles!.map(r1) as [number, number, number];
          for (const [k, a] of [
            ['yaw', yaw],
            ['pitch', pitch],
            ['roll', roll],
          ] as const) {
            if (a) part[k] = a;
            else delete part[k];
          }
        }, true),
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

  const addPart = (type: ModelPart['type']): void => {
    const at = picked?.kind === 'part' ? model.parts[picked.index]?.pos : undefined;
    editModel((m) => m.parts.push(newPart(type, at ?? [0, 0, 0])));
    setPicked({ kind: 'part', index: model.parts.length });
  };
  const copyPart = (i: number, mirror: boolean): void => {
    const p = model.parts[i];
    if (!p) return;
    editModel((m) => m.parts.splice(i + 1, 0, mirror ? mirrorPart(p) : structuredClone(p)));
    setPicked({ kind: 'part', index: i + 1 });
  };
  const removePart = (i: number): void => {
    if (model.parts.length <= 1) return;
    editModel((m) => m.parts.splice(i, 1));
    setPicked(null);
  };

  // Keys, while not typing: W move, E turn, ⌫ delete, ⌘D copy, M mirror, F frame.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      )
        return;
      const p = picked;
      const k = e.key.toLowerCase();
      if (k === 'w') setGizmo('translate');
      else if (k === 'e') setGizmo('rotate');
      else if (k === 'f') view.current?.frame();
      else if ((k === 'backspace' || k === 'delete') && p?.kind === 'part') removePart(p.index);
      else if (k === 'd' && (e.metaKey || e.ctrlKey) && p?.kind === 'part') {
        e.preventDefault();
        copyPart(p.index, false);
      } else if (k === 'm' && p?.kind === 'part') copyPart(p.index, true);
      else if (k === 'escape') setPicked(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const part = picked?.kind === 'part' ? model.parts[picked.index] : undefined;
  const keys = pointKeys(def);
  return (
    <main className="ie-main">
      <section className="ed-inspector ie-form">
        <h3>{def.name}</h3>
        <p className="ed-note">{FRAME_NOTES[def.type] ?? FRAME_NOTES.other}</p>
        <h4>parts</h4>
        <ul className="ed-list ie-parts">
          {model.parts.map((p, i) => (
            <li
              key={i}
              className={picked?.kind === 'part' && picked.index === i ? 'ed-on' : undefined}
              onClick={() => setPicked({ kind: 'part', index: i })}
            >
              <span className="ie-swatch" style={{ background: p.colour }} />
              {p.type} {i + 1}
              {p.hiddenBy && <span className="ed-note"> · hidden by {p.hiddenBy}</span>}
            </li>
          ))}
        </ul>
        <div className="ed-row ie-tools">
          <button onClick={() => addPart('box')}>+ box</button>
          <button onClick={() => addPart('cylinder')}>+ cylinder</button>
          <button onClick={() => addPart('wedge')}>+ wedge</button>
        </div>
        {part && picked?.kind === 'part' && (
          <PartFields
            part={part}
            gun={def.type === 'weapon' ? def : null}
            edit={(change) => editModel((m) => change(m.parts[picked.index]!))}
            copy={(mirror) => copyPart(picked.index, mirror)}
            remove={model.parts.length > 1 ? () => removePart(picked.index) : null}
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
          Click a part or point to pick it; drag the gizmo. Right-drag or ⌥-drag orbits, middle-drag
          pans, scroll zooms. W move, E turn, M mirror a copy, ⌘D copy, ⌫ delete.
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

function PartFields(props: {
  part: ModelPart;
  gun: WeaponDef | null;
  edit: (change: (p: ModelPart) => void) => void;
  copy: (mirror: boolean) => void;
  remove: (() => void) | null;
}) {
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
      <div className="ed-row">
        {angle('yaw')}
        {angle('pitch')}
        {angle('roll')}
      </div>
      <div className="ed-row">
        <HexColour label="colour" value={p.colour} onChange={(c) => edit((q) => (q.colour = c))} />
        {props.gun && (
          <Pick
            label="hidden by"
            value={p.hiddenBy}
            options={ATTACHMENT_SLOTS.filter((s) => props.gun!.slots?.includes(s))}
            unset="never hidden"
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
        <button onClick={() => props.copy(false)} title="⌘D">
          Copy
        </button>
        <button onClick={() => props.copy(true)} title="M: a copy on the other side">
          Mirror
        </button>
        <button onClick={() => props.remove?.()} disabled={!props.remove} title="⌫">
          Delete
        </button>
      </div>
    </div>
  );
}
