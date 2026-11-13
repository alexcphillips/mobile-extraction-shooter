import {
  MOVEMENT,
  TICK_SECONDS,
  entityById,
  eyeHeight,
  grenadeDef,
  heldWeapon,
  itemDef,
  itemSounds,
  meleeDef,
  weaponDef,
  type Character,
  type CollisionWorld,
  type EnemyDef,
  type EntityId,
  type ItemDb,
  type SimEvent,
  type SimState,
} from '@mes/shared';
import { GAME_SOUNDS as S } from './sound-ids';
import type { PlaceOptions, SoundPlayer } from './sounds';

/** A shot this much quieter than its gun's own loudness (or more) sounds suppressed. */
const SUPPRESSED = 0.75;
/** A switch's noise is at its quietest this loud, this far from it (meters) or further. */
const NOISE_FLOOR = 0.5;
const NOISE_FAR = 80;
/** An enemy's bullet passing within this of the player's head whizzes. */
const WHIZZ = 2;

/** Footsteps: a step every (base + per m/s × speed) meters; how far each carries, and how loud. */
const STEP = {
  base: 1.1,
  perSpeed: 0.1,
  /** Slower than this is shuffling, which makes no sound. */
  minSpeed: 0.5,
  /** Faster than this is sprinting (walking with the knife out is 3.85 m/s). */
  sprinting: 4.5,
  crouch: { range: 8, gain: 0.3 },
  walk: { range: 20, gain: 0.6 },
  sprint: { range: 35, gain: 1 },
  /** Your own, heard less than others'. */
  own: 0.45,
  /** An enemy type's own steps (Jug's) carry this many times as far, at full loudness. */
  heavy: 1.5,
  /** A ladder step every this much climbed. */
  rung: 0.5,
  /** Landing faster than this (m/s) thuds, louder up to `hard`. */
  land: 3,
  hard: 10,
} as const;

/** How high on a body its sounds come from: the chest. */
const CHEST = 1.3;

interface Track {
  stride: number;
  climbed: number;
  reloading: boolean;
  using: string | null;
  draw: number;
}

/**
 * What the raid sounds like (session 19): after each tick, the sim's events and the
 * changes it doesn't report (footsteps, reloads, meds starting, the extraction countdown)
 * become sounds. The player's own are played centered; everyone else's from where they
 * happen, muffled when the map is in the way.
 */
export class SoundCues {
  private readonly tracks = new Map<EntityId, Track>();
  /** The extraction countdown's last whole second sounded, or 0 outside one. */
  private extractSecond = 0;
  private warned = false;
  private hurtTick = -Infinity;
  private readonly options: PlaceOptions = {};
  /** When each noise (by its id) next starts again. */
  private readonly noiseAt = new Map<number, number>();

  constructor(
    private readonly sound: SoundPlayer,
    private readonly world: CollisionWorld,
    private readonly items: ItemDb,
    /** Enemy types by id, for their voice lines. */
    private readonly enemies: ReadonlyMap<string, EnemyDef> = new Map(),
  ) {}

  /** After each tick, with the player's look (the sim's yaw lags the controls'). */
  tick(sim: SimState, player: Character, yaw: number): void {
    const l = this.sound.listener;
    l.x = player.x;
    l.y = eyeHeight(player);
    l.z = player.z;
    l.yaw = yaw;
    for (const e of sim.events) this.event(sim, player, e);
    this.noises(sim, player);
    for (const c of sim.entities) if (!c.health.dead) this.watch(c, c === player);
    this.raid(sim, player);
  }

  /**
   * A switch's noises, repeated end to end while they last. Heard all over the map, so not
   * placed: louder near it, but never so quiet you'd miss it.
   */
  private noises(sim: SimState, player: Character): void {
    const now = sim.tick * TICK_SECONDS;
    for (const n of sim.noises) {
      if (now < (this.noiseAt.get(n.id) ?? 0)) continue;
      const near = 1 - Math.min(1, Math.hypot(n.x - player.x, n.z - player.z) / NOISE_FAR);
      this.sound.play(n.sound, NOISE_FLOOR + (1 - NOISE_FLOOR) * near);
      this.noiseAt.set(n.id, now + this.sound.duration(n.sound));
    }
  }

  private event(sim: SimState, player: Character, e: SimEvent): void {
    const own = 'by' in e && e.by === player.id;
    switch (e.type) {
      case 'shot': {
        const shooter = entityById(sim, e.by);
        const w = shooter && heldWeapon(shooter);
        // A shotgun's pellets are one bang and one whizz.
        if (w && e.pellet === 0) {
          const def = weaponDef(this.items, w.item);
          const id =
            e.loudness < def.loudness * SUPPRESSED ? def.sounds.suppressed : def.sounds.shot;
          if (own) this.sound.play(id);
          else this.at(id, e.fromX, e.fromY, e.fromZ, e.loudness);
        }
        // A launched grenade doesn't whizz; it's heard when it bounces and goes off. Nor
        // does a flame: it's heard as it's fired, and when it sets someone alight.
        if (!own && e.target !== player.id && e.pellet === 0 && !e.grenade && !e.flame)
          this.whizz(e.fromX, e.fromY, e.fromZ, e.toX, e.toY, e.toZ);
        if (e.hit === 'world') this.at(S.impactWorld, e.toX, e.toY, e.toZ);
        else if (e.hit === 'character' && e.target !== player.id)
          this.at(S.impactFlesh, e.toX, e.toY, e.toZ);
        return;
      }
      case 'swing': {
        const swinger = entityById(sim, e.by);
        const knife = swinger?.gear.knife;
        if (knife) {
          const id = meleeDef(this.items, knife.item).sounds.swing;
          if (own) this.sound.play(id);
          else if (swinger) this.at(id, swinger.x, swinger.y + CHEST, swinger.z);
        }
        if (e.hit === 'world') this.at(S.impactWorld, e.x, e.y, e.z, undefined, 0.6);
        else if (e.hit === 'character' && e.target !== player.id)
          this.at(S.impactFlesh, e.x, e.y, e.z);
        return;
      }
      case 'throw': {
        const id = grenadeDef(this.items, e.item).sounds.throw;
        const thrower = entityById(sim, e.by);
        if (own) this.sound.play(id);
        else if (thrower) this.at(id, thrower.x, thrower.y + CHEST, thrower.z);
        // An enemy shouts as it throws (AI-6), in its type's voice.
        const shout = thrower?.look && this.enemies.get(thrower.look.type)?.voice?.grenade;
        if (thrower && shout)
          this.at(shout, thrower.x, thrower.y + MOVEMENT.standHeight - 0.2, thrower.z);
        return;
      }
      case 'bounce': {
        // Louder the harder it hits, up to a hard throw's.
        const gain = Math.min(1, 0.3 + e.speed / 12);
        this.at(grenadeDef(this.items, e.item).sounds.bounce, e.x, e.y, e.z, undefined, gain);
        return;
      }
      case 'explosion':
        this.at(grenadeDef(this.items, e.item).sounds.explode, e.x, e.y, e.z, e.loudness);
        return;
      case 'ignite':
        if (e.target === player.id) this.sound.play(S.ignite);
        else this.at(S.ignite, e.x, e.y + CHEST, e.z);
        return;
      case 'damage': {
        if (e.cause === 'fall') return;
        const target = entityById(sim, e.target);
        if (target && e.absorbed > 0) {
          if (e.target === player.id) this.sound.play(S.impactArmor);
          else this.at(S.impactArmor, target.x, target.y + CHEST, target.z);
        }
        if (e.target !== player.id) return;
        // Being hit (TU-1): the thud of the round or blade, and a grunt, on any hit, even one
        // doing no damage. Several hits in one burst (or one blast's zones) make one of each.
        if (sim.tick - this.hurtTick > 0.25 / TICK_SECONDS) {
          this.hurtTick = sim.tick;
          if (e.cause !== 'explosion') this.sound.play(S.impactFlesh);
          this.sound.play(S.hurt);
        }
        return;
      }
      case 'death': {
        if (e.target === player.id) return this.sound.play(S.death);
        const body = entityById(sim, e.target);
        if (body) this.at(S.bodyFall, body.x, body.y + 0.3, body.z);
        return;
      }
      case 'door': {
        const d = this.world.doors[e.door];
        if (!d) return;
        if (e.result === 'blocked') {
          if (own) this.sound.play(S.refuse);
          return;
        }
        const id = {
          opened: S.doorOpen,
          closed: S.doorClose,
          locked: S.doorLocked,
          unlocked: S.doorUnlock,
          kicked: S.doorKick,
          // Zombies mode: bought with points, or not enough of them.
          bought: S.doorUnlock,
          poor: S.doorLocked,
        }[e.result];
        this.at(id, d.x, d.y + d.height / 2, d.z);
        return;
      }
      case 'switch': {
        const s = this.world.switches[e.index];
        if (s) this.at(S.doorUnlock, s.x, s.y + 1, s.z);
        return;
      }
      case 'doorSwitched': {
        const d = this.world.doors[e.door];
        if (d && e.sound) this.at(e.sound, d.x, d.y + d.height / 2, d.z);
        return;
      }
      case 'glass':
        this.at(S.glassBreak, e.x, e.y, e.z);
        return;
      case 'inventory':
        if (own) this.sound.play(e.ok ? S.itemMove : S.refuse);
        return;
      case 'investigate':
        if (own) this.sound.play(S.investigate);
        return;
      case 'buy':
        // Zombies mode: paid (the till), the box's gun taken, or refused.
        if (!own) return;
        if (e.result === 'taken') this.sound.play(S.itemMove);
        else {
          const paid = e.result === 'bought' || e.result === 'ammo' || e.result === 'rolled';
          this.sound.play(paid ? S.cash : S.refuse);
        }
        return;
      case 'plank': {
        // Nailed up, or torn off, at the window.
        const w = sim.zombies?.windows[e.window];
        if (w) this.at(e.added ? S.doorClose : S.doorLocked, w.x, w.y + w.height / 2, w.z);
        return;
      }
      case 'powerup':
        // Zombies mode: one turning up where a zombie fell, and one picked up.
        if (e.what === 'dropped') this.at(S.investigate, e.x, e.y + 1, e.z);
        else if (e.what === 'picked') this.sound.play(S.extracted);
        return;
      case 'round':
        this.sound.play(e.started ? S.timerWarning : S.extracted);
        return;
      case 'leave':
        if (own && e.how === 'extracted') this.sound.play(S.extracted);
        return;
      case 'callout': {
        // A PMC shouting that it has seen someone (AI rework session 5), in its type's voice.
        const caller = entityById(sim, e.by);
        const id = caller?.look && this.enemies.get(caller.look.type)?.voice?.callout;
        if (caller && id) this.at(id, caller.x, caller.y + MOVEMENT.standHeight - 0.2, caller.z);
        return;
      }
      case 'pain': {
        // A blacked stomach groaning (GZ-3): yours in your head, anyone else's where they are.
        const who = entityById(sim, e.by);
        if (own) this.sound.play(S.pain);
        else if (who) this.at(S.pain, who.x, who.y + MOVEMENT.standHeight - 0.2, who.z);
        return;
      }
      case 'voice': {
        // Jug breathing or muttering through his mask (AI-8), in his type's voice.
        const who = entityById(sim, e.by);
        const id = who?.look && this.enemies.get(who.look.type)?.voice?.[e.line];
        if (who && id) this.at(id, who.x, who.y + MOVEMENT.standHeight - 0.2, who.z);
        return;
      }
    }
  }

  /** What changed on a character that the sim has no event for. */
  private watch(c: Character, own: boolean): void {
    let t = this.tracks.get(c.id);
    if (!t) {
      t = { stride: 0, climbed: 0, reloading: false, using: null, draw: 0 };
      this.tracks.set(c.id, t);
    }
    const speed = Math.hypot(c.vx, c.vz);
    if (c.mode === 'ground' && speed > STEP.minSpeed) {
      t.stride += speed * TICK_SECONDS;
      const length = STEP.base + STEP.perSpeed * speed;
      if (t.stride >= length) {
        t.stride -= length;
        const crouched = c.height < MOVEMENT.standHeight - 0.1;
        const kind = crouched ? STEP.crouch : speed > STEP.sprinting ? STEP.sprint : STEP.walk;
        // An enemy type's own steps (AI-8: Jug's clanking plates) carry further.
        const steps = c.look && this.enemies.get(c.look.type)?.steps;
        if (own) this.sound.play(S.footstep, kind.gain * STEP.own);
        else if (steps) this.at(steps, c.x, c.y + 0.5, c.z, kind.range * STEP.heavy, 1);
        else this.at(S.footstep, c.x, c.y + 0.1, c.z, kind.range, kind.gain);
      }
    } else if (c.mode !== 'ladder') {
      // The first step after standing still comes soon.
      t.stride = STEP.base / 2;
    }
    if (c.landingSpeed > STEP.land) {
      const gain = Math.min(
        1,
        0.3 + (0.7 * (c.landingSpeed - STEP.land)) / (STEP.hard - STEP.land),
      );
      if (own) this.sound.play(S.land, gain);
      else this.at(S.land, c.x, c.y, c.z, undefined, gain);
    }
    if (c.mode === 'ladder') {
      t.climbed += Math.abs(c.vy) * TICK_SECONDS;
      if (t.climbed >= STEP.rung) {
        t.climbed -= STEP.rung;
        if (own) this.sound.play(S.ladder);
        else this.at(S.ladder, c.x, c.y + 1, c.z);
      }
    }

    const w = heldWeapon(c);
    const reloading = !!w && w.reloading > 0;
    if (reloading && !t.reloading) {
      const id = weaponDef(this.items, w.item).sounds.reload;
      if (own) this.sound.play(id);
      else this.at(id, c.x, c.y + CHEST, c.z);
    }
    t.reloading = reloading;

    const using = c.using?.item ?? null;
    if (using && using !== t.using) {
      const id = itemSounds(itemDef(this.items, using)).use;
      if (id && own) this.sound.play(id);
      else if (id) this.at(id, c.x, c.y + CHEST, c.z);
    }
    t.using = using;

    if (own && c.draw > t.draw) this.sound.play(S.draw);
    t.draw = c.draw;
  }

  /** The extraction countdown and the timer running low. */
  private raid(sim: SimState, player: Character): void {
    if (player.extracting > 0) {
      const second = Math.floor(player.extracting) + 1;
      if (second > this.extractSecond) this.sound.play(S.extractTick);
      this.extractSecond = second;
    } else this.extractSecond = 0;
    const raid = sim.raid;
    if (raid && !this.warned && (raid.endTick - sim.tick) * TICK_SECONDS < 120) {
      this.warned = true;
      this.sound.play(S.timerWarning);
    }
  }

  /** A bullet passing near the player's head: whizzes from the nearest point. */
  private whizz(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const l = this.sound.listener;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-6) return;
    const u = Math.max(
      0,
      Math.min(1, ((l.x - ax) * dx + (l.y - ay) * dy + (l.z - az) * dz) / len2),
    );
    const px = ax + dx * u;
    const py = ay + dy * u;
    const pz = az + dz * u;
    const d = Math.hypot(px - l.x, py - l.y, pz - l.z);
    // Not one stopping short of the player, or passing beyond.
    if (d < WHIZZ && u > 0 && u < 1) this.sound.playAt(S.whizz, px, py, pz, { range: WHIZZ * 2 });
  }

  /** Plays at a place, muffled if the map is between it and the player. */
  private at(id: string, x: number, y: number, z: number, range?: number, gain?: number): void {
    const o = this.options;
    o.range = range;
    o.gain = gain;
    o.occluded = this.occluded(x, y, z);
    this.sound.playAt(id, x, y, z, o);
  }

  private occluded(x: number, y: number, z: number): boolean {
    const l = this.sound.listener;
    const dx = x - l.x;
    const dy = y - l.y;
    const dz = z - l.z;
    const d = Math.hypot(dx, dy, dz);
    // Stopping short, so the wall a bullet hit doesn't hide its own impact.
    const reach = d - 0.3;
    if (reach <= 0) return false;
    return this.world.raycast(l.x, l.y, l.z, dx / d, dy / d, dz / d, reach) < reach;
  }
}
