import { stackSize, type ItemDef } from '@mes/shared';

/*
 * Changes to an item that can make items already saved in players' stashes and gear fail
 * the server's checks (checkProfile, session 12): a grid spot that no longer fits, a stack,
 * durability or uses over the new limit, an attachment that no longer fits its gun, a round
 * loaded in a gun of another caliber. The
 * server refuses a whole stash with one bad item in it, so the item editor warns about
 * these (it doesn't refuse them: before release nobody has a stash worth keeping).
 */

/** What the change from the saved item to the edited one can break in saved stashes. */
export function storageRisks(before: ItemDef, after: ItemDef): string[] {
  const out: string[] = [];
  if (before.size[0] !== after.size[0] || before.size[1] !== after.size[1])
    // The server re-fits saved ones (settleFits), so nothing's refused, but things move.
    out.push(
      'its size changed: saved ones that no longer fit where they are move elsewhere in their grid or to the stash when loaded',
    );
  if (stackSize(after) < stackSize(before))
    out.push('its stack is smaller than saved stacks may be');
  if (before.type !== after.type) return out;
  switch (after.type) {
    case 'weapon': {
      const b = before as typeof after;
      // A magazine-fed gun holds what its magazine does (MG-1): see the magazine's capacity.
      if (!after.feed && after.magazine < b.magazine)
        out.push('its magazine is smaller than saved guns may have loaded');
      if (!after.feed !== !b.feed)
        out.push(
          'it changed between magazines and loose rounds: saved ones may be loaded the old way',
        );
      const lost = (b.slots ?? []).filter((s) => !after.slots?.includes(s));
      if (lost.length) out.push(`saved guns may have something in its ${lost.join(' and ')} slot`);
      break;
    }
    case 'ammo': {
      const b = before as typeof after;
      if (after.caliber !== b.caliber)
        out.push('its caliber changed, so saved guns loaded with it may no longer fire it');
      break;
    }
    case 'armor': {
      const b = before as typeof after;
      if (after.slot !== b.slot) out.push('saved ones are worn in the old slot');
      if (after.durability < b.durability)
        out.push('its durability is lower than saved ones may have');
      break;
    }
    case 'container': {
      const b = before as typeof after;
      if (after.slot !== b.slot) out.push('saved ones are worn in the old slot');
      // The server reshapes saved ones (settleBags), so nothing's refused, but things move.
      if (
        after.grid[0] < b.grid[0] ||
        after.grid[1] < b.grid[1] ||
        JSON.stringify(after.sections) !== JSON.stringify(b.sections)
      )
        out.push(
          'its grid is smaller or its sections changed: saved ones are reshaped when loaded, and what no longer fits moves elsewhere in it or to the stash',
        );
      break;
    }
    case 'attachment': {
      const b = before as typeof after;
      if (after.slot !== b.slot) out.push('saved guns have it in the old slot');
      else if (after.weapons && !covers(after.weapons, b.weapons))
        out.push('it fits fewer guns, and saved guns may have it on');
      if ((after.mods?.magazine ?? 0) < (b.mods?.magazine ?? 0))
        out.push('it adds fewer rounds than saved guns may have loaded');
      if ((after.capacity ?? 0) < (b.capacity ?? 0))
        out.push('it holds fewer rounds than saved ones may have in them');
      if (b.caliber && after.caliber !== b.caliber)
        out.push('its caliber changed, so saved ones may hold rounds it no longer takes');
      break;
    }
    case 'med': {
      const b = before as typeof after;
      if ((after.hp ?? after.uses ?? 1) < (b.hp ?? b.uses ?? 1))
        out.push('it holds less than saved ones may have left');
      break;
    }
    case 'repair': {
      const b = before as typeof after;
      if (after.points < b.points) out.push('it has fewer points than saved ones may have left');
      break;
    }
    case 'key': {
      const b = before as typeof after;
      if (after.uses !== undefined && (b.uses === undefined || after.uses < b.uses))
        out.push('saved keys may have more uses left (or none counted)');
      break;
    }
  }
  return out;
}

/** Whether the new list of guns still has every gun of the old one (none: every gun). */
function covers(after: readonly string[], before: readonly string[] | undefined): boolean {
  return !!before && before.every((w) => after.includes(w));
}
