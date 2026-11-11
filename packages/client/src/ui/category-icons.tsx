import type { ReactNode } from 'react';
import type { Category } from './stash-search';

/*
 * The stash's kinds of item as icons (2026-11-09, the user's call, in place of their
 * words): 24-unit squares drawn in the button's text color, so they dim and light up
 * with it. The words stay as each button's label and tooltip.
 */

const solid = { fill: 'currentColor' } as const;
const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
} as const;

const SHAPES: Record<Category, ReactNode> = {
  // Everything: a grid of four cells.
  all: (
    <g {...line}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </g>
  ),
  // A pistol, side on.
  guns: <path {...solid} d="M3 6h18v5h-8.5l-1.5 2v2.5H9.5L8.5 20H4.5l1.5-9H3z" />,
  // Three rounds.
  ammo: (
    <g {...solid}>
      <path d="M4 21v-9c0-3 2-6 2-6s2 3 2 6v9z" />
      <path d="M10 21v-9c0-3 2-6 2-6s2 3 2 6v9z" />
      <path d="M16 21v-9c0-3 2-6 2-6s2 3 2 6v9z" />
    </g>
  ),
  // A vest.
  gear: <path {...line} d="M8 3L4 6v14h16V6l-4-3c-.8 2-2.2 3-4 3S8.8 5 8 3z" />,
  // A medical cross.
  meds: <path {...solid} d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
  // A gem.
  loot: (
    <g {...line}>
      <path d="M6 4h12l4 5-10 11L2 9z" />
      <path d="M2 9h20M9 4l3 16M15 4l-3 16" />
    </g>
  ),
};

export function CategoryIcon({ id }: { id: Category }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {SHAPES[id]}
    </svg>
  );
}
