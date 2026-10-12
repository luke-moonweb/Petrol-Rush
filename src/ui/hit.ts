export interface Hit {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

let hits: Hit[] = [];
let baseScale = 1;

export function clearHits(scale = 1): void {
  hits = [];
  baseScale = scale;
}

export function addHit(g: CanvasRenderingContext2D, id: number, x: number, y: number, w: number, h: number): void {
  const m = g.getTransform();
  const k = m.a / baseScale;
  hits.push({ id, x: (m.a * x + m.e) / baseScale, y: (m.d * y + m.f) / baseScale, w: w * k, h: h * (m.d / baseScale) });
}

export function hitAt(x: number, y: number): Hit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!;
    if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
  }
  return null;
}
