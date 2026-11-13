import type { Faction } from '../content/enemies';
import type { Character } from './state';

/*
 * Who fights whom (AI rework session 1, 2026-11-07; design.md → AI → Scavs, PMCs and
 * bosses). Every enemy has a faction from its type: scavs and bosses (with their
 * followers) are allies, PMCs are hostile to everyone but their own squad (AI-3), and
 * everyone is hostile to players. Players never fight each other (PvE).
 *
 * Allies' hits do nothing to each other (health.ts byAlly), so a stray round never thins
 * out a group; a hostile's land like a player's.
 */

/** An enemy's faction; missing (saves from before factions) is scav. */
export function factionOf(c: Character): Faction | null {
  return c.ai ? (c.ai.faction ?? 'scav') : null;
}

/** Whether a and b fight each other. Symmetric. */
export function hostile(a: Character, b: Character): boolean {
  if (a === b) return false;
  const fa = a.ai;
  const fb = b.ai;
  // A player and an enemy; never two players.
  if (!fa || !fb) return !!fa !== !!fb;
  const x = fa.faction ?? 'scav';
  const y = fb.faction ?? 'scav';
  // PMCs are hostile to everyone, other PMCs too, except their own squad's (AI-3).
  if (x === 'pmc' && y === 'pmc') return fa.squad === undefined || fa.squad !== fb.squad;
  if (x === 'pmc' || y === 'pmc') return true;
  // Scavs and bosses are allies.
  return false;
}
