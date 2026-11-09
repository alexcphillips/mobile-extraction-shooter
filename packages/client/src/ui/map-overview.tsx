import type { CompiledMap } from '@mes/shared';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadMap } from '../content';
import { MapGround, mapLayers, northOf, zoneLabels } from './map-tab';

/*
 * A map seen from above for the menu's deploy screen (2026-11-09): the in-raid map tab's
 * drawing (footprints, water, named zones) with every extraction on it. Those open in
 * every raid are solid green; the ones only some raids open are dashed amber.
 */

/** Maps compiled for the overview, kept for the page's life (a few, compiled once each). */
const compiled = new Map<string, CompiledMap>();

/** A map, compiled the first time it's asked for (Northpoint takes about 40 ms on a Mac). */
export function overviewMap(id: string): CompiledMap | null {
  let map = compiled.get(id);
  if (!map) {
    try {
      map = loadMap(id);
    } catch (err) {
      console.error(`map overview: ${id}`, err);
      return null;
    }
    compiled.set(id, map);
  }
  return map;
}

/** What the overview's side says about a map. */
export interface MapFacts {
  /** Metres across, x by z. */
  size: [number, number];
  /** Extractions open in every raid. */
  fixed: number;
  /** Extractions some raids open, and how many each raid does. */
  rotating: number;
  rotatingOpen: number;
  /** PMC squads at the start, as a range, or null for none. */
  pmcs: [number, number] | null;
}

export function mapFacts(map: CompiledMap): MapFacts {
  const t = map.world.terrain;
  const ex = map.zones.filter((z) => z.extraction);
  const rotating = ex.filter((z) => z.extraction?.rotating).length;
  return {
    size: [Math.round(t.cols * t.cellSize), Math.round(t.rows * t.cellSize)],
    fixed: ex.length - rotating,
    rotating,
    rotatingOpen: Math.min(rotating, map.rotatingExtractions ?? 0),
    pmcs: map.pmcs ? map.pmcs.count : null,
  };
}

export function MapOverview({ map }: { map: CompiledMap }): ReactNode {
  const layers = useMemo(() => mapLayers(map), [map]);
  const ground = useMemo(() => <MapGround layers={layers} />, [layers]);
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
  // A little margin round the map, so edge extractions' names aren't cut off.
  const pad = Math.max(layers.w, layers.h) * 0.04;
  const view = {
    x: layers.minX - pad,
    z: layers.minZ - pad,
    w: layers.w + 2 * pad,
    h: layers.h + 2 * pad,
  };
  // Metres per screen pixel, so labels and lines are the same size on any screen.
  const k = Math.max(view.w / size.w, view.h / size.h);
  const font = 10 * k;
  const label = (x: number, z: number, text: string, fill: string, key: string): ReactNode => (
    <text
      key={key}
      x={x}
      y={z}
      fontSize={font}
      fontWeight={600}
      fill={fill}
      stroke="rgb(0 0 0 / 0.75)"
      strokeWidth={3 * k}
      paintOrder="stroke"
      textAnchor="middle"
      dominantBaseline="middle"
    >
      {text}
    </text>
  );
  const extractions = map.zones.filter((z) => z.extraction);
  return (
    <svg
      ref={svgRef}
      className="map-overview"
      viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${map.name} from above`}
    >
      {ground}
      {map.zones
        .filter((zone) => !zone.extraction)
        .map((zone) => (
          <polygon
            key={zone.id}
            points={zone.points.map(([x, z]) => `${x},${z}`).join(' ')}
            fill="rgb(255 255 255 / 0.06)"
            stroke="rgb(255 255 255 / 0.45)"
            strokeWidth={1.2 * k}
            strokeDasharray={`${4 * k} ${4 * k}`}
          />
        ))}
      {zoneLabels(map, font).map(([x, z, zone]) =>
        label(x, z, zone.name, '#f2efe6', `z-${zone.id}`),
      )}
      {extractions.map((p) => {
        const maybe = !!p.extraction?.rotating;
        return (
          <polygon
            key={p.id}
            points={p.points.map(([x, z]) => `${x},${z}`).join(' ')}
            fill={maybe ? 'rgb(227 163 58 / 0.18)' : 'rgb(157 255 176 / 0.2)'}
            stroke={maybe ? '#e3a33a' : '#9dffb0'}
            strokeWidth={2 * k}
            strokeDasharray={maybe ? `${5 * k} ${3 * k}` : undefined}
          />
        );
      })}
      {extractions.map((p) => {
        const n = p.points.length;
        const x = p.points.reduce((a, q) => a + q[0], 0) / n;
        return label(
          x,
          northOf(p) - font,
          p.name,
          p.extraction?.rotating ? '#f3c472' : '#b9ffca',
          `e-${p.id}`,
        );
      })}
    </svg>
  );
}
