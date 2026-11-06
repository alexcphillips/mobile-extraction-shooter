import { FAVOURITES_MAX, type Item } from '@mes/shared';
import { settings } from '../settings';

/*
 * Favourite items (2026-11-06, the user's call): kinds of item, by id, kept in the
 * settings so they follow the account. A favourite is starred wherever it is, and lit up
 * where it turns up in a body, a container or on the ground (raid-screen.tsx).
 */

let cached: { ids: readonly string[]; set: ReadonlySet<string> } | null = null;

/** The favourites now, as a set (made again only when they change). */
export function favourites(): ReadonlySet<string> {
  const ids = settings.current.favourites;
  if (cached?.ids !== ids) cached = { ids, set: new Set(ids) };
  return cached.set;
}

/**
 * Whether an item is a favourite, or holds one: fitted to a gun, or inside a rig or
 * backpack (so a body's bag lights up for what's in it).
 */
export function holdsFavourite(item: Item, set: ReadonlySet<string>): boolean {
  if (!set.size) return false;
  if (set.has(item.item)) return true;
  for (const part of Object.values(item.attachments ?? {})) if (part && set.has(part)) return true;
  for (const g of item.grid?.items ?? []) if (holdsFavourite(g.item, set)) return true;
  return false;
}

/** Favourites an item id, or unfavourites it. Past FAVOURITES_MAX, the oldest goes. */
export function toggleFavourite(id: string): void {
  settings.update((s) => {
    const i = s.favourites.indexOf(id);
    if (i >= 0) s.favourites.splice(i, 1);
    else s.favourites = [...s.favourites, id].slice(-FAVOURITES_MAX);
  });
}
