// A turned local frame (MK-6, 2026-11-12): build a piece square in its own x and z, then
// place it as one group turned by the frame's yaw. District's grids are turned (−140° on
// the hill's), so nearly everything there is built this way. Same turn as the map compiler
// and the layout file's toWorld: local x = (cos, −sin), local z = (sin, cos) in the map.
import { group, r2 } from './nodes.mjs';

const RAD = Math.PI / 180;

/**
 * @param {{ x: number, z: number, yaw?: number }} at the frame's origin in the map, and its
 *   turn in degrees (a layout rect's x, z, yaw serve as they are).
 * @param {number} [y] the frame's height; nodes inside are measured from it.
 */
export function frame({ x, z, yaw = 0 }, y = 0) {
  const c = Math.cos(yaw * RAD);
  const s = Math.sin(yaw * RAD);
  /** A local point in the map. */
  const toWorld = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  /** A map point in the frame. */
  const toLocal = (wx, wz) => {
    const dx = wx - x;
    const dz = wz - z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  return {
    x,
    z,
    y,
    yaw,
    toWorld,
    toLocal,
    /** A local yaw (degrees) in the map. */
    yawToWorld: (ly) => ly + yaw,
    /**
     * The ground under a local point, measured from the frame's height, given the map's
     * groundAt: for standing something on the terrain inside a turned group.
     */
    groundIn: (groundAt) => (lx, lz) => groundAt(...toWorld(lx, lz)) - y,
    /** The frame as a group holding these nodes. */
    group: (name, nodes, extra = {}) =>
      group(name, nodes, {
        pos: [r2(x), r2(y), r2(z)],
        ...(yaw ? { yaw: r2(yaw) } : {}),
        ...extra,
      }),
  };
}
