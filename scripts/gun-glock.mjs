// The `glock` platform's shared body (GM-7b: glock-17, g18c): a slab-sided slide with
// chamfered top edges, a polymer frame whose grip has the deepest rake of the pistols, a
// squared guard and a railed dust cover. Each gun's script adds what tells it apart.
import { B, PC, PISTOL, SIGHT_Y, pistolPieces } from './gun-pistol.mjs';
import { octagon } from './gun-kit.mjs';

export const G = {
  P: PISTOL.glock,
  W: 0.0128, // slide half width
  SB: B - 0.0145, // slide bottom
  ST: B + 0.0142, // slide top
  Z0: -0.148, // slide front
  Z1: 0.036, // slide rear
  REAR_Z: 0.0245,
};

export function glockBody(kit, { port = true } = {}) {
  const p = pistolPieces(kit);
  const { box, extrudeZ, prism } = kit;
  const { P, W, SB, ST, Z0, Z1, REAR_Z } = G;

  // ---- Slide: the slab, its nose bevelled, rear serrations and cover plate
  const sec = octagon(W, ST, SB, 0.0032);
  sec[4] = [W, SB]; // the bottom edges stay square
  sec[3] = [W, SB + 0.001];
  sec[5] = [-W, SB];
  sec[6] = [-W, SB + 0.001];
  extrudeZ('slide', 'slide', sec, Z0 + 0.007, Z1, PC.SLIDE);
  const nose = octagon(W - 0.0016, ST - 0.0022, SB + 0.001, 0.0034);
  p.loftZ('slide', 'slide nose', nose, Z0, sec, Z0 + 0.0072, PC.SLIDE);
  p.serrations(W, { z0: Z1 - 0.029, n: 7, y0: SB + 0.003, y1: ST - 0.005, lean: 0 });
  p.facing(
    'slide',
    'cover plate',
    Z1 + 0.0003,
    [
      [-0.0085, SB + 0.004],
      [0.0085, SB + 0.004],
      [0.0085, ST - 0.006],
      [0.0062, ST - 0.0035],
      [-0.0062, ST - 0.0035],
      [-0.0085, ST - 0.006],
    ],
    PC.SLIDE_HI,
  );
  p.facing(
    'slide',
    'cover plate mark',
    Z1 + 0.0006,
    [
      [-0.005, B - 0.002],
      [0.005, B - 0.002],
      [0.005, B - 0.0008],
      [-0.005, B - 0.0008],
    ],
    PC.SLOT,
  );
  if (port)
    p.port({
      profile: [
        [W, B - 0.001],
        [W, ST - 0.0032],
        [W - 0.0032, ST],
      ],
      z0: -0.055,
      z1: -0.017,
    });

  // ---- Frame: the dust cover, body, tang, controls
  const FB = -0.0225; // dust cover's underside
  extrudeZ(
    'frame',
    'frame',
    [
      [-0.0122, SB + 0.0005],
      [0.0122, SB + 0.0005],
      [0.0122, FB + 0.005],
      [0.0095, FB],
      [-0.0095, FB],
      [-0.0122, FB + 0.005],
    ],
    Z0 + 0.004,
    0.012,
    PC.FRAME,
  );
  p.decals(
    'frame',
    'slide rail line',
    0.0125,
    p.rect(SB - 0.0012, SB + 0.0004, -0.125, 0.012),
    PC.SLOT,
  );
  const railBottom = p.rail({ y: FB, z0: Z0 + 0.008, z1: -0.083, cuts: 1 });
  prism(
    'frame',
    'frame rear',
    [
      [SB + 0.0005, 0.005],
      [SB + 0.0005, Z1 - 0.002],
      [-0.018, Z1],
      [-0.036, 0.04],
      [-0.036, -0.004],
      [FB, -0.012],
    ].map(([y, z]) => [y, z, 0.0128]),
    PC.FRAME,
  );
  p.tang(
    [
      [SB - 0.004, 0.03],
      [SB - 0.007, 0.0445],
      [-0.0125, 0.0455],
      [-0.034, 0.0415],
    ],
    0.0085,
  );
  p.guard({ top: FB + 0.001, bottom: -0.053, z0: -0.077, z1: -0.006, hook: 0.0035 });
  p.trigger({ top: FB + 0.001, z: -0.033 });
  box('frame', 'trigger safety', [0, FB - 0.012, -0.0345], [0.002, 0.014, 0.003], PC.STEEL);
  p.grip(P, { top: -0.03, panelTop: -0.041, lines: 8 });
  for (const y of [-0.052, -0.068, -0.084])
    box(
      'grip',
      'finger groove',
      [0, y, p.axis(P, y) - P.d - 0.0012],
      [0.014, 0.005, 0.004],
      PC.FRAME,
    );
  // Slide stop and magazine catch on the left, takedown tabs both sides, pins.
  box('frame', 'slide stop', [-0.0136, SB - 0.0045, -0.012], [0.0018, 0.0035, 0.026], PC.LEVER);
  box('frame', 'slide stop tab', [-0.0145, SB - 0.0036, -0.003], [0.0022, 0.0026, 0.007], PC.LEVER);
  box('frame', 'magazine catch', [-0.0135, -0.0365, -0.0045], [0.0032, 0.006, 0.0075], PC.LEVER);
  p.decals(
    'frame',
    'takedown tab',
    0.0126,
    p.rect(SB - 0.0072, SB - 0.0036, -0.052, -0.043),
    PC.LEVER,
  );
  p.pin('frame', 'trigger pin', 0.0124, -0.0178, -0.034, 0.0017);
  p.pin('frame', 'locking pin', 0.0124, -0.0115, -0.034, 0.0014);

  p.irons({ rearZ: REAR_Z, rearBase: ST, frontZ: Z0 + 0.013, frontBase: ST, dots: 'outline' });
  return { p, railBottom };
}

/** The platform's points, the muzzle at `muzzleZ`. */
export const glockPoints = (p, railBottom, muzzleZ) =>
  p.points(G.P, { muzzleZ, muzzleEnd: muzzleZ, rearZ: G.REAR_Z, railY: railBottom, railZ: -0.113 });
export { SIGHT_Y };
