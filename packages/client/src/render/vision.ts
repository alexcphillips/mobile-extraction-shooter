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

/** How many cracks a fully worn visor has (GZ-5). */
const MOST_CRACKS = 14;

/**
 * A visor's cracks (GZ-5): more as it wears (wear 0 none, 1 broken), each a jagged line in
 * from where a round struck, laid out by its seed so a visor keeps its own. Drawn as a CSS
 * background over the view; '' with none.
 */
export function crackBackground(seed: number, wear: number): string {
  const n = Math.round(Math.max(0, Math.min(1, wear)) * MOST_CRACKS);
  if (n === 0) return '';
  const rnd = seeded(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    // Strike points stay away from the middle of the view, branches run outwards.
    let x = 10 + rnd() * 80;
    let y = 10 + rnd() * 80;
    d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const a = a0 + (rnd() - 0.5) * 1.4;
      const len = 3 + rnd() * 7;
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${d}' fill='none' stroke='rgb(235,240,245)' stroke-opacity='0.55' stroke-width='0.35' vector-effect='non-scaling-stroke'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") center / 100% 100% no-repeat`;
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
