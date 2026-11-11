import { SCOPE_RADIUS, type OpticDef, type ReticleShape } from '@mes/shared';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { HexColor, Num } from '../editor/fields';
import { aimedFov, arcPath, reticleMarkup } from '../hud/optic';
import {
  NEW_SHAPES,
  SHAPE_FIELDS,
  describe,
  dragged,
  mirrored,
  repeated,
  type Handle,
} from './reticle-edit';

/*
 * The reticle designer (session 18): the reticle drawn by the game's own markup
 * (hud/optic.ts) on a phone-shaped screen, over a person standing at a chosen range, sized
 * for the optic's zoom, so a mil line or a dot can be judged against a body. Shapes are
 * picked and dragged by their handles; a drag is one undo step. IE-2 added arcs, filled
 * triangles, a color per shape and a repeat tool.
 */

/** An iPhone's screen in landscape; reticle units are % of its height. */
const ASPECT = 19.5 / 9;
const W = 100 * ASPECT;
const RANGES = [10, 25, 50, 100, 200] as const;
const SNAPS = [0, 0.1, 0.25, 0.5, 1] as const;
/** Reticle units per point on an iPhone 15 in landscape (393 points high). */
const POINTS = 393 / 100;
const HANDLE = 1.3;

interface Drag {
  index: number;
  handle: Handle;
  from: { x: number; y: number };
  shape: ReticleShape;
}

/** A handle's circle. */
function Dot(props: { x: number; y: number; on: (e: ReactPointerEvent) => void }) {
  return <circle cx={props.x} cy={props.y} r={HANDLE} onPointerDown={props.on} />;
}

export function ReticleDesigner(props: {
  optic: OpticDef;
  edit: (change: (optic: OpticDef) => void, gesture?: boolean) => void;
  gesture: (on: boolean) => void;
}) {
  const { optic, edit } = props;
  const shapes = optic.reticle.shapes;
  const [sel, setSel] = useState<number | null>(null);
  const [snapStep, setSnap] = useState<number>(0.25);
  const [range, setRange] = useState<number>(50);
  const [dark, setDark] = useState(false);
  const [rep, setRep] = useState({ n: 4, dx: 0, dy: 2 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const selected = sel !== null ? shapes[sel] : undefined;
  const snap = (v: number): number =>
    snapStep ? Math.round(v / snapStep) * snapStep : Math.round(v * 100) / 100;

  const units = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const m = svg.current?.getScreenCTM()?.inverse();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  };
  const start = (e: ReactPointerEvent, index: number, handle: Handle): void => {
    e.stopPropagation();
    setSel(index);
    const shape = shapes[index];
    if (!shape) return;
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = { index, handle, from: units(e), shape };
    props.gesture(true);
  };
  const move = (e: ReactPointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const p = units(e);
    const next = dragged(d.shape, d.handle, p.x - d.from.x, p.y - d.from.y, snap, p, !!snapStep);
    edit((o) => void (o.reticle.shapes[d.index] = next), true);
  };
  const end = (): void => {
    if (!drag.current) return;
    drag.current = null;
    props.gesture(false);
  };
  const setShape = (change: (s: Record<string, unknown>) => void): void =>
    edit((o) => {
      const s = sel === null ? undefined : o.reticle.shapes[sel];
      if (s) change(s as unknown as Record<string, unknown>);
    });
  /** Adds shapes after the end and picks the first of them. */
  const add = (...more: ReticleShape[]): void => {
    if (!more.length) return;
    edit((o) => void o.reticle.shapes.push(...more.map((m) => structuredClone(m))));
    setSel(shapes.length);
  };

  // A person standing at the range, chest on the aim point, at the zoom's field of view.
  const fov = (aimedFov(optic.zoom) * Math.PI) / 180;
  const u = 100 / (2 * range * Math.tan(fov / 2));
  const y = (m: number): number => (1.3 - m) * u;
  const scope = optic.zoom > 1;

  return (
    <div className="ie-card ie-reticle">
      <h4>
        reticle · {scope ? `${optic.zoom}× scope` : 'red dot'} · drawn as on an iPhone in landscape
      </h4>
      <svg
        ref={svg}
        viewBox={`${-W / 2} -50 ${W} 100`}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerDown={() => setSel(null)}
      >
        <rect x={-W / 2} y={-50} width={W} height={50} fill={dark ? '#3a4250' : '#a9c2d4'} />
        <rect x={-W / 2} y={0} width={W} height={50} fill={dark ? '#2b2f25' : '#7c8656'} />
        <g fill={dark ? '#14161a' : '#3d4a33'}>
          <circle cx={0} cy={y(1.66)} r={0.12 * u} />
          <rect x={-0.23 * u} y={y(1.52)} width={0.46 * u} height={0.68 * u} />
          <rect x={-0.17 * u} y={y(0.84)} width={0.34 * u} height={0.84 * u} />
        </g>
        <g dangerouslySetInnerHTML={{ __html: reticleMarkup(optic) }} />
        {shapes.map((s, i) => (
          <g key={i} className="ie-hit" onPointerDown={(e) => start(e, i, 'move')}>
            <HitArea s={s} />
          </g>
        ))}
        {selected && sel !== null && (
          <g className="ie-handles">
            <Handles s={selected} on={(e, h) => start(e, sel, h)} />
          </g>
        )}
      </svg>
      <div className="ed-row ie-tools">
        <label className="ed-field">
          person at
          <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {r} m
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field">
          snap
          <select value={snapStep} onChange={(e) => setSnap(Number(e.target.value))}>
            {SNAPS.map((v) => (
              <option key={v} value={v}>
                {v || 'off'}
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field">
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          night
        </label>
        <HexColor
          label="reticle color"
          value={optic.reticle.color}
          onChange={(c) => edit((o) => void (o.reticle.color = c))}
        />
      </div>
      <p className="ed-note">
        Units are % of the screen height from the aim point, y down; 1 is about {POINTS.toFixed(1)}{' '}
        pt on an iPhone.{scope && ` The mask's edge is at ${SCOPE_RADIUS}.`} A person at {range} m
        is {(1.8 * u).toFixed(1)} high. Drag a shape, or its handles. Arc angles are degrees
        clockwise from straight up.
      </p>
      <div className="ed-row">
        {(['dot', 'line', 'ring', 'arc', 'triangle'] as const).map((t) => (
          <button key={t} onClick={() => add(NEW_SHAPES[t])}>
            + {t}
          </button>
        ))}
        <button
          disabled={!selected}
          onClick={() => selected && add(mirrored(selected, 'x'))}
          title="A copy mirrored left to right"
        >
          mirror ↔
        </button>
        <button
          disabled={!selected}
          onClick={() => selected && add(mirrored(selected, 'y'))}
          title="A copy mirrored top to bottom"
        >
          mirror ↕
        </button>
        <button
          disabled={!selected || shapes.length < 2}
          onClick={() => {
            if (sel === null) return;
            edit((o) => void o.reticle.shapes.splice(sel, 1));
            setSel(null);
          }}
          title="A reticle needs at least one shape"
        >
          delete
        </button>
      </div>
      <ul className="ed-list ie-shapes">
        {shapes.map((s, i) => (
          <li key={i} className={i === sel ? 'ed-on' : undefined} onClick={() => setSel(i)}>
            {s.color && <span className="ie-swatch" style={{ background: s.color }} />}
            {describe(s)}
          </li>
        ))}
      </ul>
      {selected && (
        <>
          <div className="ed-row">
            {SHAPE_FIELDS[selected.type].map((k) => (
              <Num
                key={k}
                label={
                  k === 'width' && 'width' in selected
                    ? `width (${(selected.width * POINTS).toFixed(1)} pt)`
                    : k === 'from' || k === 'to'
                      ? `${k} °`
                      : k
                }
                value={(selected as unknown as Record<string, number>)[k]}
                onChange={(v) => setShape((s) => void (v !== undefined && (s[k] = v)))}
              />
            ))}
          </div>
          <div className="ed-row ie-tools">
            <HexColor
              label={selected.color ? 'own color' : 'color (the reticle’s)'}
              value={selected.color ?? optic.reticle.color}
              onChange={(c) => setShape((s) => void (s.color = c))}
            />
            {selected.color && (
              <button
                onClick={() => setShape((s) => void delete s.color)}
                title="Draw it in the reticle's color again"
              >
                Reticle color
              </button>
            )}
          </div>
          <div className="ed-row ie-tools">
            <Num
              label="repeat ×"
              value={rep.n}
              min={1}
              onChange={(v) => v !== undefined && setRep((r) => ({ ...r, n: Math.round(v) }))}
            />
            <Num
              label="step x"
              value={rep.dx}
              onChange={(v) => v !== undefined && setRep((r) => ({ ...r, dx: v }))}
            />
            <Num
              label="step y"
              value={rep.dy}
              onChange={(v) => v !== undefined && setRep((r) => ({ ...r, dy: v }))}
            />
            <button
              disabled={rep.n < 1 || rep.n > 100 || (!rep.dx && !rep.dy)}
              onClick={() => add(...repeated(selected, Math.min(rep.n, 100), rep.dx, rep.dy))}
              title="Adds copies of the shape, each a step on from the one before (mil ticks, a ladder); they're plain shapes"
            >
              Repeat
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** What catches a click on a shape: wider than the shape, invisible. */
function HitArea({ s }: { s: ReticleShape }) {
  switch (s.type) {
    case 'line':
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeWidth={Math.max(s.width, 2)} />;
    case 'triangle':
      return (
        <polygon
          points={`${s.x1},${s.y1} ${s.x2},${s.y2} ${s.x3},${s.y3}`}
          strokeWidth={1}
          fill="transparent"
        />
      );
    case 'arc':
      return (
        <path
          d={arcPath(s.x, s.y, s.r, s.from, s.to)}
          strokeWidth={Math.max(s.width, 2)}
          fill="none"
        />
      );
    case 'dot':
      return <circle cx={s.x} cy={s.y} r={Math.max(s.r, 1)} strokeWidth={0} fill="transparent" />;
    case 'ring':
      return <circle cx={s.x} cy={s.y} r={s.r} strokeWidth={Math.max(s.width, 2)} fill="none" />;
  }
}

/** The picked shape's handles: corners, a center and radius, an arc's ends. */
function Handles(props: { s: ReticleShape; on: (e: ReactPointerEvent, h: Handle) => void }) {
  const { s, on } = props;
  if (s.type === 'line')
    return (
      <>
        <Dot x={s.x1} y={s.y1} on={(e) => on(e, 'a')} />
        <Dot x={s.x2} y={s.y2} on={(e) => on(e, 'b')} />
      </>
    );
  if (s.type === 'triangle')
    return (
      <>
        <Dot x={s.x1} y={s.y1} on={(e) => on(e, 'a')} />
        <Dot x={s.x2} y={s.y2} on={(e) => on(e, 'b')} />
        <Dot x={s.x3} y={s.y3} on={(e) => on(e, 'c')} />
      </>
    );
  const end = (deg: number): { x: number; y: number } => ({
    x: s.x + s.r * Math.sin((deg * Math.PI) / 180),
    y: s.y - s.r * Math.cos((deg * Math.PI) / 180),
  });
  return (
    <>
      <Dot x={s.x} y={s.y} on={(e) => on(e, 'move')} />
      <rect
        x={s.x + s.r - HANDLE}
        y={s.y - HANDLE}
        width={HANDLE * 2}
        height={HANDLE * 2}
        onPointerDown={(e) => on(e, 'r')}
      />
      {s.type === 'arc' && (
        <>
          <Dot {...end(s.from)} on={(e) => on(e, 'from')} />
          <Dot {...end(s.to)} on={(e) => on(e, 'to')} />
        </>
      )}
    </>
  );
}
