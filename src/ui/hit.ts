export interface Hit {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

let hits: Hit[] = [];

export function clearHits(): void {
  hits = [];
}

export function addHit(id: number, x: number, y: number, w: number, h: number): void {
  hits.push({ id, x, y, w, h });
}

export function hitAt(x: number, y: number): Hit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!;
    if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
  }
  return null;
}
