import {
  CARRIED_GRIDS,
  FIRE,
  carriedGrenade,
  carriedGrenades,
  carriedGrid,
  grenadeDef,
  grenadeEffect,
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
import type { ControlId } from './layout';

const svg = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="${path}"/></svg>`;
const RIFLE = svg('M1 9h14V8h3v1h5v2h-5l-1 1H9l-1 4H5l1-4H4l-2 2H1z');
const PISTOL = svg('M4 8h16v3h-8l-1 5H7l1-5H4z');
const KNIFE = svg('M2 14l2-2h7l11-3-2 3-7 2H4z');
const GRENADE = svg('M10 2h5v2h-1v2.1a7 7 0 1 1-4 0V4h-1zm6 1l4 3-1 1-4-3z');
const FLAME = svg('M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3 0-5 1-8z');

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

/** A picker entry: its name, a line under it, and what picking it does. */
type PickerEntry = [name: string, detail: string, pick: () => void];

/** What a grenade does, for the picker. */
function grenadeDoes(items: ItemDb, id: string): string {
  const def = grenadeDef(items, id);
  switch (grenadeEffect(def)) {
    case 'frag':
      return `blast, ${def.radius} m`;
    case 'flash':
      return `blinds, ${def.radius} m`;
    case 'smoke':
      return `smoke for ${def.smokeTime ?? 0} s`;
    case 'c4':
      return 'place it, then detonate';
    case 'molotov':
      return `spills fire, ${def.radius} m`;
  }
}

/**
 * The hand-slot buttons and the heal button, written straight to the DOM like the rest of
 * the HUD. Each slot shows what's in it, dimmed when empty and outlined when in hand. The
 * heal button shows the med a tap would use (greyed out when nothing helps), and a ring
 * fills while one is being used. A long press opens a picker of every carried med that
 * would help. The fire button says "knife" with the knife out; aim and reload dim without
 * a gun. The grenade button shows the kind a tap throws and how many of it are carried,
 * dimmed with none; a long press picks the kind (2026-10-31). The detonate button shows
 * only while you have C4 placed, and the put out button only while you're on fire, its
 * ring filling as you put yourself out.
 */
export class HandsHud {
  private readonly slotKeys = HANDS.map(() => '');
  private readonly ring: SVGCircleElement;
  private readonly outRing: SVGCircleElement;
  private burning = false;
  private patting = false;
  private readonly healName: HTMLElement;
  private readonly picker: HTMLElement;
  private best: MedRef | null = null;
  private healKey = '';
  private fireKey = '';
  private grenadeKey = '';
  private readonly grenadeCount: HTMLElement;
  private readonly grenadeName: HTMLElement;
  /** The kind of grenade picked, by item id; null throws the first carried. */
  private grenadePick: string | null = null;
  /** The kind a tap throws: the one picked while any are carried, else the first. */
  private grenadeNext: string | null = null;
  private armed = false;
  private ticks = 0;

  constructor(
    private readonly hud: Hud,
    private readonly onPick: (ref: MedRef) => void,
    /** Told the name of a grenade picked, to say so on screen as well. */
    private readonly onGrenadePick: (name: string) => void,
  ) {
    const heal = hud.button('heal');
    heal.innerHTML =
      '<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16.5" pathLength="1"/></svg>' +
      `${svg('M9 3h6v6h6v6h-6v6H9v-6H3V9h6z')}<span class="heal-name"></span>`;
    this.ring = heal.querySelector('circle')!;
    this.healName = heal.querySelector('.heal-name')!;
    const grenade = hud.button('grenade');
    grenade.innerHTML = `<span class="slot-num"></span>${GRENADE}<span class="heal-name"></span>`;
    this.grenadeCount = grenade.querySelector('.slot-num')!;
    this.grenadeName = grenade.querySelector('.heal-name')!;
    hud.button('detonate').classList.add('unarmed');
    const out = hud.button('extinguish');
    out.innerHTML =
      '<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16.5" pathLength="1"/></svg>' +
      `${FLAME}<span class="heal-name">put out</span>`;
    out.classList.add('unlit');
    this.outRing = out.querySelector('circle')!;
    this.picker = document.createElement('div');
    this.picker.className = 'heal-picker';
    this.picker.hidden = true;
    hud.container.append(this.picker);
    // A tap anywhere else closes the picker.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.picker.contains(e.target as Node)) this.hidePicker();
      },
      true,
    );
  }

  get pickerOpen(): boolean {
    return !this.picker.hidden;
  }

  /** The med a tap on the heal button uses, or null when nothing would help. */
  get choice(): MedRef | null {
    return this.best;
  }

  /** The grenade a tap on the grenade button throws, by item id, or null for any. */
  get grenadeChoice(): string | null {
    return this.grenadeNext;
  }

  /**
   * Call once per tick, with whether you have C4 placed. Works out the heal and grenade
   * buttons' choices about 10 times a second.
   */
  update(c: Character, items: ItemDb, armed: boolean): void {
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
    // The kind of grenade a tap throws and how many of it are carried, dimmed with none.
    if (this.ticks % 3 === 1) {
      const picked = this.grenadePick && carriedGrenades(c, items, this.grenadePick) > 0;
      const ref = picked ? null : carriedGrenade(c, items);
      this.grenadeNext = picked
        ? this.grenadePick
        : ref
          ? carriedGrid(c.gear, ref.grid)!.items[ref.index]!.item.item
          : null;
      const n = this.grenadeNext ? carriedGrenades(c, items, this.grenadeNext) : 0;
      const name = this.grenadeNext ? grenadeEffect(grenadeDef(items, this.grenadeNext)) : '';
      const key = `${name} ${n}`;
      if (key !== this.grenadeKey) {
        this.grenadeKey = key;
        this.grenadeCount.textContent = n ? String(n) : '';
        this.grenadeName.textContent = name;
        this.hud.button('grenade').classList.toggle('idle', n === 0);
      }
    }
    if (armed !== this.armed) {
      this.armed = armed;
      this.hud.button('detonate').classList.toggle('unarmed', !armed);
    }
    const burning = !!c.burn && !c.health.dead;
    const patting = burning && !!c.extinguish;
    if (burning !== this.burning || patting !== this.patting) {
      this.burning = burning;
      this.patting = patting;
      const out = this.hud.button('extinguish');
      out.classList.toggle('unlit', !burning);
      out.classList.toggle('using', patting);
    }
    if (patting) {
      const done = 1 - (c.extinguish ?? 0) / FIRE.extinguishTime;
      this.outRing.style.strokeDashoffset = String(1 - done);
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
    this.openPicker(
      'heal',
      treatments(c, items).map((ref): PickerEntry => {
        const def = medDef(items, ref.item);
        return [def.name, `${does(items, c, ref)} · ${def.useTime} s`, () => this.onPick(ref)];
      }),
    );
  }

  /** Opens the picker over the grenade button: each kind of grenade carried, and how many. */
  showGrenadePicker(c: Character, items: ItemDb): void {
    const counts = new Map<string, number>();
    for (let g = 0; g < CARRIED_GRIDS; g++) {
      for (const gi of carriedGrid(c.gear, g)?.items ?? []) {
        const id = gi.item.item;
        if (items.get(id)?.type === 'grenade') counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    this.openPicker(
      'grenade',
      [...counts].map(([id, n]): PickerEntry => {
        const name = grenadeDef(items, id).name;
        return [
          name,
          `${grenadeDoes(items, id)} · ${n} carried`,
          () => {
            this.grenadePick = id;
            // Shown straight away, not at the next refresh.
            this.grenadeNext = id;
            this.grenadeKey = '';
            this.onGrenadePick(name);
          },
        ];
      }),
    );
  }

  /**
   * Opens the picker over a button with these entries; none closes it. Over the middle of
   * the screen when the button is hidden.
   */
  private openPicker(anchor: ControlId, entries: PickerEntry[]): void {
    this.picker.replaceChildren();
    if (!entries.length) {
      this.hidePicker();
      return;
    }
    for (const [name, detail, pick] of entries) {
      const b = document.createElement('button');
      b.innerHTML = `<b>${name}</b><span>${detail}</span>`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hidePicker();
        pick();
      });
      this.picker.append(b);
    }
    const at = this.hud.button(anchor).getBoundingClientRect();
    const shown = at.width > 0;
    this.picker.style.left = `${shown ? at.left + at.width / 2 : window.innerWidth / 2}px`;
    this.picker.style.bottom = `${window.innerHeight - (shown ? at.top : window.innerHeight / 2) + 8}px`;
    this.picker.hidden = false;
    // Kept on screen: a long list over a button high up would run off the top.
    const top = this.picker.getBoundingClientRect().top;
    if (top < 8) this.picker.style.bottom = `${parseFloat(this.picker.style.bottom) + top - 8}px`;
  }

  hidePicker(): void {
    this.picker.hidden = true;
  }
}
