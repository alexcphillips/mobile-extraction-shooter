import { z } from 'zod';
import type { CompiledMap } from './compile';
import { ContentError, type ContentFormat } from './format';
import { idSchema } from './schema';

/*
 * The tutorial (content/tutorials/<id>.json, TU-2, 2026-11-09; design.md → Tutorial): an
 * offline raid (its raid config has `offline: true`), the fixed kit worn in it (a starting
 * kit's gear, carried items and loaded rounds; its money and stash are ignored), and the
 * steps, in order. Each step shows its prompt, worded for the input in use, until its
 * trigger happens; then the next. sim tutorial.ts checks the triggers.
 */

export const TUTORIAL_FORMAT_VERSION = 1;

const text = z.string().min(1);

/** What ends a step. Each is checked once a tick, after the step that ran (tutorial.ts). */
export const tutorialTriggerSchema = z.discriminatedUnion('type', [
  /** Walked this many metres (straight-line, across the ground) from where the step began. */
  z.strictObject({ type: z.literal('moved'), distance: z.number().positive() }),
  /** Stood inside a zone of the map (by id; any zone, an extraction or not). */
  z.strictObject({ type: z.literal('zone'), zone: idSchema }),
  /** Vaulted over something, or jumped. */
  z.strictObject({ type: z.literal('vault') }),
  /** Crouched or went prone. */
  z.strictObject({ type: z.literal('crouch') }),
  /** Has this item on them: in hand, worn, or in pockets, rig or backpack. */
  z.strictObject({ type: z.literal('carry'), item: idSchema }),
  /** Nothing bleeding. */
  z.strictObject({ type: z.literal('notBleeding') }),
  /** Killed an enemy. */
  z.strictObject({ type: z.literal('kill') }),
  /** Started reloading. */
  z.strictObject({ type: z.literal('reload') }),
  /** Opened a dead body to search it. */
  z.strictObject({ type: z.literal('searchBody') }),
  /** Unlocked or opened this door (its path id in the map). */
  z.strictObject({ type: z.literal('door'), door: z.string().min(1) }),
  /** Extracted. */
  z.strictObject({ type: z.literal('extract') }),
]);

export const tutorialStepSchema = z.strictObject({
  id: idSchema,
  /** The prompt, for each kind of input (input/mode.ts): touch buttons, a controller, keys. */
  prompt: z.strictObject({ touch: text, gamepad: text, desktop: text }),
  trigger: tutorialTriggerSchema,
  /**
   * Something bright pointing at this map marker (a questMarker's path id) while the step
   * shows: the bandage, the body, the door.
   */
  marker: z.string().min(1).optional(),
});

export const tutorialSchema = z.strictObject({
  formatVersion: z.literal(TUTORIAL_FORMAT_VERSION),
  id: idSchema,
  /** A raid config (content/raids) with `offline: true`. */
  raid: idSchema,
  /** A starting kit (content/starting-kits): what you wear and carry in it. */
  kit: idSchema,
  steps: z.array(tutorialStepSchema).min(1),
});

export type TutorialDef = z.infer<typeof tutorialSchema>;
export type TutorialStep = z.infer<typeof tutorialStepSchema>;
export type TutorialTrigger = z.infer<typeof tutorialTriggerSchema>;

export const TUTORIAL_FORMAT: ContentFormat<TutorialDef> = {
  kind: 'tutorial',
  version: TUTORIAL_FORMAT_VERSION,
  schema: tutorialSchema,
  migrations: {},
};

/** A step with what it names in the map looked up: a zone's outline, a door's index, a marker. */
export interface CompiledTutorialStep extends TutorialStep {
  /** A zone trigger's outline. */
  zonePoints?: readonly (readonly [number, number])[];
  /** A door trigger's index in the map's doors (and the sim's). */
  doorIndex?: number;
  /** Where the marker is. */
  markerPos?: { x: number; y: number; z: number };
}

export interface CompiledTutorial {
  id: string;
  raid: string;
  kit: string;
  steps: CompiledTutorialStep[];
}

/** Looks up what the steps name in the tutorial's map, failing on anything missing. */
export function compileTutorial(def: TutorialDef, map: CompiledMap): CompiledTutorial {
  const source = `content/tutorials/${def.id}.json`;
  const ids = new Set<string>();
  const steps = def.steps.map((s, i): CompiledTutorialStep => {
    const where = `step ${i + 1} ("${s.id}")`;
    if (ids.has(s.id)) throw new ContentError(source, `${where}: duplicate step id`);
    ids.add(s.id);
    const out: CompiledTutorialStep = { ...s };
    const t = s.trigger;
    if (t.type === 'zone') {
      const zone = map.zones.find((z) => z.id === t.zone);
      if (!zone) throw new ContentError(source, `${where}: no zone "${t.zone}" in ${map.id}`);
      out.zonePoints = zone.points;
    }
    if (t.type === 'door') {
      const k = map.doors.findIndex((d) => d.id === t.door);
      if (k < 0) throw new ContentError(source, `${where}: no door "${t.door}" in ${map.id}`);
      out.doorIndex = k;
    }
    if (s.marker !== undefined) {
      const m = map.markers.find((x) => x.type === 'questMarker' && x.id === s.marker);
      if (!m) throw new ContentError(source, `${where}: no questMarker "${s.marker}" in ${map.id}`);
      out.markerPos = { x: m.x, y: m.y, z: m.z };
    }
    return out;
  });
  return { id: def.id, raid: def.raid, kit: def.kit, steps };
}
