// The shared body of the `as-val` platform (GM-6c: as-val, vss): the stamped receiver and
// railed cover from the ak kit, the family's flat notch at the rail's back, the integral
// suppressor with the front post on a clamp at its front, and the trigger guard. The real
// guns take optics on a side dovetail, which the engine doesn't draw, so they take them on a
// railed cover the ak family's way (the user's call, as for the sks and svt-40). Each gun's
// script adds its furniture: the as-val's polymer handguard, pistol grip and skeleton stock,
// the vss's wooden forend and thumbhole stock. See docs/guns.md.
//
//   import { valBody } from './gun-val.mjs';
//   const body = valBody(gunParts());
import { AK, akPieces, akRail } from './gun-ak.mjs';

// ---- Key sizes the platform's guns share
export const VAL = {
  B: 0.012, // bore height
  RW: 0.0135, // receiver half width
  RTOP: 0.012 + 0.0095, // receiver walls' top, under the cover
  RBOT: 0.012 - 0.03, // receiver bottom: the magazine's mouth
  RZ0: -0.085, // receiver front
  RZ1: 0.105, // receiver rear: the stock's front
  SZ: [-0.205, -0.495], // the suppressor [rear, front]
  SR: 0.0205, // its radius
  GRIP_Z: -0.085 + 0.148, // the grip's top front
};

/**
 * Draws the body into `kit` (from gunParts) and returns the ak pieces, the rail and sight
 * heights and the points the guns share.
 */
export function valBody(kit) {
  const { B, RW, RTOP, RBOT, RZ0, RZ1, SZ, SR, GRIP_Z } = VAL;
  const { STEEL, SLOT, BAND, PIN } = AK;
  const { tubeZ, tubeX, box } = kit;
  const { RAIL_TOP } = akRail(B);
  const SIGHT_Y = RAIL_TOP + 0.02; // the family's sight line over the cover rail
  const REAR_Z = RZ1 - 0.012; // the notch, at the rail's back
  const FRONT_Z = SZ[1] + 0.022; // the post, on its clamp near the suppressor's front
  const ak = akPieces(kit, { B, RW, RTOP, RBOT, SIGHT_Y });

  ak.receiver({ RZ0, RZ1, port: [RZ0 + 0.06, RZ0 + 0.135], dimple: false });
  ak.cover({ z0: RZ0 + 0.001, z1: RZ1 + 0.005 });
  ak.railNotch({ REAR_Z });

  // The integral suppressor: a smooth tube on the barrel, a locking ring at its back, a dark
  // bore in its end cap, a seam a third of the way along where its halves part.
  const SP = 'suppressor';
  tubeZ(SP, 'suppressor', B, SZ[0], SZ[1], SR, STEEL, { sides: 16 });
  tubeZ(SP, 'suppressor ring', B, SZ[0] - 0.001, SZ[0] - 0.016, SR + 0.0012, BAND, { sides: 16 });
  tubeX(SP, 'suppressor latch', [SR + 0.002, B, SZ[0] - 0.009], 0.004, 0.004, PIN, { sides: 8 });
  tubeZ(SP, 'suppressor seam', B, SZ[0] - 0.098, SZ[0] - 0.1, SR + 0.0003, SLOT, { sides: 16 });
  tubeZ(SP, 'suppressor cap', B, SZ[1] + 0.0005, SZ[1] - 0.002, SR - 0.002, STEEL, { sides: 16 });
  tubeZ(SP, 'suppressor bore', B, SZ[1] - 0.002, SZ[1] - 0.0024, 0.0055, SLOT, { sides: 10 });
  // The front sight's clamp round the suppressor, and the family's tower, ears and post on it.
  tubeZ(SP, 'front sight clamp', B, FRONT_Z - 0.013, FRONT_Z + 0.013, SR + 0.0014, BAND, { sides: 16 });
  tubeX(SP, 'clamp screw', [-(SR + 0.0018), B - 0.006, FRONT_Z], 0.0022, 0.002, PIN, { sides: 6 });
  ak.gasBlock({ z0: FRONT_Z - 0.011, z1: FRONT_Z + 0.011, TUBE_Y: B + SR + 0.0013 - 0.0096, FRONT_Z });
  // The barrel shows in the gap between the receiver and the suppressor's ring.
  tubeZ('barrel', 'barrel', B, RZ0 + 0.01, SZ[0] - 0.005, 0.0085, STEEL, { sides: 8 });

  ak.triggerGuard({ z0: RZ0 + 0.088, z1: GRIP_Z - 0.001 });
  // The fire selector: a cross-button behind the trigger.
  box('trigger', 'fire selector', [RW + 0.0008, RBOT + 0.006, GRIP_Z - 0.006], [0.0016, 0.005, 0.005], PIN);

  return {
    ak,
    RAIL_TOP,
    SIGHT_Y,
    REAR_Z,
    grip: [0, RBOT - 0.046, GRIP_Z + 0.022],
    sight: [0, SIGHT_Y, REAR_Z],
    muzzle: [0, B, SZ[1] - 0.003],
    mounts: {
      optic: [0, RAIL_TOP, RZ1 - 0.07],
      magazine: [0, RBOT, RZ0 + 0.048],
      stock: [0, B - 0.008, RZ1],
    },
  };
}
