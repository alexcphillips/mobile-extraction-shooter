import { z } from 'zod';
import { loadContent, type ContentFormat } from './content/format';

/*
 * Player settings. The client keeps them in local storage; once the server exists they
 * sync to the account, so the schema lives here. Every field falls back to its default
 * on its own when it's missing or invalid, so one bad value never resets the rest
 * (above all the HUD layout).
 */

const range = (min: number, max: number, fallback: number) =>
  z.number().min(min).max(max).catch(fallback);

/** Where a HUD control sits: its centre as a fraction of the screen, and a size multiplier. */
const placementSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(0.5).max(2),
});

export type ControlPlacement = z.infer<typeof placementSchema>;

const settingsSchema = z.object({
  formatVersion: z.literal(1),
  /** Hold the aim button to aim, or tap to toggle. */
  aim: z.enum(['hold', 'toggle']).catch('hold'),
  /** auto: the gun also fires by itself while the crosshair is on an enemy. */
  fire: z.enum(['auto', 'manual']).catch('auto'),
  /** How much aim slows while passing over an enemy. */
  aimAssist: z.enum(['off', 'low', 'medium', 'high']).catch('low'),
  /** Look speed multiplier. */
  lookSensitivity: range(0.2, 3, 1),
  /** Look speed with a captured mouse or trackpad (desktop), apart from touch's. */
  mouseSensitivity: range(0.2, 3, 1),
  /** Look speed while aiming, as a fraction of the normal speed. */
  aimSensitivity: range(0.2, 1.5, 0.6),
  invertY: z.boolean().catch(false),
  /** Every sound's loudness (session 19): 0 is silent. */
  volume: range(0, 1, 0.8),
  /** The fps and timings overlay. */
  showStats: z.boolean().catch(true),
  /** Moved controls by id. Controls not listed are in their default place; unknown ids are ignored. */
  layout: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((layout) => {
      const out: Record<string, ControlPlacement> = {};
      for (const [id, p] of Object.entries(layout)) {
        const parsed = placementSchema.safeParse(p);
        if (parsed.success) out[id] = parsed.data;
      }
      return out;
    }),
});

export type Settings = z.infer<typeof settingsSchema>;

export const SETTINGS_FORMAT_VERSION = 1;

export const SETTINGS_FORMAT: ContentFormat<Settings> = {
  kind: 'settings',
  version: SETTINGS_FORMAT_VERSION,
  schema: settingsSchema,
  migrations: {},
};

export function defaultSettings(): Settings {
  return settingsSchema.parse({ formatVersion: SETTINGS_FORMAT_VERSION });
}

/** Loads saved settings, upgrading old versions. Anything unreadable gives the defaults. */
export function loadSettings(raw: unknown): Settings {
  try {
    return loadContent(SETTINGS_FORMAT, raw, 'settings');
  } catch {
    return defaultSettings();
  }
}
