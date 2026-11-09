/*
 * Giving up a raid from the settings screen (2026-10-30, the user's call): you die there
 * and then, armour, health and cheats or not. The raid sets a handler while it can be
 * given up; the settings screen shows the button only while one is set.
 */

let handler: (() => void) | null = null;

export const giveUp = {
  /** Set by the raid while it's going, and cleared when it ends for you. */
  set(fn: (() => void) | null): void {
    handler = fn;
  },
  get handler(): (() => void) | null {
    return handler;
  },
};

let skipHandler: (() => void) | null = null;

/**
 * Leaving the tutorial from the settings screen (TU-3): set while one is going, so the
 * settings screen shows Skip tutorial in place of Give up.
 */
export const skipTutorial = {
  set(fn: (() => void) | null): void {
    skipHandler = fn;
  },
  get handler(): (() => void) | null {
    return skipHandler;
  },
};
