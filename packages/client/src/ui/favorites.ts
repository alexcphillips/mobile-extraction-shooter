import { FAVORITES_MAX, type Item } from '@mes/shared';
import { settings } from '../settings';

/*
 * Favorite items (2026-11-06, the user's call): kinds of item, by id, kept in the
 * settings so they follow the account. A favorite is starred wherever it is, and lit up
 * where it turns up in a body, a container or on the ground (raid-screen.tsx).
 */

let cached: { ids: readonly string[]; set: ReadonlySet<string> } | null = null;

/** The favorites now, as a set (made again only when they change). */
export function favorites(): ReadonlySet<string> {
  const ids = settings.current.favorites;
  if (cached?.ids !== ids) cached = { ids, set: new Set(ids) };
  return cached.set;
}

/**
 * Whether an item is a favorite, or holds one: fitted to a gun, or inside a rig or
 * backpack (so a body's bag lights up for what's in it). With `shown` (a body being
 * searched), only what's been found inside counts: a star mustn't give the rest away.
 */
export function holdsFavorite(
  item: Item,
  set: ReadonlySet<string>,
  shown?: ReadonlySet<Item>,
): boolean {
  if (!set.size) return false;
  if (set.has(item.item)) return true;
  for (const part of Object.values(item.attachments ?? {})) if (part && set.has(part)) return true;
  for (const g of item.grid?.items ?? [])
    if ((!shown || shown.has(g.item)) && holdsFavorite(g.item, set, shown)) return true;
  return false;
}

/** Favorites an item id, or unfavorites it. Past FAVORITES_MAX, the oldest goes. */
export function toggleFavorite(id: string): void {
  settings.update((s) => {
    const i = s.favorites.indexOf(id);
    if (i >= 0) s.favorites.splice(i, 1);
    else s.favorites = [...s.favorites, id].slice(-FAVORITES_MAX);
  });
}
