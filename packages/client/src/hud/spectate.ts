/*
 * The bar shown while spectating a teammate after dying in a party raid (docs/coop.md,
 * C8): whose eyes you're watching through, the one before and after, and Results to stop.
 * Buttons, so it works the same with a finger or a freed mouse cursor.
 */

export class SpectateBar {
  private readonly root = document.createElement('div');
  private readonly name = document.createElement('span');

  constructor(onPrev: () => void, onNext: () => void, onLeave: () => void) {
    this.root.className = 'spectate';
    this.root.hidden = true;
    const button = (text: string, label: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', fn);
      return b;
    };
    const who = document.createElement('div');
    who.className = 'spectate-who';
    who.append('Spectating ', this.name);
    this.root.append(
      button('◀', 'Previous teammate', onPrev),
      who,
      button('▶', 'Next teammate', onNext),
      button('Results', 'Stop spectating and see the results', onLeave),
    );
    document.body.append(this.root);
  }

  show(name: string): void {
    this.name.textContent = name;
    this.root.hidden = false;
    document.body.classList.add('spectating');
  }

  hide(): void {
    this.root.hidden = true;
    document.body.classList.remove('spectating');
  }
}
