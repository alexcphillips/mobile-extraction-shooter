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
