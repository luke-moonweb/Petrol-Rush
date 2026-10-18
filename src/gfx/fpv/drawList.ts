import type { Car } from '../../race/car';
import { carPaintOrder, footprintAngles } from './cars';
import type { Camera, Poly } from './engine';
import type { Glow } from './scene';
import type { Billboard, TexQuad } from './texture';

// The cockpit view's draw list (reused every frame, no garbage) and the depth order of its items:
// walls against cars, then cars against cars.

/** How far (px) around a car a wall piece can overlap it on screen. */
export const CAR_REACH = 26;

export interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  a: number;
  spark: boolean;
}

export interface Item {
  d: number;
  poly?: Poly;
  car?: Car;
  x?: number;
  y?: number;
  h?: number;
  dist?: number;
  // A car must stay drawn before (d above) this wall item's d.
  wallLo?: number;
  glow?: Glow;
  sign?: TexQuad;
  bill?: Billboard;
  puff?: Puff;
  // Pooled storage behind `puff`.
  puffData: Puff;
}

// Draw list, reused every frame (the mirror reuses it after the main view): no per-frame garbage.
export const items: Item[] = [];
const itemPool: Item[] = [];
const walls: Item[] = [];
export const NO_ITEMS: never[] = [];
export const byDepth = (a: Item, b: Item) => b.d - a.d;

export function addItem(d: number): Item {
  let it = itemPool[items.length];
  if (!it) {
    it = { d, puffData: { x: 0, y: 0, z: 0, r: 0, a: 0, spark: false } };
    itemPool.push(it);
  }
  it.d = d;
  it.poly = undefined;
  it.car = undefined;
  it.glow = undefined;
  it.sign = undefined;
  it.bill = undefined;
  it.puff = undefined;
  items.push(it);
  return it;
}

// Centroid depth alone misplaces a car next to a wall piece. For walls close to a car, the side of the
// wall plane the car is on (compared with the camera) decides which of the two must be drawn first.
export function orderCarsAgainstWalls(c: Camera, items: Item[]): void {
  walls.length = 0;
  for (const it of items) if (it.poly?.plane) walls.push(it);
  for (const it of items) {
    if (!it.car) continue;
    const x = it.x!;
    const y = it.y!;
    let front = Infinity;
    let behind = -Infinity;
    for (const w of walls) {
      const p = w.poly!;
      const reach = p.radius + CAR_REACH;
      if (Math.abs(p.cx - x) > reach || Math.abs(p.cy - y) > reach) continue;
      const [nx, ny, k] = p.plane!;
      const sCar = nx * x + ny * y - k;
      const sCam = nx * c.x + ny * c.y - k;
      if (sCar * sCam >= 0) front = Math.min(front, w.d);
      else behind = Math.max(behind, w.d);
    }
    if (front !== Infinity) it.d = Math.min(it.d, front - 0.01);
    if (behind !== -Infinity && behind > it.d) it.d = behind + 0.01;
    // The car pass may lower d but never down to a wall the car stands in front of.
    it.wallLo = behind === -Infinity ? undefined : behind;
  }
}

// Centre depth alone can paint a car over the one beside it. Cars whose footprints overlap as seen from the
// camera are ordered by a vertical plane between the footprints (the car on the camera's side is drawn
// later). For disjoint convex footprints that relation has no cycles, so a topological sort settles it in
// one pass. A car is never moved out of the window its walls allow (walls win over cars).
const carItems: Item[] = [];
const CAR_PAIR_DIST = 80;
const MAX_CARS = 64;
const drawsBefore = new Uint8Array(MAX_CARS * MAX_CARS);
const indegree = new Int32Array(MAX_CARS);
const placed = new Uint8Array(MAX_CARS);
const angLo = new Float64Array(MAX_CARS);
const angHi = new Float64Array(MAX_CARS);
const startD = new Float64Array(MAX_CARS);
const ORDER_GAP = 0.01;

export function orderCarsAgainstCars(c: Camera, list: Item[]): void {
  carItems.length = 0;
  for (const it of list) if (it.car && carItems.length < MAX_CARS) carItems.push(it);
  const n = carItems.length;
  if (n < 2) return;
  for (let i = 0; i < n; i++) {
    const it = carItems[i]!;
    footprintAngles(c, it.x!, it.y!, it.h!, angLo, angHi, i);
    drawsBefore.fill(0, i * MAX_CARS, i * MAX_CARS + n);
    indegree[i] = 0;
    placed[i] = 0;
    startD[i] = it.d;
  }
  let edges = 0;
  for (let i = 0; i < n; i++) {
    const a = carItems[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = carItems[j]!;
      if (Math.abs(a.x! - b.x!) > CAR_PAIR_DIST || Math.abs(a.y! - b.y!) > CAR_PAIR_DIST) continue;
      // An interval wider than half a turn wraps round the camera (a rival on top of the player): no order.
      if (angHi[i]! - angLo[i]! > Math.PI || angHi[j]! - angLo[j]! > Math.PI) continue;
      if (angLo[i]! >= angHi[j]! || angLo[j]! >= angHi[i]!) continue;
      const o = carPaintOrder(a.x!, a.y!, a.h!, b.x!, b.y!, b.h!, c.x, c.y);
      if (o > 0) {
        drawsBefore[i * MAX_CARS + j] = 1;
        indegree[j]!++;
        edges++;
      } else if (o < 0) {
        drawsBefore[j * MAX_CARS + i] = 1;
        indegree[i]!++;
        edges++;
      }
    }
  }
  if (edges === 0) return;
  // Kahn's algorithm. Items are drawn in decreasing d, so a car gets a d below every car drawn before it.
  for (let step = 0; step < n; step++) {
    let next = -1;
    for (let i = 0; i < n; i++) {
      if (placed[i] || indegree[i]! > 0) continue;
      if (next < 0 || carItems[i]!.d > carItems[next]!.d) next = i;
    }
    if (next < 0) {
      // A cycle (should not happen for disjoint footprints): fall back to the depths before this pass.
      for (let i = 0; i < n; i++) carItems[i]!.d = startD[i]!;
      return;
    }
    placed[next] = 1;
    const it = carItems[next]!;
    let firstBefore = Infinity;
    for (let p = 0; p < n; p++) if (drawsBefore[p * MAX_CARS + next]) firstBefore = Math.min(firstBefore, carItems[p]!.d);
    let d = Math.min(it.d, firstBefore - ORDER_GAP);
    const lo = it.wallLo;
    if (lo !== undefined && d <= lo) {
      // Stay strictly inside the window between the wall and the cars drawn before; only when that window is
      // empty does the wall win.
      d = firstBefore > lo && firstBefore !== Infinity ? (lo + firstBefore) / 2 : lo + ORDER_GAP;
    }
    it.d = d;
    for (let q = 0; q < n; q++) if (drawsBefore[next * MAX_CARS + q]) indegree[q]!--;
  }
}
