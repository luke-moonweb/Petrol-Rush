// Track-shape independent curvature contract.
//
// A track only has to say how much its centre line bends at a distance s along it. The AI speed
// planner, the corner assist and the predictive speed warnings read that through a CurvatureTable,
// so any track (oval, segment circuits) works as long as it implements `curvatureAt`.
// The physics step never reads it: the grip limit comes from the speed and the steering alone.

/** What a track implements for grip-based planning. */
export interface CurvatureSource {
  /** Track length in px (s wraps at this value). */
  readonly len: number;
  /** Signed centre-line curvature (1/px) at s: + = heading increases (clockwise on screen), 0 on straights. */
  curvatureAt(s: number): number;
}

/**
 * Curvature of a line at lateral offset d from the centre line (d + = right of travel).
 * A left turn (k < 0) gets wider (|k| smaller) for d > 0, i.e. on the outside.
 */
export function laneCurvature(k: number, d: number): number {
  return k / (1 - k * d);
}

export const CURVATURE_STEP = 4;

/** Curvature sampled once per track, so lookups in the hot path are a single array read. */
export class CurvatureTable {
  readonly k: Float32Array;
  readonly step: number;

  constructor(
    readonly len: number,
    curvatureAt: (s: number) => number,
    step = CURVATURE_STEP,
  ) {
    this.step = step;
    const n = Math.ceil(len / step);
    this.k = new Float32Array(n);
    for (let i = 0; i < n; i++) this.k[i] = curvatureAt(Math.min(len, i * step + step / 2));
  }

  static from(src: CurvatureSource, step = CURVATURE_STEP): CurvatureTable {
    return new CurvatureTable(src.len, (s) => src.curvatureAt(s), step);
  }

  /** Curvature at s (wrapped). */
  at(s: number): number {
    const n = this.k.length;
    let i = Math.floor(s / this.step) % n;
    if (i < 0) i += n;
    return this.k[i]!;
  }

  /** Largest |curvature| on [s, s + ahead] (both wrapped), sampled every `stride` px. */
  maxAbsAhead(s: number, ahead: number, stride = this.step): number {
    let m = 0;
    for (let ds = 0; ds <= ahead; ds += stride) {
      const a = Math.abs(this.at(s + ds));
      if (a > m) m = a;
    }
    return m;
  }
}
