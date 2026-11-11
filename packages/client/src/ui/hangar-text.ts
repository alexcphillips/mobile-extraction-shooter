import {
  craftLeft,
  moduleLevel,
  type Craft,
  type HangarModuleDef,
  type ProfileResponse,
} from '@mes/shared';

/*
 * The Hangar's words and times (H3), for its page and the menu's Hangar button. Kept apart
 * from the page so tests can load it without the DOM.
 */

/** How many modules have a craft done and waiting, at the reply's time (the menu's badge). */
export function readyCrafts(me: ProfileResponse): number {
  return Object.values(me.profile.crafts).filter((c) => craftLeft(c, me.now) === 0).length;
}

/** A line for the menu's Hangar button: what's running or waiting. */
export function hangarLine(modules: readonly HangarModuleDef[], me: ProfileResponse): string {
  const now = me.now;
  const crafts = Object.values(me.profile.crafts);
  const ready = crafts.filter((c) => craftLeft(c, now) === 0).length;
  const running = crafts.length - ready;
  const parts: string[] = [];
  if (ready) parts.push(`${ready} ready to collect`);
  if (running) parts.push(`${running} crafting`);
  if (!parts.length) {
    const built = modules.filter((m) => moduleLevel(me.profile, m.id) > 0).length;
    parts.push(`${built} of ${modules.length} modules built`);
  }
  return parts.join(' · ');
}

/** "1h 05m", "12m 05s" or "40s": a craft's time left. */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

/** "45 min" or "2h 30m": how long a recipe takes. */
export function craftTime(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const r = m % 60;
  return r ? `${Math.floor(m / 60)}h ${String(r).padStart(2, '0')}m` : `${m / 60}h`;
}

/** Names for ids: an item's. */
export interface Names {
  item: (id: string) => string;
}

/** "Field first aid kit" or "5.45 rounds ×30": an item stack. */
export function stackText(names: Names, item: string, count = 1): string {
  return `${names.item(item)}${count > 1 ? ` ×${count}` : ''}`;
}

/** The line after collecting a craft. */
export function collectedLine(names: Names, craft: Craft | undefined): string {
  if (!craft) return "Collected it: it's in your stash.";
  return `Collected ${stackText(names, craft.item, craft.count)}: it's in your stash.`;
}
