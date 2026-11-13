import type { ControlLayout, ControlPlacement } from '@mes/shared';
import { CONTROLS, type ControlId } from './layout';

/*
 * Layout share codes (UX-4, 2026-11-08): a button layout as a short text to copy and
 * paste, so players can swap layouts with no server. Placements are fractions of the
 * screen, so a code made on one phone fits another.
 *
 * The code is PREFIX then base64url bytes: one entry per control that's moved or hidden,
 * then a check byte. An entry is a byte, the control's number in CODE_ORDER (low 6 bits),
 * +0x40 if hidden, +0x80 if moved; a moved one is followed by x and y (16 bits each, as a
 * fraction of 65535) and the scale × 100 (8 bits).
 */

const PREFIX = 'MES1-';

/**
 * Every control's number in a code. **Append only**: a number never changes or is reused,
 * or old codes would move the wrong buttons. A code naming a number this build doesn't
 * know (made by a newer one), or one retired (null), has that entry skipped.
 */
const CODE_ORDER: readonly (ControlId | null)[] = [
  'fire',
  'aim',
  'reload',
  'interact',
  'bag',
  'jump',
  'crouch',
  'primary1',
  'primary2',
  'sidearm',
  'knife',
  'heal',
  'grenade',
  // Retired 2026-11-13 with C4 and fire: detonate, put out.
  null,
  null,
  'leanLeft',
  'leanRight',
  'breathe',
];

const HIDDEN = 0x40;
const MOVED = 0x80;
const INDEX = 0x3f;

/** Exposed for the test that every control has a number. */
export const codeOrder: readonly (ControlId | null)[] = CODE_ORDER;

function check(bytes: readonly number[]): number {
  let sum = 0x5a;
  for (const b of bytes) sum = (sum * 31 + b) & 0xff;
  return sum;
}

function toBase64Url(bytes: readonly number[]): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function fromBase64Url(text: string): number[] | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const FULL = 0xffff;

/** A layout's share code. Controls in their default place and showing take no room. */
export function encodeLayout(layout: ControlLayout): string {
  const bytes: number[] = [];
  CODE_ORDER.forEach((id, index) => {
    if (!id) return;
    const p = layout.placements[id];
    const hidden = layout.hidden.includes(id);
    if (!p && !hidden) return;
    bytes.push(index | (hidden ? HIDDEN : 0) | (p ? MOVED : 0));
    if (p) {
      const x = Math.round(p.x * FULL);
      const y = Math.round(p.y * FULL);
      bytes.push(x >> 8, x & 0xff, y >> 8, y & 0xff, Math.round(p.scale * 100));
    }
  });
  bytes.push(check(bytes));
  return PREFIX + toBase64Url(bytes);
}

/**
 * Reads a share code back, or says what's wrong with it. Spaces and line breaks (from a
 * chat app wrapping it) are ignored, and the prefix's case doesn't matter.
 */
export function decodeLayout(code: string): ControlLayout | { error: string } {
  const text = code.replace(/\s+/g, '');
  if (!text.toUpperCase().startsWith(PREFIX)) return { error: 'That isn’t a layout code.' };
  const bytes = fromBase64Url(text.slice(PREFIX.length));
  if (!bytes || bytes.length === 0 || check(bytes.slice(0, -1)) !== bytes.at(-1))
    return { error: 'That code is damaged: copy it again.' };
  const layout: ControlLayout = { placements: {}, hidden: [] };
  const body = bytes.slice(0, -1);
  for (let i = 0; i < body.length;) {
    const head = body[i++]!;
    let p: ControlPlacement | undefined;
    if (head & MOVED) {
      if (i + 5 > body.length) return { error: 'That code is damaged: copy it again.' };
      const [x1, x2, y1, y2, scale] = body.slice(i, (i += 5)) as [
        number,
        number,
        number,
        number,
        number,
      ];
      p = {
        x: ((x1 << 8) | x2) / FULL,
        y: ((y1 << 8) | y2) / FULL,
        scale: Math.min(2, Math.max(0.5, scale / 100)),
      };
    }
    const id = CODE_ORDER[head & INDEX];
    if (!id) continue; // a control from a newer build, or a retired one
    if (p) layout.placements[id] = p;
    if (head & HIDDEN && !CONTROLS.find((d) => d.id === id)?.required) layout.hidden.push(id);
  }
  return layout;
}
