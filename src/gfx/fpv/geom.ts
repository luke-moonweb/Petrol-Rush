export type P3 = [number, number, number];

export function rect(x0: number, y0: number, x1: number, y1: number, z: number): P3[] {
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ];
}

export function wall(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): P3[] {
  return [
    [x0, y0, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y0, z1],
  ];
}

// Upright quad from (x0, y0) to (x1, y1) as seen from its front: top-left, top-right, bottom-right, bottom-left.
export function upright(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): [P3, P3, P3, P3] {
  return [
    [x0, y0, z1],
    [x1, y1, z1],
    [x1, y1, z0],
    [x0, y0, z0],
  ];
}

// Flat quad on the ground read by a driver heading along (dx, dy): its top edge points ahead.
export function groundQuad(x: number, y: number, len: number, wid: number, dx: number, dy: number, z: number): [P3, P3, P3, P3] {
  const hl = len / 2;
  const hw = wid / 2;
  const rx = -dy;
  const ry = dx;
  const p = (f: number, r: number): P3 => [x + dx * f + rx * r, y + dy * f + ry * r, z];
  return [p(hl, -hw), p(hl, hw), p(-hl, hw), p(-hl, -hw)];
}
