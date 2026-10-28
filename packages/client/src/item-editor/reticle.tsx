import { SCOPE_RADIUS, type OpticDef, type ReticleShape } from '@mes/shared';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { HexColour, Num } from '../editor/fields';
import { aimedFov, reticleMarkup } from '../hud/optic';

/*
 * The reticle designer (session 18): the reticle drawn by the game's own markup
 * (hud/optic.ts) on a phone-shaped screen, over a person standing at a chosen range, sized
 * for the optic's zoom, so a mil line or a dot can be judged against a body. Shapes are
 * picked and dragged by their handles; a drag is one undo step.
 */

/** An iPhone's screen in landscape; reticle units are % of its height. */
const ASPECT = 19.5 / 9;
const W = 100 * ASPECT;
const RANGES = [10, 25, 50, 100, 200] as const;
const SNAPS = [0, 0.1, 0.25, 0.5, 1] as const;
/** Reticle units per point on an iPhone 15 in landscape (393 points high). */
const POINTS = 393 / 100;
const HANDLE = 1.3;

type Handle = 'move' | 'a' | 'b' | 'r';

interface Drag {
  index: number;
  handle: Handle;
  from: { x: number; y: number };
  shape: ReticleShape;
}

/** A shape after dragging one of its handles by (dx, dy), to (x, y). */
function dragged(s: ReticleShape, h: Handle, dx: number, dy: number, snap: (v: number) => number) {
  switch (s.type) {
    case 'line':
      return {
        ...s,
        ...(h !== 'b' && { x1: snap(s.x1 + dx), y1: snap(s.y1 + dy) }),
        ...(h !== 'a' && { x2: snap(s.x2 + dx), y2: snap(s.y2 + dy) }),
      };
    case 'dot':
    case 'ring':
      if (h === 'r') return { ...s, r: Math.max(snap(s.r + dx) || 0.05, 0.05) };
      return { ...s, x: snap(s.x + dx), y: snap(s.y + dy) };
  }
}

function mirrored(s: ReticleShape, axis: 'x' | 'y'): ReticleShape {
  const f = (v: number, on: boolean): number => (on ? -v || 0 : v);
  const x = axis === 'x';
  if (s.type === 'line')
    return { ...s, x1: f(s.x1, x), x2: f(s.x2, x), y1: f(s.y1, !x), y2: f(s.y2, !x) };
  return { ...s, x: f(s.x, x), y: f(s.y, !x) };
}

const NEW: Record<ReticleShape['type'], ReticleShape> = {
  dot: { type: 'dot', x: 0, y: 0, r: 0.6 },
  line: { type: 'line', x1: 0, y1: 2, x2: 0, y2: 10, width: 0.3 },
  ring: { type: 'ring', x: 0, y: 0, r: 4, width: 0.3 },
};

function describe(s: ReticleShape): string {
  if (s.type === 'line') return `line (${s.x1}, ${s.y1}) → (${s.x2}, ${s.y2})`;
  return `${s.type} at (${s.x}, ${s.y}), r ${s.r}`;
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
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const selected = sel !== null ? shapes[sel] : undefined;
  const snap = (v: number): number =>
    snapStep ? Math.round(v / snapStep) * snapStep : Math.round(v * 100) / 100;
  const tidy = (v: number): number => Number(v.toFixed(3));

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
    const next = dragged(d.shape, d.handle, p.x - d.from.x, p.y - d.from.y, (v) => tidy(snap(v)));
    edit((o) => void (o.reticle.shapes[d.index] = next), true);
  };
  const end = (): void => {
    if (!drag.current) return;
    drag.current = null;
    props.gesture(false);
  };
  const setShape = (change: (s: Record<string, number>) => void): void =>
    edit((o) => {
      const s = sel === null ? undefined : o.reticle.shapes[sel];
      if (s) change(s as unknown as Record<string, number>);
    });

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
            {s.type === 'line' ? (
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeWidth={Math.max(s.width, 2)} />
            ) : (
              <circle
                cx={s.x}
                cy={s.y}
                r={s.type === 'dot' ? Math.max(s.r, 1) : s.r}
                strokeWidth={s.type === 'ring' ? Math.max(s.width, 2) : 0}
                fill={s.type === 'dot' ? 'transparent' : 'none'}
              />
            )}
          </g>
        ))}
        {selected && sel !== null && (
          <g className="ie-handles">
            {selected.type === 'line' ? (
              <>
                <circle
                  cx={selected.x1}
                  cy={selected.y1}
                  r={HANDLE}
                  onPointerDown={(e) => start(e, sel, 'a')}
                />
                <circle
                  cx={selected.x2}
                  cy={selected.y2}
                  r={HANDLE}
                  onPointerDown={(e) => start(e, sel, 'b')}
                />
              </>
            ) : (
              <>
                <circle
                  cx={selected.x}
                  cy={selected.y}
                  r={HANDLE}
                  onPointerDown={(e) => start(e, sel, 'move')}
                />
                <rect
                  x={selected.x + selected.r - HANDLE}
                  y={selected.y - HANDLE}
                  width={HANDLE * 2}
                  height={HANDLE * 2}
                  onPointerDown={(e) => start(e, sel, 'r')}
                />
              </>
            )}
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
        <HexColour
          label="colour"
          value={optic.reticle.colour}
          onChange={(c) => edit((o) => void (o.reticle.colour = c))}
        />
      </div>
      <p className="ed-note">
        Units are % of the screen height from the aim point, y down; 1 is about {POINTS.toFixed(1)}{' '}
        pt on an iPhone.{scope && ` The mask's edge is at ${SCOPE_RADIUS}.`} A person at {range} m
        is {(1.8 * u).toFixed(1)} high. Drag a shape, or its handles.
      </p>
      <div className="ed-row">
        {(['dot', 'line', 'ring'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              edit((o) => void o.reticle.shapes.push({ ...NEW[t] }));
              setSel(shapes.length);
            }}
          >
            + {t}
          </button>
        ))}
        <button
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            edit((o) => void o.reticle.shapes.push(mirrored(selected, 'x')));
            setSel(shapes.length);
          }}
          title="A copy mirrored left to right"
        >
          mirror ↔
        </button>
        <button
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            edit((o) => void o.reticle.shapes.push(mirrored(selected, 'y')));
            setSel(shapes.length);
          }}
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
            {describe(s)}
          </li>
        ))}
      </ul>
      {selected && (
        <div className="ed-row">
          {(selected.type === 'line'
            ? (['x1', 'y1', 'x2', 'y2', 'width'] as const)
            : selected.type === 'ring'
              ? (['x', 'y', 'r', 'width'] as const)
              : (['x', 'y', 'r'] as const)
          ).map((k) => (
            <Num
              key={k}
              label={
                k === 'width'
                  ? `width (${((selected as { width: number }).width * POINTS).toFixed(1)} pt)`
                  : k
              }
              value={(selected as unknown as Record<string, number>)[k]}
              onChange={(v) => setShape((s) => void (v !== undefined && (s[k] = v)))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
