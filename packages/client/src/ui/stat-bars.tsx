import { GUN_STATS, type AttachmentMods, type GunStat } from '@mes/shared';
import type { ReactNode } from 'react';

/**
 * The eight gun stats as bars (WS-3, features/weapon-stats.md): a gun's points as a bar
 * from 0, a part's change as a bar from the middle, colored by whether it helps. Item
 * details and the item editor share these.
 */

/** The eight gun stats' names, as shown. */
export const STAT_NAMES: Record<GunStat, string> = {
  recoilUp: 'Vertical recoil',
  recoilSide: 'Horizontal recoil',
  stability: 'Stability',
  handling: 'Handling',
  hipFire: 'Hip-fire',
  accuracy: 'Accuracy',
  range: 'Range',
  loudness: 'Loudness',
};

/** Stats that read as named, so more is worse: more kick, more noise. */
const MORE_IS_WORSE: ReadonlySet<GunStat> = new Set(['recoilUp', 'recoilSide', 'loudness']);

/** Whether a change of this many points to a stat makes the gun better. */
export const helps = (stat: GunStat, by: number): boolean =>
  MORE_IS_WORSE.has(stat) ? by < 0 : by > 0;

/** Points added or taken off: "+5", "−3". */
export const signed = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : `−${-r}`;
};

/** A multiplier as a signed percentage: ×1.3 is "+30%". */
export const signedShare = (m: number): string => {
  const p = Math.round((m - 1) * 100);
  return p > 0 ? `+${p}%` : `−${-p}%`;
};

/** A gun's 0–100 points with a bar. */
export function StatScore({ value, title }: { value: number; title?: string }): ReactNode {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className="stat-score" title={title}>
      <span className="stat-bar">
        <i style={{ width: `${v}%` }} />
      </span>
      {v}
    </span>
  );
}

/**
 * A part's change to a stat: a bar from the middle, a point to a percent of its width as
 * on a gun's bar, and the points, colored by whether they help.
 */
export function StatChange({ stat, by }: { stat: GunStat; by: number }): ReactNode {
  const w = Math.min(50, Math.abs(by));
  return (
    <span className={`stat-score ${helps(stat, by) ? 'stat-good' : 'stat-bad'}`}>
      <span className="stat-bar stat-change">
        <i style={{ width: `${w}%`, left: by < 0 ? `${50 - w}%` : '50%' }} />
      </span>
      {signed(by)}
    </span>
  );
}

/** A changed stat in a short line: "Stability +5", colored by whether it helps. */
export function ChangeChip({ label, by, good }: { label: string; by: string; good: boolean }) {
  return (
    <i className={`stat-chip ${good ? 'stat-good' : 'stat-bad'}`}>
      {label} {by}
    </i>
  );
}

/**
 * What a part changes, as chips: its points by stat, then the exceptions to handling it
 * names (more aim or reload time is worse) and extra rounds.
 */
export function modChips(
  points: Partial<Record<GunStat, number>>,
  mods: Pick<AttachmentMods, 'aimTime' | 'reloadTime' | 'magazine'> = {},
): ReactNode[] {
  const out: ReactNode[] = [];
  for (const stat of GUN_STATS) {
    const by = points[stat];
    if (!by) continue;
    out.push(
      <ChangeChip key={stat} label={STAT_NAMES[stat]} by={signed(by)} good={helps(stat, by)} />,
    );
  }
  if (mods.aimTime && mods.aimTime !== 1)
    out.push(
      <ChangeChip
        key="aim"
        label="Aim time"
        by={signedShare(mods.aimTime)}
        good={mods.aimTime < 1}
      />,
    );
  if (mods.reloadTime && mods.reloadTime !== 1)
    out.push(
      <ChangeChip
        key="reload"
        label="Reload"
        by={signedShare(mods.reloadTime)}
        good={mods.reloadTime < 1}
      />,
    );
  if (mods.magazine)
    out.push(
      <ChangeChip key="mag" label="Rounds" by={signed(mods.magazine)} good={mods.magazine > 0} />,
    );
  return out;
}
