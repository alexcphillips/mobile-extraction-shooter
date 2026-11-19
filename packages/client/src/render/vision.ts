import type { NightVisionDef, VisionShape } from '@mes/shared';

/*
 * What a helmet takes of the view (GZ-2, 2026-11-12): drawn over the screen as one
 * element, never a narrower field of view (too costly on a phone). A soft vignette is the
 * element's CSS (--vignette); a hard shape is one of these SVGs, stretched to the screen.
 */

/** Each hard shape: dark where the helmet is, with its holes cut out (even-odd). */
const SHAPES: Record<VisionShape, string> = {
  // An angular T-shaped visor slit: a band across the eyes, a stem below the nose.
  slit: "<path fill='rgb(5,5,5)' fill-opacity='0.94' fill-rule='evenodd' d='M0 0H100V100H0Z M3 24H97V54H62V88H38V54H3Z'/>",
  // Cheek guards closing in at the bottom corners.
  cheeks:
    "<path fill='rgb(5,5,5)' fill-opacity='0.92' d='M0 100V58Q10 78 26 100Z M100 100V58Q90 78 74 100Z'/>",
};

/** A shape as a CSS background, stretched over the element; '' for none. */
export function visionBackground(shape: VisionShape | undefined): string {
  if (!shape) return '';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>${SHAPES[shape]}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") center / 100% 100% no-repeat`;
}

/** A small seeded random number generator (mulberry32), for a visor's cracks. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The steps a visor's cracks are drawn at, none to broken (GZ-5): the view is redrawn only
 * when wear crosses one, so it's rarely.
 */
export const CRACK_STEPS = 14;
/** The most impacts a broken visor shows. */
const MOST_IMPACTS = 5;
/** The view box: 16:9, sliced to fill any screen so impacts stay round. Units: 100 = height. */
const VW = 178;
const VH = 100;

const f = (n: number): string => n.toFixed(2);

type Pt = { x: number; y: number };
const seg = (pts: readonly Pt[]): string =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('');

/**
 * One impact (2026-11-18, the user's ask: the first cracks read as hairs on the screen, the
 * next as stars): a crushed, milky patch with a dark pit where the round struck; concentric
 * rings round it, which are what reads as struck glass; and a few uneven radial cracks, some
 * long and kinked, some short. Lines are drawn twice, a dark one under a pale gray one offset
 * a little, so they read as fractures with depth. `size` grows it as the visor wears.
 */
function impact(
  rnd: () => number,
  x: number,
  y: number,
  size: number,
): { svg: string; ends: Pt[] } {
  const lines: { d: string; w: number }[] = [];
  // Radial cracks: few, at uneven angles, of very different lengths.
  const count = 6 + Math.floor(rnd() * 4);
  const angles = Array.from({ length: count }, () => rnd() * Math.PI * 2).sort((a, b) => a - b);
  const ends: Pt[] = [];
  const spokes: Pt[][] = [];
  for (const a0 of angles) {
    const long = rnd() < 0.4;
    const reach = (long ? 12 + rnd() * 14 : 3 + rnd() * 6) * size;
    const pts: Pt[] = [{ x, y }];
    let a = a0;
    let p = { x, y };
    const segs = long ? 3 : 2;
    for (let k = 1; k <= segs; k++) {
      // Mostly straight, with an occasional kink.
      if (rnd() < 0.5) a += (rnd() - 0.5) * 0.7;
      const len = (reach / segs) * (0.6 + rnd() * 0.8);
      p = { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len };
      pts.push(p);
    }
    spokes.push(pts);
    if (long) ends.push(p);
    lines.push({ d: seg(pts), w: (long ? 0.32 : 0.22) * Math.min(1.2, size) });
  }
  // Concentric rings: short bowed pieces between neighboring radial cracks, tight round
  // the strike and broken in places, as struck glass shows them (whole polygons read as
  // a drawn spider web).
  const rings = 2 + (size > 0.85 ? 1 : 0);
  for (let r = 1; r <= rings; r++) {
    const radius = (0.9 + r * 1.5) * size * (0.85 + rnd() * 0.3);
    for (let s = 0; s < angles.length; s++) {
      if (rnd() < 0.35) continue;
      const a1 = angles[s]!;
      const a2 = s + 1 < angles.length ? angles[s + 1]! : angles[0]! + Math.PI * 2;
      if (a2 - a1 > 2.2) continue;
      const r1 = radius * (0.85 + rnd() * 0.3);
      const r2 = radius * (0.85 + rnd() * 0.3);
      const am = (a1 + a2) / 2;
      const rm = ((r1 + r2) / 2) * (1.05 + rnd() * 0.15);
      lines.push({
        d: seg([
          { x: x + Math.cos(a1) * r1, y: y + Math.sin(a1) * r1 },
          { x: x + Math.cos(am) * rm, y: y + Math.sin(am) * rm },
          { x: x + Math.cos(a2) * r2, y: y + Math.sin(a2) * r2 },
        ]),
        w: r === 1 ? 0.2 : 0.14,
      });
    }
  }
  // A few short splinters off the long cracks.
  for (const pts of spokes) {
    if (pts.length < 4 || rnd() < 0.5) continue;
    const p = pts[2]!;
    const a =
      Math.atan2(pts[3]!.y - p.y, pts[3]!.x - p.x) + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.5);
    const len = (2 + rnd() * 3) * size;
    lines.push({
      d: seg([p, { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len }]),
      w: 0.12,
    });
  }
  // The crushed patch: a flat, milky, jagged shape, a dark pit in it.
  const crush = (1.8 + rnd() * 0.8) * Math.min(1.3, size);
  const patch: Pt[] = [];
  const n = 8 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = crush * (0.6 + rnd() * 0.7);
    patch.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
  }
  const pit = crush * 0.28;
  const svg =
    `<g fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
    `<g stroke='rgb(8,10,12)' stroke-opacity='0.45' transform='translate(0.16 0.2)'>` +
    lines.map((l) => `<path d='${l.d}' stroke-width='${f(l.w + 0.18)}'/>`).join('') +
    `</g><g stroke='rgb(205,212,218)' stroke-opacity='0.75'>` +
    lines.map((l) => `<path d='${l.d}' stroke-width='${f(l.w)}'/>`).join('') +
    `</g></g>` +
    `<path d='${seg(patch)}Z' fill='rgb(222,227,231)' fill-opacity='0.62' stroke='rgb(235,239,242)' stroke-opacity='0.6' stroke-width='0.12'/>` +
    `<circle cx='${f(x + 0.1)}' cy='${f(y + 0.1)}' r='${f(pit)}' fill='rgb(20,22,24)' fill-opacity='0.55'/>`;
  return { svg, ends };
}

/** A long stress crack running on from a crack's end: a meandering line, fine and pale. */
function runner(rnd: () => number, from: Pt, toward: number, length: number): string {
  const pts: Pt[] = [from];
  let a = toward;
  let p = from;
  const segs = 6;
  for (let k = 0; k < segs; k++) {
    a += (rnd() - 0.5) * 0.6;
    const len = (length / segs) * (0.7 + rnd() * 0.6);
    p = { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len };
    pts.push(p);
  }
  const d = seg(pts);
  return (
    `<path d='${d}' fill='none' stroke='rgb(8,10,12)' stroke-opacity='0.4' stroke-width='0.3' transform='translate(0.16 0.2)' stroke-linejoin='round'/>` +
    `<path d='${d}' fill='none' stroke='rgb(205,212,218)' stroke-opacity='0.65' stroke-width='0.14' stroke-linejoin='round'/>`
  );
}

/**
 * A visor's cracks (GZ-5): impacts that appear and spread as it wears (wear 0 none, 1
 * broken), laid out by its seed so a visor keeps its own, the view going milky near the
 * end. Drawn as a CSS background over the view; '' with none.
 */
export function crackBackground(seed: number, wear: number): string {
  const step = Math.round(Math.max(0, Math.min(1, wear)) * CRACK_STEPS);
  if (step === 0) return '';
  const rnd = seeded(seed);
  // Impacts come in as it wears; each one spreads until the next arrives.
  const per = CRACK_STEPS / MOST_IMPACTS;
  const impacts = Math.min(MOST_IMPACTS, Math.ceil(step / per));
  let body = '';
  for (let i = 0; i < impacts; i++) {
    // Strike points keep out of the middle of the view, where the aim is.
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = 18 + rnd() * (VW - 36);
      y = 14 + rnd() * (VH - 28);
      if (Math.hypot(x - VW / 2, y - VH / 2) > 24) break;
    }
    const grown = Math.min(1, (step - i * per) / per);
    const size = (0.55 + 0.45 * grown) * (0.8 + rnd() * 0.5) * (1 + 0.08 * (impacts - 1 - i));
    const hit = impact(rnd, x, y, size);
    body += hit.svg;
    // Once the visor is well worn, long stress cracks run on from some impacts' longest cracks.
    if (step > CRACK_STEPS * 0.35)
      for (const end of hit.ends.slice(0, step > CRACK_STEPS * 0.7 ? 2 : 1)) {
        const away = Math.atan2(end.y - y, end.x - x);
        body += runner(rnd, end, away, 18 + rnd() * 30);
      }
  }
  // Near broken, the whole visor frosts over.
  const frost = Math.max(0, step - CRACK_STEPS * 0.7) / (CRACK_STEPS * 0.3);
  if (frost > 0)
    body += `<rect width='${VW}' height='${VH}' fill='rgb(225,230,235)' fill-opacity='${f(0.18 * frost)}'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${VW} ${VH}' preserveAspectRatio='xMidYMid slice'>${body}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") center / cover no-repeat`;
}

/** What's drawn over the view: the helmet's, a visor's and its cracks. */
export interface View {
  vignette?: number | undefined;
  shape?: VisionShape | undefined;
  /** A visor's cracks: its seed and how worn it is, 0–1. */
  cracks?: { seed: number; wear: number } | undefined;
}

/** Sets an overlay element to a view: shown with a shape, a vignette or cracks, else hidden. */
export function showVision(el: HTMLElement, view: View | undefined): void {
  const cracks = view?.cracks ? crackBackground(view.cracks.seed, view.cracks.wear) : '';
  const layers = [cracks, visionBackground(view?.shape)].filter(Boolean);
  el.classList.toggle('on', !!(layers.length || view?.vignette));
  el.style.setProperty('--vignette', String(view?.vignette ?? 0));
  // Layers over the CSS vignette (its own background-image, kept last).
  el.style.background = layers.length ? [...layers, 'var(--vignette-image)'].join(', ') : '';
}

/**
 * Night vision (GZ-5) as one overlay over the screen: the tube's dark mask, grain and the
 * tint, blended over the picture (style.css, #nv-view); brightness and softness are set on
 * the canvas and the renderer by the caller. Null hides it.
 */
export function showNightVision(el: HTMLElement, nv: NightVisionDef | null): void {
  el.classList.toggle('on', !!nv);
  if (!nv) return;
  el.style.setProperty('--nv-tint', nv.tint);
  el.style.setProperty('--nv-noise', String(nv.noise));
  el.classList.toggle('dual', nv.shape === 'dual');
}
