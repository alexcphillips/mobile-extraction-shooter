import {
  carriedGrid,
  heldWeapon,
  itemDef,
  medDef,
  treatments,
  timeToUse,
  type Character,
  type Hand,
  type ItemDb,
  type MedRef,
} from '@mes/shared';
import type { Hud } from './hud';

const svg = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="${path}"/></svg>`;
const RIFLE = svg('M1 9h14V8h3v1h5v2h-5l-1 1H9l-1 4H5l1-4H4l-2 2H1z');
const PISTOL = svg('M4 8h16v3h-8l-1 5H7l1-5H4z');
const KNIFE = svg('M2 14l2-2h7l11-3-2 3-7 2H4z');

const HANDS: readonly Hand[] = ['primary1', 'primary2', 'sidearm', 'knife'];

/** What a med would do, for the picker. */
function does(items: ItemDb, c: Character, ref: MedRef): string {
  const def = medDef(items, ref.item);
  switch (def.effect) {
    case 'bandage':
      return 'stops bleeding';
    case 'splint':
      return 'splints a broken limb';
    case 'surgery':
      return 'mends a broken limb';
    case 'heal': {
      const hp = carriedGrid(c.gear, ref.grid)?.items[ref.index]?.item.left ?? def.hp ?? 0;
      return `heals, ${Math.round(hp)} HP left`;
    }
  }
}

/**
 * The hand-slot buttons and the heal button, written straight to the DOM like the rest of
 * the HUD. Each slot shows what's in it, dimmed when empty and outlined when in hand. The
 * heal button shows the med a tap would use (greyed out when nothing helps), and a ring
 * fills while one is being used. A long press opens a picker of every carried med that
 * would help. The fire button says "knife" with the knife out; aim and reload dim without
 * a gun.
 */
export class HandsHud {
  private readonly slotKeys = HANDS.map(() => '');
  private readonly ring: SVGCircleElement;
  private readonly healName: HTMLElement;
  private readonly picker: HTMLElement;
  private best: MedRef | null = null;
  private healKey = '';
  private fireKey = '';
  private ticks = 0;

  constructor(
    private readonly hud: Hud,
    private readonly onPick: (ref: MedRef) => void,
  ) {
    const heal = hud.button('heal');
    heal.innerHTML =
      '<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16.5" pathLength="1"/></svg>' +
      `${svg('M9 3h6v6h6v6h-6v6H9v-6H3V9h6z')}<span class="heal-name"></span>`;
    this.ring = heal.querySelector('circle')!;
    this.healName = heal.querySelector('.heal-name')!;
    this.picker = document.createElement('div');
    this.picker.className = 'heal-picker';
    this.picker.hidden = true;
    hud.container.append(this.picker);
    // A tap anywhere else closes the picker.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.picker.hidden && !this.picker.contains(e.target as Node)) this.hidePicker();
      },
      true,
    );
  }

  /** The med a tap on the heal button uses, or null when nothing would help. */
  get choice(): MedRef | null {
    return this.best;
  }

  /** Call once per tick. Works out the heal button's choice about 10 times a second. */
  update(c: Character, items: ItemDb): void {
    const g = c.gear;
    HANDS.forEach((hand, i) => {
      const it = g[hand];
      const key = `${it?.item ?? ''} ${g.hand === hand}`;
      if (key === this.slotKeys[i]) return;
      this.slotKeys[i] = key;
      const b = this.hud.button(hand);
      const def = it ? itemDef(items, it.item) : null;
      const icon = !def
        ? ''
        : def.type === 'melee'
          ? KNIFE
          : def.type === 'weapon' && def.hold === 'pistol'
            ? PISTOL
            : RIFLE;
      b.innerHTML = `<span class="slot-num">${i + 1}</span>${icon}`;
      b.classList.toggle('idle', !it);
      b.classList.toggle('in-hand', !!it && g.hand === hand);
    });

    if (this.ticks++ % 3 === 0 || c.using) {
      this.best = c.health.dead ? null : (treatments(c, items)[0] ?? null);
    }
    const name = c.using
      ? itemDef(items, c.using.item).name
      : this.best
        ? medDef(items, this.best.item).name
        : '';
    const healKey = `${name} ${!!c.using} ${!this.best && !c.using}`;
    if (healKey !== this.healKey) {
      this.healKey = healKey;
      this.healName.textContent = name.toLowerCase();
      const heal = this.hud.button('heal');
      heal.classList.toggle('idle', !this.best && !c.using);
      heal.classList.toggle('using', !!c.using);
    }
    if (c.using) {
      const done = 1 - c.using.left / timeToUse(items, c.using.item);
      this.ring.style.strokeDashoffset = String(1 - done);
    }

    const gun = !!heldWeapon(c);
    const knife = g.hand === 'knife' && !!g.knife;
    const fireKey = `${gun} ${knife}`;
    if (fireKey !== this.fireKey) {
      this.fireKey = fireKey;
      this.hud.button('fire').textContent = knife ? 'knife' : 'fire';
      this.hud.button('aim').classList.toggle('idle', !gun);
      this.hud.button('reload').classList.toggle('idle', !gun);
    }
  }

  /** Opens the picker over the heal button: every carried med that would help now. */
  showPicker(c: Character, items: ItemDb): void {
    const options = treatments(c, items);
    this.picker.replaceChildren();
    if (!options.length) {
      this.hidePicker();
      return;
    }
    for (const ref of options) {
      const b = document.createElement('button');
      const def = medDef(items, ref.item);
      b.innerHTML = `<b>${def.name}</b><span>${does(items, c, ref)} · ${def.useTime} s</span>`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hidePicker();
        this.onPick(ref);
      });
      this.picker.append(b);
    }
    const heal = this.hud.button('heal').getBoundingClientRect();
    this.picker.style.left = `${heal.left + heal.width / 2}px`;
    this.picker.style.bottom = `${window.innerHeight - heal.top + 8}px`;
    this.picker.hidden = false;
  }

  hidePicker(): void {
    this.picker.hidden = true;
  }
}
