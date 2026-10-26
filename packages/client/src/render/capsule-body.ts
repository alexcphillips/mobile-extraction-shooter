import {
  HEALTH,
  HIT_CAPSULES,
  MOVEMENT,
  ZONE_COUNT,
  isBroken,
  type Character,
  type ItemDb,
  type Zone,
} from '@mes/shared';
import * as THREE from 'three';
import { armourColour } from '../hud/armour';

const FULL = new THREE.Color(0x4caf50);
const HALF = new THREE.Color(0xf1c40f);
const LOW = new THREE.Color(0xe74c3c);
const BROKEN = new THREE.Color(0x2b2b2b);
const DEAD = new THREE.Color(0x777777);

/**
 * Draws characters as their hit-zone capsules, each coloured by its HP, plus boxes for
 * worn armour. A debug view (?hitzones), drawn see-through over the real bodies to check
 * they're posed to match.
 */
export class CapsuleBody {
  readonly root = new THREE.Group();
  private readonly zones: THREE.MeshBasicMaterial[] = [];
  private readonly helmet: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly vest: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;

  constructor(opacity = 1) {
    this.root.rotation.order = 'YXZ';
    const see = opacity < 1 ? { transparent: true, opacity, depthWrite: false } : {};
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const cap of HIT_CAPSULES) {
      // In three.js local +z is backwards, so forward is −z.
      a.set(cap.a[0], cap.a[1], -cap.a[2]);
      b.set(cap.b[0], cap.b[1], -cap.b[2]);
      const material = (this.zones[cap.zone] ??= new THREE.MeshBasicMaterial({
        color: FULL,
        ...see,
      }));
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(cap.radius, a.distanceTo(b), 2, 8),
        material,
      );
      // Capsule geometry runs along y: place it at the middle and turn y onto the axis.
      mesh.position.addVectors(a, b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
      this.root.add(mesh);
    }
    this.helmet = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.14, 0.32),
      new THREE.MeshBasicMaterial(see),
    );
    this.helmet.position.set(0, 1.7, -0.02);
    this.vest = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.42, 0.42),
      new THREE.MeshBasicMaterial(see),
    );
    this.vest.position.set(0, 1.18, 0);
    this.root.add(this.helmet, this.vest);
  }

  update(c: Character, items: ItemDb): void {
    // The dead lie on their backs, raised so the capsules don't sink into the ground.
    this.root.position.set(c.x, c.y + (c.health.dead ? 0.2 : 0), c.z);
    this.root.rotation.y = c.yaw;
    const h = c.health;
    this.root.rotation.x = h.dead ? Math.PI / 2 : 0;
    this.root.scale.y = c.height / MOVEMENT.standHeight;
    for (let zone = 0; zone < ZONE_COUNT; zone++) {
      const colour = this.zones[zone]!.color;
      const left = h.hp[zone]! / HEALTH.maxHp[zone]!;
      if (h.dead) colour.copy(DEAD);
      else if (isBroken(h, zone as Zone)) colour.copy(BROKEN);
      else if (left > 0.5) colour.lerpColors(HALF, FULL, (left - 0.5) * 2);
      else colour.lerpColors(LOW, HALF, left * 2);
    }
    this.helmet.visible = !!c.gear.helmet;
    if (c.gear.helmet) this.helmet.material.color.set(armourColour(c.gear.helmet, items));
    this.vest.visible = !!c.gear.bodyArmour;
    if (c.gear.bodyArmour) this.vest.material.color.set(armourColour(c.gear.bodyArmour, items));
  }
}
