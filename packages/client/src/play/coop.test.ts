import { describe, expect, it } from 'vitest';
import type { PlayerInput } from '@mes/shared';
import { mergeInputs } from './coop';

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  crouch: false,
  jump: false,
  fire: false,
  aim: false,
  reload: false,
  ...over,
});

describe('mergeInputs', () => {
  it('keeps the latest stick and look, any press, and every inventory action', () => {
    const a = {
      type: 'rotate',
      at: { owner: { kind: 'self' }, grid: 'pockets', index: 0, item: 'x' },
    } as const;
    const merged = mergeInputs(
      [
        input({ moveY: 1, jump: true, inventory: [a] }),
        input({ moveY: 0.5, yaw: 2, draw: 'sidearm', inventory: [a] }),
      ],
      null,
    )!;
    expect(merged).toMatchObject({ moveY: 0.5, yaw: 2, jump: true, draw: 'sidearm' });
    expect(merged.inventory).toHaveLength(2);
  });

  it('repeats the last input without its presses when nothing new came', () => {
    const last = input({ moveY: 1, fire: true, jump: true, door: 3 });
    expect(mergeInputs([], last)).toMatchObject({ moveY: 1, fire: true, jump: false, door: null });
    expect(mergeInputs([], null)).toBeNull();
  });
});
