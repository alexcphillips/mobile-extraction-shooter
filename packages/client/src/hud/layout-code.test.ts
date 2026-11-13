import type { ControlLayout } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { CONTROLS } from './layout';
import { codeOrder, decodeLayout, encodeLayout } from './layout-code';

const empty = (): ControlLayout => ({ placements: {}, hidden: [] });

describe('layout share codes', () => {
  it('gives every control a number', () => {
    for (const def of CONTROLS) expect(codeOrder).toContain(def.id);
    expect(new Set(codeOrder).size).toBe(codeOrder.length);
    expect(codeOrder.length).toBeLessThanOrEqual(64);
  });

  it('round-trips a layout, to well under a pixel', () => {
    const layout: ControlLayout = {
      placements: {
        fire: { x: 0.8123, y: 0.6, scale: 1.3 },
        jump: { x: 0, y: 1, scale: 0.5 },
        leanRight: { x: 0.5, y: 0.25, scale: 2 },
      },
      hidden: ['grenade', 'leanRight'],
    };
    const back = decodeLayout(encodeLayout(layout));
    if ('error' in back) throw new Error(back.error);
    expect(Object.keys(back.placements).sort()).toEqual(['fire', 'jump', 'leanRight']);
    for (const [id, p] of Object.entries(layout.placements)) {
      const q = back.placements[id]!;
      expect(Math.abs(q.x - p.x)).toBeLessThan(1e-4);
      expect(Math.abs(q.y - p.y)).toBeLessThan(1e-4);
      expect(q.scale).toBeCloseTo(p.scale);
    }
    expect(back.hidden.sort()).toEqual(['grenade', 'leanRight']);
  });

  it('is short: the default layout is a few characters, a full one fits a chat message', () => {
    expect(encodeLayout(empty()).length).toBeLessThan(10);
    const full = empty();
    for (const def of CONTROLS) full.placements[def.id] = { x: 0.5, y: 0.5, scale: 1 };
    expect(encodeLayout(full).length).toBeLessThan(160);
    expect(decodeLayout(encodeLayout(empty()))).toEqual(empty());
  });

  it('ignores spaces, line breaks and the prefix’s case', () => {
    const code = encodeLayout({ placements: { aim: { x: 0.3, y: 0.4, scale: 1 } }, hidden: [] });
    const mangled = ` ${code.slice(0, 5).toLowerCase()}${code.slice(5, 9)}\n${code.slice(9)} `;
    expect(decodeLayout(mangled)).toEqual(decodeLayout(code));
  });

  it('turns down text that isn’t a code, and a code with a character changed', () => {
    expect(decodeLayout('hello')).toHaveProperty('error');
    const code = encodeLayout({ placements: { aim: { x: 0.3, y: 0.4, scale: 1 } }, hidden: [] });
    const last = code.at(-3) === 'A' ? 'B' : 'A';
    expect(decodeLayout(code.slice(0, -3) + last + code.slice(-2))).toHaveProperty('error');
    expect(decodeLayout(code.slice(0, -4))).toHaveProperty('error');
    expect(decodeLayout('MES1-')).toHaveProperty('error');
  });

  it('never hides a required control, even if a code says to', () => {
    const back = decodeLayout(encodeLayout({ placements: {}, hidden: ['fire', 'bag', 'heal'] }));
    if ('error' in back) throw new Error(back.error);
    expect(back.hidden).toEqual(['heal']);
  });
});
