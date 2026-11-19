import { SCOPE_RADIUS, type OpticDef, type ReticleShape } from '@mes/shared';

const SVG = 'http://www.w3.org/2000/svg';

/** The camera's vertical field of view in degrees: from the hip, and aimed down irons or a red dot. */
export const FOV = 70;
export const AIM_FOV = 55;
const DEG = Math.PI / 180;

/**
 * Looking through a scope (2026-11-18, the user's call: the whole view zooms, the gun and
 * scope stay in view, no black mask): the eyepiece is brought up until its clear radius
 * fills this much of the screen height (%, from the center), and the reticle fills it.
 */
export const SCOPE_LENS_FILL = 34;

/** How far ahead of the eye a scope's eyepiece sits so its `lens` radius fills `fill` %. */
export function scopeEyeDistance(lens: number, fill = SCOPE_LENS_FILL): number {
  return (lens * 50) / (Math.tan((AIM_FOV / 2) * DEG) * fill);
}

/** The field of view aimed through an optic: a scope's zoom narrows the hip's. */
export function aimedFov(zoom: number): number {
  return zoom > 1 ? (2 * Math.atan(Math.tan((FOV / 2) * DEG) / zoom)) / DEG : AIM_FOV;
}

/** A point on a circle, `deg` clockwise from straight up (reticle units are y down). */
function onCircle(x: number, y: number, r: number, deg: number): string {
  const a = deg * DEG;
  const f = (n: number): string => String(Math.round(n * 1000) / 1000);
  return `${f(x + r * Math.sin(a))} ${f(y - r * Math.cos(a))}`;
}

/** An arc's path: clockwise from `from` to `to`; a full turn is two halves. */
export function arcPath(x: number, y: number, r: number, from: number, to: number): string {
  const sweep = to - from;
  if (sweep >= 360) {
    const mid = from + 180;
    return `M${onCircle(x, y, r, from)}A${r} ${r} 0 0 1 ${onCircle(x, y, r, mid)}A${r} ${r} 0 0 1 ${onCircle(x, y, r, from)}`;
  }
  return `M${onCircle(x, y, r, from)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${onCircle(x, y, r, to)}`;
}

function shapeSvg(s: ReticleShape): string {
  // A shape's own color, else the reticle's from the group around it.
  const fill = s.color ? ` fill="${s.color}"` : '';
  const stroke = s.color ? ` stroke="${s.color}"` : '';
  switch (s.type) {
    case 'dot':
      return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" stroke="none"${fill} />`;
    case 'line':
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke-width="${s.width}"${stroke} />`;
    case 'ring':
      return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="none" stroke-width="${s.width}"${stroke} />`;
    case 'arc':
      return `<path d="${arcPath(s.x, s.y, s.r, s.from, s.to)}" fill="none" stroke-width="${s.width}"${stroke} />`;
    case 'triangle':
      return `<polygon points="${s.x1},${s.y1} ${s.x2},${s.y2} ${s.x3},${s.y3}" stroke="none"${fill} />`;
  }
}

/**
 * A shape's halo for an illuminated reticle (2026-11-18): the same shape wider and faint,
 * and a dot as a soft disc (its gradient fades to clear). Plain fills and strokes, no SVG
 * filter, so moving the reticle each frame stays cheap on a phone.
 */
function glowSvg(s: ReticleShape, color: string, wide: number, opacity: number): string {
  const c = s.color ?? color;
  const o = `stroke-opacity="${opacity}"`;
  switch (s.type) {
    case 'dot':
      return `<circle cx="${s.x}" cy="${s.y}" r="${s.r * (1 + wide)}" stroke="none" fill="url(#glow-${color.slice(1)})" />`;
    case 'line':
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${c}" ${o} stroke-linecap="round" stroke-width="${s.width * wide}" />`;
    case 'ring':
      return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="none" stroke="${c}" ${o} stroke-width="${s.width * wide}" />`;
    case 'arc':
      return `<path d="${arcPath(s.x, s.y, s.r, s.from, s.to)}" fill="none" stroke="${c}" ${o} stroke-linecap="round" stroke-width="${s.width * wide}" />`;
    case 'triangle':
      return `<polygon points="${s.x1},${s.y1} ${s.x2},${s.y2} ${s.x3},${s.y3}" fill="${c}" fill-opacity="${opacity}" stroke="${c}" ${o} stroke-linejoin="round" stroke-width="${0.4 * wide}" />`;
  }
}

/**
 * The halo layers under an illuminated reticle: a wide faint one, a narrower brighter one.
 * Only the lit shapes glow, those in the reticle's color: a shape with its own color (the
 * black stadia under a red chevron) is etched, not lit.
 */
function glowMarkup(optic: OpticDef): string {
  const { color } = optic.reticle;
  const shapes = optic.reticle.shapes.filter((s) => !s.color);
  const defs =
    `<defs><radialGradient id="glow-${color.slice(1)}"><stop offset="0" stop-color="${color}" stop-opacity="0.55" />` +
    `<stop offset="0.35" stop-color="${color}" stop-opacity="0.22" />` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0" /></radialGradient></defs>`;
  return (
    defs +
    `<g>${shapes.map((s) => glowSvg(s, color, 3.2, 0.14)).join('')}</g>` +
    `<g>${shapes
      .filter((s) => s.type !== 'dot')
      .map((s) => glowSvg(s, color, 1.8, 0.3))
      .join('')}</g>`
  );
}

/**
 * The SVG inside the overlay for an optic (in its viewBox, −50 to 50 around the aim point):
 * a scope's mask, an illuminated reticle's halo, then the reticle. The item editor draws its
 * preview with this too.
 */
export function reticleMarkup(optic: OpticDef, throughScope = false): string {
  const { color, shapes } = optic.reticle;
  const r = SCOPE_RADIUS;
  if (throughScope && optic.zoom > 1) {
    // In the game a scope's reticle is fitted to its eyepiece: the scope itself is its model
    // in the gun view (its rim round the lens); here only its reticle, scaled so the mask's
    // edge is the lens's and clipped to it.
    const k = (optic.fill ?? SCOPE_LENS_FILL) / r;
    return (
      `<g transform="scale(${k})"><clipPath id="scope-lens"><circle r="${r}" /></clipPath>` +
      `<g clip-path="url(#scope-lens)">` +
      (optic.reticle.glow ? glowMarkup(optic) : '') +
      `<g fill="${color}" stroke="${color}" stroke-linecap="butt">${shapes.map(shapeSvg).join('')}</g></g></g>`
    );
  }
  // A huge square with a round hole; the screen is never wider than 10 times its height.
  const mask =
    optic.zoom > 1
      ? `<path fill="#000" fill-rule="evenodd" d="M-500 -500H500V500H-500Z M${r} 0A${r} ${r} 0 1 0 -${r} 0A${r} ${r} 0 1 0 ${r} 0Z" />` +
        `<circle r="${r}" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="2.5" />`
      : '';
  return (
    mask +
    (optic.reticle.glow ? glowMarkup(optic) : '') +
    `<g fill="${color}" stroke="${color}" stroke-linecap="butt">${shapes.map(shapeSvg).join('')}</g>`
  );
}

/**
 * The optic's reticle over the screen while aiming, and for scopes the black mask around
 * the sight picture. One SVG whose viewBox is the screen height from −50 to 50 around the
 * center, so reticle units are % of the screen height, as in the item files. It's rebuilt
 * only when the optic changes and shown or hidden per frame. It's moved per frame to where
 * the gun points, by one SVG transform, so no strings are built.
 */
export class OpticOverlay {
  private readonly svg: SVGSVGElement;
  private readonly picture: SVGGElement;
  private readonly offset: SVGTransform;
  private optic: OpticDef | null = null;
  private shown = false;

  constructor(private readonly el: HTMLElement) {
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('viewBox', '-50 -50 100 100');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.picture = document.createElementNS(SVG, 'g');
    this.offset = this.svg.createSVGTransform();
    this.picture.transform.baseVal.appendItem(this.offset);
    this.svg.append(this.picture);
    el.append(this.svg);
    el.hidden = true;
  }

  /** The optic on the gun, or null for iron sights. */
  set(optic: OpticDef | null): void {
    if (optic === this.optic) return;
    this.optic = optic;
    if (!optic) {
      this.picture.innerHTML = '';
      return;
    }
    this.picture.innerHTML = reticleMarkup(optic, true);
  }

  /** Where the gun points, in % of the screen height from the center, y down. */
  aimAt(x: number, y: number): void {
    if (this.shown) this.offset.setTranslate(x, y);
  }

  set visible(on: boolean) {
    const show = on && !!this.optic;
    if (show === this.shown) return;
    this.shown = show;
    this.el.hidden = !show;
  }
}
