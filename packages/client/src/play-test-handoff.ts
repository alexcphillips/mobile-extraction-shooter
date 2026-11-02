import type { MapFile, PrefabFile } from '@mes/shared';

/**
 * How the map editor hands the map as edited (and the prefabs, which may be edited too) to
 * the play-test page it opens in another tab: in localStorage, since a map with fine terrain
 * is too big for a URL. Dev only, like both pages.
 */
export interface PlayTestFiles {
  map: MapFile;
  prefabs: PrefabFile[];
}

const KEY = 'mes.playTest';

export function writePlayTest(files: PlayTestFiles): void {
  localStorage.setItem(KEY, JSON.stringify(files));
}

export function readPlayTest(): PlayTestFiles | null {
  const json = localStorage.getItem(KEY);
  return json ? (JSON.parse(json) as PlayTestFiles) : null;
}

/**
 * The editor's unsaved changes, kept so they outlive the tab: going to the play-test (or a
 * reload, or a crash) doesn't lose them. By file, each with the JSON it was edited from, so
 * a change made on disk since (a pull, say) isn't overwritten by a stale draft.
 */
export type Draft = Record<string, { base: string; json: string }>;

const draftKey = (mapFile: string): string => `mes.editorDraft.${mapFile}`;

export function writeDraft(mapFile: string, draft: Draft): void {
  try {
    if (Object.keys(draft).length) localStorage.setItem(draftKey(mapFile), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(mapFile));
  } catch {
    // Full, or blocked: the draft is a convenience, the save button is what counts.
  }
}

export function readDraft(mapFile: string): Draft | null {
  try {
    const json = localStorage.getItem(draftKey(mapFile));
    return json ? (JSON.parse(json) as Draft) : null;
  } catch {
    return null;
  }
}
