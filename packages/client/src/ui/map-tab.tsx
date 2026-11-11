import {
  HeightGrid,
  extractionsOf,
  waterLevelAt,
  type Character,
  type CompiledMap,
  type CompiledMarker,
  type MapZone,
  type Shape,
  type SimState,
} from '@mes/shared';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CUT_ABOVE } from '../editor/cut';

/*
 * The map tab (session 11b): an SVG drawn from the map data, looking straight down with
 * −z up. Everything that stands is drawn as its footprint in its own colour, highest on
 * top. A map with `floors` (2026-11-09) is shown a floor at a time, cut CUT_ABOVE over it
 * as the editor's cutaway is, so a covered building shows its rooms, not its roof; what's
 * well below the floor shown (an atrium's ground floor) is dimmed. Then named zones, map
 * labels, your extraction points and you (no quest spots since
 * 2026-11-11: the objective's text and the map labels say where). The view is framed on what's
 * built, not the whole terrain. Each floor's layers are built once per map and kept, so a
 * redraw only moves your arrow.
 */

/** How wide the "near me" view is, in metres. */
const NEAR = 60;
/** Footprints smaller than this (m²) are left out: cans, books, rungs. */
const MIN_AREA = 0.08;
/** Metres of ground shown round what's built. */
const FRAME_MARGIN = 8;
/** You (or a label) stand on a floor from this far under its height. */
const ON_FLOOR = 0.5;
/** What tops out this far under the floor shown is below it, so dimmed. */
const BELOW = 0.5;

interface Footprint {
  /** SVG polygon points, or a circle. */
  points: string | null;
  cx: number;
  cz: number;
  r: number;
  bottom: number;
  top: number;
  fill: string;
  /** Its extent in x and z, for framing the view. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Frame {
  x: number;
  z: number;
  w: number;
  h: number;
}

interface MapBase {
  /** The terrain's extent. */
  ground: Frame;
  /** What's built and where the markers are, with a margin, inside the terrain. */
  frame: Frame;
  groundColour: string;
  /** Water as rects, x, z, w, h. */
  water: [number, number, number, number][];
  waterColour: string;
  /** Every footprint, lowest top first. */
  footprints: Footprint[];
}

/** One floor's footprints: those below it (dimmed), then those on it. */
interface FloorLayers {
  below: Footprint[];
  on: Footprint[];
}

interface Cached {
  base: MapBase;
  /** By floor index; -1 is the view from above (a map without floors). */
  floors: Map<number, FloorLayers>;
}

const cache = new WeakMap<CompiledMap, Cached>();

function css(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/** A shape's footprint, placed at (px, pz) turned by pyaw (for instanced copies). */
function footprint(s: Shape, px: number, py: number, pz: number, pyaw: number): Footprint | null {
  const c = Math.cos(pyaw);
  const sn = Math.sin(pyaw);
  const cx = px + s.x * c + s.z * sn;
  const cz = pz - s.x * sn + s.z * c;
  // A tilted shape reaches further up and down than its hy.
  const tilt = s.pitch || s.roll;
  const half =
    s.kind === 'cylinder' || !tilt
      ? s.hy
      : s.hy * Math.abs(Math.cos(s.pitch) * Math.cos(s.roll)) +
        s.hz * Math.abs(Math.sin(s.pitch)) +
        s.hx * Math.abs(Math.sin(s.roll));
  const bottom = py + s.y - half;
  const top = py + s.y + half;
  const fill = css(s.colour);
  if (s.kind === 'cylinder') {
    const r = Math.max(s.radius, s.radiusTop);
    if (Math.PI * r * r < MIN_AREA) return null;
    return {
      points: null,
      cx,
      cz,
      r,
      bottom,
      top,
      fill,
      minX: cx - r,
      maxX: cx + r,
      minZ: cz - r,
      maxZ: cz + r,
    };
  }
  if (4 * s.hx * s.hz < MIN_AREA) return null;
  const yaw = s.yaw + pyaw;
  const yc = Math.cos(yaw);
  const ys = Math.sin(yaw);
  const pts: string[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [lx, lz] of [
    [-s.hx, -s.hz],
    [s.hx, -s.hz],
    [s.hx, s.hz],
    [-s.hx, s.hz],
  ] as const) {
    const x = cx + lx * yc + lz * ys;
    const z = cz - lx * ys + lz * yc;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    pts.push(`${x.toFixed(2)},${z.toFixed(2)}`);
  }
  return { points: pts.join(' '), cx, cz, r: 0, bottom, top, fill, minX, maxX, minZ, maxZ };
}

function buildBase(map: CompiledMap): MapBase {
  const t = map.world.terrain;
  const grid = new HeightGrid(t);
  const footprints: Footprint[] = [];
  // On ground raised above y 0 (a ridge, MT-2), heights count from the ground, so a cabin
  // up a hill shows on the ground floor rather than being cut off above it.
  const add = (f: Footprint | null): void => {
    if (!f) return;
    const lift = Math.max(0, grid.heightAt((f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2));
    f.bottom -= lift;
    f.top -= lift;
    footprints.push(f);
  };
  for (const s of map.shapes) add(footprint(s, 0, 0, 0, 0));
  for (const group of map.instanced) {
    for (const p of group.placements) {
      for (const s of group.shapes) add(footprint(s, p.x, p.y, p.z, p.yaw));
    }
  }
  footprints.sort((a, b) => a.top - b.top);
  // Cells whose middle is under water, merged along each row.
  const water: MapBase['water'] = [];
  if (map.water.length) {
    const corner = (i: number, j: number): number => t.heights[j * (t.cols + 1) + i]!;
    for (let j = 0; j < t.rows; j++) {
      let start = -1;
      for (let i = 0; i <= t.cols; i++) {
        const wet =
          i < t.cols &&
          (corner(i, j) + corner(i + 1, j) + corner(i, j + 1) + corner(i + 1, j + 1)) / 4 <
            waterLevelAt(
              map.water,
              t.minX + (i + 0.5) * t.cellSize,
              t.minZ + (j + 0.5) * t.cellSize,
            );
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
  const ground = { x: t.minX, z: t.minZ, w: t.cols * t.cellSize, h: t.rows * t.cellSize };
  return {
    ground,
    frame: frameOf(map, footprints, ground),
    groundColour: css(map.terrainColour),
    water,
    waterColour: css(map.water[0]?.colour ?? 0x3a6ea5),
    footprints,
  };
}

/**
 * What's worth showing: everything built, every marker and zone, with a margin, kept inside
 * the terrain. All of the terrain if there's nothing.
 */
function frameOf(map: CompiledMap, footprints: readonly Footprint[], ground: Frame): Frame {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const take = (x0: number, x1: number, z0: number, z1: number): void => {
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minZ = Math.min(minZ, z0);
    maxZ = Math.max(maxZ, z1);
  };
  for (const f of footprints) take(f.minX, f.maxX, f.minZ, f.maxZ);
  for (const m of map.markers) take(m.x, m.x, m.z, m.z);
  for (const zone of map.zones) for (const [x, z] of zone.points) take(x, x, z, z);
  if (minX > maxX) return ground;
  const x0 = Math.max(ground.x, minX - FRAME_MARGIN);
  const z0 = Math.max(ground.z, minZ - FRAME_MARGIN);
  const x1 = Math.min(ground.x + ground.w, maxX + FRAME_MARGIN);
  const z1 = Math.min(ground.z + ground.h, maxZ + FRAME_MARGIN);
  return x1 > x0 && z1 > z0 ? { x: x0, z: z0, w: x1 - x0, h: z1 - z0 } : ground;
}

/**
 * A floor's footprints: whatever starts under its cut, each drawn up to the cut at most
 * (so a wall rising through it shows, and the slab of the floor above doesn't). Those
 * topping out well under the floor are apart, to be dimmed. -1 is everything, from above.
 */
function floorLayers(base: MapBase, floors: CompiledMap['floors'], index: number): FloorLayers {
  const floor = index >= 0 ? floors?.[index] : undefined;
  if (!floor) return { below: [], on: base.footprints };
  const cut = floor.y + CUT_ABOVE;
  const shown = base.footprints
    .filter((f) => f.bottom < cut)
    .sort((a, b) => Math.min(a.top, cut) - Math.min(b.top, cut));
  // The lowest floor has nothing under it to dim.
  const low = index > 0 ? floor.y - BELOW : -Infinity;
  return {
    below: shown.filter((f) => f.top <= low),
    on: shown.filter((f) => f.top > low),
  };
}

function layersOf(map: CompiledMap, index: number): { base: MapBase; layers: FloorLayers } {
  let c = cache.get(map);
  if (!c) {
    c = { base: buildBase(map), floors: new Map() };
    cache.set(map, c);
  }
  let layers = c.floors.get(index);
  if (!layers) {
    layers = floorLayers(c.base, map.floors, index);
    c.floors.set(index, layers);
  }
  return { base: c.base, layers };
}

/**
 * A map's drawing for one floor, framed on what's built (shared with the menu's overview,
 * 2026-11-09). minX, minZ, w and h are the frame.
 */
export interface MapLayers {
  minX: number;
  minZ: number;
  w: number;
  h: number;
  base: MapBase;
  layers: FloorLayers;
}

/** A floor's drawing: by default the lowest floor, or from above for a map without floors. */
export function mapLayers(map: CompiledMap, floor = map.floors?.length ? 0 : -1): MapLayers {
  const { base, layers } = layersOf(map, floor);
  const f = base.frame;
  return { minX: f.x, minZ: f.z, w: f.w, h: f.h, base, layers };
}

/** The ground, water and footprints, drawn in map metres; what's below the floor dimmed. */
export function MapGround({ layers: drawn }: { layers: MapLayers }): ReactNode {
  const { base, layers } = drawn;
  const shape = (f: Footprint, i: number): ReactNode =>
    f.points ? (
      <polygon key={i} points={f.points} fill={f.fill} />
    ) : (
      <circle key={i} cx={f.cx} cy={f.cz} r={f.r} fill={f.fill} />
    );
  const g = base.ground;
  return (
    <g>
      <rect x={g.x} y={g.z} width={g.w} height={g.h} fill={base.groundColour} />
      {base.water.map(([x, z, w, h], i) => (
        <rect key={i} x={x} y={z} width={w + 0.05} height={h + 0.05} fill={base.waterColour} />
      ))}
      {layers.below.length > 0 && (
        <>
          {layers.below.map(shape)}
          <rect x={g.x} y={g.z} width={g.w} height={g.h} fill="rgb(0 0 0 / 0.45)" />
        </>
      )}
      {layers.on.map(shape)}
    </g>
  );
}

/**
 * The floor a height is on: the highest whose floor is at most ON_FLOOR over it; the lowest
 * if it's under them all. -1 for a map without floors.
 */
export function floorAt(floors: CompiledMap['floors'], y: number): number {
  if (!floors?.length) return -1;
  let at = 0;
  floors.forEach((f, i) => {
    if (f.y <= y + ON_FLOOR) at = i;
  });
  return at;
}

type Label = { x: number; z: number; text: string; big: boolean; key: string };

/**
 * Where names go, biggest first (areas, then zones by size, then places), leaving out one
 * that would run into one already placed (zoomed in, they part and both show). Widths are
 * guessed from the number of letters.
 */
export function placeLabels(labels: readonly Label[], font: number): Label[] {
  const out: Label[] = [];
  const placed: [number, number, number, number][] = [];
  for (const l of labels) {
    const size = l.big ? font * 1.35 : font;
    const hw = l.text.length * size * 0.3;
    const hh = size * 0.6;
    if (
      placed.some(
        ([px, pz, pw, ph]) => Math.abs(px - l.x) < pw + hw && Math.abs(pz - l.z) < ph + hh,
      )
    ) {
      continue;
    }
    placed.push([l.x, l.z, hw, hh]);
    out.push(l);
  }
  return out;
}

const zoneArea = (zone: MapZone): number => {
  const xs = zone.points.map((p) => p[0]);
  const zs = zone.points.map((p) => p[1]);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
};

/**
 * Where each named zone's name goes (for the menu's overview): its middle, biggest zones
 * first, leaving out one that would run into one already placed.
 */
export function zoneLabels(map: CompiledMap, font: number): [number, number, MapZone][] {
  const byId = new Map(map.zones.map((z) => [`z-${z.id}`, z]));
  return placeLabels(
    labelsOn(map, NaN).filter((l) => byId.has(l.key)),
    font,
  ).map((l) => [l.x, l.z, byId.get(l.key)!]);
}

type MapLabel = Extract<CompiledMarker, { type: 'mapLabel' }>;

/** The names on a floor: map labels on it (areas first), and named zones, biggest first. */
function labelsOn(map: CompiledMap, floor: number): Label[] {
  const marks = map.markers.filter(
    (m): m is MapLabel => m.type === 'mapLabel' && floorAt(map.floors, m.y) === floor,
  );
  const mark = (m: MapLabel): Label => ({
    x: m.x,
    z: m.z,
    text: m.text,
    big: m.size === 'area',
    key: `l-${m.id}`,
  });
  const zones = map.zones
    .filter((z) => !z.extraction)
    .sort((a, b) => zoneArea(b) - zoneArea(a))
    .map((zone): Label => {
      const n = zone.points.length;
      return {
        x: zone.points.reduce((a, p) => a + p[0], 0) / n,
        z: zone.points.reduce((a, p) => a + p[1], 0) / n,
        text: zone.name,
        big: false,
        key: `z-${zone.id}`,
      };
    });
  return [
    ...marks.filter((m) => m.size === 'area').map(mark),
    ...zones,
    ...marks.filter((m) => m.size !== 'area').map(mark),
  ];
}

interface Props {
  map: CompiledMap;
  sim: SimState;
  player: Character;
  /** Bumped on each redraw, so your arrow moves. */
  version: number;
}

const EXTRACT = '#9dffb0';

export function MapTab({ map, sim, player }: Props): ReactNode {
  const floors = map.floors;
  const [floor, setFloor] = useState(() => floorAt(floors, player.y));
  const drawn = useMemo(() => mapLayers(map, floor), [map, floor]);
  const base = drawn.base;
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
    : base.frame;
  // Metres per screen pixel, so labels and lines stay the same size at either zoom.
  const k = Math.max(view.w / size.w, view.h / size.h);

  // The static layers don't depend on the zoom, so React skips them on a redraw.
  const ground = useMemo(() => <MapGround layers={drawn} />, [drawn]);

  const font = 11 * k;
  const label = (l: Label, fill: string, dim = false): ReactNode => {
    // Kept inside the view, so a long name by the edge isn't cut off.
    const hw = Math.min(l.text.length * (l.big ? font * 1.35 : font) * 0.3, view.w / 2);
    const x = Math.min(view.x + view.w - hw, Math.max(view.x + hw, l.x));
    return (
      <text
        key={l.key}
        x={x}
        y={l.z}
        fontSize={l.big ? font * 1.35 : font}
        fontWeight={l.big ? 700 : 600}
        fill={fill}
        opacity={dim ? 0.55 : 1}
        stroke="rgb(0 0 0 / 0.7)"
        strokeWidth={3 * k}
        paintOrder="stroke"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {l.text}
      </text>
    );
  };
  /** ↑ or ↓ for something on another floor than the one shown, else nothing. */
  const away = (y: number): string => {
    const at = floorAt(floors, y);
    return at === floor ? '' : at > floor ? ' ↑' : ' ↓';
  };

  // Yours: those your spawn allows (sim/raid.ts extractionsOf).
  const extractions = extractionsOf(sim, player);
  const arrow = 9 * k;
  const playerAway = away(player.y) !== '';

  return (
    <div className="raid-map">
      <svg
        ref={svgRef}
        className="raid-map-svg"
        viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {ground}
        {map.zones
          .filter((zone) => !zone.extraction)
          .map((zone) => (
            <polygon
              key={zone.id}
              points={zone.points.map(([x, z]) => `${x},${z}`).join(' ')}
              fill="rgb(255 255 255 / 0.07)"
              stroke="rgb(255 255 255 / 0.55)"
              strokeWidth={1.5 * k}
              strokeDasharray={`${5 * k} ${4 * k}`}
            />
          ))}
        {placeLabels(labelsOn(map, floor), font).map((l) => label(l, '#f2efe6'))}
        {extractions.map((p) => {
          const dim = away(p.y) !== '';
          return (
            <g key={p.id} opacity={dim ? 0.5 : 1}>
              <polygon
                points={p.points.map(([x, z]) => `${x},${z}`).join(' ')}
                fill="rgb(157 255 176 / 0.35)"
                stroke={EXTRACT}
                strokeWidth={2 * k}
                strokeDasharray={dim ? `${4 * k} ${3 * k}` : undefined}
              />
              {/* A way-out sign: a door with an arrow leaving it. */}
              <g transform={`translate(${p.x} ${p.z}) scale(${k})`}>
                <circle r={8} fill="#1d5e2c" stroke={EXTRACT} strokeWidth={1.5} />
                <path
                  d="M -4 -4.5 L -4 4.5 M -1.5 0 L 4.5 0 M 2 -2.5 L 4.5 0 L 2 2.5"
                  fill="none"
                  stroke="#fff"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          );
        })}
        {extractions.map((p) =>
          label(
            {
              x: p.x,
              z: northOf(p) - font,
              text: p.name + away(p.y),
              big: false,
              key: `e-${p.id}`,
            },
            '#b9ffca',
            away(p.y) !== '',
          ),
        )}
        <g
          transform={`translate(${player.x} ${player.z}) rotate(${(-player.yaw * 180) / Math.PI})`}
          opacity={playerAway ? 0.5 : 1}
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
        {floors && floors.length > 1 && (
          <div className="raid-map-floors">
            {[...floors.keys()].reverse().map((i) => (
              <button
                key={i}
                className={i === floor ? 'on' : undefined}
                onClick={() => setFloor(i)}
              >
                {floors[i]!.name}
                {i === floorAt(floors, player.y) && ' •'}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setNear(!near)}>{near ? 'Whole map' : 'Near me'}</button>
      </div>
    </div>
  );
}

/** The northern edge (least z) of an extraction's outline, to put its name above it. */
export function northOf(p: { points: readonly (readonly [number, number])[] }): number {
  let z = Infinity;
  for (const pt of p.points) z = Math.min(z, pt[1]);
  return z;
}
