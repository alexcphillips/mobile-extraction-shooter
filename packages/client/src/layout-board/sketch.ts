import {
  LAYOUT_SPEEDS,
  areaFloor,
  entranceEnds,
  heightAt,
  rectCorners,
  type LayoutArea,
  type LayoutDef,
} from '@mes/shared';

/*
 * A layout drawn as SVG (MK-3, 2026-11-12): the board draws it on every change, and
 * scripts/layout-sketch.mjs wraps it in a page for a review, so the sketch and the board
 * can't disagree. A plain string with no DOM, so node can run it. Map coordinates as is
 * (x right, z down: north up, as the map tab draws it). Colors are CSS classes and
 * variables (sketch.css on the board, the sketch page's own), except each poi's color.
 */

export interface SketchOptions {
  /** Screen pixels per meter, to keep text and strokes a steady size. Default fits 900 px. */
  scale?: number;
  /** Ground shading cell in meters (0 leaves it out). Default 5. */
  cell?: number;
  /** Walking-time rings round this point (3.5 and 6 m/s at 10, 20 and 30 s). */
  rings?: { x: number; z: number } | null;
  /** The selected piece's id, drawn highlighted. */
  selected?: string | undefined;
  /** Leave the ground out (the board draws it once, apart, as it changes less). */
  noGround?: boolean;
  /** Leave the legend, scale bar and north arrow out. */
  noFurniture?: boolean;
}

const RING_TIMES = [10, 20, 30];
const MARGIN = 12;

/** The viewBox for a layout: its bounds and a margin, as [x, z, w, h]. */
export function sketchView(l: LayoutDef): [number, number, number, number] {
  const b = l.bounds;
  return [b.x0 - MARGIN, b.z0 - MARGIN, b.x1 - b.x0 + 2 * MARGIN, b.z1 - b.z0 + 2 * MARGIN];
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n = (v: number) => +v.toFixed(2);
const pts = (p: readonly (readonly [number, number])[]) =>
  p.map(([x, z]) => `${n(x)},${n(z)}`).join(' ');

/** The whole sketch as an <svg> element's markup. */
export function layoutSvg(l: LayoutDef, o: SketchOptions = {}): string {
  const view = sketchView(l);
  const scale = o.scale ?? 900 / Math.max(view[2], view[3]);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="layout-sketch" viewBox="${view.join(' ')}" ` +
      `style="--px:${n(1 / scale)}px">`,
  ];
  if (!o.noGround) out.push(groundSvg(l, o.cell ?? 5));
  out.push(layoutBody(l, scale, o));
  if (!o.noFurniture) out.push(furniture(l, scale));
  out.push('</svg>');
  return out.join('\n');
}

/** The ground shaded by height and the 10 and 50 m grid, as a <g>. */
export function groundSvg(l: LayoutDef, cell: number): string {
  const b = l.bounds;
  const out = ['<g class="ground">'];
  out.push(
    `<rect class="ground-base" x="${b.x0}" y="${b.z0}" width="${b.x1 - b.x0}" height="${b.z1 - b.z0}"/>`,
  );
  if (cell > 0) {
    const heights: number[] = [];
    const cells: [number, number, number][] = [];
    for (let z = b.z0; z < b.z1; z += cell)
      for (let x = b.x0; x < b.x1; x += cell) {
        const y = heightAt(l, x + cell / 2, z + cell / 2);
        heights.push(y);
        cells.push([x, z, y]);
      }
    const lo = Math.min(...heights);
    const span = Math.max(...heights) - lo;
    if (span > 0.01)
      for (const [x, z, y] of cells) {
        const t = (y - lo) / span;
        if (t < 0.02) continue;
        out.push(
          `<rect x="${n(x)}" y="${n(z)}" width="${cell + 0.05}" height="${cell + 0.05}" ` +
            `class="height" fill-opacity="${n(0.08 + 0.5 * t)}"/>`,
        );
      }
  }
  for (const step of [10, 50]) {
    const d: string[] = [];
    for (let x = Math.ceil(b.x0 / step) * step; x <= b.x1; x += step)
      d.push(`M${x} ${b.z0}V${b.z1}`);
    for (let z = Math.ceil(b.z0 / step) * step; z <= b.z1; z += step)
      d.push(`M${b.x0} ${z}H${b.x1}`);
    out.push(`<path class="grid grid-${step}" d="${d.join('')}"/>`);
  }
  out.push('</g>');
  return out.join('\n');
}

/** Everything but the ground and furniture: pads, roads, zones, areas, landmarks, rings. */
export function layoutBody(l: LayoutDef, scale: number, o: SketchOptions = {}): string {
  const px = 1 / scale;
  const font = 11 * px;
  const out: string[] = [];
  const sel = (id: string) => (o.selected === id ? ' selected' : '');
  const label = (x: number, z: number, lines: string[], cls = '') =>
    `<text class="label${cls}" x="${n(x)}" y="${n(z)}" font-size="${n(font)}">` +
    lines
      .map(
        (t, i) =>
          `<tspan x="${n(x)}" dy="${i ? n(font * 1.15) : n(-((lines.length - 1) * font * 1.15) / 2 + font * 0.35)}">${esc(t)}</tspan>`,
      )
      .join('') +
    '</text>';

  out.push('<g class="pads">');
  for (const p of l.pads) {
    const c = rectCorners(p);
    out.push(
      `<polygon class="pad ${p.edge}${sel(p.id)}" data-kind="pads" data-id="${p.id}" points="${pts(c)}"/>`,
    );
    const top = c.reduce((a, b) => (b[1] < a[1] ? b : a));
    out.push(label(top[0], top[1] - font, [`${p.name ?? p.id} · ${n(p.y)} m`], ' pad-label'));
  }
  out.push('</g><g class="roads">');
  for (const r of l.roads)
    out.push(
      `<polyline class="road ${r.kind}${sel(r.id)}" data-kind="roads" data-id="${r.id}" ` +
        `points="${pts(r.points)}" stroke-width="${r.width}"/>`,
    );
  out.push('</g><g class="zones">');
  for (const zn of l.zones) {
    out.push(
      `<polygon class="zone${sel(zn.id)}" data-kind="zones" data-id="${zn.id}" points="${pts(zn.points)}"/>`,
    );
    const [x, z] = zn.points.reduce(
      (a, p) => [a[0] + p[0] / zn.points.length, a[1] + p[1] / zn.points.length],
      [0, 0],
    );
    out.push(label(x, z, [zn.name ?? zn.id], ' zone-label'));
  }
  out.push('</g><g class="areas">');
  for (const a of l.areas) out.push(areaSvg(l, a, font, sel(a.id)));
  out.push('</g><g class="landmarks">');
  for (const m of l.landmarks) {
    out.push(
      `<polygon class="landmark${sel(m.id)}" data-kind="landmarks" data-id="${m.id}" points="${pts(rectCorners(m))}"/>`,
    );
    out.push(
      label(
        m.x,
        m.z - Math.max(m.w, m.d) / 2 - font,
        [`▲ ${m.name ?? m.id} · ${m.height} m`],
        ' landmark-label',
      ),
    );
  }
  out.push('</g>');
  if (o.rings) out.push(ringsSvg(o.rings, font));
  return out.join('\n');

  function areaSvg(lay: LayoutDef, a: LayoutArea, f: number, s: string): string {
    const color = a.color ?? (a.poi && lay.pois[a.poi]?.color) ?? '#8a8f98';
    const parts = [
      `<g class="area ${a.tier}${s}" data-kind="areas" data-id="${a.id}">`,
      `<polygon points="${pts(rectCorners(a))}" style="--poi:${color}"/>`,
    ];
    for (const e of a.entrances) {
      const { from, to, out: d } = entranceEnds(a, e);
      const mx = (from[0] + to[0]) / 2;
      const mz = (from[1] + to[1]) / 2;
      const k = 2.2 * f;
      parts.push(
        `<line class="entrance${e.floor ? ' upper' : ''}" x1="${n(from[0])}" y1="${n(from[1])}" x2="${n(to[0])}" y2="${n(to[1])}"/>`,
        `<path class="entrance-arrow" d="M${n(mx + d[0] * k)} ${n(mz + d[1] * k)}L${n(mx)} ${n(mz)}"/>`,
      );
      if (e.floor)
        parts.push(
          label(mx + d[0] * k * 1.6, mz + d[1] * k * 1.6, [`F${e.floor}`], ' floor-label'),
        );
    }
    const floor = areaFloor(lay, a);
    const h = a.floors ? `${a.floors}F · ${n(floor)} m` : `open · ${n(floor)} m`;
    parts.push(label(a.x, a.z, [a.name ?? a.id, `${n(a.w)}×${n(a.d)} · ${h}`], ' area-label'));
    parts.push('</g>');
    return parts.join('');
  }
}

function ringsSvg(c: { x: number; z: number }, font: number): string {
  const out = ['<g class="rings">'];
  for (const t of RING_TIMES) {
    const w = LAYOUT_SPEEDS.walk * t;
    const s = LAYOUT_SPEEDS.sprint * t;
    out.push(
      `<circle class="ring walk" cx="${n(c.x)}" cy="${n(c.z)}" r="${n(w)}"/>`,
      `<circle class="ring sprint" cx="${n(c.x)}" cy="${n(c.z)}" r="${n(s)}"/>`,
      `<text class="label ring-label" x="${n(c.x + w * 0.7071)}" y="${n(c.z - w * 0.7071)}" font-size="${n(font)}">${t}s walk</text>`,
      `<text class="label ring-label sprint" x="${n(c.x)}" y="${n(c.z - s - font * 0.4)}" font-size="${n(font)}">${t}s sprint</text>`,
    );
  }
  out.push(
    `<circle class="ring-center" cx="${n(c.x)}" cy="${n(c.z)}" r="${n(font * 0.4)}"/>`,
    '</g>',
  );
  return out.join('');
}

/** The legend, scale bar and north arrow, sized to the screen. */
function furniture(l: LayoutDef, scale: number): string {
  const px = 1 / scale;
  const font = 11 * px;
  const b = l.bounds;
  const out = ['<g class="furniture">'];
  // A scale bar a round length near 120 px long.
  const want = 120 * px;
  const bar = [5, 10, 20, 25, 50, 100, 200].reduce((a, v) =>
    Math.abs(v - want) < Math.abs(a - want) ? v : a,
  );
  const x0 = b.x0 + 4 * font;
  const z0 = b.z1 - 2 * font;
  out.push(
    `<rect class="scale-bg" x="${n(x0 - font)}" y="${n(z0 - 2.4 * font)}" width="${n(bar + 2 * font)}" height="${n(3.4 * font)}"/>`,
    `<path class="scale" d="M${n(x0)} ${n(z0 - font * 0.6)}V${n(z0)}H${n(x0 + bar)}V${n(z0 - font * 0.6)}"/>`,
    `<text class="label" x="${n(x0 + bar / 2)}" y="${n(z0 - font)}" font-size="${n(font)}">${bar} m</text>`,
  );
  const nx = b.x1 - 3 * font;
  const nz = b.z0 + 3 * font;
  out.push(
    `<path class="north" d="M${n(nx)} ${n(nz - 1.6 * font)}L${n(nx + 0.6 * font)} ${n(nz)}H${n(nx - 0.6 * font)}Z"/>`,
    `<text class="label" x="${n(nx)}" y="${n(nz + 1.2 * font)}" font-size="${n(font)}">N</text>`,
  );
  const pois = Object.entries(l.pois);
  pois.forEach(([id, p], i) => {
    const y = b.z0 + (2 + i * 1.5) * font;
    out.push(
      `<rect class="legend-swatch" x="${n(b.x0 + 2 * font)}" y="${n(y - font * 0.5)}" width="${n(font)}" height="${n(font)}" fill="${p.color}"/>`,
      `<text class="label legend" x="${n(b.x0 + 3.5 * font)}" y="${n(y + font * 0.35)}" font-size="${n(font)}" data-poi="${id}">${esc(p.name)}</text>`,
    );
  });
  out.push('</g>');
  return out.join('\n');
}

/**
 * The sketch's styles, light and dark, as CSS: the board's page and the review page both
 * use it, so they look alike.
 */
export const SKETCH_CSS = `
.layout-sketch { --ink:#1d2430; --muted:#5d6675; --paper:#f4f1ea; --ground:#7a5a2e; --grid:#1d243018;
  --road:#6f7680; --service:#9aa0a8; --path:#b08a55; --zone:#3a6ea8; --pad:#1d243060; --wall:#1d2430;
  --entrance:#d2462e; --upper:#c78a12; --landmark:#1d2430; --walk:#2e7d4f; --sprint:#b0452c; --select:#0a84ff;
  background: var(--paper); font-family: system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .layout-sketch { --ink:#e6e8ec; --muted:#9aa3b0;
  --paper:#16191e; --ground:#d9b77a; --grid:#e6e8ec14; --road:#5b616a; --service:#454a52; --path:#8a6c44; --zone:#6aa0dc;
  --pad:#e6e8ec50; --wall:#e6e8ec; --landmark:#e6e8ec; --walk:#5cc28a; --sprint:#e07a5f; } }
:root[data-theme="dark"] .layout-sketch { --ink:#e6e8ec; --muted:#9aa3b0; --paper:#16191e; --ground:#d9b77a;
  --grid:#e6e8ec14; --road:#5b616a; --service:#454a52; --path:#8a6c44; --zone:#6aa0dc; --pad:#e6e8ec50; --wall:#e6e8ec;
  --landmark:#e6e8ec; --walk:#5cc28a; --sprint:#e07a5f; }
.layout-sketch .ground-base { fill: var(--paper); }
.layout-sketch .height { fill: var(--ground); }
.layout-sketch .grid { fill: none; stroke: var(--grid); stroke-width: calc(var(--px) * 1); }
.layout-sketch .grid-50 { stroke-width: calc(var(--px) * 2); }
.layout-sketch .pad { fill: none; stroke: var(--pad); stroke-width: calc(var(--px) * 1.5); stroke-dasharray: calc(var(--px) * 6) calc(var(--px) * 4); }
.layout-sketch .pad.wall { stroke: var(--wall); stroke-width: calc(var(--px) * 3); stroke-dasharray: none; }
.layout-sketch .road { fill: none; stroke: var(--road); stroke-linecap: round; stroke-linejoin: round; opacity: .85; }
.layout-sketch .road.service { stroke: var(--service); }
.layout-sketch .road.path { stroke: var(--path); }
.layout-sketch .zone { fill: var(--zone); fill-opacity: .06; stroke: var(--zone); stroke-width: calc(var(--px) * 1.5); stroke-dasharray: calc(var(--px) * 3) calc(var(--px) * 3); }
.layout-sketch .area polygon { fill: var(--poi); fill-opacity: .8; stroke: var(--ink); stroke-width: calc(var(--px) * 1.5); }
.layout-sketch .area.partial polygon { fill-opacity: .45; }
.layout-sketch .area.facade polygon { fill-opacity: .12; stroke-dasharray: calc(var(--px) * 4) calc(var(--px) * 3); }
.layout-sketch .entrance { stroke: var(--entrance); stroke-width: calc(var(--px) * 5); stroke-linecap: butt; }
.layout-sketch .entrance.upper { stroke: var(--upper); }
.layout-sketch .entrance-arrow { stroke: var(--entrance); stroke-width: calc(var(--px) * 1.5); fill: none; }
.layout-sketch .landmark { fill: var(--landmark); fill-opacity: .85; stroke: var(--landmark); stroke-width: calc(var(--px) * 1); }
.layout-sketch .label { fill: var(--ink); text-anchor: middle; paint-order: stroke; stroke: var(--paper); stroke-width: calc(var(--px) * 3); stroke-linejoin: round; pointer-events: none; }
.layout-sketch .area-label tspan:first-child { font-weight: 600; }
.layout-sketch .pad-label, .layout-sketch .floor-label { fill: var(--muted); }
.layout-sketch .zone-label { fill: var(--zone); font-style: italic; }
.layout-sketch .landmark-label { font-weight: 600; }
.layout-sketch .legend { text-anchor: start; }
.layout-sketch .ring { fill: none; stroke-width: calc(var(--px) * 1.5); pointer-events: none; }
.layout-sketch .ring.walk { stroke: var(--walk); }
.layout-sketch .ring.sprint { stroke: var(--sprint); stroke-dasharray: calc(var(--px) * 8) calc(var(--px) * 5); }
.layout-sketch .ring-label { fill: var(--walk); }
.layout-sketch .ring-label.sprint { fill: var(--sprint); }
.layout-sketch .ring-center { fill: var(--ink); pointer-events: none; }
.layout-sketch .scale-bg { fill: var(--paper); fill-opacity: .85; }
.layout-sketch .scale, .layout-sketch .north { stroke: var(--ink); stroke-width: calc(var(--px) * 2); fill: none; }
.layout-sketch .north { fill: var(--ink); }
.layout-sketch .selected polygon, .layout-sketch polygon.selected, .layout-sketch polyline.selected { stroke: var(--select); stroke-width: calc(var(--px) * 3); stroke-dasharray: none; }
.layout-sketch polyline.road.selected { stroke: var(--select); opacity: .6; }
`;
