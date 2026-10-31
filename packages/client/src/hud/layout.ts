import type { ControlPlacement } from '@mes/shared';

export type ControlId =
  | 'fire'
  | 'aim'
  | 'reload'
  | 'interact'
  | 'bag'
  | 'jump'
  | 'crouch'
  | 'primary1'
  | 'primary2'
  | 'sidearm'
  | 'knife'
  | 'heal'
  | 'grenade';

export interface ControlDef {
  id: ControlId;
  label: string;
  /** Diameter in CSS pixels at scale 1. */
  size: number;
  /** Default centre, as a fraction of the screen. */
  x: number;
  y: number;
}

/**
 * The HUD buttons and where they start. The move stick isn't here: it floats wherever the
 * left thumb lands. Defaults are laid out for a landscape iPhone (about 874 × 402), with
 * the notch's safe area kept clear on both sides.
 */
export const CONTROLS: readonly ControlDef[] = [
  { id: 'fire', label: 'fire', size: 88, x: 0.83, y: 0.64 },
  { id: 'aim', label: 'aim', size: 62, x: 0.71, y: 0.82 },
  { id: 'reload', label: 'reload', size: 52, x: 0.71, y: 0.52 },
  { id: 'interact', label: 'use', size: 56, x: 0.6, y: 0.66 },
  { id: 'bag', label: 'bag', size: 50, x: 0.93, y: 0.2 },
  { id: 'jump', label: 'jump', size: 60, x: 0.93, y: 0.46 },
  { id: 'crouch', label: 'crouch', size: 60, x: 0.93, y: 0.82 },
  { id: 'primary1', label: '1', size: 46, x: 0.31, y: 0.9 },
  { id: 'primary2', label: '2', size: 46, x: 0.38, y: 0.9 },
  { id: 'sidearm', label: '3', size: 46, x: 0.45, y: 0.9 },
  { id: 'knife', label: '4', size: 46, x: 0.52, y: 0.9 },
  { id: 'heal', label: 'heal', size: 54, x: 0.6, y: 0.88 },
  { id: 'grenade', label: 'nade', size: 48, x: 0.6, y: 0.45 },
];

export function placementOf(
  def: ControlDef,
  layout: Readonly<Record<string, ControlPlacement>>,
): ControlPlacement {
  return layout[def.id] ?? { x: def.x, y: def.y, scale: 1 };
}
