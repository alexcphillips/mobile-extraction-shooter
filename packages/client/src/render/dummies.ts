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
 * worn armour. A debug stand-in for target dummies until session 8b draws real bodies.
 */
export class CapsuleBody {
  readonly root = new THREE.Group();
  private readonly zones: THREE.MeshBasicMaterial[] = [];
  private readonly helmet: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly vest: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    this.root.rotation.order = 'YXZ';
    for (const cap of HIT_CAPSULES) {
      const len = Math.hypot(cap.b[0] - cap.a[0], cap.b[1] - cap.a[1], cap.b[2] - cap.a[2]);
      const material = new THREE.MeshBasicMaterial({ color: FULL });
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(cap.radius, len, 2, 8), material);
      // Every capsule is upright, so it only needs placing at its middle. In three.js
      // local +z is backwards, so forward is −z.
      mesh.position.set(
        (cap.a[0] + cap.b[0]) / 2,
        (cap.a[1] + cap.b[1]) / 2,
        -(cap.a[2] + cap.b[2]) / 2,
      );
      this.zones[cap.zone] = material;
      this.root.add(mesh);
    }
    this.helmet = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.14, 0.32),
      new THREE.MeshBasicMaterial(),
    );
    this.helmet.position.set(0, 1.7, -0.02);
    this.vest = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.42, 0.42),
      new THREE.MeshBasicMaterial(),
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
    this.helmet.visible = !!c.helmet;
    if (c.helmet) this.helmet.material.color.set(armourColour(c.helmet, items));
    this.vest.visible = !!c.bodyArmour;
    if (c.bodyArmour) this.vest.material.color.set(armourColour(c.bodyArmour, items));
  }
}
