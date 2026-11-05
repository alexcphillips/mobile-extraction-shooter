import { POWERUPS, type ItemDb, type Powerup } from '@mes/shared';

/** What the in-game admin panel asks for; the raid does it straight after the next tick. */
export type ZombiesAdminAction =
  | { kind: 'powerup'; powerup: Powerup }
  | { kind: 'points'; amount: number }
  | { kind: 'gun'; item: string }
  | { kind: 'killAll' };

const POWERUP_LABELS: Record<Powerup, string> = {
  instaKill: 'Insta-kill',
  maxAmmo: 'Max ammo',
  doublePoints: 'Double points',
  carpenter: 'Carpenter',
  deathMachine: 'Death machine',
};

/**
 * Zombies mode's in-game admin panel (dev builds only, 2026-11-04, the user's call): an
 * Admin button (or K) opens buttons for each power-up, points, guns into your hands and
 * killing every zombie. While it's open you stand still and have the cursor, as with a
 * dev screen. Plain DOM, built once.
 */
export class ZombiesAdmin {
  readonly actions: ZombiesAdminAction[] = [];
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  open = false;

  constructor(
    items: ItemDb,
    guns: readonly string[],
    private readonly onOpen: (open: boolean) => void,
  ) {
    this.button = document.createElement('button');
    this.button.className = 'zombies-admin-button';
    this.button.textContent = 'Admin';
    this.button.title = 'Zombies admin (K)';
    // Not a click into the game (shooting, or locking the pointer).
    this.button.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.button.addEventListener('click', () => this.toggle());

    this.panel = document.createElement('div');
    this.panel.className = 'zombies-admin';
    this.panel.hidden = true;
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    const section = (title: string, buttons: [string, ZombiesAdminAction][]): void => {
      const h = document.createElement('h4');
      h.textContent = title;
      const row = document.createElement('div');
      for (const [label, action] of buttons) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => this.actions.push(action));
        row.append(b);
      }
      this.panel.append(h, row);
    };
    section(
      'Power-ups',
      POWERUPS.map((p) => [POWERUP_LABELS[p], { kind: 'powerup', powerup: p }]),
    );
    section('Points', [
      ['+1,000', { kind: 'points', amount: 1000 }],
      ['+10,000', { kind: 'points', amount: 10000 }],
    ]);
    section(
      'Guns',
      guns.map((id) => [items.get(id)?.name ?? id, { kind: 'gun', item: id }]),
    );
    section('Zombies', [['Kill them all', { kind: 'killAll' }]]);
    const close = document.createElement('button');
    close.className = 'zombies-admin-close';
    close.textContent = 'Close (K)';
    close.addEventListener('click', () => this.toggle());
    this.panel.append(close);
    document.body.append(this.button, this.panel);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyK' && !e.repeat) this.toggle();
    });
  }

  toggle(): void {
    this.open = !this.open;
    this.panel.hidden = !this.open;
    this.onOpen(this.open);
  }
}
