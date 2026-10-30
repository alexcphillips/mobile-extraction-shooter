import {
  CARRIED_GRIDS,
  ammoDef,
  calibreOf,
  carriedAmmo,
  carriedGrid,
  heldWeapon,
  itemDef,
  loadedAmmo,
  medDef,
  treatments,
  timeToUse,
  weaponDef,
  type Character,
  type Hand,
  type ItemDb,
  type MedRef,
} from '@mes/shared';
import { levelColour } from '../ui/levels';
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
 * a gun. A long press on reload opens a picker of the rounds carried for the gun in hand.
 */
export class HandsHud {
  private readonly slotKeys = HANDS.map(() => '');
  private readonly ring: SVGCircleElement;
  private readonly healName: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly ammoPicker: HTMLElement;
  private best: MedRef | null = null;
  private healKey = '';
  private fireKey = '';
  private ticks = 0;

  constructor(
    private readonly hud: Hud,
    private readonly onPick: (ref: MedRef) => void,
    private readonly onPickAmmo: (ammo: string) => void,
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
    this.ammoPicker = document.createElement('div');
    this.ammoPicker.className = 'heal-picker';
    this.ammoPicker.hidden = true;
    hud.container.append(this.picker, this.ammoPicker);
    // A tap anywhere else closes the pickers.
    window.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as Node;
        if (!this.picker.contains(t) && !this.ammoPicker.contains(t)) this.hidePicker();
      },
      true,
    );
    // On desktop the cursor is free while it's open; Esc closes it too.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.hidePicker();
    });
  }

  get pickerOpen(): boolean {
    return !this.picker.hidden || !this.ammoPicker.hidden;
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

  /**
   * Opens the picker over the reload button: each round carried of the gun in hand's
   * calibre, highest level first, with how many; the one loaded is marked.
   */
  showAmmoPicker(c: Character, items: ItemDb): void {
    const w = heldWeapon(c);
    this.ammoPicker.replaceChildren();
    if (!w) return this.hidePicker();
    const calibre = calibreOf(items, weaponDef(items, w.item));
    const ids = new Set<string>();
    for (let i = 0; i < CARRIED_GRIDS; i++) {
      for (const g of carriedGrid(c.gear, i)?.items ?? []) {
        const def = itemDef(items, g.item.item);
        if (def.type === 'ammo' && def.calibre === calibre) ids.add(def.id);
      }
    }
    if (!ids.size) return this.hidePicker();
    const loaded = loadedAmmo(items, w);
    const rounds = [...ids].map((id) => ammoDef(items, id)).sort((a, b) => b.level - a.level);
    for (const def of rounds) {
      const b = document.createElement('button');
      const mark = def.id === loaded ? ' · loaded' : '';
      b.innerHTML =
        `<b><i class="level-tag" style="background:${levelColour(def.level)}">${def.level}</i>` +
        `${def.name}</b><span>${carriedAmmo(c, def.id)} carried · ${def.damage} damage${mark}</span>`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hidePicker();
        this.onPickAmmo(def.id);
      });
      this.ammoPicker.append(b);
    }
    const reload = this.hud.button('reload').getBoundingClientRect();
    this.ammoPicker.style.left = `${reload.left + reload.width / 2}px`;
    this.ammoPicker.style.bottom = `${window.innerHeight - reload.top + 8}px`;
    this.ammoPicker.hidden = false;
  }

  hidePicker(): void {
    this.picker.hidden = true;
    this.ammoPicker.hidden = true;
  }
}
