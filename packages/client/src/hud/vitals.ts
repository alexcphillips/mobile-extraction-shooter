import {
  chestArmor,
  HEALTH,
  ZONE_COUNT,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_ARM,
  RIGHT_LEG,
  CHEST,
  isBleeding,
  stomachBlacked,
  isBroken,
  createWeaponStats,
  weaponStats,
  type ArmorState,
  type Character,
  type ItemDb,
  heldWeapon,
  spareRounds,
  type SimState,
  roundOf,
  loadedAmmo,
} from '@mes/shared';
import { levelColor } from '../ui/levels';
import { armorColor } from './armor';

const HELMET_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 15a9 9 0 0 1 18 0v2H3z M2 17h20v2H2z"/></svg>';
const stats = createWeaponStats();

/**
 * A front-on body, one shape per zone in Health's order (head, chest, left arm, right arm,
 * left leg, right leg, stomach), facing you, so its left side is on your right. Each zone's
 * HP is written beside it (the chest's and stomach's on them), as Tarkov's health widget
 * does. Shapes and texts are matched to zones by their order here, not their attributes.
 */
const BODY_ICON = `<svg viewBox="0 0 64 60" width="80" height="75">
  <circle data-zone="0" cx="32" cy="6" r="5"/>
  <rect data-zone="1" x="26" y="13" width="12" height="11.5" rx="1.5"/>
  <rect data-zone="2" x="39.5" y="13" width="4.5" height="19" rx="1.5"/>
  <rect data-zone="3" x="20" y="13" width="4.5" height="19" rx="1.5"/>
  <rect data-zone="4" x="32.5" y="33.5" width="5.5" height="26" rx="1.5"/>
  <rect data-zone="5" x="26" y="33.5" width="5.5" height="26" rx="1.5"/>
  <rect data-zone="6" x="26" y="25" width="12" height="7" rx="1.5"/>
  <text data-hp="0" x="39" y="9"/>
  <text data-hp="1" x="32" y="21.5" text-anchor="middle"/>
  <text data-hp="2" x="46" y="25"/>
  <text data-hp="3" x="18" y="25" text-anchor="end"/>
  <text data-hp="4" x="40" y="50"/>
  <text data-hp="5" x="24" y="50" text-anchor="end"/>
  <text data-hp="6" x="32" y="31" text-anchor="middle"/>
</svg>`;

/** Zone colors by HP left: full, hurt, badly hurt, nearly gone, and 0 (broken, or dead). */
export const ZONE_COLORS = ['#5cb85c', '#c9d23f', '#f0a030', '#e74c3c', '#222'];

export function zoneColor(hp: number, max: number): number {
  if (hp <= 0) return 4;
  const f = hp / max;
  return f > 0.75 ? 0 : f > 0.5 ? 1 : f > 0.25 ? 2 : 3;
}

const VEST_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 2h3l2 3 2-3h3l2 4v15H5V6z"/></svg>';

/** Writes text only when it changes, so the HUD costs nothing while nothing happens. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/**
 * The player's status, written straight to the DOM (never through React): a body with
 * each zone colored by its HP and its HP beside it, bleeding zones pulsing (as Tarkov
 * does: there's no total, since the head or chest decides death), chips for broken limbs
 * and bleeding, armor icons colored by durability, and the ammo count with the round
 * loaded (colored by level) and a reload bar. Also a red flash when hurt. There's no
 * crosshair or hit marker (the user's call, 2026-11-05, as in Tarkov). With one health bar (zombies mode, Health.pool) it's just that bar.
 */
export class Vitals {
  private readonly zones: SVGElement[];
  /** What each zone shows: its color index, plus 8 when bleeding. */
  private readonly zoneShown = Array<number>(ZONE_COUNT).fill(-1);
  private readonly hpTexts: SVGTextElement[];
  private readonly hpShown = Array<number>(ZONE_COUNT).fill(-1);
  private readonly chips: HTMLElement;
  private readonly helmet: HTMLElement;
  private readonly vest: HTMLElement;
  private readonly rounds: HTMLElement;
  private readonly round: HTMLElement;
  private roundId = '';
  private readonly reload: HTMLElement;
  private readonly reloadFill: HTMLElement;
  private chipKey = '';
  private readonly vitals: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly barText: HTMLElement;
  private barShown = -1;

  constructor(
    vitals: HTMLElement,
    private readonly ammo: HTMLElement,
    private readonly hurt: HTMLElement,
  ) {
    vitals.innerHTML = `
      <div class="vitals-row">
        <span class="body">${BODY_ICON}</span>
        <div class="armor-icons">
          <span class="armor helmet">${HELMET_ICON}</span>
          <span class="armor vest">${VEST_ICON}</span>
        </div>
      </div>
      <div class="chips"></div>
      <div class="health-bar" hidden><div></div><span></span></div>`;
    const q = (sel: string): HTMLElement => vitals.querySelector<HTMLElement>(sel)!;
    this.vitals = vitals;
    this.bar = q('.health-bar');
    this.barFill = this.bar.firstElementChild as HTMLElement;
    this.barText = q('.health-bar span');
    this.zones = [...vitals.querySelectorAll<SVGElement>('[data-zone]')];
    this.hpTexts = [...vitals.querySelectorAll<SVGTextElement>('[data-hp]')];
    this.chips = q('.chips');
    this.helmet = q('.helmet');
    this.vest = q('.vest');
    ammo.innerHTML =
      '<span class="rounds"></span><span class="round"></span><div class="reload"><div></div></div>';
    this.rounds = ammo.querySelector<HTMLElement>('.rounds')!;
    this.round = ammo.querySelector<HTMLElement>('.round')!;
    this.reload = ammo.querySelector<HTMLElement>('.reload')!;
    this.reloadFill = this.reload.firstElementChild as HTMLElement;
  }

  /** Call once per tick. */
  update(c: Character, items: ItemDb, sim: SimState): void {
    const h = c.health;
    const pool = h.pool;
    this.vitals.classList.toggle('pooled', pool !== undefined);
    setHidden(this.bar, pool === undefined);
    if (pool !== undefined) {
      const hp = h.dead ? 0 : Math.ceil(h.hp[CHEST]!);
      if (hp !== this.barShown) {
        this.barShown = hp;
        const f = Math.max(0, Math.min(1, hp / pool));
        this.barFill.style.transform = `scaleX(${f})`;
        this.barFill.style.background = ZONE_COLORS[zoneColor(hp, pool)]!;
        this.barText.textContent = String(hp);
      }
    }
    for (let zone = 0; pool === undefined && zone < ZONE_COUNT; zone++) {
      const hp = Math.ceil(h.hp[zone]!);
      if (hp !== this.hpShown[zone]) {
        this.hpShown[zone] = hp;
        this.hpTexts[zone]!.textContent = String(hp);
      }
      const color = zoneColor(h.hp[zone]!, HEALTH.maxHp[zone]!);
      const shown = color + (h.bleeding[zone] ? 8 : 0);
      if (shown === this.zoneShown[zone]) continue;
      this.zoneShown[zone] = shown;
      const el = this.zones[zone]!;
      el.style.fill = ZONE_COLORS[color]!;
      el.classList.toggle('bleed', h.bleeding[zone]!);
    }

    // Chips change rarely, so rebuild them only when the set changes.
    const legs = (isBroken(h, LEFT_LEG) ? 1 : 0) + (isBroken(h, RIGHT_LEG) ? 1 : 0);
    const arms = (isBroken(h, LEFT_ARM) ? 1 : 0) + (isBroken(h, RIGHT_ARM) ? 1 : 0);
    const bleeding = isBleeding(h);
    const stomach = stomachBlacked(h);
    const key = `${legs}${arms}${bleeding ? 1 : 0}${stomach ? 1 : 0}`;
    if (key !== this.chipKey) {
      this.chipKey = key;
      const chips: string[] = [];
      if (bleeding) chips.push('<span class="chip bleed">🩸 bleeding</span>');
      if (legs) chips.push(`<span class="chip">🦴 ${legs === 2 ? 'both legs' : 'leg'}</span>`);
      if (arms) chips.push(`<span class="chip">🦴 ${arms === 2 ? 'both arms' : 'arm'}</span>`);
      if (stomach) chips.push('<span class="chip">🤢 stomach</span>');
      this.chips.innerHTML = chips.join('');
    }

    this.armor(this.helmet, c.gear.helmet, items);
    // Body armor, or an armored rig (2026-11-11).
    this.armor(this.vest, chestArmor(items, c.gear), items);

    const w = heldWeapon(c);
    setHidden(this.ammo, !w);
    if (w) {
      const id = loadedAmmo(items, w);
      // With magazines, what's in the ones in reach that fit (MG-1).
      setText(this.rounds, `${w.mag} / ${spareRounds(sim, c, items, w)}`);
      if (id !== this.roundId) {
        this.roundId = id;
        const def = roundOf(items, id)!;
        this.round.textContent = def.name;
        this.round.style.borderColor = levelColor(def.level);
      }
      this.rounds.classList.toggle('empty', w.mag === 0);
      setHidden(this.reload, w.reloading === 0);
      if (w.reloading > 0) {
        const done = 1 - w.reloading / weaponStats(items, w, stats).reloadTime;
        this.reloadFill.style.transform = `scaleX(${done})`;
      }
    }
  }

  private armor(el: HTMLElement, a: ArmorState | null, items: ItemDb): void {
    setHidden(el, !a);
    if (a) {
      const color = armorColor(a, items);
      if (el.dataset.color !== color) {
        el.dataset.color = color;
        el.style.color = color;
      }
    }
  }

  /** A red flash at the screen edges when you're hurt. */
  hurtFlash(): void {
    this.hurt.classList.remove('flash');
    // Restart the CSS animation.
    void this.hurt.offsetWidth;
    this.hurt.classList.add('flash');
  }
}
