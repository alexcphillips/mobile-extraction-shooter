import type { Character, CompiledMap, MapZone, Shape, SimState } from '@mes/shared';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/*
 * The map tab (session 11b): an SVG drawn from the map data, looking straight down with
 * −z up. Everything that stands is drawn as its footprint in its own colour, highest on
 * top, so buildings show as their roofs; then named zones, extraction points and you.
 * The static part is built once per map and kept, so a redraw only moves your arrow.
 */

/** How wide the "near me" view is, in metres. */
const NEAR = 60;
/** Footprints smaller than this (m²) are left out: cans, books, rungs. */
const MIN_AREA = 0.08;

interface Footprint {
  /** SVG polygon points, or a circle. */
  points: string | null;
  cx: number;
  cz: number;
  r: number;
  top: number;
  fill: string;
}

interface MapLayers {
  minX: number;
  minZ: number;
  w: number;
  h: number;
  ground: string;
  /** Water as rects, x, z, w, h. */
  water: [number, number, number, number][];
  waterColour: string;
  footprints: Footprint[];
}

const cache = new WeakMap<CompiledMap, MapLayers>();

function css(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/** A shape's footprint, placed at (px, pz) turned by pyaw (for instanced copies). */
function footprint(s: Shape, px: number, py: number, pz: number, pyaw: number): Footprint | null {
  const c = Math.cos(pyaw);
  const sn = Math.sin(pyaw);
  const cx = px + s.x * c + s.z * sn;
  const cz = pz - s.x * sn + s.z * c;
  const top = py + s.y + s.hy;
  const fill = css(s.colour);
  if (s.kind === 'cylinder') {
    const r = Math.max(s.radius, s.radiusTop);
    return Math.PI * r * r < MIN_AREA ? null : { points: null, cx, cz, r, top, fill };
  }
  if (4 * s.hx * s.hz < MIN_AREA) return null;
  const yaw = s.yaw + pyaw;
  const yc = Math.cos(yaw);
  const ys = Math.sin(yaw);
  const pts: string[] = [];
  for (const [lx, lz] of [
    [-s.hx, -s.hz],
    [s.hx, -s.hz],
    [s.hx, s.hz],
    [-s.hx, s.hz],
  ] as const) {
    pts.push(`${(cx + lx * yc + lz * ys).toFixed(2)},${(cz - lx * ys + lz * yc).toFixed(2)}`);
  }
  return { points: pts.join(' '), cx, cz, r: 0, top, fill };
}

function buildLayers(map: CompiledMap): MapLayers {
  const t = map.world.terrain;
  const footprints: Footprint[] = [];
  for (const s of map.shapes) {
    const f = footprint(s, 0, 0, 0, 0);
    if (f) footprints.push(f);
  }
  for (const group of map.instanced) {
    for (const p of group.placements) {
      for (const s of group.shapes) {
        const f = footprint(s, p.x, p.y, p.z, p.yaw);
        if (f) footprints.push(f);
      }
    }
  }
  footprints.sort((a, b) => a.top - b.top);
  // Cells whose middle is under water, merged along each row.
  const water: MapLayers['water'] = [];
  if (map.water) {
    const corner = (i: number, j: number): number => t.heights[j * (t.cols + 1) + i]!;
    for (let j = 0; j < t.rows; j++) {
      let start = -1;
      for (let i = 0; i <= t.cols; i++) {
        const wet =
          i < t.cols &&
          (corner(i, j) + corner(i + 1, j) + corner(i, j + 1) + corner(i + 1, j + 1)) / 4 <
            map.water.level;
        if (wet && start < 0) start = i;
        if (!wet && start >= 0) {
          water.push([
            t.minX + start * t.cellSize,
            t.minZ + j * t.cellSize,
            (i - start) * t.cellSize,
            t.cellSize,
          ]);
          start = -1;
        }
      }
    }
  }
  return {
    minX: t.minX,
    minZ: t.minZ,
    w: t.cols * t.cellSize,
    h: t.rows * t.cellSize,
    ground: css(map.terrainColour),
    water,
    waterColour: css(map.water?.colour ?? 0x3a6ea5),
    footprints,
  };
}

/**
 * Where each named zone's name goes: its middle, biggest zones first, leaving out a name
 * that would run into one already placed (zoomed in, they part and both show). Widths
 * are guessed from the number of letters.
 */
function zoneLabels(map: CompiledMap, font: number): [number, number, MapZone][] {
  const out: [number, number, MapZone][] = [];
  const placed: [number, number, number, number][] = [];
  const area = (zone: MapZone): number => {
    const xs = zone.points.map((p) => p[0]);
    const zs = zone.points.map((p) => p[1]);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  };
  for (const zone of [...map.zones].sort((a, b) => area(b) - area(a))) {
    const n = zone.points.length;
    const x = zone.points.reduce((a, p) => a + p[0], 0) / n;
    const z = zone.points.reduce((a, p) => a + p[1], 0) / n;
    const hw = zone.name.length * font * 0.3;
    const hh = font * 0.6;
    if (
      placed.some(([px, pz, pw, ph]) => Math.abs(px - x) < pw + hw && Math.abs(pz - z) < ph + hh)
    ) {
      continue;
    }
    placed.push([x, z, hw, hh]);
    out.push([x, z, zone]);
  }
  return out;
}

interface Props {
  map: CompiledMap;
  sim: SimState;
  player: Character;
  /** Bumped on each redraw, so your arrow moves. */
  version: number;
}

export function MapTab({ map, sim, player }: Props): ReactNode {
  const layers = useMemo(() => {
    let l = cache.get(map);
    if (!l) {
      l = buildLayers(map);
      cache.set(map, l);
    }
    return l;
  }, [map]);
  const [near, setNear] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = (): void => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = near
    ? { x: player.x - NEAR / 2, z: player.z - NEAR / 2, w: NEAR, h: NEAR }
    : { x: layers.minX, z: layers.minZ, w: layers.w, h: layers.h };
  // Metres per screen pixel, so labels and lines stay the same size at either zoom.
  const k = Math.max(view.w / size.w, view.h / size.h);

  // The static layers don't depend on the zoom, so React skips them on a redraw.
  const ground = useMemo(
    () => (
      <g>
        <rect
          x={layers.minX}
          y={layers.minZ}
          width={layers.w}
          height={layers.h}
          fill={layers.ground}
        />
        {layers.water.map(([x, z, w, h], i) => (
          <rect key={i} x={x} y={z} width={w + 0.05} height={h + 0.05} fill={layers.waterColour} />
        ))}
        {layers.footprints.map((f, i) =>
          f.points ? (
            <polygon key={i} points={f.points} fill={f.fill} />
          ) : (
            <circle key={i} cx={f.cx} cy={f.cz} r={f.r} fill={f.fill} />
          ),
        )}
      </g>
    ),
    [layers],
  );

  const font = 11 * k;
  const label = (x: number, z: number, text: string, fill: string, key: string): ReactNode => (
    <text
      key={key}
      x={x}
      y={z}
      fontSize={font}
      fill={fill}
      stroke="rgb(0 0 0 / 0.7)"
      strokeWidth={3 * k}
      paintOrder="stroke"
      textAnchor="middle"
      dominantBaseline="middle"
    >
      {text}
    </text>
  );
  const extractions = sim.raid?.extractions ?? [];
  const arrow = 9 * k;

  return (
    <div className="raid-map">
      <svg
        ref={svgRef}
        className="raid-map-svg"
        viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {ground}
        {map.zones.map((zone) => (
          <polygon
            key={zone.id}
            points={zone.points.map(([x, z]) => `${x},${z}`).join(' ')}
            fill="rgb(255 255 255 / 0.07)"
            stroke="rgb(255 255 255 / 0.55)"
            strokeWidth={1.5 * k}
            strokeDasharray={`${5 * k} ${4 * k}`}
          />
        ))}
        {zoneLabels(map, font).map(([x, z, zone]) =>
          label(x, z, zone.name, '#f2efe6', `z-${zone.id}`),
        )}
        {extractions.map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.z}
            r={p.radius}
            fill="rgb(108 255 138 / 0.3)"
            stroke="#6cff8a"
            strokeWidth={2 * k}
          />
        ))}
        {extractions.map((p) => label(p.x, p.z - p.radius - font, p.name, '#b9ffca', `e-${p.id}`))}
        <g
          transform={`translate(${player.x} ${player.z}) rotate(${(-player.yaw * 180) / Math.PI})`}
        >
          <path
            d={`M 0 ${-arrow} L ${arrow * 0.65} ${arrow * 0.7} L 0 ${arrow * 0.35} L ${-arrow * 0.65} ${arrow * 0.7} Z`}
            fill="#ffd34d"
            stroke="#000"
            strokeWidth={1.5 * k}
          />
        </g>
      </svg>
      <div className="raid-map-tools">
        <button onClick={() => setNear(!near)}>{near ? 'Whole map' : 'Near me'}</button>
      </div>
    </div>
  );
}
