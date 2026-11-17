import { moduleLevel, type HangarModuleDef, type ProfileResponse } from '@mes/shared';

/*
 * The Hangar's words (H3), for the menu's Hangar button. Kept apart from the page so tests
 * can load it without the DOM.
 */

/** A line for the menu's Hangar button: how many modules are built. */
export function hangarLine(modules: readonly HangarModuleDef[], me: ProfileResponse): string {
  const built = modules.filter((m) => moduleLevel(me.profile, m.id) > 0).length;
  return `${built} of ${modules.length} modules built`;
}
