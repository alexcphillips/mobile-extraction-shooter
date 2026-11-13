// The map kit's basic nodes (MK-6, 2026-11-12), moved out of gen-silver-creek.mjs: boxes by
// their extents, drawn-only boxes, groups, placed prefabs, labels and shapes tilted along a
// line. Plain world (or group-local) coordinates: x east, z south, y up. Every map script
// builds on these; docs/tech/editors.md → Map kit lists the rest of the kit.

/** Rounded to the centimeter, as the map files keep numbers. */
export const r2 = (n) => Math.round(n * 100) / 100;

/** A box from its x and z extents, bottom and top. */
export function box(x0, z0, x1, z1, bottom, top, color, extra = {}) {
  return {
    type: 'box',
    pos: [r2((x0 + x1) / 2), r2(bottom), r2((z0 + z1) / 2)],
    size: [r2(x1 - x0), r2(top - bottom), r2(z1 - z0)],
    color,
    ...extra,
  };
}

/** Drawn only: no collision. */
export const drawn = (x0, z0, x1, z1, bottom, top, color, extra = {}) =>
  box(x0, z0, x1, z1, bottom, top, color, { collide: false, ...extra });

/** A group; a name makes it a generated group (generated.mjs keys it by its name path). */
export const group = (name, nodes, extra = {}) => ({
  type: 'group',
  name,
  pos: [0, 0, 0],
  ...extra,
  nodes,
});

/** A placed prefab standing at y. */
export const prefab = (name, x, z, extra = {}, y = 0) => ({
  type: 'prefab',
  prefab: name,
  pos: [r2(x), r2(y), r2(z)],
  ...extra,
});

/** A place name on the map tab; `size` 'area' makes it one of the map report's areas. */
export const label = (text, x, z, size, y = 0) => ({
  type: 'mapLabel',
  pos: [r2(x), r2(y), r2(z)],
  text,
  ...(size ? { size } : {}),
});

/** A box tilted along a line from a to b ([x, y, z]), w wide and h thick; drawn only. */
export function along(a, b, w, h, color, extra = {}) {
  const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const flat = Math.hypot(dx, dz);
  return {
    type: 'box',
    pos: [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2 - h / 2), r2((a[2] + b[2]) / 2)],
    size: [w, h, r2(Math.hypot(flat, dy))],
    yaw: r2((Math.atan2(dx, dz) * 180) / Math.PI),
    pitch: r2((-Math.atan2(dy, flat) * 180) / Math.PI),
    color,
    collide: false,
    ...extra,
  };
}

/** The yaw (degrees) that turns a node's local +x onto the line from a to b ([x, z]). */
export const yawAlongX = (a, b) => r2((Math.atan2(b[1] - a[1], b[0] - a[0]) * -180) / Math.PI);

/** The yaw (degrees) that turns a node's local +z onto the line from a to b ([x, z]). */
export const yawAlongZ = (a, b) => r2((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI);
