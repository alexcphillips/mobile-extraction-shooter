import { describe, expect, it } from 'vitest';
import { HOLD_MS, touchPress } from './drag';

describe('touch press', () => {
  it('scrolls if the finger moves before it lifts, lifts if it holds still', () => {
    expect(touchPress(0, 50)).toBe('wait');
    expect(touchPress(7, HOLD_MS - 1)).toBe('wait');
    expect(touchPress(8, 50)).toBe('scroll');
    expect(touchPress(30, HOLD_MS + 100)).toBe('scroll');
    expect(touchPress(3, HOLD_MS)).toBe('lift');
  });

  it('lifts before a double-tap window ends, so taps stay taps', () => {
    // inventory-controller.ts's DOUBLE_TAP_MS.
    expect(HOLD_MS).toBeLessThan(350);
    // A quick tap (well under the hold) is never a lift.
    expect(touchPress(0, 120)).toBe('wait');
  });
});
