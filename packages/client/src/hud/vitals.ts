import {
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_ARM,
  RIGHT_LEG,
  TOTAL_HP,
  isBleeding,
  isBroken,
  totalHp,
  createWeaponStats,
  weaponStats,
  type ArmourState,
  type Character,
  type ItemDb,
  heldWeapon,
  carriedAmmo,
  roundOf,
  loadedAmmo,
} from '@mes/shared';
import { levelColour } from '../ui/levels';
import { armourColour } from './armour';

const HELMET_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 15a9 9 0 0 1 18 0v2H3z M2 17h20v2H2z"/></svg>';
const stats = createWeaponStats();

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
 * The player's status, written straight to the DOM (never through React): the overall
 * health bar, chips for broken limbs and bleeding, armour icons coloured by durability,
 * and the ammo count with the round loaded (coloured by level) and a reload bar. Also the crosshair hit marker and a red flash when
 * hurt.
 */
export class Vitals {
  private readonly bar: HTMLElement;
  private readonly hp: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly helmet: HTMLElement;
  private readonly vest: HTMLElement;
  private readonly rounds: HTMLElement;
  private readonly round: HTMLElement;
  private roundId = '';
  private readonly reload: HTMLElement;
  private readonly reloadFill: HTMLElement;
  private chipKey = '';
  private shownTotal = -1;
  private markerUntil = 0;

  constructor(
    vitals: HTMLElement,
    private readonly ammo: HTMLElement,
    private readonly crosshair: HTMLElement,
    private readonly hurt: HTMLElement,
  ) {
    vitals.innerHTML = `
      <div class="vitals-row">
        <span class="armour helmet">${HELMET_ICON}</span>
        <span class="armour vest">${VEST_ICON}</span>
        <div class="health"><div class="health-fill"></div><span class="health-text"></span></div>
      </div>
      <div class="chips"></div>`;
    const q = (sel: string): HTMLElement => vitals.querySelector<HTMLElement>(sel)!;
    this.bar = q('.health-fill');
    this.hp = q('.health-text');
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
  update(c: Character, items: ItemDb, now: number): void {
    const h = c.health;
    // Dead at 0 head or chest HP, with HP left in the limbs: the bar shows 0, not what's left.
    const total = h.dead ? 0 : totalHp(h);
    if (total !== this.shownTotal) {
      this.shownTotal = total;
      this.bar.style.transform = `scaleX(${total / TOTAL_HP})`;
      this.bar.classList.toggle('low', total < TOTAL_HP * 0.35);
      setText(this.hp, String(Math.ceil(total)));
    }

    // Chips change rarely, so rebuild them only when the set changes.
    const legs = (isBroken(h, LEFT_LEG) ? 1 : 0) + (isBroken(h, RIGHT_LEG) ? 1 : 0);
    const arms = (isBroken(h, LEFT_ARM) ? 1 : 0) + (isBroken(h, RIGHT_ARM) ? 1 : 0);
    const bleeding = isBleeding(h);
    const key = `${legs}${arms}${bleeding ? 1 : 0}`;
    if (key !== this.chipKey) {
      this.chipKey = key;
      const chips: string[] = [];
      if (bleeding) chips.push('<span class="chip bleed">🩸 bleeding</span>');
      if (legs) chips.push(`<span class="chip">🦴 ${legs === 2 ? 'both legs' : 'leg'}</span>`);
      if (arms) chips.push(`<span class="chip">🦴 ${arms === 2 ? 'both arms' : 'arm'}</span>`);
      this.chips.innerHTML = chips.join('');
    }

    this.armour(this.helmet, c.gear.helmet, items);
    this.armour(this.vest, c.gear.bodyArmour, items);

    const w = heldWeapon(c);
    setHidden(this.ammo, !w);
    if (w) {
      const id = loadedAmmo(items, w);
      setText(this.rounds, `${w.mag} / ${carriedAmmo(c, id)}`);
      if (id !== this.roundId) {
        this.roundId = id;
        const def = roundOf(items, id)!;
        this.round.textContent = def.name;
        this.round.style.borderColor = levelColour(def.level);
      }
      this.rounds.classList.toggle('empty', w.mag === 0);
      setHidden(this.reload, w.reloading === 0);
      if (w.reloading > 0) {
        const done = 1 - w.reloading / weaponStats(items, w, stats).reloadTime;
        this.reloadFill.style.transform = `scaleX(${done})`;
      }
    }

    if (this.markerUntil && now > this.markerUntil) {
      this.markerUntil = 0;
      this.crosshair.classList.remove('hit', 'kill');
    }
  }

  private armour(el: HTMLElement, a: ArmourState | null, items: ItemDb): void {
    setHidden(el, !a);
    if (a) {
      const colour = armourColour(a, items);
      if (el.dataset.colour !== colour) {
        el.dataset.colour = colour;
        el.style.color = colour;
      }
    }
  }

  /** The crosshair flashes when your shot lands, and more on a kill. */
  hitMarker(now: number, kill: boolean): void {
    this.crosshair.classList.add(kill ? 'kill' : 'hit');
    this.markerUntil = now + (kill ? 400 : 120);
  }

  /** A red flash at the screen edges when you're hurt. */
  hurtFlash(): void {
    this.hurt.classList.remove('flash');
    // Restart the CSS animation.
    void this.hurt.offsetWidth;
    this.hurt.classList.add('flash');
  }
}
