import { levelProgress } from '@mes/shared';
import type { ReactNode } from 'react';

/**
 * The PMC level (2026-11-11) for the lobby's top bar: the number in a badge, and a thin
 * bar under it for the way to the next level. The title says the XP.
 */
export function LevelBadge({ xp }: { xp: number }): ReactNode {
  const { level, into, need } = levelProgress(xp);
  const title =
    need === null
      ? `PMC level ${level} (top level) · ${xp.toLocaleString()} XP`
      : `PMC level ${level} · ${into.toLocaleString()} / ${need.toLocaleString()} XP to level ${level + 1}`;
  return (
    <span className="level-badge" title={title} aria-label={title}>
      <b>{level}</b>
      <span className="level-bar" aria-hidden>
        <span style={{ width: need === null ? '100%' : `${(100 * into) / need}%` }} />
      </span>
    </span>
  );
}
