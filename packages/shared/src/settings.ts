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

/** How many button layouts a player can keep (UX-4). */
export const LAYOUT_SLOTS = 3;

/**
 * One button layout: the moved controls by id (controls not listed are in their default
 * place; unknown ids are ignored) and the controls the player has hidden.
 */
const controlLayoutSchema = z.object({
  placements: z
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
  hidden: z
    .array(z.string().max(32))
    .catch([])
    .transform((ids) => [...new Set(ids)].slice(0, 64)),
});

export type ControlLayout = z.infer<typeof controlLayoutSchema>;

/** The most favourites a player can have. */
export const FAVOURITES_MAX = 200;

const settingsObject = z.object({
  formatVersion: z.literal(1),
  /** Hold the aim button to aim, or tap to toggle. */
  aim: z.enum(['hold', 'toggle']).catch('hold'),
  /**
   * Lean (Q and E, or the lean buttons) while held, or press to lean and again to
   * straighten up (2026-11-01). Toggle by default: a held button needs a third thumb.
   */
  lean: z.enum(['hold', 'toggle']).catch('toggle'),
  /**
   * Crouch (C, or the crouch button) toggles, or crouches while held (2026-11-08, the
   * user's call; toggle by default, on PC too, where C used to be held only).
   */
  crouch: z.enum(['hold', 'toggle']).catch('toggle'),
  /** Leaning aims too, for as long as you lean (2026-11-07, the user's request). */
  leanAim: z.boolean().catch(false),
  /** auto: the gun also fires by itself while the crosshair is on an enemy. */
  fire: z.enum(['auto', 'manual']).catch('auto'),
  /** How much aim slows while passing over an enemy. */
  aimAssist: z.enum(['off', 'low', 'medium', 'high']).catch('low'),
  /** Look speed multiplier. */
  lookSensitivity: range(0.2, 3, 1),
  /** Look speed with a captured mouse or trackpad (desktop), apart from touch's. */
  mouseSensitivity: range(0.2, 3, 1),
  /** Look speed with a controller's stick (CP-1, 2026-11-08), apart from touch's and the mouse's. */
  padSensitivity: range(0.2, 3, 1),
  /** Look speed while aiming, as a fraction of the normal speed. */
  aimSensitivity: range(0.2, 1.5, 0.6),
  invertY: z.boolean().catch(false),
  /**
   * A controller rumbles on firing, being hit and explosions (CP-3, 2026-11-08). On by
   * default; falls back on its own, so no format bump.
   */
  rumble: z.boolean().catch(true),
  /** Every sound's loudness (session 19): 0 is silent. */
  volume: range(0, 1, 0.8),
  /** The fps and timings overlay. */
  showStats: z.boolean().catch(true),
  /**
   * How sharp the 3D view is drawn (2026-11-07, for the phone): high is up to 2 pixels per
   * CSS pixel with antialiasing, balanced up to 1.5 with it, low 1 without. See
   * GRAPHICS_QUALITY.
   */
  graphics: z.enum(['high', 'balanced', 'low']).catch('high'),
  /**
   * Item ids the player has favourited (2026-11-06): marked with a star, and lit up where
   * they turn up in a body, a container or on the ground. Ids no longer in content are
   * harmless. At most FAVOURITES_MAX, to keep the settings small.
   */
  favourites: z
    .array(z.string().max(64))
    .catch([])
    .transform((ids) => [...new Set(ids)].slice(0, FAVOURITES_MAX)),
  /**
   * The saved button layouts (UX-4, 2026-11-08): always LAYOUT_SLOTS of them, one equipped.
   * A slot never edited is the default layout.
   */
  layouts: z
    .array(z.unknown())
    .catch([])
    .transform((slots) =>
      Array.from({ length: LAYOUT_SLOTS }, (_, i) => {
        const slot = controlLayoutSchema.safeParse(slots[i] ?? {});
        return slot.success ? slot.data : controlLayoutSchema.parse({});
      }),
    ),
  equippedLayout: z
    .number()
    .int()
    .min(0)
    .max(LAYOUT_SLOTS - 1)
    .catch(0),
});

/**
 * Settings saved before UX-4 had one layout, `layout` (moved controls only): it becomes the
 * first slot. Done here rather than as a format bump, so every other field still falls back
 * on its own and an older build reading these settings isn't thrown back to the defaults.
 */
function migrateLayout(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const doc = raw as Record<string, unknown>;
  if (doc.layouts !== undefined || doc.layout === undefined) return doc;
  const { layout, ...rest } = doc;
  return { ...rest, layouts: [{ placements: layout }] };
}

const settingsSchema = z.preprocess(migrateLayout, settingsObject);

export type Settings = z.infer<typeof settingsObject>;

/** The layout in use. */
export function equippedLayout(s: Settings): ControlLayout {
  return s.layouts[s.equippedLayout]!;
}

export type GraphicsQuality = Settings['graphics'];

/** Each graphics setting's most pixels per CSS pixel, and whether edges are antialiased. */
export const GRAPHICS_QUALITY: Readonly<
  Record<GraphicsQuality, { readonly pixelRatio: number; readonly antialias: boolean }>
> = {
  high: { pixelRatio: 2, antialias: true },
  balanced: { pixelRatio: 1.5, antialias: true },
  low: { pixelRatio: 1, antialias: false },
};

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
