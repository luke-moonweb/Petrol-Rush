import { CONFIG } from '../config';

export interface OilSlick {
  x: number;
  y: number;
  s: number;
  d: number;
  age: number;
  // Id of the car that spilled it (-1 for none); a slick never spins its own car.
  owner: number;
}

export function oilRadius(o: OilSlick): number {
  return CONFIG.OIL_RADIUS * Math.min(1, 0.3 + o.age / CONFIG.OIL_GROW_S);
}
