import { SCOPE_RADIUS, type OpticDef, type ReticleShape } from '@mes/shared';

const SVG = 'http://www.w3.org/2000/svg';

/** The camera's vertical field of view in degrees: from the hip, and aimed down irons or a red dot. */
export const FOV = 70;
export const AIM_FOV = 55;
const DEG = Math.PI / 180;

/** The field of view aimed through an optic: a scope's zoom narrows the hip's. */
export function aimedFov(zoom: number): number {
  return zoom > 1 ? (2 * Math.atan(Math.tan((FOV / 2) * DEG) / zoom)) / DEG : AIM_FOV;
}

function shapeSvg(s: ReticleShape): string {
  switch (s.type) {
    case 'dot':
      return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" stroke="none" />`;
    case 'line':
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke-width="${s.width}" />`;
    case 'ring':
      return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="none" stroke-width="${s.width}" />`;
  }
}

/**
 * The SVG inside the overlay for an optic (in its viewBox, −50 to 50 around the aim point):
 * a scope's mask, then the reticle. The item editor draws its preview with this too.
 */
export function reticleMarkup(optic: OpticDef): string {
  const { colour, shapes } = optic.reticle;
  const r = SCOPE_RADIUS;
  // A huge square with a round hole; the screen is never wider than 10 times its height.
  const mask =
    optic.zoom > 1
      ? `<path fill="#000" fill-rule="evenodd" d="M-500 -500H500V500H-500Z M${r} 0A${r} ${r} 0 1 0 -${r} 0A${r} ${r} 0 1 0 ${r} 0Z" />` +
        `<circle r="${r}" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="2.5" />`
      : '';
  return (
    mask +
    `<g fill="${colour}" stroke="${colour}" stroke-linecap="butt">${shapes.map(shapeSvg).join('')}</g>`
  );
}

/**
 * The optic's reticle over the screen while aiming, and for scopes the black mask around
 * the sight picture. One SVG whose viewBox is the screen height from −50 to 50 around the
 * centre, so reticle units are % of the screen height, as in the item files. It's rebuilt
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
    this.picture.innerHTML = reticleMarkup(optic);
  }

  /** Where the gun points, in % of the screen height from the centre, y down. */
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
