import { settings } from '../settings';
import { firstPad } from './gamepad';
import { inputMode } from './mode';
import { Rumbler, blastPulse, firePulse, hitPulse, type Pulse } from './rumble';

/**
 * The raid's rumble (CP-3): only while the pad is what you're playing with and the Rumble
 * setting is on. The play screen calls these from its event loop for your own character.
 */
export class PadRumble {
  private readonly rumbler = new Rumbler();
  private readonly pulse: Pulse = { strong: 0, weak: 0, ms: 0 };

  /** You fired a gun kicking `kickUp` (its recoil.up). */
  fired(kickUp: number, now: number): void {
    if (this.on()) this.play(firePulse(kickUp, this.pulse), now);
  }

  /** You lost `amount` HP to a hit, a fall or a blast. */
  hurt(amount: number, now: number): void {
    if (this.on()) this.play(hitPulse(amount, this.pulse), now);
  }

  /** Something blew up `distance` meters from you, with a damage radius `radius`. */
  blast(distance: number, radius: number, now: number): void {
    if (this.on()) this.play(blastPulse(distance, radius, this.pulse), now);
  }

  private on(): boolean {
    return inputMode.gamepad && settings.current.rumble;
  }

  private play(p: Pulse, now: number): void {
    if (p.ms <= 0) return;
    this.rumbler.play(firstPad(navigator.getGamepads()), p, now);
  }
}
