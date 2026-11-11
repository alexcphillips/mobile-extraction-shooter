import {
  contractDone,
  contractKills,
  contractProgress,
  craftLeft,
  moduleLevel,
  recipeResults,
  type ContractDef,
  type ContractObjective,
  type Craft,
  type HangarModuleDef,
  type KillCounts,
  type Profile,
  type ProfileResponse,
  type RecipeDef,
  type RecipeResult,
} from '@mes/shared';

/*
 * The Hangar's words and times (H3), for its page and the menu's Hangar button. Kept apart
 * from the page so tests can load it without the DOM.
 */

/** Whether the running contract (H6) is done and waiting to be claimed. */
function contractReady(me: ProfileResponse, contracts: ReadonlyMap<string, ContractDef>): boolean {
  const a = me.profile.contracts.active;
  const def = a && contracts.get(a.id);
  return !!def && contractDone(def, a!);
}

/**
 * How many things wait at the Hangar, at the reply's time (the menu's badge): modules with
 * a craft done, and a finished contract to claim.
 */
export function readyCrafts(
  me: ProfileResponse,
  contracts: ReadonlyMap<string, ContractDef> = new Map(),
): number {
  const now = me.now;
  const crafts = Object.values(me.profile.crafts).filter((c) => craftLeft(c, now) === 0).length;
  return crafts + (contractReady(me, contracts) ? 1 : 0);
}

/** A line for the menu's Hangar button: what's running or waiting. */
export function hangarLine(
  modules: readonly HangarModuleDef[],
  me: ProfileResponse,
  contracts: ReadonlyMap<string, ContractDef> = new Map(),
): string {
  const now = me.now;
  const crafts = Object.values(me.profile.crafts);
  const ready = crafts.filter((c) => craftLeft(c, now) === 0).length;
  const running = crafts.length - ready;
  const parts: string[] = [];
  if (ready) parts.push(`${ready} ready to collect`);
  if (running) parts.push(`${running} crafting`);
  const a = me.profile.contracts.active;
  if (contractReady(me, contracts)) parts.push('contract to claim');
  else if (a && contracts.has(a.id) && a.ends > now)
    parts.push(`contract ${timeLeft(a.ends - now)} left`);
  if (!parts.length) {
    const built = modules.filter((m) => moduleLevel(me.profile, m.id) > 0).length;
    parts.push(`${built} of ${modules.length} modules built`);
  }
  return parts.join(' · ');
}

/** "1h 05m", "12m 05s" or "40s": a craft's time left. */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

/** "45 min" or "2h 30m": how long a recipe takes. */
export function craftTime(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const r = m % 60;
  return r ? `${Math.floor(m / 60)}h ${String(r).padStart(2, '0')}m` : `${m / 60}h`;
}

/** Names for ids: an item's, a vendor's. */
export interface Names {
  item: (id: string) => string;
  vendor: (id: string) => string;
}

/** "Staff keycard", "5.45 rounds ×30" or "Fence +0.05 rep": what a result or craft gives. */
export function resultText(
  names: Names,
  r: Pick<RecipeResult, 'item' | 'count' | 'vendor' | 'rep'> | Craft,
): string {
  if (r.vendor !== undefined) return `${names.vendor(r.vendor)} +${(r.rep ?? 0).toFixed(2)} rep`;
  return `${names.item(r.item!)}${(r.count ?? 1) > 1 ? ` ×${r.count}` : ''}`;
}

/** A rolled recipe's results with their chances in whole percent, most likely first. */
export function resultChances(recipe: RecipeDef): { result: RecipeResult; percent: number }[] {
  const all = recipeResults(recipe);
  const total = all.reduce((n, x) => n + x.weight, 0);
  return all
    .map((result) => ({ result, percent: Math.round((result.weight / total) * 100) }))
    .sort((a, b) => b.percent - a.percent);
}

/** The line after collecting a craft. */
export function collectedLine(names: Names, craft: Craft | undefined): string {
  if (!craft) return "Collected it: it's in your stash.";
  if (craft.vendor !== undefined) return `Decrypted: ${resultText(names, craft)}.`;
  return `Collected ${resultText(names, craft)}: it's in your stash.`;
}

const FACTION_WORDS = {
  scav: ['scav', 'scavs'],
  pmc: ['PMC', 'PMCs'],
  boss: ['boss', 'bosses'],
} as const;

/** "Kill 3 scavs on Silver Creek" or "Hand over 2 × Duct tape (found in raid)": a contract objective (H6). */
export function contractObjectiveText(
  names: Names,
  mapName: (id: string) => string,
  o: ContractObjective,
): string {
  if (o.text) return o.text;
  if (o.type === 'kill') {
    const [one, many] = FACTION_WORDS[o.faction];
    return `Kill ${o.count} ${o.count === 1 ? one : many}${o.map ? ` on ${mapName(o.map)}` : ''}`;
  }
  return `Hand over ${o.count > 1 ? `${o.count} × ` : ''}${names.item(o.item)} (found in raid)`;
}

/** "Field first aid kit, 5.45 rounds ×60, Quartermaster +0.05 rep": what a contract pays. */
export function contractRewards(names: Names, def: ContractDef): string {
  const parts = def.rewards.items.map((r) => resultText(names, { item: r.item, count: r.count }));
  if (def.rewards.rep > 0)
    parts.push(resultText(names, { vendor: def.vendor, rep: def.rewards.rep }));
  return parts.join(', ');
}

/**
 * The results screen's lines for the running contract's kills in a raid (H6), worked out
 * as the server will on a copy: "Kill 5 scavs: 3/5". The server also checks the raid
 * started inside the window, which the device can't know for sure; it's the one that counts.
 */
export function contractRaidLines(
  profile: Profile,
  contracts: ReadonlyMap<string, ContractDef>,
  map: string,
  killed: KillCounts,
  names: Names,
  mapName: (id: string) => string,
): { quest: string; text: string }[] {
  const copy = structuredClone(profile);
  const went = contractKills(copy, contracts, map, killed, 0);
  const a = copy.contracts.active;
  const def = a && contracts.get(a.id);
  if (!def) return [];
  return went.map((o) => ({
    quest: `Contract: ${def.name}`,
    text: `${contractObjectiveText(names, mapName, o)}: ${contractProgress(a!, o)}/${o.count}`,
  }));
}
